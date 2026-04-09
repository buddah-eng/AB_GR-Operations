# Data Quality & Validation

> Configurable quality rules (ConditionExpression-based) that run on data changes, on schedule, and on demand.
> Five rule types: completeness, consistency, referential, staleness, uniqueness. Quality scores per record,
> per concept, per department. Violations stored with severity, assignable to roles. Runs before data route
> propagation and fires events on the event bus.

---

## Overview

Field-level validation (required, minLength, pattern) catches malformed input at form submission time. Data quality catches everything else -- the business-rule violations that only surface when you look at a record in context. A guest marked "confirmed" with no contract. A transport booking referencing a hotel that no longer exists. A vendor record untouched for 6 months. A duplicate guest created under a slightly different name.

The data quality system defines rules as ontology config (stored in Postgres, editable by admins), evaluates them at three execution points (on-write, on-schedule, on-demand), and produces violations with severity and ownership. Every concept in the ontology can have quality rules. Every record gets a quality score. Departments get aggregate dashboards.

Rules use the same `ConditionExpression` format as workflows, constraints, and form visibility -- one logic engine across the platform.

**Phase:** Depends on ontology engine, condition expression, event bus, RBAC engine, audit system. Blocks data routing (quality check gate), observability (quality metrics feed into dashboards).

---

## Full Specification

### 1. Quality Rule Types

#### Purpose

Define the five categories of quality rules so that admins can express business-level data expectations beyond field-level validation.

#### Detail

| Rule Type | What It Checks | Example |
|-----------|---------------|---------|
| `completeness` | Required fields across the record lifecycle, not just at creation | Guest with `status = 'confirmed'` must have `arrival_date`, `departure_date`, and `hotel_room` populated |
| `consistency` | Cross-field logical coherence within a record or across related records | `status = 'confirmed'` requires a contract to exist in `guest_contracts` for that guest |
| `referential` | FK-like integrity across concepts not enforced by Postgres constraints | Transport booking references a `hotel_id` that must exist and have `status = 'active'` in the hotels concept |
| `staleness` | Data older than a configurable threshold | Vendor contact info not updated in 180 days triggers a refresh request |
| `uniqueness` | Duplicate detection beyond database UNIQUE constraints | Two guest records with Levenshtein distance < 3 on name AND same email domain flagged as potential duplicates |

Each rule type maps to a specific evaluation strategy in the quality engine. The rule type determines which fields the engine inspects and how it computes a pass/fail result.

#### Acceptance Criteria

- [ ] All five rule types are supported and distinguishable by `rule_type` enum
- [ ] Each rule type has at least one working example in integration tests
- [ ] Staleness rules accept a configurable `threshold_days` parameter
- [ ] Uniqueness rules accept a configurable similarity algorithm and threshold

---

### 2. Rule Definition Model

#### Purpose

Define how quality rules are stored as ontology config in Postgres, using the same ConditionExpression format used across the platform.

#### Detail

Quality rules live in the `quality_rules` table:

```sql
CREATE TABLE quality_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key       TEXT NOT NULL,                -- which concept this rule applies to
  rule_key          TEXT NOT NULL,                 -- unique key within concept, e.g. 'confirmed_needs_contract'
  name              TEXT NOT NULL,                 -- human-readable, e.g. 'Confirmed guest requires contract'
  description       TEXT,                          -- detailed explanation for admins
  rule_type         TEXT NOT NULL CHECK (rule_type IN (
                      'completeness', 'consistency', 'referential', 'staleness', 'uniqueness'
                    )),
  condition         JSONB NOT NULL,                -- ConditionExpression that identifies VIOLATING records
  severity          TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('error', 'warning', 'info')),
  assigned_role_key TEXT,                          -- role responsible for fixing violations (FK to roles.key)
  execution_modes   TEXT[] NOT NULL DEFAULT '{on_write}',  -- array of: 'on_write', 'on_schedule', 'on_demand'
  schedule_cron     TEXT,                          -- cron expression for on_schedule rules (e.g. '0 2 * * *')
  enabled           BOOLEAN NOT NULL DEFAULT true,
  weight            NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- weight in quality score calculation (0.00-1.00)

  -- staleness-specific
  staleness_field   TEXT,                          -- field to check for staleness (e.g. 'updated_at')
  staleness_days    INTEGER,                       -- threshold in days

  -- uniqueness-specific
  uniqueness_fields TEXT[],                        -- fields to compare for dedup (e.g. '{name, email}')
  uniqueness_threshold NUMERIC(3,2),              -- similarity threshold (0.00-1.00)

  -- versioning
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'rolled_back')),
  changed_by        UUID,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (concept_key, rule_key, version)
);

CREATE INDEX idx_quality_rules_concept ON quality_rules (concept_key) WHERE status = 'active';
CREATE INDEX idx_quality_rules_type ON quality_rules (rule_type) WHERE status = 'active';
```

**Condition field:** A `ConditionExpression` that evaluates to `true` when the record is IN VIOLATION. This is the inverse of a constraint -- a quality rule's condition describes the bad state, not the good state.

**Example rule definition:**

```json
{
  "concept_key": "guest",
  "rule_key": "confirmed_needs_contract",
  "name": "Confirmed guest requires contract",
  "rule_type": "consistency",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "field", "field": "status", "operator": "eq", "value": "confirmed" },
      { "type": "field", "field": "_has_contract", "operator": "eq", "value": false }
    ]
  },
  "severity": "error",
  "assigned_role_key": "liaison",
  "execution_modes": ["on_write", "on_schedule"],
  "weight": 1.00
}
```

The `_has_contract` field is a computed context field injected by the quality engine before evaluation. The engine resolves referential lookups and injects boolean flags like `_has_contract`, `_has_transport`, etc., so that the ConditionExpression evaluator does not need to perform queries itself.

#### Acceptance Criteria

- [ ] `quality_rules` table exists with all columns and constraints
- [ ] `condition` column stores valid ConditionExpression JSONB
- [ ] Rule key is unique per concept per active version
- [ ] Staleness fields are only required when `rule_type = 'staleness'`
- [ ] Uniqueness fields are only required when `rule_type = 'uniqueness'`
- [ ] `execution_modes` array contains only valid mode strings
- [ ] Rules follow the same versioning pattern as other ontology config tables

---

### 3. Rule Execution

#### Purpose

Define the three execution modes and their trigger mechanisms.

#### Detail

**3a. On-Write Execution (Synchronous)**

Runs during the write pipeline, after RBAC filtering and input validation, before the domain event is emitted. The quality check is synchronous but non-blocking -- violations are recorded but do not prevent the write from completing. This preserves data entry flow while flagging issues immediately.

```
Request → Auth → RBAC → Validate → Encrypt → Write → Quality Check → Event → Response
```

The quality check step:
1. Load all active `on_write` rules for the concept being written.
2. Build the evaluation context: the record's current field values plus computed context fields (referential lookups).
3. Evaluate each rule's `ConditionExpression` against the context.
4. For rules that evaluate to `true` (violation detected): insert a row into `quality_violations`.
5. For rules that previously had a violation on this record but now evaluate to `false`: mark the violation as `resolved`.

**Error severity handling:** Rules with `severity = 'error'` can optionally block the write. This is controlled by a concept-level config flag `quality_block_on_error` (default: `false`). When enabled, an error-severity violation causes the API to return `409 Conflict` with the violation details, and the write is rolled back.

**3b. On-Schedule Execution (Batch)**

A scheduled Cloud Function (or pg_cron job) runs quality sweeps according to each rule's `schedule_cron` expression. The sweep:

1. Loads all active `on_schedule` rules.
2. Groups rules by concept.
3. For each concept, queries all active records.
4. Evaluates each rule against each record.
5. Bulk-inserts new violations and bulk-resolves cleared violations.
6. Emits a `quality.sweep.completed` event with summary metrics.

Batch sweeps are idempotent -- running the same sweep twice produces the same violation set.

**3c. On-Demand Execution (Manual)**

An admin API endpoint (`POST /api/admin/quality/audit`) triggers a quality sweep for a specific concept or a specific record. This uses the same evaluation logic as the batch sweep but is initiated manually.

Parameters:
- `concept_key` (required): which concept to audit
- `record_id` (optional): audit a single record instead of all records
- `rule_keys` (optional): run only specific rules

Returns: `{ violations_found: number, violations_resolved: number, records_scanned: number }`.

#### Acceptance Criteria

- [ ] On-write rules execute synchronously during the write pipeline
- [ ] On-write violations are recorded without blocking the write (default behavior)
- [ ] `quality_block_on_error` flag causes error-severity violations to block writes when enabled
- [ ] On-schedule rules execute according to their cron expression
- [ ] Batch sweeps are idempotent
- [ ] On-demand audit endpoint requires `admin:quality` permission
- [ ] Previously-violated records that now pass are marked as `resolved`

---

### 4. Quality Violations

#### Purpose

Store and track quality violations with severity, assignment, and lifecycle.

#### Detail

```sql
CREATE TABLE quality_violations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID NOT NULL REFERENCES quality_rules(id),
  concept_key     TEXT NOT NULL,
  record_id       UUID NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'suppressed')),
  violation_data  JSONB NOT NULL,             -- snapshot of the fields that caused the violation
  assigned_role   TEXT,                        -- role responsible for resolution
  assigned_user   UUID,                        -- specific user assigned (optional)
  resolved_by     UUID,                        -- who resolved it
  resolved_at     TIMESTAMPTZ,
  suppressed_by   UUID,                        -- who suppressed it (false positive)
  suppressed_at   TIMESTAMPTZ,
  suppress_reason TEXT,                        -- why it was suppressed
  execution_mode  TEXT NOT NULL,               -- which mode detected this: 'on_write', 'on_schedule', 'on_demand'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_violations_record ON quality_violations (concept_key, record_id) WHERE status = 'open';
CREATE INDEX idx_violations_severity ON quality_violations (severity, status) WHERE status = 'open';
CREATE INDEX idx_violations_assigned ON quality_violations (assigned_role) WHERE status = 'open';
CREATE INDEX idx_violations_rule ON quality_violations (rule_id);
```

**Violation lifecycle:**

```
Detected → open
  ├─ Acknowledged by assigned user → acknowledged
  ├─ Record updated and rule passes → resolved (automatic)
  ├─ User manually resolves → resolved (manual, resolved_by populated)
  └─ User suppresses (false positive) → suppressed (suppress_reason required)
```

**Deduplication:** A new violation is only inserted if no `open` or `acknowledged` violation exists for the same `(rule_id, record_id)` pair. If one already exists, the `violation_data` is updated and `updated_at` is refreshed.

#### Acceptance Criteria

- [ ] `quality_violations` table exists with all columns and constraints
- [ ] Duplicate violations for the same rule+record are deduplicated (upsert)
- [ ] Resolved violations have `resolved_by` and `resolved_at` populated
- [ ] Suppressed violations require a `suppress_reason`
- [ ] Auto-resolution occurs when a record passes a previously-violated rule
- [ ] Violation data snapshot captures the specific field values that triggered the violation

---

### 5. Quality Scores

#### Purpose

Compute quality metrics at record, concept, and department levels for monitoring and dashboards.

#### Detail

**Per-Record Quality Score:**

```
score = (passing_rules_weighted_sum / total_rules_weighted_sum) * 100
```

Each rule has a `weight` (0.00-1.00). Rules that pass contribute their weight to the numerator. The score is a percentage from 0 to 100. A record with no applicable rules scores 100 (vacuously clean).

The score is computed on-read (not stored) by querying active violations for the record and comparing against active rules for the concept. This avoids stale cached scores.

```ts
interface RecordQualityScore {
  readonly recordId: string
  readonly conceptKey: string
  readonly score: number                    // 0-100
  readonly totalRules: number
  readonly passingRules: number
  readonly violations: ReadonlyArray<{
    readonly ruleKey: string
    readonly severity: string
    readonly name: string
  }>
}
```

**Per-Concept Aggregate:**

```ts
interface ConceptQualityScore {
  readonly conceptKey: string
  readonly averageScore: number             // average of all record scores
  readonly totalRecords: number
  readonly cleanRecords: number             // score = 100
  readonly errorCount: number               // open violations with severity 'error'
  readonly warningCount: number             // open violations with severity 'warning'
  readonly infoCount: number
}
```

Computed by aggregating violation counts per concept:

```sql
SELECT
  concept_key,
  count(DISTINCT record_id) FILTER (WHERE status = 'open') AS records_with_violations,
  count(*) FILTER (WHERE severity = 'error' AND status = 'open') AS error_count,
  count(*) FILTER (WHERE severity = 'warning' AND status = 'open') AS warning_count,
  count(*) FILTER (WHERE severity = 'info' AND status = 'open') AS info_count
FROM quality_violations
GROUP BY concept_key;
```

**Per-Department Dashboard:**

Aggregates concept-level scores filtered by department scope. Uses the same `owner_department` scoping as ontology concepts. Returns an array of `ConceptQualityScore` objects for all concepts owned by or visible to a department.

#### Acceptance Criteria

- [ ] Per-record quality score is computed on-read and reflects current violations
- [ ] Records with no applicable rules score 100
- [ ] Per-concept aggregates accurately count open violations by severity
- [ ] Department dashboards filter by department scope
- [ ] Quality score API endpoints require `quality:read` permission

---

### 6. Integration with Data Routing

#### Purpose

Quality checks run before data route propagation so that bad data does not cascade downstream.

#### Detail

When a data route is about to propagate a record change to a downstream concept or system, the routing engine calls the quality engine first:

1. Evaluate all `on_write` rules for the source record.
2. If any `error`-severity violation is detected and the route is configured with `require_quality_pass = true`, the route is blocked and the violation is logged.
3. If only `warning` or `info` violations exist, the route proceeds but the violations are attached to the route execution log.
4. The route execution record includes a `quality_status` field: `passed`, `warnings`, or `blocked`.

This prevents scenarios like: a guest record with missing contract data being propagated to the transport booking system, which would then create an incomplete booking.

#### Acceptance Criteria

- [ ] Quality check runs before route propagation
- [ ] Error-severity violations block routes configured with `require_quality_pass = true`
- [ ] Warning-severity violations are logged but do not block routes
- [ ] Route execution log includes `quality_status`

---

### 7. Integration with Event Bus

#### Purpose

Quality violations fire domain events so that workflows can react to data quality changes.

#### Detail

The quality engine emits the following events:

| Event | When | Payload |
|-------|------|---------|
| `quality.violation.created` | New violation detected | `{ ruleKey, conceptKey, recordId, severity, violationData }` |
| `quality.violation.resolved` | Violation auto-resolved or manually resolved | `{ ruleKey, conceptKey, recordId, resolvedBy }` |
| `quality.violation.suppressed` | Violation suppressed as false positive | `{ ruleKey, conceptKey, recordId, suppressedBy, reason }` |
| `quality.sweep.completed` | Batch quality sweep finished | `{ conceptKey, recordsScanned, violationsFound, violationsResolved }` |

These events enable workflows such as:
- "When an error-severity violation is created for a confirmed guest, notify the assigned liaison"
- "When a quality sweep finds more than 10 new violations, create a task for the data steward"

Events are emitted via the standard `emit()` function on the event bus, with `triggeredBy` set to the actor who caused the write (for on-write) or `"system"` (for on-schedule).

#### Acceptance Criteria

- [ ] All four event types fire at the correct lifecycle points
- [ ] Event payloads contain enough context for workflow conditions
- [ ] Events carry the `change_set` UUID for audit trail linkage
- [ ] Workflow subscriptions to `quality.*` patterns work correctly

---

### 8. Integration with Audit System

#### Purpose

Quality rule changes and violation lifecycle changes are audited.

#### Detail

- The `quality_rules` table has audit triggers (same pattern as other ontology config tables). Changes to rules are recorded in `ontology_audit_log`.
- The `quality_violations` table has audit triggers writing to `domain_audit_log`. Every status change (open -> acknowledged -> resolved) is audited with actor context.
- Quality rule evaluations during on-write execution are part of the same `change_set` as the write that triggered them, so the full chain is traceable: write -> quality check -> violation -> event -> workflow.

#### Acceptance Criteria

- [ ] Quality rule changes appear in `ontology_audit_log`
- [ ] Violation lifecycle changes appear in `domain_audit_log`
- [ ] On-write quality evaluations share the `change_set` UUID of the triggering write

---

## 9. Test Plan

### 9.1 Rule Type Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-01 | Unit | Completeness rule: record missing required field | Violation created with correct severity |
| T-02 | Unit | Completeness rule: record has all required fields | No violation |
| T-03 | Unit | Consistency rule: status='confirmed' without contract | Violation created |
| T-04 | Unit | Consistency rule: status='confirmed' with contract | No violation |
| T-05 | Unit | Referential rule: FK reference to non-existent record | Violation created |
| T-06 | Unit | Referential rule: FK reference valid | No violation |
| T-07 | Unit | Staleness rule: record updated 200 days ago, threshold 180 | Violation created |
| T-08 | Unit | Staleness rule: record updated 100 days ago, threshold 180 | No violation |
| T-09 | Unit | Uniqueness rule: two records with similar names | Violation created on both |
| T-10 | Unit | Uniqueness rule: distinct records | No violation |

### 9.2 Execution Mode Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-11 | Integration | On-write: create guest with status='confirmed', no contract | Violation inserted during write pipeline |
| T-12 | Integration | On-write: update guest to add contract | Previous violation auto-resolved |
| T-13 | Integration | On-write with `quality_block_on_error`: error-severity rule fails | Write returns 409, no record created |
| T-14 | Integration | On-schedule: batch sweep finds 5 violations across 20 records | 5 violation rows inserted, sweep event emitted |
| T-15 | Integration | On-schedule: idempotent re-run | No duplicate violations created |
| T-16 | Integration | On-demand: audit single record | Returns correct violation count |
| T-17 | Integration | On-demand: audit entire concept | Scans all active records |

### 9.3 Quality Score Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-18 | Unit | Record with 3 rules, all passing | Score = 100 |
| T-19 | Unit | Record with 3 rules (weights 1.0, 0.5, 0.5), 1 failing (weight 0.5) | Score = 75 |
| T-20 | Unit | Record with no applicable rules | Score = 100 |
| T-21 | Integration | Concept aggregate with 10 records, 2 with violations | Correct averageScore and counts |

### 9.4 Integration Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-22 | Integration | Quality violation fires `quality.violation.created` event | Event appears in event_log |
| T-23 | Integration | Auto-resolution fires `quality.violation.resolved` event | Event appears in event_log |
| T-24 | Integration | Route with `require_quality_pass` blocked by error violation | Route execution log shows `quality_status = 'blocked'` |
| T-25 | Integration | Quality rule change audited | Row in ontology_audit_log with correct change_set |
| T-26 | Integration | Violation deduplication: same rule+record triggered twice | Only one open violation exists |
| T-27 | Integration | Suppressed violation: re-running rule does not reopen | Suppressed status persists |

### 9.5 Permission Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-28 | Integration | User without `admin:quality` calls on-demand audit | 403 Forbidden |
| T-29 | Integration | User without `quality:read` calls score endpoint | 403 Forbidden |
| T-30 | Integration | Admin creates a quality rule via API | Rule persisted, audit logged |

### Coverage Target

80% minimum across quality engine, rule evaluator, violation lifecycle, and score computation. 100% on the ConditionExpression evaluation path (shared with existing evaluator tests).

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Violations do not block writes by default | Data entry flow takes priority; violations are for awareness and tracking, not gatekeeping. The `quality_block_on_error` flag gives admins opt-in control. |
| Quality scores computed on-read, not cached | Avoids stale score data. At convention scale (hundreds to low thousands of records), the computation is fast enough. |
| ConditionExpression for rule conditions | Reuses the platform's universal logic engine. Admins already know how to build conditions via the condition builder UI. |
| Computed context fields (_has_contract) | Keeps the ConditionExpression evaluator simple and context-agnostic. Referential lookups happen once before evaluation, not inside the expression tree. |
| Separate violations table (not inline on records) | Violations are cross-cutting metadata, not domain data. Keeping them separate avoids polluting domain tables and allows aggregate queries. |
