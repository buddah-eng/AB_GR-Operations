/**
 * Itinerary Generation Service
 *
 * Aggregates schedule_events, transport_bookings, and pairings for a guest,
 * groups them by day, sorts chronologically within each day, and renders
 * to styled HTML.
 */

import { query } from "../db/client";

// --- Types ---

export interface ItineraryItem {
  readonly date: string;
  readonly time: string;
  readonly endTime?: string;
  readonly title: string;
  readonly description?: string;
  readonly type: "event" | "transport" | "pairing";
  readonly location?: string;
}

export interface ItineraryDay {
  readonly date: string;
  readonly items: ReadonlyArray<ItineraryItem>;
}

// --- Data loading ---

async function loadScheduleEvents(
  guestId: string
): Promise<ReadonlyArray<ItineraryItem>> {
  const result = await query(
    `SELECT event_date, start_time, end_time, title, description, location
     FROM schedule_events
     WHERE guest_id = $1
     ORDER BY event_date, start_time`,
    [guestId]
  );
  return result.rows.map((row) => ({
    date: row.event_date as string,
    time: row.start_time as string,
    endTime: (row.end_time as string) ?? undefined,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    type: "event" as const,
    location: (row.location as string) ?? undefined,
  }));
}

async function loadTransportBookings(
  guestId: string
): Promise<ReadonlyArray<ItineraryItem>> {
  const result = await query(
    `SELECT travel_date, departure_time, arrival_time, description, origin, destination
     FROM transport_bookings
     WHERE guest_id = $1
     ORDER BY travel_date, departure_time`,
    [guestId]
  );
  return result.rows.map((row) => ({
    date: row.travel_date as string,
    time: row.departure_time as string,
    endTime: (row.arrival_time as string) ?? undefined,
    title: `Transport: ${row.origin as string} to ${row.destination as string}`,
    description: (row.description as string) ?? undefined,
    type: "transport" as const,
    location: row.origin as string,
  }));
}

async function loadPairings(
  guestId: string
): Promise<ReadonlyArray<ItineraryItem>> {
  const result = await query(
    `SELECT pairing_date, start_time, end_time, activity, partner_name, location
     FROM pairings
     WHERE guest_id = $1
     ORDER BY pairing_date, start_time`,
    [guestId]
  );
  return result.rows.map((row) => ({
    date: row.pairing_date as string,
    time: row.start_time as string,
    endTime: (row.end_time as string) ?? undefined,
    title: `${row.activity as string} with ${row.partner_name as string}`,
    description: undefined,
    type: "pairing" as const,
    location: (row.location as string) ?? undefined,
  }));
}

// --- Grouping & sorting ---

function groupByDay(items: ReadonlyArray<ItineraryItem>): ReadonlyArray<ItineraryDay> {
  const dayMap = new Map<string, ItineraryItem[]>();

  for (const item of items) {
    const existing = dayMap.get(item.date) ?? [];
    dayMap.set(item.date, [...existing, item]);
  }

  const sortedDates = [...dayMap.keys()].sort();

  return sortedDates.map((date) => {
    const dayItems = dayMap.get(date) ?? [];
    const sorted = [...dayItems].sort((a, b) => a.time.localeCompare(b.time));
    return { date, items: sorted };
  });
}

// --- Main entry point ---

/**
 * Generates a full itinerary for a guest by aggregating schedule_events,
 * transport_bookings, and pairings, grouped by day and sorted chronologically.
 */
export async function generateItinerary(
  guestId: string
): Promise<ReadonlyArray<ItineraryDay>> {
  const [events, transport, pairings] = await Promise.all([
    loadScheduleEvents(guestId),
    loadTransportBookings(guestId),
    loadPairings(guestId),
  ]);

  const allItems = [...events, ...transport, ...pairings];
  return groupByDay(allItems);
}

// --- HTML rendering ---

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00Z");
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "";
  // Already formatted (e.g. "14:00") — return as-is for simplicity
  return timeStr;
}

function typeIcon(type: ItineraryItem["type"]): string {
  switch (type) {
    case "event": return "&#128197;";
    case "transport": return "&#9992;";
    case "pairing": return "&#129309;";
  }
}

function renderItem(item: ItineraryItem): string {
  const timeRange = item.endTime
    ? `${formatTime(item.time)} &ndash; ${formatTime(item.endTime)}`
    : formatTime(item.time);

  const locationHtml = item.location
    ? `<span class="location">${item.location}</span>`
    : "";

  const descHtml = item.description
    ? `<p class="desc">${item.description}</p>`
    : "";

  return [
    `<div class="item item-${item.type}">`,
    `  <span class="icon">${typeIcon(item.type)}</span>`,
    `  <span class="time">${timeRange}</span>`,
    `  <span class="title">${item.title}</span>`,
    locationHtml,
    descHtml,
    "</div>",
  ].join("\n");
}

/**
 * Renders a guest itinerary as a styled HTML document.
 */
export async function renderItineraryHtml(
  guestId: string
): Promise<string> {
  const days = await generateItinerary(guestId);

  const dayBlocks = days.map((day) => {
    const itemsHtml = day.items.map(renderItem).join("\n");
    return [
      `<section class="day">`,
      `  <h2>${formatDate(day.date)}</h2>`,
      itemsHtml,
      "</section>",
    ].join("\n");
  });

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "<title>Guest Itinerary</title>",
    "<style>",
    "  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #1a1a1a; }",
    "  .day { margin-bottom: 2rem; }",
    "  .day h2 { font-size: 1.2rem; border-bottom: 2px solid #0057b7; padding-bottom: 0.3rem; }",
    "  .item { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; padding: 0.5rem 0; border-bottom: 1px solid #eee; }",
    "  .icon { font-size: 1.1rem; }",
    "  .time { font-weight: 600; min-width: 120px; }",
    "  .title { flex: 1; }",
    "  .location { color: #666; font-size: 0.9rem; }",
    "  .desc { width: 100%; margin: 0.25rem 0 0; font-size: 0.9rem; color: #444; }",
    "  .item-transport { background: #f0f7ff; }",
    "  .item-pairing { background: #fff8f0; }",
    "</style>",
    "</head>",
    "<body>",
    "<h1>Itinerary</h1>",
    ...dayBlocks,
    "</body>",
    "</html>",
  ].join("\n");
}
