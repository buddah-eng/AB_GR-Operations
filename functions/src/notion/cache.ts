/**
 * In-Memory Cache with Stale-While-Revalidate
 *
 * Provides a generic caching layer for Notion data.
 * Ontology/config data uses a 5-minute TTL; domain data uses 1 minute.
 * Stale entries are served immediately while a background refresh runs.
 */

import * as logger from "firebase-functions/logger";

// --- TTL Constants ---

export const TTL_ONTOLOGY_MS = 5 * 60 * 1000; // 5 minutes
export const TTL_DOMAIN_MS = 1 * 60 * 1000;   // 1 minute

// --- Cache Entry ---

export interface CacheEntry<T> {
  readonly data: T;
  readonly loadedAt: number;
  readonly ttlMs: number;
}

// --- Memory Cache ---

export class MemoryCache {
  private readonly store: Map<string, CacheEntry<unknown>> = new Map();
  private readonly pendingRefreshes: Set<string> = new Set();

  /**
   * Returns cached data if it exists (even if stale).
   * Returns undefined only if the key has never been cached.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Returns the full cache entry including metadata.
   */
  getEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    return entry as CacheEntry<T>;
  }

  /**
   * Stores a value in the cache with a specified TTL.
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    const entry: CacheEntry<T> = {
      data,
      loadedAt: Date.now(),
      ttlMs,
    };
    // Create a new Map to avoid mutating the old reference in concurrent reads
    this.store.set(key, entry);
  }

  /**
   * Returns true if the entry exists but has exceeded its TTL.
   */
  isStale(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return true;
    }
    return Date.now() - entry.loadedAt > entry.ttlMs;
  }

  /**
   * Returns true if a background refresh is already in flight for this key.
   */
  isRefreshing(key: string): boolean {
    return this.pendingRefreshes.has(key);
  }

  /**
   * Stale-while-revalidate: returns cached data immediately and triggers
   * a background refresh if the data is stale. If no cached data exists,
   * awaits the loader directly.
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number
  ): Promise<T> {
    const existing = this.getEntry<T>(key);

    // Cache miss — must load synchronously
    if (!existing) {
      const data = await loader();
      this.set(key, data, ttlMs);
      return data;
    }

    // Cache hit but stale — serve stale data, refresh in background
    if (this.isStale(key) && !this.isRefreshing(key)) {
      this.refreshInBackground(key, loader, ttlMs);
    }

    return existing.data;
  }

  /**
   * Kicks off a background refresh without blocking the caller.
   */
  private refreshInBackground<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number
  ): void {
    this.pendingRefreshes.add(key);

    loader()
      .then((data) => {
        this.set(key, data, ttlMs);
        logger.debug(`Cache refreshed: ${key}`);
      })
      .catch((err) => {
        logger.warn(`Background cache refresh failed for ${key}`, { error: err });
      })
      .finally(() => {
        this.pendingRefreshes.delete(key);
      });
  }

  /**
   * Removes a single key from the cache.
   */
  invalidate(key: string): void {
    this.store.delete(key);
    this.pendingRefreshes.delete(key);
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.store.clear();
    this.pendingRefreshes.clear();
  }

  /**
   * Returns the number of entries currently cached.
   */
  size(): number {
    return this.store.size;
  }
}

// --- Singleton instance ---

export const cache = new MemoryCache();
