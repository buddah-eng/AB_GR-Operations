import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "crypto";
import type { DomainEvent } from "../events/types";

// --- Mock boundaries ---

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockSubscribe = vi.fn();
const mockMatchesPattern = vi.fn();

vi.mock("../events/bus", () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  matchesPattern: (...args: unknown[]) => mockMatchesPattern(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Import after mocks ---

import { registerWebhookDelivery } from "./webhooks";

// --- Test data helpers ---

function makeDomainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-001",
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-001",
    triggeredBy: "user@example.com",
    timestamp: "2026-04-08T12:00:00.000Z",
    changedFields: ["name"],
    previousValues: {},
    newValues: { name: "Alice" },
    ...overrides,
  };
}

function makeSubscriptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-001",
    api_client_id: "client-001",
    event_pattern: "guest.*",
    target_url: "https://example.com/webhook",
    secret: "webhook-secret-key",
    ...overrides,
  };
}

// --- Tests ---

describe("Webhook Delivery System", () => {
  let capturedHandler: (event: DomainEvent) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    // Stub fetch globally
    vi.stubGlobal("fetch", vi.fn());

    // Stub setTimeout to resolve immediately for retry backoff
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // Registration
  // =========================================================================

  describe("registerWebhookDelivery", () => {
    it("subscribes to '*' at priority 900", () => {
      registerWebhookDelivery();

      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledWith("*", expect.any(Function), 900);
    });
  });

  // =========================================================================
  // Delivery
  // =========================================================================

  describe("webhook delivery", () => {
    beforeEach(() => {
      // Register and capture the handler
      registerWebhookDelivery();
      capturedHandler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
    });

    it("triggers fetch for matching webhook subscription", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Event": "guest.created",
            "X-Webhook-ID": "evt-001",
          }),
        })
      );
    });

    it("computes correct HMAC-SHA256 signature", async () => {
      const secret = "my-secret-123";
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow({ secret })] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      // Reconstruct the expected payload and signature
      const expectedPayload = JSON.stringify({
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

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(expectedPayload)
        .digest("hex");

      const fetchCall = mockFetch.mock.calls[0];
      const fetchOptions = fetchCall[1] as { headers: Record<string, string>; body: string };

      expect(fetchOptions.headers["X-Webhook-Signature"]).toBe(`sha256=${expectedSignature}`);
      expect(fetchOptions.body).toBe(expectedPayload);
    });

    it("skips delivery when no subscriptions match the event pattern", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow({ event_pattern: "staff.*" })] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(false);

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("updates last_delivery and last_status on successful delivery", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      // Find the UPDATE call for webhook_subscriptions
      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE webhook_subscriptions")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain("last_delivery");
      expect(updateCall![0]).toContain("last_status");
      expect(updateCall![1]).toEqual([200, "sub-001"]);
    });

    it("retries up to 5 times on 5xx server error", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();

      // Run the handler but advance timers for each backoff delay
      const handlerPromise = capturedHandler(event);

      // Advance through all retry delays: 1s, 2s, 4s, 8s
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * Math.pow(2, i));
      }

      await handlerPromise;

      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it("does not retry on 4xx client error", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 422 });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("logs delivery to webhook_delivery_log", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const event = makeDomainEvent();
      await capturedHandler(event);

      const logCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("webhook_delivery_log")
      );
      expect(logCall).toBeDefined();
      expect(logCall![0]).toContain("INSERT INTO webhook_delivery_log");
      expect(logCall![1]).toEqual([
        "sub-001",        // subscription_id
        "evt-001",        // event_id
        "guest.created",  // event_name
        1,                // attempt
        200,              // status_code
        null,             // response_body (null on success)
      ]);
    });

    it("passes AbortSignal.timeout(10000) to fetch", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM webhook_subscriptions")) {
          return Promise.resolve({ rows: [makeSubscriptionRow()] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockMatchesPattern.mockReturnValue(true);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      // Mock AbortSignal.timeout to return a known value
      const mockSignal = {} as AbortSignal;
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(mockSignal);

      const event = makeDomainEvent();
      await capturedHandler(event);

      expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchOptions = fetchCall[1] as { signal: AbortSignal };
      expect(fetchOptions.signal).toBe(mockSignal);
    });
  });
});

// Constant used in retry test
const RETRY_BASE_MS = 1000;
