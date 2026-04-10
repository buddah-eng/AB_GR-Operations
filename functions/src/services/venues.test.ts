/**
 * Tests for Venue Management Service
 *
 * Covers:
 * - listVenues: no filters, with type filter, with capacity filter, combined filters
 * - getVenueById: found, not found
 * - checkVenueAvailability: available, conflicts, invalid args
 * - checkCapacity: sufficient, insufficient, venue not found
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
  listVenues,
  getVenueById,
  checkVenueAvailability,
  checkCapacity,
  rowToVenue,
} from "./venues";

// --- Fixtures ---

function venueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-1",
    name: "Grand Ballroom",
    type: "ballroom",
    capacity: 500,
    floor: "1",
    building: "Main",
    equipment: ["projector", "mic"],
    notes: "Primary event space",
    properties: {},
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    archived: false,
    ...overrides,
  };
}

// --- Tests ---

describe("rowToVenue", () => {
  it("maps a database row to a Venue object", () => {
    const row = venueRow();
    const venue = rowToVenue(row);

    expect(venue.id).toBe("venue-1");
    expect(venue.name).toBe("Grand Ballroom");
    expect(venue.type).toBe("ballroom");
    expect(venue.capacity).toBe(500);
    expect(venue.floor).toBe("1");
    expect(venue.building).toBe("Main");
    expect(venue.archived).toBe(false);
  });

  it("handles null optional fields", () => {
    const row = venueRow({ floor: null, building: null, notes: null });
    const venue = rowToVenue(row);

    expect(venue.floor).toBeNull();
    expect(venue.building).toBeNull();
    expect(venue.notes).toBeNull();
  });
});

describe("listVenues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all non-archived venues when no filters provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow(), venueRow({ id: "venue-2", name: "Room B" })] });

    const result = await listVenues();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("venue-1");
  });

  it("filters by type", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow()] });

    const result = await listVenues({ type: "ballroom" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("type = $1"),
      ["ballroom"]
    );
    expect(result).toHaveLength(1);
  });

  it("filters by minimum capacity", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow()] });

    const result = await listVenues({ minCapacity: 200 });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("capacity >= $1"),
      [200]
    );
    expect(result).toHaveLength(1);
  });

  it("filters by floor", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listVenues({ floor: "3" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("floor = $1"),
      ["3"]
    );
    expect(result).toHaveLength(0);
  });

  it("combines multiple filters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow()] });

    const result = await listVenues({ type: "ballroom", minCapacity: 100, floor: "1" });

    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toContain("type = $1");
    expect(callArgs[0]).toContain("capacity >= $2");
    expect(callArgs[0]).toContain("floor = $3");
    expect(callArgs[1]).toEqual(["ballroom", 100, "1"]);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no venues match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listVenues({ type: "outdoor" });

    expect(result).toHaveLength(0);
  });
});

describe("getVenueById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns venue when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow()] });

    const result = await getVenueById("venue-1");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("venue-1");
    expect(result?.name).toBe("Grand Ballroom");
  });

  it("returns null when venue not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getVenueById("nonexistent");

    expect(result).toBeNull();
  });
});

describe("checkVenueAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available when no conflicts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkVenueAvailability(
      "venue-1",
      "2026-04-10T09:00:00Z",
      "2026-04-10T11:00:00Z"
    );

    expect(result.available).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it("returns conflicts when time overlaps", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "evt-1",
          name: "Keynote",
          start_time: new Date("2026-04-10T10:00:00Z"),
          end_time: new Date("2026-04-10T12:00:00Z"),
        },
      ],
    });

    const result = await checkVenueAvailability(
      "venue-1",
      "2026-04-10T09:00:00Z",
      "2026-04-10T11:00:00Z"
    );

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].eventId).toBe("evt-1");
    expect(result.conflicts[0].eventName).toBe("Keynote");
  });

  it("throws when startTime is missing", async () => {
    await expect(
      checkVenueAvailability("venue-1", "", "2026-04-10T11:00:00Z")
    ).rejects.toThrow("startTime and endTime are required");
  });

  it("throws when endTime is missing", async () => {
    await expect(
      checkVenueAvailability("venue-1", "2026-04-10T09:00:00Z", "")
    ).rejects.toThrow("startTime and endTime are required");
  });

  it("throws when startTime is after endTime", async () => {
    await expect(
      checkVenueAvailability(
        "venue-1",
        "2026-04-10T12:00:00Z",
        "2026-04-10T09:00:00Z"
      )
    ).rejects.toThrow("startTime must be before endTime");
  });
});

describe("checkCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sufficient when venue capacity meets requirement", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: 500 })] });

    const result = await checkCapacity("venue-1", 200);

    expect(result.sufficient).toBe(true);
    expect(result.venueCapacity).toBe(500);
    expect(result.requiredCapacity).toBe(200);
  });

  it("returns insufficient when venue capacity is below requirement", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: 50 })] });

    const result = await checkCapacity("venue-1", 200);

    expect(result.sufficient).toBe(false);
    expect(result.venueCapacity).toBe(50);
    expect(result.requiredCapacity).toBe(200);
  });

  it("throws when venue not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(checkCapacity("nonexistent", 100)).rejects.toThrow(
      "Venue not found: nonexistent"
    );
  });

  it("throws when requiredCapacity is negative", async () => {
    await expect(checkCapacity("venue-1", -1)).rejects.toThrow(
      "requiredCapacity must be non-negative"
    );
  });

  it("handles exact capacity match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [venueRow({ capacity: 100 })] });

    const result = await checkCapacity("venue-1", 100);

    expect(result.sufficient).toBe(true);
  });
});
