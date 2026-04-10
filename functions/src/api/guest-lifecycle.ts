/**
 * Guest Lifecycle API Router
 *
 * RESTful endpoints for guest lifecycle management:
 *   GET    /api/guests              — list guests by status
 *   GET    /api/guests/:id          — get guest record
 *   GET    /api/guests/:id/summary  — get guest summary with prep/pairing/schedule stats
 *   POST   /api/guests              — create guest
 *   PUT    /api/guests/:id/status   — transition guest status
 *
 * All endpoints require authentication. Mutations require coordinator+ (priority 20).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  transitionGuestStatus,
  getGuestsByStatus,
  getGuestById,
  getGuestSummary,
  createGuest,
  isValidTransition,
  getValidTransitions,
} from "../services/guest-lifecycle";
import type { GuestStatus } from "../services/guest-lifecycle";

// --- Validation schemas ---

const createGuestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["JP", "NA", "other"]).optional(),
  department: z.string().optional(),
  company: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const transitionStatusSchema = z.object({
  status: z.enum([
    "draft", "invited", "confirmed", "travel_arranged",
    "arrived", "attending", "departed", "declined", "canceled",
  ]),
});

const statusFilterSchema = z.enum([
  "draft", "invited", "confirmed", "travel_arranged",
  "arrived", "attending", "departed", "declined", "canceled",
]);

// --- Router ---

export const guestLifecycleRouter = Router();

guestLifecycleRouter.use(requireAuth);

// --- GET /  —  list guests by status ---

guestLifecycleRouter.get("/", async (req: Request, res: Response) => {
  try {
    const statusParam = req.query.status as string | undefined;

    if (statusParam) {
      const parsed = statusFilterSchema.safeParse(statusParam);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: `Invalid status value: "${statusParam}". Valid values: draft, invited, confirmed, travel_arranged, arrived, attending, departed, declined, canceled`,
        });
        return;
      }

      const guests = await getGuestsByStatus(parsed.data as GuestStatus);
      res.json({ success: true, data: guests });
      return;
    }

    // No status filter: return all non-archived guests
    const guests = await getGuestsByStatus("draft" as GuestStatus);
    // This is a simplification - in practice we'd have a listGuests function
    // For now, return empty with a hint
    res.json({
      success: true,
      data: guests,
      hint: "Pass ?status=<status> to filter by status",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("List guests failed", { error: message });
    res.status(500).json({ success: false, error: `List guests failed: ${message}` });
  }
});

// --- GET /:id/summary  —  guest summary ---

guestLifecycleRouter.get("/:id/summary", async (req: Request, res: Response) => {
  try {
    const summary = await getGuestSummary(req.params.id);

    if (!summary) {
      res.status(404).json({ success: false, error: "Guest not found." });
      return;
    }

    res.json({ success: true, data: summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get guest summary failed", { error: message });
    res.status(500).json({ success: false, error: `Get guest summary failed: ${message}` });
  }
});

// --- GET /:id  —  single guest record ---

guestLifecycleRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const guest = await getGuestById(req.params.id);

    if (!guest) {
      res.status(404).json({ success: false, error: "Guest not found." });
      return;
    }

    res.json({
      success: true,
      data: guest,
      validTransitions: getValidTransitions(guest.status),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get guest failed", { error: message });
    res.status(500).json({ success: false, error: `Get guest failed: ${message}` });
  }
});

// --- POST /  —  create guest (coordinator+) ---

guestLifecycleRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = createGuestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const { name, type, department, company, properties } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      const guest = await withAuditContext(auditCtx, (client) =>
        createGuest(
          { name, type, department, company, properties, created_by: req.user?.uid },
          client
        )
      );

      await logAuditClaim(auditCtx, "POST /api/guests");

      const event = createDomainEvent({
        eventName: "guest.created",
        domain: "guest",
        action: "created",
        recordId: guest.id,
        newValues: { name, type, department, company },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: guest });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create guest failed", { error: message });
      res.status(500).json({ success: false, error: `Create guest failed: ${message}` });
    }
  }
);

// --- PUT /:id/status  —  transition guest status (coordinator+) ---

guestLifecycleRouter.put(
  "/:id/status",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = transitionStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const newStatus = parsed.data.status as GuestStatus;
      const auditCtx = auditContextFromRequest(req);

      // Pre-check: get current guest to provide better error context
      const currentGuest = await getGuestById(req.params.id);
      if (!currentGuest) {
        res.status(404).json({ success: false, error: "Guest not found." });
        return;
      }

      if (!isValidTransition(currentGuest.status, newStatus)) {
        res.status(400).json({
          success: false,
          error: `Invalid status transition: ${currentGuest.status} -> ${newStatus}`,
          currentStatus: currentGuest.status,
          validTransitions: getValidTransitions(currentGuest.status),
        });
        return;
      }

      const guest = await withAuditContext(auditCtx, (client) =>
        transitionGuestStatus(
          req.params.id,
          newStatus,
          req.user?.email ?? "system",
          client
        )
      );

      await logAuditClaim(auditCtx, `PUT /api/guests/${req.params.id}/status`);

      const event = createDomainEvent({
        eventName: `guest.status_changed`,
        domain: "guest",
        action: "updated",
        recordId: req.params.id,
        previousValues: { status: currentGuest.status },
        newValues: { status: newStatus },
        changedFields: ["status"],
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: guest,
        previousStatus: currentGuest.status,
        validTransitions: getValidTransitions(guest.status),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Transition guest status failed", { error: message });

      const statusCode = message.includes("Invalid status transition") || message.includes("not found") ? 400 : 500;
      res.status(statusCode).json({ success: false, error: message });
    }
  }
);
