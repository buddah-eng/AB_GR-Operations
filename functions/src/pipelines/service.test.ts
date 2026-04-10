/**
 * Tests for Internal Pipeline Service
 *
 * Covers:
 * - registerPipelineEngine subscribes at priority 550
 * - Pipeline execution runs stages in order
 * - fail_fast stops on first error
 * - continue mode proceeds past errors
 * - retry_then_skip retries and then continues
 * - Execution tracking records correct counts
 * - Quality check halt stops pipeline
 * - Gate condition halt stops pipeline
 * - CRUD: listPipelines, createPipeline, deletePipeline
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

const mockSubscribe = vi.fn();
const mockEmit = vi.fn().mockResolvedValue(undefined);
const mockCreateDomainEvent = vi.fn().mockImplementation((input: Record<string, unknown>) => ({
  eventId: "evt-pipe-1",
  eventName: input.eventName,
  domain: input.domain,
  action: input.action,
  recordId: input.recordId,
  triggeredBy: input.triggeredBy,
  timestamp: "2026-04-08T12:00:00Z",
}));
const mockMatchesPattern = vi.fn((pattern: string, eventName: string) => {
  if (pattern === "*") return true;
  return pattern === eventName;
});

vi.mock("../events/bus", () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(args[0] as Record<string, unknown>),
  matchesPattern: (...args: unknown[]) => mockMatchesPattern(args[0] as string, args[1] as string),
}));

const mockGetRouteById = vi.fn();
const mockExecuteRoute = vi.fn();
vi.mock("../data-routing/service", () => ({
  getRouteById: (...args: unknown[]) => mockGetRouteById(...args),
  executeRoute: (...args: unknown[]) => mockExecuteRoute(...args),
}));

vi.mock("../data-routing/transforms", () => ({
  executeTransformChain: vi.fn((_chain: unknown[], record: Record<string, unknown>) => ({
    record: { ...record, transformed: true },
    steps: [],
  })),
}));

vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: vi.fn((expr: { type: string; field?: string; value?: unknown }, ctx: Record<string, unknown>) => {
    if (expr.type === "field" && expr.field) {
      return ctx[expr.field] === expr.value;
    }
    return true;
  }),
}));

// --- Import module under test ---

import {
  registerPipelineEngine,
  executePipeline,
  listPipelines,
  createPipeline,
  deletePipeline,
} from "./service";
import type { Pipeline } from "./service";

// --- Fixtures ---

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pipe-1",
    name: "Test Pipeline",
    description: "A test pipeline",
    trigger_type: "manual",
    trigger_config: {},
    stages: [
      { type: "quality_check", name: "check_fields", check_type: "not_empty", config: {}, on_failure: "warn" },
      { type: "transform", name: "add_metadata", transform_chain: [{ type: "static", config: { fields: { processed: true } } }] },
    ],
    error_strategy: "continue",
    status: "active",
    owner_scope: "org",
    owner_department: null,
    created_at: "2026-04-08T00:00:00Z",
    updated_at: "2026-04-08T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// registerPipelineEngine
// ============================================================

describe("registerPipelineEngine", () => {
  it("subscribes to event bus at priority 550", () => {
    registerPipelineEngine();

    expect(mockSubscribe).toHaveBeenCalledWith("*", expect.any(Function), 550);
  });
});

// ============================================================
// executePipeline - stages run in order
// ============================================================

describe("executePipeline - stage execution order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes all stages in order and tracks completion", async () => {
    const pipeline = makePipeline();

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-1", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executePipeline("pipe-1");

    expect(result.status).toBe("completed");
    expect(result.stages_completed).toBe(2);
    expect(result.stages_total).toBe(2);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================
// executePipeline - fail_fast stops on error
// ============================================================

describe("executePipeline - fail_fast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops execution on first stage error", async () => {
    const pipeline = makePipeline({
      error_strategy: "fail_fast",
      stages: [
        { type: "quality_check", name: "failing_check", check_type: "field_present", config: { fields: ["missing_field"] }, on_failure: "halt" },
        { type: "transform", name: "should_not_run", transform_chain: [] },
      ],
    });

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-2", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executePipeline("pipe-1");

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stages_completed).toBe(0);
  });
});

// ============================================================
// executePipeline - continue mode
// ============================================================

describe("executePipeline - continue mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues past stage errors and marks as partial", async () => {
    const pipeline = makePipeline({
      error_strategy: "continue",
      stages: [
        { type: "quality_check", name: "failing_check", check_type: "field_present", config: { fields: ["missing_field"] }, on_failure: "halt" },
        { type: "transform", name: "still_runs", transform_chain: [{ type: "static", config: { fields: { added: true } } }] },
      ],
    });

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-3", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executePipeline("pipe-1");

    expect(result.status).toBe("partial");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stages_completed).toBeGreaterThan(0);
  });
});

// ============================================================
// executePipeline - retry_then_skip
// ============================================================

describe("executePipeline - retry_then_skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries failed stage and skips if retry also fails", async () => {
    const pipeline = makePipeline({
      error_strategy: "retry_then_skip",
      stages: [
        { type: "quality_check", name: "failing_check", check_type: "field_present", config: { fields: ["missing_field"] }, on_failure: "halt" },
        { type: "transform", name: "runs_after_skip", transform_chain: [] },
      ],
    });

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-4", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executePipeline("pipe-1");

    // Should not be "failed" since retry_then_skip skips and continues
    expect(result.errors.length).toBeGreaterThan(0);
    // Second stage should have still run
    expect(result.stages_completed).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// executePipeline - records processed count
// ============================================================

describe("executePipeline - execution tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records correct records_processed count", async () => {
    const pipeline = makePipeline({
      stages: [
        { type: "transform", name: "step1", transform_chain: [{ type: "static", config: { fields: { a: 1 } } }] },
        { type: "transform", name: "step2", transform_chain: [{ type: "static", config: { fields: { b: 2 } } }] },
      ],
    });

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-5", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executePipeline("pipe-1");

    expect(result.records_processed).toBe(2);
    expect(result.stages_completed).toBe(2);
  });
});

// ============================================================
// executePipeline - pipeline not found
// ============================================================

describe("executePipeline - pipeline not found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when pipeline does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(executePipeline("pipe-missing")).rejects.toThrow("Pipeline not found");
  });
});

// ============================================================
// executePipeline - inactive pipeline
// ============================================================

describe("executePipeline - inactive pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when pipeline is not active", async () => {
    const pipeline = makePipeline({ status: "draft" });
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });

    await expect(executePipeline("pipe-1")).rejects.toThrow("not active");
  });
});

// ============================================================
// executePipeline - gate halt
// ============================================================

describe("executePipeline - gate stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("halts pipeline when gate condition fails with on_failure=halt", async () => {
    const pipeline = makePipeline({
      error_strategy: "fail_fast",
      stages: [
        {
          type: "gate",
          name: "check_type",
          condition: { type: "field", field: "type", operator: "eq", value: "JP" },
          on_failure: "halt",
        },
        { type: "transform", name: "should_not_run", transform_chain: [] },
      ],
    });

    // getPipelineById
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });
    // INSERT execution
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "exec-6", started_at: "2026-04-08T12:00:00Z" }],
    });
    // UPDATE execution
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // trigger event has type "EN" so gate will fail
    const result = await executePipeline("pipe-1", {
      eventId: "evt-1",
      eventName: "guest.updated",
      domain: "guest",
      action: "updated",
      recordId: "rec-1",
      triggeredBy: "admin@example.com",
      timestamp: "2026-04-08T12:00:00Z",
      newValues: { type: "EN" },
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage_name).toBe("check_type");
  });
});

// ============================================================
// CRUD: listPipelines
// ============================================================

describe("listPipelines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all pipelines when no filter is provided", async () => {
    const pipelines = [makePipeline()];
    mockQuery.mockResolvedValueOnce({ rows: pipelines });

    const result = await listPipelines();

    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT * FROM data_pipelines"),
      []
    );
  });

  it("filters by status when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listPipelines("active");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = $1"),
      ["active"]
    );
  });
});

// ============================================================
// CRUD: createPipeline
// ============================================================

describe("createPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts pipeline and returns it", async () => {
    const pipeline = makePipeline();
    mockQuery.mockResolvedValueOnce({ rows: [pipeline] });

    const result = await createPipeline({
      name: "Test Pipeline",
      description: "A test",
      trigger_type: "manual",
      trigger_config: {},
      stages: [],
      error_strategy: "continue",
      status: "draft",
      owner_scope: "org",
      owner_department: null,
    });

    expect(result.id).toBe("pipe-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO data_pipelines"),
      expect.any(Array)
    );
  });
});

// ============================================================
// CRUD: deletePipeline
// ============================================================

describe("deletePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when pipeline is deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await deletePipeline("pipe-1");

    expect(result).toBe(true);
  });

  it("returns false when pipeline does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await deletePipeline("pipe-missing");

    expect(result).toBe(false);
  });
});
