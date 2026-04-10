/**
 * Constraint Enforcement Integration Tests
 *
 * Verifies that Postgres constraints (FK, CHECK, UNIQUE, NOT NULL)
 * correctly reject invalid data. Uses Testcontainers with a real
 * Postgres 16 container.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { seedRole, seedGuest } from "./helpers/seed";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

// ---------------------------------------------------------------------------
// 1. FK: guest with invalid created_by
// ---------------------------------------------------------------------------

describe("FK constraints", () => {
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

  // ---------------------------------------------------------------------------
  // 2. FK: pairing with invalid guest_id
  // ---------------------------------------------------------------------------

  it("should reject a pairing with non-existent guest_id", async () => {
    const fakeGuestId = "00000000-0000-0000-0000-000000000002";
    const fakeStaffId = "00000000-0000-0000-0000-000000000003";

    try {
      await db.query(
        `INSERT INTO pairings (guest_id, staff_id, role)
         VALUES ($1, $2, $3)`,
        [fakeGuestId, fakeStaffId, "liaison"]
      );
      expect.fail("INSERT should have thrown a FK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23503");
    }
  });

  // ---------------------------------------------------------------------------
  // 3. FK: permission with invalid role_key
  // ---------------------------------------------------------------------------

  it("should reject a permission with non-existent role_key", async () => {
    try {
      await db.query(
        `INSERT INTO permissions (role_key, concept_key, can_view)
         VALUES ($1, $2, $3)`,
        ["nonexistent_role", "guest", true]
      );
      expect.fail("INSERT should have thrown a FK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23503");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. CHECK: invalid actor_type
// ---------------------------------------------------------------------------

describe("CHECK constraints", () => {
  it("should reject ontology_audit_log with actor_type='hacker'", async () => {
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

  // ---------------------------------------------------------------------------
  // 5. CHECK: invalid action
  // ---------------------------------------------------------------------------

  it("should reject ontology_audit_log with action='TRUNCATE'", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_audit_log
           (change_set, actor_id, actor_type, action, table_name, record_id)
         VALUES
           (gen_random_uuid(), 'test', 'system', 'TRUNCATE', 'test', gen_random_uuid())`
      );
      expect.fail("INSERT should have thrown a CHECK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23514");
    }
  });

  // ---------------------------------------------------------------------------
  // 6. CHECK: invalid ontology status
  // ---------------------------------------------------------------------------

  it("should reject ontology_concepts with status='invalid'", async () => {
    try {
      await db.query(
        `INSERT INTO ontology_concepts (key, name, plural_name, status)
         VALUES ($1, $2, $3, $4)`,
        [`check_status_${Date.now()}`, "Bad Status", "Bad Statuses", "invalid"]
      );
      expect.fail("INSERT should have thrown a CHECK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23514");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. UNIQUE: duplicate concept key+version
// ---------------------------------------------------------------------------

describe("UNIQUE constraints", () => {
  it("should reject duplicate ontology_concepts with same (key, version)", async () => {
    const conceptKey = `unique_concept_${Date.now()}`;

    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name)
       VALUES ($1, $2, $3)`,
      [conceptKey, "First Concept", "First Concepts"]
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

  // ---------------------------------------------------------------------------
  // 8. UNIQUE: duplicate permission role+concept
  // ---------------------------------------------------------------------------

  it("should reject duplicate permissions with same (role_key, concept_key)", async () => {
    const roleKey = `unique_perm_role_${Date.now()}`;
    const conceptKey = `unique_perm_concept_${Date.now()}`;

    await seedRole(db.pool, roleKey, "Unique Perm Role", 100);

    await db.query(
      `INSERT INTO permissions (role_key, concept_key, can_view)
       VALUES ($1, $2, $3)`,
      [roleKey, conceptKey, true]
    );

    try {
      await db.query(
        `INSERT INTO permissions (role_key, concept_key, can_view)
         VALUES ($1, $2, $3)`,
        [roleKey, conceptKey, false]
      );
      expect.fail("INSERT should have thrown a UNIQUE violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23505");
    }
  });
});

// ---------------------------------------------------------------------------
// 9. NOT NULL: audit change_set
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

// ---------------------------------------------------------------------------
// 10. Soft delete exclusion
// ---------------------------------------------------------------------------

describe("Soft delete filtering", () => {
  it("should return only non-archived guests when filtering WHERE NOT archived", async () => {
    const prefix = `softdel_${Date.now()}`;

    const id1 = await seedGuest(db.pool, `${prefix}_guest1`);
    const id2 = await seedGuest(db.pool, `${prefix}_guest2`);
    const id3 = await seedGuest(db.pool, `${prefix}_guest3`);

    // Archive the second guest
    await db.query(
      `UPDATE guests SET archived = true WHERE id = $1`,
      [id2]
    );

    const result = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM guests
       WHERE name LIKE $1 AND NOT archived
       ORDER BY name`,
      [`${prefix}%`]
    );

    expect(result.rows).toHaveLength(2);

    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toContain(id1);
    expect(returnedIds).toContain(id3);
    expect(returnedIds).not.toContain(id2);
  });
});
