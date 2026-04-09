/**
 * Rate Limiter Middleware
 *
 * Sliding-window rate limiting per API key or IP address.
 * Limits stored in Postgres for cross-instance consistency.
 * Returns 429 with Retry-After header when limit exceeded.
 */

import type { Request, Response, NextFunction } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly keyFn: (req: Request) => string;
}

const DEFAULT_WINDOW_MS = 60_000; // 1 minute

export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = config.maxRequests ?? 60;
  const keyFn = config.keyFn ?? defaultKeyFn;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = keyFn(req);
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

    try {
      const result = await query(
        `INSERT INTO rate_limit_counters (key, window_start, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
         RETURNING count`,
        [key, windowStart.toISOString()]
      );

      const currentCount = result.rows[0].count as number;

      res.setHeader("X-RateLimit-Limit", maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - currentCount).toString());

      if (currentCount > maxRequests) {
        const retryAfterSec = Math.ceil(windowMs / 1000);
        res.setHeader("Retry-After", retryAfterSec.toString());
        res.status(429).json({
          success: false,
          error: "Rate limit exceeded. Try again later.",
        });
        return;
      }
    } catch (err) {
      logger.warn("Rate limiter error, allowing request", { error: err });
    }

    next();
  };
}

function defaultKeyFn(req: Request): string {
  // Use API key ID if present, otherwise IP
  if (req.user?.uid.startsWith("apikey:")) {
    return `apikey:${req.user.uid}`;
  }
  return `ip:${req.ip ?? "unknown"}`;
}

/**
 * Stricter rate limiter for external/public endpoints.
 */
export const externalRateLimiter = rateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
});

/**
 * Very strict rate limiter for public form submissions.
 */
export const publicFormRateLimiter = rateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
  keyFn: (req) => `public:${req.ip ?? "unknown"}`,
});
