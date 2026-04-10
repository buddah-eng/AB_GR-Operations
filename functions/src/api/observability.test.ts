/**
 * Tests for Observability API Router
 *
 * Covers:
 * - GET /health returns pipeline health
 * - GET /freshness returns data freshness
 * - GET /errors returns error summary with configurable hours
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

const mockGetPipelineHealth = vi.fn();
const mockGetDataFreshness = vi.fn();
const mockGetErrorSummary = vi.fn();

vi.mock("../observability/service", () => ({
  getPipelineHealth: (...args: unknown[]) => mockGetPipelineHealth(...args),
  getDataFreshness: (...args: unknown[]) => mockGetDataFreshness(...args),
  getErrorSummary: (...args: unknown[]) => mockGetErrorSummary(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { observabilityRouter } from "./observability";

// --- Helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "director", roleName: "Director", priority: 0 },
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

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  const router = observabilityRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;
  };

  for (const layer of router.stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// ============================================================
// Tests
// ============================================================

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pipeline health data", async () => {
    const health = [
      { pipeline_id: "pipe-1", total_executions: 10, successful: 8 },
    ];
    mockGetPipelineHealth.mockResolvedValue(health);

    const req = mockReq();
    const res = mockRes();

    await findHandler("get", "/health")(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe("GET /freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns freshness data", async () => {
    const freshness = [
      { concept_key: "guest", age_minutes: 30, status: "fresh" },
    ];
    mockGetDataFreshness.mockResolvedValue(freshness);

    const req = mockReq({ query: { concept_key: "guest" } });
    const res = mockRes();

    await findHandler("get", "/freshness")(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(mockGetDataFreshness).toHaveBeenCalledWith("guest");
  });
});

describe("GET /errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error summary with default 24 hours", async () => {
    const errors = {
      total_errors: 5,
      errors_by_source: { pipeline: 3, quality: 2 },
      recent_errors: [],
    };
    mockGetErrorSummary.mockResolvedValue(errors);

    const req = mockReq();
    const res = mockRes();

    await findHandler("get", "/errors")(req, res);

    const body = res._json as { success: boolean; data: { total_errors: number } };
    expect(body.success).toBe(true);
    expect(body.data.total_errors).toBe(5);
    expect(mockGetErrorSummary).toHaveBeenCalledWith(24);
  });

  it("accepts custom hours parameter", async () => {
    mockGetErrorSummary.mockResolvedValue({ total_errors: 0, errors_by_source: {}, recent_errors: [] });

    const req = mockReq({ query: { hours: "48" } });
    const res = mockRes();

    await findHandler("get", "/errors")(req, res);

    expect(mockGetErrorSummary).toHaveBeenCalledWith(48);
  });
});
