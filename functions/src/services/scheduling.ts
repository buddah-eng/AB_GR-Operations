/**
 * Scheduling & Conflict Detection Service
 *
 * Provides schedule event queries, room conflict detection, and
 * conflict-checked event creation against the schedule_events table.
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface ScheduleEvent {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly event_type: string | null;
  readonly venue_id: string | null;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly status: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly archived: boolean;
}

export interface ScheduleConflict {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly start_time: string;
  readonly end_time: string;
}

export interface DateRangeFilters {
  readonly [key: string]: unknown;
  readonly venueId?: string;
  readonly eventType?: string;
  readonly status?: string;
}

export interface CreateScheduleEventData {
  readonly [key: string]: unknown;
  readonly name: string;
  readonly event_type?: string;
  readonly venue_id?: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly status?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly created_by?: string;
}

// --- Functions ---

/**
 * Detect overlapping events at a specific venue within a time window.
 * Optionally exclude a specific event (for update scenarios).
 *
 * Overlap condition: existing.start < requestedEnd AND existing.end > requestedStart
 */
export async function detectRoomConflicts(
  venueId: string,
  startTime: string,
  endTime: string,
  excludeEventId?: string
): Promise<readonly ScheduleConflict[]> {
  const conditions = [
    "venue_id = $1",
    "NOT archived",
    "start_time < $3",
    "end_time > $2",
  ];
  const params: unknown[] = [venueId, startTime, endTime];

  if (excludeEventId) {
    conditions.push("id != $4");
    params.push(excludeEventId);
  }

  const sql = `SELECT id, name, start_time, end_time
     FROM schedule_events
     WHERE ${conditions.join(" AND ")}
     ORDER BY start_time ASC`;

  const result = await query<ScheduleConflict>(sql, params);
  return result.rows;
}

/**
 * Retrieve all schedule events within a date range, with optional filters.
 */
export async function getScheduleForDateRange(
  startDate: string,
  endDate: string,
  filters?: DateRangeFilters
): Promise<readonly ScheduleEvent[]> {
  const conditions = [
    "NOT archived",
    "start_time >= $1",
    "end_time <= $2",
  ];
  const params: unknown[] = [startDate, endDate];
  let paramIdx = 3;

  if (filters?.venueId) {
    conditions.push(`venue_id = $${paramIdx}`);
    params.push(filters.venueId);
    paramIdx += 1;
  }

  if (filters?.eventType) {
    conditions.push(`event_type = $${paramIdx}`);
    params.push(filters.eventType);
    paramIdx += 1;
  }

  if (filters?.status) {
    conditions.push(`status = $${paramIdx}`);
    params.push(filters.status);
    paramIdx += 1;
  }

  const sql = `SELECT * FROM schedule_events
     WHERE ${conditions.join(" AND ")}
     ORDER BY start_time ASC`;

  logger.info("Fetching schedule for date range", {
    startDate,
    endDate,
    filters,
  });

  const result = await query<ScheduleEvent>(sql, params);
  return result.rows;
}

/**
 * Retrieve all schedule events associated with a guest.
 * Guest association is stored in properties->>'guest_id'.
 */
export async function getScheduleForGuest(
  guestId: string
): Promise<readonly ScheduleEvent[]> {
  const result = await query<ScheduleEvent>(
    `SELECT * FROM schedule_events
     WHERE properties->>'guest_id' = $1
       AND NOT archived
     ORDER BY start_time ASC`,
    [guestId]
  );

  return result.rows;
}

/**
 * Create a new schedule event with conflict detection.
 * If the event specifies a venue_id, checks for overlapping events first.
 * Rejects with an error if conflicts are found.
 */
export async function createScheduleEvent(
  data: CreateScheduleEventData
): Promise<ScheduleEvent> {
  // Check for venue conflicts if a venue is specified
  if (data.venue_id) {
    const conflicts = await detectRoomConflicts(
      data.venue_id,
      data.start_time,
      data.end_time
    );

    if (conflicts.length > 0) {
      const conflictNames = conflicts.map((c) => c.name).join(", ");
      throw new Error(
        `Venue conflict detected: overlapping events [${conflictNames}]`
      );
    }
  }

  const result = await query<ScheduleEvent>(
    `INSERT INTO schedule_events (name, event_type, venue_id, start_time, end_time, status, properties, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.name,
      data.event_type ?? null,
      data.venue_id ?? null,
      data.start_time,
      data.end_time,
      data.status ?? "draft",
      JSON.stringify(data.properties ?? {}),
      data.created_by ?? null,
    ]
  );

  logger.info("Schedule event created", {
    eventId: result.rows[0].id,
    name: data.name,
    venueId: data.venue_id,
  });

  return result.rows[0];
}
