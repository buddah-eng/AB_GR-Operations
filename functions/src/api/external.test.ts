/**
 * Tests for External Surfaces Router
 *
 * Covers:
 * - Guest form: GET prefill, PUT partial save, POST submit
 * - Driver pickup: GET bookings, POST status transitions
 * - Token auth: valid, invalid, expired tokens
 * - Rate limiting: 30 req/min threshold
 * - Edge cases: already submitted, missing fields, unassigned booking
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import * as crypto from "crypto";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
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
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
}));

vi.mock("../encryption/crypto", () => ({
  encryptPiiFields: (record: Record<string, unknown>) => record,
  decryptPiiFields: (record: Record<string, unknown>) => record,
  isEncryptionConfigured: () => false,
}));

// --- Import module under test ---

import { externalRouter, resetRateLimits, hashToken, getNextTransportStatus } from "./external";

// --- Fixtures ---

const GUEST_TOKEN = "test-guest-token-uuid";
const GUEST_TOKEN_HASH = crypto.createHash("sha256").update(GUEST_TOKEN).digest("hex");

const DRIVER_TOKEN = "test-driver-token-uuid";
const DRIVER_TOKEN_HASH = crypto.createHash("sha256").update(DRIVER_TOKEN).digest("hex");

const AUDIT_CTX = {
  actorId: "guest:guest-1",
  actorType: "external_token" as const,
  changeSet: "cs-ext-123",
};

function guestFormSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    token_hash: GUEST_TOKEN_HASH,
    guest_id: "guest-1",
    form_data: { dietary: "vegan" },
    status: "active",
    created_at: new Date("2026-04-01T00:00:00Z"),
    expires_at: new Date("2026-04-10T00:00:00Z"),
    submitted_at: null,
    last_saved_at: null,
    ...overrides,
  };
}

function driverSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "driver-session-1",
    token_hash: DRIVER_TOKEN_HASH,
    driver_name: "John Driver",
    booking_ids: ["booking-1", "booking-2"],
    status: "active",
    created_at: new Date("2026-04-08T06:00:00Z"),
    expires_at: new Date("2026-04-08T18:00:00Z"),
    ...overrides,
  };
}

function transportBooking(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: "booking-1",
    guest_name: "Alice Guest",
    current_status: "waiting",
    pickup_location: "Terminal 2, Door 4",
    dropoff_location: "Convention Center",
    scheduled_time: new Date("2026-04-08T14:00:00Z"),
    flight_number: "AA100",
    flight_status: "on_time",
    instructions: "Has two large bags.",
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
    user: undefined,
    role: undefined,
    actorType: undefined,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
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

// --- Route handler lookup ---

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
    handle?: (...args: unknown[]) => unknown;
    name?: string;
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

// ============================================================================
// Helper function tests
// ============================================================================

describe("hashToken", () => {
  it("produces SHA-256 hex digest", () => {
    const result = hashToken("test-token");
    const expected = crypto.createHash("sha256").update("test-token").digest("hex");
    expect(result).toBe(expected);
  });
});

describe("getNextTransportStatus", () => {
  it("returns picked_up from waiting", () => {
    expect(getNextTransportStatus("waiting")).toBe("picked_up");
  });

  it("returns dropped_off from picked_up", () => {
    expect(getNextTransportStatus("picked_up")).toBe("dropped_off");
  });

  it("returns null from dropped_off (terminal state)", () => {
    expect(getNextTransportStatus("dropped_off")).toBeNull();
  });

  it("returns null from unknown status", () => {
    expect(getNextTransportStatus("requested")).toBeNull();
  });
});

// ============================================================================
// Guest Form Tests
// ============================================================================

describe("GET /guest-form", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    handler = findHandler("get", "/guest-form");
  });

  it("returns prefill + saved data with valid token", async () => {
    // Session lookup
    mockQuery.mockResolvedValueOnce({ rows: [guestFormSession()] });
    // Guest record
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "guest-1", name: "Alice", email: "alice@example.com", phone: null, company: "Acme", department: null, type: "industry", properties: { merch_size: "M" } }],
    });
    // Registry lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ dietary: "vegetarian", travel_prefs: { airline: "Delta" }, properties: { shirt_size: "L" } }],
    });

    const req = mockReq({ headers: { "x-guest-token": GUEST_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { formData: Record<string, unknown>; prefill: Record<string, unknown> } };
    expect(body.success).toBe(true);
    // Saved form data overrides prefill
    expect(body.data.formData.dietary).toBe("vegan");
    // Prefill from guest record
    expect(body.data.prefill.name).toBe("Alice");
    expect(body.data.prefill.email).toBe("alice@example.com");
    // Prefill from registry
    expect(body.data.prefill.airline).toBe("Delta");
  });

  it("returns 401 with invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ headers: { "x-guest-token": "bad-token" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 with no token header", async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 for expired token (no rows returned by query)", async () => {
    // The query filters expires_at > now(), so expired tokens return 0 rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ headers: { "x-guest-token": "expired-token" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { error: string };
    expect(body.error).toBe("unauthorized");
  });
});

describe("PUT /guest-form", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    handler = findHandler("put", "/guest-form");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
  });

  it("merges partial data into form_data", async () => {
    const session = guestFormSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] }) // session lookup
      .mockResolvedValueOnce({
        rows: [{ ...session, form_data: { dietary: "vegan", accessibility: "wheelchair" }, last_saved_at: new Date() }],
      }); // UPDATE RETURNING
    mockEmit.mockResolvedValue(undefined);

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { accessibility: "wheelchair" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { formData: Record<string, unknown> } };
    expect(body.success).toBe(true);
    expect(body.data.formData.dietary).toBe("vegan");
    expect(body.data.formData.accessibility).toBe("wheelchair");

    // Verify event was fired
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "guest_form.saved" })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("rejects PUT on already-submitted form with 409", async () => {
    const submittedSession = guestFormSession({ status: "submitted" });
    mockQuery.mockResolvedValueOnce({ rows: [submittedSession] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { dietary: "gluten-free" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("already submitted");
  });

  it("rejects PUT on expired form with 410", async () => {
    const expiredSession = guestFormSession({ status: "expired" });
    mockQuery.mockResolvedValueOnce({ rows: [expiredSession] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { dietary: "gluten-free" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("expired");
  });

  it("rejects non-object body with 400", async () => {
    const session = guestFormSession();
    mockQuery.mockResolvedValueOnce({ rows: [session] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: "not an object",
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("POST /guest-form/submit", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    handler = findHandler("post", "/guest-form/submit");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("submits form, updates guest, and fires event", async () => {
    const session = guestFormSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [session] })   // session lookup
      .mockResolvedValueOnce({ rows: [] })           // UPDATE session
      .mockResolvedValueOnce({ rows: [] });          // UPDATE guest

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: { merch_size: "L" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("submitted");

    // Verify domain event
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest_form.submitted",
        action: "completed",
        changeSet: "cs-ext-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("rejects submission on already-submitted form with 409", async () => {
    const submittedSession = guestFormSession({ status: "submitted" });
    mockQuery.mockResolvedValueOnce({ rows: [submittedSession] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects submission on expired form with 410", async () => {
    const expiredSession = guestFormSession({ status: "expired" });
    mockQuery.mockResolvedValueOnce({ rows: [expiredSession] });

    const req = mockReq({
      headers: { "x-guest-token": GUEST_TOKEN },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Driver Pickup Tests
// ============================================================================

describe("GET /driver/pickup", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    handler = findHandler("get", "/driver/pickup");
  });

  it("returns bookings with guest names for valid token", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [driverSession()] }) // session lookup
      .mockResolvedValueOnce({
        rows: [
          transportBooking(),
          transportBooking({ booking_id: "booking-2", guest_name: "Bob Guest", current_status: "picked_up" }),
        ],
      }); // bookings query

    const req = mockReq({ headers: { "x-driver-token": DRIVER_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: Array<{ bookingId: string; guestName: string; currentStatus: string }> };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].guestName).toBe("Alice Guest");
    expect(body.data[0].currentStatus).toBe("waiting");
    expect(body.data[1].guestName).toBe("Bob Guest");

    // Verify no PII fields (phone, email) are present
    for (const booking of body.data) {
      expect(booking).not.toHaveProperty("phone");
      expect(booking).not.toHaveProperty("email");
      expect(booking).not.toHaveProperty("financialData");
    }
  });

  it("returns 401 with invalid driver token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({ headers: { "x-driver-token": "bad-driver-token" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res._json as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when no driver token header is present", async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns empty array when driver has no assigned bookings", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [driverSession({ booking_ids: [] })],
    });

    const req = mockReq({ headers: { "x-driver-token": DRIVER_TOKEN } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});

describe("POST /driver/pickup/transition", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    handler = findHandler("post", "/driver/pickup/transition");
    mockAuditContextFromRequest.mockReturnValue({
      actorId: "driver:driver-session-1",
      actorType: "external_token",
      changeSet: "cs-driver-123",
    });
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("transitions waiting -> picked_up and fires event", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [driverSession()] })                              // session lookup
      .mockResolvedValueOnce({ rows: [{ id: "booking-1", status: "waiting", guest_id: "guest-1" }] })  // booking lookup
      .mockResolvedValueOnce({ rows: [] });                                             // UPDATE booking

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "booking-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { previousStatus: string; currentStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data.previousStatus).toBe("waiting");
    expect(body.data.currentStatus).toBe("picked_up");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "driver.pickup.picked_up",
        changeSet: "cs-driver-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("transitions picked_up -> dropped_off and fires event", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [driverSession()] })
      .mockResolvedValueOnce({ rows: [{ id: "booking-1", status: "picked_up", guest_id: "guest-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "booking-1" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { currentStatus: string } };
    expect(body.data.currentStatus).toBe("dropped_off");
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "driver.pickup.dropped_off" })
    );
  });

  it("returns 409 when booking is already dropped_off", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [driverSession()] })
      .mockResolvedValueOnce({ rows: [{ id: "booking-1", status: "dropped_off", guest_id: "guest-1" }] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "booking-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("No further transitions");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 400 when bookingId is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [driverSession()] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("bookingId");
  });

  it("returns 403 when booking is not assigned to driver", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [driverSession()] });

    const req = mockReq({
      headers: { "x-driver-token": DRIVER_TOKEN },
      body: { bookingId: "unassigned-booking" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("not assigned");
  });

  it("returns 401 with invalid driver token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      headers: { "x-driver-token": "bad-token" },
      body: { bookingId: "booking-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe("Rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
  });

  it("returns 429 after 30 requests in a 1-minute window", async () => {
    // Make 30 successful requests (all will return 401 because of bad token, but pass rate limit)
    mockQuery.mockResolvedValue({ rows: [] });

    // Find rate limit middleware
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = externalRouter as any;
    const rateLimitLayer = router.stack.find(
      (layer: { name?: string; route?: unknown }) => !layer.route
    );

    // Send 30 requests — all should pass rate limit
    for (let i = 0; i < 30; i++) {
      const req = mockReq({
        headers: { "x-guest-token": "test-token" },
        ip: "192.168.1.100",
      });
      const res = mockRes();

      let passed = false;
      rateLimitLayer.handle(req, res, () => { passed = true; });
      expect(passed).toBe(true);
    }

    // 31st request should be rate-limited
    const req = mockReq({
      headers: { "x-guest-token": "test-token" },
      ip: "192.168.1.100",
    });
    const res = mockRes();

    let passed = false;
    rateLimitLayer.handle(req, res, () => { passed = true; });

    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res._json as { error: string };
    expect(body.error).toContain("Too many requests");
  });
});
