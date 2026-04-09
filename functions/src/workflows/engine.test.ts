import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DomainEvent } from "../events/types";
import type { WorkflowConfig, ConditionExpression } from "../ontology/types";

// --- Mock dependencies ---

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockSubscribe = vi.fn();
const mockEmit = vi.fn().mockResolvedValue({
  eventId: "log-1",
  eventName: "test",
  recordId: "r-1",
  triggeredBy: "test",
  timestamp: new Date().toISOString(),
  workflowsTriggered: [],
  actionsExecuted: [],
});
const mockCreateDomainEvent = vi.fn((params: Partial<DomainEvent>) => ({
  eventId: "evt-generated",
  timestamp: new Date().toISOString(),
  ...params,
}));

vi.mock("../events/bus", () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...(args as [Record<string, unknown>])),
}));

const mockEvaluateCondition = vi.fn();
vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: (...args: unknown[]) => mockEvaluateCondition(...args),
}));

vi.mock("../cache", () => {
  const store = new Map<string, unknown>();
  return {
    cache: {
      getOrLoad: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
      clear: () => store.clear(),
    },
    TTL_ONTOLOGY_MS: 300_000,
  };
});

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Mock global fetch for call_api tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// --- Helpers ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-001",
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-123",
    triggeredBy: "test@example.com",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    id: "wf-1",
    name: "Test Workflow",
    trigger: { type: "domain_event", event: "guest.created" },
    actions: [],
    enabled: true,
    ...overrides,
  };
}

function makeWorkflowRow(overrides: Partial<WorkflowConfig> = {}): Record<string, unknown> {
  const wf = makeWorkflow(overrides);
  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    trigger: wf.trigger,
    condition: wf.condition,
    actions: wf.actions,
    enabled: wf.enabled,
  };
}

// --- Tests ---

describe("Workflow Engine", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSubscribe.mockReset();
    mockEmit.mockReset().mockResolvedValue({
      eventId: "log-1",
      eventName: "test",
      recordId: "r-1",
      triggeredBy: "test",
      timestamp: new Date().toISOString(),
      workflowsTriggered: [],
      actionsExecuted: [],
    });
    mockCreateDomainEvent.mockReset().mockImplementation((params: Partial<DomainEvent>) => ({
      eventId: "evt-generated",
      timestamp: new Date().toISOString(),
      ...params,
    }));
    mockEvaluateCondition.mockReset();
    mockFetch.mockReset();
  });

  // =========================================================================
  // Registration
  // =========================================================================

  describe("registerWorkflowEngine", () => {
    it("subscribes to '*' at priority 500", async () => {
      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      expect(mockSubscribe).toHaveBeenCalledWith("*", expect.any(Function), 500);
    });
  });

  // =========================================================================
  // Trigger matching
  // =========================================================================

  describe("trigger matching", () => {
    it("domain_event trigger matches exact event name", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });
      mockEvaluateCondition.mockReturnValue(true);

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
      await handler(makeEvent({ eventName: "guest.created" }));

      // The workflow matched — logger.info would have been called for execution
      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });

    it("domain_event trigger matches glob pattern", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            trigger: { type: "domain_event", event: "guest.*" },
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });
      mockEvaluateCondition.mockReturnValue(true);

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
      await handler(makeEvent({ eventName: "guest.updated" }));

      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });

    it("field_changed trigger matches when changedFields includes the field", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            trigger: { type: "field_changed", field: "status" },
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });
      mockEvaluateCondition.mockReturnValue(true);

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
      await handler(
        makeEvent({
          eventName: "guest.updated",
          action: "updated",
          changedFields: ["status", "name"],
        })
      );

      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });

    it("field_changed trigger does not match unrelated field changes", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            trigger: { type: "field_changed", field: "status" },
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;

      // Clear logger before this call
      const logger = await import("firebase-functions/logger");
      vi.mocked(logger.info).mockClear();

      await handler(
        makeEvent({
          eventName: "guest.updated",
          action: "updated",
          changedFields: ["name", "email"],
        })
      );

      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeUndefined();
    });

    it("non-matching triggers are skipped", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            trigger: { type: "domain_event", event: "staff.created" },
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;

      const logger = await import("firebase-functions/logger");
      vi.mocked(logger.info).mockClear();

      await handler(makeEvent({ eventName: "guest.created" }));

      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeUndefined();
    });
  });

  // =========================================================================
  // Condition evaluation
  // =========================================================================

  describe("condition evaluation", () => {
    it("workflow with condition=true executes actions", async () => {
      const condition: ConditionExpression = { type: "field", field: "status", operator: "eq", value: "Confirmed" };
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            condition,
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });
      mockEvaluateCondition.mockReturnValue(true);

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      expect(mockEvaluateCondition).toHaveBeenCalledOnce();
      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });

    it("workflow with condition=false skips actions", async () => {
      const condition: ConditionExpression = { type: "field", field: "status", operator: "eq", value: "Confirmed" };
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            condition,
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });
      mockEvaluateCondition.mockReturnValue(false);

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;

      const logger = await import("firebase-functions/logger");
      vi.mocked(logger.info).mockClear();
      vi.mocked(logger.debug).mockClear();

      await handler(makeEvent());

      expect(mockEvaluateCondition).toHaveBeenCalledOnce();
      const debugCalls = vi.mocked(logger.debug).mock.calls;
      const skipCall = debugCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("condition not met")
      );
      expect(skipCall).toBeDefined();
    });

    it("workflow with no condition executes actions", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            condition: undefined,
            actions: [{ type: "notify", recipients: ["admin"], templateName: "test" }],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (event: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      // evaluateCondition should NOT have been called
      expect(mockEvaluateCondition).not.toHaveBeenCalled();

      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });
  });

  // =========================================================================
  // Action execution
  // =========================================================================

  describe("action execution", () => {
    it("create_record inserts and fires event", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "create_record",
                  target: "prep_item",
                  defaults: { name: "Welcome Kit" },
                  link: "guest_id",
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ id: "new-rec-1" }], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      // Verify INSERT was called
      const insertCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain("prep_items");

      // Verify event was emitted
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "prep_item.created",
          domain: "prep_item",
          action: "created",
          recordId: "new-rec-1",
        })
      );
      expect(mockEmit).toHaveBeenCalled();
    });

    it("update_record updates the record", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "update_record",
                  target: "guest",
                  defaults: { status: "Confirmed" },
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      const updateCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("UPDATE")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain("guests");
      expect(updateCall![0]).toContain("updated_at = now()");
    });

    it("delete_record archives the record", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [{ type: "delete_record", target: "guest" }],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      const archiveCall = mockQuery.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("UPDATE") &&
          c[0].includes("archived = true")
      );
      expect(archiveCall).toBeDefined();
      expect(archiveCall![0]).toContain("guests");
    });

    it("notify logs notification intent", async () => {
      const logger = await import("firebase-functions/logger");
      vi.mocked(logger.info).mockClear();

      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "notify",
                recipients: ["admin@ab.org", "liaison@ab.org"],
                templateName: "guest_arrival",
              },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      const infoCalls = vi.mocked(logger.info).mock.calls;
      const notifyCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Notification triggered")
      );
      expect(notifyCall).toBeDefined();
      expect(notifyCall![1]).toEqual(
        expect.objectContaining({
          recipients: ["admin@ab.org", "liaison@ab.org"],
        })
      );
    });

    it("lookup_registry copies fields from registry", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "lookup_registry",
                  source: "guest",
                  match: "email",
                  copyFields: ["dietary", "phone"],
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        // Registry lookup
        .mockResolvedValueOnce({
          rows: [{ properties: { email: "vip@test.com", dietary: "Vegan", phone: "+1234" } }],
          rowCount: 1,
        })
        // Update
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(
        makeEvent({
          newValues: { email: "vip@test.com" },
        })
      );

      // Verify registry lookup
      const selectCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("SELECT properties FROM guest_registry")
      );
      expect(selectCall).toBeDefined();

      // Verify update with copied fields
      const updateCall = mockQuery.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("UPDATE") &&
          c[0].includes("properties = properties ||")
      );
      expect(updateCall).toBeDefined();
    });

    it("call_api makes HTTP request", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "call_api",
                defaults: {
                  url: "https://api.example.com/webhook",
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: '{"recordId":"{{recordId}}"}',
                },
              },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"recordId":"rec-123"}',
        })
      );
    });

    it("create_records creates multiple records from template", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "create_records",
                  target: "prep_item",
                  template: "welcome_kit",
                  defaults: { priority: "high" },
                  link: "guest_id",
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        // Template lookup
        .mockResolvedValueOnce({
          rows: [
            {
              properties: [
                { name: "Name Badge", category: "badge" },
                { name: "Welcome Pack", category: "materials" },
              ],
            },
          ],
          rowCount: 1,
        })
        // First insert
        .mockResolvedValueOnce({ rows: [{ id: "batch-1" }], rowCount: 1 })
        // Second insert
        .mockResolvedValueOnce({ rows: [{ id: "batch-2" }], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      // Verify template lookup
      const templateCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("concept_templates")
      );
      expect(templateCall).toBeDefined();

      // Verify two inserts
      const insertCalls = mockQuery.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO prep_items")
      );
      expect(insertCalls).toHaveLength(2);

      // Verify two events emitted
      const createCalls = mockCreateDomainEvent.mock.calls.filter(
        (c) => c[0].eventName === "prep_item.created"
      );
      expect(createCalls).toHaveLength(2);
    });

    it("error in one action does not block subsequent actions", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                { type: "create_record", target: "prep_item", defaults: { name: "Item 1" } },
                { type: "notify", recipients: ["admin"], templateName: "test" },
              ],
            }),
          ],
          rowCount: 1,
        })
        // First action: create_record INSERT fails
        .mockRejectedValueOnce(new Error("DB connection lost"));

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;

      // Should not throw even though first action fails
      await expect(handler(makeEvent())).resolves.toBeUndefined();

      // Notify (second action) should still have run
      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const notifyCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Notification triggered")
      );
      expect(notifyCall).toBeDefined();

      // Error should have been logged
      const errorCalls = vi.mocked(logger.error).mock.calls;
      const failCall = errorCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("action") && c[0].includes("failed")
      );
      expect(failCall).toBeDefined();
    });
  });

  // =========================================================================
  // Token interpolation
  // =========================================================================

  describe("token interpolation", () => {
    it("{{recordId}} replaced with event recordId", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "update_record",
                  target: "guest",
                  defaults: { note: "Linked to {{recordId}}" },
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent({ recordId: "guest-abc" }));

      const updateCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("UPDATE")
      );
      expect(updateCall).toBeDefined();
      // The interpolated value should contain the actual recordId
      expect(updateCall![1]).toContain("Linked to guest-abc");
    });

    it("{{triggeredBy}} replaced with event triggeredBy", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "update_record",
                  target: "guest",
                  defaults: { assignee: "{{triggeredBy}}" },
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent({ triggeredBy: "admin@ab.org" }));

      const updateCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("UPDATE")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain("admin@ab.org");
    });

    it("unknown tokens replaced with empty string", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            makeWorkflowRow({
              actions: [
                {
                  type: "update_record",
                  target: "guest",
                  defaults: { note: "Hello {{unknownToken}}!" },
                },
              ],
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      const updateCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("UPDATE")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain("Hello !");
    });
  });

  // =========================================================================
  // Manual trigger
  // =========================================================================

  describe("manual trigger", () => {
    it("executeManualWorkflow executes a manual-type workflow", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            id: "wf-manual",
            name: "Manual Report",
            trigger: { type: "manual" },
            actions: [{ type: "notify", recipients: ["admin"], templateName: "report" }],
          }),
        ],
        rowCount: 1,
      });

      const { executeManualWorkflow } = await import("./engine");
      await executeManualWorkflow("wf-manual", { reason: "test" }, "admin@ab.org");

      // createDomainEvent should have been called for the synthetic event
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "workflow.manual_trigger",
          domain: "workflow",
          triggeredBy: "admin@ab.org",
        })
      );

      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const executingCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Executing workflow")
      );
      expect(executingCall).toBeDefined();
    });

    it("executeManualWorkflow rejects non-manual workflows", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            id: "wf-auto",
            name: "Auto Workflow",
            trigger: { type: "domain_event", event: "guest.created" },
          }),
        ],
        rowCount: 1,
      });

      const { executeManualWorkflow } = await import("./engine");
      await expect(
        executeManualWorkflow("wf-auto", {}, "admin@ab.org")
      ).rejects.toThrow("not a manual trigger");
    });

    it("executeManualWorkflow rejects unknown workflow id", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const { executeManualWorkflow } = await import("./engine");
      await expect(
        executeManualWorkflow("wf-nonexistent", {}, "admin@ab.org")
      ).rejects.toThrow("not found");
    });
  });

  // =========================================================================
  // sync_calendar action
  // =========================================================================

  describe("sync_calendar action", () => {
    it("emits calendar.sync_requested event with record data", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "sync_calendar",
                defaults: {
                  name: "Guest Panel",
                  startTime: "2026-04-10T09:00:00Z",
                  endTime: "2026-04-10T10:00:00Z",
                  venue: "Main Hall",
                },
              },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "calendar.sync_requested",
          domain: "calendar",
          action: "created",
        })
      );

      const calendarCall = mockCreateDomainEvent.mock.calls.find(
        (c) => c[0].eventName === "calendar.sync_requested"
      );
      expect(calendarCall).toBeDefined();
      expect(calendarCall![0].newValues).toEqual(
        expect.objectContaining({
          name: "Guest Panel",
          startTime: "2026-04-10T09:00:00Z",
          endTime: "2026-04-10T10:00:00Z",
          venue: "Main Hall",
        })
      );
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // generate_doc action
  // =========================================================================

  describe("generate_doc action", () => {
    it("emits document.generation_requested event", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "generate_doc",
                templateName: "guest_contract",
                defaults: {
                  outputFormat: "pdf",
                  templateName: "guest_contract",
                },
              },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "document.generation_requested",
          domain: "document",
          action: "created",
        })
      );

      const docCall = mockCreateDomainEvent.mock.calls.find(
        (c) => c[0].eventName === "document.generation_requested"
      );
      expect(docCall).toBeDefined();
      expect(docCall![0].newValues).toEqual(
        expect.objectContaining({
          templateName: "guest_contract",
          outputFormat: "pdf",
          recordId: "rec-123",
        })
      );
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // call_api edge cases
  // =========================================================================

  describe("call_api edge cases", () => {
    it("call_api does not fail workflow on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
      });

      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "call_api",
                defaults: { url: "https://api.example.com/fail", method: "GET" },
              },
              { type: "notify", recipients: ["admin"], templateName: "test" },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await expect(handler(makeEvent())).resolves.toBeUndefined();

      // The notify action after call_api should still run
      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const notifyCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Notification triggered")
      );
      expect(notifyCall).toBeDefined();
    });

    it("call_api does not fail workflow on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network unreachable"));

      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "call_api",
                defaults: { url: "https://api.example.com/down", method: "POST", body: "{}" },
              },
              { type: "notify", recipients: ["admin"], templateName: "test" },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await expect(handler(makeEvent())).resolves.toBeUndefined();

      // Subsequent action should still execute
      const logger = await import("firebase-functions/logger");
      const infoCalls = vi.mocked(logger.info).mock.calls;
      const notifyCall = infoCalls.find(
        (c) => typeof c[0] === "string" && c[0].includes("Notification triggered")
      );
      expect(notifyCall).toBeDefined();
    });

    it("call_api defaults to GET when no method specified", async () => {
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      mockQuery.mockResolvedValue({
        rows: [
          makeWorkflowRow({
            actions: [
              {
                type: "call_api",
                defaults: { url: "https://api.example.com/status" },
              },
            ],
          }),
        ],
        rowCount: 1,
      });

      const { registerWorkflowEngine } = await import("./engine");
      registerWorkflowEngine();

      const handler = mockSubscribe.mock.calls[0][1] as (e: DomainEvent) => Promise<void>;
      await handler(makeEvent());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/status",
        expect.objectContaining({ method: "GET" })
      );
    });
  });
});
