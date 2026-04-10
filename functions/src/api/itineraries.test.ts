/**
 * Tests for Itinerary API Router
 *
 * Covers:
 * - GET /guest/:guestId  — generate itinerary (JSON, empty case)
 * - GET /render/:guestId — render itinerary HTML
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

const mockGenerateItinerary = vi.fn();
const mockRenderItineraryHtml = vi.fn();

vi.mock("../documents/itineraries", () => ({
  generateItinerary: (...args: unknown[]) => mockGenerateItinerary(...args),
  renderItineraryHtml: (...args: unknown[]) => mockRenderItineraryHtml(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../db/client", () => ({
  query: vi.fn(),
}));

// --- Import module under test ---

import { itinerariesRouter } from "./itineraries";

// --- Helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: { uid: "user-1", email: "user@example.com" },
    role: { roleKey: "liaison", roleName: "Liaison", priority: 20 },
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null as unknown,
    _sent: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
    type: vi.fn().mockImplementation(function (this: typeof res) {
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._sent = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; _sent: unknown; statusCode: number };
}

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = itinerariesRouter as any;
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
// GET /guest/:guestId tests
// ============================================================================

describe("GET /guest/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/guest/:guestId");
  });

  it("returns itinerary with events", async () => {
    mockGenerateItinerary.mockResolvedValueOnce([
      {
        date: "2026-05-22",
        items: [
          { date: "2026-05-22", time: "09:00", title: "Airport pickup", type: "transport" },
          { date: "2026-05-22", time: "13:00", title: "Sound check", type: "event" },
        ],
      },
      {
        date: "2026-05-23",
        items: [
          { date: "2026-05-23", time: "10:00", title: "Autograph session", type: "event" },
        ],
      },
    ]);

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { days: unknown[]; totalEvents: number } };
    expect(body.success).toBe(true);
    expect(body.data.days).toHaveLength(2);
    expect(body.data.totalEvents).toBe(3);
  });

  it("returns empty message when no events", async () => {
    mockGenerateItinerary.mockResolvedValueOnce([]);

    const req = mockReq({ params: { guestId: "guest-2" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { days: unknown[]; message: string } };
    expect(body.success).toBe(true);
    expect(body.data.days).toEqual([]);
    expect(body.data.message).toBe("No events scheduled.");
  });

  it("handles errors gracefully", async () => {
    mockGenerateItinerary.mockRejectedValueOnce(new Error("DB error"));

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("generating itinerary");
  });
});

// ============================================================================
// GET /render/:guestId tests
// ============================================================================

describe("GET /render/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/render/:guestId");
  });

  it("renders itinerary HTML", async () => {
    mockRenderItineraryHtml.mockResolvedValueOnce("<html>Itinerary</html>");

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    expect((res as unknown as { _sent: unknown })._sent).toBe("<html>Itinerary</html>");
  });

  it("handles rendering errors", async () => {
    mockRenderItineraryHtml.mockRejectedValueOnce(new Error("Render failed"));

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
