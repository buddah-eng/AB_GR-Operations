/**
 * Venue Management Service
 *
 * Provides venue lookup, filtering, availability checking, and capacity
 * validation against the venues and schedule_events tables.
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface Venue {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly venue_type: string;
  readonly capacity: number | null;
  readonly floor: string | null;
  readonly equipment: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export interface VenueFilters {
  readonly [key: string]: unknown;
  readonly venue_type?: string;
  readonly minCapacity?: number;
  readonly floor?: string;
}

export interface ConflictEntry {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface AvailabilityResult {
  readonly [key: string]: unknown;
  readonly available: boolean;
  readonly conflicts: readonly ConflictEntry[];
}

export interface CapacityResult {
  readonly [key: string]: unknown;
  readonly sufficient: boolean;
  readonly capacity: number;
}

// --- Functions ---

/**
 * List venues with optional type, capacity, and floor filters.
 * Only returns non-archived venues.
 */
export async function listVenues(
  filters?: VenueFilters
): Promise<readonly Venue[]> {
  const conditions: string[] = ["NOT archived"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.venue_type) {
    conditions.push(`venue_type = $${paramIdx}`);
    params.push(filters.venue_type);
    paramIdx += 1;
  }

  if (filters?.minCapacity !== undefined) {
    conditions.push(`capacity >= $${paramIdx}`);
    params.push(filters.minCapacity);
    paramIdx += 1;
  }

  if (filters?.floor) {
    conditions.push(`floor = $${paramIdx}`);
    params.push(filters.floor);
    paramIdx += 1;
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const sql = `SELECT * FROM venues ${whereClause} ORDER BY name ASC`;

  logger.info("Listing venues", { filters, sql: sql.slice(0, 120) });

  const result = await query<Venue>(sql, params);
  return result.rows;
}

/**
 * Look up a single venue by ID.
 * Returns null if not found or archived.
 */
export async function getVenueById(
  id: string
): Promise<Venue | null> {
  const result = await query<Venue>(
    "SELECT * FROM venues WHERE id = $1 AND NOT archived",
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Check whether a venue is available during a time window.
 * Queries schedule_events for overlapping bookings at the venue.
 *
 * Two events overlap when:  existing.start < requestedEnd AND existing.end > requestedStart
 */
export async function checkVenueAvailability(
  venueId: string,
  startTime: string,
  endTime: string
): Promise<AvailabilityResult> {
  const result = await query<{
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  }>(
    `SELECT id, name, start_time, end_time
     FROM schedule_events
     WHERE venue_id = $1
       AND NOT archived
       AND start_time < $3
       AND end_time > $2`,
    [venueId, startTime, endTime]
  );

  const conflicts: ConflictEntry[] = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
  }));

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Check whether a venue has sufficient capacity for the required headcount.
 * Returns the venue's capacity and whether it meets the requirement.
 */
export async function checkCapacity(
  venueId: string,
  requiredCapacity: number
): Promise<CapacityResult> {
  const venue = await getVenueById(venueId);

  if (!venue) {
    throw new Error(`Venue not found: ${venueId}`);
  }

  const capacity = venue.capacity ?? 0;

  return {
    sufficient: capacity >= requiredCapacity,
    capacity,
  };
}
