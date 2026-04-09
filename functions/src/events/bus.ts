/**
 * Domain Event Bus
 *
 * In-memory pub/sub with glob-style pattern matching.
 * Handlers execute sequentially by priority (lower = first).
 * One handler failing does not block subsequent handlers.
 * Every emitted event is logged to the Postgres event_log table.
 */

import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import type { DomainEvent, EventHandler, EventSubscription, EventLogEntry } from "./types";

// --- Subscription registry ---

const subscriptions: EventSubscription[] = [];

// --- Public API ---

/**
 * Subscribes a handler to domain events matching a pattern.
 *
 * Pattern syntax:
 *   "guest.created"    -- exact match
 *   "guest.*"          -- matches any event on the guest concept
 *   "*.created"        -- matches any concept's created event
 *   "*"                -- matches everything
 *
 * @returns An unsubscribe function.
 */
export function subscribe(
  pattern: string,
  handler: EventHandler,
  priority = 100
): () => void {
  const subscription: EventSubscription = { pattern, handler, priority };
  subscriptions.push(subscription);

  // Sort by priority after each subscription (stable sort)
  subscriptions.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  logger.info(`Event bus: subscribed to "${pattern}" (priority ${priority})`);

  return () => {
    const idx = subscriptions.indexOf(subscription);
    if (idx >= 0) {
      subscriptions.splice(idx, 1);
    }
  };
}

/**
 * Emits a domain event, executing all matching handlers sequentially.
 * Errors in individual handlers are caught and logged but do not
 * prevent other handlers from running.
 *
 * Returns the event log entry describing what happened.
 */
export async function emit(event: DomainEvent): Promise<EventLogEntry> {
  logger.info(`Event bus: emitting "${event.eventName}"`, {
    eventId: event.eventId,
    recordId: event.recordId,
    triggeredBy: event.triggeredBy,
  });

  const matchingSubscriptions = subscriptions.filter((sub) =>
    matchesPattern(sub.pattern, event.eventName)
  );

  const actionsExecuted: Array<{
    readonly workflowName: string;
    readonly actionType: string;
    readonly success: boolean;
    readonly error?: string;
  }> = [];

  for (const sub of matchingSubscriptions) {
    try {
      await sub.handler(event);
      actionsExecuted.push({
        workflowName: sub.pattern,
        actionType: "handler",
        success: true,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Event handler failed for pattern "${sub.pattern}"`, {
        eventName: event.eventName,
        error: errorMessage,
      });
      actionsExecuted.push({
        workflowName: sub.pattern,
        actionType: "handler",
        success: false,
        error: errorMessage,
      });
    }
  }

  const logEntry: EventLogEntry = {
    eventId: event.eventId,
    eventName: event.eventName,
    recordId: event.recordId,
    triggeredBy: event.triggeredBy,
    timestamp: event.timestamp,
    workflowsTriggered: matchingSubscriptions.map((s) => s.pattern),
    actionsExecuted,
  };

  // Fire-and-forget: log to Postgres (don't block the response)
  logEventToPostgres(logEntry).catch((err) => {
    logger.error("Failed to log event to Postgres", { error: err });
  });

  return logEntry;
}

/**
 * Generates a unique event ID.
 */
export function generateEventId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a DomainEvent with sensible defaults.
 */
export function createDomainEvent(
  params: Omit<DomainEvent, "eventId" | "timestamp">
): DomainEvent {
  return {
    ...params,
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns the current number of active subscriptions.
 */
export function subscriptionCount(): number {
  return subscriptions.length;
}

/**
 * Removes all subscriptions. Primarily for testing.
 */
export function clearSubscriptions(): void {
  subscriptions.length = 0;
}

// --- Pattern matching ---

/**
 * Tests whether an event name matches a subscription pattern.
 * Exported for testing.
 */
export function matchesPattern(pattern: string, eventName: string): boolean {
  if (pattern === "*") return true;

  const patternParts = pattern.split(".");
  const eventParts = eventName.split(".");

  if (patternParts.length !== eventParts.length) return false;

  return patternParts.every(
    (part, i) => part === "*" || part === eventParts[i]
  );
}

// --- Event logging to Postgres ---

async function logEventToPostgres(entry: EventLogEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO event_log (event_id, event_name, record_id, triggered_by, timestamp, workflows_triggered, actions_executed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.eventId,
        entry.eventName,
        entry.recordId,
        entry.triggeredBy,
        entry.timestamp,
        entry.workflowsTriggered,
        JSON.stringify(entry.actionsExecuted),
      ]
    );
  } catch (err) {
    logger.warn("Could not write event log to Postgres", { error: err });
  }
}
