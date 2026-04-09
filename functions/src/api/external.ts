/**
 * External Surfaces API
 *
 * Token-scoped endpoints for external participants:
 * - Guest self-service forms (save-and-resume)
 * - Driver pickup views (minimal data, status transitions)
 *
 * No Firebase auth required — uses scoped tokens from Postgres.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";
import { externalRateLimiter } from "./rate-limiter";

export const externalRouter = Router();

externalRouter.use(externalRateLimiter);

// --- Guest Form Endpoints ---

/**
 * GET /api/guest-form
 * Returns the guest form session data (pre-filled + saved progress).
 * Requires X-Guest-Token header.
 */
externalRouter.get("/guest-form", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: "Invalid or expired guest token." });
      return;
    }

    // Load guest data for pre-fill
    const guestResult = await query(
      "SELECT name, type, department, company, properties FROM guests WHERE id = $1",
      [session.guest_id]
    );

    const guest = guestResult.rows[0] ?? {};
    const savedData = session.form_data ?? {};

    res.json({
      success: true,
      data: {
        guestId: session.guest_id,
        prefill: { ...guest, ...(guest.properties as Record<string, unknown> ?? {}) },
        saved: savedData,
        status: session.status,
        expiresAt: session.expires_at,
      },
    });
  } catch (err) {
    handleExternalError(res, err);
  }
});

/**
 * PUT /api/guest-form
 * Partial save — merges submitted fields into the session's form_data JSONB.
 * Save-and-resume: guest can close the browser and come back.
 */
externalRouter.put("/guest-form", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: "Invalid or expired guest token." });
      return;
    }

    if (session.status !== "active") {
      res.status(400).json({ success: false, error: "This form has already been submitted." });
      return;
    }

    const partialData = req.body as Record<string, unknown>;

    await query(
      `UPDATE guest_form_sessions SET form_data = form_data || $1, last_saved_at = now() WHERE id = $2`,
      [JSON.stringify(partialData), session.id]
    );

    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    handleExternalError(res, err);
  }
});

/**
 * POST /api/guest-form/submit
 * Final submission — validates, persists to guest record, fires event.
 */
externalRouter.post("/guest-form/submit", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: "Invalid or expired guest token." });
      return;
    }

    if (session.status !== "active") {
      res.status(400).json({ success: false, error: "This form has already been submitted." });
      return;
    }

    const formData = {
      ...(session.form_data as Record<string, unknown>),
      ...(req.body as Record<string, unknown>),
    };

    // Update guest record with form data
    await query(
      `UPDATE guests SET properties = properties || $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(formData), session.guest_id]
    );

    // Mark session as submitted
    await query(
      `UPDATE guest_form_sessions SET status = 'submitted', submitted_at = now(), form_data = $1 WHERE id = $2`,
      [JSON.stringify(formData), session.id]
    );

    // Fire event
    const event = createDomainEvent({
      eventName: "guest.intake_received",
      domain: "guest",
      action: "intake_received",
      recordId: session.guest_id as string,
      newValues: formData,
      triggeredBy: "guest_self_service",
    });
    await emit(event);

    res.json({ success: true, data: { submitted: true } });
  } catch (err) {
    handleExternalError(res, err);
  }
});

// --- Driver Pickup Endpoints ---

/**
 * GET /api/driver/pickup
 * Returns minimal booking data for the driver's assigned pickups.
 */
externalRouter.get("/driver/pickup", async (req: Request, res: Response) => {
  try {
    const session = await resolveDriverSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: "Invalid or expired driver token." });
      return;
    }

    const bookingIds = session.booking_ids as string[];
    if (bookingIds.length === 0) {
      res.json({ success: true, data: { bookings: [] } });
      return;
    }

    const result = await query(
      `SELECT id, guest_id, booking_type, status, pickup_location, dropoff_location,
              scheduled_time, flight_number, flight_status
       FROM transport_bookings
       WHERE id = ANY($1) AND NOT archived`,
      [bookingIds]
    );

    // Fetch guest names for display (minimal data)
    const guestIds = [...new Set(result.rows.map((r) => r.guest_id as string))];
    const guestsResult = guestIds.length > 0
      ? await query("SELECT id, name FROM guests WHERE id = ANY($1)", [guestIds])
      : { rows: [] };
    const guestNames = new Map(guestsResult.rows.map((r) => [r.id as string, r.name as string]));

    const bookings = result.rows.map((row) => ({
      bookingId: row.id,
      guestName: guestNames.get(row.guest_id as string) ?? "Guest",
      bookingType: row.booking_type,
      status: row.status,
      pickupLocation: row.pickup_location,
      dropoffLocation: row.dropoff_location,
      scheduledTime: row.scheduled_time,
      flightNumber: row.flight_number,
      flightStatus: row.flight_status,
    }));

    res.json({ success: true, data: { driverName: session.driver_name, bookings } });
  } catch (err) {
    handleExternalError(res, err);
  }
});

/**
 * POST /api/driver/pickup/transition
 * Transitions a booking status: waiting -> picked_up -> dropped_off
 */
externalRouter.post("/driver/pickup/transition", async (req: Request, res: Response) => {
  try {
    const session = await resolveDriverSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: "Invalid or expired driver token." });
      return;
    }

    const { bookingId, newStatus } = req.body as { bookingId?: string; newStatus?: string };
    if (!bookingId || !newStatus) {
      res.status(400).json({ success: false, error: "bookingId and newStatus are required." });
      return;
    }

    const validTransitions: Record<string, string[]> = {
      waiting: ["picked_up", "cancelled"],
      picked_up: ["dropped_off"],
      dispatched: ["waiting"],
    };

    // Verify booking belongs to this driver
    const bookingIds = session.booking_ids as string[];
    if (!bookingIds.includes(bookingId)) {
      res.status(403).json({ success: false, error: "Booking not assigned to this driver." });
      return;
    }

    const current = await query(
      "SELECT status FROM transport_bookings WHERE id = $1",
      [bookingId]
    );
    if (current.rows.length === 0) {
      res.status(404).json({ success: false, error: "Booking not found." });
      return;
    }

    const currentStatus = current.rows[0].status as string;
    const allowed = validTransitions[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      res.status(400).json({
        success: false,
        error: `Cannot transition from "${currentStatus}" to "${newStatus}".`,
      });
      return;
    }

    await query(
      "UPDATE transport_bookings SET status = $1, updated_at = now() WHERE id = $2",
      [newStatus, bookingId]
    );

    const event = createDomainEvent({
      eventName: `transport_booking.${newStatus}`,
      domain: "transport_booking",
      action: "updated",
      recordId: bookingId,
      changedFields: ["status"],
      previousValues: { status: currentStatus },
      newValues: { status: newStatus },
      triggeredBy: `driver:${session.driver_name}`,
    });
    await emit(event);

    res.json({ success: true, data: { bookingId, status: newStatus } });
  } catch (err) {
    handleExternalError(res, err);
  }
});

// --- Session Resolution ---

async function resolveGuestSession(req: Request): Promise<Record<string, unknown> | null> {
  const token = req.headers["x-guest-token"] as string | undefined;
  if (!token) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await query(
    `SELECT * FROM guest_form_sessions WHERE token_hash = $1 AND status != 'expired' AND expires_at > now()`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

async function resolveDriverSession(req: Request): Promise<Record<string, unknown> | null> {
  const token = req.headers["x-driver-token"] as string | undefined;
  if (!token) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await query(
    `SELECT * FROM driver_sessions WHERE token_hash = $1 AND status = 'active' AND expires_at > now()`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

function handleExternalError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("External surface error", { error: message });
  res.status(500).json({ success: false, error: "An error occurred." });
}
