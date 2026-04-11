/**
 * Config Builder API Router
 *
 * CRUD endpoints for form_configs and view_configs tables.
 * The FormBuilder UI calls POST/PUT /api/form-configs and
 * the ViewBuilder UI calls POST/PUT /api/view-configs.
 *
 * Read endpoints are open to any authenticated user.
 * Write endpoints require director-level access (priority <= 0).
 *
 * PUT uses insert-new-version semantics:
 *   1. SELECT current active row FOR UPDATE
 *   2. INSERT new row with version+1, status='active'
 *   3. UPDATE old row status='deprecated'
 *
 * View config payload adapter:
 *   Frontend sends { viewType, sorts, dateField, endDateField }
 *   DB expects   { view_type, sort, timeline_start, timeline_end }
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { requireAuth, requireRole } from "../auth/middleware";
import { DIRECTOR_PRIORITY } from "../ontology/scoping";
import { auditContextFromRequest, logAuditClaim, withAuditContext } from "../audit/context";
import { cache } from "../cache";
import type { ApiResponse } from "../ontology/types";

// --- Routers ---

const formRouter = Router();
const viewRouter = Router();

// All config-builder routes require auth
formRouter.use(requireAuth);
viewRouter.use(requireAuth);

// --- Helpers ---

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message } as ApiResponse<never>);
}

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  sendError(res, status ?? 500, `Internal error while ${context}: ${message}`);
}

/**
 * Invalidates cached form and view configs for a concept.
 */
function invalidateConfigCaches(conceptKey: string): void {
  cache.invalidate(`views:${conceptKey}`);
  cache.invalidate(`form:${conceptKey}`);
}

/**
 * Transforms frontend ViewBuilder payload to DB column names.
 *
 * Frontend sends:  { viewType, sorts, dateField, endDateField, ... }
 * DB expects:      { view_type, sort, timeline_start, timeline_end, ... }
 */
function adaptViewPayloadToDB(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const adapted: Record<string, unknown> = { ...payload };

  if ("viewType" in adapted) {
    adapted.view_type = adapted.viewType;
    delete adapted.viewType;
  }
  if ("sorts" in adapted) {
    adapted.sort = adapted.sorts;
    delete adapted.sorts;
  }
  if ("dateField" in adapted) {
    adapted.timeline_start = adapted.dateField;
    delete adapted.dateField;
  }
  if ("endDateField" in adapted) {
    adapted.timeline_end = adapted.endDateField;
    delete adapted.endDateField;
  }
  if ("groupBy" in adapted) {
    adapted.group_by = adapted.groupBy;
    delete adapted.groupBy;
  }
  if ("rowAction" in adapted) {
    adapted.row_action = adapted.rowAction;
    delete adapted.rowAction;
  }
  if ("conceptKey" in adapted) {
    adapted.concept_key = adapted.conceptKey;
    delete adapted.conceptKey;
  }

  return adapted;
}

// ============================================================
// Form Config Endpoints
// ============================================================

/**
 * GET /api/form-configs?conceptKey=X
 * List form configs for a concept. Open to any authenticated user.
 */
formRouter.get("/", async (req: Request, res: Response) => {
  try {
    const conceptKey = req.query.conceptKey as string | undefined;

    if (!conceptKey) {
      sendError(res, 400, "Query parameter 'conceptKey' is required.");
      return;
    }

    const result = await query(
      `SELECT * FROM form_configs
       WHERE concept_key = $1 AND status = 'active'
       ORDER BY name`,
      [conceptKey]
    );

    res.json({ success: true, data: result.rows } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "listing form configs");
  }
});

/**
 * GET /api/form-configs/:id
 * Get a single form config by ID. Open to any authenticated user.
 */
formRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      "SELECT * FROM form_configs WHERE id = $1 AND status = 'active'",
      [id]
    );

    if (result.rows.length === 0) {
      sendError(res, 404, `Form config "${id}" not found.`);
      return;
    }

    res.json({ success: true, data: result.rows[0] } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "fetching form config");
  }
});

/**
 * POST /api/form-configs
 * Create a new form config. Requires director-level access.
 */
formRouter.post("/", requireRole(DIRECTOR_PRIORITY), async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    const conceptKey = (body.concept_key as string | undefined) ?? (body.conceptKey as string | undefined);
    if (!conceptKey) {
      sendError(res, 400, "Field 'concept_key' is required.");
      return;
    }

    const name = (body.name as string) ?? "default";
    const layout = (body.layout as string) ?? "single";
    const fields = body.fields ?? [];
    const steps = body.steps ?? null;
    const ownerScope = (body.owner_scope as string) ?? "org";
    const ownerDepartment = (body.owner_department as string) ?? null;

    const auditCtx = auditContextFromRequest(req);

    const row = await withAuditContext(auditCtx, async (client) => {
      const result = await client.query(
        `INSERT INTO form_configs
           (concept_key, name, layout, fields, steps, version, status,
            owner_scope, owner_department, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'active', $6, $7, $8, now())
         RETURNING *`,
        [
          conceptKey,
          name,
          layout,
          JSON.stringify(fields),
          steps ? JSON.stringify(steps) : null,
          ownerScope,
          ownerDepartment,
          req.user?.uid ?? null,
        ]
      );
      return result.rows[0];
    });

    await logAuditClaim(auditCtx, "POST /api/form-configs");

    invalidateConfigCaches(conceptKey);

    logger.info("Form config created", {
      id: row.id,
      conceptKey,
      name,
    });

    res.status(201).json({ success: true, data: row } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "creating form config");
  }
});

/**
 * PUT /api/form-configs/:id
 * Update (version) a form config. Requires director-level access.
 *
 * Versioning strategy:
 *   - Lock the current active row
 *   - Insert a new row with version+1, status='active'
 *   - Deprecate the old row
 */
formRouter.put("/:id", requireRole(DIRECTOR_PRIORITY), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    const auditCtx = auditContextFromRequest(req);

    const newRow = await withAuditContext(auditCtx, async (client) => {
      // Lock the current active row
      const existing = await client.query(
        "SELECT * FROM form_configs WHERE id = $1 AND status = 'active' FOR UPDATE",
        [id]
      );

      if (existing.rows.length === 0) {
        throw Object.assign(
          new Error(`Form config "${id}" not found or already deprecated.`),
          { status: 404 }
        );
      }

      const current = existing.rows[0];
      const conceptKey = current.concept_key as string;
      const currentVersion = current.version as number;

      // Merge fields: use new values or fall back to current
      const name = (body.name as string) ?? (current.name as string);
      const layout = (body.layout as string) ?? (current.layout as string);
      const fields = body.fields ?? current.fields;
      const steps = body.steps !== undefined ? body.steps : current.steps;
      const ownerScope = (body.owner_scope as string) ?? (current.owner_scope as string);
      const ownerDepartment = body.owner_department !== undefined
        ? (body.owner_department as string | null)
        : (current.owner_department as string | null);

      // Insert new version
      const insertResult = await client.query(
        `INSERT INTO form_configs
           (concept_key, name, layout, fields, steps, version, status,
            owner_scope, owner_department, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, now())
         RETURNING *`,
        [
          conceptKey,
          name,
          layout,
          JSON.stringify(fields),
          steps ? JSON.stringify(steps) : null,
          currentVersion + 1,
          ownerScope,
          ownerDepartment,
          req.user?.uid ?? null,
        ]
      );

      // Deprecate the old row
      await client.query(
        "UPDATE form_configs SET status = 'deprecated' WHERE id = $1",
        [id]
      );

      return insertResult.rows[0];
    });

    const conceptKey = newRow.concept_key as string;
    await logAuditClaim(auditCtx, `PUT /api/form-configs/${id}`);

    invalidateConfigCaches(conceptKey);

    logger.info("Form config versioned", {
      oldId: id,
      newId: newRow.id,
      conceptKey,
      version: newRow.version,
    });

    res.json({ success: true, data: newRow } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "updating form config");
  }
});

// ============================================================
// View Config Endpoints
// ============================================================

/**
 * GET /api/view-configs?conceptKey=X
 * List view configs for a concept. Open to any authenticated user.
 */
viewRouter.get("/", async (req: Request, res: Response) => {
  try {
    const conceptKey = req.query.conceptKey as string | undefined;

    if (!conceptKey) {
      sendError(res, 400, "Query parameter 'conceptKey' is required.");
      return;
    }

    const result = await query(
      `SELECT * FROM view_configs
       WHERE concept_key = $1 AND status = 'active'
       ORDER BY name`,
      [conceptKey]
    );

    res.json({ success: true, data: result.rows } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "listing view configs");
  }
});

/**
 * GET /api/view-configs/:id
 * Get a single view config by ID. Open to any authenticated user.
 */
viewRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      "SELECT * FROM view_configs WHERE id = $1 AND status = 'active'",
      [id]
    );

    if (result.rows.length === 0) {
      sendError(res, 404, `View config "${id}" not found.`);
      return;
    }

    res.json({ success: true, data: result.rows[0] } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "fetching view config");
  }
});

/**
 * POST /api/view-configs
 * Create a new view config. Requires director-level access.
 * Accepts frontend payload shape and adapts to DB columns.
 */
viewRouter.post("/", requireRole(DIRECTOR_PRIORITY), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Record<string, unknown>;
    const body = adaptViewPayloadToDB(rawBody);

    const conceptKey = (body.concept_key as string | undefined);
    if (!conceptKey) {
      sendError(res, 400, "Field 'concept_key' is required.");
      return;
    }

    const name = (body.name as string) ?? "default";
    const viewType = body.view_type as string;
    if (!viewType) {
      sendError(res, 400, "Field 'viewType' (or 'view_type') is required.");
      return;
    }

    const columns = body.columns ?? null;
    const filters = body.filters ?? null;
    const sort = body.sort ?? null;
    const groupBy = (body.group_by as string) ?? null;
    const timelineStart = (body.timeline_start as string) ?? null;
    const timelineEnd = (body.timeline_end as string) ?? null;
    const rowAction = (body.row_action as string) ?? null;
    const presets = body.presets ?? null;
    const ownerScope = (body.owner_scope as string) ?? "org";
    const ownerDepartment = (body.owner_department as string) ?? null;

    const auditCtx = auditContextFromRequest(req);

    const row = await withAuditContext(auditCtx, async (client) => {
      const result = await client.query(
        `INSERT INTO view_configs
           (concept_key, name, view_type, columns, filters, sort, group_by,
            timeline_start, timeline_end, row_action, presets,
            version, status, owner_scope, owner_department, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 1, 'active', $12, $13, $14, now())
         RETURNING *`,
        [
          conceptKey,
          name,
          viewType,
          columns ? JSON.stringify(columns) : null,
          filters ? JSON.stringify(filters) : null,
          sort ? JSON.stringify(sort) : null,
          groupBy,
          timelineStart,
          timelineEnd,
          rowAction,
          presets ? JSON.stringify(presets) : null,
          ownerScope,
          ownerDepartment,
          req.user?.uid ?? null,
        ]
      );
      return result.rows[0];
    });

    await logAuditClaim(auditCtx, "POST /api/view-configs");

    invalidateConfigCaches(conceptKey);

    logger.info("View config created", {
      id: row.id,
      conceptKey,
      name,
      viewType,
    });

    res.status(201).json({ success: true, data: row } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "creating view config");
  }
});

/**
 * PUT /api/view-configs/:id
 * Update (version) a view config. Requires director-level access.
 * Accepts frontend payload shape and adapts to DB columns.
 *
 * Versioning strategy:
 *   - Lock the current active row
 *   - Insert a new row with version+1, status='active'
 *   - Deprecate the old row
 */
viewRouter.put("/:id", requireRole(DIRECTOR_PRIORITY), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rawBody = req.body as Record<string, unknown>;
    const body = adaptViewPayloadToDB(rawBody);

    const auditCtx = auditContextFromRequest(req);

    const newRow = await withAuditContext(auditCtx, async (client) => {
      // Lock the current active row
      const existing = await client.query(
        "SELECT * FROM view_configs WHERE id = $1 AND status = 'active' FOR UPDATE",
        [id]
      );

      if (existing.rows.length === 0) {
        throw Object.assign(
          new Error(`View config "${id}" not found or already deprecated.`),
          { status: 404 }
        );
      }

      const current = existing.rows[0];
      const conceptKey = current.concept_key as string;
      const currentVersion = current.version as number;

      // Merge fields: use new values or fall back to current
      const name = (body.name as string) ?? (current.name as string);
      const viewType = (body.view_type as string) ?? (current.view_type as string);
      const columns = body.columns !== undefined ? body.columns : current.columns;
      const filters = body.filters !== undefined ? body.filters : current.filters;
      const sort = body.sort !== undefined ? body.sort : current.sort;
      const groupBy = body.group_by !== undefined
        ? (body.group_by as string | null)
        : (current.group_by as string | null);
      const timelineStart = body.timeline_start !== undefined
        ? (body.timeline_start as string | null)
        : (current.timeline_start as string | null);
      const timelineEnd = body.timeline_end !== undefined
        ? (body.timeline_end as string | null)
        : (current.timeline_end as string | null);
      const rowAction = body.row_action !== undefined
        ? (body.row_action as string | null)
        : (current.row_action as string | null);
      const presets = body.presets !== undefined ? body.presets : current.presets;
      const ownerScope = (body.owner_scope as string) ?? (current.owner_scope as string);
      const ownerDepartment = body.owner_department !== undefined
        ? (body.owner_department as string | null)
        : (current.owner_department as string | null);

      // Insert new version
      const insertResult = await client.query(
        `INSERT INTO view_configs
           (concept_key, name, view_type, columns, filters, sort, group_by,
            timeline_start, timeline_end, row_action, presets,
            version, status, owner_scope, owner_department, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, 'active', $13, $14, $15, now())
         RETURNING *`,
        [
          conceptKey,
          name,
          viewType,
          columns ? JSON.stringify(columns) : null,
          filters ? JSON.stringify(filters) : null,
          sort ? JSON.stringify(sort) : null,
          groupBy,
          timelineStart,
          timelineEnd,
          rowAction,
          presets ? JSON.stringify(presets) : null,
          currentVersion + 1,
          ownerScope,
          ownerDepartment,
          req.user?.uid ?? null,
        ]
      );

      // Deprecate the old row
      await client.query(
        "UPDATE view_configs SET status = 'deprecated' WHERE id = $1",
        [id]
      );

      return insertResult.rows[0];
    });

    const conceptKey = newRow.concept_key as string;
    await logAuditClaim(auditCtx, `PUT /api/view-configs/${id}`);

    invalidateConfigCaches(conceptKey);

    logger.info("View config versioned", {
      oldId: id,
      newId: newRow.id,
      conceptKey,
      version: newRow.version,
    });

    res.json({ success: true, data: newRow } as ApiResponse<unknown>);
  } catch (err) {
    handleError(res, err, "updating view config");
  }
});

// --- Export ---

export const configBuilderRouter = { formRouter, viewRouter };
