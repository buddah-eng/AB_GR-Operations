/**
 * Scheduling Service
 *
 * Business logic for schedule event management: conflict detection,
 * date-range queries, guest schedule lookup, and event creation
 * with automatic room conflict checking.
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface ScheduleEvent {
  readonly id: string;
  readonly name: string;
  readonly event_type: string | null;
  readonly venue_id: string | null;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly status: string;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RoomConflict {
  readonly conflicting_event_id: string;
  readonly conflicting_event_name: string;
  readonly venue_id: string;
  readonly start_time: string;
  readonly end_time: string;
}

export interface ScheduleFilters {
  readonly venue_id?: string;
  readonly event_type?: string;
  readonly status?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface CreateScheduleEventData {
  readonly name: string;
  readonly event_type?: string;
  readonly venue_id?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly status?: string;
  readonly properties?: Record<string, unknown>;
  readonly created_by?: string;
}

export interface GuestScheduleEntry {
  readonly schedule_event_id: string;
  readonly event_name: string;
  readonly event_type: string | null;
  readonly venue_id: string | null;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly status: string;
  readonly role: string;
}

// --- Service functions ---

/**
 * Detects room/venue conflicts for a given time range.
 * Returns all schedule_events that overlap with the specified window
 * for the same venue, optionally excluding a specific event (for updates).
 */
export async function detectRoomConflicts(
  venueId: string,
  startTime: string,
  endTime: string,
  excludeEventId?: string
): Promise<ReadonlyArray<RoomConflict>> {
  if (!venueId || !startTime || !endTime) {
    return [];
  }

  const parsedStart = new Date(startTime);
  const parsedEnd = new Date(endTime);

  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    throw new Error("Invalid date format for startTime or endTime");
  }

  if (parsedEnd <= parsedStart) {
    throw new Error("endTime must be after startTime");
  }

  const params: unknown[] = [venueId, startTime, endTime];
  let excludeClause = "";

  if (excludeEventId) {
    excludeClause = " AND id != $4";
    params.push(excludeEventId);
  }

  const result = await query(
    `SELECT id, name, venue_id, start_time, end_time
     FROM schedule_events
     WHERE venue_id = $1
       AND NOT archived
       AND start_time < $3
       AND end_time > $2
       ${excludeClause}
     ORDER BY start_time ASC`,
    params
  );

  return result.rows.map((row) => ({
    conflicting_event_id: row.id as string,
    conflicting_event_name: row.name as string,
    venue_id: row.venue_id as string,
    start_time: row.start_time instanceof Date
      ? row.start_time.toISOString()
      : (row.start_time as string),
    end_time: row.end_time instanceof Date
      ? row.end_time.toISOString()
      : (row.end_time as string),
  }));
}

/**
 * Returns schedule events within a date range, with optional filters.
 */
export async function getScheduleForDateRange(
  startDate: string,
  endDate: string,
  filters?: ScheduleFilters
): Promise<{
  readonly data: ReadonlyArray<ScheduleEvent>;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}> {
  const page = Math.max(1, filters?.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [
    "NOT archived",
    "start_time >= $1",
    "start_time <= $2",
  ];
  const params: unknown[] = [startDate, endDate];
  let paramIdx = 3;

  if (filters?.venue_id) {
    whereClauses.push(`venue_id = $${paramIdx}`);
    params.push(filters.venue_id);
    paramIdx++;
  }

  if (filters?.event_type) {
    whereClauses.push(`event_type = $${paramIdx}`);
    params.push(filters.event_type);
    paramIdx++;
  }

  if (filters?.status) {
    whereClauses.push(`status = $${paramIdx}`);
    params.push(filters.status);
    paramIdx++;
  }

  const whereStr = whereClauses.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*) FROM schedule_events WHERE ${whereStr}`,
    params
  );
  const total = parseInt(countResult.rows[0].count as string, 10);

  const dataResult = await query(
    `SELECT * FROM schedule_events WHERE ${whereStr} ORDER BY start_time ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  return {
    data: dataResult.rows.map(rowToScheduleEvent),
    total,
    page,
    limit,
  };
}

/**
 * Returns all schedule events for a given guest (via guest_schedule_events).
 */
export async function getScheduleForGuest(guestId: string): Promise<ReadonlyArray<GuestScheduleEntry>> {
  const result = await query(
    `SELECT
       se.id AS schedule_event_id,
       se.name AS event_name,
       se.event_type,
       se.venue_id,
       se.start_time,
       se.end_time,
       se.status,
       gse.role
     FROM guest_schedule_events gse
     JOIN schedule_events se ON se.id = gse.schedule_event_id
     WHERE gse.guest_id = $1
       AND NOT gse.archived
       AND NOT se.archived
     ORDER BY se.start_time ASC`,
    [guestId]
  );

  return result.rows.map((row) => ({
    schedule_event_id: row.schedule_event_id as string,
    event_name: row.event_name as string,
    event_type: (row.event_type as string) ?? null,
    venue_id: (row.venue_id as string) ?? null,
    start_time: row.start_time instanceof Date
      ? row.start_time.toISOString()
      : (row.start_time as string) ?? null,
    end_time: row.end_time instanceof Date
      ? row.end_time.toISOString()
      : (row.end_time as string) ?? null,
    status: row.status as string,
    role: (row.role as string) ?? "attendee",
  }));
}

/**
 * Creates a schedule event with automatic conflict detection.
 * If a venue and time range are provided, checks for conflicts first.
 * Returns the created event and any detected conflicts.
 */
export async function createScheduleEvent(
  data: CreateScheduleEventData,
  client?: PoolClient
): Promise<{
  readonly event: ScheduleEvent;
  readonly conflicts: ReadonlyArray<RoomConflict>;
}> {
  // Detect conflicts if venue and time are provided
  let conflicts: ReadonlyArray<RoomConflict> = [];
  if (data.venue_id && data.start_time && data.end_time) {
    conflicts = await detectRoomConflicts(
      data.venue_id,
      data.start_time,
      data.end_time
    );
  }

  const sql = `
    INSERT INTO schedule_events (name, event_type, venue_id, start_time, end_time, status, properties, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const params = [
    data.name,
    data.event_type ?? null,
    data.venue_id ?? null,
    data.start_time ?? null,
    data.end_time ?? null,
    data.status ?? "draft",
    JSON.stringify(data.properties ?? {}),
    data.created_by ?? null,
  ];

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  return {
    event: rowToScheduleEvent(result.rows[0]),
    conflicts,
  };
}

/**
 * Updates an existing schedule event.
 * If venue or time changes, re-checks for conflicts.
 */
export async function updateScheduleEvent(
  id: string,
  data: Partial<CreateScheduleEventData>,
  client?: PoolClient
): Promise<{
  readonly event: ScheduleEvent;
  readonly conflicts: ReadonlyArray<RoomConflict>;
} | null> {
  // Build update
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields: ReadonlyArray<{ key: string; value: unknown }> = [
    { key: "name", value: data.name },
    { key: "event_type", value: data.event_type },
    { key: "venue_id", value: data.venue_id },
    { key: "start_time", value: data.start_time },
    { key: "end_time", value: data.end_time },
    { key: "status", value: data.status },
  ];

  for (const field of fields) {
    if (field.value !== undefined) {
      setClauses.push(`${field.key} = $${paramIdx}`);
      params.push(field.value);
      paramIdx++;
    }
  }

  if (data.properties !== undefined) {
    setClauses.push(`properties = properties || $${paramIdx}`);
    params.push(JSON.stringify(data.properties));
    paramIdx++;
  }

  if (setClauses.length === 0) {
    const existing = await query("SELECT * FROM schedule_events WHERE id = $1 AND NOT archived", [id]);
    if (existing.rows.length === 0) return null;
    return { event: rowToScheduleEvent(existing.rows[0]), conflicts: [] };
  }

  setClauses.push("updated_at = now()");
  params.push(id);

  const sql = `UPDATE schedule_events SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`;

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  if (result.rows.length === 0) {
    return null;
  }

  const event = rowToScheduleEvent(result.rows[0]);

  // Check conflicts after update if venue and time are present
  let conflicts: ReadonlyArray<RoomConflict> = [];
  if (event.venue_id && event.start_time && event.end_time) {
    conflicts = await detectRoomConflicts(
      event.venue_id,
      event.start_time,
      event.end_time,
      id
    );
  }

  return { event, conflicts };
}

// --- Helpers ---

function rowToScheduleEvent(row: Record<string, unknown>): ScheduleEvent {
  return {
    id: row.id as string,
    name: row.name as string,
    event_type: (row.event_type as string) ?? null,
    venue_id: (row.venue_id as string) ?? null,
    start_time: row.start_time instanceof Date
      ? row.start_time.toISOString()
      : (row.start_time as string) ?? null,
    end_time: row.end_time instanceof Date
      ? row.end_time.toISOString()
      : (row.end_time as string) ?? null,
    status: (row.status as string) ?? "draft",
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at as string) ?? new Date().toISOString(),
  };
}

// Exported for testing
export { rowToScheduleEvent };
