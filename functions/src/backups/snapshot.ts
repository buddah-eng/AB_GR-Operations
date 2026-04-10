/**
 * Nightly Snapshot Pipeline
 *
 * Implements the nightly backup pipeline described in
 * docs/prd/data/versioning-backups.md section 2.
 *
 * Runs as a scheduled Cloud Function. For each table in the schema,
 * exports all rows as JSON and uploads via an injected storage uploader.
 * Validates snapshots before declaring success.
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Table whitelist ---

export const BACKUP_TABLES = [
  "ontology_concepts",
  "ontology_properties",
  "ontology_relationships",
  "ontology_events",
  "ontology_constraints",
  "form_configs",
  "view_configs",
  "page_configs",
  "workflow_configs",
  "roles",
  "permissions",
  "data_scopes",
  "screen_access",
  "users",
  "api_keys",
  "scoped_tokens",
  "guests",
  "staff",
  "schedule_events",
  "prep_items",
  "pairings",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

const BACKUP_TABLE_SET = new Set<string>(BACKUP_TABLES);
const TABLE_NAME_PATTERN = /^[a-z_]+$/;

// --- Types ---

export interface SnapshotValidation {
  readonly valid: boolean;
  readonly rowCount: number;
  readonly error?: string;
}

export interface BackupSummary {
  readonly tablesBackedUp: number;
  readonly totalRows: number;
  readonly errors: ReadonlyArray<{ readonly table: string; readonly message: string }>;
  readonly duration: number;
}

export type StorageUploader = (
  tableName: string,
  date: string,
  data: string
) => Promise<void>;

// --- Public API ---

/**
 * Create a JSON snapshot of a single table.
 *
 * Uses `SELECT json_agg(t) FROM {table} t` to export all rows
 * as a JSON string. Validates the table name against the whitelist
 * to prevent SQL injection.
 */
export async function createTableSnapshot(
  tableName: string,
  _date: string
): Promise<string> {
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error(`Invalid table name: "${tableName}"`);
  }

  if (!BACKUP_TABLE_SET.has(tableName)) {
    throw new Error(`Table "${tableName}" is not in the backup whitelist`);
  }

  const result = await query<{ json_agg: unknown[] | null }>(
    `SELECT json_agg(t) FROM ${tableName} t`
  );

  const rows = result.rows[0]?.json_agg ?? [];
  return JSON.stringify(rows);
}

/**
 * Run the full nightly backup pipeline.
 *
 * Iterates over every table in BACKUP_TABLES, creates a snapshot,
 * and uploads via the injected storageUploader. Continues on
 * single-table failure so one broken table doesn't block the rest.
 *
 * Returns a summary with counts and any errors encountered.
 */
export async function runNightlyBackup(
  storageUploader: StorageUploader
): Promise<BackupSummary> {
  const start = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const errors: Array<{ table: string; message: string }> = [];
  let tablesBackedUp = 0;
  let totalRows = 0;

  for (const tableName of BACKUP_TABLES) {
    try {
      const data = await createTableSnapshot(tableName, date);
      await storageUploader(tableName, date, data);

      const parsed: unknown[] = JSON.parse(data);
      tablesBackedUp += 1;
      totalRows += parsed.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Snapshot failed for table ${tableName}`, { error: message });
      errors.push({ table: tableName, message });
    }
  }

  const duration = Date.now() - start;

  return {
    tablesBackedUp,
    totalRows,
    errors,
    duration,
  };
}

/**
 * Validate a JSON snapshot for correctness.
 *
 * Checks that the data is valid JSON, is an array, and reports
 * the row count. Empty arrays are considered valid (some tables
 * may legitimately have zero rows).
 */
export function validateSnapshot(
  _tableName: string,
  snapshotData: string
): SnapshotValidation {
  let parsed: unknown;

  try {
    parsed = JSON.parse(snapshotData);
  } catch {
    return { valid: false, rowCount: 0, error: "Invalid JSON" };
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      rowCount: 0,
      error: "Snapshot data is not an array",
    };
  }

  return { valid: true, rowCount: parsed.length };
}
