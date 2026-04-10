/**
 * Tests for Pairings Service
 *
 * Covers:
 * - assignStaff
 * - removeStaff
 * - getGuestPairings
 * - getStaffAssignments
 * - checkCoverage
 * - getPairingById
 * - rowToPairingRecord mapping
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
  assignStaff,
  removeStaff,
  getGuestPairings,
  getStaffAssignments,
  checkCoverage,
  getPairingById,
  rowToPairingRecord,
} from "./pairings";

// --- Test data ---

const makePairingRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "pairing-1",
  guest_id: "guest-1",
  staff_id: "staff-1",
  role: "liaison",
  properties: {},
  created_at: new Date("2024-01-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

// --- Tests ---

describe("Pairings Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToPairingRecord", () => {
    it("maps a database row to a PairingRecord", () => {
      const row = makePairingRow();
      const record = rowToPairingRecord(row);

      expect(record.id).toBe("pairing-1");
      expect(record.guest_id).toBe("guest-1");
      expect(record.staff_id).toBe("staff-1");
      expect(record.role).toBe("liaison");
      expect(record.archived).toBe(false);
    });

    it("converts Date objects to ISO strings", () => {
      const row = makePairingRow({
        created_at: new Date("2024-05-20T09:00:00Z"),
      });
      const record = rowToPairingRecord(row);

      expect(record.created_at).toBe("2024-05-20T09:00:00.000Z");
    });

    it("handles missing properties with defaults", () => {
      const row = { id: "p-2", guest_id: "g-1", staff_id: "s-1", role: "interpreter" };
      const record = rowToPairingRecord(row);

      expect(record.properties).toEqual({});
      expect(record.archived).toBe(false);
    });
  });

  describe("assignStaff", () => {
    it("creates and returns a pairing record", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePairingRow()] });

      const pairing = await assignStaff("guest-1", "staff-1", "liaison");

      expect(pairing.guest_id).toBe("guest-1");
      expect(pairing.staff_id).toBe("staff-1");
      expect(pairing.role).toBe("liaison");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO pairings"),
        ["guest-1", "staff-1", "liaison"]
      );
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [makePairingRow()] }),
      };

      const pairing = await assignStaff("guest-1", "staff-1", "liaison", mockClient as never);

      expect(pairing).toBeDefined();
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe("removeStaff", () => {
    it("returns true when pairing is archived", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await removeStaff("pairing-1");

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET archived = true"),
        ["pairing-1"]
      );
    });

    it("returns false when pairing not found", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await removeStaff("nonexistent");

      expect(result).toBe(false);
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }),
      };

      const result = await removeStaff("pairing-1", mockClient as never);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe("getGuestPairings", () => {
    it("returns pairings with staff details", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "pairing-1", guest_id: "guest-1", staff_id: "staff-1",
            role: "liaison", properties: {}, created_at: new Date("2024-01-01T00:00:00Z"),
            staff_name: "Jane Doe", staff_email: "jane@example.com",
          },
          {
            id: "pairing-2", guest_id: "guest-1", staff_id: "staff-2",
            role: "interpreter", properties: {}, created_at: new Date("2024-01-02T00:00:00Z"),
            staff_name: "Bob Tanaka", staff_email: "bob@example.com",
          },
        ],
      });

      const pairings = await getGuestPairings("guest-1");

      expect(pairings).toHaveLength(2);
      expect(pairings[0].staff_name).toBe("Jane Doe");
      expect(pairings[1].role).toBe("interpreter");
    });

    it("returns empty array when no pairings exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const pairings = await getGuestPairings("guest-no-pairings");

      expect(pairings).toHaveLength(0);
    });

    it("handles null staff_email", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "pairing-1", guest_id: "guest-1", staff_id: "staff-1",
          role: "liaison", properties: {}, created_at: new Date("2024-01-01T00:00:00Z"),
          staff_name: "No Email", staff_email: null,
        }],
      });

      const pairings = await getGuestPairings("guest-1");

      expect(pairings[0].staff_email).toBeNull();
    });
  });

  describe("getStaffAssignments", () => {
    it("returns assignments with guest details", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "pairing-1", guest_id: "guest-1", staff_id: "staff-1",
            role: "liaison", properties: {}, created_at: new Date("2024-01-01T00:00:00Z"),
            guest_name: "Hideo Kojima", guest_status: "confirmed",
          },
        ],
      });

      const assignments = await getStaffAssignments("staff-1");

      expect(assignments).toHaveLength(1);
      expect(assignments[0].guest_name).toBe("Hideo Kojima");
      expect(assignments[0].guest_status).toBe("confirmed");
    });

    it("returns empty array when no assignments exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const assignments = await getStaffAssignments("staff-no-assignments");

      expect(assignments).toHaveLength(0);
    });
  });

  describe("checkCoverage", () => {
    it("reports full coverage when all roles are filled", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: "liaison" }, { role: "interpreter" }],
      });

      const coverage = await checkCoverage("guest-1", ["liaison", "interpreter"]);

      expect(coverage.isFullyCovered).toBe(true);
      expect(coverage.filledRoles).toEqual(["liaison", "interpreter"]);
      expect(coverage.missingRoles).toEqual([]);
    });

    it("reports missing roles when coverage is incomplete", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: "liaison" }],
      });

      const coverage = await checkCoverage("guest-1", ["liaison", "interpreter", "backup"]);

      expect(coverage.isFullyCovered).toBe(false);
      expect(coverage.filledRoles).toEqual(["liaison"]);
      expect(coverage.missingRoles).toEqual(["interpreter", "backup"]);
    });

    it("reports all missing when no pairings exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const coverage = await checkCoverage("guest-1", ["liaison"]);

      expect(coverage.isFullyCovered).toBe(false);
      expect(coverage.filledRoles).toEqual([]);
      expect(coverage.missingRoles).toEqual(["liaison"]);
    });

    it("includes guestId and requiredRoles in result", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const coverage = await checkCoverage("guest-42", ["liaison", "interpreter"]);

      expect(coverage.guestId).toBe("guest-42");
      expect(coverage.requiredRoles).toEqual(["liaison", "interpreter"]);
    });
  });

  describe("getPairingById", () => {
    it("returns a pairing when found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePairingRow()] });

      const pairing = await getPairingById("pairing-1");

      expect(pairing).not.toBeNull();
      expect(pairing!.id).toBe("pairing-1");
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const pairing = await getPairingById("nonexistent");

      expect(pairing).toBeNull();
    });
  });
});
