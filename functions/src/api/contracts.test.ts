/**
 * Tests for Contract API Router
 *
 * Covers:
 * - GET /guest/:guestId         — list contracts
 * - GET /:id                    — get single contract
 * - POST /generate              — generate contract (Zod validation, audit, events)
 * - PUT /:id/status             — update status (validation, 404, audit, events)
 * - GET /render/:guestId/:templateId — render HTML preview
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    return fn({ query: mockQuery });
  },
}));

const mockRenderContractHtml = vi.fn();
const mockCreateGuestContract = vi.fn();
vi.mock("../documents/contracts", () => ({
  renderContractHtml: (...args: unknown[]) => mockRenderContractHtml(...args),
  createGuestContract: (...args: unknown[]) => mockCreateGuestContract(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    return { eventId: "evt-test", eventName: (args[0] as { eventName: string }).eventName };
  },
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    return fn({ query: mockQuery });
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { contractsRouter } from "./contracts";

// --- Helpers ---

const AUDIT_CTX = {
  actorId: "user-1",
  actorType: "human" as const,
  changeSet: "cs-789",
};

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: { uid: "user-1", email: "user@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
    actorType: "human",
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null as unknown,
    _sent: null as unknown,
    _type: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
    type: vi.fn().mockImplementation(function (this: typeof res) {
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._sent = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; _sent: unknown; statusCode: number };
}

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = contractsRouter as any;
  const stack = router.stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  }>;

  for (const layer of stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

const sampleContract = {
  id: "contract-1",
  guest_id: "guest-1",
  template_id: "template-1",
  html: "<html>Contract</html>",
  status: "draft",
  created_by: "user-1",
  created_at: "2026-04-01T00:00:00.000Z",
};

// ============================================================================
// GET /guest/:guestId tests
// ============================================================================

describe("GET /guest/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/guest/:guestId");
  });

  it("returns contracts for guest", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "c-1", guest_id: "guest-1", template_id: "t-1", status: "draft", created_by: "u-1", created_at: "2026-04-01" }],
    });

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[]; meta: { total: number } };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it("returns empty when no contracts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ params: { guestId: "guest-2" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ============================================================================
// GET /:id tests
// ============================================================================

describe("GET /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:id");
  });

  it("returns contract when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleContract] });

    const req = mockReq({ params: { id: "contract-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("contract-1");
  });

  it("returns 404 when not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================================
// POST /generate tests
// ============================================================================

describe("POST /generate", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/generate");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("generates contract with valid data", async () => {
    mockCreateGuestContract.mockResolvedValueOnce(sampleContract);

    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        template_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "contract.generated" })
    );
  });

  it("rejects invalid guest_id format with 400", async () => {
    const req = mockReq({
      body: {
        guest_id: "not-a-uuid",
        template_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects missing template_id with 400", async () => {
    const req = mockReq({
      body: { guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when guest or template not found", async () => {
    mockCreateGuestContract.mockRejectedValueOnce(
      new Error("Guest not found: abc")
    );

    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        template_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================================
// PUT /:id/status tests
// ============================================================================

describe("PUT /:id/status", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("put", "/:id/status");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("transitions contract status", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "c-1", status: "draft", guest_id: "g-1" }] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const req = mockReq({
      params: { id: "c-1" },
      body: { status: "sent" },
    });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { previousStatus: string; currentStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data.previousStatus).toBe("draft");
    expect(body.data.currentStatus).toBe("sent");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "contract.sent" })
    );
  });

  it("returns 404 when contract not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      params: { id: "nonexistent" },
      body: { status: "sent" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects invalid status with 400", async () => {
    const req = mockReq({
      params: { id: "c-1" },
      body: { status: "invalid" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects invalid transition (draft -> signed) with 400", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "c-1", status: "draft", guest_id: "g-1" }] });

    const req = mockReq({
      params: { id: "c-1" },
      body: { status: "signed" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string; validTransitions: string[] };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid status transition");
    expect(body.validTransitions).toEqual(["sent"]);
  });

  it("rejects transition from terminal state (expired) with 400", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "c-1", status: "expired", guest_id: "g-1" }] });

    const req = mockReq({
      params: { id: "c-1" },
      body: { status: "sent" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; validTransitions: string[] };
    expect(body.validTransitions).toEqual([]);
  });

  it("sets signed_at when transitioning to signed", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "c-1", status: "sent", guest_id: "g-1" }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const req = mockReq({
      params: { id: "c-1" },
      body: { status: "signed" },
    });
    const res = mockRes();
    await handler(req, res);

    // Verify the UPDATE SQL includes signed_at
    const updateCall = mockQuery.mock.calls[1];
    const sql = updateCall[0] as string;
    expect(sql).toContain("signed_at");
  });
});

// ============================================================================
// GET /render/:guestId/:templateId tests
// ============================================================================

describe("GET /render/:guestId/:templateId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/render/:guestId/:templateId");
  });

  it("renders contract HTML", async () => {
    mockRenderContractHtml.mockResolvedValueOnce("<html>Contract</html>");

    const req = mockReq({ params: { guestId: "g-1", templateId: "t-1" } });
    const res = mockRes();
    await handler(req, res);

    expect((res as unknown as { _sent: unknown })._sent).toBe("<html>Contract</html>");
  });

  it("returns 404 when guest or template not found", async () => {
    mockRenderContractHtml.mockRejectedValueOnce(
      new Error("Contract template not found: abc")
    );

    const req = mockReq({ params: { guestId: "g-1", templateId: "bad" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
