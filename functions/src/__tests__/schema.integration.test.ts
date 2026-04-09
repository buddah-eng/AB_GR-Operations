/**
 * Schema Verification Integration Tests
 *
 * Uses Testcontainers to spin up a real Postgres 16 container,
 * runs all migrations, then verifies the schema matches the PRD.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

// ---------------------------------------------------------------------------
// Expected tables from both migration files
// ---------------------------------------------------------------------------

const EXPECTED_TABLES = [
  // Ontology tables
  "ontology_concepts",
  "ontology_properties",
  "ontology_relationships",
  "ontology_events",
  "ontology_constraints",
  // Config tables
  "form_configs",
  "view_configs",
  "page_configs",
  "workflow_configs",
  // RBAC tables
  "roles",
  "users",
  "permissions",
  "data_scopes",
  "screen_access",
  "api_keys",
  "scoped_tokens",
  // Domain tables
  "guests",
  "staff",
  "schedule_events",
  "prep_items",
  "pairings",
  // Audit / event tables
  "ontology_audit_log",
  "domain_audit_log",
  "event_log",
  "admin_alerts",
  // Phase 2 tables
  "api_audit_claims",
  "guest_registry",
  "vendor_registry",
] as const;

// ---------------------------------------------------------------------------
// 1. All tables exist
// ---------------------------------------------------------------------------

describe("Schema tables", () => {
  it("should contain all expected tables", async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type   = 'BASE TABLE'
        ORDER BY table_name`
    );

    const tableNames = result.rows.map((r) => r.table_name);

    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }

    expect(tableNames.length).toBeGreaterThanOrEqual(EXPECTED_TABLES.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Audit table columns match PRD
// ---------------------------------------------------------------------------

describe("ontology_audit_log columns", () => {
  it("should have all required columns with correct nullability", async () => {
    const result = await db.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'ontology_audit_log'
        ORDER BY ordinal_position`
    );

    const columns = new Map(
      result.rows.map((r) => [r.column_name, r.is_nullable])
    );

    // Required columns
    const expectedColumns = [
      "id",
      "change_set",
      "actor_id",
      "actor_type",
      "action",
      "table_name",
      "record_id",
      "old_data",
      "new_data",
      "ip_address",
      "session_id",
      "created_at",
    ];

    for (const col of expectedColumns) {
      expect(columns.has(col)).toBe(true);
    }

    // NOT NULL constraints
    expect(columns.get("change_set")).toBe("NO");
    expect(columns.get("actor_id")).toBe("NO");
    expect(columns.get("actor_type")).toBe("NO");
  });
});

// ---------------------------------------------------------------------------
// 3. FK constraint enforces
// ---------------------------------------------------------------------------

describe("Foreign key constraints", () => {
  it("should reject a guest with non-existent created_by UUID", async () => {
    const fakeUserId = "00000000-0000-0000-0000-000000000001";

    try {
      await db.query(
        `INSERT INTO guests (name, created_by)
         VALUES ($1, $2)`,
        ["FK Test Guest", fakeUserId]
      );
      expect.fail("INSERT should have thrown a FK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23503");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. CHECK constraint enforces
// ---------------------------------------------------------------------------

describe("CHECK constraints", () => {
  it("should reject ontology_audit_log with invalid actor_type", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_audit_log
           (change_set, actor_id, actor_type, action, table_name, record_id)
         VALUES
           (gen_random_uuid(), 'test', 'hacker', 'INSERT', 'test', gen_random_uuid())`
      );
      expect.fail("INSERT should have thrown a CHECK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23514");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. UNIQUE constraint enforces
// ---------------------------------------------------------------------------

describe("UNIQUE constraints", () => {
  it("should reject duplicate ontology_concepts with same (key, version)", async () => {
    const conceptKey = `unique_test_${Date.now()}`;

    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name)
       VALUES ($1, $2, $3)`,
      [conceptKey, "Test Concept", "Test Concepts"]
    );

    try {
      await db.query(
        `INSERT INTO ontology_concepts (key, name, plural_name)
         VALUES ($1, $2, $3)`,
        [conceptKey, "Duplicate Concept", "Duplicate Concepts"]
      );
      expect.fail("INSERT should have thrown a UNIQUE violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23505");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. GIN indexes exist
// ---------------------------------------------------------------------------

describe("GIN indexes", () => {
  it("should have GIN indexes on JSONB property columns", async () => {
    const result = await db.query<{
      tablename: string;
      indexdef: string;
    }>(
      `SELECT tablename, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexdef LIKE '%GIN%'
        ORDER BY tablename`
    );

    const tablesWithGin = new Set(result.rows.map((r) => r.tablename));

    // Domain tables with JSONB properties columns should have GIN indexes
    const domainTablesWithJsonb = ["guests", "staff"];

    for (const table of domainTablesWithJsonb) {
      expect(tablesWithGin.has(table)).toBe(true);
    }

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Partial indexes exist
// ---------------------------------------------------------------------------

describe("Partial indexes", () => {
  it("should have partial indexes filtering on NOT archived", async () => {
    const result = await db.query<{
      tablename: string;
      indexdef: string;
    }>(
      `SELECT tablename, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexdef LIKE '%NOT archived%'
        ORDER BY tablename`
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(1);

    const tablesWithPartial = new Set(result.rows.map((r) => r.tablename));

    // Domain tables should have partial indexes
    const domainTablesWithArchived = [
      "guests",
      "staff",
      "schedule_events",
      "prep_items",
      "pairings",
    ];

    for (const table of domainTablesWithArchived) {
      expect(tablesWithPartial.has(table)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Audit triggers exist
// ---------------------------------------------------------------------------

describe("Audit triggers", () => {
  it("should have trg_audit triggers on all audited tables", async () => {
    const result = await db.query<{
      event_object_table: string;
      trigger_name: string;
    }>(
      `SELECT event_object_table, trigger_name
         FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND trigger_name LIKE 'trg_audit%'
        ORDER BY event_object_table`
    );

    // Deduplicate — triggers fire for INSERT, UPDATE, DELETE but share a name
    const auditedTables = new Set(
      result.rows.map((r) => r.event_object_table)
    );

    // Ontology tables
    const ontologyTables = [
      "ontology_concepts",
      "ontology_properties",
      "ontology_relationships",
      "ontology_events",
      "ontology_constraints",
    ];

    // Domain tables
    const domainTables = [
      "guests",
      "staff",
      "schedule_events",
      "prep_items",
      "pairings",
    ];

    // Config tables
    const configTables = [
      "form_configs",
      "view_configs",
      "page_configs",
      "workflow_configs",
    ];

    // RBAC tables
    const rbacTables = ["roles", "permissions"];

    const allAudited = [
      ...ontologyTables,
      ...domainTables,
      ...configTables,
      ...rbacTables,
    ];

    for (const table of allAudited) {
      expect(auditedTables.has(table)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Append-only rules exist
// ---------------------------------------------------------------------------

describe("Append-only audit rules", () => {
  it("should have 4 rules preventing UPDATE/DELETE on audit tables", async () => {
    const result = await db.query<{
      rulename: string;
      tablename: string;
    }>(
      `SELECT rulename, tablename
         FROM pg_rules
        WHERE schemaname = 'public'
          AND rulename LIKE 'no_%_audit'
        ORDER BY rulename`
    );

    expect(result.rows.length).toBe(4);

    const ruleNames = result.rows.map((r) => r.rulename).sort();

    expect(ruleNames).toEqual([
      "no_delete_domain_audit",
      "no_delete_ontology_audit",
      "no_update_domain_audit",
      "no_update_ontology_audit",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 10. updated_at triggers exist
// ---------------------------------------------------------------------------

describe("updated_at triggers", () => {
  it("should have set_updated_at triggers on all tables with updated_at columns", async () => {
    const tablesWithUpdatedAt = [
      "roles",
      "users",
      "guests",
      "staff",
      "schedule_events",
      "prep_items",
    ];

    const result = await db.query<{
      event_object_table: string;
      trigger_name: string;
    }>(
      `SELECT event_object_table, trigger_name
         FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND trigger_name = 'set_updated_at'
        ORDER BY event_object_table`
    );

    const triggeredTables = new Set(
      result.rows.map((r) => r.event_object_table)
    );

    for (const table of tablesWithUpdatedAt) {
      expect(triggeredTables.has(table)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. NOT NULL enforces on audit change_set
// ---------------------------------------------------------------------------

describe("NOT NULL constraints", () => {
  it("should reject ontology_audit_log insert with NULL change_set", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_audit_log
           (change_set, actor_id, actor_type, action, table_name, record_id)
         VALUES
           (NULL, 'test', 'system', 'INSERT', 'test', gen_random_uuid())`
      );
      expect.fail("INSERT should have thrown a NOT NULL violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23502");
    }
  });
});
