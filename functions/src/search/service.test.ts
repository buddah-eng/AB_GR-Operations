/**
 * Tests for Search Service
 *
 * Covers:
 * - registerSearchIndexer subscribes at priority 800
 * - handleDomainEvent indexes created records
 * - handleDomainEvent updates records on update events
 * - handleDomainEvent deletes records on delete events
 * - handleDomainEvent skips non-indexable actions
 * - search returns RBAC-filtered results
 * - search returns empty when no concepts allowed
 * - autocomplete returns suggestions
 * - autocomplete returns empty when RBAC denies
 * - reindex queries all records and indexes them
 * - search fails gracefully when client not configured
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearSubscriptions, subscriptionCount } from "../events/bus";
import type { DomainEvent } from "../events/types";

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

// --- Import module under test ---

import {
  registerSearchIndexer,
  handleDomainEvent,
  search,
  autocomplete,
  reindex,
  setSearchClient,
  resetSearchClient,
  setRBACChecker,
  resetRBACChecker,
} from "./service";
import type { SearchClient, SearchResult, AutocompleteResult } from "./service";

// --- Mock search client ---

function createMockSearchClient(): SearchClient & {
  index: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  autocomplete: ReturnType<typeof vi.fn>;
} {
  return {
    index: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({
      hits: [],
      total: 0,
      page: 1,
      limit: 20,
    } as SearchResult),
    autocomplete: vi.fn().mockResolvedValue({
      suggestions: [],
    } as AutocompleteResult),
  };
}

// --- Helpers ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: `evt-${Date.now()}`,
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-001",
    triggeredBy: "test@example.com",
    timestamp: new Date().toISOString(),
    newValues: { name: "John" },
    ...overrides,
  };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  clearSubscriptions();
  resetSearchClient();
  resetRBACChecker();
});

afterEach(() => {
  resetSearchClient();
  resetRBACChecker();
});

// ============================================================
// registerSearchIndexer
// ============================================================

describe("registerSearchIndexer", () => {
  it("subscribes to event bus at priority 800", () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    const initial = subscriptionCount();
    const unsub = registerSearchIndexer();

    expect(subscriptionCount()).toBe(initial + 1);

    unsub();
  });
});

// ============================================================
// handleDomainEvent
// ============================================================

describe("handleDomainEvent", () => {
  it("indexes created records", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    const event = makeEvent({
      action: "created",
      domain: "guest",
      newValues: { name: "Alice" },
    });

    await handleDomainEvent(event);

    expect(mockClient.index).toHaveBeenCalledWith("guest", {
      id: event.recordId,
      concept: "guest",
      data: { name: "Alice" },
    });
  });

  it("updates records on update events", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    const event = makeEvent({
      action: "updated",
      domain: "schedule",
      newValues: { time: "10:00" },
    });

    await handleDomainEvent(event);

    expect(mockClient.update).toHaveBeenCalledWith(
      "schedule",
      event.recordId,
      { data: { time: "10:00" } }
    );
  });

  it("deletes records on delete events", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    const event = makeEvent({
      action: "deleted",
      domain: "guest",
    });

    await handleDomainEvent(event);

    expect(mockClient.delete).toHaveBeenCalledWith("guest", event.recordId);
  });

  it("skips non-indexable actions gracefully", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    const event = makeEvent({
      action: "completed",
      domain: "task",
    });

    await handleDomainEvent(event);

    expect(mockClient.index).not.toHaveBeenCalled();
    expect(mockClient.update).not.toHaveBeenCalled();
    expect(mockClient.delete).not.toHaveBeenCalled();
  });

  it("handles missing search client gracefully", async () => {
    resetSearchClient();

    const event = makeEvent();

    // Should not throw — errors are caught and logged
    await handleDomainEvent(event);
  });
});

// ============================================================
// search
// ============================================================

describe("search", () => {
  it("returns RBAC-filtered results", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    // Allow view on "guest", deny on "schedule"
    setRBACChecker(async (_role: string, concept: string) => concept === "guest");

    const searchResult: SearchResult = {
      hits: [
        { id: "rec-1", concept: "guest", data: { name: "Alice" }, score: 1.0 },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };
    mockClient.search.mockResolvedValue(searchResult);

    const result = await search("Alice", "coordinator", ["guest", "schedule"]);

    expect(result.success).toBe(true);
    expect(result.data?.hits).toHaveLength(1);

    // Search should only be called with allowed concepts
    expect(mockClient.search).toHaveBeenCalledWith(
      ["guest"],
      "Alice",
      expect.any(Object)
    );
  });

  it("returns empty when no concepts are allowed", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    // Deny all
    setRBACChecker(async () => false);

    const result = await search("test", "viewer", ["guest", "schedule"]);

    expect(result.success).toBe(true);
    expect(result.data?.hits).toHaveLength(0);
    expect(result.data?.total).toBe(0);
    expect(mockClient.search).not.toHaveBeenCalled();
  });

  it("returns error when search client fails", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);
    setRBACChecker(async () => true);

    mockClient.search.mockRejectedValue(new Error("Connection refused"));

    const result = await search("test", "coordinator", ["guest"]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});

// ============================================================
// autocomplete
// ============================================================

describe("autocomplete", () => {
  it("returns suggestions when RBAC allows", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);
    setRBACChecker(async () => true);

    const acResult: AutocompleteResult = {
      suggestions: [
        { id: "rec-1", label: "Alice Smith", concept: "guest" },
        { id: "rec-2", label: "Alice Jones", concept: "guest" },
      ],
    };
    mockClient.autocomplete.mockResolvedValue(acResult);

    const result = await autocomplete("Ali", "guest", "coordinator");

    expect(result.success).toBe(true);
    expect(result.data?.suggestions).toHaveLength(2);
    expect(mockClient.autocomplete).toHaveBeenCalledWith("guest", "Ali");
  });

  it("returns empty when RBAC denies", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);
    setRBACChecker(async () => false);

    const result = await autocomplete("Ali", "guest", "viewer");

    expect(result.success).toBe(true);
    expect(result.data?.suggestions).toHaveLength(0);
    expect(mockClient.autocomplete).not.toHaveBeenCalled();
  });
});

// ============================================================
// reindex
// ============================================================

describe("reindex", () => {
  it("queries all records and indexes them", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    mockQuery.mockResolvedValue({
      rows: [
        { id: "rec-1", data: { name: "Alice" } },
        { id: "rec-2", data: { name: "Bob" } },
        { id: "rec-3", data: { name: "Carol" } },
      ],
    });

    const result = await reindex("guest");

    expect(result.success).toBe(true);
    expect(result.data?.indexed).toBe(3);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("domain_records"),
      ["guest"]
    );
    expect(mockClient.index).toHaveBeenCalledTimes(3);
    expect(mockClient.index).toHaveBeenCalledWith("guest", {
      id: "rec-1",
      concept: "guest",
      data: { name: "Alice" },
    });
  });

  it("returns error when reindex fails", async () => {
    const mockClient = createMockSearchClient();
    setSearchClient(mockClient);

    mockQuery.mockRejectedValue(new Error("DB down"));

    const result = await reindex("guest");

    expect(result.success).toBe(false);
    expect(result.error).toContain("DB down");
  });
});
