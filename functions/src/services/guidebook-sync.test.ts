/**
 * Tests for Guidebook Integration Service
 *
 * Covers:
 * - publishToGuidebook: schedule, guest_bios, venue_info, full, invalid type
 * - getPublishStatus: with results, empty
 * - Error handling during publish
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

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    return { eventId: "evt-test", eventName: (args[0] as { eventName: string }).eventName };
  },
}));

// --- Import module under test ---

import {
  publishToGuidebook,
  getPublishStatus,
  getLatestPublishByType,
} from "./guidebook-sync";

// --- Fixtures ---

function syncLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    sync_type: "schedule",
    records_pushed: 25,
    status: "completed",
    error: null,
    started_at: new Date("2026-04-08T10:00:00Z"),
    completed_at: new Date("2026-04-08T10:01:00Z"),
    ...overrides,
  };
}

// --- Tests ---

describe("publishToGuidebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("publishes schedule data and returns completed status", async () => {
    // Create sync log entry
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-new" }] });
    // Count schedule events
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "15" }] });
    // Update sync log completed
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await publishToGuidebook("schedule");

    expect(result.syncType).toBe("schedule");
    expect(result.recordsPushed).toBe(15);
    expect(result.status).toBe("completed");
    expect(result.syncLogId).toBe("log-new");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guidebook.publish",
        domain: "guidebook_sync",
      })
    );
  });

  it("publishes guest bios data", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-new" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "30" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await publishToGuidebook("guest_bios");

    expect(result.syncType).toBe("guest_bios");
    expect(result.recordsPushed).toBe(30);
    expect(result.status).toBe("completed");
  });

  it("publishes venue info data", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-new" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "8" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await publishToGuidebook("venue_info");

    expect(result.syncType).toBe("venue_info");
    expect(result.recordsPushed).toBe(8);
    expect(result.status).toBe("completed");
  });

  it("publishes full sync (schedule + guests + venues)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-new" }] });
    // Count schedule events
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "10" }] });
    // Count guests
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "20" }] });
    // Count venues
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "5" }] });
    // Update sync log
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await publishToGuidebook("full");

    expect(result.syncType).toBe("full");
    expect(result.recordsPushed).toBe(35); // 10 + 20 + 5
    expect(result.status).toBe("completed");
  });

  it("throws when syncType is empty", async () => {
    await expect(
      publishToGuidebook("" as never)
    ).rejects.toThrow("syncType is required");
  });

  it("throws when syncType is invalid", async () => {
    await expect(
      publishToGuidebook("invalid_type" as never)
    ).rejects.toThrow("Invalid syncType: invalid_type");
  });

  it("returns failed status on error", async () => {
    // Create sync log entry
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-fail" }] });
    // Count schedule events fails
    mockQuery.mockRejectedValueOnce(new Error("Table not found"));
    // Update sync log to failed
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await publishToGuidebook("schedule");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Table not found");
    expect(result.recordsPushed).toBe(0);
  });
});

describe("getPublishStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent sync log entries", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [syncLogRow(), syncLogRow({ id: "log-2", sync_type: "guest_bios" })],
    });

    const result = await getPublishStatus(10);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("log-1");
    expect(result[0].sync_type).toBe("schedule");
    expect(result[0].records_pushed).toBe(25);
  });

  it("returns empty array when no logs exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getPublishStatus();

    expect(result).toHaveLength(0);
  });

  it("respects limit parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [syncLogRow()] });

    await getPublishStatus(5);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT $1"),
      [5]
    );
  });
});

describe("getLatestPublishByType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns latest sync log for type", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [syncLogRow()] });

    const result = await getLatestPublishByType("schedule");

    expect(result).not.toBeNull();
    expect(result?.sync_type).toBe("schedule");
  });

  it("returns null when no logs exist for type", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getLatestPublishByType("guest_bios");

    expect(result).toBeNull();
  });
});
