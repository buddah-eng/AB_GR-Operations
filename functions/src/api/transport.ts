/**
 * Transport Booking API Router
 *
 * RESTful endpoints for transport booking management:
 *   GET    /api/transport                  — list bookings with filters
 *   GET    /api/transport/:id              — get single booking
 *   GET    /api/transport/guest/:guestId   — bookings for a guest
 *   GET    /api/transport/driver/:name     — active bookings for a driver
 *   POST   /api/transport                  — create booking
 *   PUT    /api/transport/:id/status       — transition booking status
 *
 * All endpoints require authentication. Mutations require coordinator+ (priority 20).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware";
import {
  auditContextFromRequest,
  withAuditContext,
  logAuditClaim,
} from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  createBooking,
  transitionBookingStatus,
  getBookingById,
  getBookingsForGuest,
  getActiveDriverBookings,
  listBookings,
} from "../services/transport";

// --- Validation schemas ---

const createBookingSchema = z.object({
  guest_id: z.string().uuid("Invalid guest ID format"),
  booking_type: z.enum(["arrival", "departure", "inter_venue"]),
  pickup_location: z.string().optional(),
  dropoff_location: z.string().optional(),
  scheduled_time: z.string().optional(),
  driver_name: z.string().optional(),
  vehicle_info: z.string().optional(),
  flight_number: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const transitionStatusSchema = z.object({
  status: z.enum([
    "requested",
    "confirmed",
    "dispatched",
    "waiting",
    "picked_up",
    "dropped_off",
    "cancelled",
  ]),
});

// --- Router ---

export const transportRouter = Router();

transportRouter.use(requireAuth);

// --- GET /  —  list bookings ---

transportRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      status: req.query.status as string | undefined,
      archived: req.query.archived !== undefined
        ? req.query.archived === "true"
        : undefined,
    };

    const bookings = await listBookings(filters);

    res.json({
      success: true,
      data: bookings,
      meta: { total: bookings.length },
    });
  } catch (err: unknown) {
    handleError(res, err, "listing transport bookings");
  }
});

// --- GET /:id  —  get single booking ---

transportRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const booking = await getBookingById(req.params.id);

    if (!booking) {
      res.status(404).json({
        success: false,
        error: "Transport booking not found.",
      });
      return;
    }

    res.json({ success: true, data: booking });
  } catch (err: unknown) {
    handleError(res, err, "fetching transport booking");
  }
});

// --- GET /guest/:guestId  —  bookings for guest ---

transportRouter.get("/guest/:guestId", async (req: Request, res: Response) => {
  try {
    const bookings = await getBookingsForGuest(req.params.guestId);

    res.json({
      success: true,
      data: bookings,
      meta: { total: bookings.length },
    });
  } catch (err: unknown) {
    handleError(res, err, "fetching guest bookings");
  }
});

// --- GET /driver/:name  —  active bookings for driver ---

transportRouter.get("/driver/:name", async (req: Request, res: Response) => {
  try {
    const bookings = await getActiveDriverBookings(req.params.name);

    res.json({
      success: true,
      data: bookings,
      meta: { total: bookings.length },
    });
  } catch (err: unknown) {
    handleError(res, err, "fetching driver bookings");
  }
});

// --- POST /  —  create booking ---

transportRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = createBookingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const { guest_id, ...bookingData } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      const booking = await withAuditContext(auditCtx, async (client) => {
        return createBooking(
          guest_id,
          { ...bookingData, created_by: req.user?.uid },
          client
        );
      });

      await logAuditClaim(auditCtx, "POST /api/transport");

      const event = createDomainEvent({
        eventName: "transport_booking.created",
        domain: "transport_booking",
        action: "created",
        recordId: booking.id,
        newValues: booking as unknown as Record<string, unknown>,
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: booking });
    } catch (err: unknown) {
      handleError(res, err, "creating transport booking");
    }
  }
);

// --- PUT /:id/status  —  transition status ---

transportRouter.put(
  "/:id/status",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = transitionStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const bookingId = req.params.id;
      const { status: newStatus } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      // Fetch current state for event
      const currentBooking = await getBookingById(bookingId);
      if (!currentBooking) {
        res.status(404).json({
          success: false,
          error: "Transport booking not found.",
        });
        return;
      }

      const previousStatus = currentBooking.status;

      let updatedBooking;
      try {
        updatedBooking = await withAuditContext(auditCtx, async (client) => {
          return transitionBookingStatus(bookingId, newStatus, client);
        });
      } catch (transitionErr: unknown) {
        const message = transitionErr instanceof Error
          ? transitionErr.message
          : String(transitionErr);
        if (message.includes("Invalid status transition")) {
          res.status(409).json({ success: false, error: message });
          return;
        }
        throw transitionErr;
      }

      await logAuditClaim(auditCtx, "PUT /api/transport/:id/status");

      const event = createDomainEvent({
        eventName: `transport_booking.${newStatus}`,
        domain: "transport_booking",
        action: "updated",
        recordId: bookingId,
        changedFields: ["status"],
        previousValues: { status: previousStatus },
        newValues: { status: newStatus },
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: {
          ...updatedBooking,
          previousStatus,
        },
      });
    } catch (err: unknown) {
      handleError(res, err, "transitioning transport booking status");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Internal error while ${context}.`,
  });
}
