/**
 * Phase 2 Integration Tests
 *
 * Verifies Phase 2 modules — Audit System, Versioning, Registry, Encryption —
 * against a real Postgres 16 container via Testcontainers.
 *
 * Requires Docker. 17 tests total.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { seedConcept, seedGuest } from "./helpers/seed";
import { setAuditSessionVars, type AuditContext } from "../audit/context";
import {
  encrypt,
  decrypt,
  computeHmac,
  type EncryptedField,
} from "../encryption/crypto";

let db: TestDatabase;

// 32-byte hex keys for encryption / HMAC (deterministic for tests)
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_HMAC_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

beforeAll(async () => {
  // Configure encryption keys before any crypto operations
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.HMAC_KEY = TEST_HMAC_KEY;

  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.teardown();
  delete process.env.ENCRYPTION_KEY;
  delete process.env.HMAC_KEY;
});

// ============================================================================
// Audit System Integration (6 tests)
// ============================================================================

describe("Audit System Integration", () => {
  // -------------------------------------------------------------------------
  // 1. withAuditContext sets session vars that triggers read
  // -------------------------------------------------------------------------
  it("setAuditSessionVars sets session vars that triggers read", async () => {
    const actorId = "test-user-001";
    const actorType = "human";
    const changeSet = randomUUID();

    const ctx: AuditContext = {
      actorId,
      actorType,
      changeSet,
    };

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await setAuditSessionVars(client, ctx);

      const insertResult = await client.query(
        `INSERT INTO ontology_concepts (key, name, plural_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [`audit-ctx-test-${Date.now()}`, "Audit Context Test", "Audit Context Tests"]
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
      const row = auditResult.rows[0] as {
        actor_id: string;
        actor_type: string;
        change_set: string;
      };
      expect(row.actor_id).toBe(actorId);
      expect(row.actor_type).toBe(actorType);
      expect(row.change_set).toBe(changeSet);
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------------------------------
  // 2. logAuditClaim inserts into api_audit_claims
  // -------------------------------------------------------------------------
  it("api_audit_claims table accepts data", async () => {
    const changeSet = randomUUID();

    await db.query(
      `INSERT INTO api_audit_claims (change_set, actor_id, actor_type, endpoint)
       VALUES ($1, $2, $3, $4)`,
      [changeSet, "test-actor", "human", "/api/test"]
    );

    const result = await db.query<{
      change_set: string;
      actor_id: string;
      actor_type: string;
      endpoint: string;
    }>(
      `SELECT change_set, actor_id, actor_type, endpoint
       FROM api_audit_claims WHERE change_set = $1`,
      [changeSet]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].actor_id).toBe("test-actor");
    expect(result.rows[0].actor_type).toBe("human");
    expect(result.rows[0].endpoint).toBe("/api/test");
  });

  // -------------------------------------------------------------------------
  // 3. Rogue detection: unclaimed trigger row found
  // -------------------------------------------------------------------------
  it("rogue detection finds unclaimed trigger rows", async () => {
    // INSERT without session vars => pg_trigger_fallback actor
    const conceptId = await seedConcept(
      db.pool,
      `rogue-unclaimed-${Date.now()}`,
      "Rogue Unclaimed"
    );

    const result = await db.query<{ id: string }>(
      `SELECT a.id FROM ontology_audit_log a
       LEFT JOIN api_audit_claims c ON a.change_set = c.change_set
       WHERE a.actor_id = 'pg_trigger_fallback'
         AND c.change_set IS NULL
         AND a.record_id = $1`,
      [conceptId]
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 4. Rogue detection: claimed row NOT found
  // -------------------------------------------------------------------------
  it("rogue detection does not flag claimed rows", async () => {
    const changeSet = randomUUID();

    // Pre-claim the change_set in api_audit_claims
    await db.query(
      `INSERT INTO api_audit_claims (change_set, actor_id, actor_type, endpoint)
       VALUES ($1, $2, $3, $4)`,
      [changeSet, "legit-user", "human", "/api/concepts"]
    );

    // INSERT a concept within a transaction with the same change_set
    const client = await db.pool.connect();
    let conceptId: string;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_id = 'legit-user'`);
      await client.query(`SET LOCAL app.actor_type = 'human'`);
      await client.query(`SET LOCAL app.change_set = '${changeSet}'`);

      const insertResult = await client.query(
        `INSERT INTO ontology_concepts (key, name, plural_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [`rogue-claimed-${Date.now()}`, "Claimed Concept", "Claimed Concepts"]
      );
      conceptId = insertResult.rows[0].id as string;
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    // The rogue detection query should NOT find this row
    const result = await db.query<{ id: string }>(
      `SELECT a.id FROM ontology_audit_log a
       LEFT JOIN api_audit_claims c ON a.change_set = c.change_set
       WHERE a.actor_id = 'pg_trigger_fallback'
         AND c.change_set IS NULL
         AND a.record_id = $1`,
      [conceptId]
    );

    expect(result.rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. Admin alerts table accepts data and CHECK constraint works
  // -------------------------------------------------------------------------
  it("admin_alerts accepts valid data and rejects invalid severity", async () => {
    // Valid insert
    const insertResult = await db.query<{ id: string }>(
      `INSERT INTO admin_alerts (severity, category, title, details)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ["critical", "rogue_actor", "Unclaimed DB write detected", JSON.stringify({ count: 3 })]
    );

    expect(insertResult.rows).toHaveLength(1);
    expect(insertResult.rows[0].id).toBeDefined();

    // Invalid severity should fail CHECK constraint
    try {
      await db.query(
        `INSERT INTO admin_alerts (severity, category, title)
         VALUES ($1, $2, $3)`,
        ["panic", "test", "Should fail"]
      );
      expect.fail("INSERT should have thrown a CHECK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23514");
    }
  });

  // -------------------------------------------------------------------------
  // 6. Append-only rules on domain_audit_log
  // -------------------------------------------------------------------------
  it("domain_audit_log is append-only (UPDATE silently blocked)", async () => {
    const guestId = await seedGuest(db.pool, "Append Only Domain Test");

    // Verify the audit row exists
    const before = await db.query<{ id: string; actor_id: string }>(
      `SELECT id, actor_id FROM domain_audit_log
       WHERE table_name = 'guests' AND record_id = $1 AND action = 'INSERT'`,
      [guestId]
    );
    expect(before.rows).toHaveLength(1);

    // Attempt UPDATE — should be silently blocked by INSTEAD NOTHING rule
    await db.query(
      `UPDATE domain_audit_log SET actor_id = 'tampered' WHERE record_id = $1`,
      [guestId]
    );

    const after = await db.query<{ actor_id: string }>(
      `SELECT actor_id FROM domain_audit_log
       WHERE table_name = 'guests' AND record_id = $1 AND action = 'INSERT'`,
      [guestId]
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].actor_id).not.toBe("tampered");
  });
});

// ============================================================================
// Versioning Integration (4 tests)
// ============================================================================

describe("Versioning Integration", () => {
  let v1Id: string;
  let v2Id: string;
  const versionKey = `version-chain-${Date.now()}`;

  // -------------------------------------------------------------------------
  // 7. Version chain in real Postgres
  // -------------------------------------------------------------------------
  it("creates a version chain with active/deprecated statuses", async () => {
    // Insert v1 (active by default)
    const v1Result = await db.query<{ id: string }>(
      `INSERT INTO ontology_concepts (key, name, plural_name, version, status)
       VALUES ($1, $2, $3, 1, 'active') RETURNING id`,
      [versionKey, "Version Chain V1", "Version Chain V1s"]
    );
    v1Id = v1Result.rows[0].id;

    // Insert v2 pointing to v1
    const v2Result = await db.query<{ id: string }>(
      `INSERT INTO ontology_concepts (key, name, plural_name, version, status, previous_version_id)
       VALUES ($1, $2, $3, 2, 'active', $4) RETURNING id`,
      [versionKey, "Version Chain V2", "Version Chain V2s", v1Id]
    );
    v2Id = v2Result.rows[0].id;

    // Deprecate v1
    await db.query(
      `UPDATE ontology_concepts SET status = 'deprecated' WHERE id = $1`,
      [v1Id]
    );

    // Only v2 should be active
    const activeResult = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM ontology_concepts
       WHERE key = $1 AND status = 'active'`,
      [versionKey]
    );
    expect(activeResult.rows).toHaveLength(1);
    expect(activeResult.rows[0].id).toBe(v2Id);
    expect(activeResult.rows[0].version).toBe(2);

    // Walk the chain
    const chainResult = await db.query<{ previous_version_id: string | null }>(
      `SELECT previous_version_id FROM ontology_concepts WHERE id = $1`,
      [v2Id]
    );
    expect(chainResult.rows[0].previous_version_id).toBe(v1Id);
  });

  // -------------------------------------------------------------------------
  // 8. Rollback restores previous version
  // -------------------------------------------------------------------------
  it("rollback marks v2 as rolled_back and reactivates v1", async () => {
    // v2 -> rolled_back
    await db.query(
      `UPDATE ontology_concepts SET status = 'rolled_back' WHERE id = $1`,
      [v2Id]
    );

    // v1 -> active
    await db.query(
      `UPDATE ontology_concepts SET status = 'active' WHERE id = $1`,
      [v1Id]
    );

    const activeResult = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM ontology_concepts
       WHERE key = $1 AND status = 'active'`,
      [versionKey]
    );
    expect(activeResult.rows).toHaveLength(1);
    expect(activeResult.rows[0].id).toBe(v1Id);
    expect(activeResult.rows[0].version).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 9. Recursive version history query
  // -------------------------------------------------------------------------
  it("recursive CTE returns full version history in order", async () => {
    // Restore v2 to deprecated so we have a clear chain
    await db.query(
      `UPDATE ontology_concepts SET status = 'deprecated' WHERE id = $1`,
      [v1Id]
    );
    await db.query(
      `UPDATE ontology_concepts SET status = 'active' WHERE id = $1`,
      [v2Id]
    );

    const result = await db.query<{
      id: string;
      version: number;
      status: string;
    }>(
      `WITH RECURSIVE history AS (
         SELECT * FROM ontology_concepts WHERE id = $1
         UNION ALL
         SELECT c.* FROM ontology_concepts c
         JOIN history h ON h.previous_version_id = c.id
       )
       SELECT id, version, status FROM history ORDER BY version DESC`,
      [v2Id]
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].version).toBe(2);
    expect(result.rows[0].id).toBe(v2Id);
    expect(result.rows[1].version).toBe(1);
    expect(result.rows[1].id).toBe(v1Id);
  });

  // -------------------------------------------------------------------------
  // 10. Concurrent version conflict — UNIQUE violation
  // -------------------------------------------------------------------------
  it("rejects duplicate (key, version) with UNIQUE violation", async () => {
    const conflictKey = `conflict-${Date.now()}`;

    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name, version)
       VALUES ($1, $2, $3, 1)`,
      [conflictKey, "Conflict V1", "Conflict V1s"]
    );

    try {
      await db.query(
        `INSERT INTO ontology_concepts (key, name, plural_name, version)
         VALUES ($1, $2, $3, 1)`,
        [conflictKey, "Conflict V1 Dup", "Conflict V1 Dups"]
      );
      expect.fail("INSERT should have thrown a UNIQUE violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23505");
    }
  });
});

// ============================================================================
// Registry Integration (4 tests)
// ============================================================================

describe("Registry Integration", () => {
  let registryId: string;

  // -------------------------------------------------------------------------
  // 11. guest_registry table accepts data
  // -------------------------------------------------------------------------
  it("guest_registry accepts enriched schema data", async () => {
    const result = await db.query<{
      id: string;
      canonical_name: string;
      email: string;
      company: string;
      type: string;
      department: string;
      dietary: string;
      travel_prefs: Record<string, unknown>;
      notes: Record<string, unknown>;
      first_attended: number;
      last_attended: number;
      attendance_count: number;
    }>(
      `INSERT INTO guest_registry
         (canonical_name, email, company, type, department, dietary, travel_prefs, notes, first_attended, last_attended, attendance_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        "Jane Doe",
        "jane@example.com",
        "Acme Corp",
        "VIP",
        "Entertainment",
        "Vegetarian",
        JSON.stringify({ wheelchair: true }),
        JSON.stringify({ memo: "Prefers morning sessions" }),
        2022,
        2025,
        4,
      ]
    );

    expect(result.rows).toHaveLength(1);
    registryId = result.rows[0].id;
    const row = result.rows[0];
    expect(row.canonical_name).toBe("Jane Doe");
    expect(row.email).toBe("jane@example.com");
    expect(row.company).toBe("Acme Corp");
    expect(row.type).toBe("VIP");
    expect(row.department).toBe("Entertainment");
    expect(row.dietary).toBe("Vegetarian");
    expect(row.travel_prefs).toEqual({ wheelchair: true });
    expect(row.notes).toEqual({ memo: "Prefers morning sessions" });
    expect(row.first_attended).toBe(2022);
    expect(row.last_attended).toBe(2025);
    expect(row.attendance_count).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 12. guests.registry_id FK works
  // -------------------------------------------------------------------------
  it("guests.registry_id FK links to guest_registry and rejects invalid IDs", async () => {
    // Valid FK
    const guestResult = await db.query<{ id: string; registry_id: string }>(
      `INSERT INTO guests (name, registry_id)
       VALUES ($1, $2) RETURNING id, registry_id`,
      ["Linked Guest", registryId]
    );

    expect(guestResult.rows).toHaveLength(1);
    expect(guestResult.rows[0].registry_id).toBe(registryId);

    // Invalid FK should fail
    const fakeRegistryId = randomUUID();
    try {
      await db.query(
        `INSERT INTO guests (name, registry_id) VALUES ($1, $2)`,
        ["Bad FK Guest", fakeRegistryId]
      );
      expect.fail("INSERT should have thrown a FK violation");
    } catch (error: unknown) {
      const pgError = error as { code: string };
      expect(pgError.code).toBe("23503");
    }
  });

  // -------------------------------------------------------------------------
  // 13. Pre-population query works
  // -------------------------------------------------------------------------
  it("pre-population query filters by last_attended", async () => {
    // Insert 3 registry entries with different last_attended years
    await db.query(
      `INSERT INTO guest_registry (canonical_name, first_attended, last_attended)
       VALUES ($1, $2, $3)`,
      ["Old Timer", 2020, 2024]
    );
    await db.query(
      `INSERT INTO guest_registry (canonical_name, first_attended, last_attended)
       VALUES ($1, $2, $3)`,
      ["Recent Guest", 2023, 2025]
    );
    await db.query(
      `INSERT INTO guest_registry (canonical_name, first_attended, last_attended)
       VALUES ($1, $2, $3)`,
      ["Current Guest", 2024, 2026]
    );

    const result = await db.query<{ canonical_name: string }>(
      `SELECT canonical_name FROM guest_registry WHERE last_attended >= $1`,
      [2025]
    );

    // Should include Recent Guest (2025) and Current Guest (2026)
    // Also jane@example.com from test 11 has last_attended=2025
    const names = result.rows.map((r) => r.canonical_name);
    expect(names).toContain("Recent Guest");
    expect(names).toContain("Current Guest");
    expect(names).not.toContain("Old Timer");
  });

  // -------------------------------------------------------------------------
  // 14. email_hmac column exists and is indexable
  // -------------------------------------------------------------------------
  it("email_hmac column supports lookup queries", async () => {
    const hmacValue = "abc123hmacvalue";

    const insertResult = await db.query<{ id: string }>(
      `INSERT INTO guests (name, email_hmac) VALUES ($1, $2) RETURNING id`,
      ["HMAC Lookup Guest", hmacValue]
    );
    const guestId = insertResult.rows[0].id;

    const lookupResult = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM guests WHERE email_hmac = $1`,
      [hmacValue]
    );

    expect(lookupResult.rows).toHaveLength(1);
    expect(lookupResult.rows[0].id).toBe(guestId);
    expect(lookupResult.rows[0].name).toBe("HMAC Lookup Guest");
  });
});

// ============================================================================
// Encryption Integration (3 tests)
// ============================================================================

describe("Encryption Integration", () => {
  const testEmail = "secret@example.com";
  let storedGuestId: string;
  let encryptedField: EncryptedField;

  // -------------------------------------------------------------------------
  // 15. Encrypted field stored as JSONB object
  // -------------------------------------------------------------------------
  it("encrypted field stored in JSONB has iv/data/tag/keyVersion keys", async () => {
    encryptedField = encrypt(testEmail);

    // Verify the shape before storing
    expect(encryptedField).toHaveProperty("iv");
    expect(encryptedField).toHaveProperty("data");
    expect(encryptedField).toHaveProperty("tag");
    expect(encryptedField).toHaveProperty("keyVersion");
    expect(typeof encryptedField.iv).toBe("string");
    expect(typeof encryptedField.data).toBe("string");
    expect(typeof encryptedField.tag).toBe("string");
    expect(typeof encryptedField.keyVersion).toBe("number");

    // Store in guests properties JSONB
    const properties = { email: encryptedField };
    const insertResult = await db.query<{ id: string; properties: Record<string, unknown> }>(
      `INSERT INTO guests (name, properties)
       VALUES ($1, $2) RETURNING id, properties`,
      ["Encrypted Email Guest", JSON.stringify(properties)]
    );

    storedGuestId = insertResult.rows[0].id;

    // Read back and verify structure
    const selectResult = await db.query<{ email_field: unknown }>(
      `SELECT properties->'email' AS email_field FROM guests WHERE id = $1`,
      [storedGuestId]
    );

    const stored = selectResult.rows[0].email_field as Record<string, unknown>;
    expect(stored).toHaveProperty("iv");
    expect(stored).toHaveProperty("data");
    expect(stored).toHaveProperty("tag");
    expect(stored).toHaveProperty("keyVersion");

    // Verify it is NOT plaintext
    expect(stored).not.toBe(testEmail);
    expect(JSON.stringify(stored)).not.toContain(testEmail);
  });

  // -------------------------------------------------------------------------
  // 16. Decrypt recovers original value
  // -------------------------------------------------------------------------
  it("decrypt recovers the original plaintext from stored encrypted field", async () => {
    // Read the encrypted field back from DB
    const selectResult = await db.query<{ email_field: EncryptedField }>(
      `SELECT properties->'email' AS email_field FROM guests WHERE id = $1`,
      [storedGuestId]
    );

    const storedField = selectResult.rows[0].email_field;
    const decrypted = decrypt(storedField);

    expect(decrypted).toBe(testEmail);
  });

  // -------------------------------------------------------------------------
  // 17. HMAC blind index lookup
  // -------------------------------------------------------------------------
  it("HMAC blind index enables deterministic email lookup", async () => {
    const email = "findme@example.com";
    const hmac = computeHmac(email);

    // Store guest with HMAC blind index
    const insertResult = await db.query<{ id: string }>(
      `INSERT INTO guests (name, email_hmac) VALUES ($1, $2) RETURNING id`,
      ["HMAC Search Guest", hmac]
    );
    const guestId = insertResult.rows[0].id;

    // Look up by recomputing the HMAC
    const recomputedHmac = computeHmac(email);
    expect(recomputedHmac).toBe(hmac); // deterministic

    const lookupResult = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM guests WHERE email_hmac = $1`,
      [recomputedHmac]
    );

    expect(lookupResult.rows).toHaveLength(1);
    expect(lookupResult.rows[0].id).toBe(guestId);
    expect(lookupResult.rows[0].name).toBe("HMAC Search Guest");
  });
});
