/**
 * End-to-End Data Flow Integration Tests
 *
 * Validates cross-cutting flows: versioning roundtrips, encryption,
 * audit change_set linkage, and RBAC-style field filtering.
 * Uses Testcontainers with a real Postgres 16 container.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { seedGuest } from "./helpers/seed";
import { encrypt, decrypt, type EncryptedField } from "../encryption/crypto";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

// ---------------------------------------------------------------------------
// 1. Versioning roundtrip
// ---------------------------------------------------------------------------

describe("Versioning roundtrip", () => {
  it("should support version lifecycle: create v1, add v2, deprecate v1, rollback v2, restore v1", async () => {
    const conceptKey = `ver_roundtrip_${Date.now()}`;

    // Insert v1 (active)
    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name, version, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [conceptKey, "Concept V1", "Concepts V1", 1, "active"]
    );

    // Insert v2 (active), deprecate v1
    await db.query(
      `INSERT INTO ontology_concepts (key, name, plural_name, version, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [conceptKey, "Concept V2", "Concepts V2", 2, "active"]
    );
    await db.query(
      `UPDATE ontology_concepts SET status = 'deprecated'
       WHERE key = $1 AND version = 1`,
      [conceptKey]
    );

    // Verify: only v2 is active
    const afterUpgrade = await db.query<{ version: number; name: string }>(
      `SELECT version, name FROM ontology_concepts
       WHERE key = $1 AND status = 'active'`,
      [conceptKey]
    );

    expect(afterUpgrade.rows).toHaveLength(1);
    expect(afterUpgrade.rows[0].version).toBe(2);
    expect(afterUpgrade.rows[0].name).toBe("Concept V2");

    // Rollback: set v2 to rolled_back, restore v1 to active
    await db.query(
      `UPDATE ontology_concepts SET status = 'rolled_back'
       WHERE key = $1 AND version = 2`,
      [conceptKey]
    );
    await db.query(
      `UPDATE ontology_concepts SET status = 'active'
       WHERE key = $1 AND version = 1`,
      [conceptKey]
    );

    // Verify: only v1 is active
    const afterRollback = await db.query<{ version: number; name: string }>(
      `SELECT version, name FROM ontology_concepts
       WHERE key = $1 AND status = 'active'`,
      [conceptKey]
    );

    expect(afterRollback.rows).toHaveLength(1);
    expect(afterRollback.rows[0].version).toBe(1);
    expect(afterRollback.rows[0].name).toBe("Concept V1");
  });
});

// ---------------------------------------------------------------------------
// 2. Encryption roundtrip
// ---------------------------------------------------------------------------

describe("Encryption roundtrip", () => {
  it("should encrypt, store, retrieve, and decrypt an email via JSONB properties", async () => {
    // Set encryption key for this test (32 bytes = 64 hex chars)
    const testKey = "ab".repeat(32);
    process.env.ENCRYPTION_KEY = testKey;

    const originalEmail = "vip.guest@example.com";

    // Encrypt the email
    const encryptedEmail = encrypt(originalEmail);

    // Verify encrypted output is an EncryptedField object, not plaintext
    expect(encryptedEmail).toHaveProperty("iv");
    expect(encryptedEmail).toHaveProperty("data");
    expect(encryptedEmail).toHaveProperty("tag");
    expect(encryptedEmail).toHaveProperty("keyVersion");
    expect(encryptedEmail.data).not.toBe(originalEmail);

    // Store the encrypted email in guest properties JSONB
    const guestId = await seedGuest(db.pool, "Encryption Test Guest", {
      properties: { email: encryptedEmail },
    });

    // Retrieve from DB
    const result = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM guests WHERE id = $1`,
      [guestId]
    );

    expect(result.rows).toHaveLength(1);

    const storedEmail = result.rows[0].properties.email;

    // The stored value should be an object (EncryptedField), not plaintext
    expect(typeof storedEmail).toBe("object");
    expect(storedEmail).not.toBe(originalEmail);

    // Decrypt the retrieved field
    const decryptedEmail = decrypt(storedEmail as EncryptedField);
    expect(decryptedEmail).toBe(originalEmail);
  });
});

// ---------------------------------------------------------------------------
// 3. Audit change_set links multiple rows
// ---------------------------------------------------------------------------

describe("Audit change_set linkage", () => {
  it("should link concept and property inserts under the same change_set UUID", async () => {
    const changeSetId = "11111111-1111-1111-1111-111111111111";
    const conceptKey = `audit_cs_${Date.now()}`;
    const propertyKey = `prop_cs_${Date.now()}`;

    // Use a client from the pool for transaction with SET LOCAL
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.change_set = '${changeSetId}'`);

      // Insert a concept (triggers ontology audit)
      await client.query(
        `INSERT INTO ontology_concepts (key, name, plural_name)
         VALUES ($1, $2, $3)`,
        [conceptKey, "Audit CS Concept", "Audit CS Concepts"]
      );

      // Insert a property for that concept (triggers ontology audit)
      await client.query(
        `INSERT INTO ontology_properties (concept_key, key, label, type)
         VALUES ($1, $2, $3, $4)`,
        [conceptKey, propertyKey, "Audit CS Property", "text"]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Query audit log for the change_set
    const auditResult = await db.query<{
      table_name: string;
      action: string;
      record_id: string;
    }>(
      `SELECT table_name, action, record_id
       FROM ontology_audit_log
       WHERE change_set = $1
       ORDER BY table_name`,
      [changeSetId]
    );

    expect(auditResult.rows).toHaveLength(2);

    const tableNames = auditResult.rows.map((r) => r.table_name).sort();
    expect(tableNames).toContain("ontology_concepts");
    expect(tableNames).toContain("ontology_properties");

    // Both should be INSERT actions
    for (const row of auditResult.rows) {
      expect(row.action).toBe("INSERT");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. RBAC-style field filtering with real data
// ---------------------------------------------------------------------------

describe("RBAC-style field filtering", () => {
  it("should filter guest properties to only role-permitted fields", async () => {
    // Insert a guest with 5 properties
    const fullProperties = {
      name: "VIP Guest",
      status: "confirmed",
      email: "vip@example.com",
      phone: "+1-555-0199",
      dietary_restrictions: "vegetarian",
    };

    const guestId = await seedGuest(db.pool, "RBAC Filter Guest", {
      properties: fullProperties,
    });

    // Retrieve the full guest record
    const result = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM guests WHERE id = $1`,
      [guestId]
    );

    expect(result.rows).toHaveLength(1);

    const allProperties = result.rows[0].properties;
    expect(Object.keys(allProperties)).toHaveLength(5);

    // Simulate RBAC field filtering in application code
    // A restricted role can only see ['name', 'status']
    const allowedFields: ReadonlyArray<string> = ["name", "status"];
    const filteredProperties: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (field in allProperties) {
        filteredProperties[field] = allProperties[field];
      }
    }

    // Verify filtered result has exactly 2 keys
    expect(Object.keys(filteredProperties)).toHaveLength(2);
    expect(filteredProperties).toHaveProperty("name", "VIP Guest");
    expect(filteredProperties).toHaveProperty("status", "confirmed");

    // Verify sensitive fields were excluded
    expect(filteredProperties).not.toHaveProperty("email");
    expect(filteredProperties).not.toHaveProperty("phone");
    expect(filteredProperties).not.toHaveProperty("dietary_restrictions");
  });
});
