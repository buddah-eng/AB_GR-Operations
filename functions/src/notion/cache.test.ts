import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryCache, TTL_ONTOLOGY_MS, TTL_DOMAIN_MS } from "./cache";

// Suppress firebase-functions/logger in tests
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  // --- Constants ---

  it("defines correct TTL constants", () => {
    expect(TTL_ONTOLOGY_MS).toBe(5 * 60 * 1000);
    expect(TTL_DOMAIN_MS).toBe(1 * 60 * 1000);
  });

  // --- Basic get/set ---

  it("returns undefined for keys that have never been cached", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("returns cached data after set", () => {
    cache.set("key1", { name: "Alice" }, TTL_ONTOLOGY_MS);
    expect(cache.get("key1")).toEqual({ name: "Alice" });
  });

  it("tracks size correctly", () => {
    expect(cache.size()).toBe(0);
    cache.set("a", 1, 1000);
    expect(cache.size()).toBe(1);
    cache.set("b", 2, 1000);
    expect(cache.size()).toBe(2);
  });

  it("overwrites existing entries on re-set", () => {
    cache.set("key", "v1", 1000);
    cache.set("key", "v2", 1000);
    expect(cache.get("key")).toBe("v2");
    expect(cache.size()).toBe(1);
  });

  // --- getEntry metadata ---

  it("returns full entry with metadata via getEntry", () => {
    const before = Date.now();
    cache.set("meta", { x: 1 }, 5000);
    const entry = cache.getEntry<{ x: number }>("meta");

    expect(entry).toBeDefined();
    expect(entry!.data).toEqual({ x: 1 });
    expect(entry!.ttlMs).toBe(5000);
    expect(entry!.loadedAt).toBeGreaterThanOrEqual(before);
    expect(entry!.loadedAt).toBeLessThanOrEqual(Date.now());
  });

  it("returns undefined getEntry for missing key", () => {
    expect(cache.getEntry("nope")).toBeUndefined();
  });

  // --- Staleness ---

  it("reports fresh entries as not stale", () => {
    cache.set("fresh", "data", 60_000);
    expect(cache.isStale("fresh")).toBe(false);
  });

  it("reports expired entries as stale", () => {
    // Manually set an entry with a loadedAt in the past
    cache.set("old", "data", 100);

    // Fast-forward: override the entry's loadedAt
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    expect(cache.isStale("old")).toBe(true);
    vi.useRealTimers();
  });

  it("reports missing keys as stale", () => {
    expect(cache.isStale("missing")).toBe(true);
  });

  // --- Invalidation ---

  it("invalidate removes a single key", () => {
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.invalidate("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size()).toBe(1);
  });

  it("clear removes all entries", () => {
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.set("c", 3, 1000);
    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  // --- getOrLoad ---

  it("calls loader on cache miss and returns result", async () => {
    const loader = vi.fn().mockResolvedValue({ loaded: true });
    const result = await cache.getOrLoad("new", loader, 5000);

    expect(result).toEqual({ loaded: true });
    expect(loader).toHaveBeenCalledOnce();
    // Now cached
    expect(cache.get("new")).toEqual({ loaded: true });
  });

  it("returns cached data without calling loader on cache hit", async () => {
    cache.set("existing", "cached-value", 60_000);
    const loader = vi.fn().mockResolvedValue("fresh-value");

    const result = await cache.getOrLoad("existing", loader, 60_000);

    expect(result).toBe("cached-value");
    expect(loader).not.toHaveBeenCalled();
  });

  it("serves stale data and triggers background refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Set an entry with a very short TTL
    cache.set("stale-key", "stale-data", 10);

    // Advance past TTL
    vi.advanceTimersByTime(50);

    const loader = vi.fn().mockResolvedValue("fresh-data");
    const result = await cache.getOrLoad("stale-key", loader, 10_000);

    // Should serve stale data immediately
    expect(result).toBe("stale-data");

    // Loader should have been called for background refresh
    expect(loader).toHaveBeenCalledOnce();

    // Wait for the background refresh to complete
    await vi.advanceTimersByTimeAsync(10);

    // After refresh, cache should have the new data
    expect(cache.get("stale-key")).toBe("fresh-data");

    vi.useRealTimers();
  });

  it("does not trigger multiple concurrent refreshes for same key", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    cache.set("dedup", "old", 10);
    vi.advanceTimersByTime(50);

    let resolveLoader: (v: string) => void;
    const loaderPromise = new Promise<string>((r) => {
      resolveLoader = r;
    });
    const loader = vi.fn().mockReturnValue(loaderPromise);

    // First call triggers refresh
    await cache.getOrLoad("dedup", loader, 10_000);
    expect(cache.isRefreshing("dedup")).toBe(true);

    // Second call while refresh is in flight — should NOT call loader again
    await cache.getOrLoad("dedup", loader, 10_000);
    expect(loader).toHaveBeenCalledTimes(1);

    // Resolve the pending refresh
    resolveLoader!("new-value");
    await vi.advanceTimersByTimeAsync(10);

    expect(cache.get("dedup")).toBe("new-value");
    expect(cache.isRefreshing("dedup")).toBe(false);

    vi.useRealTimers();
  });

  it("handles loader failure gracefully during background refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    cache.set("fail-key", "original", 10);
    vi.advanceTimersByTime(50);

    const loader = vi.fn().mockRejectedValue(new Error("Notion API down"));

    const result = await cache.getOrLoad("fail-key", loader, 10_000);
    expect(result).toBe("original"); // Stale data still served

    await vi.advanceTimersByTimeAsync(10);

    // Cache should still have the original stale data (not wiped on error)
    expect(cache.get("fail-key")).toBe("original");
    expect(cache.isRefreshing("fail-key")).toBe(false);

    vi.useRealTimers();
  });

  // --- Type safety ---

  it("preserves complex object types", () => {
    interface TestData {
      readonly items: ReadonlyArray<{ id: number; name: string }>;
      readonly total: number;
    }

    const data: TestData = {
      items: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
      total: 2,
    };

    cache.set("typed", data, 5000);
    const retrieved = cache.get<TestData>("typed");

    expect(retrieved).toEqual(data);
    expect(retrieved!.items).toHaveLength(2);
    expect(retrieved!.total).toBe(2);
  });
});
