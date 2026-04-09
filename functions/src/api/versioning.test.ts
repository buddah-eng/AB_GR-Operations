/**
 * Tests for Versioning API Router
 *
 * Covers:
 * - POST /version/:table/:key - create new version
 * - POST /rollback/:table/:id - rollback
 * - GET /history/:table/:key - version history
 * - GET /active/:table/:key - active version
 * - Table validation
 * - Auth middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// --- Mocks (must be before import of module under test) ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockUpdateOntologyRecord = vi.fn();
const mockRollbackOntologyRecord = vi.fn();
const mockGetVersionHistory = vi.fn();
const mockGetActiveVersion = vi.fn();
vi.mock("../versioning/service", () => ({
  updateOntologyRecord: (...args: unknown[]) => mockUpdateOntologyRecord(...args),
  rollbackOntologyRecord: (...args: unknown[]) => mockRollbackOntologyRecord(...args),
  getVersionHistory: (...args: unknown[]) => mockGetVersionHistory(...args),
  getActiveVersion: (...args: unknown[]) => mockGetActiveVersion(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-v-1", eventName: input.eventName, ...input };
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { versioningRouter } from "./versioning";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-v-123",
};

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "director", roleName: "Director", priority: 0 },
    actorType: "human",
    ip: "127.0.0.1",
    headers: {},
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

// --- Find a route handler from the Express Router stack ---

type LayerMethod = "get" | "post";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = versioningRouter as any;
  const stack = router.stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  }>;

  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// ============================================================
// POST /version/:table/:key
// ============================================================

describe("POST /version/:table/:key", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/version/:table/:key");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("calls updateOntologyRecord with audit context", async () => {
    const versionResult = { id: "ver-1", version: 2, data: { label: "Updated" } };
    mockUpdateOntologyRecord.mockResolvedValue({
      success: true,
      data: versionResult,
    });

    const req = mockReq({
      params: { table: "ontology_concepts", key: "guest" },
      body: { updates: { label: "Updated" }, changeReason: "Fix label typo" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("ver-1");

    expect(mockUpdateOntologyRecord).toHaveBeenCalledWith(
      "ontology_concepts",
      "guest",
      { label: "Updated" },
      "test-uid",
      "Fix label typo",
      AUDIT_CTX
    );
  });

  it("fires domain event with changeSet", async () => {
    mockUpdateOntologyRecord.mockResolvedValue({
      success: true,
      data: { id: "ver-2", version: 3 },
    });

    const req = mockReq({
      params: { table: "ontology_properties", key: "name" },
      body: { updates: { required: true }, changeReason: "Make required" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "ontology.version_created",
        domain: "ontology",
        action: "created",
        recordId: "ver-2",
        changeSet: "cs-v-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("calls logAuditClaim", async () => {
    mockUpdateOntologyRecord.mockResolvedValue({
      success: true,
      data: { id: "ver-3" },
    });

    const req = mockReq({
      params: { table: "ontology_concepts", key: "staff" },
      body: { updates: { name: "Staff Member" }, changeReason: "Rename" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockLogAuditClaim).toHaveBeenCalledWith(
      AUDIT_CTX,
      "POST /api/ontology/version/ontology_concepts/staff"
    );
  });

  it("rejects invalid table name with 400", async () => {
    const req = mockReq({
      params: { table: "users_private", key: "admin" },
      body: { updates: { name: "Hack" }, changeReason: "test" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid table");
    expect(body.error).toContain("Allowed tables");
    expect(mockUpdateOntologyRecord).not.toHaveBeenCalled();
  });

  it("returns 400 when updates field is missing", async () => {
    const req = mockReq({
      params: { table: "ontology_concepts", key: "guest" },
      body: { changeReason: "Fix" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("updates");
  });

  it("returns 400 when changeReason is missing", async () => {
    const req = mockReq({
      params: { table: "ontology_concepts", key: "guest" },
      body: { updates: { name: "New" } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("changeReason");
  });
});

// ============================================================
// POST /rollback/:table/:id
// ============================================================

describe("POST /rollback/:table/:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/rollback/:table/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("calls rollbackOntologyRecord", async () => {
    mockRollbackOntologyRecord.mockResolvedValue({
      success: true,
      data: { id: "ver-prev", version: 1 },
    });

    const req = mockReq({
      params: { table: "ontology_concepts", id: "ver-2" },
      body: { reason: "Revert bad change" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("ver-prev");

    expect(mockRollbackOntologyRecord).toHaveBeenCalledWith(
      "ontology_concepts",
      "ver-2",
      "test-uid",
      "Revert bad change",
      AUDIT_CTX
    );
  });

  it("fires ontology.rolled_back event", async () => {
    mockRollbackOntologyRecord.mockResolvedValue({
      success: true,
      data: { id: "ver-prev" },
    });

    const req = mockReq({
      params: { table: "ontology_properties", id: "ver-5" },
      body: { reason: "Rollback" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "ontology.rolled_back",
        domain: "ontology",
        action: "updated",
        metadata: expect.objectContaining({
          reason: "Rollback",
          rolledBackFrom: "ver-5",
        }),
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when reason is missing", async () => {
    const req = mockReq({
      params: { table: "ontology_concepts", id: "ver-2" },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("reason");
  });
});

// ============================================================
// GET /history/:table/:key
// ============================================================

describe("GET /history/:table/:key", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/history/:table/:key");
  });

  it("returns version array", async () => {
    const versions = [
      { id: "v1", version: 1, data: {} },
      { id: "v2", version: 2, data: {} },
    ];
    mockGetVersionHistory.mockResolvedValue({
      success: true,
      data: versions,
    });

    const req = mockReq({
      params: { table: "ontology_concepts", key: "guest" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(versions);
    expect(mockGetVersionHistory).toHaveBeenCalledWith("ontology_concepts", "guest");
  });

  it("returns 400 for invalid table", async () => {
    const req = mockReq({
      params: { table: "secrets", key: "api_key" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Invalid table");
  });
});

// ============================================================
// GET /active/:table/:key
// ============================================================

describe("GET /active/:table/:key", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/active/:table/:key");
  });

  it("returns single active record", async () => {
    const activeRecord = { id: "v3", version: 3, data: { name: "Guest" }, is_active: true };
    mockGetActiveVersion.mockResolvedValue({
      success: true,
      data: activeRecord,
    });

    const req = mockReq({
      params: { table: "ontology_concepts", key: "guest" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("v3");
    expect(mockGetActiveVersion).toHaveBeenCalledWith("ontology_concepts", "guest");
  });

  it("returns 400 when service reports failure (e.g., not found)", async () => {
    mockGetActiveVersion.mockResolvedValue({
      success: false,
      error: { message: "No active version found for key 'missing'" },
    });

    const req = mockReq({
      params: { table: "ontology_concepts", key: "missing" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("No active version found");
  });
});
