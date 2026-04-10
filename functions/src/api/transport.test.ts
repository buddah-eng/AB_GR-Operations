/**
 * Tests for Transport Booking API Router
 *
 * Covers:
 * - GET /              — list bookings
 * - GET /:id           — get single booking
 * - GET /guest/:guestId — bookings for guest
 * - GET /driver/:name  — active bookings for driver
 * - POST /             — create booking (Zod validation, audit, events)
 * - PUT /:id/status    — transition status (validation, 409, audit, events)
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

const mockListBookings = vi.fn();
const mockGetBookingById = vi.fn();
const mockGetBookingsForGuest = vi.fn();
const mockGetActiveDriverBookings = vi.fn();
const mockCreateBooking = vi.fn();
const mockTransitionBookingStatus = vi.fn();

vi.mock("../services/transport", () => ({
  listBookings: (...args: unknown[]) => mockListBookings(...args),
  getBookingById: (...args: unknown[]) => mockGetBookingById(...args),
  getBookingsForGuest: (...args: unknown[]) => mockGetBookingsForGuest(...args),
  getActiveDriverBookings: (...args: unknown[]) => mockGetActiveDriverBookings(...args),
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  transitionBookingStatus: (...args: unknown[]) => mockTransitionBookingStatus(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    return { eventId: "evt-test", eventName: (args[0] as { eventName: string }).eventName };
  },
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: vi.fn() };
    return fn(mockClient);
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../db/client", () => ({
  query: vi.fn(),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    return fn({ query: vi.fn() });
  },
}));

// --- Import module under test ---

import { transportRouter } from "./transport";

// --- Helpers ---

const AUDIT_CTX = {
  actorId: "user-1",
  actorType: "human" as const,
  changeSet: "cs-123",
};

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: { uid: "user-1", email: "user@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
    actorType: "human",
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null as unknown,
    _sent: null as unknown,
    _type: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
    type: vi.fn().mockImplementation(function (this: typeof res, t: string) {
      this._type = t;
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._sent = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; statusCode: number };
}

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = transportRouter as any;
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

const sampleBooking = {
  id: "booking-1",
  guest_id: "guest-1",
  booking_type: "arrival",
  status: "requested",
  pickup_location: "Terminal E",
  dropoff_location: "Convention Center",
  scheduled_time: "2026-05-22T09:00:00.000Z",
  driver_name: null,
  vehicle_info: null,
  flight_number: "JL008",
  properties: {},
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
  created_by: "user-1",
  archived: false,
};

// ============================================================================
// GET / tests
// ============================================================================

describe("GET /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/");
  });

  it("returns bookings list", async () => {
    mockListBookings.mockResolvedValueOnce([sampleBooking]);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

// ============================================================================
// GET /:id tests
// ============================================================================

describe("GET /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:id");
  });

  it("returns booking when found", async () => {
    mockGetBookingById.mockResolvedValueOnce(sampleBooking);

    const req = mockReq({ params: { id: "booking-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("booking-1");
  });

  it("returns 404 when not found", async () => {
    mockGetBookingById.mockResolvedValueOnce(null);

    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================================
// GET /guest/:guestId tests
// ============================================================================

describe("GET /guest/:guestId", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/guest/:guestId");
  });

  it("returns bookings for guest", async () => {
    mockGetBookingsForGuest.mockResolvedValueOnce([sampleBooking]);

    const req = mockReq({ params: { guestId: "guest-1" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[]; meta: { total: number } };
    expect(body.success).toBe(true);
    expect(body.meta.total).toBe(1);
  });
});

// ============================================================================
// GET /driver/:name tests
// ============================================================================

describe("GET /driver/:name", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/driver/:name");
  });

  it("returns active bookings for driver", async () => {
    mockGetActiveDriverBookings.mockResolvedValueOnce([sampleBooking]);

    const req = mockReq({ params: { name: "Mike" } });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

// ============================================================================
// POST / tests
// ============================================================================

describe("POST /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates booking with valid data", async () => {
    mockCreateBooking.mockResolvedValueOnce(sampleBooking);

    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        booking_type: "arrival",
        pickup_location: "Terminal E",
        flight_number: "JL008",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "transport_booking.created" })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid booking_type with 400", async () => {
    const req = mockReq({
      body: {
        guest_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        booking_type: "invalid_type",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Validation failed");
  });

  it("rejects invalid guest_id format with 400", async () => {
    const req = mockReq({
      body: {
        guest_id: "not-a-uuid",
        booking_type: "arrival",
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects missing required fields with 400", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ============================================================================
// PUT /:id/status tests
// ============================================================================

describe("PUT /:id/status", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("put", "/:id/status");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("transitions status and fires event", async () => {
    mockGetBookingById.mockResolvedValueOnce({ ...sampleBooking, status: "requested" });
    mockTransitionBookingStatus.mockResolvedValueOnce({ ...sampleBooking, status: "confirmed" });

    const req = mockReq({
      params: { id: "booking-1" },
      body: { status: "confirmed" },
    });
    const res = mockRes();
    await handler(req, res);

    const body = res._json as { success: boolean; data: { previousStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data.previousStatus).toBe("requested");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "transport_booking.confirmed",
        previousValues: { status: "requested" },
        newValues: { status: "confirmed" },
      })
    );
  });

  it("returns 404 when booking not found", async () => {
    mockGetBookingById.mockResolvedValueOnce(null);

    const req = mockReq({
      params: { id: "nonexistent" },
      body: { status: "confirmed" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 409 on invalid transition", async () => {
    mockGetBookingById.mockResolvedValueOnce({ ...sampleBooking, status: "requested" });
    mockTransitionBookingStatus.mockRejectedValueOnce(
      new Error('Invalid status transition: "requested" -> "dropped_off"')
    );

    const req = mockReq({
      params: { id: "booking-1" },
      body: { status: "dropped_off" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("rejects invalid status value with 400", async () => {
    const req = mockReq({
      params: { id: "booking-1" },
      body: { status: "flying" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects missing status with 400", async () => {
    const req = mockReq({
      params: { id: "booking-1" },
      body: {},
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
