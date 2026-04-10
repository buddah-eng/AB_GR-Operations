/**
 * Tests for Data Quality Service
 *
 * Covers:
 * - Rule evaluation with ConditionExpression
 * - Violation creation on failing rule
 * - No violation on passing rule
 * - Quality score calculation
 * - Rule CRUD operations
 * - Event handler integration
 * - Violation resolution
 */

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

const mockSubscribe = vi.fn().mockReturnValue(vi.fn());
const mockEmit = vi.fn().mockResolvedValue({});
const mockCreateDomainEvent = vi.fn().mockImplementation((params) => ({
  eventId: "evt-test-1",
  timestamp: "2026-04-08T00:00:00Z",
  ...params,
}));
vi.mock("../events/bus", () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

// --- Import module under test ---

import {
  registerQualityChecker,
  handleDomainEvent,
  evaluateRule,
  createViolation,
  getViolations,
  resolveViolation,
  getQualityScore,
  listRules,
  createRule,
  updateRule,
  deleteRule,
} from "./service";
import type { QualityRule } from "./service";
import type { DomainEvent } from "../events/types";
import type { ConditionExpression } from "../ontology/types";

// --- Helpers ---

function makeRule(overrides: Partial<QualityRule> = {}): QualityRule {
  return {
    id: "rule-1",
    name: "Email required",
    concept_key: "guest",
    rule_type: "completeness",
    condition: {
      type: "field",
      field: "email",
      operator: "is_not_empty",
    },
    severity: "error",
    active: true,
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-1",
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-1",
    triggeredBy: "user@example.com",
    timestamp: "2026-04-08T00:00:00Z",
    newValues: { email: "guest@example.com", name: "Test Guest" },
    ...overrides,
  };
}

// --- Tests ---

describe("registerQualityChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to all events at priority 650", () => {
    registerQualityChecker();
    expect(mockSubscribe).toHaveBeenCalledWith("*.*", expect.any(Function), 650);
  });

  it("returns an unsubscribe function", () => {
    const unsubscribe = registerQualityChecker();
    expect(typeof unsubscribe).toBe("function");
  });
});

describe("evaluateRule", () => {
  it("returns true when record passes a completeness rule", () => {
    const rule = makeRule();
    const record = { email: "guest@example.com" };
    expect(evaluateRule(rule, record)).toBe(true);
  });

  it("returns false when record fails a completeness rule", () => {
    const rule = makeRule();
    const record = { email: "" };
    expect(evaluateRule(rule, record)).toBe(false);
  });

  it("evaluates numeric comparison rules", () => {
    const rule = makeRule({
      name: "Age must be >= 18",
      rule_type: "consistency",
      condition: {
        type: "field",
        field: "age",
        operator: "gte",
        value: 18,
      },
    });

    expect(evaluateRule(rule, { age: 21 })).toBe(true);
    expect(evaluateRule(rule, { age: 15 })).toBe(false);
  });

  it("evaluates AND compound rules", () => {
    const rule = makeRule({
      name: "Complete guest",
      condition: {
        type: "and",
        conditions: [
          { type: "field", field: "name", operator: "is_not_empty" },
          { type: "field", field: "email", operator: "is_not_empty" },
        ],
      },
    });

    expect(evaluateRule(rule, { name: "Test", email: "a@b.com" })).toBe(true);
    expect(evaluateRule(rule, { name: "Test", email: "" })).toBe(false);
  });

  it("evaluates equality rules", () => {
    const rule = makeRule({
      name: "Status must be active",
      condition: {
        type: "field",
        field: "status",
        operator: "eq",
        value: "active",
      },
    });

    expect(evaluateRule(rule, { status: "active" })).toBe(true);
    expect(evaluateRule(rule, { status: "inactive" })).toBe(false);
  });
});

describe("handleDomainEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates violations for failing rules", async () => {
    const rule = makeRule();
    mockQuery
      .mockResolvedValueOnce({ rows: [rule] }) // loadRulesForConcept
      .mockResolvedValueOnce({
        rows: [{
          id: "viol-1",
          rule_id: "rule-1",
          record_id: "rec-1",
          concept_key: "guest",
          severity: "error",
          message: 'Quality rule "Email required" failed for record rec-1',
          resolved: false,
          created_at: "2026-04-08T00:00:00Z",
          resolved_at: null,
        }],
      }); // createViolation INSERT

    const event = makeEvent({ newValues: { email: "", name: "Test" } });
    await handleDomainEvent(event);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain("INSERT INTO quality_violations");
  });

  it("does not create violations when all rules pass", async () => {
    const rule = makeRule();
    mockQuery.mockResolvedValueOnce({ rows: [rule] }); // loadRulesForConcept

    const event = makeEvent({ newValues: { email: "guest@example.com" } });
    await handleDomainEvent(event);

    // Only 1 query: loadRulesForConcept. No INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("skips delete events", async () => {
    const event = makeEvent({ action: "deleted" });
    await handleDomainEvent(event);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("handles empty rule set gracefully", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const event = makeEvent();
    await handleDomainEvent(event);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("createViolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts violation and emits event", async () => {
    const violation = {
      id: "viol-1",
      rule_id: "rule-1",
      record_id: "rec-1",
      concept_key: "guest",
      severity: "error",
      message: "Test violation",
      resolved: false,
      created_at: "2026-04-08T00:00:00Z",
      resolved_at: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [violation] });

    const result = await createViolation("rule-1", "rec-1", "guest", "error", "Test violation");

    expect(result.id).toBe("viol-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO quality_violations"),
      ["rule-1", "rec-1", "guest", "error", "Test violation"]
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});

describe("getViolations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all violations when no filters given", async () => {
    const violations = [
      { id: "v1", concept_key: "guest", resolved: false },
      { id: "v2", concept_key: "driver", resolved: true },
    ];
    mockQuery.mockResolvedValueOnce({ rows: violations });

    const result = await getViolations();
    expect(result).toEqual(violations);
    expect(mockQuery.mock.calls[0][0]).not.toContain("WHERE");
  });

  it("filters by concept_key", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getViolations("guest");
    expect(mockQuery.mock.calls[0][0]).toContain("concept_key = $1");
    expect(mockQuery.mock.calls[0][1]).toEqual(["guest"]);
  });

  it("filters by resolved status", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getViolations(undefined, false);
    expect(mockQuery.mock.calls[0][0]).toContain("resolved = $1");
    expect(mockQuery.mock.calls[0][1]).toEqual([false]);
  });
});

describe("resolveViolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks violation as resolved", async () => {
    const resolved = {
      id: "v1",
      resolved: true,
      resolved_at: "2026-04-08T12:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [resolved] });

    const result = await resolveViolation("v1");
    expect(result).toEqual(resolved);
    expect(mockQuery.mock.calls[0][0]).toContain("resolved = true");
  });

  it("returns null when violation not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolveViolation("nonexistent");
    expect(result).toBeNull();
  });
});

describe("getQualityScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes score from total and resolved violations", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 10, passing: 8 }],
    });

    const score = await getQualityScore("guest");
    expect(score).toEqual({ total: 10, passing: 8, score_pct: 80 });
  });

  it("returns 100% when no violations exist", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 0, passing: 0 }],
    });

    const score = await getQualityScore("guest");
    expect(score).toEqual({ total: 0, passing: 0, score_pct: 100 });
  });
});

describe("Rule CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listRules returns all rules", async () => {
    const rules = [makeRule(), makeRule({ id: "rule-2", name: "Phone required" })];
    mockQuery.mockResolvedValueOnce({ rows: rules });

    const result = await listRules();
    expect(result).toEqual(rules);
  });

  it("listRules filters by concept", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRules("guest");
    expect(mockQuery.mock.calls[0][0]).toContain("concept_key = $1");
  });

  it("createRule inserts and returns new rule", async () => {
    const newRule = makeRule();
    mockQuery.mockResolvedValueOnce({ rows: [newRule] });

    const condition: ConditionExpression = {
      type: "field",
      field: "email",
      operator: "is_not_empty",
    };

    const result = await createRule({
      name: "Email required",
      concept_key: "guest",
      rule_type: "completeness",
      condition,
    });

    expect(result.id).toBe("rule-1");
    expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO quality_rules");
  });

  it("updateRule updates fields", async () => {
    const updated = makeRule({ name: "Updated name" });
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const result = await updateRule("rule-1", { name: "Updated name" });
    expect(result?.name).toBe("Updated name");
    expect(mockQuery.mock.calls[0][0]).toContain("UPDATE quality_rules");
  });

  it("updateRule returns null when no fields provided", async () => {
    const result = await updateRule("rule-1", {});
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("deleteRule returns true on success", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteRule("rule-1");
    expect(result).toBe(true);
  });

  it("deleteRule returns false when not found", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteRule("nonexistent");
    expect(result).toBe(false);
  });
});
