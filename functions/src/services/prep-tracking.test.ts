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
  createPrepItems,
  updatePrepItemStatus,
  getCompletionRate,
  getOverdueItems,
  getCompletionByDepartment,
} from "./prep-tracking";

// --- Fixtures ---

function makePrepItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    name: "Brief document",
    guest_id: "g-1",
    status: "incomplete",
    due_date: "2026-04-15",
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived: false,
    ...overrides,
  };
}

describe("Prep Tracking Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- createPrepItems ---

  describe("createPrepItems", () => {
    it("batch inserts multiple prep items from template", async () => {
      const templates = [
        { name: "Bio document", due_date: "2026-05-01" },
        { name: "Photo", due_date: "2026-05-02" },
        { name: "Dietary form" },
      ];

      const inserted = templates.map((t, idx) =>
        makePrepItem({ id: `p-${idx}`, name: t.name, due_date: t.due_date ?? null })
      );

      mockQuery.mockResolvedValueOnce({ rows: inserted, rowCount: 3 });

      const result = await createPrepItems("g-1", templates);

      expect(result).toHaveLength(3);
      expect(mockQuery).toHaveBeenCalledOnce();

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO prep_items");
      expect(params).toHaveLength(12); // 3 items * 4 params each
    });

    it("returns empty array when template list is empty", async () => {
      const result = await createPrepItems("g-1", []);

      expect(result).toHaveLength(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("passes properties as JSON when provided", async () => {
      const templates = [
        { name: "Special item", properties: { category: "legal" } },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: [makePrepItem({ name: "Special item" })],
        rowCount: 1,
      });

      await createPrepItems("g-1", templates);

      const params = mockQuery.mock.calls[0][1];
      expect(params[3]).toBe(JSON.stringify({ category: "legal" }));
    });
  });

  // --- updatePrepItemStatus ---

  describe("updatePrepItemStatus", () => {
    it("updates status and returns the updated item", async () => {
      const updated = makePrepItem({ id: "p-1", status: "complete" });
      mockQuery.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await updatePrepItemStatus("p-1", "complete");

      expect(result.status).toBe("complete");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE prep_items SET status"),
        ["complete", "p-1"]
      );
    });

    it("throws when prep item is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        updatePrepItemStatus("nonexistent", "complete")
      ).rejects.toThrow("Prep item not found: nonexistent");
    });
  });

  // --- getCompletionRate ---

  describe("getCompletionRate", () => {
    it("calculates correct percentage", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "10", completed: "7" }],
        rowCount: 1,
      });

      const rate = await getCompletionRate("g-1");

      expect(rate.total).toBe(10);
      expect(rate.completed).toBe(7);
      expect(rate.percent).toBe(70);
    });

    it("returns 0% when there are no items", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "0", completed: "0" }],
        rowCount: 1,
      });

      const rate = await getCompletionRate("g-1");

      expect(rate.total).toBe(0);
      expect(rate.completed).toBe(0);
      expect(rate.percent).toBe(0);
    });

    it("rounds percentage to nearest integer", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "3", completed: "1" }],
        rowCount: 1,
      });

      const rate = await getCompletionRate("g-1");

      expect(rate.percent).toBe(33); // 33.33... rounds to 33
    });
  });

  // --- getOverdueItems ---

  describe("getOverdueItems", () => {
    it("returns items past due date that are not complete", async () => {
      const overdueItems = [
        makePrepItem({ id: "p-1", due_date: "2026-04-01", status: "incomplete" }),
        makePrepItem({ id: "p-2", due_date: "2026-04-05", status: "in_progress" }),
      ];

      mockQuery.mockResolvedValueOnce({ rows: overdueItems, rowCount: 2 });

      const result = await getOverdueItems();

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("due_date < CURRENT_DATE"),
        []
      );
    });

    it("returns empty array when nothing is overdue", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getOverdueItems();

      expect(result).toHaveLength(0);
    });
  });

  // --- getCompletionByDepartment ---

  describe("getCompletionByDepartment", () => {
    it("aggregates completion rates per department", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { department: "logistics", total: "8", completed: "6" },
          { department: "protocol", total: "5", completed: "5" },
        ],
        rowCount: 2,
      });

      const result = await getCompletionByDepartment();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        department: "logistics",
        total: 8,
        completed: 6,
        percent: 75,
      });
      expect(result[1]).toEqual({
        department: "protocol",
        total: 5,
        completed: 5,
        percent: 100,
      });
    });
  });
});
