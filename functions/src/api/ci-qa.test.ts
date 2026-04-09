/**
 * Tests for the CI/QA Pipeline API Router
 *
 * Covers:
 * - POST /           — create draft change request
 * - POST /:id/validate — run validation
 * - POST /:id/review   — submit for review
 * - POST /:id/apply    — apply change (director role required)
 * - POST /:id/rollback — rollback (director role required)
 * - Input validation (required fields, 400 on missing)
 * - Error handling (404 not found, 500 server errors)
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

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockCreateChangeRequest = vi.fn();
const mockAdvanceChangeRequest = vi.fn();
vi.mock("../ontology/ci-qa", () => ({
  createChangeRequest: (...args: unknown[]) => mockCreateChangeRequest(...args),
  advanceChangeRequest: (...args: unknown[]) => mockAdvanceChangeRequest(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { ciQaRouter } from "./ci-qa";

// --- Fixtures ---

function sampleChangeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr-1",
    status: "draft",
    table_name: "ontology_concepts",
    record_key: "session",
    changes: { name: "Session v2" },
    owner_scope: "org",
    owner_department: null,
    risk_level: null,
    validation_errors: [],
    impact_report: null,
    created_by: "test-uid",
    reviewed_by: null,
    applied_at: null,
    change_set: null,
    created_at: "2026-04-08T00:00:00.000Z",
    updated_at: "2026-04-08T00:00:00.000Z",
    ...overrides,
  };
}

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "test@example.com" },
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

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = ciQaRouter as any;
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

describe("POST / (create draft change request)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/");
  });

  it("creates draft change request with valid payload", async () => {
    const draft = sampleChangeRequest();
    mockCreateChangeRequest.mockResolvedValue(draft);

    const req = mockReq({
      body: {
        tableName: "ontology_concepts",
        recordKey: "session",
        changes: { name: "Session v2" },
        ownerScope: "org",
        ownerDepartment: null,
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: typeof draft };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("cr-1");
    expect(body.data.status).toBe("draft");
    expect(mockCreateChangeRequest).toHaveBeenCalledWith(
      "ontology_concepts",
      "session",
      { name: "Session v2" },
      "org",
      null,
      "test-uid"
    );
  });

  it("returns 400 when tableName is missing", async () => {
    const req = mockReq({
      body: { recordKey: "session", changes: { name: "v2" } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("tableName");
    expect(mockCreateChangeRequest).not.toHaveBeenCalled();
  });

  it("returns 400 when recordKey is missing", async () => {
    const req = mockReq({
      body: { tableName: "ontology_concepts", changes: { name: "v2" } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("recordKey");
    expect(mockCreateChangeRequest).not.toHaveBeenCalled();
  });

  it("returns 400 when changes is missing", async () => {
    const req = mockReq({
      body: { tableName: "ontology_concepts", recordKey: "session" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("changes");
    expect(mockCreateChangeRequest).not.toHaveBeenCalled();
  });

  it("defaults ownerScope to 'org' and ownerDepartment to null", async () => {
    const draft = sampleChangeRequest();
    mockCreateChangeRequest.mockResolvedValue(draft);

    const req = mockReq({
      body: {
        tableName: "ontology_concepts",
        recordKey: "session",
        changes: { name: "v2" },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreateChangeRequest).toHaveBeenCalledWith(
      "ontology_concepts",
      "session",
      { name: "v2" },
      "org",
      null,
      "test-uid"
    );
  });

  it("returns 500 when createChangeRequest throws", async () => {
    mockCreateChangeRequest.mockRejectedValue(new Error("DB connection lost"));

    const req = mockReq({
      body: {
        tableName: "ontology_concepts",
        recordKey: "session",
        changes: { name: "v2" },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("DB connection lost");
  });
});

describe("POST /:id/validate (run validation)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:id/validate");
  });

  it("calls advanceChangeRequest with 'validating' and returns result", async () => {
    const validated = sampleChangeRequest({ status: "review", risk_level: "low" });
    mockAdvanceChangeRequest.mockResolvedValue(validated);

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: typeof validated };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("review");
    expect(mockAdvanceChangeRequest).toHaveBeenCalledWith("cr-1", "validating", "test-uid", 0);
  });

  it("returns 404 when change request is not found", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error('Change request "cr-missing" not found')
    );

    const req = mockReq({ params: { id: "cr-missing" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("returns 400 for invalid transition errors", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error("Invalid transition: applied -> validating")
    );

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid transition");
  });
});

describe("POST /:id/review (submit for review)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:id/review");
  });

  it("calls advanceChangeRequest with 'review' and returns result", async () => {
    const reviewed = sampleChangeRequest({ status: "staged", reviewed_by: "test-uid" });
    mockAdvanceChangeRequest.mockResolvedValue(reviewed);

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: typeof reviewed };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("staged");
    expect(mockAdvanceChangeRequest).toHaveBeenCalledWith("cr-1", "review", "test-uid", 0);
  });

  it("returns 403 for insufficient review authority", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error("Insufficient review authority. Required priority <= -2, got 0.")
    );

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Insufficient");
  });
});

describe("POST /:id/apply (apply change)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:id/apply");
  });

  it("calls advanceChangeRequest with 'applied' and returns result", async () => {
    const applied = sampleChangeRequest({
      status: "applied",
      applied_at: "2026-04-08T12:00:00.000Z",
      change_set: "cs-abc",
    });
    mockAdvanceChangeRequest.mockResolvedValue(applied);

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: typeof applied };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("applied");
    expect(mockAdvanceChangeRequest).toHaveBeenCalledWith("cr-1", "applied", "test-uid", 0);
  });

  it("requires director role (route has requireRole(10) middleware)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = ciQaRouter as any;
    const stack = router.stack as Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown; name?: string }>;
      };
    }>;

    const applyRoute = stack.find(
      (layer) => layer.route?.path === "/:id/apply" && layer.route?.methods.post
    );

    expect(applyRoute).toBeTruthy();
    // The route should have more than 1 handler in its stack (requireRole middleware + handler)
    expect(applyRoute!.route!.stack.length).toBeGreaterThan(1);
  });

  it("returns 500 when apply fails", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error("Failed to apply change: version conflict")
    );

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Apply failed");
    expect(body.error).toContain("version conflict");
  });
});

describe("POST /:id/rollback (rollback change)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:id/rollback");
  });

  it("calls advanceChangeRequest with 'rolled_back' and returns result", async () => {
    const rolledBack = sampleChangeRequest({ status: "rolled_back" });
    mockAdvanceChangeRequest.mockResolvedValue(rolledBack);

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: typeof rolledBack };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("rolled_back");
    expect(mockAdvanceChangeRequest).toHaveBeenCalledWith("cr-1", "rolled_back", "test-uid", 0);
  });

  it("requires director role (route has requireRole(10) middleware)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = ciQaRouter as any;
    const stack = router.stack as Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown; name?: string }>;
      };
    }>;

    const rollbackRoute = stack.find(
      (layer) => layer.route?.path === "/:id/rollback" && layer.route?.methods.post
    );

    expect(rollbackRoute).toBeTruthy();
    expect(rollbackRoute!.route!.stack.length).toBeGreaterThan(1);
  });

  it("returns 400 when rollback window has expired", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error("Rollback window expired. Changes can only be rolled back within 24 hours.")
    );

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("window expired");
  });

  it("returns 500 for unexpected rollback errors", async () => {
    mockAdvanceChangeRequest.mockRejectedValue(
      new Error("Unexpected DB failure")
    );

    const req = mockReq({ params: { id: "cr-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Rollback failed");
  });
});
