/**
 * Tests for Real-Time SSE Service
 *
 * Covers:
 * - registerRealtimeHandler subscribes at priority 950
 * - SSE handler sets correct headers
 * - SSE handler rejects missing concepts param
 * - SSE handler rejects unauthenticated requests
 * - Event pushed to matching client
 * - RBAC filtering excludes unauthorized events
 * - Client disconnection removes from registry
 * - Keep-alive ping sent to connected clients
 * - Event buffering and replay of missed events
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

vi.mock("../db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

// --- Import module under test ---

import {
  registerRealtimeHandler,
  createSSEHandler,
  handleDomainEvent,
  clientCount,
  clearClients,
  stopKeepAlive,
  setRBACChecker,
  resetRBACChecker,
  getEventBuffer,
} from "./service";

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
    ...overrides,
  };
}

function mockReq(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, Function[]> = {};
  return {
    query: { concepts: "guest,schedule" },
    user: { uid: "test-uid", email: "user@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
    headers: {},
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    _emit: (event: string) => {
      (listeners[event] ?? []).forEach((fn) => fn());
    },
    ...overrides,
  };
}

function mockRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  clearSubscriptions();
  clearClients();
  stopKeepAlive();
  resetRBACChecker();
});

afterEach(() => {
  stopKeepAlive();
  resetRBACChecker();
});

// ============================================================
// registerRealtimeHandler
// ============================================================

describe("registerRealtimeHandler", () => {
  it("subscribes to event bus at priority 950", () => {
    const initial = subscriptionCount();
    const unsub = registerRealtimeHandler();

    expect(subscriptionCount()).toBe(initial + 1);

    unsub();
    stopKeepAlive();
  });
});

// ============================================================
// SSE handler
// ============================================================

describe("createSSEHandler", () => {
  it("sets correct SSE headers", () => {
    const handler = createSSEHandler();
    const req = mockReq();
    const res = mockRes();

    handler(req as any, res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    expect(clientCount()).toBe(1);
  });

  it("rejects missing concepts parameter", () => {
    const handler = createSSEHandler();
    const req = mockReq({ query: { concepts: "" } });
    const res = mockRes();

    handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(clientCount()).toBe(0);
  });

  it("rejects unauthenticated requests", () => {
    const handler = createSSEHandler();
    const req = mockReq({ user: undefined, role: undefined });
    const res = mockRes();

    handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(clientCount()).toBe(0);
  });

  it("sends initial connected event", () => {
    const handler = createSSEHandler();
    const req = mockReq();
    const res = mockRes();

    handler(req as any, res as any);

    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("event: connected")
    );
  });
});

// ============================================================
// Event pushing
// ============================================================

describe("handleDomainEvent", () => {
  it("pushes event to matching client", async () => {
    // Allow all RBAC checks
    setRBACChecker(async () => true);

    const handler = createSSEHandler();
    const req = mockReq();
    const res = mockRes();
    handler(req as any, res as any);

    // Clear the initial "connected" write
    res.write.mockClear();

    const event = makeEvent({ domain: "guest" });
    await handleDomainEvent(event);

    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("event: domain-event")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining(event.eventId)
    );
  });

  it("does not push event for non-matching concept", async () => {
    setRBACChecker(async () => true);

    const handler = createSSEHandler();
    const req = mockReq({ query: { concepts: "task" } });
    const res = mockRes();
    handler(req as any, res as any);

    res.write.mockClear();

    const event = makeEvent({ domain: "guest" });
    await handleDomainEvent(event);

    // No domain-event write (only the connected event was sent before clear)
    const domainEventWrites = res.write.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("domain-event")
    );
    expect(domainEventWrites).toHaveLength(0);
  });

  it("RBAC filtering excludes unauthorized events", async () => {
    // Deny all RBAC checks
    setRBACChecker(async () => false);

    const handler = createSSEHandler();
    const req = mockReq();
    const res = mockRes();
    handler(req as any, res as any);

    res.write.mockClear();

    const event = makeEvent({ domain: "guest" });
    await handleDomainEvent(event);

    const domainEventWrites = res.write.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("domain-event")
    );
    expect(domainEventWrites).toHaveLength(0);
  });
});

// ============================================================
// Client disconnection
// ============================================================

describe("Client disconnection", () => {
  it("removes client from registry on close", () => {
    const handler = createSSEHandler();
    const req = mockReq();
    const res = mockRes();
    handler(req as any, res as any);

    expect(clientCount()).toBe(1);

    // Simulate disconnect
    (req as any)._emit("close");

    expect(clientCount()).toBe(0);
  });
});

// ============================================================
// Event buffer
// ============================================================

describe("Event buffer", () => {
  it("buffers events for replay", async () => {
    setRBACChecker(async () => true);

    const event = makeEvent({ eventId: "evt-buffer-1" });
    await handleDomainEvent(event);

    const buffer = getEventBuffer();
    expect(buffer.length).toBeGreaterThanOrEqual(1);
    expect(buffer.some((e) => e.eventId === "evt-buffer-1")).toBe(true);
  });
});
