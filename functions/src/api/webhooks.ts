/**
 * Webhook Delivery System
 *
 * Subscribes to the domain event bus at priority 900,
 * loads active webhook subscriptions from Postgres,
 * matches event patterns (glob), delivers with HMAC-SHA256 signing,
 * and retries with exponential backoff (5 attempts).
 */

import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { subscribe } from "../events/bus";
import { matchesPattern } from "../events/bus";
import { query } from "../db/client";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface WebhookSubscription {
  readonly id: string;
  readonly api_client_id: string;
  readonly event_pattern: string;
  readonly target_url: string;
  readonly secret: string;
  readonly active: boolean;
}

export interface DeliveryResult {
  readonly subscriptionId: string;
  readonly statusCode: number | null;
  readonly success: boolean;
  readonly error?: string;
}

// --- Constants ---

/** Retry delays in milliseconds: 10s, 30s, 2min, 10min, 30min */
const RETRY_DELAYS_MS: readonly number[] = [
  10_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
];

const MAX_ATTEMPTS = 5;
const FETCH_TIMEOUT_MS = 10_000;

// --- Injected fetch (for testing) ---

type FetchFn = typeof globalThis.fetch;

let _fetch: FetchFn = globalThis.fetch;

/**
 * Replace the fetch implementation. Primarily for testing.
 */
export function setFetch(fn: FetchFn): void {
  _fetch = fn;
}

/**
 * Reset fetch to the global implementation.
 */
export function resetFetch(): void {
  _fetch = globalThis.fetch;
}

// --- Injected schedule (for testing) ---

type ScheduleFn = (delayMs: number, fn: () => void) => void;

let _schedule: ScheduleFn = (delayMs, fn) => {
  setTimeout(fn, delayMs);
};

/**
 * Replace the schedule implementation. Primarily for testing.
 */
export function setSchedule(fn: ScheduleFn): void {
  _schedule = fn;
}

/**
 * Reset schedule to default setTimeout.
 */
export function resetSchedule(): void {
  _schedule = (delayMs, fn) => {
    setTimeout(fn, delayMs);
  };
}

// --- HMAC signing ---

/**
 * Compute HMAC-SHA256 signature for a payload.
 */
export function computeSignature(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
}

// --- Load subscriptions ---

/**
 * Loads active webhook subscriptions from Postgres.
 */
export async function loadActiveSubscriptions(): Promise<ReadonlyArray<WebhookSubscription>> {
  const result = await query<{
    id: string;
    api_client_id: string;
    event_pattern: string;
    target_url: string;
    secret: string;
    active: boolean;
  }>(
    "SELECT id, api_client_id, event_pattern, target_url, secret, active FROM webhook_subscriptions WHERE active = true"
  );
  return result.rows.map((row) => ({
    id: row.id,
    api_client_id: row.api_client_id,
    event_pattern: row.event_pattern,
    target_url: row.target_url,
    secret: row.secret,
    active: row.active,
  }));
}

// --- Log delivery attempt ---

async function logDeliveryAttempt(
  subscriptionId: string,
  eventId: string,
  eventName: string,
  attempt: number,
  statusCode: number | null,
  responseBody: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO webhook_delivery_log (subscription_id, event_id, event_name, attempt, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, eventId, eventName, attempt, statusCode, responseBody]
    );
  } catch (err) {
    logger.warn("Failed to log webhook delivery", { error: err, subscriptionId, eventId });
  }
}

// --- Update subscription status ---

async function updateSubscriptionStatus(
  subscriptionId: string,
  statusCode: number | null,
  retryCount: number
): Promise<void> {
  try {
    await query(
      `UPDATE webhook_subscriptions
       SET last_delivery = now(), last_status = $1, retry_count = $2
       WHERE id = $3`,
      [statusCode, retryCount, subscriptionId]
    );
  } catch (err) {
    logger.warn("Failed to update webhook subscription status", { error: err, subscriptionId });
  }
}

// --- Deliver to a single subscription ---

/**
 * Delivers an event to a single webhook subscription.
 * Retries on 5xx with exponential backoff up to MAX_ATTEMPTS.
 * 4xx responses do NOT retry.
 */
export async function deliverToSubscription(
  subscription: WebhookSubscription,
  event: DomainEvent,
  attempt = 1
): Promise<DeliveryResult> {
  const body = JSON.stringify(event);
  const signature = computeSignature(body, subscription.secret);
  const deliveryId = crypto.randomUUID();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await _fetch(subscription.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Event-Type": event.eventName,
        "X-Delivery-Id": deliveryId,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBody = await response.text().catch(() => "");

    // Log this attempt
    await logDeliveryAttempt(
      subscription.id,
      event.eventId,
      event.eventName,
      attempt,
      response.status,
      responseBody.slice(0, 1000)
    );

    if (response.ok) {
      // Success: update subscription status
      await updateSubscriptionStatus(subscription.id, response.status, 0);
      return {
        subscriptionId: subscription.id,
        statusCode: response.status,
        success: true,
      };
    }

    // 4xx: client error, do NOT retry
    if (response.status >= 400 && response.status < 500) {
      await updateSubscriptionStatus(subscription.id, response.status, attempt);
      return {
        subscriptionId: subscription.id,
        statusCode: response.status,
        success: false,
        error: `Client error: ${response.status}`,
      };
    }

    // 5xx: server error, retry with backoff
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      _schedule(delayMs, () => {
        deliverToSubscription(subscription, event, attempt + 1).catch((err) => {
          logger.error("Webhook retry failed", { error: err, subscriptionId: subscription.id });
        });
      });
      return {
        subscriptionId: subscription.id,
        statusCode: response.status,
        success: false,
        error: `Server error: ${response.status}, retrying attempt ${attempt + 1}`,
      };
    }

    // All attempts exhausted
    await updateSubscriptionStatus(subscription.id, response.status, attempt);
    return {
      subscriptionId: subscription.id,
      statusCode: response.status,
      success: false,
      error: `Delivery failed after ${MAX_ATTEMPTS} attempts`,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await logDeliveryAttempt(
      subscription.id,
      event.eventId,
      event.eventName,
      attempt,
      null,
      errorMessage
    );

    // Retry on network/timeout errors
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      _schedule(delayMs, () => {
        deliverToSubscription(subscription, event, attempt + 1).catch((retryErr) => {
          logger.error("Webhook retry failed", { error: retryErr, subscriptionId: subscription.id });
        });
      });
      return {
        subscriptionId: subscription.id,
        statusCode: null,
        success: false,
        error: `${errorMessage}, retrying attempt ${attempt + 1}`,
      };
    }

    await updateSubscriptionStatus(subscription.id, null, attempt);
    return {
      subscriptionId: subscription.id,
      statusCode: null,
      success: false,
      error: `Delivery failed after ${MAX_ATTEMPTS} attempts: ${errorMessage}`,
    };
  }
}

// --- Main event handler ---

/**
 * Event handler that fans out to matching webhook subscriptions.
 */
async function webhookEventHandler(event: DomainEvent): Promise<void> {
  let subscriptions: ReadonlyArray<WebhookSubscription>;

  try {
    subscriptions = await loadActiveSubscriptions();
  } catch (err) {
    logger.error("Failed to load webhook subscriptions", { error: err });
    return;
  }

  const matching = subscriptions.filter((sub) =>
    matchesPattern(sub.event_pattern, event.eventName)
  );

  if (matching.length === 0) return;

  logger.info(`Webhook delivery: ${matching.length} subscription(s) match "${event.eventName}"`);

  // Fire deliveries in parallel (fire-and-forget for retries)
  const results = await Promise.allSettled(
    matching.map((sub) => deliverToSubscription(sub, event))
  );

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("Webhook delivery promise rejected", { error: result.reason });
    }
  }
}

// --- Registration ---

/**
 * Registers the webhook delivery handler on the event bus at priority 900.
 * Call once during app startup.
 *
 * @returns An unsubscribe function.
 */
export function registerWebhookDelivery(): () => void {
  return subscribe("*", webhookEventHandler, 900);
}
