/**
 * Versioning API
 *
 * Exposes ontology versioning operations over HTTP.
 * Create/rollback require director role; history/active require authentication only.
 *
 * POST /api/ontology/version/:table/:key  — create new version
 * POST /api/ontology/rollback/:table/:id  — rollback to previous version
 * GET  /api/ontology/history/:table/:key  — get version history
 * GET  /api/ontology/active/:table/:key   — get active version
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  updateOntologyRecord,
  rollbackOntologyRecord,
  getVersionHistory,
  getActiveVersion,
} from "../versioning/service";

// --- Table whitelist (must match versioning/service.ts ONTOLOGY_TABLES) ---

const ONTOLOGY_TABLES = new Set([
  "ontology_concepts",
  "ontology_properties",
  "ontology_relationships",
  "ontology_events",
  "ontology_constraints",
  "form_configs",
  "view_configs",
  "page_configs",
  "workflow_configs",
]);

// --- Router ---

export const versioningRouter = Router();

versioningRouter.use(requireAuth);

// --- Table validation middleware ---

function validateTable(req: Request, res: Response): boolean {
  const { table } = req.params;
  if (!table || !ONTOLOGY_TABLES.has(table)) {
    res.status(400).json({
      success: false,
      error: `Invalid table "${table}". Allowed tables: ${[...ONTOLOGY_TABLES].join(", ")}`,
    });
    return false;
  }
  return true;
}

// --- POST /version/:table/:key — create new version ---

versioningRouter.post(
  "/version/:table/:key",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      if (!validateTable(req, res)) return;

      const { table, key } = req.params;
      const { updates, changeReason } = req.body as {
        updates?: Record<string, unknown>;
        changeReason?: string;
      };

      if (!updates || typeof updates !== "object") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "updates" (object).',
        });
        return;
      }

      if (!changeReason || typeof changeReason !== "string") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "changeReason" (string).',
        });
        return;
      }

      const changedBy = req.user?.uid ?? "anonymous";
      const auditCtx = auditContextFromRequest(req);
      const result = await updateOntologyRecord(table, key, updates, changedBy, changeReason, auditCtx);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error.message });
        return;
      }

      logAuditClaim(auditCtx, `POST /api/ontology/version/${table}/${key}`);

      const event = createDomainEvent({
        eventName: "ontology.version_created",
        domain: "ontology",
        action: "created",
        recordId: result.data.id,
        newValues: updates,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Versioning create failed", { error: message });
      res.status(500).json({ success: false, error: `Version create failed: ${message}` });
    }
  }
);

// --- POST /rollback/:table/:id — rollback to previous version ---

versioningRouter.post(
  "/rollback/:table/:id",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      if (!validateTable(req, res)) return;

      const { table, id } = req.params;
      const { reason } = req.body as { reason?: string };

      if (!reason || typeof reason !== "string") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "reason" (string).',
        });
        return;
      }

      const changedBy = req.user?.uid ?? "anonymous";
      const auditCtx = auditContextFromRequest(req);
      const result = await rollbackOntologyRecord(table, id, changedBy, reason, auditCtx);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error.message });
        return;
      }

      logAuditClaim(auditCtx, `POST /api/ontology/rollback/${table}/${id}`);

      const event = createDomainEvent({
        eventName: "ontology.rolled_back",
        domain: "ontology",
        action: "updated",
        recordId: result.data.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
        metadata: { reason, rolledBackFrom: id },
      });
      await emit(event);

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Versioning rollback failed", { error: message });
      res.status(500).json({ success: false, error: `Rollback failed: ${message}` });
    }
  }
);

// --- GET /history/:table/:key — get version history ---

versioningRouter.get(
  "/history/:table/:key",
  async (req: Request, res: Response) => {
    try {
      if (!validateTable(req, res)) return;

      const { table, key } = req.params;
      const result = await getVersionHistory(table, key);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error.message });
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Version history fetch failed", { error: message });
      res.status(500).json({ success: false, error: `History fetch failed: ${message}` });
    }
  }
);

// --- GET /active/:table/:key — get active version ---

versioningRouter.get(
  "/active/:table/:key",
  async (req: Request, res: Response) => {
    try {
      if (!validateTable(req, res)) return;

      const { table, key } = req.params;
      const result = await getActiveVersion(table, key);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error.message });
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Active version fetch failed", { error: message });
      res.status(500).json({ success: false, error: `Active version fetch failed: ${message}` });
    }
  }
);
