/**
 * Volunteer API Router
 *
 * RESTful endpoints for volunteer management and shift assignment:
 *   GET    /api/volunteers                   — list volunteers
 *   GET    /api/volunteers/:id/skills        — get volunteer skills
 *   PUT    /api/volunteers/:id/training      — update training status
 *   GET    /api/volunteers/match/:shiftId    — match volunteers to shift
 *   POST   /api/volunteers/assign            — assign volunteer to shift
 *   GET    /api/volunteers/coverage/:shiftId — get shift coverage
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
  listVolunteers,
  getVolunteerSkills,
  updateTrainingStatus,
  matchVolunteersToShift,
  assignToShift,
  getShiftCoverage,
} from "../services/volunteers";

// --- Router ---

export const volunteerRouter = Router();

volunteerRouter.use(requireAuth);

// --- GET /  —  list volunteers ---

volunteerRouter.get("/", async (req: Request, res: Response) => {
  try {
    const skillsParam = req.query.skills as string | undefined;
    const filters = {
      training_status: req.query.training_status as string | undefined,
      active: req.query.active !== undefined
        ? req.query.active === "true"
        : undefined,
      department: req.query.department as string | undefined,
      skills: skillsParam ? skillsParam.split(",") : undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await listVolunteers(filters);

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
    logger.error("List volunteers failed", { error: message });
    res.status(500).json({ success: false, error: `List volunteers failed: ${message}` });
  }
});

// --- GET /:id/skills  —  get volunteer skills ---

volunteerRouter.get("/:id/skills", async (req: Request, res: Response) => {
  try {
    const skills = await getVolunteerSkills(req.params.id);

    if (skills === null) {
      res.status(404).json({ success: false, error: "Volunteer not found." });
      return;
    }

    res.json({ success: true, data: { volunteer_id: req.params.id, skills } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get volunteer skills failed", { error: message });
    res.status(500).json({ success: false, error: `Get volunteer skills failed: ${message}` });
  }
});

// --- PUT /:id/training  —  update training status (coordinator+) ---

volunteerRouter.put(
  "/:id/training",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { status } = req.body as { status?: string };

      if (!status || typeof status !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field: "status".' });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const volunteer = await withAuditContext(auditCtx, (client) =>
        updateTrainingStatus(req.params.id, status, client)
      );

      if (!volunteer) {
        res.status(404).json({ success: false, error: "Volunteer not found." });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/volunteers/${req.params.id}/training`);

      const event = createDomainEvent({
        eventName: "volunteer.training_updated",
        domain: "volunteer",
        action: "updated",
        recordId: req.params.id,
        newValues: { training_status: status },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: volunteer });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Update training status failed", { error: message });
      const statusCode = message.includes("Invalid training status") ? 400 : 500;
      res.status(statusCode).json({ success: false, error: message });
    }
  }
);

// --- GET /match/:shiftId  —  match volunteers to shift ---

volunteerRouter.get("/match/:shiftId", async (req: Request, res: Response) => {
  try {
    const matches = await matchVolunteersToShift(req.params.shiftId);

    res.json({ success: true, data: matches });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Match volunteers failed", { error: message });
    const statusCode = message.includes("Shift not found") ? 404 : 500;
    res.status(statusCode).json({ success: false, error: message });
  }
});

// --- POST /assign  —  assign volunteer to shift (coordinator+) ---

volunteerRouter.post(
  "/assign",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { volunteer_id, shift_id } = req.body as {
        volunteer_id?: string;
        shift_id?: string;
      };

      if (!volunteer_id || !shift_id) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "volunteer_id", "shift_id".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const assignment = await withAuditContext(auditCtx, (client) =>
        assignToShift(volunteer_id, shift_id, client)
      );

      await logAuditClaim(auditCtx, "POST /api/volunteers/assign");

      const event = createDomainEvent({
        eventName: "volunteer.assigned_to_shift",
        domain: "volunteer",
        action: "created",
        recordId: assignment.id,
        newValues: { volunteer_id, shift_id },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: assignment });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Assign volunteer failed", { error: message });
      const statusCode = message.includes("not found") ? 404
        : message.includes("maximum capacity") ? 409
        : 500;
      res.status(statusCode).json({ success: false, error: message });
    }
  }
);

// --- GET /coverage/:shiftId  —  shift coverage ---

volunteerRouter.get("/coverage/:shiftId", async (req: Request, res: Response) => {
  try {
    const coverage = await getShiftCoverage(req.params.shiftId);

    if (!coverage) {
      res.status(404).json({ success: false, error: "Shift not found." });
      return;
    }

    res.json({ success: true, data: coverage });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get shift coverage failed", { error: message });
    res.status(500).json({ success: false, error: `Get shift coverage failed: ${message}` });
  }
});
