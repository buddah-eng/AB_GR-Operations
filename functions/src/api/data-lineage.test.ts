/**
 * Tests for Data Lineage API Router
 *
 * Covers:
 * - GET /:concept/:id/backward — backward trace
 * - GET /:concept/:id/forward — forward trace
 * - GET /:concept/:field/impact — impact analysis
 * - Error handling
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

const mockTraceBackward = vi.fn();
const mockTraceForward = vi.fn();
const mockGetImpactAnalysis = vi.fn();
vi.mock("../data-lineage/service", () => ({
  traceBackward: (...args: unknown[]) => mockTraceBackward(...args),
  traceForward: (...args: unknown[]) => mockTraceForward(...args),
  getImpactAnalysis: (...args: unknown[]) => mockGetImpactAnalysis(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { dataLineageRouter } from "./data-lineage";

// --- Helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
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

type LayerMethod = "get" | "post";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = dataLineageRouter as any;
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

describe("GET /:concept/:id/backward", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:concept/:id/backward");
  });

  it("returns backward lineage graph", async () => {
    const graph = {
      nodes: [{ id: "n1", concept_key: "guest" }],
      edges: [],
    };
    mockTraceBackward.mockResolvedValue(graph);

    const req = mockReq({ params: { concept: "guest", id: "rec-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(graph);
    expect(mockTraceBackward).toHaveBeenCalledWith("guest", "rec-1");
  });

  it("returns 500 on service error", async () => {
    mockTraceBackward.mockRejectedValue(new Error("trace failed"));

    const req = mockReq({ params: { concept: "guest", id: "rec-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("GET /:concept/:id/forward", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:concept/:id/forward");
  });

  it("returns forward lineage graph", async () => {
    const graph = {
      nodes: [{ id: "n2", concept_key: "schedule" }],
      edges: [{ from: "n1", to: "n2", relationship: "triggered" }],
    };
    mockTraceForward.mockResolvedValue(graph);

    const req = mockReq({ params: { concept: "guest", id: "rec-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(graph);
  });
});

describe("GET /:concept/:field/impact", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:concept/:field/impact");
  });

  it("returns impact analysis", async () => {
    const analysis = {
      source_concept: "guest",
      source_field: "email",
      affected_routes: [{ route_id: "r1", dest_concept: "hotel" }],
      affected_concepts: ["hotel"],
    };
    mockGetImpactAnalysis.mockResolvedValue(analysis);

    const req = mockReq({ params: { concept: "guest", field: "email" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(analysis);
    expect(mockGetImpactAnalysis).toHaveBeenCalledWith("guest", "email");
  });

  it("returns 500 on error", async () => {
    mockGetImpactAnalysis.mockRejectedValue(new Error("query failed"));

    const req = mockReq({ params: { concept: "guest", field: "email" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("auth middleware", () => {
  it("router applies requireAuth middleware", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = dataLineageRouter as any;
    const middlewareLayers = router.stack.filter(
      (layer: { route?: unknown }) => !layer.route
    );
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(1);
  });
});
