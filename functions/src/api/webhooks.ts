/**
 * Webhook Delivery System
 *
 * Subscribes to the event bus and delivers matching events to
 * registered webhook endpoints. Uses HMAC-SHA256 signing.
 * Retry with exponential backoff (5 attempts).
 */

import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { subscribe, matchesPattern } from "../events/bus";
import type { DomainEvent } from "../events/types";

interface WebhookSubscription {
  readonly id: string;
  readonly apiClientId: string;
  readonly eventPattern: string;
  readonly targetUrl: string;
  readonly secret: string;
  readonly active: boolean;
}

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;

/**
 * Registers the webhook delivery handler on the event bus.
 * Runs at priority 900 (after all internal handlers, before Pub/Sub bridge).
 */
export function registerWebhookDelivery(): void {
  subscribe("*", deliverWebhooks, 900);
  logger.info("Webhook delivery handler registered on event bus");
}

async function deliverWebhooks(event: DomainEvent): Promise<void> {
  const subscriptions = await loadActiveSubscriptions();

  const matching = subscriptions.filter((sub) =>
    matchesPattern(sub.eventPattern, event.eventName)
  );

  if (matching.length === 0) return;

  await Promise.allSettled(
    matching.map((sub) => deliverToSubscription(sub, event))
  );
}

async function deliverToSubscription(
  sub: WebhookSubscription,
  event: DomainEvent
): Promise<void> {
  const payload = JSON.stringify({
    eventId: event.eventId,
    eventName: event.eventName,
    domain: event.domain,
    action: event.action,
    recordId: event.recordId,
    timestamp: event.timestamp,
    data: {
      changedFields: event.changedFields,
      previousValues: event.previousValues,
      newValues: event.newValues,
    },
  });

  const signature = crypto
    .createHmac("sha256", sub.secret)
    .update(payload)
    .digest("hex");

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(sub.targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": event.eventName,
          "X-Webhook-ID": event.eventId,
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });

      await logDelivery(sub.id, event.eventId, event.eventName, attempt, response.status);

      if (response.ok) {
        await updateSubscriptionStatus(sub.id, response.status);
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        // Client error — don't retry
        logger.warn(`Webhook delivery failed (4xx), not retrying`, {
          subscriptionId: sub.id,
          status: response.status,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Webhook delivery attempt ${attempt} failed`, {
        subscriptionId: sub.id,
        error: message,
      });
      await logDelivery(sub.id, event.eventId, event.eventName, attempt, 0, message);
    }

    // Exponential backoff
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error(`Webhook delivery exhausted all retries`, {
    subscriptionId: sub.id,
    eventId: event.eventId,
  });
}

async function loadActiveSubscriptions(): Promise<ReadonlyArray<WebhookSubscription>> {
  const result = await query(
    "SELECT id, api_client_id, event_pattern, target_url, secret FROM webhook_subscriptions WHERE active = true"
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    apiClientId: row.api_client_id as string,
    eventPattern: row.event_pattern as string,
    targetUrl: row.target_url as string,
    secret: row.secret as string,
    active: true,
  }));
}

async function logDelivery(
  subscriptionId: string,
  eventId: string,
  eventName: string,
  attempt: number,
  statusCode: number,
  responseBody?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO webhook_delivery_log (subscription_id, event_id, event_name, attempt, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, eventId, eventName, attempt, statusCode, responseBody ?? null]
    );
  } catch {
    // Non-critical
  }
}

async function updateSubscriptionStatus(
  subscriptionId: string,
  lastStatus: number
): Promise<void> {
  try {
    await query(
      `UPDATE webhook_subscriptions SET last_delivery = now(), last_status = $1, retry_count = 0 WHERE id = $2`,
      [lastStatus, subscriptionId]
    );
  } catch {
    // Non-critical
  }
}
