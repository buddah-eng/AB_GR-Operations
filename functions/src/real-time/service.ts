/**
 * Real-Time SSE Service
 *
 * Server-Sent Events handler for pushing domain events to connected clients.
 * Subscribes to the event bus at priority 950 and pushes matching events
 * to clients whose subscribed concepts match the event domain.
 *
 * Features:
 * - RBAC filtering: checks client's role has view permission before pushing
 * - Connection management: in-memory client registry with keep-alive pings
 * - Reconnection: accepts Last-Event-ID header, replays missed events
 */

import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { subscribe } from "../events/bus";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface SSEClient {
  readonly id: string;
  readonly res: Response;
  readonly concepts: ReadonlyArray<string>;
  readonly roleKey: string;
  readonly userId: string;
}

export interface BufferedEvent {
  readonly eventId: string;
  readonly domain: string;
  readonly data: string;
  readonly timestamp: number;
}

// --- RBAC checker (injectable for testing) ---

export type RBACChecker = (
  roleKey: string,
  conceptKey: string,
  action: string
) => Promise<boolean>;

let _rbacChecker: RBACChecker = defaultRBACChecker;

export function setRBACChecker(checker: RBACChecker): void {
  _rbacChecker = checker;
}

export function resetRBACChecker(): void {
  _rbacChecker = defaultRBACChecker;
}

async function defaultRBACChecker(
  roleKey: string,
  conceptKey: string,
  action: string
): Promise<boolean> {
  // Import dynamically to avoid circular dependency at module load time
  const { roleEngine } = await import("../roles/engine");
  return roleEngine.canPerformAction(roleKey, conceptKey, action);
}

// --- Client registry ---

const clients: Map<string, SSEClient> = new Map();

// --- Circular buffer for event replay ---

const EVENT_BUFFER_SIZE = 200;
const eventBuffer: BufferedEvent[] = [];

// --- Keep-alive interval ---

const KEEP_ALIVE_MS = 30_000;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Returns the current number of connected SSE clients.
 */
export function clientCount(): number {
  return clients.size;
}

/**
 * Returns the current event buffer contents (for testing).
 */
export function getEventBuffer(): ReadonlyArray<BufferedEvent> {
  return [...eventBuffer];
}

/**
 * Clears all clients and the event buffer. Primarily for testing.
 */
export function clearClients(): void {
  clients.clear();
  eventBuffer.length = 0;
}

// --- Registration ---

/**
 * Subscribes to the event bus at priority 950.
 * Returns an unsubscribe function.
 */
export function registerRealtimeHandler(): () => void {
  startKeepAlive();
  return subscribe("*", handleDomainEvent, 950);
}

// --- SSE Handler ---

/**
 * Creates an Express handler for GET /api/stream?concepts=guest,schedule.
 *
 * NOTE: On Vercel serverless, SSE connections time out after 300 seconds (5 minutes).
 * The canvas config bridge handles disconnection gracefully (isDisconnected computed).
 * For production, consider polling fallback or Vercel Fluid Compute for long-running connections.
 */
export function createSSEHandler() {
  return (req: Request, res: Response): void => {
    const conceptsParam = (req.query.concepts as string) ?? "";
    const concepts = conceptsParam
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (concepts.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Query parameter "concepts" is required (comma-separated).',
      });
      return;
    }

    if (!req.user || !req.role) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const client: SSEClient = {
      id: clientId,
      res,
      concepts,
      roleKey: req.role.roleKey,
      userId: req.user.uid,
    };

    clients.set(clientId, client);

    logger.info("SSE client connected", {
      clientId,
      concepts,
      roleKey: req.role.roleKey,
    });

    // Replay missed events if Last-Event-ID is provided
    const lastEventId = req.headers["last-event-id"] as string | undefined;
    if (lastEventId) {
      replayMissedEvents(client, lastEventId);
    }

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    // Handle client disconnect
    req.on("close", () => {
      clients.delete(clientId);
      logger.info("SSE client disconnected", { clientId });
    });
  };
}

// --- Event handling ---

/**
 * Pushes a domain event to connected SSE clients whose subscribed
 * concepts match the event domain, with RBAC filtering.
 */
export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  // Buffer the event for replay
  bufferEvent(event);

  const matchingClients = Array.from(clients.values()).filter((client) =>
    client.concepts.includes(event.domain)
  );

  if (matchingClients.length === 0) return;

  const eventData = JSON.stringify({
    eventId: event.eventId,
    eventName: event.eventName,
    domain: event.domain,
    action: event.action,
    recordId: event.recordId,
    triggeredBy: event.triggeredBy,
    timestamp: event.timestamp,
    newValues: event.newValues,
  });

  for (const client of matchingClients) {
    try {
      const canView = await _rbacChecker(client.roleKey, event.domain, "view");
      if (!canView) continue;

      client.res.write(`id: ${event.eventId}\nevent: domain-event\ndata: ${eventData}\n\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("SSE push failed", {
        clientId: client.id,
        error: message,
      });
    }
  }
}

// --- Keep-alive ---

function startKeepAlive(): void {
  if (keepAliveInterval) return;

  keepAliveInterval = setInterval(() => {
    const now = new Date().toISOString();
    for (const client of clients.values()) {
      try {
        client.res.write(`:keep-alive ${now}\n\n`);
      } catch {
        clients.delete(client.id);
      }
    }
  }, KEEP_ALIVE_MS);

  // Allow the timer to not block process exit
  if (keepAliveInterval.unref) {
    keepAliveInterval.unref();
  }
}

/**
 * Stops the keep-alive timer. Primarily for testing.
 */
export function stopKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// --- Event buffer ---

function bufferEvent(event: DomainEvent): void {
  eventBuffer.push({
    eventId: event.eventId,
    domain: event.domain,
    data: JSON.stringify({
      eventId: event.eventId,
      eventName: event.eventName,
      domain: event.domain,
      action: event.action,
      recordId: event.recordId,
      triggeredBy: event.triggeredBy,
      timestamp: event.timestamp,
      newValues: event.newValues,
    }),
    timestamp: Date.now(),
  });

  // Trim buffer to max size
  while (eventBuffer.length > EVENT_BUFFER_SIZE) {
    eventBuffer.shift();
  }
}

function replayMissedEvents(client: SSEClient, lastEventId: string): void {
  const lastIndex = eventBuffer.findIndex((e) => e.eventId === lastEventId);

  // If not found, replay nothing (too old or invalid)
  if (lastIndex === -1) return;

  const missed = eventBuffer.slice(lastIndex + 1);

  for (const buffered of missed) {
    if (client.concepts.includes(buffered.domain)) {
      client.res.write(
        `id: ${buffered.eventId}\nevent: domain-event\ndata: ${buffered.data}\n\n`
      );
    }
  }
}
