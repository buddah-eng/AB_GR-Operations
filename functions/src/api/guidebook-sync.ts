/**
 * Guidebook Sync API Router
 *
 * Triggers publishing to Guidebook and checks publish status.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST (publish): coordinator role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import {
  publishToGuidebook,
  getPublishStatus,
} from "../services/guidebook-sync";
import type { GuidebookSyncType } from "../services/guidebook-sync";

// --- Router ---

export const guidebookSyncRouter = Router();

guidebookSyncRouter.use(requireAuth);

// --- GET /status --- get publish status ---

guidebookSyncRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "10"), 10);
    const status = await getPublishStatus(limit);
    res.json({ success: true, data: status });
  } catch (err: unknown) {
    handleError(res, err, "getting publish status");
  }
});

// --- POST /publish --- publish to Guidebook ---

guidebookSyncRouter.post(
  "/publish",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { syncType } = req.body as { syncType?: GuidebookSyncType };

      if (!syncType) {
        res.status(400).json({
          success: false,
          error: "syncType is required (schedule, guest_bios, venue_info, or full)",
        });
        return;
      }

      const validTypes: ReadonlyArray<string> = [
        "schedule",
        "guest_bios",
        "venue_info",
        "full",
      ];
      if (!validTypes.includes(syncType)) {
        res.status(400).json({
          success: false,
          error: `Invalid syncType: ${syncType}. Must be one of: ${validTypes.join(", ")}`,
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      await logAuditClaim(auditCtx, "POST /api/guidebook-sync/publish");

      const result = await publishToGuidebook(syncType);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "publishing to Guidebook");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Internal error while ${context}: ${message}`,
  });
}
