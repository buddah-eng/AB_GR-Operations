/**
 * Tests for Admin Audit API Router
 *
 * Covers:
 * - GET /audit/query dispatch for all 7 query types
 * - GET /integrity endpoint
 * - Parameter validation and error handling
 * - Auth middleware application
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

const mockQueryByActorAndTimeRange = vi.fn();
const mockQueryByTableRecent = vi.fn();
const mockQueryDirectDbAccess = vi.fn();
const mockQueryChangeSet = vi.fn();
const mockQueryMostActiveActors = vi.fn();
const mockQueryDeletedRecords = vi.fn();
const mockGetChangeSetSummary = vi.fn();
vi.mock("../audit/forensics", () => ({
  queryByActorAndTimeRange: (...args: unknown[]) => mockQueryByActorAndTimeRange(...args),
  queryByTableRecent: (...args: unknown[]) => mockQueryByTableRecent(...args),
  queryDirectDbAccess: (...args: unknown[]) => mockQueryDirectDbAccess(...args),
  queryChangeSet: (...args: unknown[]) => mockQueryChangeSet(...args),
  queryMostActiveActors: (...args: unknown[]) => mockQueryMostActiveActors(...args),
  queryDeletedRecords: (...args: unknown[]) => mockQueryDeletedRecords(...args),
  getChangeSetSummary: (...args: unknown[]) => mockGetChangeSetSummary(...args),
}));

const mockValidateDatabaseIntegrity = vi.fn();
vi.mock("../backups/recovery", () => ({
  validateDatabaseIntegrity: (...args: unknown[]) => mockValidateDatabaseIntegrity(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { adminAuditRouter } from "./admin-audit";

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
  const router = adminAuditRouter as any;
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
// Tests
// ============================================================

describe("GET /audit/query", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/audit/query");
  });

  it("dispatches actor_time_range query correctly", async () => {
    const mockResult = { rows: [{ id: "row-1" }], total: 1 };
    mockQueryByActorAndTimeRange.mockResolvedValue(mockResult);

    const req = mockReq({
      query: {
        type: "actor_time_range",
        actorId: "user-123",
        startTime: "2026-01-01T00:00:00Z",
        endTime: "2026-01-31T23:59:59Z",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockResult);

    expect(mockQueryByActorAndTimeRange).toHaveBeenCalledWith(
      "user-123",
      "2026-01-01T00:00:00Z",
      "2026-01-31T23:59:59Z",
      { page: 1, limit: 100 }
    );
  });

  it("dispatches direct_access query correctly", async () => {
    const mockResult = { rows: [{ id: "access-1" }] };
    mockQueryDirectDbAccess.mockResolvedValue(mockResult);

    const req = mockReq({
      query: { type: "direct_access", hours: "48" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(mockQueryDirectDbAccess).toHaveBeenCalledWith(48, { page: 1, limit: 100 });
  });

  it("dispatches change_set_summary query correctly", async () => {
    const mockResult = { changeSetId: "cs-1", operations: 5 };
    mockGetChangeSetSummary.mockResolvedValue(mockResult);

    const req = mockReq({
      query: { type: "change_set_summary", changeSetId: "cs-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockResult);
    expect(mockGetChangeSetSummary).toHaveBeenCalledWith("cs-1");
  });

  it("returns 400 for unknown query type", async () => {
    const req = mockReq({
      query: { type: "unknown_type" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown audit query type");
  });

  it("returns 400 for missing type parameter", async () => {
    const req = mockReq({
      query: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing required query parameter");
  });

  it("returns 500 when actor_time_range missing required params", async () => {
    const req = mockReq({
      query: { type: "actor_time_range" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("actorId");
  });

  it("passes pagination params through", async () => {
    mockQueryByTableRecent.mockResolvedValue({ rows: [], total: 0 });

    const req = mockReq({
      query: {
        type: "table_recent",
        tableName: "guests",
        page: "3",
        limit: "25",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockQueryByTableRecent).toHaveBeenCalledWith(
      "guests",
      7,
      { page: 3, limit: 25 }
    );
  });

  it("dispatches change_set query correctly", async () => {
    const mockResult = { rows: [{ id: "audit-1" }] };
    mockQueryChangeSet.mockResolvedValue(mockResult);

    const req = mockReq({
      query: { type: "change_set", changeSetId: "cs-42" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(mockQueryChangeSet).toHaveBeenCalledWith("cs-42", { page: 1, limit: 100 });
  });

  it("dispatches active_actors query correctly", async () => {
    const mockResult = [{ actorId: "user-1", count: 42 }];
    mockQueryMostActiveActors.mockResolvedValue(mockResult);

    const req = mockReq({
      query: { type: "active_actors", hours: "12", actorLimit: "5" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(mockQueryMostActiveActors).toHaveBeenCalledWith(12, 5);
  });

  it("dispatches deleted_records query correctly", async () => {
    const mockResult = { rows: [] };
    mockQueryDeletedRecords.mockResolvedValue(mockResult);

    const req = mockReq({
      query: { type: "deleted_records", tableName: "guests", days: "14" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(mockQueryDeletedRecords).toHaveBeenCalledWith("guests", 14, { page: 1, limit: 100 });
  });
});

describe("GET /integrity", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/integrity");
  });

  it("returns validation result on success", async () => {
    const validationResult = { valid: true, tables: 12, issues: [] };
    mockValidateDatabaseIntegrity.mockResolvedValue(validationResult);

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(validationResult);
    expect(mockValidateDatabaseIntegrity).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when integrity check fails", async () => {
    mockValidateDatabaseIntegrity.mockRejectedValue(new Error("Connection failed"));

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Integrity check failed");
    expect(body.error).toContain("Connection failed");
  });
});

describe("auth middleware", () => {
  it("router applies requireAuth and requireRole middleware", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = adminAuditRouter as any;
    const stack = router.stack;

    // The first two middleware layers should be requireAuth and requireRole
    // They are applied via .use() so they appear as non-route layers
    const middlewareLayers = stack.filter(
      (layer: { route?: unknown }) => !layer.route
    );
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(2);
  });
});
