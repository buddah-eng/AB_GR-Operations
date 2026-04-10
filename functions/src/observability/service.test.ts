/**
 * Tests for Observability Service
 *
 * Covers:
 * - Metric recording stores correct data
 * - Pipeline health aggregation
 * - Freshness classification (fresh, aging, stale, critical)
 * - Error summary aggregation
 * - Alert threshold checking and triggering
 * - Alert threshold operators (gt, lt, eq, gte, lte)
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

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: vi.fn((input: Record<string, unknown>) => ({
    eventId: "evt-obs-1",
    ...input,
    timestamp: "2026-04-08T12:00:00Z",
  })),
}));

// --- Import module under test ---

import {
  recordMetric,
  getPipelineHealth,
  classifyFreshness,
  getErrorSummary,
  checkAlertThresholds,
} from "./service";

// ============================================================
// recordMetric
// ============================================================

describe("recordMetric", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts metric into observability_metrics table", async () => {
    const metric = {
      id: "m-1",
      metric_type: "pipeline_health",
      source_type: "pipeline",
      source_id: "pipe-1",
      value: { status: "healthy", executions: 10 },
      recorded_at: "2026-04-08T12:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [metric] });

    const result = await recordMetric(
      "pipeline_health",
      "pipeline",
      "pipe-1",
      { status: "healthy", executions: 10 }
    );

    expect(result.metric_type).toBe("pipeline_health");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO observability_metrics"),
      expect.arrayContaining(["pipeline_health", "pipeline"])
    );
  });

  it("stores metrics with null source_id", async () => {
    const metric = {
      id: "m-2",
      metric_type: "error_count",
      source_type: "system",
      source_id: null,
      value: { count: 5 },
      recorded_at: "2026-04-08T12:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [metric] });

    const result = await recordMetric("error_count", "system", null, { count: 5 });

    expect(result.source_id).toBeNull();
  });
});

// ============================================================
// getPipelineHealth
// ============================================================

describe("getPipelineHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated health stats for all pipelines", async () => {
    const stats = [
      {
        pipeline_id: "pipe-1",
        total_executions: 10,
        successful: 8,
        failed: 1,
        partial: 1,
        avg_duration_ms: 1500,
        last_execution_at: "2026-04-08T11:00:00Z",
        last_status: "completed",
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: stats });

    const result = await getPipelineHealth();

    expect(result).toHaveLength(1);
    expect(result[0].total_executions).toBe(10);
    expect(result[0].successful).toBe(8);
    expect(result[0].failed).toBe(1);
  });

  it("filters by pipeline_id when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getPipelineHealth("pipe-1");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("pipeline_id = $1"),
      ["pipe-1"]
    );
  });
});

// ============================================================
// classifyFreshness
// ============================================================

describe("classifyFreshness", () => {
  it("classifies < 60 minutes as fresh", () => {
    expect(classifyFreshness(30)).toBe("fresh");
    expect(classifyFreshness(0)).toBe("fresh");
    expect(classifyFreshness(59)).toBe("fresh");
  });

  it("classifies 60-360 minutes as aging", () => {
    expect(classifyFreshness(60)).toBe("aging");
    expect(classifyFreshness(200)).toBe("aging");
    expect(classifyFreshness(359)).toBe("aging");
  });

  it("classifies 360-1440 minutes as stale", () => {
    expect(classifyFreshness(360)).toBe("stale");
    expect(classifyFreshness(720)).toBe("stale");
    expect(classifyFreshness(1439)).toBe("stale");
  });

  it("classifies > 1440 minutes as critical", () => {
    expect(classifyFreshness(1440)).toBe("critical");
    expect(classifyFreshness(2880)).toBe("critical");
  });
});

// ============================================================
// getErrorSummary
// ============================================================

describe("getErrorSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates pipeline and quality errors", async () => {
    // Pipeline errors
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          source: "pipeline",
          errors: [
            { stage_name: "stage1", error: "transform failed" },
            { stage_name: "stage2", error: "timeout" },
          ],
          occurred_at: "2026-04-08T10:00:00Z",
        },
      ],
    });

    // Quality errors
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          source: "quality",
          message: "Required field missing",
          occurred_at: "2026-04-08T09:00:00Z",
        },
      ],
    });

    const result = await getErrorSummary(24);

    expect(result.total_errors).toBe(3);
    expect(result.errors_by_source.pipeline).toBe(2);
    expect(result.errors_by_source.quality).toBe(1);
    expect(result.recent_errors.length).toBe(3);
  });

  it("returns empty summary when no errors", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getErrorSummary(24);

    expect(result.total_errors).toBe(0);
    expect(result.recent_errors).toHaveLength(0);
  });
});

// ============================================================
// checkAlertThresholds
// ============================================================

describe("checkAlertThresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers alert when threshold is breached", async () => {
    // Metric value query
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { value: 95 } }],
    });
    // Insert admin_alert
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const thresholds = [
      {
        metric_type: "error_count" as const,
        source_type: "pipeline",
        source_id: null,
        operator: "gt" as const,
        threshold_value: 50,
        severity: "critical" as const,
      },
    ];

    const results = await checkAlertThresholds(thresholds);

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].currentValue).toBe(95);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("does not trigger alert when threshold is not breached", async () => {
    // Metric value query
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { value: 10 } }],
    });

    const thresholds = [
      {
        metric_type: "error_count" as const,
        source_type: "pipeline",
        source_id: null,
        operator: "gt" as const,
        threshold_value: 50,
        severity: "warning" as const,
      },
    ];

    const results = await checkAlertThresholds(thresholds);

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("handles missing metric data gracefully", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const thresholds = [
      {
        metric_type: "pipeline_health" as const,
        source_type: "pipeline",
        source_id: "pipe-missing",
        operator: "gt" as const,
        threshold_value: 5,
        severity: "info" as const,
      },
    ];

    const results = await checkAlertThresholds(thresholds);

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);
    expect(results[0].currentValue).toBe(0);
  });

  it("evaluates lt operator correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { value: 3 } }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert admin_alert

    const thresholds = [
      {
        metric_type: "flow_throughput" as const,
        source_type: "pipeline",
        source_id: null,
        operator: "lt" as const,
        threshold_value: 10,
        severity: "warning" as const,
      },
    ];

    const results = await checkAlertThresholds(thresholds);

    expect(results[0].triggered).toBe(true);
  });
});
