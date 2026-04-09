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
  assignStaff,
  removeStaff,
  getGuestPairings,
  getStaffAssignments,
  checkCoverage,
} from "./pairings";

// --- Fixtures ---

function makePairing(overrides: Record<string, unknown> = {}) {
  return {
    id: "pr-1",
    guest_id: "g-1",
    staff_id: "s-1",
    role: "liaison",
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    archived: false,
    ...overrides,
  };
}

describe("Pairings Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- assignStaff ---

  describe("assignStaff", () => {
    it("creates a new pairing and returns it", async () => {
      const pairing = makePairing();
      mockQuery.mockResolvedValueOnce({ rows: [pairing], rowCount: 1 });

      const result = await assignStaff("g-1", "s-1", "liaison");

      expect(result.guest_id).toBe("g-1");
      expect(result.staff_id).toBe("s-1");
      expect(result.role).toBe("liaison");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO pairings"),
        ["g-1", "s-1", "liaison"]
      );
    });

    it("inserts with the correct role value", async () => {
      const pairing = makePairing({ role: "security" });
      mockQuery.mockResolvedValueOnce({ rows: [pairing], rowCount: 1 });

      const result = await assignStaff("g-1", "s-2", "security");

      expect(result.role).toBe("security");
    });
  });

  // --- removeStaff ---

  describe("removeStaff", () => {
    it("archives the pairing and returns it", async () => {
      const archived = makePairing({ archived: true });
      mockQuery.mockResolvedValueOnce({ rows: [archived], rowCount: 1 });

      const result = await removeStaff("pr-1");

      expect(result.archived).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE pairings SET archived = true"),
        ["pr-1"]
      );
    });

    it("throws when pairing is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(removeStaff("nonexistent")).rejects.toThrow(
        "Pairing not found: nonexistent"
      );
    });
  });

  // --- getGuestPairings ---

  describe("getGuestPairings", () => {
    it("returns pairings with staff details", async () => {
      const pairings = [
        {
          ...makePairing(),
          staff_name: "Jane Doe",
          staff_email: "jane@test.com",
          staff_department: "protocol",
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: pairings, rowCount: 1 });

      const result = await getGuestPairings("g-1");

      expect(result).toHaveLength(1);
      expect(result[0].staff_name).toBe("Jane Doe");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("JOIN staff"),
        ["g-1"]
      );
    });
  });

  // --- getStaffAssignments ---

  describe("getStaffAssignments", () => {
    it("returns pairings with guest details", async () => {
      const pairings = [
        {
          ...makePairing(),
          guest_name: "VIP Guest",
          guest_status: "confirmed",
          guest_department: "operations",
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: pairings, rowCount: 1 });

      const result = await getStaffAssignments("s-1");

      expect(result).toHaveLength(1);
      expect(result[0].guest_name).toBe("VIP Guest");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("JOIN guests"),
        ["s-1"]
      );
    });
  });

  // --- checkCoverage ---

  describe("checkCoverage", () => {
    it("identifies filled and missing roles", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: "liaison" }, { role: "security" }],
        rowCount: 2,
      });

      const result = await checkCoverage("g-1", [
        "liaison",
        "security",
        "driver",
        "protocol",
      ]);

      expect(result.filled).toEqual(["liaison", "security"]);
      expect(result.missing).toEqual(["driver", "protocol"]);
    });

    it("returns all roles as missing when no pairings exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await checkCoverage("g-1", ["liaison", "driver"]);

      expect(result.filled).toEqual([]);
      expect(result.missing).toEqual(["liaison", "driver"]);
    });

    it("returns all roles as filled when all required roles are assigned", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: "liaison" }, { role: "driver" }],
        rowCount: 2,
      });

      const result = await checkCoverage("g-1", ["liaison", "driver"]);

      expect(result.filled).toEqual(["liaison", "driver"]);
      expect(result.missing).toEqual([]);
    });
  });
});
