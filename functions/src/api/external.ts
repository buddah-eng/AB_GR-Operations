/**
 * External Surfaces Router
 *
 * Token-scoped endpoints for non-staff users:
 *   GET    /api/external/guest-form           — prefill + saved form data
 *   PUT    /api/external/guest-form           — partial save (JSONB merge)
 *   POST   /api/external/guest-form/submit    — final submission
 *   GET    /api/external/driver/pickup         — driver's assigned bookings
 *   POST   /api/external/driver/pickup/transition — status transition
 *
 * Auth: X-Guest-Token / X-Driver-Token headers, SHA-256 hash lookup.
 * Rate limit: 30 req/min per IP.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";
import {
  auditContextFromRequest,
  withAuditContext,
  logAuditClaim,
} from "../audit/context";
import {
  encryptPiiFields,
  decryptPiiFields,
  isEncryptionConfigured,
} from "../encryption/crypto";

// --- Types ---

interface GuestFormSession {
  readonly id: string;
  readonly token_hash: string;
  readonly guest_id: string;
  readonly form_data: Record<string, unknown>;
  readonly status: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly submitted_at: Date | null;
  readonly last_saved_at: Date | null;
}

interface DriverSession {
  readonly id: string;
  readonly token_hash: string;
  readonly driver_name: string;
  readonly booking_ids: string[];
  readonly status: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

interface TransportBooking {
  readonly id: string;
  readonly guest_id: string;
  readonly booking_type: string;
  readonly status: string;
  readonly pickup_location: string | null;
  readonly dropoff_location: string | null;
  readonly scheduled_time: Date | null;
  readonly driver_name: string | null;
  readonly vehicle_info: string | null;
  readonly flight_number: string | null;
  readonly properties: Record<string, unknown>;
}

// --- Rate limiter ---

interface RateLimitEntry {
  readonly count: number;
  readonly windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    next();
    return;
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }

  rateLimitStore.set(ip, {
    count: existing.count + 1,
    windowStart: existing.windowStart,
  });
  next();
}

/** Exported for testing: reset rate limit state. */
export function resetRateLimits(): void {
  rateLimitStore.clear();
}

// --- Token helpers ---

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// --- Router ---

export const externalRouter = Router();

externalRouter.use(rateLimit);

// ============================================================================
// Guest Form Endpoints
// ============================================================================

/**
 * GET /guest-form
 * Returns prefill data merged with saved form data.
 */
externalRouter.get("/guest-form", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req, res);
    if (!session) return;

    // Fetch guest record for prefill
    const guestResult = await query(
      "SELECT id, name, type, department, email, phone, company, properties FROM guests WHERE id = $1 AND NOT archived",
      [session.guest_id]
    );

    const prefill: Record<string, unknown> = {};
    if (guestResult.rows.length > 0) {
      const guest = guestResult.rows[0];
      if (guest.name) prefill.name = guest.name;
      if (guest.email) prefill.email = guest.email;
      if (guest.phone) prefill.phone = guest.phone;
      if (guest.company) prefill.company = guest.company;
      if (guest.department) prefill.department = guest.department;
      if (guest.type) prefill.type = guest.type;
      const guestProps = (guest.properties ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(guestProps)) {
        if (v !== null && v !== undefined) {
          prefill[k] = v;
        }
      }
    }

    // Fetch YoY registry data for additional prefill
    const registryResult = await query(
      `SELECT gr.dietary, gr.travel_prefs, gr.properties
       FROM guest_registry gr
       JOIN guests g ON g.registry_id = gr.id
       WHERE g.id = $1`,
      [session.guest_id]
    );

    if (registryResult.rows.length > 0) {
      const registry = registryResult.rows[0];
      if (registry.dietary && !prefill.dietary) {
        prefill.dietary = registry.dietary;
      }
      const travelPrefs = (registry.travel_prefs ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(travelPrefs)) {
        if (v !== null && v !== undefined && !(k in prefill)) {
          prefill[k] = v;
        }
      }
      const regProps = (registry.properties ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(regProps)) {
        if (v !== null && v !== undefined && !(k in prefill)) {
          prefill[k] = v;
        }
      }
    }

    // Merge: prefill is overridden by saved form_data
    const merged = { ...prefill, ...session.form_data };

    // Decrypt PII fields before responding if encryption is configured
    const decryptedMerged = isEncryptionConfigured()
      ? decryptPiiFields(merged, { recordId: session.guest_id, actorId: `guest:${session.guest_id}` })
      : merged;
    const decryptedPrefill = isEncryptionConfigured()
      ? decryptPiiFields(prefill, { recordId: session.guest_id, actorId: `guest:${session.guest_id}` })
      : prefill;

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        guestId: session.guest_id,
        status: session.status,
        formData: decryptedMerged,
        prefill: decryptedPrefill,
      },
    });
  } catch (err) {
    handleError(res, err, "fetching guest form");
  }
});

/**
 * PUT /guest-form
 * Partial save — merges submitted keys into existing form_data JSONB.
 */
externalRouter.put("/guest-form", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req, res);
    if (!session) return;

    if (session.status === "submitted") {
      res.status(409).json({ success: false, error: "Form already submitted." });
      return;
    }

    if (session.status === "expired") {
      res.status(410).json({ success: false, error: "Form session has expired." });
      return;
    }

    const partialData = req.body as Record<string, unknown>;
    if (!partialData || typeof partialData !== "object" || Array.isArray(partialData)) {
      res.status(400).json({ success: false, error: "Request body must be a JSON object." });
      return;
    }

    const result = await query(
      `UPDATE guest_form_sessions
       SET form_data = form_data || $1::jsonb,
           last_saved_at = now()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(partialData), session.id]
    );

    const updated = result.rows[0] as unknown as GuestFormSession;

    // Fire save event
    const event = createDomainEvent({
      eventName: "guest_form.saved",
      domain: "guest_form",
      action: "updated",
      recordId: session.id,
      newValues: partialData,
      triggeredBy: `guest:${session.guest_id}`,
    });
    await emit(event);

    res.json({
      success: true,
      data: {
        sessionId: updated.id,
        formData: updated.form_data,
        lastSavedAt: updated.last_saved_at,
      },
    });
  } catch (err) {
    handleError(res, err, "saving guest form");
  }
});

/**
 * POST /guest-form/submit
 * Final submission — validates, updates guest record, fires event.
 */
externalRouter.post("/guest-form/submit", async (req: Request, res: Response) => {
  try {
    const session = await resolveGuestSession(req, res);
    if (!session) return;

    if (session.status === "submitted") {
      res.status(409).json({ success: false, error: "Form already submitted." });
      return;
    }

    if (session.status === "expired") {
      res.status(410).json({ success: false, error: "Form session has expired." });
      return;
    }

    // Merge any final data from the request body into form_data
    const finalData = req.body as Record<string, unknown> | undefined;
    const mergedFormData = finalData && typeof finalData === "object" && !Array.isArray(finalData)
      ? { ...session.form_data, ...finalData }
      : session.form_data;

    // Build audit context for the write pipeline
    const auditCtx = auditContextFromRequest(req);

    // Encrypt PII fields before DB write if encryption is configured
    const encryptedFormData = isEncryptionConfigured()
      ? encryptPiiFields(mergedFormData)
      : mergedFormData;

    // Use withAuditContext for the transactional write
    await withAuditContext(auditCtx, async (client) => {
      // Mark session as submitted
      await client.query(
        `UPDATE guest_form_sessions
         SET status = 'submitted',
             form_data = $1::jsonb,
             submitted_at = now(),
             last_saved_at = now()
         WHERE id = $2`,
        [JSON.stringify(encryptedFormData), session.id]
      );

      // Update the guest record with submitted form data
      await client.query(
        `UPDATE guests
         SET properties = properties || $1::jsonb,
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(encryptedFormData), session.guest_id]
      );
    });

    // Log audit claim
    await logAuditClaim(auditCtx, "POST /api/external/guest-form/submit");

    // Fire domain event with changeSet
    const event = createDomainEvent({
      eventName: "guest_form.submitted",
      domain: "guest_form",
      action: "completed",
      recordId: session.id,
      newValues: mergedFormData,
      triggeredBy: `guest:${session.guest_id}`,
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        status: "submitted",
        submittedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    handleError(res, err, "submitting guest form");
  }
});

// ============================================================================
// Driver Pickup Endpoints
// ============================================================================

/**
 * GET /driver/pickup
 * Returns the driver's assigned bookings with guest names.
 */
externalRouter.get("/driver/pickup", async (req: Request, res: Response) => {
  try {
    const session = await resolveDriverSession(req, res);
    if (!session) return;

    if (session.booking_ids.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch bookings with guest names — only expose allowed fields
    const bookingsResult = await query(
      `SELECT
         tb.id AS booking_id,
         g.name AS guest_name,
         tb.status AS current_status,
         tb.pickup_location,
         tb.dropoff_location,
         tb.scheduled_time,
         tb.flight_number,
         tb.properties->>'instructions' AS instructions,
         tb.properties->>'flight_status' AS flight_status
       FROM transport_bookings tb
       JOIN guests g ON g.id = tb.guest_id
       WHERE tb.id = ANY($1)
       ORDER BY tb.scheduled_time ASC NULLS LAST`,
      [session.booking_ids]
    );

    const bookings = bookingsResult.rows.map((row) => ({
      bookingId: row.booking_id as string,
      guestName: row.guest_name as string,
      currentStatus: row.current_status as string,
      pickupLocation: (row.pickup_location as string) ?? null,
      dropoffLocation: (row.dropoff_location as string) ?? null,
      scheduledTime: row.scheduled_time
        ? (row.scheduled_time as Date).toISOString()
        : null,
      flightNumber: (row.flight_number as string) ?? null,
      flightStatus: (row.flight_status as string) ?? "unknown",
      instructions: (row.instructions as string) ?? null,
    }));

    res.json({ success: true, data: bookings });
  } catch (err) {
    handleError(res, err, "fetching driver pickups");
  }
});

/**
 * POST /driver/pickup/transition
 * Advances a booking's pickup status to the next valid state.
 * Body: { bookingId: string }
 */
externalRouter.post(
  "/driver/pickup/transition",
  async (req: Request, res: Response) => {
    try {
      const session = await resolveDriverSession(req, res);
      if (!session) return;

      const { bookingId } = req.body as { bookingId?: string };
      if (!bookingId) {
        res.status(400).json({
          success: false,
          error: "Missing required field: bookingId.",
        });
        return;
      }

      // Verify the booking is assigned to this driver
      if (!session.booking_ids.includes(bookingId)) {
        res.status(403).json({
          success: false,
          error: "Booking not assigned to this driver.",
        });
        return;
      }

      // Fetch current booking status
      const bookingResult = await query(
        "SELECT id, status, guest_id FROM transport_bookings WHERE id = $1",
        [bookingId]
      );

      if (bookingResult.rows.length === 0) {
        res.status(404).json({ success: false, error: "Booking not found." });
        return;
      }

      const booking = bookingResult.rows[0] as unknown as TransportBooking;
      const nextStatus = getNextTransportStatus(booking.status);

      if (!nextStatus) {
        res.status(409).json({
          success: false,
          error: `No further transitions from status "${booking.status}".`,
        });
        return;
      }

      // Build audit context for the write pipeline
      const auditCtx = auditContextFromRequest(req);

      await withAuditContext(auditCtx, async (client) => {
        await client.query(
          `UPDATE transport_bookings SET status = $1, updated_at = now() WHERE id = $2`,
          [nextStatus, bookingId]
        );
      });

      // Log audit claim
      await logAuditClaim(
        auditCtx,
        "POST /api/external/driver/pickup/transition"
      );

      // Determine event name based on transition
      const eventName =
        nextStatus === "picked_up"
          ? "driver.pickup.picked_up"
          : "driver.pickup.dropped_off";

      const event = createDomainEvent({
        eventName,
        domain: "transport_booking",
        action: "updated",
        recordId: bookingId,
        changedFields: ["status"],
        previousValues: { status: booking.status },
        newValues: { status: nextStatus },
        triggeredBy: `driver:${session.driver_name}`,
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: {
          bookingId,
          previousStatus: booking.status,
          currentStatus: nextStatus,
        },
      });
    } catch (err) {
      handleError(res, err, "transitioning pickup status");
    }
  }
);

// ============================================================================
// Shared Helpers
// ============================================================================

const VALID_TRANSITIONS: Readonly<Record<string, string>> = {
  waiting: "picked_up",
  picked_up: "dropped_off",
};

function getNextTransportStatus(current: string): string | null {
  return VALID_TRANSITIONS[current] ?? null;
}

async function resolveGuestSession(
  req: Request,
  res: Response
): Promise<GuestFormSession | null> {
  const token = req.headers["x-guest-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT * FROM guest_form_sessions WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  // Attach actor info to request for audit context
  const session = result.rows[0] as unknown as GuestFormSession;
  req.user = {
    uid: `guest:${session.guest_id}`,
    email: `guest:${session.guest_id}@external.internal`,
  };
  req.actorType = "external_token";

  return session;
}

async function resolveDriverSession(
  req: Request,
  res: Response
): Promise<DriverSession | null> {
  const token = req.headers["x-driver-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT * FROM driver_sessions WHERE token_hash = $1 AND status = 'active' AND expires_at > now()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  const session = result.rows[0] as unknown as DriverSession;
  req.user = {
    uid: `driver:${session.id}`,
    email: `driver:${session.id}@external.internal`,
    name: session.driver_name,
  };
  req.actorType = "external_token";

  return session;
}

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Internal error while ${context}.`,
  });
}

// Exported for testing
export { hashToken, getNextTransportStatus };
