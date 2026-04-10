/**
 * Tests for Transport Booking Service
 *
 * Covers:
 * - createBooking
 * - transitionBookingStatus (valid + invalid transitions)
 * - getBookingById
 * - getBookingsForGuest
 * - getActiveDriverBookings
 * - listBookings with filters
 * - getValidTransitions / isValidTransition
 * - rowToBooking mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    const mockClient = { query: mockQuery };
    return fn(mockClient);
  },
}));

// --- Import module under test ---

import {
  createBooking,
  transitionBookingStatus,
  getBookingById,
  getBookingsForGuest,
  getActiveDriverBookings,
  listBookings,
  getValidTransitions,
  isValidTransition,
  rowToBooking,
} from "./transport";

// --- Test data ---

const makeBookingRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "booking-1",
  guest_id: "guest-1",
  booking_type: "arrival",
  status: "requested",
  pickup_location: "Logan Terminal E",
  dropoff_location: "Convention Center",
  scheduled_time: new Date("2026-05-22T09:00:00Z"),
  driver_name: "Mike Chen",
  vehicle_info: "Black SUV, Plate ABC-123",
  flight_number: "JL008",
  properties: { instructions: "Has heavy luggage" },
  created_at: new Date("2026-04-01T00:00:00Z"),
  updated_at: new Date("2026-04-01T00:00:00Z"),
  created_by: "user-1",
  archived: false,
  ...overrides,
});

// ============================================================================
// Status machine tests
// ============================================================================

describe("getValidTransitions", () => {
  it("returns [confirmed, cancelled] for requested", () => {
    expect(getValidTransitions("requested")).toEqual(["confirmed", "cancelled"]);
  });

  it("returns [dispatched, cancelled] for confirmed", () => {
    expect(getValidTransitions("confirmed")).toEqual(["dispatched", "cancelled"]);
  });

  it("returns [waiting, cancelled] for dispatched", () => {
    expect(getValidTransitions("dispatched")).toEqual(["waiting", "cancelled"]);
  });

  it("returns [picked_up, cancelled] for waiting", () => {
    expect(getValidTransitions("waiting")).toEqual(["picked_up", "cancelled"]);
  });

  it("returns [dropped_off] for picked_up", () => {
    expect(getValidTransitions("picked_up")).toEqual(["dropped_off"]);
  });

  it("returns [] for dropped_off (terminal)", () => {
    expect(getValidTransitions("dropped_off")).toEqual([]);
  });

  it("returns [] for cancelled (terminal)", () => {
    expect(getValidTransitions("cancelled")).toEqual([]);
  });

  it("returns [] for unknown status", () => {
    expect(getValidTransitions("bogus")).toEqual([]);
  });
});

describe("isValidTransition", () => {
  it("allows requested -> confirmed", () => {
    expect(isValidTransition("requested", "confirmed")).toBe(true);
  });

  it("allows requested -> cancelled", () => {
    expect(isValidTransition("requested", "cancelled")).toBe(true);
  });

  it("blocks requested -> dropped_off", () => {
    expect(isValidTransition("requested", "dropped_off")).toBe(false);
  });

  it("blocks dropped_off -> anything", () => {
    expect(isValidTransition("dropped_off", "requested")).toBe(false);
  });

  it("allows full lifecycle path", () => {
    const lifecycle = ["requested", "confirmed", "dispatched", "waiting", "picked_up", "dropped_off"];
    for (let i = 0; i < lifecycle.length - 1; i++) {
      expect(isValidTransition(lifecycle[i], lifecycle[i + 1])).toBe(true);
    }
  });
});

// ============================================================================
// rowToBooking tests
// ============================================================================

describe("rowToBooking", () => {
  it("maps DB row to TransportBooking", () => {
    const row = makeBookingRow();
    const booking = rowToBooking(row);

    expect(booking.id).toBe("booking-1");
    expect(booking.guest_id).toBe("guest-1");
    expect(booking.booking_type).toBe("arrival");
    expect(booking.status).toBe("requested");
    expect(booking.pickup_location).toBe("Logan Terminal E");
    expect(booking.driver_name).toBe("Mike Chen");
    expect(booking.flight_number).toBe("JL008");
    expect(booking.archived).toBe(false);
  });

  it("handles null optional fields", () => {
    const row = makeBookingRow({
      pickup_location: null,
      dropoff_location: null,
      driver_name: null,
      vehicle_info: null,
      flight_number: null,
      scheduled_time: null,
      created_by: null,
    });
    const booking = rowToBooking(row);

    expect(booking.pickup_location).toBeNull();
    expect(booking.dropoff_location).toBeNull();
    expect(booking.driver_name).toBeNull();
    expect(booking.vehicle_info).toBeNull();
    expect(booking.flight_number).toBeNull();
    expect(booking.scheduled_time).toBeNull();
    expect(booking.created_by).toBeNull();
  });

  it("converts Date scheduled_time to ISO string", () => {
    const row = makeBookingRow({ scheduled_time: new Date("2026-05-22T09:00:00Z") });
    const booking = rowToBooking(row);
    expect(booking.scheduled_time).toBe("2026-05-22T09:00:00.000Z");
  });

  it("passes through string scheduled_time", () => {
    const row = makeBookingRow({ scheduled_time: "2026-05-22T09:00:00Z" });
    const booking = rowToBooking(row);
    expect(booking.scheduled_time).toBe("2026-05-22T09:00:00Z");
  });
});

// ============================================================================
// createBooking tests
// ============================================================================

describe("createBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a booking with status=requested", async () => {
    const row = makeBookingRow();
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const booking = await createBooking("guest-1", {
      booking_type: "arrival",
      pickup_location: "Logan Terminal E",
      dropoff_location: "Convention Center",
      flight_number: "JL008",
    });

    expect(booking.id).toBe("booking-1");
    expect(booking.status).toBe("requested");
    expect(booking.booking_type).toBe("arrival");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("passes created_by when provided", async () => {
    const row = makeBookingRow({ created_by: "admin-1" });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const booking = await createBooking("guest-1", {
      booking_type: "departure",
      created_by: "admin-1",
    });

    expect(booking.created_by).toBe("admin-1");
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain("admin-1");
  });

  it("defaults optional fields to null", async () => {
    const row = makeBookingRow({
      pickup_location: null,
      dropoff_location: null,
      driver_name: null,
      vehicle_info: null,
      flight_number: null,
      scheduled_time: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const booking = await createBooking("guest-1", {
      booking_type: "inter_venue",
    });

    expect(booking.pickup_location).toBeNull();
    expect(booking.driver_name).toBeNull();
  });
});

// ============================================================================
// transitionBookingStatus tests
// ============================================================================

describe("transitionBookingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions requested -> confirmed", async () => {
    const current = makeBookingRow({ status: "requested" });
    const updated = makeBookingRow({ status: "confirmed" });

    mockQuery
      .mockResolvedValueOnce({ rows: [current] }) // getBookingById
      .mockResolvedValueOnce({ rows: [updated] }); // UPDATE

    const result = await transitionBookingStatus("booking-1", "confirmed");

    expect(result.status).toBe("confirmed");
  });

  it("transitions confirmed -> dispatched", async () => {
    const current = makeBookingRow({ status: "confirmed" });
    const updated = makeBookingRow({ status: "dispatched" });

    mockQuery
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [updated] });

    const result = await transitionBookingStatus("booking-1", "dispatched");
    expect(result.status).toBe("dispatched");
  });

  it("allows cancellation from waiting", async () => {
    const current = makeBookingRow({ status: "waiting" });
    const updated = makeBookingRow({ status: "cancelled" });

    mockQuery
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [updated] });

    const result = await transitionBookingStatus("booking-1", "cancelled");
    expect(result.status).toBe("cancelled");
  });

  it("throws on invalid transition requested -> dropped_off", async () => {
    const current = makeBookingRow({ status: "requested" });
    mockQuery.mockResolvedValueOnce({ rows: [current] });

    await expect(
      transitionBookingStatus("booking-1", "dropped_off")
    ).rejects.toThrow("Invalid status transition");
  });

  it("throws on terminal state dropped_off -> requested", async () => {
    const current = makeBookingRow({ status: "dropped_off" });
    mockQuery.mockResolvedValueOnce({ rows: [current] });

    await expect(
      transitionBookingStatus("booking-1", "requested")
    ).rejects.toThrow("Invalid status transition");
  });

  it("throws when booking not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      transitionBookingStatus("nonexistent", "confirmed")
    ).rejects.toThrow("Transport booking not found");
  });
});

// ============================================================================
// getBookingById tests
// ============================================================================

describe("getBookingById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns booking when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeBookingRow()] });

    const booking = await getBookingById("booking-1");

    expect(booking).not.toBeNull();
    expect(booking!.id).toBe("booking-1");
  });

  it("returns null when not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const booking = await getBookingById("nonexistent");

    expect(booking).toBeNull();
  });
});

// ============================================================================
// getBookingsForGuest tests
// ============================================================================

describe("getBookingsForGuest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all non-archived bookings for a guest", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeBookingRow({ id: "b-1", status: "confirmed" }),
        makeBookingRow({ id: "b-2", status: "requested" }),
      ],
    });

    const bookings = await getBookingsForGuest("guest-1");

    expect(bookings).toHaveLength(2);
    expect(bookings[0].id).toBe("b-1");
    expect(bookings[1].id).toBe("b-2");
  });

  it("returns empty array when no bookings", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const bookings = await getBookingsForGuest("guest-no-bookings");

    expect(bookings).toEqual([]);
  });
});

// ============================================================================
// getActiveDriverBookings tests
// ============================================================================

describe("getActiveDriverBookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active bookings for a driver", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeBookingRow({ id: "b-1", driver_name: "Mike", status: "confirmed" }),
        makeBookingRow({ id: "b-2", driver_name: "Mike", status: "waiting" }),
      ],
    });

    const bookings = await getActiveDriverBookings("Mike");

    expect(bookings).toHaveLength(2);
  });

  it("excludes dropped_off and cancelled bookings via query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const bookings = await getActiveDriverBookings("Mike");

    expect(bookings).toEqual([]);
    // Verify the SQL excludes terminal statuses
    const sqlArg = mockQuery.mock.calls[0][0] as string;
    expect(sqlArg).toContain("NOT IN ('dropped_off', 'cancelled')");
  });
});

// ============================================================================
// listBookings tests
// ============================================================================

describe("listBookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists all non-archived bookings by default", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeBookingRow(), makeBookingRow({ id: "b-2" })],
    });

    const bookings = await listBookings();

    expect(bookings).toHaveLength(2);
    const sqlArg = mockQuery.mock.calls[0][0] as string;
    expect(sqlArg).toContain("NOT archived");
  });

  it("filters by status when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeBookingRow({ status: "waiting" })] });

    const bookings = await listBookings({ status: "waiting" });

    expect(bookings).toHaveLength(1);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain("waiting");
  });

  it("filters by archived flag", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listBookings({ archived: true });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(true);
  });
});
