/**
 * Tests for Prep Tracking Service
 *
 * Covers:
 * - createPrepItems (batch insert)
 * - updatePrepItemStatus
 * - getCompletionRate
 * - getPrepItemsByGuest
 * - getPrepItemById
 * - getOverdueItems
 * - getCompletionByDepartment
 * - markOverdueItems
 * - rowToPrepItemRecord mapping
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
  createPrepItems,
  updatePrepItemStatus,
  getCompletionRate,
  getPrepItemsByGuest,
  getPrepItemById,
  getOverdueItems,
  getCompletionByDepartment,
  markOverdueItems,
  rowToPrepItemRecord,
} from "./prep-tracking";

// --- Test data ---

const makePrepRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "prep-1",
  name: "Confirm travel details",
  guest_id: "guest-1",
  status: "incomplete",
  due_date: new Date("2024-07-01"),
  properties: { category: "travel" },
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-06-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

// --- Tests ---

describe("Prep Tracking Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToPrepItemRecord", () => {
    it("maps a database row to a PrepItemRecord", () => {
      const row = makePrepRow();
      const record = rowToPrepItemRecord(row);

      expect(record.id).toBe("prep-1");
      expect(record.name).toBe("Confirm travel details");
      expect(record.guest_id).toBe("guest-1");
      expect(record.status).toBe("incomplete");
      expect(record.due_date).toBe("2024-07-01");
    });

    it("handles null and missing fields with defaults", () => {
      const row = { id: "prep-2", name: "Test" };
      const record = rowToPrepItemRecord(row);

      expect(record.guest_id).toBeNull();
      expect(record.status).toBe("incomplete");
      expect(record.due_date).toBeNull();
      expect(record.properties).toEqual({});
      expect(record.archived).toBe(false);
    });

    it("converts Date objects to ISO strings for timestamps", () => {
      const row = makePrepRow({
        created_at: new Date("2024-03-15T12:00:00Z"),
        updated_at: new Date("2024-03-16T12:00:00Z"),
      });
      const record = rowToPrepItemRecord(row);

      expect(record.created_at).toBe("2024-03-15T12:00:00.000Z");
      expect(record.updated_at).toBe("2024-03-16T12:00:00.000Z");
    });

    it("converts Date due_date to date-only string", () => {
      const row = makePrepRow({ due_date: new Date("2024-12-25T10:00:00Z") });
      const record = rowToPrepItemRecord(row);

      expect(record.due_date).toBe("2024-12-25");
    });
  });

  describe("createPrepItems", () => {
    it("batch creates items and returns all records", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makePrepRow({ id: "prep-1", name: "Visa check" })] })
        .mockResolvedValueOnce({ rows: [makePrepRow({ id: "prep-2", name: "Flight booking" })] })
        .mockResolvedValueOnce({ rows: [makePrepRow({ id: "prep-3", name: "Hotel" })] });

      const items = await createPrepItems("guest-1", [
        { name: "Visa check", category: "travel" },
        { name: "Flight booking", category: "travel" },
        { name: "Hotel", category: "logistics" },
      ]);

      expect(items).toHaveLength(3);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it("returns empty array for empty template", async () => {
      const items = await createPrepItems("guest-1", []);

      expect(items).toHaveLength(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("includes optional fields in properties", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePrepRow()] });

      await createPrepItems("guest-1", [
        {
          name: "Test",
          category: "travel",
          assigned_to: "staff-1",
          auto_complete_event: "guest_form.submitted",
        },
      ]);

      const params = mockQuery.mock.calls[0][1];
      const properties = JSON.parse(params[3] as string);
      expect(properties.category).toBe("travel");
      expect(properties.assigned_to).toBe("staff-1");
      expect(properties.auto_complete_event).toBe("guest_form.submitted");
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [makePrepRow()] }),
      };

      const items = await createPrepItems("guest-1", [{ name: "Test" }], mockClient as never);

      expect(items).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalled();
    });

    it("passes due_date to query params", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePrepRow()] });

      await createPrepItems("guest-1", [
        { name: "Test", due_date: "2024-08-01" },
      ]);

      const params = mockQuery.mock.calls[0][1];
      expect(params[2]).toBe("2024-08-01");
    });
  });

  describe("updatePrepItemStatus", () => {
    it("updates and returns the prep item", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makePrepRow({ status: "complete" })],
      });

      const item = await updatePrepItemStatus("prep-1", "complete");

      expect(item).not.toBeNull();
      expect(item!.status).toBe("complete");
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const item = await updatePrepItemStatus("nonexistent", "complete");

      expect(item).toBeNull();
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [makePrepRow({ status: "overdue" })] }),
      };

      const item = await updatePrepItemStatus("prep-1", "overdue", mockClient as never);

      expect(item).not.toBeNull();
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe("getCompletionRate", () => {
    it("calculates correct completion percentage", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "10", complete: "7" }],
      });

      const rate = await getCompletionRate("guest-1");

      expect(rate.total).toBe(10);
      expect(rate.complete).toBe(7);
      expect(rate.percent).toBe(70);
    });

    it("returns 0% when no items exist", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "0", complete: "0" }],
      });

      const rate = await getCompletionRate("guest-1");

      expect(rate.percent).toBe(0);
    });

    it("rounds to nearest integer", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: "3", complete: "1" }],
      });

      const rate = await getCompletionRate("guest-1");

      expect(rate.percent).toBe(33);
    });
  });

  describe("getPrepItemsByGuest", () => {
    it("returns all prep items for a guest", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makePrepRow(), makePrepRow({ id: "prep-2", name: "Hotel" })],
      });

      const items = await getPrepItemsByGuest("guest-1");

      expect(items).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("guest_id = $1"),
        ["guest-1"]
      );
    });

    it("returns empty array when no items exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const items = await getPrepItemsByGuest("guest-no-items");

      expect(items).toHaveLength(0);
    });
  });

  describe("getPrepItemById", () => {
    it("returns a prep item when found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePrepRow()] });

      const item = await getPrepItemById("prep-1");

      expect(item).not.toBeNull();
      expect(item!.id).toBe("prep-1");
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const item = await getPrepItemById("nonexistent");

      expect(item).toBeNull();
    });
  });

  describe("getOverdueItems", () => {
    it("returns overdue items ordered by due_date", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePrepRow({ id: "prep-1", due_date: new Date("2024-01-01") }),
          makePrepRow({ id: "prep-2", due_date: new Date("2024-02-01") }),
        ],
      });

      const items = await getOverdueItems();

      expect(items).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("due_date < CURRENT_DATE")
      );
    });

    it("returns empty array when no overdue items", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const items = await getOverdueItems();

      expect(items).toHaveLength(0);
    });
  });

  describe("getCompletionByDepartment", () => {
    it("returns completion rates grouped by department", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { department: "guest-relations", total: "20", complete: "15" },
          { department: "operations", total: "10", complete: "3" },
        ],
      });

      const result = await getCompletionByDepartment();

      expect(result).toHaveLength(2);
      expect(result[0].department).toBe("guest-relations");
      expect(result[0].percent).toBe(75);
      expect(result[1].department).toBe("operations");
      expect(result[1].percent).toBe(30);
    });

    it("handles null department as 'unassigned'", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ department: null, total: "5", complete: "2" }],
      });

      const result = await getCompletionByDepartment();

      expect(result[0].department).toBe("unassigned");
    });

    it("returns empty array when no data", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getCompletionByDepartment();

      expect(result).toHaveLength(0);
    });
  });

  describe("markOverdueItems", () => {
    it("returns count of updated items", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 5 });

      const count = await markOverdueItems();

      expect(count).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'overdue'")
      );
    });

    it("returns 0 when no items to update", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const count = await markOverdueItems();

      expect(count).toBe(0);
    });

    it("works with a PoolClient", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rowCount: 3 }),
      };

      const count = await markOverdueItems(mockClient as never);

      expect(count).toBe(3);
      expect(mockClient.query).toHaveBeenCalled();
    });
  });
});
