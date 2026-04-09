/**
 * Admin Audit API Router
 *
 * Exposes forensic query endpoints for directors and above.
 * All queries require authentication and director role (priority <= 10).
 *
 * GET /api/admin/audit/query?type=<queryType>&...params
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
} from "../audit/forensics";
import type { AuditLogTable } from "../audit/forensics";

// --- Router ---

export const adminAuditRouter = Router();

adminAuditRouter.use(requireAuth);
adminAuditRouter.use(requireRole(10));

// --- Query types ---

const VALID_QUERY_TYPES = new Set([
  "actor_time_range",
  "table_recent",
  "direct_db_access",
  "change_set",
  "most_active_actors",
  "deleted_records",
]);

const VALID_LOG_TABLES = new Set(["ontology_audit_log", "domain_audit_log"]);

// --- GET /audit/query ---

adminAuditRouter.get("/audit/query", async (req: Request, res: Response) => {
  try {
    const queryType = req.query.type as string | undefined;

    if (!queryType || !VALID_QUERY_TYPES.has(queryType)) {
      res.status(400).json({
        success: false,
        error: `Invalid query type. Must be one of: ${Array.from(VALID_QUERY_TYPES).join(", ")}`,
      });
      return;
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const logTable = resolveLogTable(req.query.logTable as string | undefined);

    const result = await executeQuery(queryType, req, { page, limit, logTable });

    res.json({
      success: true,
      data: result,
      meta: {
        queryType,
        page: page ?? 1,
        limit: limit ?? 100,
        count: Array.isArray(result) ? result.length : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Admin audit query failed", { error: message });
    res.status(500).json({
      success: false,
      error: "Audit query failed. Check server logs for details.",
    });
  }
});

// --- Query dispatcher ---

function resolveLogTable(value: string | undefined): AuditLogTable {
  if (value && VALID_LOG_TABLES.has(value)) {
    return value as AuditLogTable;
  }
  return "ontology_audit_log";
}

async function executeQuery(
  queryType: string,
  req: Request,
  options: { page?: number; limit?: number; logTable: AuditLogTable }
): Promise<unknown> {
  switch (queryType) {
    case "actor_time_range": {
      const actorId = req.query.actorId as string;
      const startTime = req.query.startTime as string;
      const endTime = req.query.endTime as string;
      if (!actorId || !startTime || !endTime) {
        throw new Error("actor_time_range requires actorId, startTime, and endTime");
      }
      return queryByActorAndTimeRange(actorId, startTime, endTime, {
        page: options.page,
        limit: options.limit,
        logTable: options.logTable,
      });
    }

    case "table_recent": {
      const tableName = req.query.tableName as string;
      const days = parseInt(req.query.days as string, 10);
      if (!tableName || isNaN(days)) {
        throw new Error("table_recent requires tableName and days");
      }
      return queryByTableRecent(tableName, days, {
        page: options.page,
        limit: options.limit,
        logTable: options.logTable,
      });
    }

    case "direct_db_access": {
      const hours = parseInt(req.query.hours as string, 10);
      if (isNaN(hours)) {
        throw new Error("direct_db_access requires hours");
      }
      return queryDirectDbAccess(hours, {
        page: options.page,
        limit: options.limit,
        logTable: options.logTable,
      });
    }

    case "change_set": {
      const changeSetId = req.query.changeSetId as string;
      if (!changeSetId) {
        throw new Error("change_set requires changeSetId");
      }
      return queryChangeSet(changeSetId, {
        page: options.page,
        limit: options.limit,
        logTable: options.logTable,
      });
    }

    case "most_active_actors": {
      const hours = parseInt(req.query.hours as string, 10);
      const limit = parseInt(req.query.limit as string, 10) || 20;
      if (isNaN(hours)) {
        throw new Error("most_active_actors requires hours");
      }
      return queryMostActiveActors(hours, limit, {
        logTable: options.logTable,
      });
    }

    case "deleted_records": {
      const tableName = req.query.tableName as string;
      const days = parseInt(req.query.days as string, 10);
      if (!tableName || isNaN(days)) {
        throw new Error("deleted_records requires tableName and days");
      }
      return queryDeletedRecords(tableName, days, {
        page: options.page,
        limit: options.limit,
        logTable: options.logTable,
      });
    }

    default:
      throw new Error(`Unsupported query type: ${queryType}`);
  }
}
