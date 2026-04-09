import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// --- Mock boundaries ---

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Import after mocks ---

import { rateLimiter } from "./rate-limiter";

// --- Express mock helpers ---

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: "192.168.1.100",
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; body: unknown; _headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; _headers: Record<string, string> };
}

function makeNext(): NextFunction & { called: boolean } {
  const fn = vi.fn() as unknown as NextFunction & { called: boolean };
  Object.defineProperty(fn, "called", {
    get() {
      return (fn as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    },
  });
  return fn;
}

// --- Tests ---

describe("Rate Limiter Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Under / at limit
  // =========================================================================

  it("allows request under the limit (next called)", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 10 }] });

    const middleware = rateLimiter({ maxRequests: 60 });
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next.called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("allows request at exactly the limit (next called, remaining = 0)", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 60 }] });

    const middleware = rateLimiter({ maxRequests: 60 });
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next.called).toBe(true);
    expect(res._headers["X-RateLimit-Remaining"]).toBe("0");
  });

  // =========================================================================
  // Over limit
  // =========================================================================

  it("returns 429 with Retry-After header when over limit", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 61 }] });

    const middleware = rateLimiter({ maxRequests: 60, windowMs: 60_000 });
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res._headers["Retry-After"]).toBe("60");
    expect(res.body).toEqual({
      success: false,
      error: "Rate limit exceeded. Try again later.",
    });
    // next should still be called after the rate limit block returns
    // Actually checking: next is NOT called when 429 is returned (early return)
    // Re-reading the source: the function returns early before next() on 429
    expect(next.called).toBe(false);
  });

  // =========================================================================
  // Headers
  // =========================================================================

  it("sets X-RateLimit-Limit and X-RateLimit-Remaining headers correctly", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 25 }] });

    const middleware = rateLimiter({ maxRequests: 100 });
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res._headers["X-RateLimit-Limit"]).toBe("100");
    expect(res._headers["X-RateLimit-Remaining"]).toBe("75");
  });

  // =========================================================================
  // Key resolution
  // =========================================================================

  it("uses apikey: prefix as rate limit key for API key users", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 1 }] });

    const middleware = rateLimiter({ maxRequests: 60 });
    const req = makeReq({
      user: { uid: "apikey:key-001", email: "api@example.com" },
    } as Partial<Request>);
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    const insertCall = mockQuery.mock.calls[0];
    const key = insertCall[1][0] as string;
    expect(key).toBe("apikey:apikey:key-001");
  });

  it("uses ip: prefix as rate limit key for non-API users", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 1 }] });

    const middleware = rateLimiter({ maxRequests: 60 });
    const req = makeReq({ ip: "10.0.0.42" });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    const insertCall = mockQuery.mock.calls[0];
    const key = insertCall[1][0] as string;
    expect(key).toBe("ip:10.0.0.42");
  });

  // =========================================================================
  // Graceful degradation
  // =========================================================================

  it("allows request through on Postgres failure (graceful degradation)", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));

    const middleware = rateLimiter({ maxRequests: 60 });
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next.called).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
