import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockEmit = vi.fn().mockResolvedValue({
  eventId: "evt-1",
  eventName: "guest.invited",
  recordId: "g-1",
  triggeredBy: "test@example.com",
  timestamp: new Date().toISOString(),
  workflowsTriggered: [],
  actionsExecuted: [],
});
const mockCreateDomainEvent = vi.fn().mockImplementation((params) => ({
  eventId: "evt-1",
  timestamp: new Date().toISOString(),
  ...params,
}));
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

// --- Import module under test ---

import {
  transitionGuestStatus,
  getGuestsByStatus,
  getGuestSummary,
} from "./guest-lifecycle";

// --- Fixtures ---

function makeGuest(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    name: "Test Guest",
    type: "vip",
    department: "operations",
    status: "draft",
    company: "TestCo",
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived: false,
    ...overrides,
  };
}

describe("Guest Lifecycle Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- transitionGuestStatus ---

  describe("transitionGuestStatus", () => {
    it("succeeds for a valid transition (draft → invited) and fires event", async () => {
      const draftGuest = makeGuest({ status: "draft" });
      const invitedGuest = makeGuest({ status: "invited" });

      mockQuery
        .mockResolvedValueOnce({ rows: [draftGuest], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [invitedGuest], rowCount: 1 });

      const result = await transitionGuestStatus("g-1", "invited", "actor@test.com");

      expect(result.status).toBe("invited");
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "guest.invited",
          domain: "guest",
          action: "updated",
          recordId: "g-1",
          triggeredBy: "actor@test.com",
          changedFields: ["status"],
          previousValues: { status: "draft" },
          newValues: { status: "invited" },
        })
      );
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it("succeeds for invited → confirmed transition", async () => {
      const invitedGuest = makeGuest({ status: "invited" });
      const confirmedGuest = makeGuest({ status: "confirmed" });

      mockQuery
        .mockResolvedValueOnce({ rows: [invitedGuest], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [confirmedGuest], rowCount: 1 });

      const result = await transitionGuestStatus("g-1", "confirmed", "actor@test.com");

      expect(result.status).toBe("confirmed");
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "guest.confirmed",
          previousValues: { status: "invited" },
          newValues: { status: "confirmed" },
        })
      );
    });

    it("fails for an invalid transition (draft → departed)", async () => {
      const draftGuest = makeGuest({ status: "draft" });
      mockQuery.mockResolvedValueOnce({ rows: [draftGuest], rowCount: 1 });

      await expect(
        transitionGuestStatus("g-1", "departed", "actor@test.com")
      ).rejects.toThrow("Invalid status transition: draft → departed");

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("fails for an invalid transition (departed → draft)", async () => {
      const departedGuest = makeGuest({ status: "departed" });
      mockQuery.mockResolvedValueOnce({ rows: [departedGuest], rowCount: 1 });

      await expect(
        transitionGuestStatus("g-1", "draft", "actor@test.com")
      ).rejects.toThrow("Invalid status transition: departed → draft");
    });

    it("throws when guest is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        transitionGuestStatus("nonexistent", "invited", "actor@test.com")
      ).rejects.toThrow("Guest not found: nonexistent");
    });

    it("passes through the full lifecycle in order", async () => {
      const statuses = [
        "draft",
        "invited",
        "confirmed",
        "travel_arranged",
        "arrived",
        "attending",
        "departed",
      ] as const;

      for (let i = 0; i < statuses.length - 1; i++) {
        const from = statuses[i];
        const to = statuses[i + 1];

        mockQuery
          .mockResolvedValueOnce({ rows: [makeGuest({ status: from })], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [makeGuest({ status: to })], rowCount: 1 });

        const result = await transitionGuestStatus("g-1", to, "actor@test.com");
        expect(result.status).toBe(to);
      }

      expect(mockEmit).toHaveBeenCalledTimes(6);
    });
  });

  // --- getGuestsByStatus ---

  describe("getGuestsByStatus", () => {
    it("returns filtered guests for the given status", async () => {
      const guests = [
        makeGuest({ id: "g-1", status: "confirmed" }),
        makeGuest({ id: "g-2", status: "confirmed" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: guests, rowCount: 2 });

      const result = await getGuestsByStatus("confirmed");

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = $1"),
        ["confirmed"]
      );
    });

    it("returns empty array when no guests match", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getGuestsByStatus("departed");

      expect(result).toHaveLength(0);
    });
  });

  // --- getGuestSummary ---

  describe("getGuestSummary", () => {
    it("includes prep completion %, pairing count, and schedule count", async () => {
      const guest = makeGuest({ id: "g-1" });

      mockQuery
        .mockResolvedValueOnce({ rows: [guest], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total: "4", completed: "3" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: "5" }], rowCount: 1 });

      const summary = await getGuestSummary("g-1");

      expect(summary.id).toBe("g-1");
      expect(summary.prep_completion_percent).toBe(75);
      expect(summary.pairing_count).toBe(2);
      expect(summary.schedule_count).toBe(5);
    });

    it("returns 0% completion when there are no prep items", async () => {
      const guest = makeGuest({ id: "g-1" });

      mockQuery
        .mockResolvedValueOnce({ rows: [guest], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total: "0", completed: "0" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 });

      const summary = await getGuestSummary("g-1");

      expect(summary.prep_completion_percent).toBe(0);
      expect(summary.pairing_count).toBe(0);
      expect(summary.schedule_count).toBe(0);
    });

    it("throws when guest is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(getGuestSummary("nonexistent")).rejects.toThrow(
        "Guest not found: nonexistent"
      );
    });
  });
});
