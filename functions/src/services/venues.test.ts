/**
 * Tests for Venue Management Service
 *
 * Covers:
 * - listVenues: unfiltered, type filter, capacity filter, combined filters
 * - getVenueById: found, not found
 * - checkVenueAvailability: no conflicts (available), with overlapping events (not available)
 * - checkCapacity: sufficient, insufficient, venue not found
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
  listVenues,
  getVenueById,
  checkVenueAvailability,
  checkCapacity,
} from "./venues";

// --- Fixtures ---

function venueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-1",
    name: "Main Hall",
    venue_type: "hall",
    capacity: 500,
    floor: "1F",
    equipment: ["projector", "microphone"],
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived: false,
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    name: "Opening Ceremony",
    start_time: "2026-06-01T09:00:00Z",
    end_time: "2026-06-01T11:00:00Z",
    ...overrides,
  };
}

// --- Tests ---

describe("listVenues", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns all non-archived venues when no filters are given", async () => {
    const venues = [venueRow(), venueRow({ id: "venue-2", name: "Panel Room A" })];
    mockQuery.mockResolvedValueOnce({ rows: venues });

    const result = await listVenues();

    expect(result).toEqual(venues);
    expect(result).toHaveLength(2);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("NOT archived");
  });

  it("filters by venue_type when provided", async () => {
    const panels = [venueRow({ id: "venue-3", name: "Panel Room B", venue_type: "panel_room" })];
    mockQuery.mockResolvedValueOnce({ rows: panels });

    const result = await listVenues({ venue_type: "panel_room" });

    expect(result).toEqual(panels);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("venue_type = $1");
    expect(mockQuery.mock.calls[0][1]).toEqual(["panel_room"]);
  });

  it("filters by minimum capacity when provided", async () => {
    const largeVenues = [venueRow({ capacity: 800 })];
    mockQuery.mockResolvedValueOnce({ rows: largeVenues });

    const result = await listVenues({ minCapacity: 300 });

    expect(result).toEqual(largeVenues);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("capacity >= $1");
    expect(mockQuery.mock.calls[0][1]).toEqual([300]);
  });

  it("applies multiple filters together", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listVenues({ venue_type: "hall", minCapacity: 200, floor: "2F" });

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("venue_type = $1");
    expect(sql).toContain("capacity >= $2");
    expect(sql).toContain("floor = $3");
    expect(mockQuery.mock.calls[0][1]).toEqual(["hall", 200, "2F"]);
  });
});

describe("getVenueById", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns venue when found", async () => {
    const venue = venueRow();
    mockQuery.mockResolvedValueOnce({ rows: [venue] });

    const result = await getVenueById("venue-1");

    expect(result).toEqual(venue);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT * FROM venues WHERE id = $1 AND NOT archived",
      ["venue-1"]
    );
  });

  it("returns null when venue is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getVenueById("nonexistent");

    expect(result).toBeNull();
  });
});

describe("checkVenueAvailability", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns available=true when no conflicts exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkVenueAvailability(
      "venue-1",
      "2026-06-01T14:00:00Z",
      "2026-06-01T16:00:00Z"
    );

    expect(result.available).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it("returns available=false with conflict list when overlapping events exist", async () => {
    const overlapping = [
      eventRow(),
      eventRow({
        id: "event-2",
        name: "Keynote",
        start_time: "2026-06-01T10:00:00Z",
        end_time: "2026-06-01T12:00:00Z",
      }),
    ];
    mockQuery.mockResolvedValueOnce({ rows: overlapping });

    const result = await checkVenueAvailability(
      "venue-1",
      "2026-06-01T09:30:00Z",
      "2026-06-01T11:30:00Z"
    );

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts[0]).toEqual({
      id: "event-1",
      name: "Opening Ceremony",
      startTime: "2026-06-01T09:00:00Z",
      endTime: "2026-06-01T11:00:00Z",
    });
    expect(result.conflicts[1]).toEqual({
      id: "event-2",
      name: "Keynote",
      startTime: "2026-06-01T10:00:00Z",
      endTime: "2026-06-01T12:00:00Z",
    });
  });

  it("passes correct overlap query parameters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await checkVenueAvailability(
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z"
    );

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("start_time < $3");
    expect(sql).toContain("end_time > $2");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "venue-1",
      "2026-06-01T09:00:00Z",
      "2026-06-01T11:00:00Z",
    ]);
  });
});

describe("checkCapacity", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns sufficient=true when capacity meets requirement", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: 500 })] });

    const result = await checkCapacity("venue-1", 200);

    expect(result.sufficient).toBe(true);
    expect(result.capacity).toBe(500);
  });

  it("returns sufficient=false when capacity is below requirement", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: 50 })] });

    const result = await checkCapacity("venue-1", 100);

    expect(result.sufficient).toBe(false);
    expect(result.capacity).toBe(50);
  });

  it("throws error when venue is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(checkCapacity("nonexistent", 100)).rejects.toThrow(
      "Venue not found: nonexistent"
    );
  });

  it("treats null capacity as zero", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: null })] });

    const result = await checkCapacity("venue-1", 10);

    expect(result.sufficient).toBe(false);
    expect(result.capacity).toBe(0);
  });
});
