/**
 * Admin Audit API
 *
 * Exposes forensic audit query functions over HTTP.
 * All endpoints require authentication and director-level role.
 *
 * GET /api/admin/audit/query?type=...&...
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import {
  queryByActorAndTimeRange,
  queryByTableRecent,
  queryDirectDbAccess,
  queryChangeSet,
  queryMostActiveActors,
  queryDeletedRecords,
  getChangeSetSummary,
} from "../audit/forensics";

// --- Router ---

export const adminAuditRouter = Router();

adminAuditRouter.use(requireAuth);
adminAuditRouter.use(requireRole(10));

// --- Query dispatch ---

adminAuditRouter.get("/audit/query", async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    if (!type || typeof type !== "string") {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter "type".',
      });
      return;
    }

    const page = parseIntParam(req.query.page, 1);
    const limit = parseIntParam(req.query.limit, 100);

    const data = await dispatch(type, req.query, { page, limit });

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Admin audit query failed", { error: message });
    res.status(500).json({
      success: false,
      error: `Audit query failed: ${message}`,
    });
  }
});

// --- Dispatch helper ---

async function dispatch(
  type: string,
  params: Record<string, unknown>,
  pagination: { page: number; limit: number }
): Promise<unknown> {
  switch (type) {
    case "actor_time_range": {
      const actorId = requireParam(params, "actorId");
      const startTime = requireParam(params, "startTime");
      const endTime = requireParam(params, "endTime");
      return queryByActorAndTimeRange(actorId, startTime, endTime, pagination);
    }

    case "table_recent": {
      const tableName = requireParam(params, "tableName");
      const days = parseIntParam(params.days, 7);
      return queryByTableRecent(tableName, days, pagination);
    }

    case "direct_access": {
      const hours = parseIntParam(params.hours, 24);
      return queryDirectDbAccess(hours, pagination);
    }

    case "change_set": {
      const changeSetId = requireParam(params, "changeSetId");
      return queryChangeSet(changeSetId, pagination);
    }

    case "active_actors": {
      const hours = parseIntParam(params.hours, 24);
      const limit = parseIntParam(params.actorLimit, 20);
      return queryMostActiveActors(hours, limit);
    }

    case "deleted_records": {
      const tableName = requireParam(params, "tableName");
      const days = parseIntParam(params.days, 30);
      return queryDeletedRecords(tableName, days, pagination);
    }

    case "change_set_summary": {
      const changeSetId = requireParam(params, "changeSetId");
      return getChangeSetSummary(changeSetId);
    }

    default:
      throw new Error(
        `Unknown audit query type: "${type}". ` +
        "Valid types: actor_time_range, table_recent, direct_access, " +
        "change_set, active_actors, deleted_records, change_set_summary."
      );
  }
}

// --- Param helpers ---

function requireParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required parameter "${key}".`);
  }
  return value;
}

function parseIntParam(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
