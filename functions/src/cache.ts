/**
 * In-Memory Cache with Stale-While-Revalidate
 *
 * Generic caching layer for platform data.
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

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry.data as T;
  }

  getEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry as CacheEntry<T>;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, loadedAt: Date.now(), ttlMs });
  }

  isStale(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    return Date.now() - entry.loadedAt > entry.ttlMs;
  }

  isRefreshing(key: string): boolean {
    return this.pendingRefreshes.has(key);
  }

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number
  ): Promise<T> {
    const existing = this.getEntry<T>(key);

    if (!existing) {
      const data = await loader();
      this.set(key, data, ttlMs);
      return data;
    }

    if (this.isStale(key) && !this.isRefreshing(key)) {
      this.refreshInBackground(key, loader, ttlMs);
    }

    return existing.data;
  }

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

  invalidate(key: string): void {
    this.store.delete(key);
    this.pendingRefreshes.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.pendingRefreshes.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// --- Singleton instance ---

export const cache = new MemoryCache();
