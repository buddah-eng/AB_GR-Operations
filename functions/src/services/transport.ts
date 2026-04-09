/**
 * Transport Service
 *
 * Manages transport bookings for guests.
 * Booking status flow:
 *   requested → confirmed → dispatched → waiting → picked_up → dropped_off
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

// --- Types ---

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "dispatched"
  | "waiting"
  | "picked_up"
  | "dropped_off"
  | "cancelled";

export interface TransportBooking {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly guest_id: string;
  readonly booking_type: string;
  readonly status: BookingStatus;
  readonly pickup_location: string | null;
  readonly dropoff_location: string | null;
  readonly scheduled_time: string | null;
  readonly driver_name: string | null;
  readonly driver_phone: string | null;
  readonly vehicle_info: string | null;
  readonly flight_number: string | null;
  readonly flight_status: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly archived: boolean;
}

export interface CreateBookingData {
  readonly [key: string]: unknown;
  readonly booking_type: "arrival" | "departure" | "inter_venue";
  readonly pickup_location?: string;
  readonly dropoff_location?: string;
  readonly scheduled_time?: string;
  readonly driver_name?: string;
  readonly driver_phone?: string;
  readonly vehicle_info?: string;
  readonly flight_number?: string;
  readonly properties?: Record<string, unknown>;
}

// --- Valid transitions map ---

const VALID_BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, ReadonlyArray<BookingStatus>>> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["waiting", "cancelled"],
  waiting: ["picked_up", "cancelled"],
  picked_up: ["dropped_off"],
  dropped_off: [],
  cancelled: [],
};

// --- Public API ---

/**
 * Create a new transport booking for a guest.
 */
export async function createBooking(
  guestId: string,
  data: CreateBookingData
): Promise<TransportBooking> {
  const result = await query<TransportBooking>(
    `INSERT INTO transport_bookings (
       guest_id, booking_type, pickup_location, dropoff_location,
       scheduled_time, driver_name, driver_phone, vehicle_info,
       flight_number, properties
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      guestId,
      data.booking_type,
      data.pickup_location ?? null,
      data.dropoff_location ?? null,
      data.scheduled_time ?? null,
      data.driver_name ?? null,
      data.driver_phone ?? null,
      data.vehicle_info ?? null,
      data.flight_number ?? null,
      JSON.stringify(data.properties ?? {}),
    ]
  );

  logger.info("Transport booking created", {
    guestId,
    bookingId: result.rows[0].id,
    type: data.booking_type,
  });

  return result.rows[0];
}

/**
 * Transition a booking to a new status.
 * Validates the transition is legal before updating.
 */
export async function transitionBookingStatus(
  bookingId: string,
  newStatus: BookingStatus
): Promise<TransportBooking> {
  const currentResult = await query<TransportBooking>(
    "SELECT * FROM transport_bookings WHERE id = $1 AND NOT archived",
    [bookingId]
  );

  if (currentResult.rowCount === 0) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  const currentBooking = currentResult.rows[0];
  const currentStatus = currentBooking.status;
  const allowed = VALID_BOOKING_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid booking transition: ${currentStatus} → ${newStatus}`
    );
  }

  const updateResult = await query<TransportBooking>(
    `UPDATE transport_bookings SET status = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [newStatus, bookingId]
  );

  logger.info("Booking status transitioned", {
    bookingId,
    from: currentStatus,
    to: newStatus,
  });

  return updateResult.rows[0];
}

/**
 * Retrieve all non-archived bookings for a guest.
 */
export async function getBookingsForGuest(
  guestId: string
): Promise<ReadonlyArray<TransportBooking>> {
  const result = await query<TransportBooking>(
    `SELECT * FROM transport_bookings
     WHERE guest_id = $1 AND NOT archived
     ORDER BY scheduled_time ASC NULLS LAST`,
    [guestId]
  );

  return result.rows;
}

/**
 * Retrieve all active (non-terminal) bookings for a given driver.
 * Active means not dropped_off, cancelled, or archived.
 */
export async function getActiveDriverBookings(
  driverName: string
): Promise<ReadonlyArray<TransportBooking>> {
  const result = await query<TransportBooking>(
    `SELECT * FROM transport_bookings
     WHERE driver_name = $1
       AND status NOT IN ('dropped_off', 'cancelled')
       AND NOT archived
     ORDER BY scheduled_time ASC NULLS LAST`,
    [driverName]
  );

  return result.rows;
}
