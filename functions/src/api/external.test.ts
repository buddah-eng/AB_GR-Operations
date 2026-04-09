/**
 * Tests for the External Surfaces API
 *
 * Covers:
 * - Guest form endpoints: GET, PUT, POST submit
 * - Driver pickup endpoints: GET bookings, POST transitions
 * - Token-scoped auth via X-Guest-Token / X-Driver-Token
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import * as crypto from "crypto";

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

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

vi.mock("./rate-limiter", () => ({
  externalRateLimiter: (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { externalRouter } from "./external";

// --- Fixtures ---

const GUEST_TOKEN = "guest-token-abc123";
const GUEST_TOKEN_HASH = crypto.createHash("sha256").update(GUEST_TOKEN).digest("hex");

const DRIVER_TOKEN = "driver-token-xyz789";
const DRIVER_TOKEN_HASH = crypto.createHash("sha256").update(DRIVER_TOKEN).digest("hex");

function guestSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    guest_id: "guest-1",
    token_hash: GUEST_TOKEN_HASH,
    status: "active",
    form_data: { dietary: "vegan" },
    expires_at: new Date("2027-01-01T00:00:00Z"),
    ...overrides,
  };
}

function driverSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "dsession-1",
    driver_name: "John Driver",
    token_hash: DRIVER_TOKEN_HASH,
    status: "active",
    booking_ids: ["bk-1", "bk-2"],
    expires_at: new Date("2027-01-01T00:00:00Z"),
    ...overrides,
  };
}

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ip: "127.0.0.1",
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
  const router = externalRouter as any;
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
// Guest Form Tests
// ============================================================

describe("GET /guest-form", () => {
  let handler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = findHandler("get", "/guest-form");
  });

  it("returns prefill + saved data for valid token", async () => {
    const session = guestSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] }) // resolveGuestSession
      .mockResolvedValueOnce({
        rows: [{ name: "Alice", type: "VIP", department: "Exec", company: "Acme", properties: { phone: "555" } }],
      }); // guest data

    const req = mockReq({ headers: { "x-guest-token": GUEST_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.guestId).toBe("guest-1");
    expect(body.data.saved).toEqual({ dietary: "vegan" });
    expect(body.data.status).toBe("active");
    expect((body.data.prefill as Record<string, unknown>).name).toBe("Alice");
    expect((body.data.prefill as Record<string, unknown>).phone).toBe("555");
  });

  it("returns 401 for missing token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no session found

    const req = mockReq({ headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid or expired");
  });

  it("returns 401 for invalid/expired token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // token hash not found

    const req = mockReq({ headers: { "x-guest-token": "bad-token" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it("returns empty saved data when form_data is null", async () => {
    const session = guestSession({ form_data: null });
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [{ name: "Bob", properties: {} }] });

    const req = mockReq({ headers: { "x-guest-token": GUEST_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.saved).toEqual({});
  });
});

describe("PUT /guest-form", () => {
  let handler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = findHandler("put", "/guest-form");
  });

  it("merges partial data into session", async () => {
    const session = guestSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] }) // resolveGuestSession
      .mockResolvedValueOnce({ rows: [] });        // UPDATE

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { phone: "555-1234", meal_preference: "halal" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { saved: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.saved).toBe(true);

    // Verify the UPDATE query was called with merged data
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE guest_form_sessions SET form_data = form_data || $1"),
      [JSON.stringify({ phone: "555-1234", meal_preference: "halal" }), "session-1"]
    );
  });

  it("rejects already-submitted form (status != active)", async () => {
    const session = guestSession({ status: "submitted" });
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { phone: "555-1234" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("already been submitted");
  });

  it("returns 401 for invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-guest-token": "bad-token" },
      body: { phone: "555" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("POST /guest-form/submit", () => {
  let handler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = findHandler("post", "/guest-form/submit");
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-1", eventName: "guest.intake_received" });
    mockEmit.mockResolvedValue(undefined);
  });

  it("updates guest record, marks session submitted, fires event", async () => {
    const session = guestSession({ form_data: { dietary: "vegan" } });
    mockQuery
      .mockResolvedValueOnce({ rows: [session] }) // resolveGuestSession
      .mockResolvedValueOnce({ rows: [] })         // UPDATE guests
      .mockResolvedValueOnce({ rows: [] });        // UPDATE guest_form_sessions

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { phone: "555-9999" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { submitted: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.submitted).toBe(true);

    // Verify guest record update with merged form data
    const mergedData = { dietary: "vegan", phone: "555-9999" };
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE guests SET properties = properties || $1"),
      [JSON.stringify(mergedData), "guest-1"]
    );

    // Verify session marked as submitted
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE guest_form_sessions SET status = 'submitted'"),
      [JSON.stringify(mergedData), "session-1"]
    );

    // Verify event fired
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.intake_received",
        domain: "guest",
        action: "intake_received",
        recordId: "guest-1",
        triggeredBy: "guest_self_service",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("rejects already-submitted form", async () => {
    const session = guestSession({ status: "submitted" });
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { phone: "555" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("already been submitted");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-guest-token": "bad-token" },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    const session = guestSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockRejectedValueOnce(new Error("DB connection lost"));

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("An error occurred.");
  });
});

// ============================================================
// Driver Pickup Tests
// ============================================================

describe("GET /driver/pickup", () => {
  let handler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = findHandler("get", "/driver/pickup");
  });

  it("returns bookings with guest names for valid token", async () => {
    const session = driverSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] }) // resolveDriverSession
      .mockResolvedValueOnce({                     // transport_bookings
        rows: [
          {
            id: "bk-1", guest_id: "g-1", booking_type: "arrival", status: "waiting",
            pickup_location: "Airport", dropoff_location: "Hotel",
            scheduled_time: "2026-06-01T10:00:00Z", flight_number: "AA100", flight_status: "on_time",
          },
          {
            id: "bk-2", guest_id: "g-2", booking_type: "departure", status: "dispatched",
            pickup_location: "Hotel", dropoff_location: "Airport",
            scheduled_time: "2026-06-01T14:00:00Z", flight_number: null, flight_status: null,
          },
        ],
      })
      .mockResolvedValueOnce({                     // guest names
        rows: [
          { id: "g-1", name: "Alice" },
          { id: "g-2", name: "Bob" },
        ],
      });

    const req = mockReq({ headers: { "x-driver-token": DRIVER_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { driverName: string; bookings: Array<Record<string, unknown>> } };
    expect(body.success).toBe(true);
    expect(body.data.driverName).toBe("John Driver");
    expect(body.data.bookings).toHaveLength(2);
    expect(body.data.bookings[0].guestName).toBe("Alice");
    expect(body.data.bookings[0].bookingId).toBe("bk-1");
    expect(body.data.bookings[0].status).toBe("waiting");
    expect(body.data.bookings[1].guestName).toBe("Bob");
  });

  it("returns 401 for invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ headers: { "x-driver-token": "bad-token" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid or expired driver token");
  });

  it("returns 401 when no token header is provided", async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns empty array when booking_ids is empty", async () => {
    const session = driverSession({ booking_ids: [] });
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({ headers: { "x-driver-token": DRIVER_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { bookings: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.bookings).toEqual([]);
  });
});

describe("POST /driver/pickup/transition", () => {
  let handler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = findHandler("post", "/driver/pickup/transition");
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-2", eventName: "transport_booking.picked_up" });
    mockEmit.mockResolvedValue(undefined);
  });

  it("succeeds for valid transition (waiting -> picked_up) and fires event", async () => {
    const session = driverSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })           // resolveDriverSession
      .mockResolvedValueOnce({ rows: [{ status: "waiting" }] }) // current booking status
      .mockResolvedValueOnce({ rows: [] });                  // UPDATE

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-1", newStatus: "picked_up" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { bookingId: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.bookingId).toBe("bk-1");
    expect(body.data.status).toBe("picked_up");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "transport_booking.picked_up",
        domain: "transport_booking",
        action: "updated",
        recordId: "bk-1",
        changedFields: ["status"],
        previousValues: { status: "waiting" },
        newValues: { status: "picked_up" },
        triggeredBy: "driver:John Driver",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid transition (picked_up -> waiting) with 400", async () => {
    const session = driverSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [{ status: "picked_up" }] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-1", newStatus: "waiting" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Cannot transition");
    expect(body.error).toContain("picked_up");
    expect(body.error).toContain("waiting");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 403 when booking not assigned to driver", async () => {
    const session = driverSession({ booking_ids: ["bk-1", "bk-2"] });
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-999", newStatus: "picked_up" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("not assigned");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 400 when bookingId is missing", async () => {
    const session = driverSession();
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { newStatus: "picked_up" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("bookingId and newStatus are required");
  });

  it("returns 400 when newStatus is missing", async () => {
    const session = driverSession();
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("bookingId and newStatus are required");
  });

  it("returns 404 when booking not found in database", async () => {
    const session = driverSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [] }); // booking not found

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-1", newStatus: "picked_up" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Booking not found");
  });

  it("returns 401 for invalid driver token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-driver-token": "bad-token" },
      body: { bookingId: "bk-1", newStatus: "picked_up" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("allows dispatched -> waiting transition", async () => {
    const session = driverSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [{ status: "dispatched" }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "bk-1", newStatus: "waiting" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("waiting");
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});
