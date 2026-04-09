import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import {
  rateLimiter,
  getRateLimitKey,
  resolveLimit,
  currentWindowStart,
} from "./rate-limiter";

// Mock Postgres and logger
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// --- Helpers ---

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    actorType: undefined,
    ip: "192.168.1.1",
    socket: { remoteAddress: "192.168.1.1" },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, string>; statusCode: number | null; body: unknown } {
  const state = { headers: {} as Record<string, string>, statusCode: null as number | null, body: null as unknown };
  const res = {
    set: vi.fn((key: string, value: string) => {
      state.headers[key] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn((data: unknown) => {
      state.body = data;
      return res;
    }),
  } as unknown as Response;
  return { res, ...state };
}

describe("Rate Limiter", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // --- 1. Under limit passes through ---

  describe("under limit", () => {
    it("passes through and calls next() when under limit", async () => {
      // incrementCounter returns count = 1 (under default limit of 60)
      mockQuery.mockResolvedValueOnce({ rows: [{ rate_limit_per_min: 60 }], rowCount: 1 }); // resolveLimit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 }); // incrementCounter

      const middleware = rateLimiter();
      const req = makeReq({
        user: { uid: "apikey:key-001", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);
      const { res, headers } = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("59");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });
  });

  // --- 2. At limit passes (remaining = 0) ---

  describe("at limit", () => {
    it("passes through with remaining=0 when exactly at limit", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ rate_limit_per_min: 10 }], rowCount: 1 }); // resolveLimit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 10 }], rowCount: 1 }); // incrementCounter (count = limit)

      const middleware = rateLimiter();
      const req = makeReq({
        user: { uid: "apikey:key-001", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);
      const { res, headers } = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
    });
  });

  // --- 3. Over limit returns 429 + Retry-After ---

  describe("over limit", () => {
    it("returns 429 with Retry-After when over limit", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ rate_limit_per_min: 10 }], rowCount: 1 }); // resolveLimit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 11 }], rowCount: 1 }); // incrementCounter

      const middleware = rateLimiter();
      const req = makeReq({
        user: { uid: "apikey:key-001", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);
      const { res, headers } = makeRes();
      const jsonMock = (res as unknown as { json: ReturnType<typeof vi.fn> }).json;
      const statusMock = (res as unknown as { status: ReturnType<typeof vi.fn> }).status;
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(429);

      const body = jsonMock.mock.calls[0][0];
      expect(body.error).toBe("rate_limit_exceeded");
      expect(body.retryAfter).toBeGreaterThan(0);
      expect(headers["Retry-After"]).toBeDefined();
      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    });
  });

  // --- 4. Headers set correctly ---

  describe("response headers", () => {
    it("sets X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset on every response", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ rate_limit_per_min: 300 }], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 42 }], rowCount: 1 });

      const middleware = rateLimiter();
      const req = makeReq({
        user: { uid: "apikey:key-002", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);
      const { res, headers } = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(headers["X-RateLimit-Limit"]).toBe("300");
      expect(headers["X-RateLimit-Remaining"]).toBe("258"); // 300 - 42
      expect(headers["X-RateLimit-Reset"]).toBeDefined();

      // Reset should be a valid epoch timestamp in the future
      const resetEpoch = Number(headers["X-RateLimit-Reset"]);
      expect(resetEpoch).toBeGreaterThan(Math.floor(Date.now() / 1000) - 120);
    });
  });

  // --- 5. API key uses apikey: prefix ---

  describe("getRateLimitKey", () => {
    it("uses apikey: prefix for API key clients", () => {
      const req = makeReq({
        user: { uid: "apikey:abc-123", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);

      const key = getRateLimitKey(req);
      expect(key).toBe("apikey:apikey:abc-123");
    });

    it("uses ip: prefix for unauthenticated requests", () => {
      const req = makeReq({ ip: "10.0.0.5" });
      const key = getRateLimitKey(req);
      expect(key).toBe("ip:10.0.0.5");
    });

    it("uses ip: prefix for non-api_client actor types", () => {
      const req = makeReq({
        user: { uid: "user-001", email: "human@test.com" },
        actorType: "human",
        ip: "10.0.0.99",
      } as Partial<Request>);

      const key = getRateLimitKey(req);
      expect(key).toBe("ip:10.0.0.99");
    });
  });

  // --- 6. IP fallback ---

  describe("IP fallback", () => {
    it("falls back to socket.remoteAddress when req.ip is undefined", () => {
      const req = makeReq({
        ip: undefined,
        socket: { remoteAddress: "172.16.0.1" },
      } as unknown as Partial<Request>);

      const key = getRateLimitKey(req);
      expect(key).toBe("ip:172.16.0.1");
    });

    it("uses default limit (60) for unauthenticated requests", async () => {
      const req = makeReq();
      const limit = await resolveLimit(req);
      expect(limit).toBe(60);
    });
  });

  // --- 7. Postgres failure allows through (fail-open) ---

  describe("Postgres failure", () => {
    it("allows request through when Postgres query fails", async () => {
      mockQuery.mockRejectedValue(new Error("connection refused"));

      const middleware = rateLimiter();
      const req = makeReq({
        user: { uid: "apikey:key-fail", email: "app@test.com" },
        actorType: "api_client",
      } as Partial<Request>);
      const { res } = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      // Should call next() despite the error (fail-open)
      expect(next).toHaveBeenCalledOnce();
    });
  });

  // --- 8. currentWindowStart ---

  describe("currentWindowStart", () => {
    it("returns a Date aligned to 60-second boundaries", () => {
      const windowStart = currentWindowStart();
      expect(windowStart.getTime() % 60_000).toBe(0);
    });
  });
});
