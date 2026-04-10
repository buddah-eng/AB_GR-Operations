/**
 * Ontology Versioning Service
 *
 * Row-level versioning for ontology tables.
 * Implements the update, rollback, and history traversal flows
 * described in the Versioning & Backups PRD (section 1).
 *
 * Every ontology table carries: version, status, previous_version_id,
 * changed_by, changed_at, change_reason. This service manipulates
 * those columns to maintain an unbroken version chain.
 */

import { query, withTransaction } from "../db/client";
import { withAuditContext } from "../audit/context";
import type { AuditContext } from "../audit/context";
import type { PoolClient } from "pg";

// --- Types ---

export interface OntologyRecord {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly status: string;
  readonly previous_version_id: string | null;
  readonly changed_by: string | null;
  readonly changed_at: string;
  readonly change_reason: string | null;
  readonly [field: string]: unknown;
}

export interface VersioningError {
  readonly code: string;
  readonly message: string;
}

export type VersioningResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: VersioningError };

// --- Table whitelist (SQL injection prevention) ---

const ONTOLOGY_TABLES = new Set([
  "ontology_concepts",
  "ontology_properties",
  "ontology_relationships",
  "ontology_events",
  "ontology_constraints",
  "form_configs",
  "view_configs",
  "page_configs",
  "workflow_configs",
]);

const TABLE_NAME_PATTERN = /^[a-z_]+$/;

function validateTableName(tableName: string): VersioningError | null {
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    return {
      code: "INVALID_TABLE_NAME",
      message: `Table name "${tableName}" contains invalid characters`,
    };
  }
  if (!ONTOLOGY_TABLES.has(tableName)) {
    return {
      code: "TABLE_NOT_ALLOWED",
      message: `Table "${tableName}" is not a valid ontology table`,
    };
  }
  return null;
}

// --- Public API ---

/**
 * Create a new version of an ontology record.
 *
 * 1. Read current active row by key
 * 2. INSERT new row with version+1, status='active', previous_version_id=old.id
 * 3. UPDATE old row to status='deprecated'
 * 4. Both writes in a single transaction
 */
export async function updateOntologyRecord(
  tableName: string,
  recordKey: string,
  updates: Record<string, unknown>,
  changedBy: string,
  changeReason: string,
  auditContext?: AuditContext
): Promise<VersioningResult<OntologyRecord>> {
  const tableError = validateTableName(tableName);
  if (tableError) {
    return { success: false, error: tableError };
  }

  const runInTransaction = auditContext
    ? (fn: (client: PoolClient) => Promise<VersioningResult<OntologyRecord>>) =>
        withAuditContext(auditContext, fn)
    : withTransaction;

  return runInTransaction(async (client: PoolClient) => {
    // 1. Read active row (FOR UPDATE prevents concurrent version races)
    const activeResult = await client.query(
      `SELECT * FROM ${tableName} WHERE key = $1 AND status = 'active' FOR UPDATE`,
      [recordKey]
    );

    if (activeResult.rows.length === 0) {
      return {
        success: false as const,
        error: {
          code: "NOT_FOUND",
          message: `No active record found with key "${recordKey}" in ${tableName}`,
        },
      };
    }

    const oldRow = activeResult.rows[0] as OntologyRecord;

    // 2. Build the new row: spread old columns, apply updates, set version metadata
    const newVersion = oldRow.version + 1;

    const columnNames = Object.keys(oldRow).filter(
      (col) => col !== "id" && col !== "version" && col !== "status" &&
               col !== "previous_version_id" && col !== "changed_by" &&
               col !== "changed_at" && col !== "change_reason"
    );

    // Merge old values with updates
    const mergedValues: Record<string, unknown> = {};
    for (const col of columnNames) {
      mergedValues[col] = col in updates ? updates[col] : oldRow[col];
    }

    // Build INSERT with all columns
    const insertColumns = [
      ...columnNames,
      "version",
      "status",
      "previous_version_id",
      "changed_by",
      "changed_at",
      "change_reason",
    ];
    const insertValues = [
      ...columnNames.map((col) => mergedValues[col]),
      newVersion,
      "active",
      oldRow.id,
      changedBy,
      new Date().toISOString(),
      changeReason,
    ];
    const placeholders = insertValues.map((_, i) => `$${i + 1}`);

    const insertResult = await client.query(
      `INSERT INTO ${tableName} (${insertColumns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      insertValues
    );

    // 3. Deprecate the old row
    await client.query(
      `UPDATE ${tableName} SET status = 'deprecated' WHERE id = $1`,
      [oldRow.id]
    );

    return {
      success: true as const,
      data: insertResult.rows[0] as OntologyRecord,
    };
  });
}

/**
 * Roll back an ontology record to its previous version.
 *
 * 1. Find active row by ID
 * 2. Find predecessor via previous_version_id
 * 3. UPDATE active row to status='rolled_back'
 * 4. UPDATE predecessor to status='active' with rollback note
 * 5. Both writes in a single transaction
 */
export async function rollbackOntologyRecord(
  tableName: string,
  activeRecordId: string,
  changedBy: string,
  reason: string,
  auditContext?: AuditContext
): Promise<VersioningResult<OntologyRecord>> {
  const tableError = validateTableName(tableName);
  if (tableError) {
    return { success: false, error: tableError };
  }

  const runInTransaction = auditContext
    ? (fn: (client: PoolClient) => Promise<VersioningResult<OntologyRecord>>) =>
        withAuditContext(auditContext, fn)
    : withTransaction;

  return runInTransaction(async (client: PoolClient) => {
    // 1. Find the active row (FOR UPDATE prevents concurrent rollback races)
    const activeResult = await client.query(
      `SELECT * FROM ${tableName} WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [activeRecordId]
    );

    if (activeResult.rows.length === 0) {
      return {
        success: false as const,
        error: {
          code: "NOT_FOUND",
          message: `No active record found with id "${activeRecordId}" in ${tableName}`,
        },
      };
    }

    const activeRow = activeResult.rows[0] as OntologyRecord;

    // 2. Find the predecessor
    if (!activeRow.previous_version_id) {
      return {
        success: false as const,
        error: {
          code: "NO_PREVIOUS_VERSION",
          message: `Record "${activeRecordId}" has no previous version to roll back to`,
        },
      };
    }

    const predecessorResult = await client.query(
      `SELECT * FROM ${tableName} WHERE id = $1`,
      [activeRow.previous_version_id]
    );

    if (predecessorResult.rows.length === 0) {
      return {
        success: false as const,
        error: {
          code: "PREDECESSOR_NOT_FOUND",
          message: `Previous version "${activeRow.previous_version_id}" not found in ${tableName}`,
        },
      };
    }

    // 3. Mark active row as rolled_back
    await client.query(
      `UPDATE ${tableName} SET status = 'rolled_back' WHERE id = $1`,
      [activeRecordId]
    );

    // 4. Reactivate predecessor with rollback note
    const rollbackNote = `Rollback of version ${activeRow.version} by ${changedBy}: ${reason}`;
    const reactivatedResult = await client.query(
      `UPDATE ${tableName}
       SET status = 'active',
           changed_by = $1,
           changed_at = $2,
           change_reason = $3
       WHERE id = $4
       RETURNING *`,
      [changedBy, new Date().toISOString(), rollbackNote, activeRow.previous_version_id]
    );

    return {
      success: true as const,
      data: reactivatedResult.rows[0] as OntologyRecord,
    };
  });
}

/**
 * Retrieve the full version history of a record by key.
 *
 * Finds the most recent version, then walks the previous_version_id
 * chain using a recursive CTE. Returns versions ordered by version DESC.
 */
export async function getVersionHistory(
  tableName: string,
  recordKey: string
): Promise<VersioningResult<ReadonlyArray<OntologyRecord>>> {
  const tableError = validateTableName(tableName);
  if (tableError) {
    return { success: false, error: tableError };
  }

  const result = await query(
    `WITH RECURSIVE history AS (
       SELECT * FROM ${tableName}
       WHERE key = $1
         AND version = (
           SELECT MAX(version) FROM ${tableName} WHERE key = $1
         )
       UNION ALL
       SELECT t.* FROM ${tableName} t
       JOIN history h ON h.previous_version_id = t.id
     )
     SELECT * FROM history ORDER BY version DESC`,
    [recordKey]
  );

  return {
    success: true,
    data: result.rows as OntologyRecord[],
  };
}

/**
 * Get the current active version of a record by key.
 * Returns null if no active version exists.
 */
export async function getActiveVersion(
  tableName: string,
  recordKey: string
): Promise<VersioningResult<OntologyRecord | null>> {
  const tableError = validateTableName(tableName);
  if (tableError) {
    return { success: false, error: tableError };
  }

  const result = await query(
    `SELECT * FROM ${tableName} WHERE key = $1 AND status = 'active'`,
    [recordKey]
  );

  return {
    success: true,
    data: (result.rows[0] as OntologyRecord) ?? null,
  };
}
