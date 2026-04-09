/**
 * Tests for Scheduled Audit Jobs
 *
 * Covers:
 * - rogueDetectionJob calls detectRogueAccess
 * - cleanupExpiredTokensJob calls clearExpiredConfirmations
 * - rogueDetectionJob logs results
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

const mockDetectRogueAccess = vi.fn();
vi.mock("./rogue-detection", () => ({
  detectRogueAccess: (...args: unknown[]) => mockDetectRogueAccess(...args),
}));

const mockClearExpiredConfirmations = vi.fn();
vi.mock("../api/bulk-limit", () => ({
  clearExpiredConfirmations: (...args: unknown[]) => mockClearExpiredConfirmations(...args),
}));

// --- Import module under test (triggers onSchedule captures) ---

import * as logger from "firebase-functions/logger";

// Static import triggers onSchedule mock captures at module load time
import { rogueDetectionJob, cleanupExpiredTokensJob } from "./scheduled";

// The handlers are the functions themselves (onSchedule mock returns the handler)
const rogueHandler = rogueDetectionJob as unknown as () => Promise<void>;
const cleanupHandler = cleanupExpiredTokensJob as unknown as () => Promise<void>;

// ============================================================
// Tests
// ============================================================

describe("rogueDetectionJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls detectRogueAccess with lookback minutes", async () => {
    mockDetectRogueAccess.mockResolvedValue({
      unclaimedTriggerRows: [],
      unmatchedClaims: [],
      alertsCreated: 0,
    });

    await rogueHandler();

    expect(mockDetectRogueAccess).toHaveBeenCalledWith(10);
  });

  it("logs results on success", async () => {
    mockDetectRogueAccess.mockResolvedValue({
      unclaimedTriggerRows: [{ id: "r1" }, { id: "r2" }],
      unmatchedClaims: [{ id: "c1" }],
      alertsCreated: 1,
    });

    await rogueHandler();

    expect(logger.info).toHaveBeenCalledWith(
      "Rogue detection scan complete",
      expect.objectContaining({
        unclaimedTriggerRows: 2,
        unmatchedClaims: 1,
        alertsCreated: 1,
      })
    );
  });

  it("logs error when detectRogueAccess fails", async () => {
    mockDetectRogueAccess.mockRejectedValue(new Error("DB timeout"));

    await rogueHandler();

    expect(logger.error).toHaveBeenCalledWith(
      "Rogue detection scan failed",
      expect.objectContaining({ error: "DB timeout" })
    );
  });
});

describe("cleanupExpiredTokensJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls clearExpiredConfirmations", async () => {
    await cleanupHandler();

    expect(mockClearExpiredConfirmations).toHaveBeenCalledTimes(1);
  });

  it("logs completion message", async () => {
    await cleanupHandler();

    expect(logger.info).toHaveBeenCalledWith("Expired confirmation tokens cleaned up");
  });
});
