/**
 * Data Routes API Router
 *
 * CRUD for data routes and their transforms.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST/PUT/DELETE: coordinator role (requireRole(20))
 *
 * All mutations: withAuditContext + logAuditClaim + domain events
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
} from "../data-routing/service";

// --- Router ---

export const dataRoutesRouter = Router();

dataRoutesRouter.use(requireAuth);

// --- GET / --- list data routes ---

dataRoutesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      source_concept: req.query.source_concept as string | undefined,
      dest_concept: req.query.dest_concept as string | undefined,
      trigger_event: req.query.trigger_event as string | undefined,
      active: req.query.active !== undefined
        ? req.query.active === "true"
        : undefined,
    };

    const routes = await listRoutes(filters);
    res.json({ success: true, data: routes });
  } catch (err: unknown) {
    handleError(res, err, "listing data routes");
  }
});

// --- GET /:id --- get single route ---

dataRoutesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const route = await getRouteById(req.params.id);

    if (!route) {
      res.status(404).json({ success: false, error: "Data route not found" });
      return;
    }

    res.json({ success: true, data: route });
  } catch (err: unknown) {
    handleError(res, err, "getting data route");
  }
});

// --- POST / --- create route (coordinator+) ---

dataRoutesRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        source_concept,
        dest_concept,
        field_mappings,
        transform_id,
        pii_mode,
        trigger_event,
        execution_mode,
        owner_scope,
        owner_department,
      } = req.body as {
        name?: string;
        source_concept?: string;
        dest_concept?: string;
        field_mappings?: ReadonlyArray<{ source: string; dest: string }>;
        transform_id?: string;
        pii_mode?: string;
        trigger_event?: string;
        execution_mode?: string;
        owner_scope?: string;
        owner_department?: string;
      };

      if (!name || !source_concept || !dest_concept || !trigger_event) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "name", "source_concept", "dest_concept", "trigger_event".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const route = await createRoute({
        name,
        source_concept,
        dest_concept,
        field_mappings: field_mappings ?? [],
        transform_id: transform_id ?? null,
        pii_mode: (pii_mode as "strip" | "pass" | "hash") ?? "strip",
        trigger_event,
        execution_mode: (execution_mode as "sync" | "async") ?? "async",
        owner_scope: owner_scope ?? "org",
        owner_department: owner_department ?? null,
        active: true,
      });

      await logAuditClaim(auditCtx, "POST /api/data-routes");

      const event = createDomainEvent({
        eventName: "data_route.created",
        domain: "data_route",
        action: "created",
        recordId: route.id,
        newValues: { name, source_concept, dest_concept, trigger_event },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: route });
    } catch (err: unknown) {
      handleError(res, err, "creating data route");
    }
  }
);

// --- PUT /:id --- update route (coordinator+) ---

dataRoutesRouter.put(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const route = await updateRoute(req.params.id, req.body);

      if (!route) {
        res.status(404).json({ success: false, error: "Data route not found" });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/data-routes/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "data_route.updated",
        domain: "data_route",
        action: "updated",
        recordId: route.id,
        newValues: req.body,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: route });
    } catch (err: unknown) {
      handleError(res, err, "updating data route");
    }
  }
);

// --- DELETE /:id --- delete route (coordinator+) ---

dataRoutesRouter.delete(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const deleted = await deleteRoute(req.params.id);

      if (!deleted) {
        res.status(404).json({ success: false, error: "Data route not found" });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/data-routes/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "data_route.deleted",
        domain: "data_route",
        action: "deleted",
        recordId: req.params.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: { id: req.params.id, deleted: true } });
    } catch (err: unknown) {
      handleError(res, err, "deleting data route");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Data Routes API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
