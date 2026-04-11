/**
 * Generic CRUD Router for Domain Concepts
 *
 * Provides RESTful endpoints for any ontology concept:
 *   POST   /api/domains/:concept       -- create
 *   GET    /api/domains/:concept       -- list (paginated, filtered, sorted)
 *   GET    /api/domains/:concept/:id   -- get single record
 *   PUT    /api/domains/:concept/:id   -- update
 *   DELETE /api/domains/:concept/:id   -- archive (soft delete)
 *
 * Every route validates the concept exists in the ontology, enforces RBAC,
 * and fires domain events on writes. Postgres is the system of record.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import type { PoolClient } from "pg";
import { getConceptByKey, getPropertiesForConcept } from "../ontology/loader";
import { roleEngine } from "../roles/engine";
import { emit, createDomainEvent } from "../events/bus";
import { requireAuth } from "../auth/middleware";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { encryptPiiFields, decryptPiiFields, isEncryptionConfigured, computeHmac, isHmacConfigured } from "../encryption/crypto";
import { validateCondition } from "../conditions/evaluator";
import { checkBulkLimit, sendBulkConfirmationRequired } from "./bulk-limit";
import type { ApiResponse, DomainRecord, Property } from "../ontology/types";

// --- Router ---

export const domainRouter = Router();

domainRouter.use(requireAuth);

// --- Concept-to-table mapping ---

/**
 * Maps a concept key to its Postgres table name.
 * Convention: concept key is singular, table name matches.
 */
function conceptToTable(conceptKey: string): string {
  const tableMap: Record<string, string> = {
    guest: "guests",
    staff: "staff",
    volunteer: "staff",
    schedule: "schedule_events",
    schedule_event: "schedule_events",
    prep_item: "prep_items",
    pairing: "pairings",
    venue: "venues",
    shift: "shifts",
    shift_assignment: "shift_assignments",
    equipment: "equipment",
    transport: "transport_bookings",
    transport_booking: "transport_bookings",
    workflow: "workflow_configs",
    workflow_config: "workflow_configs",
    contract_template: "contract_templates",
    contract_clause: "contract_clauses",
    guest_contract: "guest_contracts",
    guest_contract: "guest_contracts",
  };
  const table = tableMap[conceptKey];
  if (!table) {
    throw Object.assign(
      new Error(`No table mapping for concept "${conceptKey}"`),
      { status: 400 }
    );
  }
  return table;
}

/** Validates that an identifier is safe for SQL interpolation (letters, digits, underscores only). */
function isSafeIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(name);
}

// --- List records ---

domainRouter.get("/:concept", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const { concept } = conceptResult;
    const roleKey = req.role?.roleKey ?? "viewer";

    const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
    if (!canView) {
      sendError(res, 403, `You do not have permission to view ${concept.pluralName}.`);
      return;
    }

    const page = clampInt(req.query.page, 1, 10000, 1);
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = (page - 1) * limit;

    const table = conceptToTable(conceptKey);
    const properties = await getPropertiesForConcept(conceptKey);

    // Build WHERE clause from filters and data scope
    const { whereClause, params: filterParams } = buildWhereClause(
      req.query,
      properties,
      roleKey,
      conceptKey,
      req.user?.uid ?? ""
    );

    // Apply data scope filter from RBAC
    const dataScopeFilter = await roleEngine.buildDataScopeFilter(roleKey, conceptKey, req.user?.uid ?? "");
    let dataScopeClause = "";
    const dataScopeParams: unknown[] = [];
    if (dataScopeFilter && isSafeIdentifier(dataScopeFilter.column)) {
      const paramIndex = filterParams.length + 1;
      dataScopeClause = ` AND ${dataScopeFilter.column} ${dataScopeFilter.operator} $${paramIndex}`;
      dataScopeParams.push(dataScopeFilter.value);
    }

    const combinedParams = [...filterParams, ...dataScopeParams];
    const combinedWhereClause = whereClause + dataScopeClause;

    // Build ORDER BY
    const orderBy = buildOrderBy(req.query, properties);

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) FROM ${table} WHERE NOT archived ${combinedWhereClause}`,
      combinedParams
    );
    const total = parseInt(countResult.rows[0].count as string, 10);

    // Fetch page
    const dataResult = await query(
      `SELECT * FROM ${table} WHERE NOT archived ${combinedWhereClause} ${orderBy} LIMIT $${combinedParams.length + 1} OFFSET $${combinedParams.length + 2}`,
      [...combinedParams, limit, offset]
    );

    // Filter visible properties per record
    const records = await Promise.all(
      dataResult.rows.map(async (row) => {
        const record = rowToDomainRecord(row, conceptKey);
        const filteredProps = await roleEngine.filterRecord(
          roleKey, conceptKey, record.properties
        );
        // Decrypt PII only after RBAC filter — if role can't see the field, decryption never runs
        const decryptedProps = isEncryptionConfigured()
          ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
          : filteredProps;
        return { ...record, properties: decryptedProps };
      })
    );

    const response: ApiResponse<ReadonlyArray<DomainRecord>> = {
      success: true,
      data: records,
      meta: { total, page, limit, hasMore: offset + limit < total },
    };

    res.json(response);
  } catch (err) {
    handleError(res, err, "listing records");
  }
});

// --- Get single record ---

domainRouter.get("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
    if (!canView) {
      sendError(res, 403, "You do not have permission to view this record.");
      return;
    }

    const table = conceptToTable(conceptKey);
    const result = await query(
      `SELECT * FROM ${table} WHERE id = $1 AND NOT archived`,
      [id]
    );

    if (result.rows.length === 0) {
      sendError(res, 404, "Record not found.");
      return;
    }

    const record = rowToDomainRecord(result.rows[0], conceptKey);
    const filteredProps = await roleEngine.filterRecord(
      roleKey, conceptKey, record.properties
    );
    const decryptedProps = isEncryptionConfigured()
      ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
      : filteredProps;

    res.json({
      success: true,
      data: { ...record, properties: decryptedProps },
    } as ApiResponse<DomainRecord>);
  } catch (err) {
    handleError(res, err, "fetching record");
  }
});

// --- Create record ---

domainRouter.post("/:concept", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const { concept } = conceptResult;
    const roleKey = req.role?.roleKey ?? "viewer";

    const canCreate = await roleEngine.canPerformAction(roleKey, conceptKey, "create");
    if (!canCreate) {
      sendError(res, 403, `You do not have permission to create ${concept.pluralName}.`);
      return;
    }

    const rawPayload = req.body as Record<string, unknown>;
    const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, rawPayload);

    // W-2: Validate condition field if present
    if (filteredPayload.condition && typeof filteredPayload.condition === "object") {
      const conditionError = validateCondition(filteredPayload.condition);
      if (conditionError) {
        sendError(res, 400, `Invalid condition: ${conditionError}`);
        return;
      }
    }

    const properties = await getPropertiesForConcept(conceptKey);
    const table = conceptToTable(conceptKey);

    const { coreColumns, jsonbProperties } = separateProperties(filteredPayload, properties);
    coreColumns.created_by = req.user?.uid ?? null;

    // C-5: Compute HMAC blind index for email
    if (typeof filteredPayload.email === "string" && isEncryptionConfigured() && isHmacConfigured()) {
      coreColumns.email_hmac = computeHmac(filteredPayload.email);
    }

    // Encrypt PII fields before writing to Postgres
    const encryptedProps = isEncryptionConfigured() ? encryptPiiFields(jsonbProperties) : jsonbProperties;

    const auditCtx = auditContextFromRequest(req);
    const row = await withAuditContext(auditCtx, (client) =>
      insertRecord(table, coreColumns, encryptedProps, client)
    );
    const record = rowToDomainRecord(row, conceptKey);

    // Log audit claim for rogue-actor detection
    logAuditClaim(auditCtx, `POST /api/domains/${conceptKey}`);

    // C-4: Pass changeSet to domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.created`,
      domain: conceptKey,
      action: "created",
      recordId: record.id,
      newValues: filteredPayload,
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    // W-1: Apply RBAC filtering and decryption to write response
    const filteredProps = await roleEngine.filterRecord(
      roleKey, conceptKey, record.properties
    );
    const decryptedProps = isEncryptionConfigured()
      ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
      : filteredProps;

    res.status(201).json({
      success: true,
      data: { ...record, properties: decryptedProps },
    } as ApiResponse<DomainRecord>);
  } catch (err) {
    handleError(res, err, "creating record");
  }
});

// --- Update record ---

domainRouter.put("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canEdit = await roleEngine.canPerformAction(roleKey, conceptKey, "edit");
    if (!canEdit) {
      sendError(res, 403, "You do not have permission to edit this record.");
      return;
    }

    const table = conceptToTable(conceptKey);

    // Get existing record for change tracking (include archived to distinguish 404 vs write-protected)
    const existing = await query(
      `SELECT * FROM ${table} WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      sendError(res, 404, "Record not found.");
      return;
    }

    const existingRow = existing.rows[0];

    // S-6: Archived records are write-protected
    if (existingRow.archived === true) {
      sendError(res, 400, "Cannot modify archived records.");
      return;
    }
    const rawPayload = req.body as Record<string, unknown>;
    const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, rawPayload);

    // W-2: Validate condition field if present
    if (filteredPayload.condition && typeof filteredPayload.condition === "object") {
      const conditionError = validateCondition(filteredPayload.condition);
      if (conditionError) {
        sendError(res, 400, `Invalid condition: ${conditionError}`);
        return;
      }
    }

    const properties = await getPropertiesForConcept(conceptKey);
    const { coreColumns, jsonbProperties } = separateProperties(filteredPayload, properties);

    // C-5: Compute HMAC blind index for email
    if (typeof filteredPayload.email === "string" && isEncryptionConfigured() && isHmacConfigured()) {
      coreColumns.email_hmac = computeHmac(filteredPayload.email);
    }

    // Determine changed fields
    const existingProps = (existingRow.properties ?? {}) as Record<string, unknown>;
    const allExisting = { ...existingRow, ...existingProps };
    const changedFields = Object.keys(filteredPayload).filter(
      (key) => JSON.stringify(filteredPayload[key]) !== JSON.stringify(allExisting[key])
    );

    if (changedFields.length === 0) {
      const record = rowToDomainRecord(existingRow, conceptKey);
      res.json({ success: true, data: record } as ApiResponse<DomainRecord>);
      return;
    }

    // Encrypt PII fields before writing to Postgres
    const encryptedProps = isEncryptionConfigured() ? encryptPiiFields(jsonbProperties) : jsonbProperties;

    const auditCtx = auditContextFromRequest(req);
    const row = await withAuditContext(auditCtx, (client) =>
      updateRecord(table, id, coreColumns, encryptedProps, client)
    );
    const record = rowToDomainRecord(row, conceptKey);

    logAuditClaim(auditCtx, `PUT /api/domains/${conceptKey}/${id}`);

    const previousValues = Object.fromEntries(
      changedFields.map((key) => [key, allExisting[key]])
    );

    // C-4: Pass changeSet to domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.updated`,
      domain: conceptKey,
      action: "updated",
      recordId: id,
      changedFields,
      previousValues,
      newValues: Object.fromEntries(
        changedFields.map((key) => [key, filteredPayload[key]])
      ),
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    // W-1: Apply RBAC filtering and decryption to write response
    const filteredProps = await roleEngine.filterRecord(
      roleKey, conceptKey, record.properties
    );
    const decryptedProps = isEncryptionConfigured()
      ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
      : filteredProps;

    res.json({ success: true, data: { ...record, properties: decryptedProps } } as ApiResponse<DomainRecord>);
  } catch (err) {
    handleError(res, err, "updating record");
  }
});

// --- Delete (archive) record ---
//
// Bulk-limit note (PRD versioning-backups section 4):
// When batch DELETE endpoints are added, apply checkBulkLimit() here before
// processing. For single-record deletes the threshold (5) is never reached.
// Also consider cascade: archiving a record may affect related records
// (e.g., archiving a guest should cascade to their pairings, contracts).
// When cascade logic is added, count cascading records toward the bulk limit.

domainRouter.delete("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canDelete = await roleEngine.canPerformAction(roleKey, conceptKey, "delete");
    if (!canDelete) {
      sendError(res, 403, "You do not have permission to delete this record.");
      return;
    }

    const table = conceptToTable(conceptKey);
    const auditCtx = auditContextFromRequest(req);

    await withAuditContext(auditCtx, (client) =>
      client.query(
        `UPDATE ${table} SET archived = true, updated_at = now() WHERE id = $1`,
        [id]
      )
    );

    logAuditClaim(auditCtx, `DELETE /api/domains/${conceptKey}/${id}`);

    // C-4: Pass changeSet to domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.deleted`,
      domain: conceptKey,
      action: "deleted",
      recordId: id,
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    res.json({ success: true, data: null } as ApiResponse<null>);
  } catch (err) {
    handleError(res, err, "deleting record");
  }
});

// --- Helpers ---

async function validateConcept(
  conceptKey: string,
  res: Response
): Promise<{ concept: NonNullable<Awaited<ReturnType<typeof getConceptByKey>>> } | null> {
  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    sendError(res, 404, `Unknown concept: "${conceptKey}". Check /api/ontology/concepts.`);
    return null;
  }
  return { concept };
}

/**
 * Separates a payload into typed core columns and JSONB properties
 * based on the ontology property definitions.
 */
function separateProperties(
  payload: Readonly<Record<string, unknown>>,
  properties: ReadonlyArray<Property>
): { coreColumns: Record<string, unknown>; jsonbProperties: Record<string, unknown> } {
  const coreColumns: Record<string, unknown> = {};
  const jsonbProperties: Record<string, unknown> = {};

  const corePropertyKeys = new Set(
    properties.filter((p) => p.postgresColumn).map((p) => p.key)
  );
  const corePropToColumn = new Map(
    properties.filter((p) => p.postgresColumn).map((p) => [p.key, p.postgresColumn!])
  );

  // Well-known core columns that always go to typed columns
  const wellKnownCore = new Set(["name", "status", "type", "department", "email", "phone", "company", "role_key"]);

  for (const [key, value] of Object.entries(payload)) {
    if (corePropertyKeys.has(key)) {
      coreColumns[corePropToColumn.get(key)!] = value;
    } else if (wellKnownCore.has(key)) {
      coreColumns[key] = value;
    } else {
      jsonbProperties[key] = value;
    }
  }

  return { coreColumns, jsonbProperties };
}

async function insertRecord(
  table: string,
  coreColumns: Record<string, unknown>,
  jsonbProperties: Record<string, unknown>,
  client?: PoolClient
): Promise<Record<string, unknown>> {
  const cols = Object.keys(coreColumns).filter(isSafeIdentifier);
  const vals = cols.map((c) => coreColumns[c]);

  // Add properties JSONB
  cols.push("properties");
  vals.push(JSON.stringify(jsonbProperties));

  const placeholders = vals.map((_, i) => `$${i + 1}`);

  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
  const result = client
    ? await client.query(sql, vals)
    : await query(sql, vals);

  return result.rows[0];
}

async function updateRecord(
  table: string,
  id: string,
  coreColumns: Record<string, unknown>,
  jsonbProperties: Record<string, unknown>,
  client?: PoolClient
): Promise<Record<string, unknown>> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const [col, val] of Object.entries(coreColumns)) {
    if (!isSafeIdentifier(col)) continue;
    setClauses.push(`${col} = $${paramIdx}`);
    params.push(val);
    paramIdx++;
  }

  // Merge JSONB properties (preserve existing, update changed)
  if (Object.keys(jsonbProperties).length > 0) {
    setClauses.push(`properties = properties || $${paramIdx}`);
    params.push(JSON.stringify(jsonbProperties));
    paramIdx++;
  }

  setClauses.push(`updated_at = now()`);

  params.push(id);

  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`;
  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  if (result.rows.length === 0) {
    throw Object.assign(new Error("Record not found"), { status: 404 });
  }

  return result.rows[0];
}

function rowToDomainRecord(
  row: Record<string, unknown>,
  conceptKey: string
): DomainRecord {
  const props = (row.properties ?? {}) as Record<string, unknown>;

  // Merge typed columns into properties for a unified view
  const allProperties: Record<string, unknown> = { ...props };
  const metaKeys = new Set(["id", "properties", "created_at", "updated_at", "created_by", "archived"]);
  for (const [key, value] of Object.entries(row)) {
    if (!metaKeys.has(key) && value !== null) {
      allProperties[key] = value;
    }
  }

  return {
    id: row.id as string,
    conceptKey,
    properties: allProperties,
    relations: {},
    createdAt: (row.created_at as Date)?.toISOString() ?? new Date().toISOString(),
    updatedAt: (row.updated_at as Date)?.toISOString() ?? new Date().toISOString(),
  };
}

function buildWhereClause(
  queryParams: Record<string, unknown>,
  properties: ReadonlyArray<Property>,
  roleKey: string,
  conceptKey: string,
  userId: string
): { whereClause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(queryParams)) {
    const match = /^filter\[(.+)]$/.exec(key);
    if (!match || !value) continue;

    const fieldKey = match[1];
    const prop = properties.find((p) => p.key === fieldKey);
    if (!prop) continue;

    if (prop.postgresColumn && isSafeIdentifier(prop.postgresColumn)) {
      clauses.push(`AND ${prop.postgresColumn} = $${paramIdx}`);
    } else if (isSafeIdentifier(fieldKey)) {
      clauses.push(`AND properties->>'${fieldKey}' = $${paramIdx}`);
    } else {
      continue; // Skip unsafe field names
    }
    params.push(String(value));
    paramIdx++;
  }

  return { whereClause: clauses.join(" "), params };
}

function buildOrderBy(
  queryParams: Record<string, unknown>,
  properties: ReadonlyArray<Property>
): string {
  const sortKey = queryParams.sort as string | undefined;
  if (!sortKey) return "ORDER BY created_at DESC";

  const prop = properties.find((p) => p.key === sortKey);
  if (!prop) return "ORDER BY created_at DESC";

  const direction = (queryParams.direction as string) === "desc" ? "DESC" : "ASC";

  if (prop.postgresColumn && isSafeIdentifier(prop.postgresColumn)) {
    return `ORDER BY ${prop.postgresColumn} ${direction}`;
  }
  if (isSafeIdentifier(sortKey)) {
    return `ORDER BY properties->>'${sortKey}' ${direction}`;
  }
  return "ORDER BY created_at DESC";
}

function clampInt(value: unknown, min: number, max: number, defaultVal: number): number {
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message } as ApiResponse<never>);
}

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  sendError(res, status ?? 500, `Internal error while ${context}: ${message}`);
}

// Exported for testing
export {
  conceptToTable,
  isSafeIdentifier,
  separateProperties,
  buildWhereClause,
  buildOrderBy,
  rowToDomainRecord,
};

// C-7: Re-export bulk-limit utilities for future batch endpoints (Phase 3+).
// Currently unused by single-record CRUD, but wired in so the infrastructure
// is connected. When batch endpoints are added, import these and call
// checkBulkLimit() before processing any batch operation.
export { checkBulkLimit, sendBulkConfirmationRequired };
