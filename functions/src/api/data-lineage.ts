/**
 * Data Lineage API Router
 *
 * Exposes data lineage tracing and impact analysis over HTTP.
 *
 * Auth levels:
 *   - All endpoints: authentication required
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import {
  traceBackward,
  traceForward,
  getImpactAnalysis,
} from "../data-lineage/service";

// --- Router ---

export const dataLineageRouter = Router();

dataLineageRouter.use(requireAuth);

// --- GET /:concept/:id/backward --- backward lineage trace ---

dataLineageRouter.get(
  "/:concept/:id/backward",
  async (req: Request, res: Response) => {
    try {
      const graph = await traceBackward(req.params.concept, req.params.id);
      res.json({ success: true, data: graph });
    } catch (err: unknown) {
      handleError(res, err, "backward trace");
    }
  }
);

// --- GET /:concept/:id/forward --- forward lineage trace ---

dataLineageRouter.get(
  "/:concept/:id/forward",
  async (req: Request, res: Response) => {
    try {
      const graph = await traceForward(req.params.concept, req.params.id);
      res.json({ success: true, data: graph });
    } catch (err: unknown) {
      handleError(res, err, "forward trace");
    }
  }
);

// --- GET /:concept/:field/impact --- impact analysis ---

dataLineageRouter.get(
  "/:concept/:field/impact",
  async (req: Request, res: Response) => {
    try {
      const analysis = await getImpactAnalysis(
        req.params.concept,
        req.params.field
      );
      res.json({ success: true, data: analysis });
    } catch (err: unknown) {
      handleError(res, err, "impact analysis");
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
