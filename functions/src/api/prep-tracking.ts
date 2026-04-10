/**
 * Prep Tracking API Router
 *
 * RESTful endpoints for preparation item management:
 *   GET    /api/prep/guest/:guestId      — list prep items for a guest
 *   GET    /api/prep/guest/:guestId/rate — completion rate for a guest
 *   GET    /api/prep/overdue             — all overdue items
 *   GET    /api/prep/departments         — completion by department
 *   GET    /api/prep/:id                 — single prep item
 *   POST   /api/prep/guest/:guestId      — batch create prep items from template
 *   PUT    /api/prep/:id/status          — update prep item status
 *   POST   /api/prep/mark-overdue        — mark overdue items
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
  createPrepItems,
  updatePrepItemStatus,
  getCompletionRate,
  getPrepItemsByGuest,
  getPrepItemById,
  getOverdueItems,
  getCompletionByDepartment,
  markOverdueItems,
} from "../services/prep-tracking";

// --- Validation schemas ---

const templateItemSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  category: z.string().optional(),
  due_date: z.string().optional(),
  assigned_to: z.string().optional(),
  auto_complete_event: z.string().optional(),
});

const batchCreateSchema = z.object({
  items: z.array(templateItemSchema).min(1, "At least one item is required"),
});

const updateStatusSchema = z.object({
  status: z.enum(["incomplete", "complete", "overdue", "na"]),
});

// --- Router ---

export const prepTrackingRouter = Router();

prepTrackingRouter.use(requireAuth);

// --- GET /overdue  —  all overdue items ---

prepTrackingRouter.get("/overdue", async (_req: Request, res: Response) => {
  try {
    const items = await getOverdueItems();

    res.json({ success: true, data: items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get overdue items failed", { error: message });
    res.status(500).json({ success: false, error: `Get overdue items failed: ${message}` });
  }
});

// --- GET /departments  —  completion by department ---

prepTrackingRouter.get("/departments", async (_req: Request, res: Response) => {
  try {
    const data = await getCompletionByDepartment();

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get completion by department failed", { error: message });
    res.status(500).json({ success: false, error: `Get completion by department failed: ${message}` });
  }
});

// --- GET /guest/:guestId/rate  —  completion rate for a guest ---

prepTrackingRouter.get("/guest/:guestId/rate", async (req: Request, res: Response) => {
  try {
    const rate = await getCompletionRate(req.params.guestId);

    res.json({ success: true, data: rate });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get completion rate failed", { error: message });
    res.status(500).json({ success: false, error: `Get completion rate failed: ${message}` });
  }
});

// --- GET /guest/:guestId  —  list prep items for a guest ---

prepTrackingRouter.get("/guest/:guestId", async (req: Request, res: Response) => {
  try {
    const items = await getPrepItemsByGuest(req.params.guestId);

    res.json({ success: true, data: items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get prep items by guest failed", { error: message });
    res.status(500).json({ success: false, error: `Get prep items by guest failed: ${message}` });
  }
});

// --- GET /:id  —  single prep item ---

prepTrackingRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const item = await getPrepItemById(req.params.id);

    if (!item) {
      res.status(404).json({ success: false, error: "Prep item not found." });
      return;
    }

    res.json({ success: true, data: item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get prep item failed", { error: message });
    res.status(500).json({ success: false, error: `Get prep item failed: ${message}` });
  }
});

// --- POST /guest/:guestId  —  batch create prep items (coordinator+) ---

prepTrackingRouter.post(
  "/guest/:guestId",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = batchCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const items = await withAuditContext(auditCtx, (client) =>
        createPrepItems(req.params.guestId, parsed.data.items, client)
      );

      await logAuditClaim(auditCtx, `POST /api/prep/guest/${req.params.guestId}`);

      const event = createDomainEvent({
        eventName: "prep_item.batch_created",
        domain: "prep_item",
        action: "created",
        recordId: req.params.guestId,
        newValues: { count: items.length, items: parsed.data.items.map((i) => i.name) },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create prep items failed", { error: message });
      res.status(500).json({ success: false, error: `Create prep items failed: ${message}` });
    }
  }
);

// --- PUT /:id/status  —  update prep item status (coordinator+) ---

prepTrackingRouter.put(
  "/:id/status",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const item = await withAuditContext(auditCtx, (client) =>
        updatePrepItemStatus(req.params.id, parsed.data.status, client)
      );

      if (!item) {
        res.status(404).json({ success: false, error: "Prep item not found." });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/prep/${req.params.id}/status`);

      const event = createDomainEvent({
        eventName: "prep_item.status_changed",
        domain: "prep_item",
        action: "updated",
        recordId: req.params.id,
        newValues: { status: parsed.data.status },
        changedFields: ["status"],
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: item });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Update prep item status failed", { error: message });
      res.status(500).json({ success: false, error: `Update prep item status failed: ${message}` });
    }
  }
);

// --- POST /mark-overdue  —  mark all overdue items (coordinator+) ---

prepTrackingRouter.post(
  "/mark-overdue",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const count = await withAuditContext(auditCtx, (client) =>
        markOverdueItems(client)
      );

      await logAuditClaim(auditCtx, "POST /api/prep/mark-overdue");

      if (count > 0) {
        const event = createDomainEvent({
          eventName: "prep_item.overdue_batch",
          domain: "prep_item",
          action: "updated",
          recordId: "batch",
          newValues: { count, status: "overdue" },
          triggeredBy: req.user?.email ?? "system",
          changeSet: auditCtx.changeSet,
        });
        await emit(event);
      }

      res.json({ success: true, data: { updated: count } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Mark overdue items failed", { error: message });
      res.status(500).json({ success: false, error: `Mark overdue items failed: ${message}` });
    }
  }
);
