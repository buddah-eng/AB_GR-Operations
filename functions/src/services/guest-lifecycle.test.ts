/**
 * Tests for Guest Lifecycle Service
 *
 * Covers:
 * - Valid/invalid status transitions
 * - transitionGuestStatus
 * - getGuestsByStatus
 * - getGuestById
 * - getGuestSummary
 * - createGuest
 * - rowToGuestRecord mapping
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
  isValidTransition,
  getValidTransitions,
  transitionGuestStatus,
  getGuestsByStatus,
  getGuestById,
  getGuestSummary,
  createGuest,
  rowToGuestRecord,
} from "./guest-lifecycle";

// --- Test data ---

const makeGuestRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "guest-1",
  name: "Hideo Kojima",
  type: "JP",
  department: "guest-relations",
  status: "draft",
  company: "Kojima Productions",
  properties: { vip: true },
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-06-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

// --- Tests ---

describe("Guest Lifecycle Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToGuestRecord", () => {
    it("maps a database row to a GuestRecord", () => {
      const row = makeGuestRow();
      const record = rowToGuestRecord(row);

      expect(record.id).toBe("guest-1");
      expect(record.name).toBe("Hideo Kojima");
      expect(record.type).toBe("JP");
      expect(record.department).toBe("guest-relations");
      expect(record.status).toBe("draft");
      expect(record.company).toBe("Kojima Productions");
    });

    it("handles null and missing fields with defaults", () => {
      const row = { id: "guest-2", name: "Unknown" };
      const record = rowToGuestRecord(row);

      expect(record.type).toBeNull();
      expect(record.department).toBeNull();
      expect(record.status).toBe("draft");
      expect(record.company).toBeNull();
      expect(record.properties).toEqual({});
      expect(record.archived).toBe(false);
    });

    it("converts Date objects to ISO strings", () => {
      const row = makeGuestRow({
        created_at: new Date("2024-03-15T12:00:00Z"),
        updated_at: new Date("2024-03-16T12:00:00Z"),
      });
      const record = rowToGuestRecord(row);

      expect(record.created_at).toBe("2024-03-15T12:00:00.000Z");
      expect(record.updated_at).toBe("2024-03-16T12:00:00.000Z");
    });
  });

  describe("isValidTransition", () => {
    it("allows draft -> invited", () => {
      expect(isValidTransition("draft", "invited")).toBe(true);
    });

    it("allows invited -> confirmed", () => {
      expect(isValidTransition("invited", "confirmed")).toBe(true);
    });

    it("allows invited -> declined", () => {
      expect(isValidTransition("invited", "declined")).toBe(true);
    });

    it("allows confirmed -> travel_arranged", () => {
      expect(isValidTransition("confirmed", "travel_arranged")).toBe(true);
    });

    it("allows travel_arranged -> arrived", () => {
      expect(isValidTransition("travel_arranged", "arrived")).toBe(true);
    });

    it("allows arrived -> attending", () => {
      expect(isValidTransition("arrived", "attending")).toBe(true);
    });

    it("allows attending -> departed", () => {
      expect(isValidTransition("attending", "departed")).toBe(true);
    });

    it("allows any active status -> canceled", () => {
      expect(isValidTransition("draft", "canceled")).toBe(true);
      expect(isValidTransition("invited", "canceled")).toBe(true);
      expect(isValidTransition("confirmed", "canceled")).toBe(true);
      expect(isValidTransition("travel_arranged", "canceled")).toBe(true);
      expect(isValidTransition("arrived", "canceled")).toBe(true);
      expect(isValidTransition("attending", "canceled")).toBe(true);
    });

    it("blocks draft -> arrived (skipping steps)", () => {
      expect(isValidTransition("draft", "arrived")).toBe(false);
    });

    it("blocks declined -> confirmed", () => {
      expect(isValidTransition("declined", "confirmed")).toBe(false);
    });

    it("blocks departed -> any", () => {
      expect(isValidTransition("departed", "draft")).toBe(false);
      expect(isValidTransition("departed", "attending")).toBe(false);
    });

    it("blocks canceled -> any", () => {
      expect(isValidTransition("canceled", "draft")).toBe(false);
      expect(isValidTransition("canceled", "invited")).toBe(false);
    });

    it("returns false for unknown status", () => {
      expect(isValidTransition("unknown", "draft")).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns valid transitions for draft", () => {
      expect(getValidTransitions("draft")).toEqual(["invited", "canceled"]);
    });

    it("returns valid transitions for invited", () => {
      expect(getValidTransitions("invited")).toEqual(["confirmed", "declined", "canceled"]);
    });

    it("returns empty for terminal states", () => {
      expect(getValidTransitions("departed")).toEqual([]);
      expect(getValidTransitions("declined")).toEqual([]);
      expect(getValidTransitions("canceled")).toEqual([]);
    });

    it("returns empty for unknown status", () => {
      expect(getValidTransitions("nonexistent")).toEqual([]);
    });
  });

  describe("transitionGuestStatus", () => {
    it("transitions guest to a valid status", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeGuestRow({ status: "draft" })] })
        .mockResolvedValueOnce({ rows: [makeGuestRow({ status: "invited" })] });

      const guest = await transitionGuestStatus("guest-1", "invited", "admin@test.com");

      expect(guest.status).toBe("invited");
    });

    it("throws for invalid transition", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeGuestRow({ status: "draft" })] });

      await expect(
        transitionGuestStatus("guest-1", "arrived", "admin@test.com")
      ).rejects.toThrow("Invalid status transition: draft -> arrived");
    });

    it("throws when guest not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        transitionGuestStatus("nonexistent", "invited", "admin@test.com")
      ).rejects.toThrow("Guest not found: nonexistent");
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [makeGuestRow({ status: "invited" })] })
          .mockResolvedValueOnce({ rows: [makeGuestRow({ status: "confirmed" })] }),
      };

      const guest = await transitionGuestStatus("guest-1", "confirmed", "admin@test.com", mockClient as never);

      expect(guest.status).toBe("confirmed");
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe("getGuestsByStatus", () => {
    it("returns guests matching the status", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeGuestRow(), makeGuestRow({ id: "guest-2", name: "Guest 2" })],
      });

      const guests = await getGuestsByStatus("draft");

      expect(guests).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ["draft"]
      );
    });

    it("returns empty array when no guests match", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const guests = await getGuestsByStatus("departed");

      expect(guests).toHaveLength(0);
    });
  });

  describe("getGuestById", () => {
    it("returns a guest record when found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeGuestRow()] });

      const guest = await getGuestById("guest-1");

      expect(guest).not.toBeNull();
      expect(guest!.id).toBe("guest-1");
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const guest = await getGuestById("nonexistent");

      expect(guest).toBeNull();
    });
  });

  describe("getGuestSummary", () => {
    it("returns summary with prep, pairing, and schedule counts", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeGuestRow()] }) // getGuestById
        .mockResolvedValueOnce({ rows: [{ total: "10", complete: "3" }] }) // prep
        .mockResolvedValueOnce({ rows: [{ cnt: "2" }] }) // pairings
        .mockResolvedValueOnce({ rows: [{ cnt: "5" }] }); // schedule

      const summary = await getGuestSummary("guest-1");

      expect(summary).not.toBeNull();
      expect(summary!.guest.id).toBe("guest-1");
      expect(summary!.prepTotal).toBe(10);
      expect(summary!.prepComplete).toBe(3);
      expect(summary!.prepCompletionPercent).toBe(30);
      expect(summary!.pairingCount).toBe(2);
      expect(summary!.scheduleCount).toBe(5);
    });

    it("returns 0% when no prep items exist", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeGuestRow()] })
        .mockResolvedValueOnce({ rows: [{ total: "0", complete: "0" }] })
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] })
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

      const summary = await getGuestSummary("guest-1");

      expect(summary!.prepCompletionPercent).toBe(0);
      expect(summary!.prepTotal).toBe(0);
    });

    it("returns null when guest not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const summary = await getGuestSummary("nonexistent");

      expect(summary).toBeNull();
    });
  });

  describe("createGuest", () => {
    it("creates and returns a guest record", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeGuestRow()] });

      const guest = await createGuest({ name: "Hideo Kojima", type: "JP" });

      expect(guest.name).toBe("Hideo Kojima");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO guests"),
        expect.arrayContaining(["Hideo Kojima"])
      );
    });

    it("uses null defaults for optional fields", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeGuestRow()] });

      await createGuest({ name: "Bob" });

      const params = mockQuery.mock.calls[0][1];
      expect(params[1]).toBeNull(); // type
      expect(params[2]).toBeNull(); // department
      expect(params[3]).toBeNull(); // company
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [makeGuestRow()] }),
      };

      const guest = await createGuest({ name: "Test" }, mockClient as never);

      expect(guest).toBeDefined();
      expect(mockClient.query).toHaveBeenCalled();
    });
  });
});
