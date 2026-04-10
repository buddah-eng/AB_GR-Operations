/**
 * Tests for Data Security API Router
 *
 * Covers:
 * - GET /access-log — access log query
 * - GET /anomalies — anomalous access detection
 * - POST /anonymize/:concept/:id — anonymize record
 * - Auth middleware (admin only)
 * - Error handling
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

const mockGetAccessLog = vi.fn();
const mockDetectAnomalousAccess = vi.fn();
const mockAnonymizeRecord = vi.fn();
vi.mock("../data-security/service", () => ({
  getAccessLog: (...args: unknown[]) => mockGetAccessLog(...args),
  detectAnomalousAccess: (...args: unknown[]) => mockDetectAnomalousAccess(...args),
  anonymizeRecord: (...args: unknown[]) => mockAnonymizeRecord(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { dataSecurityRouter } from "./data-security";

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

type LayerMethod = "get" | "post";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = dataSecurityRouter as any;
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

describe("GET /access-log", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/access-log");
  });

  it("returns access log entries", async () => {
    const entries = [{ id: "log-1", actor_id: "user@test.com" }];
    mockGetAccessLog.mockResolvedValue(entries);

    const req = mockReq({ query: { actor: "user@test.com", hours: "48" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(entries);
    expect(mockGetAccessLog).toHaveBeenCalledWith("user@test.com", 48);
  });

  it("uses default hours when not specified", async () => {
    mockGetAccessLog.mockResolvedValue([]);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(mockGetAccessLog).toHaveBeenCalledWith(undefined, 24);
  });

  it("returns 500 on error", async () => {
    mockGetAccessLog.mockRejectedValue(new Error("DB down"));

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("GET /anomalies", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/anomalies");
  });

  it("returns anomalous access results", async () => {
    const anomalies = [{ actor_id: "bot", access_count: 500 }];
    mockDetectAnomalousAccess.mockResolvedValue(anomalies);

    const req = mockReq({ query: { hours: "12" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(anomalies);
    expect(mockDetectAnomalousAccess).toHaveBeenCalledWith(12);
  });

  it("uses default hours when not specified", async () => {
    mockDetectAnomalousAccess.mockResolvedValue([]);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(mockDetectAnomalousAccess).toHaveBeenCalledWith(24);
  });
});

describe("POST /anonymize/:concept/:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/anonymize/:concept/:id");
  });

  it("anonymizes a record and returns affected fields", async () => {
    const result = { fields_anonymized: ["email", "phone"] };
    mockAnonymizeRecord.mockResolvedValue(result);

    const req = mockReq({ params: { concept: "guest", id: "rec-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(result);
    expect(mockAnonymizeRecord).toHaveBeenCalledWith("guest", "rec-1");
  });

  it("returns 500 on error", async () => {
    mockAnonymizeRecord.mockRejectedValue(new Error("Anonymization failed"));

    const req = mockReq({ params: { concept: "guest", id: "rec-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("auth middleware", () => {
  it("router applies requireAuth and requireRole middleware", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = dataSecurityRouter as any;
    const middlewareLayers = router.stack.filter(
      (layer: { route?: unknown }) => !layer.route
    );
    // requireAuth + requireRole(10)
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(2);
  });
});
