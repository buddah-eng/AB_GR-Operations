/**
 * Calendar Sync API Router
 *
 * Triggers bidirectional Google Calendar sync and checks sync status.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST (sync triggers): coordinator role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import {
  syncToGoogleCalendar,
  syncFromGoogleCalendar,
  getSyncState,
} from "../services/calendar-sync";

// --- Router ---

export const calendarSyncRouter = Router();

calendarSyncRouter.use(requireAuth);

// --- GET /status/:department --- get sync state ---

calendarSyncRouter.get(
  "/status/:department",
  async (req: Request, res: Response) => {
    try {
      const state = await getSyncState(req.params.department);

      if (!state) {
        res.json({
          success: true,
          data: {
            department: req.params.department,
            status: "never_synced",
            lastSyncAt: null,
          },
        });
        return;
      }

      res.json({ success: true, data: state });
    } catch (err: unknown) {
      handleError(res, err, "getting sync status");
    }
  }
);

// --- POST /push --- push to Google Calendar ---

calendarSyncRouter.post(
  "/push",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { department } = req.body as { department?: string };

      if (!department) {
        res.status(400).json({
          success: false,
          error: "department is required",
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      await logAuditClaim(auditCtx, "POST /api/calendar-sync/push");

      const result = await syncToGoogleCalendar(department);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "pushing to Google Calendar");
    }
  }
);

// --- POST /pull --- pull from Google Calendar ---

calendarSyncRouter.post(
  "/pull",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { department } = req.body as { department?: string };

      if (!department) {
        res.status(400).json({
          success: false,
          error: "department is required",
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      await logAuditClaim(auditCtx, "POST /api/calendar-sync/pull");

      const result = await syncFromGoogleCalendar(department);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "pulling from Google Calendar");
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
