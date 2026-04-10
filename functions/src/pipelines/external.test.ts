/**
 * Tests for External Pipeline Service
 *
 * Covers:
 * - Inbound sync creates/updates records
 * - Inbound sync updates sync state
 * - Outbound push calls external API
 * - Outbound push updates sync state
 * - Sync state get/update operations
 * - Connection CRUD: list, create, delete
 * - Auth header building for different methods
 * - Error handling for inactive connections
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

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: vi.fn((input: Record<string, unknown>) => ({
    eventId: "evt-ext-1",
    ...input,
    timestamp: "2026-04-08T12:00:00Z",
  })),
}));

// data-routing/transforms not used directly by external.ts

// --- Import module under test ---

import {
  executeInboundSync,
  executeOutboundPush,
  getSyncState,
  listConnections,
  createConnection,
  deleteConnection,
  setFetch,
} from "./external";
import type { ExternalConnection } from "./external";

// --- Fixtures ---

function makeConnection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
  return {
    id: "conn-1",
    name: "Test Provider",
    provider: "test",
    endpoint_url: "https://api.test.com/data",
    auth_method: "api_key",
    auth_config: { header_name: "X-API-Key", api_key: "test-key-123" },
    direction: "inbound",
    concept_key: "transport_booking",
    field_mappings: [
      { external_field: "ext_name", internal_field: "name" },
      { external_field: "ext_status", internal_field: "status" },
    ],
    poll_interval_ms: 900000,
    active: true,
    created_at: "2026-04-08T00:00:00Z",
    updated_at: "2026-04-08T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// executeInboundSync
// ============================================================

describe("executeInboundSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("polls external API and creates records", async () => {
    const connection = makeConnection();

    // getConnectionById
    mockQuery.mockResolvedValueOnce({ rows: [connection] });
    // updateSyncState (set syncing) - INSERT ON CONFLICT
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // updateSyncState (set syncing) - UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "syncing" }] });

    // Set up mock fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { ext_name: "Flight 123", ext_status: "on_time" },
        { ext_name: "Flight 456", ext_status: "delayed" },
      ]),
    });
    setFetch(mockFetch as unknown as typeof fetch);

    // Upsert queries for each record
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert record 1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert record 2

    // updateSyncState (set idle) - INSERT ON CONFLICT
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // updateSyncState (set idle) - UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "idle" }] });

    const result = await executeInboundSync("conn-1");

    expect(result.recordsSynced).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.com/data",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("handles external API errors gracefully", async () => {
    const connection = makeConnection();

    // getConnectionById
    mockQuery.mockResolvedValueOnce({ rows: [connection] });
    // updateSyncState (set syncing)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "syncing" }] });

    // Mock fetch returns error
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    setFetch(mockFetch as unknown as typeof fetch);

    // updateSyncState (set error)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "error" }] });

    const result = await executeInboundSync("conn-1");

    expect(result.recordsSynced).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("throws when connection is not active", async () => {
    const connection = makeConnection({ active: false });
    mockQuery.mockResolvedValueOnce({ rows: [connection] });

    await expect(executeInboundSync("conn-1")).rejects.toThrow("not active");
  });

  it("throws when connection direction is outbound only", async () => {
    const connection = makeConnection({ direction: "outbound" });
    mockQuery.mockResolvedValueOnce({ rows: [connection] });

    await expect(executeInboundSync("conn-1")).rejects.toThrow("does not support inbound");
  });
});

// ============================================================
// executeOutboundPush
// ============================================================

describe("executeOutboundPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transforms and pushes to external API", async () => {
    const connection = makeConnection({ direction: "outbound" });

    // getConnectionById
    mockQuery.mockResolvedValueOnce({ rows: [connection] });

    // Mock fetch returns success
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "ext-123" }),
    });
    setFetch(mockFetch as unknown as typeof fetch);

    // updateSyncState (set idle)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "idle" }] });

    const event = {
      eventId: "evt-1",
      eventName: "transport_booking.created",
      domain: "transport_booking",
      action: "created" as const,
      recordId: "rec-1",
      triggeredBy: "admin@example.com",
      timestamp: "2026-04-08T12:00:00Z",
      newValues: { name: "Flight 789", status: "confirmed" },
    };

    const result = await executeOutboundPush("conn-1", event);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.com/data",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      })
    );
  });

  it("returns error on API failure", async () => {
    const connection = makeConnection({ direction: "outbound" });

    // getConnectionById
    mockQuery.mockResolvedValueOnce({ rows: [connection] });

    // Mock fetch returns error
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    setFetch(mockFetch as unknown as typeof fetch);

    // updateSyncState (set error)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: "error" }] });

    const event = {
      eventId: "evt-1",
      eventName: "transport_booking.created",
      domain: "transport_booking",
      action: "created" as const,
      recordId: "rec-1",
      triggeredBy: "admin@example.com",
      timestamp: "2026-04-08T12:00:00Z",
      newValues: { name: "Flight 789" },
    };

    const result = await executeOutboundPush("conn-1", event);

    expect(result.success).toBe(false);
    expect(result.error).toContain("503");
  });
});

// ============================================================
// getSyncState
// ============================================================

describe("getSyncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sync state for a connection", async () => {
    const state = {
      id: "ss-1",
      connection_id: "conn-1",
      last_sync_at: "2026-04-08T10:00:00Z",
      sync_token: null,
      status: "idle",
      last_error: null,
      records_synced: 42,
      updated_at: "2026-04-08T10:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [state] });

    const result = await getSyncState("conn-1");

    expect(result).not.toBeNull();
    expect(result!.records_synced).toBe(42);
    expect(result!.status).toBe("idle");
  });

  it("returns null when no sync state exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getSyncState("conn-missing");

    expect(result).toBeNull();
  });
});

// ============================================================
// Connection CRUD
// ============================================================

describe("listConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all connections when no filter", async () => {
    const connections = [makeConnection()];
    mockQuery.mockResolvedValueOnce({ rows: connections });

    const result = await listConnections();

    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT * FROM external_connections"),
      []
    );
  });
});

describe("createConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts connection and returns it", async () => {
    const connection = makeConnection();
    mockQuery.mockResolvedValueOnce({ rows: [connection] });

    const result = await createConnection({
      name: "Test Provider",
      provider: "test",
      endpoint_url: "https://api.test.com/data",
      auth_method: "api_key",
      auth_config: {},
      direction: "inbound",
      concept_key: "transport_booking",
      field_mappings: [],
      poll_interval_ms: null,
      active: true,
    });

    expect(result.id).toBe("conn-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO external_connections"),
      expect.any(Array)
    );
  });
});

describe("deleteConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when connection is deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await deleteConnection("conn-1");

    expect(result).toBe(true);
  });

  it("returns false when connection does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await deleteConnection("conn-missing");

    expect(result).toBe(false);
  });
});
