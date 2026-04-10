/**
 * Tests for Guest Self-Service API Router
 *
 * Covers:
 * - POST /sessions             — create form session (Zod validation, audit, events)
 * - GET /sessions/:guestId     — list sessions
 * - GET /prefill/:guestId      — get prefill data
 * - POST /sessions/:id/submit  — submit form (validation, 404, 409, 410)
 * - POST /sessions/:id/invalidate — invalidate session
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

const mockCreateFormSession = vi.fn();
const mockGetFormPrefill = vi.fn();
const mockSubmitForm = vi.fn();
const mockGetSessionsForGuest = vi.fn();
const mockInvalidateSession = vi.fn();

vi.mock("../services/guest-self-service", () => ({
  createFormSession: (...args: unknown[]) => mockCreateFormSession(...args),
  getFormPrefill: (...args: unknown[]) => mockGetFormPrefill(...args),
  submitForm: (...args: unknown[]) => mockSubmitForm(...args),
  getSessionsForGuest: (...args: unknown[]) => mockGetSessionsForGuest(...args),
  invalidateSession: (...args: unknown[]) => mockInvalidateSession(...args),
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
    const mockClient = { query: vi.fn() };
    return fn(mockClient);
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../db/client", () => ({
  query: vi.fn(),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    return fn({ query: vi.fn() });
  },
}));

// --- Import module under test ---

import { guestSelfServiceRouter } from "./guest-self-service";

// --- Helpers ---

const AUDIT_CTX = {
  actorId: "user-1",
  actorType: "human" as const,
  changeSet: "cs-456",
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
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; statusCode: number };
}

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = guestSelfServiceRouter as any;
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

// ============================================================================
// POST /sessions tests
// ============================================================================

describe("POST /sessions", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/sessions");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates session with valid data", async () => {
    mockCreateFormSession.mockResolvedValueOnce({
      session: {
        id: "session-1",
        expires_at: "2026-05-01T00:00:00.000Z",
      },
      token: "raw-token-uuid",
    });

    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        expires_in_hours: 48,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { token: string; sessionId: string } };
    expect(body.success).toBe(true);
    expect(body.data.token).toBe("raw-token-uuid");
    expect(body.data.sessionId).toBe("session-1");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "guest_form_session.created" })
    );
  });

  it("rejects invalid guest_id with 400", async () => {
    const req = mockReq({
      body: { guest_id: "not-a-uuid" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects missing guest_id with 400", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when guest not found", async () => {
    mockCreateFormSession.mockRejectedValueOnce(
      new Error("Guest not found: nonexistent")
    );

    const req = mockReq({
      body: { guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects expires_in_hours > 8760 with 400", async () => {
    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        expires_in_hours: 9999,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ============================================================================
// GET /sessions/:guestId tests
// ============================================================================

describe("GET /sessions/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/sessions/:guestId");
  });

  it("returns sessions for guest", async () => {
    mockGetSessionsForGuest.mockResolvedValueOnce([
      {
        id: "s-1",
        guest_id: "guest-1",
        status: "active",
        created_at: "2026-04-01",
        expires_at: "2026-05-01",
        submitted_at: null,
        last_saved_at: null,
      },
    ]);

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[]; meta: { total: number } };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it("returns empty array when no sessions", async () => {
    mockGetSessionsForGuest.mockResolvedValueOnce([]);

    const req = mockReq({ params: { guestId: "guest-2" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ============================================================================
// GET /prefill/:guestId tests
// ============================================================================

describe("GET /prefill/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/prefill/:guestId");
  });

  it("returns prefill data", async () => {
    mockGetFormPrefill.mockResolvedValueOnce({
      guest: { name: "Alice" },
      registry: { dietary: "vegan" },
      merged: { name: "Alice", dietary: "vegan" },
    });

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { merged: Record<string, unknown> } };
    expect(body.success).toBe(true);
    expect(body.data.merged.name).toBe("Alice");
    expect(body.data.merged.dietary).toBe("vegan");
  });
});

// ============================================================================
// POST /sessions/:id/submit tests
// ============================================================================

describe("POST /sessions/:id/submit", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/sessions/:id/submit");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("submits form and fires event", async () => {
    mockSubmitForm.mockResolvedValueOnce({
      sessionId: "session-1",
      guestId: "guest-1",
      status: "submitted",
      submittedAt: "2026-04-08T12:00:00.000Z",
    });

    const req = mockReq({
      params: { id: "session-1" },
      body: { form_data: { dietary: "halal" } },
    });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("submitted");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest_form.submitted",
        action: "completed",
      })
    );
  });

  it("returns 400 when form_data is missing", async () => {
    const req = mockReq({
      params: { id: "session-1" },
      body: {},
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when session not found", async () => {
    mockSubmitForm.mockRejectedValueOnce(
      new Error("Form session not found: nonexistent")
    );

    const req = mockReq({
      params: { id: "nonexistent" },
      body: { form_data: {} },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 409 when already submitted", async () => {
    mockSubmitForm.mockRejectedValueOnce(
      new Error("Form has already been submitted.")
    );

    const req = mockReq({
      params: { id: "session-1" },
      body: { form_data: {} },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 410 when session expired", async () => {
    mockSubmitForm.mockRejectedValueOnce(
      new Error("Form session has expired.")
    );

    const req = mockReq({
      params: { id: "session-1" },
      body: { form_data: {} },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
  });
});

// ============================================================================
// POST /sessions/:id/invalidate tests
// ============================================================================

describe("POST /sessions/:id/invalidate", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/sessions/:id/invalidate");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("invalidates session and fires event", async () => {
    mockInvalidateSession.mockResolvedValueOnce(true);

    const req = mockReq({ params: { id: "session-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("expired");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "guest_form_session.invalidated" })
    );
  });

  it("returns 404 when session not found or already inactive", async () => {
    mockInvalidateSession.mockResolvedValueOnce(false);

    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
