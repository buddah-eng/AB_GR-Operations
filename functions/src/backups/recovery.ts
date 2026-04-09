/**
 * Disaster Recovery Validation
 *
 * Implements the post-recovery validation checks described in
 * docs/prd/data/versioning-backups.md section 5.
 *
 * Runs integrity checks against the live database to confirm
 * data consistency after a restore or as a periodic health check.
 */

import { query } from "../db/client";

// --- Types ---

export interface IntegrityCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface IntegrityResult {
  readonly passed: boolean;
  readonly checks: ReadonlyArray<IntegrityCheck>;
}

// --- Ontology tables to verify for active-row uniqueness ---

const ONTOLOGY_TABLES = [
  "ontology_concepts",
  "ontology_properties",
  "ontology_relationships",
  "ontology_events",
  "ontology_constraints",
] as const;

// --- Public API ---

/**
 * Validate database integrity with a series of consistency checks.
 *
 * Checks:
 * 1. Each ontology table has at most one active row per key
 * 2. FK constraint: guests.created_by references a valid users.id
 * 3. Audit log tables are non-empty
 *
 * Returns a structured result with per-check pass/fail and details.
 */
export async function validateDatabaseIntegrity(): Promise<IntegrityResult> {
  const checks: IntegrityCheck[] = [];

  // Check 1: No duplicate active rows per key in ontology tables
  for (const tableName of ONTOLOGY_TABLES) {
    try {
      const result = await query<{ key: string; count: string }>(
        `SELECT key, COUNT(*) as count FROM ${tableName} WHERE status = 'active' GROUP BY key HAVING COUNT(*) > 1`
      );

      const hasDuplicates = result.rows.length > 0;
      checks.push({
        name: `${tableName}_unique_active`,
        passed: !hasDuplicates,
        detail: hasDuplicates
          ? `Found ${result.rows.length} key(s) with duplicate active rows: ${result.rows.map((r) => r.key).join(", ")}`
          : "No duplicate active rows",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        name: `${tableName}_unique_active`,
        passed: false,
        detail: `Check failed: ${message}`,
      });
    }
  }

  // Check 2: FK integrity — guests.created_by references users.id
  try {
    const result = await query<{ orphan_count: string }>(
      `SELECT COUNT(*) as orphan_count FROM guests g
       WHERE g.created_by IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.created_by)`
    );

    const orphanCount = parseInt(result.rows[0]?.orphan_count ?? "0", 10);
    checks.push({
      name: "guests_created_by_fk",
      passed: orphanCount === 0,
      detail:
        orphanCount === 0
          ? "All guests.created_by values reference valid users"
          : `Found ${orphanCount} guest(s) with orphaned created_by references`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "guests_created_by_fk",
      passed: false,
      detail: `Check failed: ${message}`,
    });
  }

  // Check 3: Audit log tables are non-empty
  try {
    const result = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM ontology_audit_log"
    );

    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    checks.push({
      name: "audit_log_non_empty",
      passed: count > 0,
      detail:
        count > 0
          ? `Audit log contains ${count} entries`
          : "Audit log is empty — expected at least one entry",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "audit_log_non_empty",
      passed: false,
      detail: `Check failed: ${message}`,
    });
  }

  const allPassed = checks.every((c) => c.passed);

  return { passed: allPassed, checks };
}
