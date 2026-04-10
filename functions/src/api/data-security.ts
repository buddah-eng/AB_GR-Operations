/**
 * Data Security API Router
 *
 * Exposes data access logging, anomaly detection, and anonymization over HTTP.
 *
 * Auth levels:
 *   - All endpoints: admin only (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  getAccessLog,
  detectAnomalousAccess,
  anonymizeRecord,
} from "../data-security/service";

// --- Router ---

export const dataSecurityRouter = Router();

dataSecurityRouter.use(requireAuth);
dataSecurityRouter.use(requireRole(10));

// --- GET /access-log --- access log query ---

dataSecurityRouter.get("/access-log", async (req: Request, res: Response) => {
  try {
    const actorId = req.query.actor as string | undefined;
    const hours = parseInt(String(req.query.hours ?? "24"), 10);

    const log = await getAccessLog(actorId, isNaN(hours) ? 24 : hours);
    res.json({ success: true, data: log });
  } catch (err: unknown) {
    handleError(res, err, "querying access log");
  }
});

// --- GET /anomalies --- anomalous access detection ---

dataSecurityRouter.get("/anomalies", async (req: Request, res: Response) => {
  try {
    const hours = parseInt(String(req.query.hours ?? "24"), 10);

    const anomalies = await detectAnomalousAccess(isNaN(hours) ? 24 : hours);
    res.json({ success: true, data: anomalies });
  } catch (err: unknown) {
    handleError(res, err, "detecting anomalous access");
  }
});

// --- POST /anonymize/:concept/:id --- anonymize record ---

dataSecurityRouter.post(
  "/anonymize/:concept/:id",
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const result = await anonymizeRecord(req.params.concept, req.params.id);

      await logAuditClaim(
        auditCtx,
        `POST /api/security/anonymize/${req.params.concept}/${req.params.id}`
      );

      const event = createDomainEvent({
        eventName: "security.record_anonymized",
        domain: "security",
        action: "updated",
        recordId: req.params.id,
        newValues: { concept: req.params.concept, ...result },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "anonymizing record");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Failed ${context}: ${message}`,
  });
}
