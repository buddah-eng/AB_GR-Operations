/**
 * Tests for Scheduling & Conflict Detection Service
 *
 * Covers:
 * - detectRoomConflicts: overlapping events, no conflicts, excludeEventId
 * - getScheduleForDateRange: date filtering, additional filters
 * - getScheduleForGuest: guest-associated events
 * - createScheduleEvent: successful creation, venue conflict rejection, no-venue creation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// --- Import module under test ---

import {
  detectRoomConflicts,
  getScheduleForDateRange,
  getScheduleForGuest,
  createScheduleEvent,
} from "./scheduling";

// --- Fixtures ---

function conflictRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    name: "Opening Ceremony",
    start_time: "2026-06-01T09:00:00Z",
    end_time: "2026-06-01T11:00:00Z",
    ...overrides,
  };
}

function scheduleEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    name: "Panel Discussion",
    event_type: "panel",
    venue_id: "venue-1",
    start_time: "2026-06-01T09:00:00Z",
    end_time: "2026-06-01T10:00:00Z",
    status: "confirmed",
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: "user-1",
    archived: false,
    ...overrides,
  };
}

// --- Tests ---

describe("detectRoomConflicts", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns overlapping events at a venue", async () => {
    const conflicts = [
      conflictRow(),
      conflictRow({
        id: "event-2",
        name: "Keynote",
        start_time: "2026-06-01T10:00:00Z",
        end_time: "2026-06-01T12:00:00Z",
      }),
    ];
    mockQuery.mockResolvedValueOnce({ rows: conflicts });

    const result = await detectRoomConflicts(
      "venue-1",
      "2026-06-01T09:30:00Z",
      "2026-06-01T11:30:00Z"
    );

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Opening Ceremony");
    expect(result[1].name).toBe("Keynote");
  });

  it("returns empty array when no conflicts exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await detectRoomConflicts(
      "venue-1",
      "2026-06-01T14:00:00Z",
      "2026-06-01T16:00:00Z"
    );

    expect(result).toEqual([]);
  });

  it("excludes specified event ID from results", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await detectRoomConflicts(
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z",
      "event-self"
    );

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("id != $4");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z",
      "event-self",
    ]);
  });

  it("does not include exclude clause when no excludeEventId is given", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await detectRoomConflicts(
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z"
    );

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).not.toContain("id !=");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z",
    ]);
  });
});

describe("getScheduleForDateRange", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns events within the date range", async () => {
    const events = [
      scheduleEventRow(),
      scheduleEventRow({ id: "event-2", name: "Workshop" }),
    ];
    mockQuery.mockResolvedValueOnce({ rows: events });

    const result = await getScheduleForDateRange(
      "2026-06-01T00:00:00Z",
      "2026-06-02T00:00:00Z"
    );

    expect(result).toHaveLength(2);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("start_time >= $1");
    expect(sql).toContain("end_time <= $2");
  });

  it("applies venue, event type, and status filters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getScheduleForDateRange(
      "2026-06-01T00:00:00Z",
      "2026-06-02T00:00:00Z",
      { venueId: "venue-1", eventType: "panel", status: "confirmed" }
    );

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("venue_id = $3");
    expect(sql).toContain("event_type = $4");
    expect(sql).toContain("status = $5");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "2026-06-01T00:00:00Z",
      "2026-06-02T00:00:00Z",
      "venue-1",
      "panel",
      "confirmed",
    ]);
  });
});

describe("getScheduleForGuest", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns events associated with a guest via properties", async () => {
    const guestEvents = [
      scheduleEventRow({ properties: { guest_id: "guest-1" } }),
      scheduleEventRow({
        id: "event-3",
        name: "Dinner",
        properties: { guest_id: "guest-1" },
      }),
    ];
    mockQuery.mockResolvedValueOnce({ rows: guestEvents });

    const result = await getScheduleForGuest("guest-1");

    expect(result).toHaveLength(2);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("properties->>'guest_id' = $1");
    expect(mockQuery.mock.calls[0][1]).toEqual(["guest-1"]);
  });

  it("returns empty array when guest has no events", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getScheduleForGuest("guest-99");

    expect(result).toEqual([]);
  });
});

describe("createScheduleEvent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("creates event successfully when no venue conflicts exist", async () => {
    // First call: detectRoomConflicts returns no conflicts
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second call: INSERT RETURNING
    const created = scheduleEventRow({ id: "new-event" });
    mockQuery.mockResolvedValueOnce({ rows: [created] });

    const result = await createScheduleEvent({
      name: "Panel Discussion",
      event_type: "panel",
      venue_id: "venue-1",
      start_time: "2026-06-01T09:00:00Z",
      end_time: "2026-06-01T10:00:00Z",
      status: "confirmed",
      created_by: "user-1",
    });

    expect(result).toEqual(created);
    // Verify INSERT was called
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO schedule_events");
    expect(insertCall[1]).toContain("Panel Discussion");
  });

  it("rejects creation when venue has conflicting events", async () => {
    // detectRoomConflicts returns a conflict
    mockQuery.mockResolvedValueOnce({
      rows: [conflictRow({ name: "Existing Event" })],
    });

    await expect(
      createScheduleEvent({
        name: "New Event",
        venue_id: "venue-1",
        start_time: "2026-06-01T09:30:00Z",
        end_time: "2026-06-01T11:30:00Z",
      })
    ).rejects.toThrow("Venue conflict detected: overlapping events [Existing Event]");

    // Verify INSERT was never called (only the conflict check ran)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("skips conflict check when no venue_id is specified", async () => {
    const created = scheduleEventRow({ id: "no-venue-event", venue_id: null });
    mockQuery.mockResolvedValueOnce({ rows: [created] });

    const result = await createScheduleEvent({
      name: "Virtual Meeting",
      start_time: "2026-06-01T09:00:00Z",
      end_time: "2026-06-01T10:00:00Z",
    });

    expect(result).toEqual(created);
    // Only one call (the INSERT), no conflict check
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO schedule_events");
  });

  it("uses default status 'draft' when not provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // conflict check
    mockQuery.mockResolvedValueOnce({ rows: [scheduleEventRow()] }); // insert

    await createScheduleEvent({
      name: "TBD Event",
      venue_id: "venue-1",
      start_time: "2026-06-01T09:00:00Z",
      end_time: "2026-06-01T10:00:00Z",
    });

    const insertParams = mockQuery.mock.calls[1][1] as unknown[];
    // status is the 6th parameter (index 5)
    expect(insertParams[5]).toBe("draft");
  });
});
