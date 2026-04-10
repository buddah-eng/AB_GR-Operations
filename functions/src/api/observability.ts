/**
 * Observability API Router
 *
 * Read-only endpoints for monitoring data flow health.
 *
 * Auth levels:
 *   - All endpoints: authentication only (read-only data)
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import {
  getPipelineHealth,
  getDataFreshness,
  getErrorSummary,
} from "../observability/service";

// --- Router ---

export const observabilityRouter = Router();

observabilityRouter.use(requireAuth);

// --- GET /health --- pipeline health ---

observabilityRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const health = await getPipelineHealth();
    res.json({ success: true, data: health });
  } catch (err: unknown) {
    handleError(res, err, "getting pipeline health");
  }
});

// --- GET /freshness --- data freshness ---

observabilityRouter.get("/freshness", async (req: Request, res: Response) => {
  try {
    const conceptKey = req.query.concept_key as string | undefined;
    const freshness = await getDataFreshness(conceptKey);
    res.json({ success: true, data: freshness });
  } catch (err: unknown) {
    handleError(res, err, "getting data freshness");
  }
});

// --- GET /errors --- error summary ---

observabilityRouter.get("/errors", async (req: Request, res: Response) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
    const errors = await getErrorSummary(hours);
    res.json({ success: true, data: errors });
  } catch (err: unknown) {
    handleError(res, err, "getting error summary");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Observability API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
