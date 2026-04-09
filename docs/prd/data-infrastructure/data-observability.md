# Data Observability

> Monitor data flow health across the platform. Pipeline health (running, success/failure, records processed).
> Data freshness per concept and per field. Flow throughput with trend analysis. Aggregated error tracking.
> Configurable alerting on freshness, error rate, and throughput thresholds. Dashboard data structured for
> frontend rendering. Health check API for external monitoring.

---

## Overview

The platform processes data through multiple pathways: form submissions, API imports, workflow actions, data routes, scheduled jobs, external sync pipelines, and YoY registry pre-population. When any of these pathways fails, stalls, or degrades, convention operations are affected. A stale guest list means wrong headcounts. A failed transport sync means drivers get outdated schedules. A broken workflow means notifications never go out.

Data observability is the monitoring layer that watches all of these pathways and answers: Is data flowing? Is it fresh? Is it correct? Are there errors? It does not fix problems -- it detects them, measures them, and alerts the right people.

This system aggregates signals from existing platform components (event bus, audit system, quality violations, pipeline execution logs) into a unified observability layer with time-series metrics, configurable alerts, and structured dashboard data.

**Phase:** Depends on event bus, audit system, data quality (quality violations feed into error tracking), admin_alerts (alert destination). Produces data for admin dashboard rendering. No downstream blockers -- this is a monitoring layer.

---

## Full Specification

### 1. Pipeline Health

#### Purpose

Track whether each data pipeline (workflow, route, sync job, import) is running on schedule, succeeding, and processing the expected volume.

#### Detail

A "pipeline" in this context is any automated data processing pathway:

| Pipeline Type | Source of Health Data | Example |
|---------------|---------------------|---------|
| Scheduled workflow | `event_log` entries for the workflow trigger event | Nightly overdue task check |
| Data route | Route execution log (from data routing) | Guest -> Transport Briefing sync |
| External sync | `event_log` entries with `external_*` action types | Calendar integration sync |
| Import job | `event_log` entries with `intake_received` actions | Bulk guest import |
| Quality sweep | `event_log` entries for `quality.sweep.completed` | Nightly quality audit |
| Retention job | `event_log` entries for `security.retention.completed` | Annual PII anonymization |
| Backup job | Cloud Function execution logs | Nightly pg_dump snapshot |

**Pipeline health record:** Tracks per pipeline: `pipelineId`, `pipelineType` (workflow/route/sync/import/quality_sweep/retention/backup), `name`, `expectedSchedule` (cron), `lastRunAt`, `lastRunStatus` (success/partial_failure/failure/never_run), `lastRunDurationMs`, `lastRunRecordsProcessed`, `lastRunErrorCount`, `consecutiveFailures`, `isOverdue`.

**Pipeline registry table:**

```sql
CREATE TABLE pipeline_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_type       TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  source_config_id    UUID,                   -- FK to workflow_configs, route_configs, etc.
  expected_schedule   TEXT,                    -- cron expression
  max_duration_ms     INTEGER DEFAULT 300000, -- alert if execution exceeds this (5 min default)
  enabled             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_registry_type ON pipeline_registry (pipeline_type) WHERE enabled = true;
```

**Pipeline execution tracking:** Derived from `event_log` entries (`*.completed`, `*.synced`, `quality.sweep.completed`, `security.retention.completed`). The engine queries the most recent matching event per pipeline and computes health metrics.

**Auto-registration:** Scheduled workflows and routes are automatically registered in `pipeline_registry` on creation. Manual pipelines can be registered by admins.

#### Acceptance Criteria

- [ ] All seven pipeline types are trackable
- [ ] `pipeline_registry` table exists with all columns
- [ ] Auto-registration creates entries for new scheduled workflows and routes
- [ ] `lastRunAt` is accurate within 1 minute of actual execution
- [ ] `isOverdue` is computed based on `expected_schedule` and `lastRunAt`
- [ ] `consecutiveFailures` increments on failure and resets on success

---

### 2. Data Freshness

#### Purpose

Track how recently each concept's data was updated, per concept and per field, and alert when data goes stale.

#### Detail

**Freshness metrics:**

```ts
interface FreshnessMetric {
  readonly conceptKey: string
  readonly fieldKey: string | null         // null for concept-level freshness
  readonly lastUpdatedAt: string           // ISO 8601
  readonly ageMinutes: number              // minutes since last update
  readonly freshnessStatus: 'fresh' | 'aging' | 'stale' | 'critical'
  readonly thresholdMinutes: {
    readonly aging: number                 // default: 60
    readonly stale: number                 // default: 360 (6 hours)
    readonly critical: number              // default: 1440 (24 hours)
  }
}
```

**Freshness computation:**

Concept-level freshness is the most recent `updated_at` across all active records for that concept:

```sql
SELECT concept_key,
       max(updated_at) AS last_updated_at,
       EXTRACT(EPOCH FROM (now() - max(updated_at))) / 60 AS age_minutes
FROM domain_data
WHERE archived = false
GROUP BY concept_key;
```

Field-level freshness is computed from the audit log -- the most recent audit entry that changed a specific field:

```sql
SELECT
  table_name AS concept_key,
  jsonb_object_keys(new_data) AS field_key,
  max(created_at) AS last_updated_at
FROM domain_audit_log
WHERE action = 'UPDATE'
  AND created_at > now() - INTERVAL '30 days'
GROUP BY table_name, jsonb_object_keys(new_data);
```

**Freshness thresholds:**

Configurable per concept via a `freshness_thresholds` table:

```sql
CREATE TABLE freshness_thresholds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key     TEXT NOT NULL,
  field_key       TEXT,                          -- null for concept-level threshold
  aging_minutes   INTEGER NOT NULL DEFAULT 60,
  stale_minutes   INTEGER NOT NULL DEFAULT 360,
  critical_minutes INTEGER NOT NULL DEFAULT 1440,
  UNIQUE (concept_key, field_key)
);
```

**Status classification:**

| Status | Meaning | Visual Indicator |
|--------|---------|------------------|
| `fresh` | Updated within `aging_minutes` | Green |
| `aging` | Between `aging_minutes` and `stale_minutes` | Yellow |
| `stale` | Between `stale_minutes` and `critical_minutes` | Orange |
| `critical` | Older than `critical_minutes` | Red |

#### Acceptance Criteria

- [ ] Concept-level freshness is computed from the most recent record update
- [ ] Field-level freshness is computed from audit log entries
- [ ] Freshness thresholds are configurable per concept and per field
- [ ] Status classification (fresh/aging/stale/critical) is correct
- [ ] Freshness queries execute in < 2 seconds for concepts with up to 10k records

---

### 3. Flow Throughput

#### Purpose

Track records processed per pipeline per time period, with trend analysis for capacity planning.

#### Detail

**Throughput metrics:** Per pipeline per period: `recordsProcessed`, `recordsSucceeded`, `recordsFailed`, `averageDurationMs`. Periods: `hour`, `day`, `week`.

**Throughput storage:**

```sql
CREATE TABLE observability_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type     TEXT NOT NULL CHECK (metric_type IN (
                    'throughput', 'freshness', 'error_rate', 'pipeline_duration', 'quality_score'
                  )),
  source_id       TEXT NOT NULL,               -- pipeline_id, concept_key, etc.
  source_type     TEXT NOT NULL,               -- 'pipeline', 'concept', 'field'
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  value           NUMERIC NOT NULL,
  metadata        JSONB,                       -- type-specific details
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_metrics_source ON observability_metrics (source_type, source_id, period_start);
CREATE INDEX idx_metrics_type ON observability_metrics (metric_type, period_start);
```

**Throughput aggregation:** Hourly scheduled job counts events per pipeline, inserts `throughput` metric rows, computes daily/weekly rollups.

**Trend analysis:** Compares current period to rolling 7-period average. Classification: `increasing` (> 1.2x avg), `decreasing` (< 0.8x avg), `anomalous` (> avg + 2 stddev OR < avg - 2 stddev), `stable` (otherwise).

#### Acceptance Criteria

- [ ] `observability_metrics` table exists with all columns and constraints
- [ ] Throughput metrics are aggregated hourly from event log data
- [ ] Daily and weekly rollups are computed from hourly metrics
- [ ] Trend analysis correctly classifies increasing/stable/decreasing/anomalous
- [ ] Anomaly detection uses rolling 7-period average with 2 standard deviations

---

### 4. Error Tracking

#### Purpose

Aggregate errors from all data processing pathways into a unified dashboard.

#### Detail

**Error sources:**

| Source | Error Type | Detection |
|--------|-----------|-----------|
| Pipeline execution | Pipeline failure, partial failure | Event log entries with `success: false` in `actions_executed` |
| Data routing | Transform errors, destination unreachable | Route execution log entries with error status |
| Quality violations | Error-severity violations | `quality_violations` with `severity = 'error'` and `status = 'open'` |
| Breach detection | Security alerts | `admin_alerts` with `category = 'breach_detection'` |
| Rogue actor | Unauthorized access | `admin_alerts` with `category = 'rogue_actor'` |
| Retention failures | Anonymization errors | Retention job log entries with errors |

**Aggregated error view:** `ErrorSummary` includes: `totalErrors`, `errorsBySource` (counts per source), `errorsByCategory`, `errorTrend` (increasing/stable/decreasing), and `topErrors` (ranked by count with source, category, last occurrence, and sample message).

**Error rate metric:** Stored in `observability_metrics` with `metric_type = 'error_rate'`. Computed hourly per pipeline as `failed_count / total_count`. Metadata JSONB includes raw `total` and `failed` counts.

#### Acceptance Criteria

- [ ] Errors from all six sources are aggregated
- [ ] Error summary includes counts by source and category
- [ ] Error trend is computed from hourly metrics
- [ ] Top errors list shows the most frequent errors with sample messages
- [ ] Error rate is computed as failed/total for each pipeline per period

---

### 5. Alerting

#### Purpose

Configurable alerts on freshness, error rate, throughput, and pipeline health thresholds.

#### Detail

**Alert configuration:**

```sql
CREATE TABLE observability_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  alert_type        TEXT NOT NULL CHECK (alert_type IN (
                      'freshness', 'error_rate', 'throughput', 'pipeline_health', 'quality_score'
                    )),
  source_type       TEXT NOT NULL,                -- 'pipeline', 'concept', 'field'
  source_id         TEXT NOT NULL,                -- pipeline_id, concept_key, etc.
  condition         JSONB NOT NULL,               -- type-specific threshold condition
  severity          TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
  notification_roles TEXT[] NOT NULL,             -- roles to notify
  cooldown_minutes  INTEGER NOT NULL DEFAULT 60,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_obs_alerts_type ON observability_alerts (alert_type) WHERE enabled = true;
```

**Alert condition examples:** Freshness (concept data older than N minutes), error rate (pipeline error rate > threshold), throughput (pipeline below minimum records/period), pipeline health (overdue by N minutes), quality score (average below threshold). Each condition is type-specific JSONB.

**Alert evaluation:** Scheduled job runs every 5 minutes. Loads enabled alerts, evaluates conditions against current metrics, creates `admin_alerts` rows and fires `observability.alert.triggered` events when conditions are met (respecting cooldown). When conditions clear, fires `observability.alert.resolved` and updates the `admin_alerts` row with `resolved_at`.

#### Acceptance Criteria

- [ ] `observability_alerts` table exists with all columns and constraints
- [ ] All five alert types are evaluable
- [ ] Alert evaluation runs every 5 minutes
- [ ] Alerts create rows in `admin_alerts` with correct severity
- [ ] `observability.alert.triggered` and `observability.alert.resolved` events fire
- [ ] Cooldown prevents duplicate alerts within the window
- [ ] Alert resolution is detected and logged

---

### 6. Observability Dashboard Data

#### Purpose

Provide structured data for frontend dashboard rendering with widgets, charts, and status indicators.

#### Detail

The observability API returns data structured for rendering, not raw metrics. The frontend dashboard component receives pre-shaped data for each widget type.

**Dashboard endpoint:** `GET /api/admin/observability/dashboard`

**Response structure:** `ObservabilityDashboard` contains `generatedAt`, `summary` (counts for healthy/warning/critical pipelines, overall freshness status, open errors, active alerts), and `widgets` array. Each `DashboardWidget` has `id`, `type`, `title`, `data` (type-specific), and `refreshIntervalSeconds`.

**Widget types:** `status_grid` (pipeline health overview), `time_series` (throughput/error rate over time), `bar_chart` (errors by source, freshness by concept), `stat_card` (total records, average quality score), `alert_list` (active alerts with severity), `error_table` (top errors by count).

**Permission:** Requires `observability:read` permission. Concept-level data respects RBAC department scoping.

#### Acceptance Criteria

- [ ] Dashboard endpoint returns all widget types with correct data shapes
- [ ] Summary counts are accurate
- [ ] Widget refresh intervals are appropriate (status: 30s, charts: 60s, alerts: 15s)
- [ ] Dashboard data respects RBAC (department-scoped users see only their concepts)
- [ ] Dashboard endpoint requires `observability:read` permission

---

### 7. Health Check API

#### Purpose

Provide a health check endpoint for external monitoring services (uptime monitoring, load balancers).

#### Detail

**Endpoint:** `GET /api/health`

**No authentication required** (this is intentional -- health checks must work without credentials for load balancer probes and external uptime services).

**Response:**

```ts
interface HealthCheckResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy'
  readonly timestamp: string
  readonly version: string                     // application version
  readonly checks: {
    readonly database: { status: 'up' | 'down', latencyMs: number }
    readonly eventBus: { status: 'up' | 'down', subscriptionCount: number }
    readonly cache: { status: 'up' | 'down', hitRate: number | null }
    readonly pipelines: {
      readonly status: 'all_healthy' | 'some_degraded' | 'critical_down'
      readonly healthyCount: number
      readonly totalCount: number
    }
  }
}
```

**Status determination:**

| Overall Status | Condition |
|---------------|-----------|
| `healthy` | Database up, event bus up, all pipelines healthy |
| `degraded` | Database up, but cache down OR some pipelines degraded | 
| `unhealthy` | Database down OR critical pipeline down |

**Health check implementation:** Database (execute `SELECT 1`, measure latency), event bus (check `subscriptionCount() > 0`), cache (ping Redis, report hit rate), pipelines (query `pipeline_registry` for overdue or failing). Results cached for 10 seconds to prevent check storms.

#### Acceptance Criteria

- [ ] `/api/health` is accessible without authentication
- [ ] Response includes all four subsystem checks
- [ ] Database check measures actual query latency
- [ ] Status determination follows the documented rules
- [ ] Health check results are cached for 10 seconds
- [ ] Response time is < 500ms (health checks must be fast)

---

### 8. Integration with Admin Alerts

#### Purpose

Observability alerts create rows in the `admin_alerts` table for unified alert management.

#### Detail

When an observability alert triggers:

```sql
INSERT INTO admin_alerts (
  category, severity, title, message, metadata, created_at
) VALUES (
  'observability',
  :severity,
  :alert_name,
  :alert_description,
  jsonb_build_object(
    'alert_type', :alert_type,
    'source_type', :source_type,
    'source_id', :source_id,
    'current_value', :current_value,
    'threshold', :threshold
  ),
  now()
);
```

The `admin_alerts` table is shared across the platform (rogue actor alerts, quality alerts, security alerts, observability alerts). The `category` field distinguishes observability alerts from others.

#### Acceptance Criteria

- [ ] Observability alerts create `admin_alerts` rows with `category = 'observability'`
- [ ] Alert metadata includes enough context to diagnose the issue
- [ ] Resolved alerts update the corresponding `admin_alerts` row

---

### 9. Integration with Event Bus

#### Purpose

Observability events are published to the event bus for workflow consumption.

#### Detail

The observability system publishes the following events:

| Event | When | Payload |
|-------|------|---------|
| `observability.alert.triggered` | Alert condition met | `{ alertId, alertType, severity, sourceId, currentValue, threshold }` |
| `observability.alert.resolved` | Alert condition cleared | `{ alertId, alertType, sourceId }` |
| `observability.pipeline.failed` | Pipeline execution failed | `{ pipelineId, pipelineName, errorMessage, consecutiveFailures }` |
| `observability.pipeline.recovered` | Pipeline succeeds after consecutive failures | `{ pipelineId, pipelineName, previousFailureCount }` |
| `observability.freshness.critical` | Concept data reaches critical staleness | `{ conceptKey, ageMinutes, threshold }` |

These events enable workflows such as:
- "When a critical pipeline fails 3 times consecutively, page the on-call admin"
- "When guest data freshness reaches critical, notify the GR director"

#### Acceptance Criteria

- [ ] All five event types fire at the correct lifecycle points
- [ ] Event payloads contain enough context for workflow conditions
- [ ] Events are published via the standard `emit()` function
- [ ] Workflow subscriptions to `observability.*` patterns work correctly

---

## 10. Test Plan

### 10.1 Pipeline Health Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-01 | Integration | Register pipeline, execute successfully | `lastRunStatus = 'success'`, `consecutiveFailures = 0` |
| T-02 | Integration | Pipeline fails 3 times consecutively | `consecutiveFailures = 3`, `lastRunStatus = 'failure'` |
| T-03 | Integration | Pipeline succeeds after failures | `consecutiveFailures` resets to 0 |
| T-04 | Integration | Overdue detection: scheduled pipeline misses window | `isOverdue = true` |
| T-05 | Integration | Auto-registration for new scheduled workflow | `pipeline_registry` entry created |

### 10.2 Freshness Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-06 | Unit | Concept updated 30 minutes ago, threshold 60 | Status = `fresh` |
| T-07 | Unit | Concept updated 120 minutes ago, threshold 60/360 | Status = `aging` |
| T-08 | Unit | Concept updated 500 minutes ago, threshold 60/360/1440 | Status = `stale` |
| T-09 | Unit | Concept updated 1500 minutes ago, threshold 60/360/1440 | Status = `critical` |
| T-10 | Integration | Field-level freshness from audit log | Correct per-field timestamps |

### 10.3 Throughput Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-11 | Integration | Pipeline processes 50 records in 1 hour | Throughput metric = 50 |
| T-12 | Integration | Hourly metrics roll up to daily | Daily metric = sum of hourly |
| T-13 | Unit | Trend: current 50, avg 40 | Trend = `increasing` |
| T-14 | Unit | Trend: current 100, avg 40, stddev 10 | Trend = `anomalous` |
| T-15 | Unit | Trend: current 38, avg 40 | Trend = `stable` |

### 10.4 Error Tracking Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-16 | Integration | Pipeline failure + quality violation + rogue alert | Error summary counts all three |
| T-17 | Integration | Error trend computation | Correct trend classification |
| T-18 | Integration | Top errors ranked by count | Most frequent error first |

### 10.5 Alerting Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-19 | Integration | Freshness alert: concept goes stale | `admin_alerts` row created, event fired |
| T-20 | Integration | Error rate alert: rate exceeds threshold | Alert triggered |
| T-21 | Integration | Cooldown: alert re-triggers within window | No duplicate alert |
| T-22 | Integration | Alert resolution: condition clears | `observability.alert.resolved` event fired |
| T-23 | Integration | Throughput alert: pipeline below minimum | Alert triggered |

### 10.6 Dashboard Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-24 | Integration | Dashboard returns all widget types | All six widget types present |
| T-25 | Integration | Dashboard summary counts match reality | Counts verified against source data |
| T-26 | Integration | RBAC: department user sees only their concepts | Filtered results |
| T-27 | Integration | Dashboard without `observability:read` permission | 403 Forbidden |

### 10.7 Health Check Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-28 | Integration | All systems up | Status = `healthy` |
| T-29 | Integration | Database down | Status = `unhealthy` |
| T-30 | Integration | Cache down but database up | Status = `degraded` |
| T-31 | Integration | No authentication required | 200 response without auth header |
| T-32 | Integration | Response time < 500ms | Health check fast path verified |
| T-33 | Integration | Cached response within 10s window | Same response returned |

### 10.8 Event Integration Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-34 | Integration | Pipeline failure fires `observability.pipeline.failed` | Event in event_log |
| T-35 | Integration | Recovery fires `observability.pipeline.recovered` | Event in event_log |
| T-36 | Integration | Critical freshness fires `observability.freshness.critical` | Event in event_log |

### Coverage Target

80% minimum across pipeline health tracker, freshness computation, throughput aggregation, alert evaluation, and dashboard data generation. Health check endpoint requires 100% (operational-critical).

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| `observability_metrics` as a generic time-series table | One table for all metric types avoids table proliferation. The `metric_type` and `source_type` columns provide sufficient filtering. JSONB `metadata` handles type-specific details. |
| Metrics aggregated hourly, not real-time | Convention operations do not require sub-minute observability. Hourly aggregation balances insight with storage cost. Real-time metrics can be added later via Redis counters. |
| Health check unauthenticated | Load balancers and uptime monitors cannot authenticate. The health endpoint exposes only system status, no business data. |
| Health check cached for 10 seconds | Prevents check storms from aggressive monitors. 10 seconds is short enough for meaningful monitoring. |
| Pipeline auto-registration | Admins should not have to manually register every workflow and route. The system tracks what exists and monitors it automatically. |
| Dashboard data pre-shaped for widgets | The frontend should not need to transform raw metrics. Server-side aggregation keeps the frontend thin and the API contract clear. |
