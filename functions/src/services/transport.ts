/**
 * Transport Booking Service
 *
 * Manages transport bookings for guests: creation, status transitions,
 * and querying. Status lifecycle:
 *   requested -> confirmed -> dispatched -> waiting -> picked_up -> dropped_off
 *   (cancelled from any non-terminal state)
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface TransportBooking {
  readonly id: string;
  readonly guest_id: string;
  readonly booking_type: string;
  readonly status: string;
  readonly pickup_location: string | null;
  readonly dropoff_location: string | null;
  readonly scheduled_time: string | null;
  readonly driver_name: string | null;
  readonly vehicle_info: string | null;
  readonly flight_number: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly archived: boolean;
}

export interface CreateBookingData {
  readonly booking_type: "arrival" | "departure" | "inter_venue";
  readonly pickup_location?: string;
  readonly dropoff_location?: string;
  readonly scheduled_time?: string;
  readonly driver_name?: string;
  readonly vehicle_info?: string;
  readonly flight_number?: string;
  readonly properties?: Record<string, unknown>;
  readonly created_by?: string;
}

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "dispatched"
  | "waiting"
  | "picked_up"
  | "dropped_off"
  | "cancelled";

// --- Status machine ---

// Status names differ from PRD (booked->confirmed, driver_en_route->dispatched)
// per implementation decision — clearer naming
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["waiting", "cancelled"],
  waiting: ["picked_up", "cancelled"],
  picked_up: ["dropped_off"],
  dropped_off: [],
  cancelled: [],
};

/**
 * Returns valid next statuses for a given current status.
 */
export function getValidTransitions(current: string): ReadonlyArray<string> {
  return VALID_TRANSITIONS[current] ?? [];
}

/**
 * Returns true if transitioning from `current` to `next` is valid.
 */
export function isValidTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}

// --- CRUD ---

/**
 * Creates a new transport booking with status=requested.
 */
export async function createBooking(
  guestId: string,
  data: CreateBookingData,
  client?: PoolClient
): Promise<TransportBooking> {
  const sql = `
    INSERT INTO transport_bookings
      (guest_id, booking_type, status, pickup_location, dropoff_location,
       scheduled_time, driver_name, vehicle_info, flight_number, properties, created_by)
    VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const params = [
    guestId,
    data.booking_type,
    data.pickup_location ?? null,
    data.dropoff_location ?? null,
    data.scheduled_time ?? null,
    data.driver_name ?? null,
    data.vehicle_info ?? null,
    data.flight_number ?? null,
    JSON.stringify(data.properties ?? {}),
    data.created_by ?? null,
  ];

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  return rowToBooking(result.rows[0]);
}

/**
 * Transitions a booking to a new status if the transition is valid.
 * Returns the updated booking or throws if invalid.
 */
export async function transitionBookingStatus(
  bookingId: string,
  newStatus: BookingStatus,
  client?: PoolClient
): Promise<TransportBooking> {
  const existing = await getBookingById(bookingId, client);
  if (!existing) {
    throw new Error(`Transport booking not found: ${bookingId}`);
  }

  if (!isValidTransition(existing.status, newStatus)) {
    throw new Error(
      `Invalid status transition: "${existing.status}" -> "${newStatus}". ` +
      `Valid transitions: ${getValidTransitions(existing.status).join(", ") || "none"}`
    );
  }

  const sql = `
    UPDATE transport_bookings
    SET status = $1, updated_at = now()
    WHERE id = $2
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [newStatus, bookingId])
    : await query(sql, [newStatus, bookingId]);

  return rowToBooking(result.rows[0]);
}

/**
 * Returns a single booking by ID.
 */
export async function getBookingById(
  bookingId: string,
  client?: PoolClient
): Promise<TransportBooking | null> {
  const sql = "SELECT * FROM transport_bookings WHERE id = $1";

  const result = client
    ? await client.query(sql, [bookingId])
    : await query(sql, [bookingId]);

  if (result.rows.length === 0) return null;
  return rowToBooking(result.rows[0]);
}

/**
 * Returns all non-archived bookings for a guest.
 */
export async function getBookingsForGuest(
  guestId: string
): Promise<ReadonlyArray<TransportBooking>> {
  const result = await query(
    `SELECT * FROM transport_bookings
     WHERE guest_id = $1 AND NOT archived
     ORDER BY scheduled_time ASC NULLS LAST`,
    [guestId]
  );
  return result.rows.map(rowToBooking);
}

/**
 * Returns all active (non-terminal, non-archived) bookings assigned to a driver.
 */
export async function getActiveDriverBookings(
  driverName: string
): Promise<ReadonlyArray<TransportBooking>> {
  const result = await query(
    `SELECT * FROM transport_bookings
     WHERE driver_name = $1
       AND NOT archived
       AND status NOT IN ('dropped_off', 'cancelled')
     ORDER BY scheduled_time ASC NULLS LAST`,
    [driverName]
  );
  return result.rows.map(rowToBooking);
}

/**
 * Lists bookings with optional status filter.
 */
export async function listBookings(
  filters?: { status?: string; archived?: boolean }
): Promise<ReadonlyArray<TransportBooking>> {
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.status) {
    whereClauses.push(`status = $${paramIdx++}`);
    params.push(filters.status);
  }

  if (filters?.archived !== undefined) {
    whereClauses.push(`archived = $${paramIdx++}`);
    params.push(filters.archived);
  } else {
    whereClauses.push("NOT archived");
  }

  const whereStr = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(" AND ")}`
    : "";

  const result = await query(
    `SELECT * FROM transport_bookings ${whereStr} ORDER BY scheduled_time ASC NULLS LAST`,
    params
  );
  return result.rows.map(rowToBooking);
}

// --- Helpers ---

function rowToBooking(row: Record<string, unknown>): TransportBooking {
  return {
    id: row.id as string,
    guest_id: row.guest_id as string,
    booking_type: row.booking_type as string,
    status: row.status as string,
    pickup_location: (row.pickup_location as string) ?? null,
    dropoff_location: (row.dropoff_location as string) ?? null,
    scheduled_time: row.scheduled_time
      ? row.scheduled_time instanceof Date
        ? row.scheduled_time.toISOString()
        : (row.scheduled_time as string)
      : null,
    driver_name: (row.driver_name as string) ?? null,
    vehicle_info: (row.vehicle_info as string) ?? null,
    flight_number: (row.flight_number as string) ?? null,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at as string) ?? new Date().toISOString(),
    created_by: (row.created_by as string) ?? null,
    archived: (row.archived as boolean) ?? false,
  };
}

// Exported for testing
export { rowToBooking };
