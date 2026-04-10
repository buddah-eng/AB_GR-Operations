/**
 * Staff API Router
 *
 * RESTful endpoints for staff management:
 *   GET    /api/staff           — list staff with filters
 *   GET    /api/staff/:id       — get single staff record
 *   POST   /api/staff           — create staff record
 *   PUT    /api/staff/:id       — update staff record
 *   DELETE /api/staff/:id       — archive staff record
 *   PUT    /api/staff/:id/role  — assign role to staff
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
  listStaff,
  getStaffById,
  getStaffByDepartment,
  assignRole,
  createStaff,
  updateStaff,
  archiveStaff,
} from "../services/staff";

// --- Router ---

export const staffRouter = Router();

staffRouter.use(requireAuth);

// --- GET /  —  list staff ---

staffRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      department: req.query.department as string | undefined,
      staff_type: req.query.staff_type as string | undefined,
      role_key: req.query.role_key as string | undefined,
      active: req.query.active !== undefined
        ? req.query.active === "true"
        : undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await listStaff(filters);

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
    logger.error("List staff failed", { error: message });
    res.status(500).json({ success: false, error: `List staff failed: ${message}` });
  }
});

// --- GET /department/:department  —  staff by department ---

staffRouter.get("/department/:department", async (req: Request, res: Response) => {
  try {
    const data = await getStaffByDepartment(req.params.department);

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get staff by department failed", { error: message });
    res.status(500).json({ success: false, error: `Get staff by department failed: ${message}` });
  }
});

// --- GET /:id  —  single staff record ---

staffRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const staff = await getStaffById(req.params.id);

    if (!staff) {
      res.status(404).json({ success: false, error: "Staff record not found." });
      return;
    }

    res.json({ success: true, data: staff });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get staff failed", { error: message });
    res.status(500).json({ success: false, error: `Get staff failed: ${message}` });
  }
});

// --- POST /  —  create staff (coordinator+) ---

staffRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { name, email, role_key, department, phone, staff_type,
              skills, training_status, emergency_contact, languages, properties } = req.body as Record<string, unknown>;

      if (!name || typeof name !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field: "name".' });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const staff = await withAuditContext(auditCtx, (client) =>
        createStaff(
          {
            name: name as string,
            email: email as string | undefined,
            role_key: role_key as string | undefined,
            department: department as string | undefined,
            phone: phone as string | undefined,
            staff_type: staff_type as string | undefined,
            skills: skills as string[] | undefined,
            training_status: training_status as string | undefined,
            emergency_contact: emergency_contact as string | undefined,
            languages: languages as string[] | undefined,
            properties: properties as Record<string, unknown> | undefined,
            created_by: req.user?.uid,
          },
          client
        )
      );

      await logAuditClaim(auditCtx, "POST /api/staff");

      const event = createDomainEvent({
        eventName: "staff.created",
        domain: "staff",
        action: "created",
        recordId: staff.id,
        newValues: { name, email, department, staff_type },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: staff });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create staff failed", { error: message });
      res.status(500).json({ success: false, error: `Create staff failed: ${message}` });
    }
  }
);

// --- PUT /:id  —  update staff (coordinator+) ---

staffRouter.put(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const staff = await withAuditContext(auditCtx, (client) =>
        updateStaff(req.params.id, req.body as Record<string, unknown>, client)
      );

      if (!staff) {
        res.status(404).json({ success: false, error: "Staff record not found." });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/staff/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "staff.updated",
        domain: "staff",
        action: "updated",
        recordId: req.params.id,
        newValues: req.body as Record<string, unknown>,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: staff });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Update staff failed", { error: message });
      res.status(500).json({ success: false, error: `Update staff failed: ${message}` });
    }
  }
);

// --- DELETE /:id  —  archive staff (coordinator+) ---

staffRouter.delete(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const archived = await withAuditContext(auditCtx, (client) =>
        archiveStaff(req.params.id, client)
      );

      if (!archived) {
        res.status(404).json({ success: false, error: "Staff record not found." });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/staff/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "staff.deleted",
        domain: "staff",
        action: "deleted",
        recordId: req.params.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Delete staff failed", { error: message });
      res.status(500).json({ success: false, error: `Delete staff failed: ${message}` });
    }
  }
);

// --- PUT /:id/role  —  assign role (coordinator+) ---

staffRouter.put(
  "/:id/role",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { role_key } = req.body as { role_key?: string };

      if (!role_key || typeof role_key !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field: "role_key".' });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const staff = await withAuditContext(auditCtx, (client) =>
        assignRole(req.params.id, role_key, client)
      );

      if (!staff) {
        res.status(404).json({ success: false, error: "Staff record not found." });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/staff/${req.params.id}/role`);

      const event = createDomainEvent({
        eventName: "staff.role_assigned",
        domain: "staff",
        action: "updated",
        recordId: req.params.id,
        newValues: { role_key },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: staff });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Assign role failed", { error: message });
      res.status(500).json({ success: false, error: `Assign role failed: ${message}` });
    }
  }
);
