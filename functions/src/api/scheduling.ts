/**
 * Scheduling API Router
 *
 * RESTful endpoints for schedule event management and conflict detection:
 *   GET    /api/scheduling/conflicts       — detect room conflicts
 *   GET    /api/scheduling/range           — events in date range
 *   GET    /api/scheduling/guest/:guestId  — schedule for a guest
 *   POST   /api/scheduling                 — create schedule event
 *   PUT    /api/scheduling/:id             — update schedule event
 *
 * All endpoints require authentication. Mutations require coordinator+ (priority 20).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  detectRoomConflicts,
  getScheduleForDateRange,
  getScheduleForGuest,
  createScheduleEvent,
  updateScheduleEvent,
} from "../services/scheduling";

// --- Router ---

export const schedulingRouter = Router();

schedulingRouter.use(requireAuth);

// --- GET /conflicts  —  detect room conflicts ---

schedulingRouter.get("/conflicts", async (req: Request, res: Response) => {
  try {
    const { venue_id, start_time, end_time, exclude_event_id } = req.query as {
      venue_id?: string;
      start_time?: string;
      end_time?: string;
      exclude_event_id?: string;
    };

    if (!venue_id || !start_time || !end_time) {
      res.status(400).json({
        success: false,
        error: 'Missing required query params: "venue_id", "start_time", "end_time".',
      });
      return;
    }

    const conflicts = await detectRoomConflicts(venue_id, start_time, end_time, exclude_event_id);

    res.json({
      success: true,
      data: { conflicts, has_conflicts: conflicts.length > 0 },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Detect conflicts failed", { error: message });
    const statusCode = message.includes("Invalid date") || message.includes("must be after") ? 400 : 500;
    res.status(statusCode).json({ success: false, error: message });
  }
});

// --- GET /range  —  events in date range ---

schedulingRouter.get("/range", async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, venue_id, event_type, status } = req.query as {
      start_date?: string;
      end_date?: string;
      venue_id?: string;
      event_type?: string;
      status?: string;
    };

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: 'Missing required query params: "start_date", "end_date".',
      });
      return;
    }

    const result = await getScheduleForDateRange(start_date, end_date, {
      venue_id,
      event_type,
      status,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    res.json({
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        hasMore: (result.page - 1) * result.limit + result.data.length < result.total,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get schedule range failed", { error: message });
    res.status(500).json({ success: false, error: `Get schedule range failed: ${message}` });
  }
});

// --- GET /guest/:guestId  —  schedule for a guest ---

schedulingRouter.get("/guest/:guestId", async (req: Request, res: Response) => {
  try {
    const entries = await getScheduleForGuest(req.params.guestId);

    res.json({ success: true, data: entries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get guest schedule failed", { error: message });
    res.status(500).json({ success: false, error: `Get guest schedule failed: ${message}` });
  }
});

// --- POST /  —  create schedule event (coordinator+) ---

schedulingRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { name, event_type, venue_id, start_time, end_time, status, properties } = req.body as {
        name?: string;
        event_type?: string;
        venue_id?: string;
        start_time?: string;
        end_time?: string;
        status?: string;
        properties?: Record<string, unknown>;
      };

      if (!name || typeof name !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field: "name".' });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const result = await withAuditContext(auditCtx, (client) =>
        createScheduleEvent(
          {
            name,
            event_type,
            venue_id,
            start_time,
            end_time,
            status,
            properties,
            created_by: req.user?.uid,
          },
          client
        )
      );

      await logAuditClaim(auditCtx, "POST /api/scheduling");

      const event = createDomainEvent({
        eventName: "schedule.created",
        domain: "schedule",
        action: "created",
        recordId: result.event.id,
        newValues: { name, event_type, venue_id, start_time, end_time },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      const responseStatus = result.conflicts.length > 0 ? 201 : 201;
      res.status(responseStatus).json({
        success: true,
        data: result.event,
        conflicts: result.conflicts.length > 0 ? result.conflicts : undefined,
        warning: result.conflicts.length > 0
          ? `Created with ${result.conflicts.length} venue conflict(s) detected.`
          : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create schedule event failed", { error: message });
      res.status(500).json({ success: false, error: `Create schedule event failed: ${message}` });
    }
  }
);

// --- PUT /:id  —  update schedule event (coordinator+) ---

schedulingRouter.put(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const result = await withAuditContext(auditCtx, (client) =>
        updateScheduleEvent(req.params.id, req.body as Record<string, unknown>, client)
      );

      if (!result) {
        res.status(404).json({ success: false, error: "Schedule event not found." });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/scheduling/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "schedule.updated",
        domain: "schedule",
        action: "updated",
        recordId: req.params.id,
        newValues: req.body as Record<string, unknown>,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: result.event,
        conflicts: result.conflicts.length > 0 ? result.conflicts : undefined,
        warning: result.conflicts.length > 0
          ? `Updated with ${result.conflicts.length} venue conflict(s) detected.`
          : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Update schedule event failed", { error: message });
      res.status(500).json({ success: false, error: `Update schedule event failed: ${message}` });
    }
  }
);
