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
}));

// --- Import module under test ---

import {
  createBooking,
  transitionBookingStatus,
  getBookingsForGuest,
  getActiveDriverBookings,
} from "./transport";

// --- Fixtures ---

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    guest_id: "g-1",
    booking_type: "arrival",
    status: "requested",
    pickup_location: "Airport",
    dropoff_location: "Hotel",
    scheduled_time: "2026-04-10T14:00:00Z",
    driver_name: "John",
    driver_phone: "+1234567890",
    vehicle_info: "Black SUV",
    flight_number: "AB123",
    flight_status: null,
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived: false,
    ...overrides,
  };
}

describe("Transport Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- createBooking ---

  describe("createBooking", () => {
    it("inserts a new booking and returns it", async () => {
      const booking = makeBooking();
      mockQuery.mockResolvedValueOnce({ rows: [booking], rowCount: 1 });

      const result = await createBooking("g-1", {
        booking_type: "arrival",
        pickup_location: "Airport",
        dropoff_location: "Hotel",
        scheduled_time: "2026-04-10T14:00:00Z",
        driver_name: "John",
      });

      expect(result.guest_id).toBe("g-1");
      expect(result.booking_type).toBe("arrival");
      expect(result.status).toBe("requested");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO transport_bookings"),
        expect.arrayContaining(["g-1", "arrival"])
      );
    });
  });

  // --- transitionBookingStatus ---

  describe("transitionBookingStatus", () => {
    it("succeeds for a valid transition (requested → confirmed)", async () => {
      const current = makeBooking({ status: "requested" });
      const updated = makeBooking({ status: "confirmed" });

      mockQuery
        .mockResolvedValueOnce({ rows: [current], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await transitionBookingStatus("b-1", "confirmed");

      expect(result.status).toBe("confirmed");
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it("succeeds for confirmed → dispatched → waiting → picked_up → dropped_off", async () => {
      const transitions = [
        ["confirmed", "dispatched"],
        ["dispatched", "waiting"],
        ["waiting", "picked_up"],
        ["picked_up", "dropped_off"],
      ] as const;

      for (const [from, to] of transitions) {
        mockQuery
          .mockResolvedValueOnce({ rows: [makeBooking({ status: from })], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [makeBooking({ status: to })], rowCount: 1 });

        const result = await transitionBookingStatus("b-1", to);
        expect(result.status).toBe(to);
      }
    });

    it("fails for an invalid transition (requested → dropped_off)", async () => {
      const current = makeBooking({ status: "requested" });
      mockQuery.mockResolvedValueOnce({ rows: [current], rowCount: 1 });

      await expect(
        transitionBookingStatus("b-1", "dropped_off")
      ).rejects.toThrow("Invalid booking transition: requested → dropped_off");
    });

    it("fails for a backward transition (confirmed → requested)", async () => {
      const current = makeBooking({ status: "confirmed" });
      mockQuery.mockResolvedValueOnce({ rows: [current], rowCount: 1 });

      await expect(
        transitionBookingStatus("b-1", "requested")
      ).rejects.toThrow("Invalid booking transition: confirmed → requested");
    });

    it("throws when booking is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        transitionBookingStatus("nonexistent", "confirmed")
      ).rejects.toThrow("Booking not found: nonexistent");
    });

    it("allows cancellation from most active statuses", async () => {
      const cancellableStatuses = ["requested", "confirmed", "dispatched", "waiting"] as const;

      for (const status of cancellableStatuses) {
        mockQuery
          .mockResolvedValueOnce({ rows: [makeBooking({ status })], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [makeBooking({ status: "cancelled" })], rowCount: 1 });

        const result = await transitionBookingStatus("b-1", "cancelled");
        expect(result.status).toBe("cancelled");
      }
    });
  });

  // --- getBookingsForGuest ---

  describe("getBookingsForGuest", () => {
    it("returns all non-archived bookings for a guest", async () => {
      const bookings = [
        makeBooking({ id: "b-1" }),
        makeBooking({ id: "b-2", booking_type: "departure" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: bookings, rowCount: 2 });

      const result = await getBookingsForGuest("g-1");

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE guest_id = $1"),
        ["g-1"]
      );
    });

    it("returns empty array when guest has no bookings", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getBookingsForGuest("g-1");

      expect(result).toHaveLength(0);
    });
  });

  // --- getActiveDriverBookings ---

  describe("getActiveDriverBookings", () => {
    it("returns active bookings for a driver", async () => {
      const bookings = [
        makeBooking({ status: "confirmed", driver_name: "John" }),
        makeBooking({ id: "b-2", status: "dispatched", driver_name: "John" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: bookings, rowCount: 2 });

      const result = await getActiveDriverBookings("John");

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("driver_name = $1"),
        ["John"]
      );
    });
  });
});
