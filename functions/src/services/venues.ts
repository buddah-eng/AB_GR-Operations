/**
 * Venue Management Service
 *
 * Manages venue CRUD, availability checking, and capacity validation.
 * All writes go through the audit pipeline.
 */

import { query } from "../db/client";

// --- Types ---

export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly type: VenueType;
  readonly capacity: number;
  readonly floor: string | null;
  readonly building: string | null;
  readonly equipment: ReadonlyArray<string>;
  readonly notes: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export type VenueType =
  | "ballroom"
  | "meeting_room"
  | "outdoor"
  | "theater"
  | "breakout"
  | "lobby"
  | "other";

export interface VenueFilters {
  readonly type?: VenueType;
  readonly minCapacity?: number;
  readonly floor?: string;
  readonly building?: string;
}

export interface AvailabilityResult {
  readonly available: boolean;
  readonly conflicts: ReadonlyArray<{
    readonly eventId: string;
    readonly eventName: string;
    readonly startTime: string;
    readonly endTime: string;
  }>;
}

export interface CapacityResult {
  readonly sufficient: boolean;
  readonly venueCapacity: number;
  readonly requiredCapacity: number;
}

// --- List venues ---

export async function listVenues(
  filters?: VenueFilters
): Promise<ReadonlyArray<Venue>> {
  const conditions: string[] = ["NOT archived"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(filters.type);
  }

  if (filters?.minCapacity !== undefined) {
    conditions.push(`capacity >= $${paramIdx++}`);
    params.push(filters.minCapacity);
  }

  if (filters?.floor) {
    conditions.push(`floor = $${paramIdx++}`);
    params.push(filters.floor);
  }

  if (filters?.building) {
    conditions.push(`building = $${paramIdx++}`);
    params.push(filters.building);
  }

  const whereClause = conditions.join(" AND ");
  const result = await query(
    `SELECT * FROM venues WHERE ${whereClause} ORDER BY name ASC`,
    params
  );

  return result.rows.map(rowToVenue);
}

// --- Get venue by ID ---

export async function getVenueById(id: string): Promise<Venue | null> {
  const result = await query(
    "SELECT * FROM venues WHERE id = $1 AND NOT archived",
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToVenue(result.rows[0]);
}

// --- Check availability ---

export async function checkVenueAvailability(
  venueId: string,
  startTime: string,
  endTime: string
): Promise<AvailabilityResult> {
  if (!startTime || !endTime) {
    throw new Error("startTime and endTime are required");
  }

  if (new Date(startTime) >= new Date(endTime)) {
    throw new Error("startTime must be before endTime");
  }

  const result = await query(
    `SELECT id, name, start_time, end_time
     FROM schedule_events
     WHERE venue_id = $1
       AND NOT archived
       AND start_time < $3
       AND end_time > $2`,
    [venueId, startTime, endTime]
  );

  const conflicts = result.rows.map((row) => ({
    eventId: row.id as string,
    eventName: row.name as string,
    startTime: (row.start_time as Date).toISOString(),
    endTime: (row.end_time as Date).toISOString(),
  }));

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

// --- Check capacity ---

export async function checkCapacity(
  venueId: string,
  requiredCapacity: number
): Promise<CapacityResult> {
  if (requiredCapacity < 0) {
    throw new Error("requiredCapacity must be non-negative");
  }

  const venue = await getVenueById(venueId);
  if (!venue) {
    throw new Error(`Venue not found: ${venueId}`);
  }

  return {
    sufficient: venue.capacity >= requiredCapacity,
    venueCapacity: venue.capacity,
    requiredCapacity,
  };
}

// --- Row mapper ---

function rowToVenue(row: Record<string, unknown>): Venue {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as VenueType,
    capacity: row.capacity as number,
    floor: (row.floor as string) ?? null,
    building: (row.building as string) ?? null,
    equipment: (row.equipment as string[]) ?? [],
    notes: (row.notes as string) ?? null,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: (row.created_at as Date)?.toISOString() ?? new Date().toISOString(),
    updated_at: (row.updated_at as Date)?.toISOString() ?? new Date().toISOString(),
    archived: (row.archived as boolean) ?? false,
  };
}

// Exported for testing
export { rowToVenue };
