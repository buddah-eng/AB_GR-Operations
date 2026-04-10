/**
 * Tests for Equipment Logistics Service
 *
 * Covers:
 * - checkoutEquipment: success, not found, not available, invalid args
 * - returnEquipment: success, not checked out, overdue, not found
 * - getOverdueEquipment: with results, empty
 * - listEquipmentByVenue: with results, empty
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
}));

// --- Import module under test ---

import {
  checkoutEquipment,
  returnEquipment,
  getOverdueEquipment,
  listEquipmentByVenue,
  rowToEquipment,
} from "./equipment";

// --- Fixtures ---

function equipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    name: "Projector A",
    category: "av",
    venue_id: "venue-1",
    status: "available",
    checked_out_to: null,
    checked_out_at: null,
    due_back_at: null,
    serial_number: "SN-001",
    properties: {},
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    archived: false,
    ...overrides,
  };
}

const FUTURE_DATE = new Date(Date.now() + 86400000).toISOString();
const PAST_DATE = new Date(Date.now() - 86400000).toISOString();

// --- Tests ---

describe("rowToEquipment", () => {
  it("maps a database row to an Equipment object", () => {
    const row = equipmentRow();
    const eq = rowToEquipment(row);

    expect(eq.id).toBe("eq-1");
    expect(eq.name).toBe("Projector A");
    expect(eq.category).toBe("av");
    expect(eq.status).toBe("available");
    expect(eq.checked_out_to).toBeNull();
    expect(eq.serial_number).toBe("SN-001");
  });
});

describe("checkoutEquipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks out available equipment", async () => {
    const row = equipmentRow();
    const checkedOutRow = equipmentRow({
      status: "checked_out",
      checked_out_to: "staff-1",
      checked_out_at: new Date(),
      due_back_at: new Date(FUTURE_DATE),
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [checkedOutRow] });

    const result = await checkoutEquipment("eq-1", "staff-1", FUTURE_DATE);

    expect(result.success).toBe(true);
    expect(result.equipment.status).toBe("checked_out");
    expect(result.equipment.checked_out_to).toBe("staff-1");
  });

  it("throws when equipment is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      checkoutEquipment("nonexistent", "staff-1", FUTURE_DATE)
    ).rejects.toThrow("Equipment not found: nonexistent");
  });

  it("throws when equipment is not available", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [equipmentRow({ status: "checked_out", name: "Projector A" })],
    });

    await expect(
      checkoutEquipment("eq-1", "staff-1", FUTURE_DATE)
    ).rejects.toThrow('Equipment "Projector A" is not available');
  });

  it("throws when dueBackAt is in the past", async () => {
    await expect(
      checkoutEquipment("eq-1", "staff-1", PAST_DATE)
    ).rejects.toThrow("dueBackAt must be in the future");
  });

  it("throws when required parameters are missing", async () => {
    await expect(
      checkoutEquipment("", "staff-1", FUTURE_DATE)
    ).rejects.toThrow("equipmentId, staffId, and dueBackAt are required");

    await expect(
      checkoutEquipment("eq-1", "", FUTURE_DATE)
    ).rejects.toThrow("equipmentId, staffId, and dueBackAt are required");

    await expect(
      checkoutEquipment("eq-1", "staff-1", "")
    ).rejects.toThrow("equipmentId, staffId, and dueBackAt are required");
  });
});

describe("returnEquipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns checked out equipment", async () => {
    const checkedOutRow = equipmentRow({
      status: "checked_out",
      checked_out_to: "staff-1",
      due_back_at: new Date(FUTURE_DATE),
    });
    const returnedRow = equipmentRow({
      status: "available",
      checked_out_to: null,
      due_back_at: null,
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [checkedOutRow] })
      .mockResolvedValueOnce({ rows: [returnedRow] });

    const result = await returnEquipment("eq-1");

    expect(result.success).toBe(true);
    expect(result.equipment.status).toBe("available");
    expect(result.wasOverdue).toBe(false);
  });

  it("flags overdue returns", async () => {
    const overdueRow = equipmentRow({
      status: "checked_out",
      checked_out_to: "staff-1",
      due_back_at: new Date(PAST_DATE),
    });
    const returnedRow = equipmentRow({ status: "available" });

    mockQuery
      .mockResolvedValueOnce({ rows: [overdueRow] })
      .mockResolvedValueOnce({ rows: [returnedRow] });

    const result = await returnEquipment("eq-1");

    expect(result.success).toBe(true);
    expect(result.wasOverdue).toBe(true);
  });

  it("throws when equipment is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(returnEquipment("nonexistent")).rejects.toThrow(
      "Equipment not found: nonexistent"
    );
  });

  it("throws when equipment is not checked out", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [equipmentRow({ status: "available", name: "Projector A" })],
    });

    await expect(returnEquipment("eq-1")).rejects.toThrow(
      'Equipment "Projector A" is not checked out'
    );
  });

  it("throws when equipmentId is empty", async () => {
    await expect(returnEquipment("")).rejects.toThrow(
      "equipmentId is required"
    );
  });
});

describe("getOverdueEquipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overdue equipment", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        equipmentRow({
          id: "eq-1",
          status: "checked_out",
          due_back_at: new Date(PAST_DATE),
        }),
        equipmentRow({
          id: "eq-2",
          status: "checked_out",
          due_back_at: new Date(PAST_DATE),
        }),
      ],
    });

    const result = await getOverdueEquipment();

    expect(result).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("due_back_at < now()")
    );
  });

  it("returns empty array when nothing is overdue", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getOverdueEquipment();

    expect(result).toHaveLength(0);
  });
});

describe("listEquipmentByVenue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns equipment assigned to venue", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        equipmentRow({ venue_id: "venue-1" }),
        equipmentRow({ id: "eq-2", venue_id: "venue-1" }),
      ],
    });

    const result = await listEquipmentByVenue("venue-1");

    expect(result).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("venue_id = $1"),
      ["venue-1"]
    );
  });

  it("returns empty array when no equipment at venue", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listEquipmentByVenue("venue-empty");

    expect(result).toHaveLength(0);
  });
});
