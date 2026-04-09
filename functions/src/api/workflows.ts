/**
 * Workflow API
 *
 * Manual trigger endpoint and workflow listing.
 *
 * Auth levels:
 *   - GET /: authentication only
 *   - POST /:id/run: director role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import { executeManualWorkflow, loadActiveWorkflows } from "../workflows/engine";

// --- Router ---

export const workflowRouter = Router();

workflowRouter.use(requireAuth);

// --- List active workflows ---

workflowRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const workflows = await loadActiveWorkflows();
    res.json({ success: true, data: workflows });
  } catch (err: unknown) {
    handleError(res, err, "listing workflows");
  }
});

// --- Manual trigger ---

workflowRouter.post(
  "/:id/run",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const context = (req.body.context ?? {}) as Record<string, unknown>;
      const triggeredBy = req.user?.email ?? "system";

      const auditCtx = auditContextFromRequest(req);

      const result = await executeManualWorkflow(id, context, triggeredBy);

      if (!result.success) {
        const isNotFound = result.error?.includes("not found");
        const isNotManual = result.error?.includes("not a manual");

        if (isNotFound) {
          res.status(404).json({ success: false, error: result.error });
          return;
        }

        if (isNotManual) {
          res.status(400).json({ success: false, error: result.error });
          return;
        }

        res.status(500).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, `POST /api/workflows/${id}/run`);

      const event = createDomainEvent({
        eventName: "workflow.manual_executed",
        domain: "workflow",
        action: "completed",
        recordId: id,
        triggeredBy,
        changeSet: auditCtx.changeSet,
        metadata: { context },
      });
      await emit(event);

      res.json({ success: true, data: { workflowId: id, status: "executed" } });
    } catch (err: unknown) {
      handleError(res, err, "executing manual workflow");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Workflow API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
