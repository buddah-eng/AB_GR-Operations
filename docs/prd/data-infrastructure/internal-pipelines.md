# Internal Data Pipelines

> **Cross-department data flows coordinated as named, versioned, auditable pipelines.** A pipeline is an ordered sequence of routes + transforms + quality checks that implements a business process. Guest confirmation pipeline: GR guest record -> Programming panel scheduling -> Operations equipment staging -> Volunteers shift assignment. Pipelines have lifecycle states (draft/active/paused/deprecated), monitoring (last run, success/failure, records processed), and error handling (fail-fast vs continue-on-error with dead letter queue). Pipeline executions are fully audited. Postgres is the system of record.

---

## Overview

Individual data routes (see `data-infrastructure/data-routing.md`) move data between two concepts. But real business processes span multiple departments and involve coordinated sequences of routes, transforms, and validation checks. A guest confirmation does not just create a PR profile -- it also triggers panel scheduling in Programming, equipment staging in Operations, and shift assignments in Volunteers. These cross-department flows need coordination, monitoring, and error handling that individual routes cannot provide.

Internal data pipelines are the orchestration layer above routes. A pipeline defines an ordered sequence of stages, where each stage is a route execution, a transform, or a quality check. Pipelines are triggered by domain events, cron schedules, or manual invocation. They maintain lifecycle state (draft through deprecated), track execution history, and handle errors with configurable strategies.

Pipelines differ from workflows (see `automation/workflow-engine.md`) in scope: workflows operate on single records within a concept (create prep items, send notification, generate document). Pipelines operate across departments and concepts, coordinating the data flow for a complete business process. Workflows are a pipeline consumer -- a pipeline stage can trigger a workflow as a side effect.

**Dependencies:** `data-infrastructure/data-routing.md`, `data-infrastructure/data-transforms.md`, `core/event-bus.md`, `core/audit-system.md`, `automation/workflow-engine.md`

---

## 1. Pipeline Definition Model

### Purpose

Define the data model for a pipeline -- the declarative specification of a multi-stage cross-department data flow.

### Detail

```sql
CREATE TABLE data_pipelines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,                  -- e.g. 'guest_operations', 'scheduling', 'logistics'

  -- Trigger
  trigger_type        TEXT NOT NULL CHECK (trigger_type IN (
    'domain_event',   -- fires on a specific domain event
    'scheduled',      -- fires on cron schedule
    'manual',         -- fires on explicit API call
    'pipeline'        -- fires when another pipeline completes
  )),
  trigger_config      JSONB NOT NULL,        -- type-specific trigger configuration

  -- Stages
  stages              JSONB NOT NULL,        -- ordered array of PipelineStage definitions

  -- Error handling
  error_strategy      TEXT NOT NULL DEFAULT 'fail_fast' CHECK (error_strategy IN (
    'fail_fast',      -- stop pipeline on first error
    'continue',       -- continue to next stage, collect errors
    'retry_then_skip' -- retry failed stage N times, then skip
  )),
  max_retries         INTEGER NOT NULL DEFAULT 3,
  retry_delay_ms      INTEGER NOT NULL DEFAULT 1000,
  dead_letter_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',          -- being configured, not executable
    'active',         -- live and triggered
    'paused',         -- temporarily disabled, maintains state
    'deprecated'      -- no longer active, preserved for history
  )),
  version             INTEGER NOT NULL DEFAULT 1,
  owner_department    TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_version_id UUID REFERENCES data_pipelines(id),

  UNIQUE (name, version)
);

CREATE INDEX idx_pipelines_status ON data_pipelines (status) WHERE status = 'active';
CREATE INDEX idx_pipelines_trigger ON data_pipelines (trigger_type) WHERE status = 'active';
CREATE INDEX idx_pipelines_category ON data_pipelines (category) WHERE status = 'active';
```

**Trigger configuration by type:**

| trigger_type | trigger_config |
|--------------|----------------|
| `domain_event` | `{ "event_pattern": "guest.updated", "condition": { ConditionExpression } }` |
| `scheduled` | `{ "cron": "0 2 * * *", "timezone": "America/New_York" }` |
| `manual` | `{ "required_params": ["record_id"], "rbac_permission": "pipelines:execute" }` |
| `pipeline` | `{ "upstream_pipeline_id": "uuid", "on_status": "success" }` |

### Acceptance Criteria

- [ ] `data_pipelines` table exists with all specified columns and constraints
- [ ] All four trigger types are representable and validated
- [ ] Pipeline name + version is unique
- [ ] Status lifecycle follows draft -> active -> paused -> deprecated (no backward transitions except paused -> active)
- [ ] Error strategy defaults to `fail_fast` (safest default)
- [ ] Dead letter queue is enabled by default

---

## 2. Pipeline Stages

### Purpose

Define the structure and types of stages within a pipeline.

### Detail

Each stage in the `stages` JSONB array follows a discriminated union pattern:

```typescript
type PipelineStage =
  | RouteStage
  | TransformStage
  | QualityCheckStage
  | WorkflowStage
  | GateStage

interface RouteStage {
  type: 'route'
  name: string
  route_id: string                // references data_routes.id
  input_mapping?: Record<string, string>  // map previous stage output to route input
  timeout_ms?: number             // per-stage timeout (default 30000)
}

interface TransformStage {
  type: 'transform'
  name: string
  transform_id?: string           // references data_transforms.id
  inline_transforms?: TransformDefinition[]
  input_source: 'previous' | 'trigger'  // use previous stage output or original trigger data
}

interface QualityCheckStage {
  type: 'quality_check'
  name: string
  check_type: 'not_empty' | 'field_present' | 'value_range' | 'custom'
  config: Record<string, unknown>
  on_failure: 'halt' | 'warn' | 'skip_remaining'
}

interface WorkflowStage {
  type: 'workflow'
  name: string
  workflow_id: string             // references workflow_configs.id
  wait_for_completion: boolean    // true = block until workflow completes
}

interface GateStage {
  type: 'gate'
  name: string
  condition: ConditionExpression  // must evaluate to true to continue
  on_failure: 'halt' | 'skip_to_stage'
  skip_to_stage_name?: string     // if on_failure = 'skip_to_stage'
}
```

**Stage execution model:**

1. Stages execute in array order (sequential).
2. Each stage receives a context object containing:
   - `trigger_data`: the original event or manual input that started the pipeline
   - `previous_stage_output`: the output of the immediately preceding stage
   - `stage_outputs`: map of stage name to output (for referencing any earlier stage)
   - `pipeline_metadata`: pipeline name, version, execution ID
3. Each stage produces an output that feeds into the next stage.
4. Quality checks and gates can halt or redirect the pipeline flow.

### Acceptance Criteria

- [ ] All five stage types are representable and executable
- [ ] Stages execute in strict array order
- [ ] Each stage receives output from the previous stage
- [ ] Quality check failures respect their `on_failure` configuration
- [ ] Gate conditions use the shared ConditionExpression evaluator
- [ ] Workflow stages can optionally block until the workflow completes
- [ ] Per-stage timeout prevents infinite hangs (default 30s)

---

## 3. Pipeline Lifecycle

### Purpose

Define the status transitions and versioning behavior of pipelines.

### Detail

**Status transitions:**

```
draft ──────► active
               │  ▲
               ▼  │
             paused
               │
               ▼
           deprecated
```

| Transition | Who | Conditions |
|------------|-----|-----------|
| draft -> active | Pipeline owner or admin | All stages validate (routes exist, transforms valid, workflows exist) |
| active -> paused | Pipeline owner or admin | Immediate -- no new executions start, in-flight executions complete |
| paused -> active | Pipeline owner or admin | Re-validation of all stages |
| active -> deprecated | Admin only | No in-flight executions (or force-deprecate with warning) |
| paused -> deprecated | Admin only | No conditions |

**Versioning:** Updating an active pipeline creates a new version in `draft` status. The active version continues running. When the new version is activated, the previous version is automatically deprecated. This ensures zero-downtime pipeline updates.

**Activation validation checklist:**

1. All referenced routes exist and are enabled
2. All referenced transforms exist and are active
3. All referenced workflows exist and are enabled
4. All stage field references resolve to valid ontology properties
5. Gate conditions are valid ConditionExpressions
6. At least one stage is defined

### Acceptance Criteria

- [ ] Pipelines start in `draft` status
- [ ] `draft -> active` transition validates all stages
- [ ] `active -> paused` stops new executions but allows in-flight to complete
- [ ] `paused -> active` re-validates before reactivation
- [ ] Updating an active pipeline creates a new version in draft, not modifying the active version
- [ ] Activating a new version auto-deprecates the previous version
- [ ] Deprecated pipelines are preserved for audit history

---

## 4. Cross-Department Flow Examples

### Purpose

Demonstrate pipelines for real convention business processes.

### Detail

#### 4.1 Guest Confirmation Pipeline

Triggered when a guest's status changes to "Confirmed." Propagates guest data across four departments.

```json
{
  "name": "Guest Confirmation Pipeline",
  "trigger_type": "domain_event",
  "trigger_config": {
    "event_pattern": "guest.updated",
    "condition": {
      "type": "and",
      "conditions": [
        { "type": "field", "field": "status", "operator": "eq", "value": "Confirmed" },
        { "type": "field", "field": "_previousValues.status", "operator": "neq", "value": "Confirmed" }
      ]
    }
  },
  "stages": [
    {
      "type": "quality_check",
      "name": "verify_required_fields",
      "check_type": "field_present",
      "config": { "fields": ["name", "type", "arrival_date", "panel_topics"] },
      "on_failure": "halt"
    },
    {
      "type": "route",
      "name": "create_pr_profile",
      "route_id": "route-guest-to-pr-profile"
    },
    {
      "type": "route",
      "name": "create_scheduling_availability",
      "route_id": "route-guest-to-scheduling"
    },
    {
      "type": "route",
      "name": "create_transport_booking",
      "route_id": "route-guest-to-transport"
    },
    {
      "type": "workflow",
      "name": "create_prep_checklist",
      "workflow_id": "wf-guest-prep-items",
      "wait_for_completion": true
    },
    {
      "type": "gate",
      "name": "check_jp_guest",
      "condition": { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
      "on_failure": "skip_to_stage",
      "skip_to_stage_name": "notify_team"
    },
    {
      "type": "workflow",
      "name": "assign_interpreter",
      "workflow_id": "wf-jp-interpreter-assignment",
      "wait_for_completion": true
    },
    {
      "type": "workflow",
      "name": "notify_team",
      "workflow_id": "wf-guest-confirmed-notification",
      "wait_for_completion": false
    }
  ],
  "error_strategy": "continue"
}
```

#### 4.2 Convention Day-Of Logistics Pipeline

Runs daily during the convention to synchronize data across all departments.

```json
{
  "name": "Daily Operations Sync",
  "trigger_type": "scheduled",
  "trigger_config": { "cron": "0 5 * * *", "timezone": "America/New_York" },
  "stages": [
    {
      "type": "route",
      "name": "sync_schedule_to_guidebook",
      "route_id": "route-schedule-to-guidebook"
    },
    {
      "type": "route",
      "name": "sync_volunteers_to_shifts",
      "route_id": "route-volunteer-availability-to-shifts"
    },
    {
      "type": "route",
      "name": "sync_equipment_staging",
      "route_id": "route-events-to-equipment-staging"
    },
    {
      "type": "quality_check",
      "name": "verify_no_scheduling_conflicts",
      "check_type": "custom",
      "config": { "query": "SELECT count(*) FROM schedule_conflicts WHERE resolved = false", "max_value": 0 },
      "on_failure": "warn"
    }
  ],
  "error_strategy": "continue"
}
```

#### 4.3 Equipment Staging Pipeline

Triggered when a schedule event is confirmed, ensuring required equipment is allocated.

```json
{
  "name": "Equipment Staging Pipeline",
  "trigger_type": "domain_event",
  "trigger_config": {
    "event_pattern": "schedule_event.updated",
    "condition": { "type": "field", "field": "status", "operator": "eq", "value": "confirmed" }
  },
  "stages": [
    {
      "type": "transform",
      "name": "extract_equipment_requirements",
      "inline_transforms": [
        { "type": "lookup", "target_concept": "venue_room", "match_field": "id", "match_source_field": "room_id",
          "copy_fields": ["default_equipment", "room_capacity"] },
        { "type": "compute", "target_field": "chair_count", "formula": "multiply({{room_capacity}}, 0.9)" }
      ],
      "input_source": "trigger"
    },
    {
      "type": "route",
      "name": "create_equipment_request",
      "route_id": "route-event-to-equipment-request"
    },
    {
      "type": "workflow",
      "name": "notify_ops_team",
      "workflow_id": "wf-equipment-staging-alert",
      "wait_for_completion": false
    }
  ],
  "error_strategy": "fail_fast"
}
```

### Acceptance Criteria

- [ ] Guest Confirmation Pipeline creates projections in PR, Scheduling, and Transport on guest confirmation
- [ ] Guest Confirmation Pipeline conditionally assigns interpreter for JP guests
- [ ] Daily Operations Sync runs at 5am ET and processes all three sync routes
- [ ] Equipment Staging Pipeline extracts venue equipment defaults via lookup transform
- [ ] All examples validate successfully at activation time

---

## 5. Pipeline Execution & Monitoring

### Purpose

Define the runtime behavior, execution tracking, and monitoring of pipeline runs.

### Detail

**Execution tracking table:**

```sql
CREATE TABLE pipeline_executions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id         UUID NOT NULL REFERENCES data_pipelines(id),
  pipeline_version    INTEGER NOT NULL,

  -- Trigger context
  trigger_type        TEXT NOT NULL,
  trigger_event_id    UUID,               -- references event_log.event_id if event-triggered
  trigger_record_id   TEXT,               -- source record that triggered the pipeline
  triggered_by        TEXT NOT NULL,       -- user email, 'system', or 'scheduler'

  -- Execution state
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
    'running', 'success', 'partial_success', 'failed', 'canceled'
  )),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  duration_ms         INTEGER,

  -- Stage results
  stage_results       JSONB NOT NULL DEFAULT '[]',
  -- Array of: { stage_name, stage_type, status, started_at, completed_at, duration_ms, 
  --             records_processed, error?, output_summary }

  -- Error tracking
  errors              JSONB DEFAULT '[]',
  dead_letter_count   INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_exec_pipeline ON pipeline_executions (pipeline_id, started_at DESC);
CREATE INDEX idx_pipeline_exec_status ON pipeline_executions (status) WHERE status = 'running';
CREATE INDEX idx_pipeline_exec_trigger ON pipeline_executions (trigger_record_id);
```

**Dead letter queue:**

```sql
CREATE TABLE pipeline_dead_letters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id        UUID NOT NULL REFERENCES pipeline_executions(id),
  pipeline_id         UUID NOT NULL REFERENCES data_pipelines(id),
  stage_name          TEXT NOT NULL,
  record_data         JSONB NOT NULL,      -- the record that failed processing
  error_message       TEXT NOT NULL,
  error_details       JSONB,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  max_retries         INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'retrying', 'resolved', 'abandoned'
  )),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_dead_letters_status ON pipeline_dead_letters (status) WHERE status = 'pending';
CREATE INDEX idx_dead_letters_pipeline ON pipeline_dead_letters (pipeline_id, created_at DESC);
```

**Monitoring queries:**

```sql
-- Pipeline health dashboard: last 10 executions per pipeline
SELECT p.name, pe.status, pe.started_at, pe.duration_ms, pe.dead_letter_count
FROM pipeline_executions pe
JOIN data_pipelines p ON p.id = pe.pipeline_id
WHERE pe.started_at > now() - INTERVAL '24 hours'
ORDER BY pe.started_at DESC;

-- Failed stages across all pipelines in last 24 hours
SELECT pe.id, p.name, sr->>'stage_name' AS stage, sr->>'error' AS error
FROM pipeline_executions pe
JOIN data_pipelines p ON p.id = pe.pipeline_id,
LATERAL jsonb_array_elements(pe.stage_results) AS sr
WHERE sr->>'status' = 'failed'
  AND pe.started_at > now() - INTERVAL '24 hours';

-- Dead letter queue depth
SELECT p.name, count(*) AS pending_items
FROM pipeline_dead_letters dl
JOIN data_pipelines p ON p.id = dl.pipeline_id
WHERE dl.status = 'pending'
GROUP BY p.name;
```

**Monitoring API:**

```
GET  /api/pipelines/:id/executions?limit=20           -- execution history
GET  /api/pipelines/:id/executions/:execId             -- single execution detail
GET  /api/pipelines/:id/executions/:execId/stages      -- stage-by-stage breakdown
GET  /api/pipelines/:id/dead-letters?status=pending    -- dead letter queue
POST /api/pipelines/:id/dead-letters/:dlId/retry       -- retry dead letter item
POST /api/pipelines/:id/dead-letters/:dlId/abandon     -- abandon dead letter item
GET  /api/pipelines/health                             -- system-wide pipeline health
```

### Acceptance Criteria

- [ ] Every pipeline execution creates a `pipeline_executions` row
- [ ] Stage results are recorded individually with timing and record counts
- [ ] Failed records are sent to the dead letter queue when enabled
- [ ] Dead letter items can be retried or abandoned via API
- [ ] Execution history is queryable by pipeline, status, and time range
- [ ] Health dashboard query returns in < 1s for 10,000+ execution rows
- [ ] Execution status is `partial_success` when some stages succeed and others fail (continue strategy)

---

## 6. Error Handling

### Purpose

Define how pipelines handle failures at the stage and record level.

### Detail

**Error strategies:**

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `fail_fast` | Stop pipeline on first stage failure. Roll back completed stages if transactional. | Critical data flows where consistency matters |
| `continue` | Log the error, skip the failed stage, continue to next stage. Mark execution as `partial_success`. | Non-critical flows where partial data is better than no data |
| `retry_then_skip` | Retry the failed stage `max_retries` times with `retry_delay_ms` exponential backoff. If still failing, skip and continue. | Flows with transient failures (network issues, rate limits) |

**Stage-level error handling:**

Each stage can override the pipeline's error strategy:

```json
{
  "type": "route",
  "name": "optional_enrichment",
  "route_id": "route-optional-data",
  "error_override": "continue"
}
```

**Record-level error handling (for batch stages):**

When a stage processes multiple records (e.g., a scheduled pipeline processing all pending records), each record is handled independently:

1. Record succeeds: counted in `records_processed`.
2. Record fails: sent to dead letter queue if enabled, counted in `dead_letter_count`.
3. Other records continue processing regardless.

**Retry with exponential backoff:**

```
Attempt 1: immediate
Attempt 2: retry_delay_ms * 1
Attempt 3: retry_delay_ms * 2
Attempt 4: retry_delay_ms * 4
...
Max: retry_delay_ms * 2^(max_retries - 1), capped at 60000ms
```

**Dead letter resolution:**

Dead letter items have three resolution paths:
1. **Manual retry:** Admin triggers a retry via API. Item is re-processed through the failed stage.
2. **Manual fix and retry:** Admin edits the `record_data` JSONB (fixing the data issue) and retries.
3. **Abandon:** Admin marks the item as `abandoned` with a reason. No further processing.

### Acceptance Criteria

- [ ] `fail_fast` stops execution and marks the pipeline as `failed`
- [ ] `continue` skips failed stages and marks the pipeline as `partial_success`
- [ ] `retry_then_skip` retries with exponential backoff before skipping
- [ ] Stage-level `error_override` takes precedence over pipeline-level strategy
- [ ] Dead letter queue captures failed records with error details
- [ ] Dead letter retry re-processes the item through the original stage
- [ ] Exponential backoff caps at 60 seconds
- [ ] Batch stages process records independently (one failure does not block others)

---

## 7. Audit Integration

### Purpose

Define how pipeline executions integrate with the platform's audit system.

### Detail

Pipeline executions produce audit records at three levels:

1. **Pipeline level:** `domain_audit_log` entry when pipeline starts and completes, including `change_set` UUID that groups all mutations within the execution.
2. **Stage level:** Each stage's data mutations (route executions, workflow actions) carry the pipeline execution's `change_set`, enabling full traceability from pipeline trigger to individual record changes.
3. **Event level:** Pipeline start and completion emit domain events:
   - `pipeline.started` with pipeline name, trigger info
   - `pipeline.completed` with status, duration, stage summary
   - `pipeline.failed` with error details

**Traceability chain:**

```
Domain event (e.g., guest.updated with status=Confirmed)
  -> event_log row
    -> pipeline_executions row (trigger_event_id references event_log)
      -> stage_results[] (per-stage detail)
        -> data_routes execution (projection records)
          -> domain_audit_log rows (change_set links to pipeline execution)
```

### Acceptance Criteria

- [ ] Pipeline executions carry a `change_set` UUID shared across all stage mutations
- [ ] `pipeline.started`, `pipeline.completed`, and `pipeline.failed` events are emitted
- [ ] Stage-level mutations in the audit log reference the pipeline's change_set
- [ ] Full traceability from trigger event through pipeline to individual record changes
- [ ] Audit log query by change_set returns all mutations from a single pipeline execution

---

## 8. Pipeline CRUD API

### Purpose

Define the API for managing and operating pipelines.

### Detail

```
GET    /api/pipelines?status=...&category=...&trigger=...  -- list pipelines
GET    /api/pipelines/:id                                    -- get single pipeline
POST   /api/pipelines                                        -- create pipeline (draft)
PUT    /api/pipelines/:id                                    -- update (new version if active)
DELETE /api/pipelines/:id                                    -- deprecate pipeline
POST   /api/pipelines/:id/activate                           -- draft -> active (validates)
POST   /api/pipelines/:id/pause                              -- active -> paused
POST   /api/pipelines/:id/resume                             -- paused -> active (validates)
POST   /api/pipelines/:id/execute                            -- manual trigger
GET    /api/pipelines/:id/executions                         -- execution history
GET    /api/pipelines/health                                 -- system health dashboard
```

**RBAC:** Pipeline management requires `pipelines:manage` permission. Pipeline execution requires `pipelines:execute`. Dead letter management requires `pipelines:manage`.

### Acceptance Criteria

- [ ] All CRUD operations go through the full write pipeline (auth, RBAC, audit, events)
- [ ] Activation validates all stages before transitioning to active
- [ ] Manual execution creates a pipeline_executions row and returns its ID
- [ ] API requires appropriate RBAC permissions
- [ ] Pipeline updates on active pipelines create new versions (do not modify in-place)

---

## 9. Test Plan

### 9.1 Pipeline Lifecycle Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| PL-01 | Unit | Create pipeline | Status is `draft`, version 1 |
| PL-02 | Unit | Activate pipeline with valid stages | Status changes to `active` |
| PL-03 | Unit | Activate pipeline with invalid route reference | Validation error, stays `draft` |
| PL-04 | Unit | Pause active pipeline | Status changes to `paused` |
| PL-05 | Unit | Resume paused pipeline | Re-validates and changes to `active` |
| PL-06 | Unit | Update active pipeline | New version created in `draft`, active version unchanged |
| PL-07 | Unit | Activate new version | Old version deprecated, new version active |

### 9.2 Pipeline Execution Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| PE-01 | Integration | Domain event triggers pipeline | Pipeline executes all stages in order |
| PE-02 | Integration | Scheduled pipeline | Pipeline executes at configured cron time |
| PE-03 | Integration | Manual pipeline execution | Pipeline executes with provided parameters |
| PE-04 | Integration | Pipeline triggered by upstream pipeline completion | Downstream pipeline fires on upstream success |
| PE-05 | Integration | Gate condition evaluates false with `halt` | Pipeline stops at gate, status `failed` |
| PE-06 | Integration | Gate condition evaluates false with `skip_to_stage` | Pipeline jumps to named stage |
| PE-07 | Integration | Quality check fails with `warn` | Pipeline continues, warning logged |
| PE-08 | Integration | Quality check fails with `halt` | Pipeline stops, status `failed` |

### 9.3 Error Handling Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| EH-01 | Integration | `fail_fast`, stage 2 of 4 fails | Stages 3-4 skipped, status `failed` |
| EH-02 | Integration | `continue`, stage 2 of 4 fails | Stages 3-4 execute, status `partial_success` |
| EH-03 | Integration | `retry_then_skip`, transient failure clears on retry 2 | Stage succeeds, pipeline continues |
| EH-04 | Integration | `retry_then_skip`, persistent failure | Stage skipped after max retries, pipeline continues |
| EH-05 | Integration | Dead letter queue, record fails in batch stage | Record in dead letter, other records processed |
| EH-06 | Integration | Dead letter retry | Record re-processed through failed stage |
| EH-07 | Integration | Dead letter abandon | Record marked abandoned, no further processing |
| EH-08 | Integration | Stage-level error override | Stage uses its own strategy, not pipeline default |

### 9.4 Cross-Department Flow Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CD-01 | Integration | Guest confirmation pipeline end-to-end | PR profile, scheduling, transport, and prep items all created |
| CD-02 | Integration | Guest confirmation for JP guest | Interpreter assignment stage executes |
| CD-03 | Integration | Guest confirmation for non-JP guest | Interpreter assignment stage skipped via gate |
| CD-04 | Integration | Daily operations sync | All three route stages execute, quality check runs |

### 9.5 Audit & Monitoring Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| AM-01 | Integration | Pipeline executes successfully | `pipeline.started` and `pipeline.completed` events emitted |
| AM-02 | Integration | Pipeline fails | `pipeline.failed` event emitted with error details |
| AM-03 | Integration | Query execution history | Returns executions sorted by start time |
| AM-04 | Integration | Health dashboard query | Returns status summary for all active pipelines |
| AM-05 | Integration | Trace from trigger event to record changes | Full chain queryable via change_set |

### 9.6 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| 5-stage pipeline, single record | Execute end-to-end | < 2s (excluding external APIs) |
| 5-stage pipeline, 100 records batch | Scheduled execution | < 30s |
| 10 concurrent pipeline executions | Simultaneous triggers | No deadlocks, all complete |
| 10,000 execution history rows | Health dashboard query | < 1s |

**Coverage target:** >=80% on pipeline executor, stage runner, and error handling. 100% on lifecycle state transitions.

---

## 10. Dependencies

| PRD | Relationship |
|-----|-------------|
| `data-infrastructure/data-routing.md` | Route stages execute data routes |
| `data-infrastructure/data-transforms.md` | Transform stages execute transform chains |
| `core/event-bus.md` | Pipeline triggers subscribe to domain events; pipeline events are emitted |
| `core/audit-system.md` | Pipeline executions produce audit entries with shared change_set |
| `core/condition-expression.md` | Gate stages and trigger conditions use the shared evaluator |
| `automation/workflow-engine.md` | Workflow stages delegate to the workflow engine |
| `automation/workflow-actions.md` | Workflow stages use existing action types |
| `platform/template-infrastructure.md` | Pipeline configs can be stored as reusable templates |
