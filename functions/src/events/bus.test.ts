import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  subscribe,
  emit,
  clearSubscriptions,
  subscriptionCount,
  createDomainEvent,
  generateEventId,
  matchesPattern,
} from "./bus";
import type { DomainEvent } from "./types";

// Mock Postgres client (event logging) and logger
vi.mock("../db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Helpers ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: generateEventId(),
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "page-123",
    triggeredBy: "test@example.com",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("Domain Event Bus", () => {
  beforeEach(() => {
    clearSubscriptions();
  });

  // --- createDomainEvent helper ---

  describe("createDomainEvent", () => {
    it("generates a unique eventId and timestamp", () => {
      const event = createDomainEvent({
        eventName: "staff.created",
        domain: "staff",
        action: "created",
        recordId: "page-456",
        triggeredBy: "admin@example.com",
      });

      expect(event.eventId).toBeDefined();
      expect(event.eventId).toHaveLength(36); // UUID v4
      expect(event.timestamp).toBeDefined();
      expect(new Date(event.timestamp).getTime()).not.toBeNaN();
    });

    it("preserves all provided fields", () => {
      const event = createDomainEvent({
        eventName: "guest.updated",
        domain: "guest",
        action: "updated",
        recordId: "page-789",
        triggeredBy: "liaison@ab.org",
        changedFields: ["status", "name"],
        previousValues: { status: "Pending" },
        newValues: { status: "Confirmed" },
      });

      expect(event.domain).toBe("guest");
      expect(event.action).toBe("updated");
      expect(event.changedFields).toEqual(["status", "name"]);
      expect(event.previousValues).toEqual({ status: "Pending" });
      expect(event.newValues).toEqual({ status: "Confirmed" });
    });
  });

  // --- generateEventId ---

  describe("generateEventId", () => {
    it("generates unique IDs on each call", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateEventId()));
      expect(ids.size).toBe(100);
    });
  });

  // --- Subscribe / unsubscribe ---

  describe("subscribe", () => {
    it("increments subscription count", () => {
      expect(subscriptionCount()).toBe(0);
      subscribe("guest.*", vi.fn());
      expect(subscriptionCount()).toBe(1);
      subscribe("staff.*", vi.fn());
      expect(subscriptionCount()).toBe(2);
    });

    it("returns an unsubscribe function that removes the subscription", () => {
      const unsub = subscribe("guest.*", vi.fn());
      expect(subscriptionCount()).toBe(1);
      unsub();
      expect(subscriptionCount()).toBe(0);
    });

    it("only removes the specific subscription, not others with the same pattern", () => {
      subscribe("guest.*", vi.fn());
      const unsub2 = subscribe("guest.*", vi.fn());
      expect(subscriptionCount()).toBe(2);
      unsub2();
      expect(subscriptionCount()).toBe(1);
    });
  });

  // --- clearSubscriptions ---

  describe("clearSubscriptions", () => {
    it("removes all subscriptions", () => {
      subscribe("a.*", vi.fn());
      subscribe("b.*", vi.fn());
      subscribe("c.*", vi.fn());
      clearSubscriptions();
      expect(subscriptionCount()).toBe(0);
    });
  });

  // --- Pattern matching via emit ---

  describe("pattern matching", () => {
    it("exact match triggers handler", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("guest.created", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("domain wildcard (guest.*) matches any action on concept", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("guest.*", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      await emit(makeEvent({ eventName: "guest.updated" }));
      await emit(makeEvent({ eventName: "guest.deleted" }));

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("action wildcard (*.created) matches any concept's action", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("*.created", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      await emit(makeEvent({ eventName: "staff.created" }));
      await emit(makeEvent({ eventName: "schedule.updated" })); // should NOT match

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("universal wildcard (*) matches everything", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("*", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      await emit(makeEvent({ eventName: "travel.deleted" }));
      await emit(makeEvent({ eventName: "prep.completed" }));

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("does NOT match when pattern has different segment count", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("guest.created.extra", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      expect(handler).not.toHaveBeenCalled();
    });

    it("does NOT match unrelated events", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("staff.updated", handler);

      await emit(makeEvent({ eventName: "guest.created" }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // --- Priority ordering ---

  describe("priority ordering", () => {
    it("executes lower-priority handlers first (lower number = higher priority)", async () => {
      const order: number[] = [];

      subscribe("guest.created", async () => { order.push(3); }, 300);
      subscribe("guest.created", async () => { order.push(1); }, 100);
      subscribe("guest.created", async () => { order.push(2); }, 200);

      await emit(makeEvent({ eventName: "guest.created" }));

      expect(order).toEqual([1, 2, 3]);
    });

    it("defaults to priority 100 when not specified", async () => {
      const order: number[] = [];

      subscribe("guest.created", async () => { order.push(2); }); // default 100
      subscribe("guest.created", async () => { order.push(1); }, 50);

      await emit(makeEvent({ eventName: "guest.created" }));

      expect(order).toEqual([1, 2]);
    });
  });

  // --- Error isolation ---

  describe("error isolation", () => {
    it("continues executing remaining handlers when one throws", async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockRejectedValue(new Error("handler2 exploded"));
      const handler3 = vi.fn().mockResolvedValue(undefined);

      subscribe("guest.created", handler1, 10);
      subscribe("guest.created", handler2, 20);
      subscribe("guest.created", handler3, 30);

      const logEntry = await emit(makeEvent({ eventName: "guest.created" }));

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
      expect(handler3).toHaveBeenCalledOnce();

      // Log entry should record the failure
      expect(logEntry.actionsExecuted).toHaveLength(3);
      expect(logEntry.actionsExecuted[0].success).toBe(true);
      expect(logEntry.actionsExecuted[1].success).toBe(false);
      expect(logEntry.actionsExecuted[1].error).toBe("handler2 exploded");
      expect(logEntry.actionsExecuted[2].success).toBe(true);
    });
  });

  // --- Event log entry ---

  describe("emit return value (EventLogEntry)", () => {
    it("returns a complete log entry with all metadata", async () => {
      subscribe("guest.created", vi.fn().mockResolvedValue(undefined));
      subscribe("guest.*", vi.fn().mockResolvedValue(undefined));

      const event = makeEvent({
        eventName: "guest.created",
        recordId: "page-abc",
        triggeredBy: "admin@ab.org",
      });

      const logEntry = await emit(event);

      expect(logEntry.eventId).toBe(event.eventId);
      expect(logEntry.eventName).toBe("guest.created");
      expect(logEntry.recordId).toBe("page-abc");
      expect(logEntry.triggeredBy).toBe("admin@ab.org");
      expect(logEntry.workflowsTriggered).toEqual(["guest.created", "guest.*"]);
      expect(logEntry.actionsExecuted).toHaveLength(2);
    });

    it("returns empty arrays when no subscriptions match", async () => {
      subscribe("staff.*", vi.fn().mockResolvedValue(undefined));

      const logEntry = await emit(makeEvent({ eventName: "guest.created" }));

      expect(logEntry.workflowsTriggered).toEqual([]);
      expect(logEntry.actionsExecuted).toEqual([]);
    });
  });

  // --- Handler receives full event context ---

  describe("handler receives event context", () => {
    it("passes the full DomainEvent to the handler", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("guest.updated", handler);

      const event = makeEvent({
        eventName: "guest.updated",
        action: "updated",
        changedFields: ["status"],
        previousValues: { status: "Pending" },
        newValues: { status: "Confirmed" },
        metadata: { source: "wizard" },
      });

      await emit(event);

      const received = handler.mock.calls[0][0] as DomainEvent;
      expect(received.eventName).toBe("guest.updated");
      expect(received.changedFields).toEqual(["status"]);
      expect(received.previousValues).toEqual({ status: "Pending" });
      expect(received.newValues).toEqual({ status: "Confirmed" });
      expect(received.metadata).toEqual({ source: "wizard" });
    });
  });

  // --- Chained behavior: subscribe → emit → inspect log ---

  describe("chained workflow simulation", () => {
    it("chains: guest.created triggers prep + schedule handlers", async () => {
      const prepItems: string[] = [];
      const scheduleItems: string[] = [];

      subscribe("guest.created", async (event) => {
        prepItems.push(`prep-for-${event.recordId}`);
      }, 10);

      subscribe("guest.created", async (event) => {
        scheduleItems.push(`schedule-for-${event.recordId}`);
      }, 20);

      const event = makeEvent({ recordId: "guest-001" });
      const log = await emit(event);

      expect(prepItems).toEqual(["prep-for-guest-001"]);
      expect(scheduleItems).toEqual(["schedule-for-guest-001"]);
      expect(log.actionsExecuted.every((a) => a.success)).toBe(true);
    });

    it("chains: multiple events accumulate side effects in order", async () => {
      const auditTrail: string[] = [];

      subscribe("*", async (event) => {
        auditTrail.push(event.eventName);
      });

      await emit(makeEvent({ eventName: "guest.created" }));
      await emit(makeEvent({ eventName: "travel.created" }));
      await emit(makeEvent({ eventName: "schedule.created" }));
      await emit(makeEvent({ eventName: "prep.created" }));

      expect(auditTrail).toEqual([
        "guest.created",
        "travel.created",
        "schedule.created",
        "prep.created",
      ]);
    });
  });

  // --- Double unsubscribe (PRD 7e) ---

  describe("double unsubscribe", () => {
    it("calling unsubscribe twice does not throw and has no side effects", () => {
      subscribe("other.*", vi.fn());
      const unsub = subscribe("guest.created", vi.fn());
      expect(subscriptionCount()).toBe(2);

      unsub();
      expect(subscriptionCount()).toBe(1);

      // Second unsubscribe: no error, count unchanged
      unsub();
      expect(subscriptionCount()).toBe(1);
    });
  });

  // --- Multi-segment wildcard (PRD 7a) ---

  describe("multi-segment wildcard matching", () => {
    it("*.*.created matches org.guest.created", () => {
      expect(matchesPattern("*.*.created", "org.guest.created")).toBe(true);
    });

    it("guest.* does NOT match org.guest.created (different segment count)", () => {
      expect(matchesPattern("guest.*", "org.guest.created")).toBe(false);
    });
  });

  // --- Postgres log failure tolerance (PRD 7d) ---

  describe("Postgres log failure tolerance", () => {
    it("returns a valid EventLogEntry even when Postgres query throws", async () => {
      // Override the mock to throw for this test
      const { query } = await import("../db/client");
      const mockQuery = vi.mocked(query);
      mockQuery.mockRejectedValueOnce(new Error("connection refused"));

      const handler = vi.fn().mockResolvedValue(undefined);
      subscribe("guest.created", handler);

      const event = makeEvent({ eventName: "guest.created" });
      const logEntry = await emit(event);

      // Handler should still have run
      expect(handler).toHaveBeenCalledOnce();

      // Log entry should be valid and complete
      expect(logEntry.eventId).toBe(event.eventId);
      expect(logEntry.eventName).toBe("guest.created");
      expect(logEntry.recordId).toBe(event.recordId);
      expect(logEntry.triggeredBy).toBe(event.triggeredBy);
      expect(logEntry.workflowsTriggered).toEqual(["guest.created"]);
      expect(logEntry.actionsExecuted).toHaveLength(1);
      expect(logEntry.actionsExecuted[0].success).toBe(true);
    });
  });
});
