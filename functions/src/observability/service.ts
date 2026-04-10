/**
 * Data Observability Service
 *
 * Monitors data flow health across the platform. Records time-series metrics
 * for pipeline health, data freshness, flow throughput, and error counts.
 * Checks alert thresholds and creates admin_alerts when thresholds are breached.
 *
 * All metrics are stored in the observability_metrics table with JSONB values
 * for type-specific data.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";

// --- Types ---

export type MetricType = "pipeline_health" | "data_freshness" | "flow_throughput" | "error_count";

export interface ObservabilityMetric {
  readonly id: string;
  readonly metric_type: MetricType;
  readonly source_type: string;
  readonly source_id: string | null;
  readonly value: Readonly<Record<string, unknown>>;
  readonly recorded_at: string;
}

export interface PipelineHealthSummary {
  readonly pipeline_id: string;
  readonly total_executions: number;
  readonly successful: number;
  readonly failed: number;
  readonly partial: number;
  readonly avg_duration_ms: number;
  readonly last_execution_at: string | null;
  readonly last_status: string | null;
}

export interface FreshnessResult {
  readonly concept_key: string;
  readonly last_updated_at: string | null;
  readonly age_minutes: number;
  readonly status: "fresh" | "aging" | "stale" | "critical";
}

export interface ErrorSummary {
  readonly total_errors: number;
  readonly errors_by_source: Readonly<Record<string, number>>;
  readonly recent_errors: ReadonlyArray<{
    readonly source: string;
    readonly message: string;
    readonly occurred_at: string;
  }>;
}

export interface AlertThreshold {
  readonly metric_type: MetricType;
  readonly source_type: string;
  readonly source_id: string | null;
  readonly operator: "gt" | "lt" | "eq" | "gte" | "lte";
  readonly threshold_value: number;
  readonly severity: "critical" | "warning" | "info";
}

// --- Metric recording ---

/**
 * Records an observability metric.
 */
export async function recordMetric(
  metricType: MetricType,
  sourceType: string,
  sourceId: string | null,
  value: Readonly<Record<string, unknown>>
): Promise<ObservabilityMetric> {
  const result = await query<{
    id: string;
    metric_type: string;
    source_type: string;
    source_id: string;
    value: Record<string, unknown>;
    recorded_at: string;
  }>(
    `INSERT INTO observability_metrics (metric_type, source_type, source_id, value)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [metricType, sourceType, sourceId, JSON.stringify(value)]
  );

  return result.rows[0] as unknown as ObservabilityMetric;
}

// --- Pipeline health ---

/**
 * Returns pipeline health statistics. If pipelineId is provided, returns
 * stats for that specific pipeline. Otherwise, returns stats for all pipelines.
 */
export async function getPipelineHealth(
  pipelineId?: string
): Promise<ReadonlyArray<PipelineHealthSummary>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (pipelineId) {
    conditions.push("pipeline_id = $1");
    params.push(pipelineId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT
       pipeline_id,
       count(*)::int AS total_executions,
       count(*) FILTER (WHERE status = 'completed')::int AS successful,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'partial')::int AS partial,
       coalesce(avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int, 0) AS avg_duration_ms,
       max(started_at) AS last_execution_at,
       (array_agg(status ORDER BY started_at DESC))[1] AS last_status
     FROM pipeline_executions
     ${whereClause}
     GROUP BY pipeline_id`,
    params
  );

  return result.rows as unknown as ReadonlyArray<PipelineHealthSummary>;
}

// --- Data freshness ---

/**
 * Computes data freshness for concepts. Uses the observability_metrics table
 * for stored freshness data, with configurable thresholds.
 *
 * Freshness statuses:
 *   fresh:    < 60 minutes
 *   aging:    60-360 minutes
 *   stale:    360-1440 minutes
 *   critical: > 1440 minutes
 */
export async function getDataFreshness(
  conceptKey?: string
): Promise<ReadonlyArray<FreshnessResult>> {
  const conditions: string[] = [
    "metric_type = 'data_freshness'"
  ];
  const params: unknown[] = [];

  if (conceptKey) {
    conditions.push(`source_id = $${params.length + 1}::text::uuid`);
    params.push(conceptKey);
  }

  // Get latest freshness metric per concept from observability_metrics
  const result = await query(
    `SELECT DISTINCT ON (source_type)
       source_type,
       value,
       recorded_at
     FROM observability_metrics
     WHERE ${conditions.join(" AND ")}
     ORDER BY source_type, recorded_at DESC`,
    params
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const value = r.value as Record<string, unknown>;
    const lastUpdatedAt = (value.last_updated_at as string) ?? null;
    const ageMinutes = Number(value.age_minutes ?? 0);

    return {
      concept_key: r.source_type as string,
      last_updated_at: lastUpdatedAt,
      age_minutes: ageMinutes,
      status: classifyFreshness(ageMinutes),
    };
  });
}

/**
 * Classifies freshness based on age in minutes.
 */
export function classifyFreshness(ageMinutes: number): "fresh" | "aging" | "stale" | "critical" {
  if (ageMinutes < 60) return "fresh";
  if (ageMinutes < 360) return "aging";
  if (ageMinutes < 1440) return "stale";
  return "critical";
}

// --- Error summary ---

/**
 * Returns aggregated error summary for the specified time window.
 */
export async function getErrorSummary(hours: number): Promise<ErrorSummary> {
  // Get pipeline execution errors
  const pipelineErrors = await query(
    `SELECT
       'pipeline' AS source,
       errors,
       started_at AS occurred_at
     FROM pipeline_executions
     WHERE status IN ('failed', 'partial')
       AND started_at > now() - make_interval(hours => $1)
     ORDER BY started_at DESC
     LIMIT 100`,
    [hours]
  );

  // Get quality violation errors
  const qualityErrors = await query(
    `SELECT
       'quality' AS source,
       message,
       created_at AS occurred_at
     FROM quality_violations
     WHERE severity = 'error'
       AND created_at > now() - make_interval(hours => $1)
     ORDER BY created_at DESC
     LIMIT 100`,
    [hours]
  );

  const errorsBySource: Record<string, number> = {};
  const recentErrors: Array<{
    source: string;
    message: string;
    occurred_at: string;
  }> = [];

  // Process pipeline errors
  for (const row of pipelineErrors.rows) {
    const r = row as Record<string, unknown>;
    const errors = (r.errors as Array<{ stage_name: string; error: string }>) ?? [];
    const source = "pipeline";
    errorsBySource[source] = (errorsBySource[source] ?? 0) + errors.length;

    for (const err of errors) {
      recentErrors.push({
        source,
        message: `${err.stage_name}: ${err.error}`,
        occurred_at: r.occurred_at as string,
      });
    }
  }

  // Process quality errors
  for (const row of qualityErrors.rows) {
    const r = row as Record<string, unknown>;
    const source = "quality";
    errorsBySource[source] = (errorsBySource[source] ?? 0) + 1;

    recentErrors.push({
      source,
      message: r.message as string,
      occurred_at: r.occurred_at as string,
    });
  }

  const totalErrors = Object.values(errorsBySource).reduce((sum, count) => sum + count, 0);

  return {
    total_errors: totalErrors,
    errors_by_source: errorsBySource,
    recent_errors: recentErrors.slice(0, 20),
  };
}

// --- Alert threshold checking ---

/**
 * Checks observability metrics against configured thresholds.
 * When a threshold is breached, creates an admin_alert and emits
 * an observability.alert.triggered event.
 */
export async function checkAlertThresholds(
  thresholds: ReadonlyArray<AlertThreshold>
): Promise<ReadonlyArray<{ threshold: AlertThreshold; triggered: boolean; currentValue: number }>> {
  const results: Array<{ threshold: AlertThreshold; triggered: boolean; currentValue: number }> = [];

  for (const threshold of thresholds) {
    try {
      // Get the latest metric value for this source
      const metricResult = await query(
        `SELECT value FROM observability_metrics
         WHERE metric_type = $1
           AND source_type = $2
           AND ($3::uuid IS NULL OR source_id = $3)
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [threshold.metric_type, threshold.source_type, threshold.source_id]
      );

      if (metricResult.rows.length === 0) {
        results.push({ threshold, triggered: false, currentValue: 0 });
        continue;
      }

      const value = (metricResult.rows[0] as Record<string, unknown>).value as Record<string, unknown>;
      const currentValue = Number(value.value ?? value.count ?? value.age_minutes ?? 0);

      const triggered = evaluateThreshold(currentValue, threshold.operator, threshold.threshold_value);

      if (triggered) {
        // Create admin alert
        await query(
          `INSERT INTO admin_alerts (category, severity, title, message, metadata)
           VALUES ('observability', $1, $2, $3, $4)`,
          [
            threshold.severity,
            `${threshold.metric_type} alert`,
            `${threshold.metric_type} for ${threshold.source_type} breached threshold (current: ${currentValue}, threshold: ${threshold.threshold_value})`,
            JSON.stringify({
              metric_type: threshold.metric_type,
              source_type: threshold.source_type,
              source_id: threshold.source_id,
              current_value: currentValue,
              threshold_value: threshold.threshold_value,
            }),
          ]
        );

        // Emit alert event
        const event = createDomainEvent({
          eventName: "observability.alert.triggered",
          domain: "observability",
          action: "created",
          recordId: threshold.source_id ?? "system",
          newValues: {
            metric_type: threshold.metric_type,
            source_type: threshold.source_type,
            current_value: currentValue,
            threshold_value: threshold.threshold_value,
            severity: threshold.severity,
          },
          triggeredBy: "system",
        });
        await emit(event);
      }

      results.push({ threshold, triggered, currentValue });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Alert threshold check failed", { error: message, threshold });
      results.push({ threshold, triggered: false, currentValue: 0 });
    }
  }

  return results;
}

// --- Helpers ---

function evaluateThreshold(
  value: number,
  operator: AlertThreshold["operator"],
  threshold: number
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "eq":
      return value === threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}
