/**
 * Notification API Router
 *
 * Exposes notification query, mark-as-read, and preferences endpoints.
 * All endpoints require authentication.
 *
 * GET    /api/notifications                — list in-app notifications for current user
 * GET    /api/notifications/unread-count   — unread count
 * PUT    /api/notifications/:id/read       — mark as read
 * GET    /api/notifications/preferences    — get user preferences
 * PUT    /api/notifications/preferences    — update user preferences
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import {
  getNotifications,
  markAsRead,
  getUnreadCount,
  getPreferences,
  updatePreferences,
} from "../notifications/service";
import type { NotificationFilters, UpdatePreferencesData } from "../notifications/service";

// --- Router ---

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

// --- GET / — list notifications for current user ---

notificationRouter.get("/", async (req: Request, res: Response) => {
  try {
    const rawUid = req.user!.uid;
    // Sanitize dev-user UUID to avoid Postgres UUID cast errors
    const userId = rawUid === "dev-user" ? "00000000-0000-0000-0000-000000000000" : rawUid;
    const filters: NotificationFilters = {
      status: req.query.status as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = await getNotifications(userId, filters);

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("List notifications failed", { error: message });
    res.status(500).json({ success: false, error: `List notifications failed: ${message}` });
  }
});

// --- GET /unread-count — unread count ---

notificationRouter.get("/unread-count", async (req: Request, res: Response) => {
  try {
    const rawUid = req.user!.uid;
    const userId = rawUid === "dev-user" ? "00000000-0000-0000-0000-000000000000" : rawUid;
    const result = await getUnreadCount(userId);

    res.json({ success: true, data: { count: result.data } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get unread count failed", { error: message });
    res.status(500).json({ success: false, error: `Get unread count failed: ${message}` });
  }
});

// --- PUT /:id/read — mark notification as read ---

notificationRouter.put("/:id/read", async (req: Request, res: Response) => {
  try {
    const result = await markAsRead(req.params.id);

    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Mark as read failed", { error: message });
    res.status(500).json({ success: false, error: `Mark as read failed: ${message}` });
  }
});

// --- GET /preferences — get notification preferences ---

notificationRouter.get("/preferences", async (req: Request, res: Response) => {
  try {
    const rawUid = req.user!.uid;
    const userId = rawUid === "dev-user" ? "00000000-0000-0000-0000-000000000000" : rawUid;
    const result = await getPreferences(userId);

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get preferences failed", { error: message });
    res.status(500).json({ success: false, error: `Get preferences failed: ${message}` });
  }
});

// --- PUT /preferences — update notification preferences ---

notificationRouter.put("/preferences", async (req: Request, res: Response) => {
  try {
    const rawUid = req.user!.uid;
    const userId = rawUid === "dev-user" ? "00000000-0000-0000-0000-000000000000" : rawUid;
    const prefs = req.body as UpdatePreferencesData;

    const result = await updatePreferences(userId, prefs);

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Update preferences failed", { error: message });
    res.status(500).json({ success: false, error: `Update preferences failed: ${message}` });
  }
});
