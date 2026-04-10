/**
 * Tests for Scheduling Service
 *
 * Covers:
 * - detectRoomConflicts (with/without exclusion, edge cases)
 * - getScheduleForDateRange with filters
 * - getScheduleForGuest
 * - createScheduleEvent with conflict detection
 * - updateScheduleEvent with conflict re-check
 * - rowToScheduleEvent mapping
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
  detectRoomConflicts,
  getScheduleForDateRange,
  getScheduleForGuest,
  createScheduleEvent,
  updateScheduleEvent,
  rowToScheduleEvent,
} from "./scheduling";

// --- Test data ---

const makeEventRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "evt-1",
  name: "Morning Session",
  event_type: "panel",
  venue_id: "venue-1",
  start_time: new Date("2024-06-15T09:00:00Z"),
  end_time: new Date("2024-06-15T11:00:00Z"),
  status: "confirmed",
  properties: {},
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-06-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

// --- Tests ---

describe("Scheduling Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToScheduleEvent", () => {
    it("maps a database row to a ScheduleEvent", () => {
      const row = makeEventRow();
      const event = rowToScheduleEvent(row);

      expect(event.id).toBe("evt-1");
      expect(event.name).toBe("Morning Session");
      expect(event.event_type).toBe("panel");
      expect(event.venue_id).toBe("venue-1");
      expect(event.status).toBe("confirmed");
    });

    it("handles null fields with defaults", () => {
      const row = { id: "evt-2", name: "Quick" };
      const event = rowToScheduleEvent(row);

      expect(event.event_type).toBeNull();
      expect(event.venue_id).toBeNull();
      expect(event.start_time).toBeNull();
      expect(event.end_time).toBeNull();
      expect(event.status).toBe("draft");
    });

    it("converts Date objects to ISO strings", () => {
      const row = makeEventRow();
      const event = rowToScheduleEvent(row);

      expect(event.start_time).toBe("2024-06-15T09:00:00.000Z");
      expect(event.end_time).toBe("2024-06-15T11:00:00.000Z");
    });
  });

  describe("detectRoomConflicts", () => {
    it("returns conflicting events for a venue and time range", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: "evt-conflict", name: "Overlap Session", venue_id: "venue-1", start_time: new Date("2024-06-15T10:00:00Z"), end_time: new Date("2024-06-15T12:00:00Z") },
        ],
      });

      const conflicts = await detectRoomConflicts(
        "venue-1",
        "2024-06-15T09:00:00Z",
        "2024-06-15T11:00:00Z"
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflicting_event_id).toBe("evt-conflict");
    });

    it("returns empty array when no conflicts", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const conflicts = await detectRoomConflicts(
        "venue-1",
        "2024-06-15T09:00:00Z",
        "2024-06-15T11:00:00Z"
      );

      expect(conflicts).toHaveLength(0);
    });

    it("excludes a specific event when updating", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await detectRoomConflicts(
        "venue-1",
        "2024-06-15T09:00:00Z",
        "2024-06-15T11:00:00Z",
        "evt-1"
      );

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("id != $4");
      expect(mockQuery.mock.calls[0][1]).toContain("evt-1");
    });

    it("returns empty array when venueId is empty", async () => {
      const conflicts = await detectRoomConflicts("", "2024-06-15T09:00:00Z", "2024-06-15T11:00:00Z");

      expect(conflicts).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("throws on invalid date format", async () => {
      await expect(
        detectRoomConflicts("venue-1", "not-a-date", "2024-06-15T11:00:00Z")
      ).rejects.toThrow("Invalid date format");
    });

    it("throws when endTime is before startTime", async () => {
      await expect(
        detectRoomConflicts("venue-1", "2024-06-15T11:00:00Z", "2024-06-15T09:00:00Z")
      ).rejects.toThrow("endTime must be after startTime");
    });
  });

  describe("getScheduleForDateRange", () => {
    it("returns paginated results for a date range", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "2" }] })
        .mockResolvedValueOnce({ rows: [makeEventRow(), makeEventRow({ id: "evt-2", name: "Afternoon" })] });

      const result = await getScheduleForDateRange(
        "2024-06-15T00:00:00Z",
        "2024-06-15T23:59:59Z"
      );

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it("applies venue_id filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeEventRow()] });

      await getScheduleForDateRange("2024-06-15T00:00:00Z", "2024-06-15T23:59:59Z", {
        venue_id: "venue-1",
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain("venue_id = $");
    });

    it("applies event_type filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeEventRow()] });

      await getScheduleForDateRange("2024-06-15T00:00:00Z", "2024-06-15T23:59:59Z", {
        event_type: "panel",
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain("event_type = $");
    });

    it("applies status filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeEventRow()] });

      await getScheduleForDateRange("2024-06-15T00:00:00Z", "2024-06-15T23:59:59Z", {
        status: "confirmed",
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain("status = $");
    });

    it("returns correct pagination defaults", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await getScheduleForDateRange("2024-06-15T00:00:00Z", "2024-06-15T23:59:59Z");

      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  describe("getScheduleForGuest", () => {
    it("returns schedule entries for a guest", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            schedule_event_id: "evt-1",
            event_name: "Morning Session",
            event_type: "panel",
            venue_id: "venue-1",
            start_time: new Date("2024-06-15T09:00:00Z"),
            end_time: new Date("2024-06-15T11:00:00Z"),
            status: "confirmed",
            role: "attendee",
          },
        ],
      });

      const entries = await getScheduleForGuest("guest-1");

      expect(entries).toHaveLength(1);
      expect(entries[0].schedule_event_id).toBe("evt-1");
      expect(entries[0].role).toBe("attendee");
    });

    it("returns empty array when guest has no events", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const entries = await getScheduleForGuest("guest-no-events");

      expect(entries).toHaveLength(0);
    });

    it("joins with guest_schedule_events table", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getScheduleForGuest("guest-1");

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("guest_schedule_events");
      expect(sql).toContain("gse.guest_id = $1");
    });
  });

  describe("createScheduleEvent", () => {
    it("creates an event and returns it with conflicts", async () => {
      // Conflict check
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: "evt-conflict", name: "Overlap", venue_id: "venue-1", start_time: "2024-06-15T10:00:00Z", end_time: "2024-06-15T12:00:00Z" },
        ],
      });
      // Insert
      mockQuery.mockResolvedValueOnce({ rows: [makeEventRow()] });

      const result = await createScheduleEvent({
        name: "Morning Session",
        venue_id: "venue-1",
        start_time: "2024-06-15T09:00:00Z",
        end_time: "2024-06-15T11:00:00Z",
      });

      expect(result.event.name).toBe("Morning Session");
      expect(result.conflicts).toHaveLength(1);
    });

    it("creates without conflict check when no venue/time", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeEventRow({ venue_id: null, start_time: null, end_time: null })],
      });

      const result = await createScheduleEvent({ name: "TBD Event" });

      expect(result.conflicts).toHaveLength(0);
      // Only 1 call (insert), no conflict check
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("uses default status of 'draft'", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeEventRow({ status: "draft" })] });

      await createScheduleEvent({ name: "New Event" });

      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain("draft");
    });
  });

  describe("updateScheduleEvent", () => {
    it("updates and returns with conflict check", async () => {
      // Update query
      mockQuery.mockResolvedValueOnce({ rows: [makeEventRow({ name: "Updated Session" })] });
      // Conflict check after update
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateScheduleEvent("evt-1", { name: "Updated Session" });

      expect(result).not.toBeNull();
      expect(result!.event.name).toBe("Updated Session");
      expect(result!.conflicts).toHaveLength(0);
    });

    it("returns null when event not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateScheduleEvent("nonexistent", { name: "Nope" });

      expect(result).toBeNull();
    });

    it("returns existing event when no changes provided", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeEventRow()] });

      const result = await updateScheduleEvent("evt-1", {});

      expect(result).not.toBeNull();
      expect(result!.event.id).toBe("evt-1");
    });

    it("merges JSONB properties on update", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeEventRow()] })
        .mockResolvedValueOnce({ rows: [] });

      await updateScheduleEvent("evt-1", { properties: { notes: "Updated" } });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("properties = properties || $");
    });
  });
});
