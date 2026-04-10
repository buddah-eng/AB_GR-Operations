/**
 * Tests for Google Calendar Sync Service
 *
 * Covers:
 * - syncToGoogleCalendar: success, error handling, missing department
 * - syncFromGoogleCalendar: success, error handling
 * - getSyncState: found, not found
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
  syncToGoogleCalendar,
  syncFromGoogleCalendar,
  getSyncState,
} from "./calendar-sync";

// --- Fixtures ---

function syncStateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sync-1",
    department: "gr",
    calendar_id: "calendar-gr",
    last_sync_at: new Date("2026-04-07T12:00:00Z"),
    sync_token: "token-abc",
    status: "idle",
    last_error: null,
    records_synced: 10,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-04-07T12:00:00Z"),
    ...overrides,
  };
}

// --- Tests ---

describe("getSyncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sync state when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [syncStateRow()] });

    const result = await getSyncState("gr");

    expect(result).not.toBeNull();
    expect(result?.department).toBe("gr");
    expect(result?.status).toBe("idle");
    expect(result?.records_synced).toBe(10);
  });

  it("returns null when no sync state exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getSyncState("unknown-dept");

    expect(result).toBeNull();
  });
});

describe("syncToGoogleCalendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("pushes schedule events and updates sync state", async () => {
    // upsert sync state (syncing)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT ON CONFLICT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE status=syncing

    // Fetch schedule events
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "evt-1", name: "Keynote", start_time: new Date(), end_time: new Date(), venue_id: "v-1" },
        { id: "evt-2", name: "Panel", start_time: new Date(), end_time: new Date(), venue_id: "v-2" },
      ],
    });

    // upsert sync state (completed)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT ON CONFLICT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE status=idle

    const result = await syncToGoogleCalendar("gr");

    expect(result.department).toBe("gr");
    expect(result.direction).toBe("push");
    expect(result.recordsSynced).toBe(2);
    expect(result.status).toBe("completed");

    // Verify domain event was emitted
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "calendar.sync_push",
        domain: "calendar_sync",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("throws when departmentKey is empty", async () => {
    await expect(syncToGoogleCalendar("")).rejects.toThrow(
      "departmentKey is required"
    );
  });

  it("returns error status on failure", async () => {
    // upsert sync state (syncing)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Fetch events fails
    mockQuery.mockRejectedValueOnce(new Error("DB connection lost"));

    // upsert sync state (error)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await syncToGoogleCalendar("gr");

    expect(result.status).toBe("error");
    expect(result.error).toContain("DB connection lost");
    expect(result.recordsSynced).toBe(0);
  });
});

describe("syncFromGoogleCalendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("initiates pull sync and emits event", async () => {
    // upsert sync state (syncing)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Get existing sync state for token
    mockQuery.mockResolvedValueOnce({ rows: [syncStateRow()] });

    // upsert sync state (completed)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await syncFromGoogleCalendar("gr");

    expect(result.department).toBe("gr");
    expect(result.direction).toBe("pull");
    expect(result.status).toBe("completed");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "calendar.sync_pull",
      })
    );
  });

  it("throws when departmentKey is empty", async () => {
    await expect(syncFromGoogleCalendar("")).rejects.toThrow(
      "departmentKey is required"
    );
  });

  it("returns error status on failure", async () => {
    // upsert sync state (syncing)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // getSyncState fails
    mockQuery.mockRejectedValueOnce(new Error("Network timeout"));

    // upsert sync state (error)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await syncFromGoogleCalendar("gr");

    expect(result.status).toBe("error");
    expect(result.error).toContain("Network timeout");
  });
});
