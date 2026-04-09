/**
 * Tests for Workflow Engine
 *
 * Covers:
 * - Registration at priority 500
 * - Trigger matching (domain_event, field_changed, scheduled, manual)
 * - Condition evaluation (true/false/absent)
 * - All 9 action types
 * - Token interpolation
 * - Error isolation
 * - Manual workflow execution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainEvent } from "../events/types";
import type { WorkflowConfig, WorkflowAction } from "../ontology/types";

// --- Mocks (must be before import of module under test) ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSubscribe = vi.fn();
const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
const mockMatchesPattern = vi.fn();
vi.mock("../events/bus", () => ({
  subscribe: (...args: unknown[]) => {
    mockSubscribe(...args);
    return vi.fn(); // unsubscribe function
  },
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return {
      eventId: "evt-wf-1",
      timestamp: "2026-04-08T00:00:00.000Z",
      ...input,
    };
  },
  matchesPattern: (...args: unknown[]) => mockMatchesPattern(...args),
}));

const mockEvaluateCondition = vi.fn();
vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: (...args: unknown[]) => mockEvaluateCondition(...args),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (_fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: vi.fn() };
    return _fn(mockClient);
  },
}));

const mockCreateAuditContext = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  createAuditContext: (...args: unknown[]) => {
    mockCreateAuditContext(...args);
    return {
      actorId: "system",
      actorType: "system",
      changeSet: "cs-wf-123",
    };
  },
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "new-record-1" }] }),
    };
    return fn(mockClient);
  },
}));

vi.mock("../cache", () => ({
  cache: {
    getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
    invalidate: vi.fn(),
    clear: vi.fn(),
  },
  TTL_DOMAIN_MS: 60_000,
}));

// --- Import module under test ---

import {
  registerWorkflowEngine,
  handleDomainEvent,
  executeWorkflow,
  executeManualWorkflow,
  triggerMatchesEvent,
  interpolateTokens,
  loadActiveWorkflows,
  setFetch,
} from "./engine";

// --- Fixtures ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-1",
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-123",
    triggeredBy: "admin@example.com",
    timestamp: "2026-04-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    id: "wf-1",
    name: "Test Workflow",
    trigger: { type: "domain_event", event: "guest.created" },
    actions: [{ type: "notify", recipients: ["ops@example.com"] }],
    enabled: true,
    ...overrides,
  };
}

// ============================================================
// Registration
// ============================================================

describe("registerWorkflowEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to '*' at priority 500", () => {
    registerWorkflowEngine();

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("*", expect.any(Function), 500);
  });

  it("returns an unsubscribe function", () => {
    const unsub = registerWorkflowEngine();
    expect(typeof unsub).toBe("function");
  });
});

// ============================================================
// Trigger Matching
// ============================================================

describe("triggerMatchesEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches exact domain_event trigger", () => {
    mockMatchesPattern.mockReturnValue(true);

    const trigger = { type: "domain_event" as const, event: "guest.created" };
    const event = makeEvent();

    expect(triggerMatchesEvent(trigger, event)).toBe(true);
    expect(mockMatchesPattern).toHaveBeenCalledWith("guest.created", "guest.created");
  });

  it("matches glob domain_event trigger", () => {
    mockMatchesPattern.mockReturnValue(true);

    const trigger = { type: "domain_event" as const, event: "guest.*" };
    const event = makeEvent();

    expect(triggerMatchesEvent(trigger, event)).toBe(true);
    expect(mockMatchesPattern).toHaveBeenCalledWith("guest.*", "guest.created");
  });

  it("rejects non-matching domain_event trigger", () => {
    mockMatchesPattern.mockReturnValue(false);

    const trigger = { type: "domain_event" as const, event: "schedule.created" };
    const event = makeEvent();

    expect(triggerMatchesEvent(trigger, event)).toBe(false);
  });

  it("matches field_changed trigger when changedFields includes field", () => {
    mockMatchesPattern.mockReturnValue(true);

    const trigger = {
      type: "field_changed" as const,
      event: "guest.updated",
      field: "status",
    };
    const event = makeEvent({
      eventName: "guest.updated",
      action: "updated",
      changedFields: ["status", "name"],
    });

    expect(triggerMatchesEvent(trigger, event)).toBe(true);
  });

  it("rejects field_changed when changedFields does not include field", () => {
    mockMatchesPattern.mockReturnValue(true);

    const trigger = {
      type: "field_changed" as const,
      event: "guest.updated",
      field: "status",
    };
    const event = makeEvent({
      eventName: "guest.updated",
      action: "updated",
      changedFields: ["name"],
    });

    expect(triggerMatchesEvent(trigger, event)).toBe(false);
  });

  it("skips scheduled triggers", () => {
    const trigger = { type: "scheduled" as const, schedule: "0 9 * * *" };
    const event = makeEvent();

    expect(triggerMatchesEvent(trigger, event)).toBe(false);
  });

  it("skips manual triggers", () => {
    const trigger = { type: "manual" as const };
    const event = makeEvent();

    expect(triggerMatchesEvent(trigger, event)).toBe(false);
  });
});

// ============================================================
// Token Interpolation
// ============================================================

describe("interpolateTokens", () => {
  it("replaces {{recordId}} in string values", () => {
    const defaults = { note: "Record {{recordId}} was created" };
    const event = makeEvent({ recordId: "rec-456" });

    const result = interpolateTokens(defaults, event);

    expect(result.note).toBe("Record rec-456 was created");
  });

  it("replaces {{triggeredBy}} in string values", () => {
    const defaults = { createdBy: "{{triggeredBy}}" };
    const event = makeEvent({ triggeredBy: "alice@example.com" });

    const result = interpolateTokens(defaults, event);

    expect(result.createdBy).toBe("alice@example.com");
  });

  it("replaces {{field}} with first changedField", () => {
    const defaults = { field: "Changed field: {{field}}" };
    const event = makeEvent({ changedFields: ["status"] });

    const result = interpolateTokens(defaults, event);

    expect(result.field).toBe("Changed field: status");
  });

  it("leaves non-string values untouched", () => {
    const defaults = { count: 42, active: true };
    const event = makeEvent();

    const result = interpolateTokens(defaults, event);

    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });

  it("replaces multiple tokens in one string", () => {
    const defaults = { msg: "{{recordId}} by {{triggeredBy}}" };
    const event = makeEvent({ recordId: "r1", triggeredBy: "bob@x.com" });

    const result = interpolateTokens(defaults, event);

    expect(result.msg).toBe("r1 by bob@x.com");
  });
});

// ============================================================
// Condition Evaluation
// ============================================================

describe("executeWorkflow — conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("executes when condition is absent", async () => {
    const workflow = makeWorkflow({ condition: undefined });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    // The notify action should emit a notification event
    expect(mockCreateDomainEvent).toHaveBeenCalled();
  });

  it("executes when condition evaluates to true", async () => {
    mockEvaluateCondition.mockReturnValue(true);

    const workflow = makeWorkflow({
      condition: { type: "field", field: "status", operator: "eq", value: "vip" },
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockEvaluateCondition).toHaveBeenCalledTimes(1);
    expect(mockCreateDomainEvent).toHaveBeenCalled();
  });

  it("skips when condition evaluates to false", async () => {
    mockEvaluateCondition.mockReturnValue(false);

    const workflow = makeWorkflow({
      condition: { type: "field", field: "status", operator: "eq", value: "vip" },
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockEvaluateCondition).toHaveBeenCalledTimes(1);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ============================================================
// Action Types
// ============================================================

describe("Action: create_record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("inserts a record and fires a created event", async () => {
    const workflow = makeWorkflow({
      actions: [
        {
          type: "create_record",
          target: "task",
          defaults: { title: "Follow up on {{recordId}}" },
        },
      ],
    });
    const event = makeEvent({ recordId: "guest-1" });

    await executeWorkflow(workflow, event);

    expect(mockCreateAuditContext).toHaveBeenCalledWith("system", "system");
    expect(mockLogAuditClaim).toHaveBeenCalled();
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "task.created",
        domain: "task",
        action: "created",
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

describe("Action: update_record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("updates fields on the triggering record", async () => {
    const workflow = makeWorkflow({
      actions: [
        {
          type: "update_record",
          defaults: { status: "processed" },
        },
      ],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockLogAuditClaim).toHaveBeenCalled();
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.updated",
        domain: "guest",
        action: "updated",
        changedFields: ["status"],
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

describe("Action: delete_record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("soft-deletes (archives) the record", async () => {
    const workflow = makeWorkflow({
      actions: [{ type: "delete_record" }],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockLogAuditClaim).toHaveBeenCalled();
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.deleted",
        domain: "guest",
        action: "deleted",
        recordId: "rec-123",
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

describe("Action: notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("emits a notification.requested event", async () => {
    const workflow = makeWorkflow({
      actions: [
        {
          type: "notify",
          recipients: ["ops@example.com"],
          templateName: "welcome",
        },
      ],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "notification.requested",
        domain: "notification",
        metadata: expect.objectContaining({
          recipients: ["ops@example.com"],
          templateName: "welcome",
          sourceEvent: "guest.created",
        }),
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

describe("Action: call_api", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    setFetch(mockFetch as unknown as typeof globalThis.fetch);
  });

  it("makes an HTTP request to the target URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const workflow = makeWorkflow({
      actions: [
        {
          type: "call_api",
          target: "https://api.example.com/webhook",
          defaults: { method: "POST" },
        },
      ],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/webhook",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("does not fail the workflow on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const actions: WorkflowAction[] = [
      {
        type: "call_api",
        target: "https://api.example.com/fail",
        defaults: { method: "POST" },
      },
      {
        type: "notify",
        recipients: ["ops@example.com"],
      },
    ];

    const workflow = makeWorkflow({ actions });
    const event = makeEvent();

    mockEmit.mockResolvedValue(undefined);

    await executeWorkflow(workflow, event);

    // The notify action should still run after call_api's non-OK response
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "notification.requested",
      })
    );
  });
});

describe("Action: create_records (batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("creates records from template", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: "tpl-1", record_defaults: { role: "security" } },
        { id: "tpl-2", record_defaults: { role: "greeter" } },
      ],
    });

    const workflow = makeWorkflow({
      actions: [
        {
          type: "create_records",
          target: "staffing",
          template: "event-staff",
          defaults: { eventId: "{{recordId}}" },
        },
      ],
    });
    const event = makeEvent({ recordId: "evt-100" });

    await executeWorkflow(workflow, event);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("workflow_templates"),
      ["event-staff"]
    );

    // Two records created = two emit calls for staffing.created
    const createCalls = mockCreateDomainEvent.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).eventName === "staffing.created"
    );
    expect(createCalls.length).toBe(2);
  });
});

describe("Action: lookup_registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("queries guest_registry and copies fields to record", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "reg-1",
          attendance_count: 5,
          vip_status: "gold",
          notes: "VIP guest",
        },
      ],
    });

    const workflow = makeWorkflow({
      actions: [
        {
          type: "lookup_registry",
          match: "email",
          copyFields: ["attendance_count", "vip_status"],
        },
      ],
    });
    const event = makeEvent({
      newValues: { email: "alice@example.com", name: "Alice" },
    });

    await executeWorkflow(workflow, event);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("guest_registry"),
      ["email", "alice@example.com"]
    );
    expect(mockLogAuditClaim).toHaveBeenCalled();
  });
});

describe("Action: sync_calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("emits a calendar.sync_requested event", async () => {
    const workflow = makeWorkflow({
      actions: [{ type: "sync_calendar" }],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "calendar.sync_requested",
        domain: "calendar",
        action: "synced",
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

describe("Action: generate_doc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("emits a document.generation_requested event", async () => {
    const workflow = makeWorkflow({
      actions: [
        {
          type: "generate_doc",
          templateName: "contract",
        },
      ],
    });
    const event = makeEvent();

    await executeWorkflow(workflow, event);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "document.generation_requested",
        domain: "document",
        action: "created",
        metadata: expect.objectContaining({
          templateName: "contract",
        }),
      })
    );
    expect(mockEmit).toHaveBeenCalled();
  });
});

// ============================================================
// Error Isolation
// ============================================================

describe("Error isolation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
    mockFetch = vi.fn();
    setFetch(mockFetch as unknown as typeof globalThis.fetch);
  });

  it("failing action does not block subsequent actions", async () => {
    // First action: call_api that throws
    mockFetch.mockRejectedValue(new Error("Network error"));

    const actions: WorkflowAction[] = [
      {
        type: "call_api",
        target: "https://api.example.com/fail",
      },
      {
        type: "notify",
        recipients: ["ops@example.com"],
      },
    ];

    const workflow = makeWorkflow({ actions });
    const event = makeEvent();

    // Should NOT throw
    await executeWorkflow(workflow, event);

    // The notify action should still have run
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "notification.requested",
      })
    );
  });
});

// ============================================================
// handleDomainEvent
// ============================================================

describe("handleDomainEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("skips non-matching triggers", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "wf-1",
          name: "Schedule Workflow",
          description: null,
          trigger_config: { type: "domain_event", event: "schedule.created" },
          condition_config: null,
          actions_config: [{ type: "notify", recipients: ["ops@example.com"] }],
          enabled: true,
        },
      ],
    });
    mockMatchesPattern.mockReturnValue(false);

    const event = makeEvent({ eventName: "guest.created" });
    await handleDomainEvent(event);

    // No emit because no workflow matched
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ============================================================
// Manual Workflow Execution
// ============================================================

describe("executeManualWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockResolvedValue(undefined);
  });

  it("executes a manual workflow", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "wf-manual",
          name: "Manual Report",
          description: null,
          trigger_config: { type: "manual" },
          condition_config: null,
          actions_config: [{ type: "notify", recipients: ["report@example.com"] }],
          enabled: true,
        },
      ],
    });

    const result = await executeManualWorkflow(
      "wf-manual",
      { recordId: "r-1" },
      "admin@example.com"
    );

    expect(result.success).toBe(true);
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "notification.requested",
      })
    );
  });

  it("rejects non-manual workflow", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "wf-auto",
          name: "Auto Workflow",
          description: null,
          trigger_config: { type: "domain_event", event: "guest.created" },
          condition_config: null,
          actions_config: [{ type: "notify" }],
          enabled: true,
        },
      ],
    });

    const result = await executeManualWorkflow(
      "wf-auto",
      {},
      "admin@example.com"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a manual");
  });

  it("returns error for unknown workflow", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await executeManualWorkflow(
      "wf-nonexistent",
      {},
      "admin@example.com"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ============================================================
// loadActiveWorkflows
// ============================================================

describe("loadActiveWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries enabled workflows from Postgres", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "wf-1",
          name: "WF1",
          description: "desc",
          trigger_config: { type: "domain_event", event: "guest.created" },
          condition_config: null,
          actions_config: [{ type: "notify" }],
          enabled: true,
        },
      ],
    });

    const workflows = await loadActiveWorkflows();

    expect(workflows).toHaveLength(1);
    expect(workflows[0].id).toBe("wf-1");
    expect(workflows[0].name).toBe("WF1");
    expect(workflows[0].trigger.type).toBe("domain_event");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE enabled = true")
    );
  });
});
