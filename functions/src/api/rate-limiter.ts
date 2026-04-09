/**
 * Rate Limiting Middleware
 *
 * Sliding-window rate limiter backed by Postgres.
 * Per-API-key limits from api_keys.rate_limit_per_min.
 * Falls back to per-IP for unauthenticated requests (default 60 rpm).
 * Returns 429 with Retry-After header when limit exceeded.
 * Sets X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset on every response.
 */

import type { Request, Response, NextFunction } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

// --- Types ---

export interface RateLimitInfo {
  readonly limit: number;
  readonly remaining: number;
  readonly resetEpochSeconds: number;
}

// --- Constants ---

const DEFAULT_LIMIT = 60;
const WINDOW_MS = 60_000; // 60 seconds

// --- Helpers ---

/**
 * Derives the rate-limit key from the request.
 * API-key-authenticated requests use "apikey:<uid>".
 * All others use "ip:<address>".
 */
export function getRateLimitKey(req: Request): string {
  if (req.user && req.actorType === "api_client") {
    return `apikey:${req.user.uid}`;
  }
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return `ip:${ip}`;
}

/**
 * Resolves the per-key rate limit.
 * For API key clients, reads rate_limit_per_min from api_keys table.
 * For others, returns DEFAULT_LIMIT.
 */
export async function resolveLimit(req: Request): Promise<number> {
  if (req.user && req.actorType === "api_client") {
    try {
      const uid = req.user.uid;
      // uid is "apikey:<id>"
      const keyId = uid.startsWith("apikey:") ? uid.slice(7) : uid;
      const result = await query<{ rate_limit_per_min: number }>(
        "SELECT rate_limit_per_min FROM api_keys WHERE id = $1",
        [keyId]
      );
      if (result.rows.length > 0 && result.rows[0].rate_limit_per_min) {
        return result.rows[0].rate_limit_per_min;
      }
    } catch (err) {
      logger.warn("Failed to resolve rate limit from api_keys, using default", { error: err });
    }
  }
  return DEFAULT_LIMIT;
}

/**
 * Increments the counter for the current window and returns the count.
 * Uses Postgres upsert (INSERT ... ON CONFLICT).
 */
export async function incrementCounter(key: string, windowStart: Date): Promise<number> {
  const result = await query<{ count: number }>(
    `INSERT INTO rate_limit_counters (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1
     RETURNING count`,
    [key, windowStart.toISOString()]
  );
  return result.rows[0].count;
}

/**
 * Gets the current count for the given key and window.
 */
export async function getCount(key: string, windowStart: Date): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT count FROM rate_limit_counters WHERE key = $1 AND window_start = $2",
    [key, windowStart.toISOString()]
  );
  if (result.rows.length === 0) return 0;
  return result.rows[0].count;
}

/**
 * Computes the start of the current sliding window (floored to the nearest minute).
 */
export function currentWindowStart(): Date {
  const now = Date.now();
  return new Date(now - (now % WINDOW_MS));
}

// --- Middleware ---

/**
 * Express middleware that enforces per-key rate limiting.
 *
 * - Under limit: sets X-RateLimit-* headers and calls next()
 * - Over limit: returns 429 with Retry-After header
 * - On Postgres failure: allows the request through (fail-open)
 */
export function rateLimiter() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = getRateLimitKey(req);
      const limit = await resolveLimit(req);
      const windowStart = currentWindowStart();
      const resetEpochSeconds = Math.ceil((windowStart.getTime() + WINDOW_MS) / 1000);

      const count = await incrementCounter(key, windowStart);
      const remaining = Math.max(0, limit - count);

      // Set rate-limit headers on every response
      res.set("X-RateLimit-Limit", String(limit));
      res.set("X-RateLimit-Remaining", String(remaining));
      res.set("X-RateLimit-Reset", String(resetEpochSeconds));

      if (count > limit) {
        const retryAfter = Math.max(1, resetEpochSeconds - Math.floor(Date.now() / 1000));
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "rate_limit_exceeded",
          message: `Rate limit of ${limit} requests per minute exceeded.`,
          retryAfter,
        });
        return;
      }

      next();
    } catch (err) {
      // Fail-open: if Postgres is down, allow the request through
      logger.error("Rate limiter error, allowing request through", { error: err });
      next();
    }
  };
}
