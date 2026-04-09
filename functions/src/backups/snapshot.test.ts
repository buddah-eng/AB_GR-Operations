/**
 * Tests for Nightly Snapshot Pipeline & Disaster Recovery
 *
 * Covers (per PRD sections 2 and 5):
 * - createTableSnapshot: JSON export, whitelist validation, empty tables
 * - runNightlyBackup: full pipeline, error resilience, summary
 * - validateSnapshot: JSON validation, type checking
 * - validateDatabaseIntegrity: duplicate detection, FK checks, audit log
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// --- Import modules under test ---

import {
  createTableSnapshot,
  runNightlyBackup,
  validateSnapshot,
  BACKUP_TABLES,
} from "./snapshot";

import { validateDatabaseIntegrity } from "./recovery";

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// createTableSnapshot
// ============================================================

describe("createTableSnapshot", () => {
  it("returns JSON array for valid table", async () => {
    const rows = [
      { id: "1", name: "Guest A" },
      { id: "2", name: "Guest B" },
    ];

    mockQuery.mockResolvedValueOnce({
      rows: [{ json_agg: rows }],
    });

    const result = await createTableSnapshot("guests", "2026-04-08");
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(rows);
    expect(parsed).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("json_agg")
    );
  });

  it("rejects invalid table name with special characters", async () => {
    await expect(
      createTableSnapshot("guests; DROP TABLE users", "2026-04-08")
    ).rejects.toThrow("Invalid table name");

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects table name not in backup whitelist", async () => {
    await expect(
      createTableSnapshot("some_other_table", "2026-04-08")
    ).rejects.toThrow("not in the backup whitelist");

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("handles empty table (returns empty array)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ json_agg: null }],
    });

    const result = await createTableSnapshot("ontology_concepts", "2026-04-08");
    const parsed = JSON.parse(result);

    expect(parsed).toEqual([]);
    expect(parsed).toHaveLength(0);
  });
});

// ============================================================
// runNightlyBackup
// ============================================================

describe("runNightlyBackup", () => {
  it("calls uploader for each table", async () => {
    const mockUploader = vi.fn().mockResolvedValue(undefined);

    // Return data for every query
    mockQuery.mockResolvedValue({
      rows: [{ json_agg: [{ id: "1" }] }],
    });

    const summary = await runNightlyBackup(mockUploader);

    expect(mockUploader).toHaveBeenCalledTimes(BACKUP_TABLES.length);

    for (const tableName of BACKUP_TABLES) {
      expect(mockUploader).toHaveBeenCalledWith(
        tableName,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expect.any(String)
      );
    }

    expect(summary.tablesBackedUp).toBe(BACKUP_TABLES.length);
  });

  it("continues on single-table failure", async () => {
    const mockUploader = vi.fn().mockResolvedValue(undefined);

    // First table fails, rest succeed
    mockQuery
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValue({
        rows: [{ json_agg: [{ id: "1" }] }],
      });

    const summary = await runNightlyBackup(mockUploader);

    // First table failed at query, so uploader called for remaining tables
    expect(summary.tablesBackedUp).toBe(BACKUP_TABLES.length - 1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].table).toBe(BACKUP_TABLES[0]);
    expect(summary.errors[0].message).toContain("Connection refused");
  });

  it("returns correct summary with row counts", async () => {
    const mockUploader = vi.fn().mockResolvedValue(undefined);
    const rowsPerTable = [{ id: "1" }, { id: "2" }, { id: "3" }];

    mockQuery.mockResolvedValue({
      rows: [{ json_agg: rowsPerTable }],
    });

    const summary = await runNightlyBackup(mockUploader);

    expect(summary.tablesBackedUp).toBe(BACKUP_TABLES.length);
    expect(summary.totalRows).toBe(BACKUP_TABLES.length * 3);
    expect(summary.errors).toHaveLength(0);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });

  it("handles uploader failure for a single table", async () => {
    let callCount = 0;
    const mockUploader = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 3) {
        return Promise.reject(new Error("Upload timeout"));
      }
      return Promise.resolve();
    });

    mockQuery.mockResolvedValue({
      rows: [{ json_agg: [{ id: "1" }] }],
    });

    const summary = await runNightlyBackup(mockUploader);

    expect(summary.tablesBackedUp).toBe(BACKUP_TABLES.length - 1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toContain("Upload timeout");
  });
});

// ============================================================
// validateSnapshot
// ============================================================

describe("validateSnapshot", () => {
  it("accepts valid JSON array", () => {
    const data = JSON.stringify([{ id: "1" }, { id: "2" }]);
    const result = validateSnapshot("guests", data);

    expect(result.valid).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it("accepts empty JSON array", () => {
    const result = validateSnapshot("guests", "[]");

    expect(result.valid).toBe(true);
    expect(result.rowCount).toBe(0);
  });

  it("rejects non-array data", () => {
    const data = JSON.stringify({ id: "1", name: "not an array" });
    const result = validateSnapshot("guests", data);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Snapshot data is not an array");
  });

  it("rejects invalid JSON", () => {
    const result = validateSnapshot("guests", "not json at all {{{");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid JSON");
  });
});

// ============================================================
// validateDatabaseIntegrity
// ============================================================

describe("validateDatabaseIntegrity", () => {
  it("detects duplicate active rows", async () => {
    // First ontology table has duplicates
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ key: "guest", count: "2" }],
      })
      // Remaining ontology tables pass
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // FK check passes
      .mockResolvedValueOnce({ rows: [{ orphan_count: "0" }] })
      // Audit log non-empty
      .mockResolvedValueOnce({ rows: [{ count: "42" }] });

    const result = await validateDatabaseIntegrity();

    expect(result.passed).toBe(false);

    const conceptsCheck = result.checks.find(
      (c) => c.name === "ontology_concepts_unique_active"
    );
    expect(conceptsCheck?.passed).toBe(false);
    expect(conceptsCheck?.detail).toContain("duplicate active rows");
    expect(conceptsCheck?.detail).toContain("guest");
  });

  it("passes for clean data", async () => {
    // All 5 ontology tables have no duplicates
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // FK check passes
      .mockResolvedValueOnce({ rows: [{ orphan_count: "0" }] })
      // Audit log non-empty
      .mockResolvedValueOnce({ rows: [{ count: "10" }] });

    const result = await validateDatabaseIntegrity();

    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.checks).toHaveLength(7); // 5 ontology + FK + audit
  });

  it("detects orphaned FK references", async () => {
    // All ontology checks pass
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // FK check fails: 3 orphaned references
      .mockResolvedValueOnce({ rows: [{ orphan_count: "3" }] })
      // Audit log non-empty
      .mockResolvedValueOnce({ rows: [{ count: "10" }] });

    const result = await validateDatabaseIntegrity();

    expect(result.passed).toBe(false);

    const fkCheck = result.checks.find(
      (c) => c.name === "guests_created_by_fk"
    );
    expect(fkCheck?.passed).toBe(false);
    expect(fkCheck?.detail).toContain("3 guest(s)");
  });

  it("detects empty audit log", async () => {
    // All ontology checks pass
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // FK check passes
      .mockResolvedValueOnce({ rows: [{ orphan_count: "0" }] })
      // Audit log is empty
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const result = await validateDatabaseIntegrity();

    expect(result.passed).toBe(false);

    const auditCheck = result.checks.find(
      (c) => c.name === "audit_log_non_empty"
    );
    expect(auditCheck?.passed).toBe(false);
    expect(auditCheck?.detail).toContain("empty");
  });
});
