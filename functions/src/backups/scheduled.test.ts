/**
 * Tests for Scheduled Backup Jobs
 *
 * Covers:
 * - nightlyBackupJob calls runNightlyBackup
 * - Success logs summary
 * - Partial failure creates admin_alerts
 * - Total failure creates admin_alerts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before import of module under test) ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_config: unknown, handler: () => Promise<void>) => {
    return handler;
  },
}));

const mockRunNightlyBackup = vi.fn();
vi.mock("./snapshot", () => ({
  runNightlyBackup: (...args: unknown[]) => mockRunNightlyBackup(...args),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-admin", () => ({
  storage: () => ({
    bucket: () => ({
      file: () => ({
        save: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));

// --- Import module under test (triggers onSchedule capture) ---

import * as logger from "firebase-functions/logger";

// Static import triggers onSchedule mock capture at module load time
import { nightlyBackupJob } from "./scheduled";

// The handler is the function itself (onSchedule mock returns the handler)
const backupHandler = nightlyBackupJob as unknown as () => Promise<void>;

// ============================================================
// Tests
// ============================================================

describe("nightlyBackupJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runNightlyBackup with uploadToCloudStorage callback", async () => {
    mockRunNightlyBackup.mockResolvedValue({
      tablesBackedUp: 8,
      totalRows: 1200,
      errors: [],
      duration: 5432,
    });

    await backupHandler();

    expect(mockRunNightlyBackup).toHaveBeenCalledTimes(1);
    // The first argument should be the uploadToCloudStorage function
    expect(typeof mockRunNightlyBackup.mock.calls[0][0]).toBe("function");
  });

  it("logs summary on success", async () => {
    mockRunNightlyBackup.mockResolvedValue({
      tablesBackedUp: 8,
      totalRows: 1200,
      errors: [],
      duration: 5432,
    });

    await backupHandler();

    expect(logger.info).toHaveBeenCalledWith(
      "Nightly backup complete",
      expect.objectContaining({
        tablesBackedUp: 8,
        totalRows: 1200,
        errors: [],
        durationMs: 5432,
      })
    );
  });

  it("creates admin_alerts on partial failure", async () => {
    mockRunNightlyBackup.mockResolvedValue({
      tablesBackedUp: 6,
      totalRows: 900,
      errors: [
        { table: "audit_log", error: "Timeout" },
        { table: "admin_alerts", error: "Permission denied" },
      ],
      duration: 8000,
    });
    mockQuery.mockResolvedValue({ rows: [] });

    await backupHandler();

    // Should log error about partial failure
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("2 error(s)"),
      expect.objectContaining({
        failedTables: ["audit_log", "admin_alerts"],
      })
    );

    // Should insert an admin alert
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_alerts"),
      expect.arrayContaining([
        "critical",
        "backup_failure",
        expect.stringContaining("2 error(s)"),
        expect.any(String),
      ])
    );
  });

  it("creates admin_alerts on total failure", async () => {
    mockRunNightlyBackup.mockRejectedValue(new Error("Storage unavailable"));
    mockQuery.mockResolvedValue({ rows: [] });

    await backupHandler();

    // Should log error
    expect(logger.error).toHaveBeenCalledWith(
      "Nightly backup failed",
      expect.objectContaining({ error: "Storage unavailable" })
    );

    // Should insert an admin alert for total failure
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_alerts"),
      expect.arrayContaining([
        "critical",
        "backup_failure",
        "Nightly backup failed",
        expect.stringContaining("Storage unavailable"),
      ])
    );
  });

  it("handles alert insertion failure gracefully", async () => {
    mockRunNightlyBackup.mockRejectedValue(new Error("Storage unavailable"));
    mockQuery.mockRejectedValue(new Error("DB also down"));

    // Should not throw even if alert insertion fails
    await backupHandler();

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to create backup failure alert",
      expect.objectContaining({ error: "DB also down" })
    );
  });
});
