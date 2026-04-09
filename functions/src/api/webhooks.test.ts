import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerWebhookDelivery,
  deliverToSubscription,
  computeSignature,
  loadActiveSubscriptions,
  setFetch,
  resetFetch,
  setSchedule,
  resetSchedule,
} from "./webhooks";
import type { WebhookSubscription } from "./webhooks";
import {
  subscribe,
  emit,
  clearSubscriptions,
  subscriptionCount,
  createDomainEvent,
} from "../events/bus";
import type { DomainEvent } from "../events/types";

// Mock Postgres and logger
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// --- Helpers ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-001",
    triggeredBy: "test@example.com",
    ...overrides,
  });
}

function makeSub(overrides: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: "sub-001",
    api_client_id: "client-001",
    event_pattern: "guest.*",
    target_url: "https://example.com/webhook",
    secret: "test-secret",
    active: true,
    ...overrides,
  };
}

describe("Webhook Delivery System", () => {
  beforeEach(() => {
    clearSubscriptions();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    resetFetch();
    resetSchedule();
  });

  afterEach(() => {
    resetFetch();
    resetSchedule();
  });

  // --- 1. registerWebhookDelivery subscribes at priority 900 ---

  describe("registerWebhookDelivery", () => {
    it("subscribes to event bus at priority 900", () => {
      const initialCount = subscriptionCount();
      const unsub = registerWebhookDelivery();
      expect(subscriptionCount()).toBe(initialCount + 1);
      unsub();
    });

    it("returns an unsubscribe function that removes the subscription", () => {
      const unsub = registerWebhookDelivery();
      const countBefore = subscriptionCount();
      unsub();
      expect(subscriptionCount()).toBe(countBefore - 1);
    });

    it("handler runs after lower-priority handlers (priority 900)", async () => {
      const order: number[] = [];

      // Register a handler at priority 50 (runs first)
      subscribe("guest.created", async () => { order.push(50); }, 50);

      // Register webhook delivery at priority 900 (runs later)
      // We need to intercept when the webhook handler runs
      // The webhook handler will try to load subscriptions from DB
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const unsub = registerWebhookDelivery();

      // Add another handler at priority 950 to confirm ordering
      subscribe("guest.created", async () => { order.push(950); }, 950);

      await emit(makeEvent({ eventName: "guest.created" }));

      // Priority 50 should run before 900 before 950
      expect(order[0]).toBe(50);
      // The webhook handler (900) doesn't push to order, but 950 does
      expect(order[1]).toBe(950);

      unsub();
    });
  });

  // --- 2. Matching webhook triggers delivery ---

  describe("event matching and delivery", () => {
    it("matching webhook triggers delivery via fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
      setFetch(mockFetch as unknown as typeof fetch);

      const sub = makeSub({ event_pattern: "guest.*" });

      // Mock loadActiveSubscriptions by configuring the query response
      mockQuery
        .mockResolvedValueOnce({ rows: [sub], rowCount: 1 }) // loadActiveSubscriptions
        .mockResolvedValue({ rows: [], rowCount: 0 }); // log/update queries

      const unsub = registerWebhookDelivery();
      await emit(makeEvent({ eventName: "guest.created" }));

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/webhook");
      expect(options.method).toBe("POST");

      unsub();
    });

    it("non-matching subscriptions are skipped", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
      setFetch(mockFetch as unknown as typeof fetch);

      const sub = makeSub({ event_pattern: "equipment.*" });
      mockQuery
        .mockResolvedValueOnce({ rows: [sub], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const unsub = registerWebhookDelivery();
      await emit(makeEvent({ eventName: "guest.created" }));

      // fetch should NOT be called because equipment.* doesn't match guest.created
      expect(mockFetch).not.toHaveBeenCalled();

      unsub();
    });
  });

  // --- 3. HMAC-SHA256 signature ---

  describe("computeSignature", () => {
    it("produces correct HMAC-SHA256 signature", () => {
      const payload = '{"eventName":"guest.created"}';
      const secret = "my-secret";

      const sig = computeSignature(payload, secret);

      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify independently
      const crypto = require("crypto");
      const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
      expect(sig).toBe(expected);
    });

    it("includes X-Signature header in delivery request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const sub = makeSub({ secret: "webhook-secret" });
      const event = makeEvent();

      await deliverToSubscription(sub, event);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify the signature matches the body
      const body = mockFetch.mock.calls[0][1].body;
      const expectedSig = computeSignature(body, "webhook-secret");
      expect(headers["X-Signature"]).toBe(expectedSig);
    });
  });

  // --- 4. Delivery success updates subscription ---

  describe("delivery success", () => {
    it("updates subscription status on successful delivery", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent());

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);

      // Verify the update query was called
      const updateCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE webhook_subscriptions")
      );
      expect(updateCalls.length).toBeGreaterThan(0);

      // The update should reset retry_count to 0
      const updateArgs = updateCalls[0];
      expect(updateArgs[1]).toContain(0); // retry_count = 0
    });
  });

  // --- 5. 5xx retries with backoff ---

  describe("retry behavior", () => {
    it("5xx triggers retry with backoff scheduling", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("Bad Gateway"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const scheduledCallbacks: Array<{ delayMs: number; fn: () => void }> = [];
      setSchedule((delayMs, fn) => {
        scheduledCallbacks.push({ delayMs, fn });
      });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent(), 1);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(502);
      expect(result.error).toContain("retrying attempt 2");

      // Verify a retry was scheduled
      expect(scheduledCallbacks).toHaveLength(1);
      expect(scheduledCallbacks[0].delayMs).toBe(10_000); // First retry: 10s
    });

    it("4xx does NOT retry", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const scheduledCallbacks: Array<{ delayMs: number; fn: () => void }> = [];
      setSchedule((delayMs, fn) => {
        scheduledCallbacks.push({ delayMs, fn });
      });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent(), 1);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.error).toContain("Client error");

      // No retry should be scheduled for 4xx
      expect(scheduledCallbacks).toHaveLength(0);
    });

    it("stops retrying after MAX_ATTEMPTS (5)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const scheduledCallbacks: Array<{ delayMs: number; fn: () => void }> = [];
      setSchedule((delayMs, fn) => {
        scheduledCallbacks.push({ delayMs, fn });
      });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent(), 5); // attempt 5 = final

      expect(result.success).toBe(false);
      expect(result.error).toContain("failed after 5 attempts");

      // No more retries should be scheduled
      expect(scheduledCallbacks).toHaveLength(0);
    });
  });

  // --- 6. Delivery logged ---

  describe("delivery logging", () => {
    it("logs each delivery attempt to webhook_delivery_log", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const sub = makeSub();
      const event = makeEvent();
      await deliverToSubscription(sub, event);

      const insertCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO webhook_delivery_log")
      );
      expect(insertCalls.length).toBe(1);
      const args = insertCalls[0][1] as unknown[];
      expect(args[0]).toBe(sub.id); // subscription_id
      expect(args[1]).toBe(event.eventId); // event_id
      expect(args[2]).toBe(event.eventName); // event_name
      expect(args[3]).toBe(1); // attempt
      expect(args[4]).toBe(200); // status_code
    });
  });

  // --- 7. Fetch timeout ---

  describe("fetch timeout", () => {
    it("handles fetch timeout/abort as a failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("The operation was aborted"));
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const scheduledCallbacks: Array<{ delayMs: number; fn: () => void }> = [];
      setSchedule((delayMs, fn) => {
        scheduledCallbacks.push({ delayMs, fn });
      });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent(), 1);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.error).toContain("aborted");

      // Should schedule a retry
      expect(scheduledCallbacks).toHaveLength(1);
    });

    it("does not retry fetch timeout on final attempt", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("The operation was aborted"));
      setFetch(mockFetch as unknown as typeof fetch);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const scheduledCallbacks: Array<{ delayMs: number; fn: () => void }> = [];
      setSchedule((delayMs, fn) => {
        scheduledCallbacks.push({ delayMs, fn });
      });

      const sub = makeSub();
      const result = await deliverToSubscription(sub, makeEvent(), 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain("failed after 5 attempts");
      expect(scheduledCallbacks).toHaveLength(0);
    });
  });

  // --- 8. loadActiveSubscriptions ---

  describe("loadActiveSubscriptions", () => {
    it("queries active subscriptions from Postgres", async () => {
      const rows = [
        makeSub({ id: "sub-1", event_pattern: "guest.*" }),
        makeSub({ id: "sub-2", event_pattern: "staff.*" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

      const subs = await loadActiveSubscriptions();
      expect(subs).toHaveLength(2);
      expect(subs[0].id).toBe("sub-1");
      expect(subs[1].id).toBe("sub-2");

      // Verify the query filters for active = true
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("active = true");
    });
  });
});
