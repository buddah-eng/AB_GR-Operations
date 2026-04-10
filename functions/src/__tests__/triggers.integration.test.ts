/**
 * Trigger Verification Integration Tests
 *
 * Proves that Postgres audit triggers fire correctly for ontology and domain
 * tables, session variables propagate to audit rows, fallback defaults apply
 * when no session vars are set, and append-only rules prevent mutation of
 * audit log tables.
 *
 * Requires Docker — spins up a disposable Postgres 16 container via Testcontainers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { seedRole, seedConcept, seedGuest } from "./helpers/seed";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

// ---------------------------------------------------------------------------
// Ontology Audit Trigger
// ---------------------------------------------------------------------------

describe("Ontology Audit Trigger", () => {
  it("INSERT fires trigger and logs to ontology_audit_log", async () => {
    const conceptId = await seedConcept(db.pool, "trigger-insert", "Trigger Insert Test");

    const result = await db.query<{
      action: string;
      new_data: Record<string, unknown>;
      old_data: Record<string, unknown> | null;
      record_id: string;
    }>(
      `SELECT action, new_data, old_data, record_id
       FROM ontology_audit_log
       WHERE table_name = 'ontology_concepts' AND record_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [conceptId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.action).toBe("INSERT");
    expect(row.new_data).not.toBeNull();
    expect(row.old_data).toBeNull();
    expect(row.record_id).toBe(conceptId);
  });

  it("UPDATE fires trigger with old and new data", async () => {
    const conceptId = await seedConcept(db.pool, "trigger-update", "Original Name");

    await db.query(
      `UPDATE ontology_concepts SET name = $1 WHERE id = $2`,
      ["Updated Name", conceptId]
    );

    const result = await db.query<{
      action: string;
      old_data: Record<string, unknown>;
      new_data: Record<string, unknown>;
    }>(
      `SELECT action, old_data, new_data
       FROM ontology_audit_log
       WHERE table_name = 'ontology_concepts' AND record_id = $1 AND action = 'UPDATE'
       ORDER BY created_at DESC LIMIT 1`,
      [conceptId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.action).toBe("UPDATE");
    expect(row.old_data).not.toBeNull();
    expect(row.new_data).not.toBeNull();
    expect((row.old_data as Record<string, unknown>).name).toBe("Original Name");
    expect((row.new_data as Record<string, unknown>).name).toBe("Updated Name");
  });

  it("DELETE fires trigger with old_data populated and new_data null", async () => {
    const conceptId = await seedConcept(db.pool, "trigger-delete", "Delete Me");

    await db.query(`DELETE FROM ontology_concepts WHERE id = $1`, [conceptId]);

    const result = await db.query<{
      action: string;
      old_data: Record<string, unknown>;
      new_data: Record<string, unknown> | null;
    }>(
      `SELECT action, old_data, new_data
       FROM ontology_audit_log
       WHERE table_name = 'ontology_concepts' AND record_id = $1 AND action = 'DELETE'
       ORDER BY created_at DESC LIMIT 1`,
      [conceptId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.action).toBe("DELETE");
    expect(row.old_data).not.toBeNull();
    expect(row.new_data).toBeNull();
  });

  it("session variables propagate to audit row when SET LOCAL is used", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.actor_id = 'user-abc-123'");
      await client.query("SET LOCAL app.actor_type = 'human'");
      await client.query("SET LOCAL app.change_set = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'");

      const insertResult = await client.query(
        `INSERT INTO ontology_concepts (key, name, plural_name)
         VALUES ('session-var-test', 'Session Var Test', 'Session Var Tests')
         RETURNING id`
      );
      const conceptId = insertResult.rows[0].id as string;

      const auditResult = await client.query(
        `SELECT actor_id, actor_type, change_set
         FROM ontology_audit_log
         WHERE table_name = 'ontology_concepts' AND record_id = $1 AND action = 'INSERT'
         ORDER BY created_at DESC LIMIT 1`,
        [conceptId]
      );

      await client.query("COMMIT");

      expect(auditResult.rows).toHaveLength(1);
      const row = auditResult.rows[0] as { actor_id: string; actor_type: string; change_set: string };
      expect(row.actor_id).toBe("user-abc-123");
      expect(row.actor_type).toBe("human");
      expect(row.change_set).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    } finally {
      client.release();
    }
  });

  it("falls back to pg_trigger_fallback when no session vars are set", async () => {
    const conceptId = await seedConcept(db.pool, "no-session-vars", "No Session Vars");

    const result = await db.query<{
      actor_id: string;
      actor_type: string;
    }>(
      `SELECT actor_id, actor_type
       FROM ontology_audit_log
       WHERE table_name = 'ontology_concepts' AND record_id = $1 AND action = 'INSERT'
       ORDER BY created_at DESC LIMIT 1`,
      [conceptId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.actor_id).toBe("pg_trigger_fallback");
    expect(row.actor_type).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// Domain Audit Trigger
// ---------------------------------------------------------------------------

describe("Domain Audit Trigger", () => {
  beforeAll(async () => {
    await seedRole(db.pool, "domain-audit-role", "Domain Audit Role", 100);
  });

  it("Guest INSERT fires trigger and logs to domain_audit_log", async () => {
    const guestId = await seedGuest(db.pool, "Audit Guest");

    const result = await db.query<{
      action: string;
      record_id: string;
    }>(
      `SELECT action, record_id
       FROM domain_audit_log
       WHERE table_name = 'guests' AND record_id = $1 AND action = 'INSERT'
       ORDER BY created_at DESC LIMIT 1`,
      [guestId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].action).toBe("INSERT");
    expect(result.rows[0].record_id).toBe(guestId);
  });

  it("Guest UPDATE fires trigger with old and new data", async () => {
    const guestId = await seedGuest(db.pool, "Update Guest", { status: "draft" });

    await db.query(
      `UPDATE guests SET status = $1 WHERE id = $2`,
      ["confirmed", guestId]
    );

    const result = await db.query<{
      action: string;
      old_data: Record<string, unknown>;
      new_data: Record<string, unknown>;
    }>(
      `SELECT action, old_data, new_data
       FROM domain_audit_log
       WHERE table_name = 'guests' AND record_id = $1 AND action = 'UPDATE'
       ORDER BY created_at DESC LIMIT 1`,
      [guestId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.action).toBe("UPDATE");
    expect(row.old_data).not.toBeNull();
    expect(row.new_data).not.toBeNull();
    expect((row.old_data as Record<string, unknown>).status).toBe("draft");
    expect((row.new_data as Record<string, unknown>).status).toBe("confirmed");
  });

  it("Guest soft-delete (archived=true) is captured in audit log", async () => {
    const guestId = await seedGuest(db.pool, "Archive Guest");

    await db.query(
      `UPDATE guests SET archived = true WHERE id = $1`,
      [guestId]
    );

    const result = await db.query<{
      action: string;
      old_data: Record<string, unknown>;
      new_data: Record<string, unknown>;
    }>(
      `SELECT action, old_data, new_data
       FROM domain_audit_log
       WHERE table_name = 'guests' AND record_id = $1 AND action = 'UPDATE'
       ORDER BY created_at DESC LIMIT 1`,
      [guestId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.action).toBe("UPDATE");
    expect((row.old_data as Record<string, unknown>).archived).toBe(false);
    expect((row.new_data as Record<string, unknown>).archived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Append-Only Rules
// ---------------------------------------------------------------------------

describe("Append-Only Audit Log Rules", () => {
  it("UPDATE on ontology_audit_log is silently blocked", async () => {
    await seedConcept(db.pool, "append-only-update", "Append Only Update");

    await db.query(`UPDATE ontology_audit_log SET actor_id = 'changed'`);

    const after = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ontology_audit_log WHERE actor_id = 'changed'`
    );

    expect(after.rows[0].count).toBe("0");
  });

  it("DELETE on ontology_audit_log is silently blocked", async () => {
    await seedConcept(db.pool, "append-only-delete", "Append Only Delete");

    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ontology_audit_log`
    );
    const countBefore = parseInt(before.rows[0].count, 10);
    expect(countBefore).toBeGreaterThan(0);

    await db.query(`DELETE FROM ontology_audit_log`);

    const after = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ontology_audit_log`
    );
    const countAfter = parseInt(after.rows[0].count, 10);

    expect(countAfter).toBe(countBefore);
  });

  it("UPDATE on domain_audit_log is silently blocked", async () => {
    await seedGuest(db.pool, "Domain Append Only Update");

    await db.query(`UPDATE domain_audit_log SET actor_id = 'changed'`);

    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM domain_audit_log WHERE actor_id = 'changed'`
    );

    expect(result.rows[0].count).toBe("0");
  });

  it("DELETE on domain_audit_log is silently blocked", async () => {
    await seedGuest(db.pool, "Domain Append Only Delete");

    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM domain_audit_log`
    );
    const countBefore = parseInt(before.rows[0].count, 10);
    expect(countBefore).toBeGreaterThan(0);

    await db.query(`DELETE FROM domain_audit_log`);

    const after = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM domain_audit_log`
    );
    const countAfter = parseInt(after.rows[0].count, 10);

    expect(countAfter).toBe(countBefore);
  });
});
