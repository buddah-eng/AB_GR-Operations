/**
 * Tests for Itinerary Generation & Rendering Service
 *
 * Covers:
 * - generateItinerary: event grouping, transport inclusion, pairings, empty handling
 * - renderItineraryHtml: HTML rendering
 * - Chronological ordering
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

import { generateItinerary, renderItineraryHtml } from "./itineraries";

// --- Fixtures ---

function guestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "guest-1",
    name: "Tanaka Ichiro",
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    name: "Panel Discussion",
    event_type: "panel",
    venue_name: "Hall A",
    start_time: "2026-05-22T15:00:00Z",
    end_time: "2026-05-22T16:00:00Z",
    properties: {},
    ...overrides,
  };
}

function transportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tb-1",
    booking_type: "arrival",
    pickup_location: "Logan Airport",
    dropoff_location: "Hynes Marriott",
    scheduled_time: "2026-05-22T09:00:00Z",
    driver_name: "Mike Chen",
    flight_number: "JL008",
    properties: {},
    ...overrides,
  };
}

function pairingRow(overrides: Record<string, unknown> = {}) {
  return {
    staff_id: "staff-1",
    staff_name: "Hana Ito",
    role: "liaison",
    ...overrides,
  };
}

// --- Setup ---

/**
 * Set up mock responses for itinerary queries.
 * Call order: 1=guest, 2=events, 3=transport, 4=pairings
 */
function setupMocks(
  guest: Record<string, unknown> | null,
  events: Record<string, unknown>[],
  transport: Record<string, unknown>[],
  pairings: Record<string, unknown>[]
) {
  mockQuery
    .mockResolvedValueOnce({ rows: guest ? [guest] : [] })
    .mockResolvedValueOnce({ rows: events })
    .mockResolvedValueOnce({ rows: transport })
    .mockResolvedValueOnce({ rows: pairings });
}

// --- Tests ---

describe("generateItinerary", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("groups events by date", async () => {
    const day1Event = eventRow({ start_time: "2026-05-22T15:00:00Z" });
    const day2Event = eventRow({
      id: "evt-2",
      name: "Concert",
      start_time: "2026-05-23T19:00:00Z",
    });

    setupMocks(guestRow(), [day1Event, day2Event], [], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(2);
    expect(itinerary.days[0].date).toBe("2026-05-22");
    expect(itinerary.days[1].date).toBe("2026-05-23");
  });

  it("includes transport bookings as events", async () => {
    const transport = transportRow();
    setupMocks(guestRow(), [], [transport], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(1);
    const transportEvent = itinerary.days[0].events[0];
    expect(transportEvent.type).toBe("transport");
    expect(transportEvent.name).toContain("Logan Airport");
    expect(transportEvent.name).toContain("Hynes Marriott");
  });

  it("includes staff pairings", async () => {
    const pairing = pairingRow();
    setupMocks(guestRow(), [eventRow()], [], [pairing]);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.pairings).toHaveLength(1);
    expect(itinerary.pairings[0].staff_name).toBe("Hana Ito");
    expect(itinerary.pairings[0].role).toBe("liaison");
  });

  it("handles guest with no events (empty itinerary)", async () => {
    setupMocks(guestRow(), [], [], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(0);
    expect(itinerary.pairings).toHaveLength(0);
    expect(itinerary.guest_name).toBe("Tanaka Ichiro");
  });

  it("orders days chronologically", async () => {
    const laterEvent = eventRow({
      id: "evt-late",
      name: "Day 3 Event",
      start_time: "2026-05-24T10:00:00Z",
    });
    const earlierEvent = eventRow({
      id: "evt-early",
      name: "Day 1 Event",
      start_time: "2026-05-22T10:00:00Z",
    });
    const middleEvent = eventRow({
      id: "evt-mid",
      name: "Day 2 Event",
      start_time: "2026-05-23T10:00:00Z",
    });

    // Return in non-chronological order to test sorting
    setupMocks(guestRow(), [laterEvent, earlierEvent, middleEvent], [], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(3);
    expect(itinerary.days[0].date).toBe("2026-05-22");
    expect(itinerary.days[1].date).toBe("2026-05-23");
    expect(itinerary.days[2].date).toBe("2026-05-24");
  });

  it("sorts events within the same day by time", async () => {
    const laterEvent = eventRow({
      id: "evt-2",
      name: "Afternoon Panel",
      start_time: "2026-05-22T15:00:00Z",
    });
    const earlierEvent = eventRow({
      id: "evt-1",
      name: "Morning Pickup",
      start_time: "2026-05-22T09:00:00Z",
    });

    // Return later event first to test intra-day sorting
    setupMocks(guestRow(), [laterEvent, earlierEvent], [], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(1);
    expect(itinerary.days[0].events[0].name).toBe("Morning Pickup");
    expect(itinerary.days[0].events[1].name).toBe("Afternoon Panel");
  });

  it("merges schedule events and transport into the same day", async () => {
    const event = eventRow({ start_time: "2026-05-22T15:00:00Z" });
    const transport = transportRow({ scheduled_time: "2026-05-22T09:00:00Z" });

    setupMocks(guestRow(), [event], [transport], []);

    const itinerary = await generateItinerary("guest-1");

    expect(itinerary.days).toHaveLength(1);
    expect(itinerary.days[0].events).toHaveLength(2);
    // Transport at 9 AM should come before panel at 3 PM
    expect(itinerary.days[0].events[0].type).toBe("transport");
    expect(itinerary.days[0].events[1].type).toBe("event");
  });

  it("throws error when guest is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(generateItinerary("bad-guest")).rejects.toThrow(
      "Guest not found: bad-guest"
    );
  });
});

describe("renderItineraryHtml", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("produces valid HTML document", async () => {
    const event = eventRow();
    const pairing = pairingRow();
    setupMocks(guestRow(), [event], [], [pairing]);

    const html = await renderItineraryHtml("guest-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("Tanaka Ichiro");
    expect(html).toContain("Panel Discussion");
    expect(html).toContain("Hana Ito");
  });

  it("renders day headers", async () => {
    const event = eventRow();
    setupMocks(guestRow(), [event], [], []);

    const html = await renderItineraryHtml("guest-1");

    expect(html).toContain("2026-05-22");
    expect(html).toContain('<section class="day">');
  });
});
