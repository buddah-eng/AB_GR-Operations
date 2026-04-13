# Ontology CI/QA Pipeline

Source: `functions/src/ontology/ci-qa.ts`

Every ontology or config mutation flows through a state machine that enforces validation, impact analysis, review gates, and a time-limited rollback window. No change reaches production without passing through this pipeline.

---

## Change Request Lifecycle

```
DRAFT --> VALIDATING --> REVIEW --> STAGED --> APPLIED --> ROLLED_BACK
             |                                    ^
             v                                    |
           DRAFT (validation failed)         (within 24hr)
                        REVIEW --> REJECTED
```

```typescript
export type ChangeRequestStatus =
  | "draft"
  | "validating"
  | "review"
  | "staged"
  | "applied"
  | "rolled_back"
  | "rejected";
```

### Valid State Transitions

```typescript
const VALID_TRANSITIONS: Record<ChangeRequestStatus, ReadonlyArray<ChangeRequestStatus>> = {
  draft:       ["validating"],
  validating:  ["review", "draft"],      // review on success, draft on failure
  review:      ["staged", "rejected"],   // staged on approval, rejected on denial
  staged:      ["applied"],
  applied:     ["rolled_back"],          // within 24-hour window only
  rolled_back: [],                       // terminal
  rejected:    [],                       // terminal
};
```

Any transition not listed above throws an error with the message: `Invalid transition: {current} -> {target}`.

### Stage-by-Stage Behavior

| Transition target | What happens |
|---|---|
| `validating` | Runs `validateChange` and `analyzeImpact`. If validation passes, auto-advances to `review`. If validation fails, returns to `draft` with errors attached. |
| `review` | Evaluates `determineReviewRequirement`. Low-risk additive department changes auto-approve (skip to `staged`). Otherwise, checks that the actor's priority meets the minimum required. |
| `staged` | Marks the change as staged (preview). No side effects. |
| `applied` | Calls `updateOntologyRecord` via the versioning service, logs an audit claim, emits a `config.applied` domain event, and records `applied_at` and `change_set`. |
| `rolled_back` | Validates the 24-hour rollback window, emits a `config.rolled_back` domain event, and updates status. |
| `rejected` | Records the reviewer and sets status to `rejected`. Terminal state. |

---

## Change Request Data Model

```typescript
export interface ChangeRequest {
  readonly id: string;
  readonly status: ChangeRequestStatus;
  readonly table_name: string;              // target ontology/config table
  readonly record_key: string;              // key of the record being changed
  readonly changes: Record<string, unknown>; // proposed field values
  readonly owner_scope: string;             // "org" | "department"
  readonly owner_department: string | null;
  readonly risk_level: RiskLevel | null;    // set after validation
  readonly validation_errors: ReadonlyArray<string>;
  readonly impact_report: ImpactReport | null;
  readonly created_by: string;
  readonly reviewed_by: string | null;
  readonly applied_at: string | null;
  readonly change_set: string | null;       // audit change set ID
  readonly created_at: string;
  readonly updated_at: string;
}
```

---

## Creating a Change Request

```typescript
export async function createChangeRequest(
  tableName: string,
  recordKey: string,
  changes: Record<string, unknown>,
  ownerScope: string,
  ownerDepartment: string | null,
  createdBy: string
): Promise<ChangeRequest>;
```

Inserts a new row into `config_change_requests` with `status = 'draft'`. The change request must then be advanced through the pipeline via `advanceChangeRequest`.

---

## Advancing Through the Pipeline

```typescript
export async function advanceChangeRequest(
  requestId: string,
  targetStatus: ChangeRequestStatus,
  actorId: string,
  actorPriority: number
): Promise<ChangeRequest>;
```

Fetches the current request, validates the transition against `VALID_TRANSITIONS`, then executes the logic for the target status. Returns the updated change request.

---

## Validation Checks

```typescript
export async function validateChange(
  tableName: string,
  recordKey: string,
  changes: Record<string, unknown>
): Promise<ValidationResult>;
```

```typescript
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly riskLevel: RiskLevel;
}
```

### Structural Checks

**Table whitelist.** The `table_name` must be one of:

```
ontology_concepts, ontology_properties, ontology_relationships,
ontology_events, ontology_constraints, form_configs, view_configs,
page_configs, workflow_configs
```

Any other table name immediately fails validation with risk level `high`.

**Required fields.** Each table has required fields that must not be null, undefined, or empty string when present in the change payload:

| Table | Required fields |
|---|---|
| `ontology_concepts` | `key`, `name` |
| `ontology_properties` | `key`, `label`, `type`, `concept_key` |
| `ontology_relationships` | `key`, `source_concept_key`, `target_concept_key`, `cardinality` |
| `ontology_events` | `event_key`, `concept_key`, `trigger_type` |
| `ontology_constraints` | `name`, `concept_key` |
| `form_configs` | `concept_key`, `name` |
| `view_configs` | `concept_key`, `name`, `view_type` |
| `page_configs` | `name`, `slug` |
| `workflow_configs` | `name` |

**Enum validation.** If a field appears in the change payload and has a constrained value set, the value is validated:

| Field | Allowed values |
|---|---|
| `type` | `text`, `rich_text`, `number`, `select`, `multi_select`, `date`, `datetime`, `checkbox`, `url`, `email`, `phone`, `relation`, `formula`, `rollup`, `files`, `people`, `status` |
| `cardinality` | `has-one`, `has-many`, `many-to-many` |
| `trigger_type` | `on_create`, `on_update`, `on_delete`, `on_field_change`, `scheduled`, `manual` |
| `view_type` | `table`, `kanban`, `timeline`, `detail`, `dashboard` |
| `layout` | `single`, `two-column`, `wizard` |
| `owner_scope` | `org`, `department` |

### Cross-System Reference Checks

When deleting an `ontology_properties` record (change type = `deletion`), the pipeline queries `form_configs`, `view_configs`, and `workflow_configs` for active records that reference the property key. Any references produce validation errors listing the config names.

### Risk Assessment

```typescript
export type ChangeType = "additive" | "modification" | "deletion";
export type RiskLevel = "low" | "medium" | "high";
```

Risk level is determined by the inferred change type:

| Change type | Risk level | Inference rule |
|---|---|---|
| `additive` | `low` | Change payload contains only core definition fields (`key`, `name`, `label`, `type`, `concept_key`, `description`). |
| `modification` | `medium` | Change payload contains fields beyond core definition fields. |
| `deletion` | `high` | Change payload sets `status` to `deprecated`, `deleted`, or `removed`. |

---

## Review Gates

```typescript
export function determineReviewRequirement(
  riskLevel: RiskLevel | string,
  ownerScope: string,
  changeType: ChangeType
): ReviewRequirement;
```

```typescript
export interface ReviewRequirement {
  readonly requiresReview: boolean;
  readonly minimumPriority: number;  // actor.priority must be <= this value
  readonly reason: string;
}
```

### Review Matrix

| Risk | Scope | Change type | Review required? | Minimum priority | Reason |
|---|---|---|---|---|---|
| `low` | `department` | `additive` | No (auto-approve) | 100 | Low-risk additive department change |
| `high` | any | any | Yes | 10 (admin) | High-risk change requires admin review |
| any | `org` | any | Yes | 10 (admin) | Org-wide change requires admin review |
| `medium` | `department` | any | Yes | 20 (director) | Medium-risk change requires director review |

When review is required and the actor's priority exceeds `minimumPriority`, the transition throws: `Insufficient review authority. Required priority <= {min}, got {actual}.`

When a change is auto-approved, the actor is recorded as the reviewer and the request advances directly to `staged`.

---

## Impact Analysis

```typescript
export async function analyzeImpact(
  tableName: string,
  recordKey: string,
  changeType: ChangeType
): Promise<ImpactReport>;
```

```typescript
export interface ImpactReport {
  readonly affectedRecords: number;
  readonly referencingConfigs: ReadonlyArray<string>;  // format: "{table}:{name}"
  readonly riskLevel: RiskLevel;
}
```

| Change type | Affected records | Referencing configs | Risk |
|---|---|---|---|
| `additive` | 0 | `[]` | `low` |
| `modification` | Count of active records with matching `key` in the target table | Configs in `form_configs`, `view_configs`, `workflow_configs` that reference the key | `medium` |
| `deletion` | Same as modification | Same as modification | `high` |

Impact analysis runs alongside validation during the `draft -> validating` transition. The report is stored on the change request as `impact_report`.

---

## Rollback Window

Applied changes can be rolled back within a 24-hour window (86,400,000 ms).

```typescript
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
```

### Rollback Conditions

1. The change request must have `status = 'applied'` and a non-null `applied_at` timestamp.
2. `Date.now() - applied_at` must be less than or equal to `ROLLBACK_WINDOW_MS`.
3. If the window has expired, the transition throws: `Rollback window expired. Changes can only be rolled back within 24 hours of application.`

### Rollback Behavior

On rollback:
- A `config.rolled_back` domain event is emitted with the change request ID in metadata.
- The change request status is set to `rolled_back` (terminal state).
- The actual record reversion relies on the versioning service's `previous_version_id` chain. The CI/QA pipeline records the event; the versioning layer handles restoring the prior state.

### After the Window

Once the 24-hour window expires, the change is considered permanent. Corrections must be submitted as new change requests through the full pipeline.

---

## Integration Points

| System | Integration |
|---|---|
| **Versioning service** (`versioning/service.ts`) | `updateOntologyRecord` is called during `applied` to persist the change with version tracking. |
| **Audit context** (`audit/context.ts`) | `createAuditContext` and `logAuditClaim` record who applied the change and via which endpoint. |
| **Event bus** (`events/bus.ts`) | `config.applied` and `config.rolled_back` domain events are emitted for downstream consumers. |
| **Scoping** (`ontology/scoping.ts`) | `owner_scope` and `owner_department` on the change request determine review gate thresholds. |

---

## Table: `config_change_requests`

The pipeline persists all state in the `config_change_requests` table. Key columns:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `status` | `text` | Current lifecycle state |
| `table_name` | `text` | Target ontology/config table |
| `record_key` | `text` | Key of the record being changed |
| `changes` | `jsonb` | Proposed field values |
| `owner_scope` | `text` | `"org"` or `"department"` |
| `owner_department` | `text` | Nullable; set for department-scoped changes |
| `risk_level` | `text` | Set after validation (`low`, `medium`, `high`) |
| `validation_errors` | `jsonb` | Array of error strings from validation |
| `impact_report` | `jsonb` | Serialized `ImpactReport` |
| `created_by` | `text` | Actor who created the request |
| `reviewed_by` | `text` | Actor who approved or rejected |
| `applied_at` | `timestamptz` | When the change was applied (rollback window anchor) |
| `change_set` | `text` | Audit change set ID from the versioning service |
| `created_at` | `timestamptz` | Row creation time |
| `updated_at` | `timestamptz` | Last status update time |
