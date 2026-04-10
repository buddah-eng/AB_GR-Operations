/**
 * Pipelines API Router
 *
 * CRUD for internal data pipelines, manual execution, and execution history.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST/PUT/DELETE: director role (requireRole(10))
 *   - POST execute: director role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listPipelines,
  getPipelineById,
  createPipeline,
  updatePipeline,
  deletePipeline,
  executePipeline,
  getExecutions,
} from "../pipelines/service";

// --- Router ---

export const pipelinesRouter = Router();

pipelinesRouter.use(requireAuth);

// --- GET / --- list pipelines ---

pipelinesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const pipelines = await listPipelines(status);
    res.json({ success: true, data: pipelines });
  } catch (err: unknown) {
    handleError(res, err, "listing pipelines");
  }
});

// --- GET /:id --- get single pipeline ---

pipelinesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const pipeline = await getPipelineById(req.params.id);

    if (!pipeline) {
      res.status(404).json({ success: false, error: "Pipeline not found" });
      return;
    }

    res.json({ success: true, data: pipeline });
  } catch (err: unknown) {
    handleError(res, err, "getting pipeline");
  }
});

// --- POST / --- create pipeline (director+) ---

pipelinesRouter.post(
  "/",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        description,
        trigger_type,
        trigger_config,
        stages,
        error_strategy,
        owner_department,
      } = req.body as {
        name?: string;
        description?: string;
        trigger_type?: string;
        trigger_config?: Record<string, unknown>;
        stages?: unknown[];
        error_strategy?: string;
        owner_department?: string;
      };

      if (!name || !trigger_type || !trigger_config) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "name", "trigger_type", "trigger_config".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const pipeline = await createPipeline({
        name,
        description: description ?? null,
        trigger_type: trigger_type as "domain_event" | "scheduled" | "manual" | "pipeline",
        trigger_config: trigger_config,
        stages: (stages ?? []) as [],
        error_strategy: (error_strategy as "fail_fast" | "continue" | "retry_then_skip") ?? "continue",
        status: "draft",
        owner_scope: "org",
        owner_department: owner_department ?? null,
      });

      await logAuditClaim(auditCtx, "POST /api/pipelines");

      const event = createDomainEvent({
        eventName: "pipeline.created",
        domain: "pipeline",
        action: "created",
        recordId: pipeline.id,
        newValues: { name, trigger_type },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: pipeline });
    } catch (err: unknown) {
      handleError(res, err, "creating pipeline");
    }
  }
);

// --- PUT /:id --- update pipeline (director+) ---

pipelinesRouter.put(
  "/:id",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const pipeline = await updatePipeline(req.params.id, req.body);

      if (!pipeline) {
        res.status(404).json({ success: false, error: "Pipeline not found" });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/pipelines/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "pipeline.updated",
        domain: "pipeline",
        action: "updated",
        recordId: pipeline.id,
        newValues: req.body,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      handleError(res, err, "updating pipeline");
    }
  }
);

// --- DELETE /:id --- delete pipeline (director+) ---

pipelinesRouter.delete(
  "/:id",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const deleted = await deletePipeline(req.params.id);

      if (!deleted) {
        res.status(404).json({ success: false, error: "Pipeline not found" });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/pipelines/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "pipeline.deleted",
        domain: "pipeline",
        action: "deleted",
        recordId: req.params.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: { id: req.params.id, deleted: true } });
    } catch (err: unknown) {
      handleError(res, err, "deleting pipeline");
    }
  }
);

// --- POST /:id/execute --- manual trigger (director+) ---

pipelinesRouter.post(
  "/:id/execute",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const execution = await executePipeline(req.params.id);

      res.json({ success: true, data: execution });
    } catch (err: unknown) {
      handleError(res, err, "executing pipeline");
    }
  }
);

// --- GET /:id/executions --- execution history ---

pipelinesRouter.get("/:id/executions", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const executions = await getExecutions(req.params.id, limit);

    res.json({ success: true, data: executions });
  } catch (err: unknown) {
    handleError(res, err, "getting pipeline executions");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Pipelines API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
