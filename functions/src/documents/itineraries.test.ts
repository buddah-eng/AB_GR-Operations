import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateItinerary, renderItineraryHtml } from "./itineraries";

// --- Mock db client ---

vi.mock("../db/client", () => ({
  query: vi.fn(),
}));

import { query } from "../db/client";
const mockQuery = vi.mocked(query);

// --- Fixtures ---

const EVENTS = [
  { event_date: "2026-05-01", start_time: "09:00", end_time: "10:00", title: "Welcome Breakfast", description: "Main hall", location: "Dining Room" },
  { event_date: "2026-05-01", start_time: "14:00", end_time: "15:00", title: "Workshop", description: null, location: "Room A" },
  { event_date: "2026-05-02", start_time: "10:00", end_time: "11:00", title: "Closing Session", description: null, location: "Auditorium" },
];

const TRANSPORT = [
  { travel_date: "2026-05-01", departure_time: "07:00", arrival_time: "08:30", description: "Airport shuttle", origin: "Airport", destination: "Resort" },
];

const PAIRINGS = [
  { pairing_date: "2026-05-01", start_time: "11:00", end_time: "12:00", activity: "Golf", partner_name: "Bob", location: "Course A" },
  { pairing_date: "2026-05-02", start_time: "08:00", end_time: "09:00", activity: "Tennis", partner_name: "Carol", location: "Court 1" },
];

function setupQueryMock(
  events = EVENTS,
  transport = TRANSPORT,
  pairings = PAIRINGS,
) {
  mockQuery.mockImplementation(async (text: string) => {
    if (text.includes("schedule_events")) {
      return { rows: events, rowCount: events.length } as never;
    }
    if (text.includes("transport_bookings")) {
      return { rows: transport, rowCount: transport.length } as never;
    }
    if (text.includes("pairings")) {
      return { rows: pairings, rowCount: pairings.length } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- generateItinerary ---

describe("generateItinerary", () => {
  it("groups items by date", async () => {
    setupQueryMock();

    const days = await generateItinerary("g-1");

    expect(days).toHaveLength(2);
    expect(days[0].date).toBe("2026-05-01");
    expect(days[1].date).toBe("2026-05-02");
  });

  it("sorts days chronologically and items within each day by time", async () => {
    setupQueryMock();

    const days = await generateItinerary("g-1");

    // Day 1 should have: 07:00 transport, 09:00 event, 11:00 pairing, 14:00 event
    const day1Times = days[0].items.map((i) => i.time);
    expect(day1Times).toEqual(["07:00", "09:00", "11:00", "14:00"]);
  });

  it("includes transport bookings with formatted title", async () => {
    setupQueryMock();

    const days = await generateItinerary("g-1");
    const transportItems = days
      .flatMap((d) => [...d.items])
      .filter((i) => i.type === "transport");

    expect(transportItems).toHaveLength(1);
    expect(transportItems[0].title).toContain("Airport");
    expect(transportItems[0].title).toContain("Resort");
  });

  it("includes pairings with activity and partner", async () => {
    setupQueryMock();

    const days = await generateItinerary("g-1");
    const pairingItems = days
      .flatMap((d) => [...d.items])
      .filter((i) => i.type === "pairing");

    expect(pairingItems).toHaveLength(2);
    expect(pairingItems[0].title).toContain("Golf");
    expect(pairingItems[0].title).toContain("Bob");
  });

  it("returns empty array when no data exists", async () => {
    setupQueryMock([], [], []);

    const days = await generateItinerary("g-1");
    expect(days).toHaveLength(0);
  });

  it("handles events-only (no transport or pairings)", async () => {
    setupQueryMock(EVENTS, [], []);

    const days = await generateItinerary("g-1");

    expect(days).toHaveLength(2);
    // Day 1 should only have events
    expect(days[0].items.every((i) => i.type === "event")).toBe(true);
  });
});

// --- renderItineraryHtml ---

describe("renderItineraryHtml", () => {
  it("produces valid HTML document", async () => {
    setupQueryMock();

    const html = await renderItineraryHtml("g-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("Itinerary");
  });

  it("renders day sections with items", async () => {
    setupQueryMock();

    const html = await renderItineraryHtml("g-1");

    expect(html).toContain("Welcome Breakfast");
    expect(html).toContain("Workshop");
    expect(html).toContain("Golf");
    expect(html).toContain("Airport");
  });
});
