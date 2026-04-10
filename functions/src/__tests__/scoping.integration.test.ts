/**
 * Ontology Scoping Integration Tests
 *
 * Uses Testcontainers to spin up a real Postgres 16 container,
 * runs all migrations, then verifies scoping constraints at the DB level.
 *
 * 4 integration tests:
 *  1. DB CHECK constraint rejects owner_scope='department' with NULL owner_department
 *  2. DB CHECK constraint rejects owner_scope='org' with non-NULL owner_department
 *  3. Two departments can create properties with same key on same concept
 *  4. Org-wide property blocks same-key dept property (application logic)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { checkPropertyConflict } from "../ontology/scoping";
import { setPool } from "../db/client";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  // Point the application's DB client to the test container pool
  setPool(db.pool);
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

// ---------------------------------------------------------------------------
// 1. DB CHECK: owner_scope='department' with NULL owner_department
// ---------------------------------------------------------------------------

describe("DB CHECK constraint — department scope with NULL department", () => {
  it("rejects INSERT with owner_scope='department' and owner_department=NULL", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_concepts (key, name, plural_name, owner_scope, owner_department)
         VALUES ($1, $2, $3, $4, $5)`,
        ["test_dept_null", "Test Dept Null", "Test Dept Nulls", "department", null]
      );
      expect.fail("INSERT should have been rejected by CHECK constraint");
    } catch (error: unknown) {
      const pgError = error as { code: string; message: string };
      // 23514 = check_violation
      expect(pgError.code).toBe("23514");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. DB CHECK: owner_scope='org' with non-NULL owner_department
// ---------------------------------------------------------------------------

describe("DB CHECK constraint — org scope with non-NULL department", () => {
  it("rejects INSERT with owner_scope='org' and owner_department='gr'", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_concepts (key, name, plural_name, owner_scope, owner_department)
         VALUES ($1, $2, $3, $4, $5)`,
        ["test_org_dept", "Test Org Dept", "Test Org Depts", "org", "gr"]
      );
      expect.fail("INSERT should have been rejected by CHECK constraint");
    } catch (error: unknown) {
      const pgError = error as { code: string; message: string };
      // 23514 = check_violation
      expect(pgError.code).toBe("23514");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Two departments can create properties with same key on same concept
// ---------------------------------------------------------------------------

describe("Composite uniqueness — same key, different departments", () => {
  it("allows two depts to create properties with same key on same concept", async () => {
    const conceptKey = `composite_test_${Date.now()}`;

    // Create the parent concept first
    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name)
       VALUES ($1, $2, $3)`,
      [conceptKey, "Composite Test", "Composite Tests"]
    );

    // GR creates 'notes' property
    await db.query(
      `INSERT INTO ontology_properties (concept_key, key, label, type, owner_scope, owner_department)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conceptKey, "notes", "Notes", "text", "department", "gr"]
    );

    // Exhibits creates 'notes' property on the same concept — should succeed
    await db.query(
      `INSERT INTO ontology_properties (concept_key, key, label, type, owner_scope, owner_department)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conceptKey, "notes", "Notes", "text", "department", "exhibits"]
    );

    // Verify both exist
    const result = await db.query<{ owner_department: string }>(
      `SELECT owner_department FROM ontology_properties
       WHERE concept_key = $1 AND key = $2 AND status = 'active'
       ORDER BY owner_department`,
      [conceptKey, "notes"]
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].owner_department).toBe("exhibits");
    expect(result.rows[1].owner_department).toBe("gr");
  });
});

// ---------------------------------------------------------------------------
// 4. Org-wide property blocks same-key dept property (application logic)
// ---------------------------------------------------------------------------

describe("Org-wide property blocks same-key dept property", () => {
  it("returns 409 conflict when dept property matches existing org property", async () => {
    const conceptKey = `conflict_test_${Date.now()}`;

    // Create the parent concept
    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name)
       VALUES ($1, $2, $3)`,
      [conceptKey, "Conflict Test", "Conflict Tests"]
    );

    // Create org-wide 'notes' property
    await db.query(
      `INSERT INTO ontology_properties (concept_key, key, label, type, owner_scope, owner_department)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conceptKey, "notes", "Notes", "text", "org", null]
    );

    // Attempt to create dept-scoped 'notes' — application logic should return 409
    const conflict = await checkPropertyConflict(conceptKey, "notes", "gr");

    expect(conflict.conflict).toBe(true);
    expect(conflict.status).toBe(409);
    expect(conflict.message).toContain("org-wide property");

    // Verify a different key does NOT conflict
    const noConflict = await checkPropertyConflict(conceptKey, "liaison_notes", "gr");
    expect(noConflict.conflict).toBe(false);
  });
});
