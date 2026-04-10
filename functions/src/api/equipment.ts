/**
 * Equipment API Router
 *
 * Checkout/return equipment, view overdue items, list by venue.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST (checkout/return): coordinator role (requireRole(10))
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
  checkoutEquipment,
  returnEquipment,
  getOverdueEquipment,
  listEquipmentByVenue,
} from "../services/equipment";

// --- Validation schemas ---

const checkoutSchema = z.object({
  equipmentId: z.string().min(1, "equipmentId is required"),
  staffId: z.string().min(1, "staffId is required"),
  dueBackAt: z.string().min(1, "dueBackAt is required").optional(),
});

const returnSchema = z.object({
  equipmentId: z.string().min(1, "equipmentId is required"),
});

// --- Router ---

export const equipmentRouter = Router();

equipmentRouter.use(requireAuth);

// --- GET /overdue --- get overdue equipment ---

equipmentRouter.get("/overdue", async (_req: Request, res: Response) => {
  try {
    const overdue = await getOverdueEquipment();
    res.json({ success: true, data: overdue });
  } catch (err: unknown) {
    handleError(res, err, "listing overdue equipment");
  }
});

// --- GET /venue/:venueId --- list equipment by venue ---

equipmentRouter.get("/venue/:venueId", async (req: Request, res: Response) => {
  try {
    const equipment = await listEquipmentByVenue(req.params.venueId);
    res.json({ success: true, data: equipment });
  } catch (err: unknown) {
    handleError(res, err, "listing equipment by venue");
  }
});

// --- POST /checkout --- checkout equipment ---

equipmentRouter.post(
  "/checkout",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: parsed.error.issues[0].message,
        });
        return;
      }
      const { equipmentId, staffId, dueBackAt } = parsed.data;

      const auditCtx = auditContextFromRequest(req);

      const result = await withAuditContext(auditCtx, async (client) =>
        checkoutEquipment(equipmentId, staffId, dueBackAt ?? new Date().toISOString(), client)
      );

      await logAuditClaim(auditCtx, "POST /api/equipment/checkout");

      const event = createDomainEvent({
        eventName: "equipment.checked_out",
        domain: "equipment",
        action: "updated",
        recordId: equipmentId,
        newValues: {
          status: "checked_out",
          checked_out_to: staffId,
          due_back_at: dueBackAt,
        },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "checking out equipment");
    }
  }
);

// --- POST /return --- return equipment ---

equipmentRouter.post(
  "/return",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const parsed = returnSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: parsed.error.issues[0].message,
        });
        return;
      }
      const { equipmentId } = parsed.data;

      const auditCtx = auditContextFromRequest(req);

      const result = await withAuditContext(auditCtx, async (client) =>
        returnEquipment(equipmentId, client)
      );

      await logAuditClaim(auditCtx, "POST /api/equipment/return");

      const eventName = result.wasOverdue
        ? "equipment.returned_overdue"
        : "equipment.returned";

      const event = createDomainEvent({
        eventName,
        domain: "equipment",
        action: "updated",
        recordId: equipmentId,
        newValues: {
          status: "available",
          wasOverdue: result.wasOverdue,
        },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "returning equipment");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  res.status(status ?? 500).json({
    success: false,
    error: `Internal error while ${context}: ${message}`,
  });
}
