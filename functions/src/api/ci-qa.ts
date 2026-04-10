/**
 * CI/QA Pipeline API Router
 *
 * Exposes the config change request pipeline over HTTP.
 *
 * POST /api/config-changes               — create draft change request
 * POST /api/config-changes/:id/validate  — run validation (draft -> validating -> review)
 * POST /api/config-changes/:id/review    — submit for review (or auto-approve)
 * POST /api/config-changes/:id/apply     — apply change via versioning service
 * POST /api/config-changes/:id/rollback  — rollback within 24hr window
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import {
  createChangeRequest,
  advanceChangeRequest,
} from "../ontology/ci-qa";

// --- Router ---

export const ciQaRouter = Router();

ciQaRouter.use(requireAuth);

// --- POST /api/config-changes — create draft change request ---

ciQaRouter.post(
  "/",
  async (req: Request, res: Response) => {
    try {
      const { tableName, recordKey, changes, ownerScope, ownerDepartment } = req.body as {
        tableName?: string;
        recordKey?: string;
        changes?: Record<string, unknown>;
        ownerScope?: string;
        ownerDepartment?: string;
      };

      if (!tableName || typeof tableName !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field "tableName" (string).' });
        return;
      }

      if (!recordKey || typeof recordKey !== "string") {
        res.status(400).json({ success: false, error: 'Missing required field "recordKey" (string).' });
        return;
      }

      if (!changes || typeof changes !== "object") {
        res.status(400).json({ success: false, error: 'Missing required field "changes" (object).' });
        return;
      }

      const createdBy = req.user?.uid ?? "anonymous";
      const result = await createChangeRequest(
        tableName,
        recordKey,
        changes,
        ownerScope ?? "org",
        ownerDepartment ?? null,
        createdBy
      );

      res.status(201).json({ success: true, data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create change request failed", { error: message });
      res.status(500).json({ success: false, error: `Create change request failed: ${message}` });
    }
  }
);

// --- POST /api/config-changes/:id/validate — run validation ---

ciQaRouter.post(
  "/:id/validate",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const actorId = req.user?.uid ?? "anonymous";
      const actorPriority = req.role?.priority ?? 100;

      const result = await advanceChangeRequest(id, "validating", actorId, actorPriority);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Validate change request failed", { error: message });
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ success: false, error: message });
    }
  }
);

// --- POST /api/config-changes/:id/review — submit for review ---

ciQaRouter.post(
  "/:id/review",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const actorId = req.user?.uid ?? "anonymous";
      const actorPriority = req.role?.priority ?? 100;

      const result = await advanceChangeRequest(id, "review", actorId, actorPriority);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Review change request failed", { error: message });
      const status = message.includes("Insufficient") ? 403 : 400;
      res.status(status).json({ success: false, error: message });
    }
  }
);

// --- POST /api/config-changes/:id/apply — apply change ---

ciQaRouter.post(
  "/:id/apply",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const actorId = req.user?.uid ?? "anonymous";
      const actorPriority = req.role?.priority ?? 100;

      const result = await advanceChangeRequest(id, "applied", actorId, actorPriority);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Apply change request failed", { error: message });
      res.status(500).json({ success: false, error: `Apply failed: ${message}` });
    }
  }
);

// --- POST /api/config-changes/:id/rollback — rollback within 24hr ---

ciQaRouter.post(
  "/:id/rollback",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const actorId = req.user?.uid ?? "anonymous";
      const actorPriority = req.role?.priority ?? 100;

      const result = await advanceChangeRequest(id, "rolled_back", actorId, actorPriority);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Rollback change request failed", { error: message });
      const status = message.includes("window expired") ? 400 : 500;
      res.status(status).json({ success: false, error: `Rollback failed: ${message}` });
    }
  }
);
