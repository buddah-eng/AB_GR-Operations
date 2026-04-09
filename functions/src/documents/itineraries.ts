/**
 * Itinerary Generation & Rendering Service
 *
 * Aggregates schedule_events, transport_bookings, and pairings for a guest
 * into a day-by-day agenda. Rendered as HTML for in-app display and PDF export.
 *
 * Data sources:
 *   - schedule_events: events where guest is referenced via properties or pairings
 *   - transport_bookings: guest-specific transport records
 *   - pairings: staff assigned to guest (liaison, interpreter, etc.)
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface ItineraryEvent {
  readonly time: string;
  readonly name: string;
  readonly type: "event" | "transport";
  readonly venue: string | null;
  readonly end_time: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface StaffPairing {
  readonly staff_id: string;
  readonly staff_name: string;
  readonly role: string;
}

export interface ItineraryDay {
  readonly date: string;
  readonly events: ReadonlyArray<ItineraryEvent>;
}

export interface Itinerary {
  readonly guest_id: string;
  readonly guest_name: string;
  readonly days: ReadonlyArray<ItineraryDay>;
  readonly pairings: ReadonlyArray<StaffPairing>;
}

interface ScheduleEventRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly event_type: string | null;
  readonly venue_name: string | null;
  readonly start_time: string;
  readonly end_time: string | null;
  readonly properties: Record<string, unknown>;
}

interface TransportBookingRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly booking_type: string;
  readonly pickup_location: string | null;
  readonly dropoff_location: string | null;
  readonly scheduled_time: string;
  readonly driver_name: string | null;
  readonly flight_number: string | null;
  readonly properties: Record<string, unknown>;
}

interface PairingRow {
  readonly [key: string]: unknown;
  readonly staff_id: string;
  readonly staff_name: string;
  readonly role: string;
}

interface GuestRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
}

// --- Helpers ---

/**
 * Extract the date portion (YYYY-MM-DD) from an ISO timestamp.
 */
function extractDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Group itinerary events by date, sorted chronologically.
 */
function groupByDate(events: ReadonlyArray<ItineraryEvent>): ReadonlyArray<ItineraryDay> {
  const dateMap = new Map<string, ItineraryEvent[]>();

  for (const event of events) {
    const date = extractDate(event.time);
    const existing = dateMap.get(date);
    if (existing) {
      existing.push(event);
    } else {
      dateMap.set(date, [event]);
    }
  }

  // Sort dates chronologically, then sort events within each date
  const sortedDates = [...dateMap.keys()].sort();

  return sortedDates.map((date) => ({
    date,
    events: [...(dateMap.get(date) ?? [])].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    ),
  }));
}

// --- Core Functions ---

/**
 * Generate a structured itinerary for a guest.
 *
 * Queries schedule_events (via pairings or properties), transport_bookings,
 * and pairings for the guest, then aggregates into a day-by-day agenda.
 */
export async function generateItinerary(guestId: string): Promise<Itinerary> {
  // Load guest
  const guestResult = await query<GuestRow>(
    "SELECT id, name FROM guests WHERE id = $1",
    [guestId]
  );

  if (guestResult.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const guest = guestResult.rows[0];

  // Load schedule events where guest is involved
  // Events reference guests via pairings or via properties JSONB containing guest_id
  const eventsResult = await query<ScheduleEventRow>(
    `SELECT DISTINCT se.id, se.name, se.event_type, v.name AS venue_name,
            se.start_time, se.end_time, se.properties
     FROM schedule_events se
     LEFT JOIN venues v ON v.id = se.venue_id
     LEFT JOIN pairings p ON p.guest_id = $1 AND NOT p.archived
     WHERE NOT se.archived
       AND (se.properties->>'guest_id' = $1 OR p.guest_id IS NOT NULL)
       AND se.start_time IS NOT NULL
     ORDER BY se.start_time`,
    [guestId]
  );

  // Load transport bookings
  const transportResult = await query<TransportBookingRow>(
    `SELECT id, booking_type, pickup_location, dropoff_location,
            scheduled_time, driver_name, flight_number, properties
     FROM transport_bookings
     WHERE guest_id = $1 AND NOT archived AND scheduled_time IS NOT NULL
     ORDER BY scheduled_time`,
    [guestId]
  );

  // Load pairings with staff names
  const pairingsResult = await query<PairingRow>(
    `SELECT p.staff_id, s.name AS staff_name, p.role
     FROM pairings p
     JOIN staff s ON s.id = p.staff_id
     WHERE p.guest_id = $1 AND NOT p.archived`,
    [guestId]
  );

  // Convert schedule events to itinerary events
  const scheduleEvents: ItineraryEvent[] = eventsResult.rows.map((row) => ({
    time: row.start_time,
    name: row.name,
    type: "event" as const,
    venue: row.venue_name,
    end_time: row.end_time,
    details: row.properties,
  }));

  // Convert transport bookings to itinerary events
  const transportEvents: ItineraryEvent[] = transportResult.rows.map((row) => ({
    time: row.scheduled_time,
    name: `${row.booking_type}: ${row.pickup_location ?? "TBD"} -> ${row.dropoff_location ?? "TBD"}`,
    type: "transport" as const,
    venue: null,
    end_time: null,
    details: {
      driver_name: row.driver_name,
      flight_number: row.flight_number,
      ...row.properties,
    },
  }));

  // Merge and group by date
  const allEvents = [...scheduleEvents, ...transportEvents];
  const days = groupByDate(allEvents);

  const pairings: StaffPairing[] = pairingsResult.rows.map((row) => ({
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    role: row.role,
  }));

  logger.info("Itinerary generated", {
    guestId,
    totalEvents: allEvents.length,
    totalDays: days.length,
  });

  return {
    guest_id: guest.id,
    guest_name: guest.name,
    days,
    pairings,
  };
}

/**
 * Render a complete HTML document for a guest itinerary.
 */
export async function renderItineraryHtml(guestId: string): Promise<string> {
  const itinerary = await generateItinerary(guestId);

  const pairingsList = itinerary.pairings
    .map((p) => `<li><strong>${p.role}:</strong> ${p.staff_name}</li>`)
    .join("\n");

  const daysHtml = itinerary.days
    .map((day) => {
      const eventsHtml = day.events
        .map((event) => {
          const time = new Date(event.time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          const venue = event.venue ? ` &mdash; ${event.venue}` : "";
          const badge = event.type === "transport" ? ' <span class="badge">Transport</span>' : "";
          return `<div class="event"><span class="time">${time}</span> <span class="event-name">${event.name}${badge}</span>${venue}</div>`;
        })
        .join("\n");

      return `<section class="day"><h2>${day.date}</h2>${eventsHtml}</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Itinerary - ${itinerary.guest_name}</title>
<style>
  body { font-family: 'Helvetica Neue', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; }
  .day { margin-bottom: 2rem; page-break-inside: avoid; }
  .day h2 { border-bottom: 2px solid #333; padding-bottom: 0.3rem; }
  .event { margin: 0.5rem 0; padding: 0.3rem 0; }
  .time { font-weight: bold; min-width: 80px; display: inline-block; }
  .badge { background: #e0e7ff; color: #3730a3; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
  .pairings { margin-bottom: 2rem; }
  @media print { body { padding: 1cm; } .day { page-break-after: always; } }
</style>
</head>
<body>
<h1>Itinerary: ${itinerary.guest_name}</h1>
<div class="pairings"><h3>Assigned Staff</h3><ul>${pairingsList}</ul></div>
${daysHtml}
</body>
</html>`;
}
