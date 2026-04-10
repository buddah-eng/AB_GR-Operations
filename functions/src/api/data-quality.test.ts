/**
 * Tests for Data Quality API Router
 *
 * Covers:
 * - GET /rules — list rules
 * - POST /rules — create rule (director role)
 * - GET /violations — list violations
 * - PUT /violations/:id/resolve — resolve violation
 * - GET /score/:concept — quality score
 * - Auth middleware enforcement
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

const mockListRules = vi.fn();
const mockCreateRule = vi.fn();
const mockGetViolations = vi.fn();
const mockResolveViolation = vi.fn();
const mockGetQualityScore = vi.fn();
vi.mock("../data-quality/service", () => ({
  listRules: (...args: unknown[]) => mockListRules(...args),
  createRule: (...args: unknown[]) => mockCreateRule(...args),
  getViolations: (...args: unknown[]) => mockGetViolations(...args),
  resolveViolation: (...args: unknown[]) => mockResolveViolation(...args),
  getQualityScore: (...args: unknown[]) => mockGetQualityScore(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { dataQualityRouter } from "./data-quality";

// --- Helpers ---

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

type LayerMethod = "get" | "post" | "put";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = dataQualityRouter as any;
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

// --- Tests ---

describe("GET /rules", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/rules");
  });

  it("returns list of quality rules", async () => {
    const rules = [{ id: "rule-1", name: "Email required" }];
    mockListRules.mockResolvedValue(rules);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(rules);
  });

  it("passes concept filter through", async () => {
    mockListRules.mockResolvedValue([]);

    const req = mockReq({ query: { concept: "guest" } });
    const res = mockRes();
    await handler(req, res);

    expect(mockListRules).toHaveBeenCalledWith("guest");
  });
});

describe("POST /rules", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/rules");
  });

  it("creates a quality rule", async () => {
    const newRule = { id: "rule-1", name: "Email required" };
    mockCreateRule.mockResolvedValue(newRule);

    const req = mockReq({
      body: {
        name: "Email required",
        concept_key: "guest",
        rule_type: "completeness",
        condition: { type: "field", field: "email", operator: "is_not_empty" },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(newRule);
  });

  it("returns 400 when required fields are missing", async () => {
    const req = mockReq({ body: { name: "Incomplete" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing required fields");
  });
});

describe("GET /violations", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/violations");
  });

  it("returns list of violations", async () => {
    const violations = [{ id: "v-1", severity: "error" }];
    mockGetViolations.mockResolvedValue(violations);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(violations);
  });

  it("passes concept and resolved filters", async () => {
    mockGetViolations.mockResolvedValue([]);

    const req = mockReq({
      query: { concept: "guest", resolved: "false" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(mockGetViolations).toHaveBeenCalledWith("guest", false);
  });
});

describe("PUT /violations/:id/resolve", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("put", "/violations/:id/resolve");
  });

  it("resolves a violation", async () => {
    const resolved = { id: "v-1", resolved: true };
    mockResolveViolation.mockResolvedValue(resolved);

    const req = mockReq({ params: { id: "v-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(resolved);
  });

  it("returns 404 when violation not found", async () => {
    mockResolveViolation.mockResolvedValue(null);

    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("GET /score/:concept", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/score/:concept");
  });

  it("returns quality score for a concept", async () => {
    const score = { total: 10, passing: 9, score_pct: 90 };
    mockGetQualityScore.mockResolvedValue(score);

    const req = mockReq({ params: { concept: "guest" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(score);
    expect(mockGetQualityScore).toHaveBeenCalledWith("guest");
  });
});

describe("auth middleware", () => {
  it("router applies requireAuth middleware", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = dataQualityRouter as any;
    const middlewareLayers = router.stack.filter(
      (layer: { route?: unknown }) => !layer.route
    );
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(1);
  });
});
