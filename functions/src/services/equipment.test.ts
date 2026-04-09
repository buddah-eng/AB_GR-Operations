import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkoutEquipment,
  returnEquipment,
  getOverdueEquipment,
  listEquipmentByVenue,
} from "./equipment";
import type { Equipment } from "./equipment";

vi.mock("../db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "equip-001",
    name: "Wireless Mic",
    category: "audio",
    venue_id: "venue-001",
    status: "available",
    checked_out_to: null,
    checked_out_at: null,
    due_back_at: null,
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived: false,
    ...overrides,
  };
}

describe("Equipment Service", () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { query } = await import("../db/client");
    mockQuery = vi.mocked(query);
  });

  // --- checkoutEquipment ---

  describe("checkoutEquipment", () => {
    it("checks out available equipment and returns updated record", async () => {
      const checkedOut = makeEquipment({
        status: "checked_out",
        checked_out_to: "staff-001",
        checked_out_at: "2026-04-08T10:00:00Z",
        due_back_at: "2026-04-08T18:00:00Z",
      });
      mockQuery.mockResolvedValueOnce({ rows: [checkedOut], rowCount: 1 });

      const result = await checkoutEquipment("equip-001", "staff-001", "2026-04-08T18:00:00Z");

      expect(result).toEqual(checkedOut);
      expect(result?.status).toBe("checked_out");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'checked_out'");
      expect(sql).toContain("status = 'available'"); // WHERE condition
    });

    it("returns null when equipment is not available", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await checkoutEquipment("equip-001", "staff-001", "2026-04-08T18:00:00Z");

      expect(result).toBeNull();
    });
  });

  // --- returnEquipment ---

  describe("returnEquipment", () => {
    it("returns equipment and resets checkout fields", async () => {
      const returned = makeEquipment({
        status: "available",
        checked_out_to: null,
        checked_out_at: null,
        due_back_at: null,
      });
      mockQuery.mockResolvedValueOnce({ rows: [returned], rowCount: 1 });

      const result = await returnEquipment("equip-001");

      expect(result).toEqual(returned);
      expect(result?.status).toBe("available");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("checked_out_to = NULL");
      expect(sql).toContain("due_back_at = NULL");
    });

    it("returns null when equipment is not checked out", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await returnEquipment("equip-001");

      expect(result).toBeNull();
    });
  });

  // --- getOverdueEquipment ---

  describe("getOverdueEquipment", () => {
    it("returns equipment past due_back_at", async () => {
      const overdue = [
        makeEquipment({
          id: "equip-002",
          status: "checked_out",
          due_back_at: "2026-04-07T12:00:00Z",
        }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: overdue, rowCount: 1 });

      const result = await getOverdueEquipment();

      expect(result).toHaveLength(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("due_back_at < now()");
      expect(sql).toContain("status = 'checked_out'");
    });
  });

  // --- listEquipmentByVenue ---

  describe("listEquipmentByVenue", () => {
    it("returns equipment for the specified venue", async () => {
      const venueEquipment = [
        makeEquipment({ venue_id: "venue-001" }),
        makeEquipment({ id: "equip-003", name: "Projector", venue_id: "venue-001" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: venueEquipment, rowCount: 2 });

      const result = await listEquipmentByVenue("venue-001");

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("venue_id = $1"),
        ["venue-001"]
      );
    });

    it("returns empty array when no equipment in venue", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await listEquipmentByVenue("empty-venue");

      expect(result).toEqual([]);
    });
  });
});
