/**
 * Data Quality API Router
 *
 * Exposes quality rule management and violation tracking over HTTP.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST/PUT/DELETE: director role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listRules,
  createRule,
  getViolations,
  resolveViolation,
  getQualityScore,
} from "../data-quality/service";

// --- Router ---

export const dataQualityRouter = Router();

dataQualityRouter.use(requireAuth);

// --- GET /rules --- list quality rules ---

dataQualityRouter.get("/rules", async (req: Request, res: Response) => {
  try {
    const conceptKey = req.query.concept as string | undefined;
    const rules = await listRules(conceptKey);
    res.json({ success: true, data: rules });
  } catch (err: unknown) {
    handleError(res, err, "listing quality rules");
  }
});

// --- POST /rules --- create a quality rule (director only) ---

dataQualityRouter.post(
  "/rules",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { name, concept_key, rule_type, condition, severity } = req.body;

      if (!name || !concept_key || !rule_type || !condition) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: name, concept_key, rule_type, condition.",
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const rule = await createRule({
        name,
        concept_key,
        rule_type,
        condition,
        severity,
      });

      await logAuditClaim(auditCtx, "POST /api/quality/rules");

      const event = createDomainEvent({
        eventName: "quality_rule.created",
        domain: "quality_rule",
        action: "created",
        recordId: rule.id,
        newValues: { name, concept_key, rule_type, severity },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: rule });
    } catch (err: unknown) {
      handleError(res, err, "creating quality rule");
    }
  }
);

// --- GET /violations --- list violations ---

dataQualityRouter.get("/violations", async (req: Request, res: Response) => {
  try {
    const conceptKey = req.query.concept as string | undefined;
    const resolved = req.query.resolved !== undefined
      ? req.query.resolved === "true"
      : undefined;

    const violations = await getViolations(conceptKey, resolved);
    res.json({ success: true, data: violations });
  } catch (err: unknown) {
    handleError(res, err, "listing violations");
  }
});

// --- PUT /violations/:id/resolve --- resolve a violation ---

dataQualityRouter.put(
  "/violations/:id/resolve",
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const violation = await resolveViolation(req.params.id);

      if (!violation) {
        res.status(404).json({
          success: false,
          error: "Violation not found.",
        });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/quality/violations/${req.params.id}/resolve`);

      const event = createDomainEvent({
        eventName: "quality_violation.resolved",
        domain: "quality_violation",
        action: "updated",
        recordId: req.params.id,
        newValues: { resolved: true },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: violation });
    } catch (err: unknown) {
      handleError(res, err, "resolving violation");
    }
  }
);

// --- GET /score/:concept --- quality score ---

dataQualityRouter.get("/score/:concept", async (req: Request, res: Response) => {
  try {
    const score = await getQualityScore(req.params.concept);
    res.json({ success: true, data: score });
  } catch (err: unknown) {
    handleError(res, err, "computing quality score");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Failed ${context}: ${message}`,
  });
}
