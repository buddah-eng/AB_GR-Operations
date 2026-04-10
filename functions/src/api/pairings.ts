/**
 * Pairings API Router
 *
 * RESTful endpoints for guest-staff pairing management:
 *   GET    /api/pairings/guest/:guestId    — pairings for a guest
 *   GET    /api/pairings/staff/:staffId    — assignments for a staff member
 *   GET    /api/pairings/coverage/:guestId — coverage check
 *   GET    /api/pairings/:id               — single pairing
 *   POST   /api/pairings                   — assign staff to guest
 *   DELETE /api/pairings/:id               — remove (archive) pairing
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
  assignStaff,
  removeStaff,
  getGuestPairings,
  getStaffAssignments,
  checkCoverage,
  getPairingById,
} from "../services/pairings";

// --- Validation schemas ---

const assignStaffSchema = z.object({
  guest_id: z.string().min(1, "guest_id is required"),
  staff_id: z.string().min(1, "staff_id is required"),
  role: z.string().min(1, "role is required"),
});

// --- Router ---

export const pairingsRouter = Router();

pairingsRouter.use(requireAuth);

// --- GET /guest/:guestId  —  pairings for a guest ---

pairingsRouter.get("/guest/:guestId", async (req: Request, res: Response) => {
  try {
    const pairings = await getGuestPairings(req.params.guestId);

    res.json({ success: true, data: pairings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get guest pairings failed", { error: message });
    res.status(500).json({ success: false, error: `Get guest pairings failed: ${message}` });
  }
});

// --- GET /staff/:staffId  —  assignments for a staff member ---

pairingsRouter.get("/staff/:staffId", async (req: Request, res: Response) => {
  try {
    const assignments = await getStaffAssignments(req.params.staffId);

    res.json({ success: true, data: assignments });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get staff assignments failed", { error: message });
    res.status(500).json({ success: false, error: `Get staff assignments failed: ${message}` });
  }
});

// --- GET /coverage/:guestId  —  coverage check ---

pairingsRouter.get("/coverage/:guestId", async (req: Request, res: Response) => {
  try {
    const rolesParam = req.query.required_roles as string | undefined;

    if (!rolesParam) {
      res.status(400).json({
        success: false,
        error: 'Missing required query param: "required_roles" (comma-separated list)',
      });
      return;
    }

    const requiredRoles = rolesParam.split(",").map((r) => r.trim()).filter(Boolean);

    if (requiredRoles.length === 0) {
      res.status(400).json({
        success: false,
        error: "At least one role is required in required_roles",
      });
      return;
    }

    const coverage = await checkCoverage(req.params.guestId, requiredRoles);

    res.json({ success: true, data: coverage });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Check coverage failed", { error: message });
    res.status(500).json({ success: false, error: `Check coverage failed: ${message}` });
  }
});

// --- GET /:id  —  single pairing ---

pairingsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const pairing = await getPairingById(req.params.id);

    if (!pairing) {
      res.status(404).json({ success: false, error: "Pairing not found." });
      return;
    }

    res.json({ success: true, data: pairing });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get pairing failed", { error: message });
    res.status(500).json({ success: false, error: `Get pairing failed: ${message}` });
  }
});

// --- POST /  —  assign staff to guest (coordinator+) ---

pairingsRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = assignStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const { guest_id, staff_id, role } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      const pairing = await withAuditContext(auditCtx, (client) =>
        assignStaff(guest_id, staff_id, role, client)
      );

      await logAuditClaim(auditCtx, "POST /api/pairings");

      const event = createDomainEvent({
        eventName: "pairing.created",
        domain: "pairing",
        action: "created",
        recordId: pairing.id,
        newValues: { guest_id, staff_id, role },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: pairing });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Assign staff failed", { error: message });
      res.status(500).json({ success: false, error: `Assign staff failed: ${message}` });
    }
  }
);

// --- DELETE /:id  —  remove (archive) pairing (coordinator+) ---

pairingsRouter.delete(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const removed = await withAuditContext(auditCtx, (client) =>
        removeStaff(req.params.id, client)
      );

      if (!removed) {
        res.status(404).json({ success: false, error: "Pairing not found." });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/pairings/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "pairing.removed",
        domain: "pairing",
        action: "deleted",
        recordId: req.params.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Remove pairing failed", { error: message });
      res.status(500).json({ success: false, error: `Remove pairing failed: ${message}` });
    }
  }
);
