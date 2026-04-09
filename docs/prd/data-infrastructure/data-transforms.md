# Data Transformation Engine

> **Composable, type-safe transforms applied during data routing.** Not just PII stripping -- format conversion (dates, phones), computed fields (formulas), aggregations (count, sum), conditional logic (if type=JP then origin=Japan), field renaming, static value injection. Transform chains execute in sequence. Definitions stored as JSONB using the same composable pattern as ConditionExpression. Reusable across multiple routes. Validated at definition time, executed at routing time.

---

## Overview

Data routing (see `data-infrastructure/data-routing.md`) moves fields from source to destination. But raw field values are rarely sufficient -- dates need reformatting, phone numbers need normalization, computed values need calculating, and conditional logic needs applying. The transformation engine sits between PII filtering and field mapping in the route execution pipeline, applying a chain of transforms to produce the final projection values.

Transforms are defined as JSONB in Postgres, following the same composable, nestable pattern as ConditionExpression (`core/condition-expression.md`). Each transform has a `type` discriminant and type-specific parameters. Transforms can be chained (executed sequentially), composed (nested within conditional logic), and reused (referenced by ID across multiple routes).

The engine validates transforms at definition time -- checking type compatibility, field existence, and formula syntax -- so that routing failures at execution time are minimized.

**Dependencies:** `data-infrastructure/data-routing.md`, `core/condition-expression.md`, `core/ontology-engine.md`

---

## 1. Transform Types

### Purpose

Define the complete set of transform operations available during data routing.

### Detail

Each transform operates on a single field value or the entire record context, producing a modified value or new field.

#### 1.1 field_rename

Rename a field key without changing its value. Useful when source and destination use different naming conventions.

```json
{
  "type": "field_rename",
  "source_field": "guest_name",
  "target_field": "display_name"
}
```

#### 1.2 field_strip

Remove a field from the record entirely. Used for explicit exclusion beyond PII filtering.

```json
{
  "type": "field_strip",
  "field": "internal_notes"
}
```

#### 1.3 pii_strip

Remove all fields marked as `encrypted: true` in the ontology. This is the same logic as the route's PII filter but available as an explicit transform step for pipelines that compose transforms independently of routes.

```json
{
  "type": "pii_strip"
}
```

#### 1.4 format

Convert a field value to a specific format. Supports date, phone, currency, and text case transformations.

```json
{
  "type": "format",
  "field": "arrival_date",
  "format_type": "date",
  "params": {
    "input_format": "ISO8601",
    "output_format": "MM/DD/YYYY"
  }
}
```

**Supported format_type values:**

| format_type | Params | Example |
|-------------|--------|---------|
| `date` | `input_format`, `output_format` | ISO8601 to "Apr 8, 2026" |
| `phone` | `country_code`, `format` (E.164, national, international) | "+18005551234" to "(800) 555-1234" |
| `currency` | `currency_code`, `locale` | 1500 to "$1,500.00" |
| `text_case` | `case` (upper, lower, title, sentence) | "john smith" to "John Smith" |
| `number` | `decimal_places`, `locale` | 3.14159 to "3.14" |
| `truncate` | `max_length`, `suffix` | "Long text..." truncated to N chars |

#### 1.5 compute

Calculate a new field value from existing fields using a formula expression. Formulas support basic arithmetic, string concatenation, and date math.

```json
{
  "type": "compute",
  "target_field": "full_name",
  "formula": "concat({{first_name}}, ' ', {{last_name}})"
}
```

**Supported formula functions:**

| Function | Args | Returns | Example |
|----------|------|---------|---------|
| `concat` | `...strings` | text | `concat({{first}}, ' ', {{last}})` |
| `add` | `a, b` | number | `add({{base_cost}}, {{tax}})` |
| `subtract` | `a, b` | number | `subtract({{budget}}, {{spent}})` |
| `multiply` | `a, b` | number | `multiply({{rate}}, {{hours}})` |
| `divide` | `a, b` | number | `divide({{total}}, {{count}})` |
| `date_add` | `date, amount, unit` | date | `date_add({{start}}, 3, 'days')` |
| `date_diff` | `date1, date2, unit` | number | `date_diff({{end}}, {{start}}, 'hours')` |
| `coalesce` | `...values` | first non-null | `coalesce({{nickname}}, {{first_name}})` |
| `if_then` | `condition, then, else` | varies | `if_then({{is_vip}}, 'VIP', 'Standard')` |

#### 1.6 aggregate

Compute an aggregate value across related records. Used in pipeline contexts where multiple source records produce a summary destination record.

```json
{
  "type": "aggregate",
  "source_field": "amount",
  "operation": "sum",
  "target_field": "total_amount",
  "group_by": "department"
}
```

**Supported operations:** `count`, `sum`, `avg`, `min`, `max`, `count_distinct`.

#### 1.7 static

Inject a constant value into the record. Useful for tagging projections with metadata.

```json
{
  "type": "static",
  "target_field": "source_system",
  "value": "gr-ops-platform"
}
```

#### 1.8 conditional

Apply a transform only when a condition is met. Uses the ConditionExpression evaluator (`core/condition-expression.md`) for the condition check.

```json
{
  "type": "conditional",
  "condition": {
    "type": "field",
    "field": "type",
    "operator": "eq",
    "value": "JP"
  },
  "then_transforms": [
    { "type": "static", "target_field": "origin_country", "value": "Japan" },
    { "type": "static", "target_field": "interpreter_required", "value": true }
  ],
  "else_transforms": [
    { "type": "static", "target_field": "origin_country", "value": "Domestic" },
    { "type": "static", "target_field": "interpreter_required", "value": false }
  ]
}
```

The `condition` field accepts any valid `ConditionExpression` -- including nested `and`/`or`/`not` compounds. `then_transforms` and `else_transforms` are arrays of transforms that execute based on the condition result. Both are optional; omitting `else_transforms` means no action on false.

#### 1.9 lookup

Enrich the record with data from a related concept. Queries a target concept by a match field and copies specified fields into the current record.

```json
{
  "type": "lookup",
  "target_concept": "department",
  "match_field": "department_id",
  "match_source_field": "dept_id",
  "copy_fields": ["department_name", "department_head"]
}
```

### Acceptance Criteria

- [ ] All nine transform types are implemented and callable
- [ ] Each transform type validates its required parameters at definition time
- [ ] `conditional` transforms use the shared ConditionExpression evaluator
- [ ] `compute` formulas resolve `{{field}}` tokens from the record context
- [ ] `aggregate` operations produce correct results for count, sum, avg, min, max, count_distinct
- [ ] Unknown transform types are rejected at definition time with a descriptive error

---

## 2. Transform Chain

### Purpose

Define how multiple transforms execute in sequence to produce a final result.

### Detail

A transform chain is an ordered array of transforms. Each transform receives the output of the previous transform (or the original record for the first transform). The chain executes left-to-right with no parallelism within a single chain.

```json
{
  "transforms": [
    { "type": "pii_strip" },
    { "type": "field_rename", "source_field": "guest_name", "target_field": "name" },
    { "type": "format", "field": "arrival_date", "format_type": "date", "params": { "output_format": "MMM D, YYYY" } },
    { "type": "compute", "target_field": "display_label", "formula": "concat({{name}}, ' (', {{type}}, ')')" },
    { "type": "conditional", "condition": { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
      "then_transforms": [
        { "type": "static", "target_field": "language_support", "value": "Japanese interpreter assigned" }
      ]
    }
  ]
}
```

**Execution model:**

```
Input record → Transform 1 → Modified record → Transform 2 → ... → Final record
```

Each transform returns a new record object (immutable -- the input is never mutated). The chain function signature:

```typescript
async function executeTransformChain(
  record: Readonly<Record<string, unknown>>,
  transforms: ReadonlyArray<TransformDefinition>,
  context: TransformContext
): Promise<Record<string, unknown>>
```

**TransformContext** provides:
- `ontologyProperties`: property definitions for type checking
- `conditionEvaluator`: the shared ConditionExpression evaluator
- `encryptionMetadata`: which fields are PII (for pii_strip)
- `lookupFn`: function to query related concepts (for lookup transforms)

**Error handling in chains:** If a transform fails, the chain halts and the route execution records the error. No partial results are written to the destination. This is consistent with the workflow engine's transaction model.

### Acceptance Criteria

- [ ] Transforms execute in array order, each receiving the previous transform's output
- [ ] Input records are never mutated (immutable pattern)
- [ ] A failing transform halts the chain -- no partial results
- [ ] Empty transform array returns the input record unchanged
- [ ] Chain of 10+ transforms executes correctly without context loss
- [ ] Transform outputs are type-safe -- a `format` transform on a number field produces a string

---

## 3. Transform Storage

### Purpose

Define how transform definitions are stored in Postgres -- either as standalone reusable transforms or embedded in route configuration.

### Detail

**Standalone transforms** are stored in the `data_transforms` table and referenced by ID from routes:

```sql
CREATE TABLE data_transforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  transforms      JSONB NOT NULL,          -- array of transform definitions
  input_concept   TEXT,                    -- optional: expected source concept for validation
  output_fields   TEXT[],                  -- optional: fields the chain produces (documentation)

  -- Lifecycle
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  owner_department TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, version)
);

CREATE INDEX idx_data_transforms_status ON data_transforms (status) WHERE status = 'active';
CREATE INDEX idx_data_transforms_concept ON data_transforms (input_concept) WHERE status = 'active';
```

**Embedded transforms** are stored directly in the route's JSONB configuration. This is a convenience for simple, one-off transforms that do not need reuse. The route's `transform_id` is NULL, and the route table includes an additional `inline_transforms` JSONB column:

```sql
ALTER TABLE data_routes ADD COLUMN inline_transforms JSONB;
-- Either transform_id OR inline_transforms can be set, not both
ALTER TABLE data_routes ADD CONSTRAINT chk_transform_source
  CHECK (NOT (transform_id IS NOT NULL AND inline_transforms IS NOT NULL));
```

**Reuse model:** A standalone transform can be referenced by multiple routes. Updating a standalone transform (creating a new version) does not retroactively change existing routes -- routes reference a specific transform version. Routes can be updated to point to the new version.

### Acceptance Criteria

- [ ] `data_transforms` table exists with all specified columns
- [ ] Transforms stored as JSONB array validate against the transform type schema
- [ ] A route can reference a standalone transform by ID or embed inline transforms
- [ ] A route cannot have both `transform_id` and `inline_transforms` (constraint enforced)
- [ ] Standalone transforms are versioned -- updates create new versions
- [ ] Multiple routes can reference the same standalone transform

---

## 4. Transform Validation

### Purpose

Validate transform definitions at creation time to catch errors before routing execution.

### Detail

**Validation checks per transform type:**

| Transform Type | Validation |
|----------------|------------|
| `field_rename` | `source_field` exists on input concept; `target_field` does not conflict with existing fields |
| `field_strip` | `field` exists on input concept |
| `pii_strip` | No validation needed (operates on metadata) |
| `format` | `field` exists; `format_type` is supported; `params` match the format type's requirements |
| `compute` | All `{{field}}` tokens in formula resolve to existing fields; formula syntax is valid |
| `aggregate` | `source_field` exists; `operation` is supported; `target_field` specified |
| `static` | `target_field` specified; `value` type is compatible with target field's ontology type |
| `conditional` | `condition` is a valid ConditionExpression; `then_transforms` and `else_transforms` are valid transform arrays (recursive validation) |
| `lookup` | `target_concept` exists; `match_field` exists on target concept; `copy_fields` exist on target concept |

**Type compatibility checking:** When a `format` transform converts a date field to a string, the validator warns if the destination field type is `datetime` (type mismatch). When a `compute` transform adds two fields, the validator checks both are numeric. These are warnings, not hard errors -- the admin may know the data better than the schema.

**Validation API:**

```
POST /api/data-transforms/validate
Body: { transforms: [...], input_concept: "guest" }
Response: { valid: true/false, errors: [...], warnings: [...] }
```

### Acceptance Criteria

- [ ] All transform types are validated at creation time
- [ ] Invalid `{{field}}` tokens in compute formulas produce validation errors
- [ ] Invalid ConditionExpression in conditional transforms produce validation errors
- [ ] Type mismatches produce warnings (not errors)
- [ ] Validation API returns structured errors with field-level detail
- [ ] Recursive validation catches errors in nested conditional transforms

---

## 5. Integration with ConditionExpression

### Purpose

Define how the conditional transform type uses the shared ConditionExpression evaluator.

### Detail

The `conditional` transform's `condition` field accepts the exact same `ConditionExpression` type used by workflows, forms, RBAC, and contracts. The transform engine calls `evaluateCondition(condition, record)` where `record` is the current state of the record in the transform chain.

**Context passed to evaluator:**

```typescript
const context: Record<string, unknown> = {
  ...currentRecord,              // all fields of the record at this point in the chain
  _sourceConceptKey: 'guest',    // metadata about the source
  _routeName: 'guest-to-pr',    // metadata about the route
}
```

This means conditional transforms can use any field in the record -- including fields added by earlier transforms in the chain (e.g., a `compute` transform that adds `is_international` can be checked by a subsequent `conditional` transform).

**Nesting:** Conditional transforms can contain other conditional transforms in their `then_transforms` or `else_transforms` arrays. The evaluator handles arbitrary nesting depth.

### Acceptance Criteria

- [ ] Conditional transforms use the shared `evaluateCondition()` function
- [ ] Condition evaluation has access to all fields including those added by earlier transforms
- [ ] Nested conditional transforms (conditional inside conditional) evaluate correctly
- [ ] Missing fields in condition evaluation resolve to `false` (fail-safe, per ConditionExpression spec)
- [ ] Empty `conditions` array in an `and` compound evaluates to `true` (vacuous truth, per spec)

---

## 6. Concrete Examples

### Purpose

Demonstrate transform chains for real convention operations scenarios.

### Detail

#### 6.1 Guest to PR Profile

Strip PII, format dates for display, add computed display name, conditionally set language.

```json
{
  "name": "guest-to-pr-profile",
  "transforms": [
    { "type": "pii_strip" },
    { "type": "field_rename", "source_field": "name", "target_field": "display_name" },
    { "type": "format", "field": "bio", "format_type": "truncate", "params": { "max_length": 280, "suffix": "..." } },
    { "type": "conditional",
      "condition": { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
      "then_transforms": [
        { "type": "static", "target_field": "origin", "value": "Japan" },
        { "type": "static", "target_field": "requires_interpreter_note", "value": true }
      ],
      "else_transforms": [
        { "type": "static", "target_field": "origin", "value": "Domestic" }
      ]
    },
    { "type": "static", "target_field": "profile_source", "value": "gr-ops" }
  ]
}
```

#### 6.2 Guest to Transport Booking

Extract only transport-relevant fields, format dates for driver view.

```json
{
  "name": "guest-to-transport",
  "transforms": [
    { "type": "pii_strip" },
    { "type": "field_strip", "field": "bio" },
    { "type": "field_strip", "field": "panel_topics" },
    { "type": "format", "field": "arrival_date", "format_type": "date", "params": { "output_format": "ddd MMM D, h:mm A" } },
    { "type": "compute", "target_field": "pickup_label", "formula": "concat({{name}}, ' - ', {{flight_number}})" }
  ]
}
```

#### 6.3 Schedule Events to Guidebook Sessions

Format for Guidebook API consumption.

```json
{
  "name": "schedule-to-guidebook",
  "transforms": [
    { "type": "field_rename", "source_field": "title", "target_field": "name" },
    { "type": "format", "field": "start_time", "format_type": "date", "params": { "output_format": "ISO8601" } },
    { "type": "format", "field": "end_time", "format_type": "date", "params": { "output_format": "ISO8601" } },
    { "type": "lookup", "target_concept": "venue", "match_field": "id", "match_source_field": "venue_id",
      "copy_fields": ["venue_name", "room_number"] },
    { "type": "compute", "target_field": "location_display", "formula": "concat({{venue_name}}, ' - Room ', {{room_number}})" },
    { "type": "conditional",
      "condition": { "type": "field", "field": "is_public", "operator": "eq", "value": true },
      "then_transforms": [
        { "type": "static", "target_field": "publish_status", "value": "ready" }
      ],
      "else_transforms": [
        { "type": "static", "target_field": "publish_status", "value": "hidden" }
      ]
    }
  ]
}
```

### Acceptance Criteria

- [ ] All three examples execute without errors against valid test data
- [ ] Guest-to-PR example strips all PII fields and produces a public-safe profile
- [ ] Guest-to-Transport example produces a driver-friendly record with formatted dates
- [ ] Schedule-to-Guidebook example enriches records with venue lookup data

---

## 7. Test Plan

### 7.1 Individual Transform Type Tests

| Test | Type | Transform | Input | Expected |
|------|------|-----------|-------|----------|
| TX-01 | Unit | `field_rename` | `{guest_name: "Alice"}` | `{display_name: "Alice"}` |
| TX-02 | Unit | `field_strip` | `{name: "Alice", notes: "internal"}` | `{name: "Alice"}` |
| TX-03 | Unit | `pii_strip` | Record with email (encrypted=true) | Email field removed |
| TX-04 | Unit | `format` (date) | `{date: "2026-04-08T10:00:00Z"}` | `{date: "Apr 8, 2026"}` |
| TX-05 | Unit | `format` (phone) | `{phone: "+18005551234"}` | `{phone: "(800) 555-1234"}` |
| TX-06 | Unit | `format` (text_case) | `{name: "john smith"}` | `{name: "John Smith"}` |
| TX-07 | Unit | `format` (truncate) | `{bio: "A".repeat(500)}` | `{bio: "A".repeat(277) + "..."}` |
| TX-08 | Unit | `format` (currency) | `{amount: 1500}` | `{amount: "$1,500.00"}` |
| TX-09 | Unit | `compute` (concat) | `{first: "Alice", last: "Smith"}` | `{full_name: "Alice Smith"}` |
| TX-10 | Unit | `compute` (add) | `{base: 100, tax: 15}` | `{total: 115}` |
| TX-11 | Unit | `compute` (date_add) | `{start: "2026-04-08"}` | `{end: "2026-04-11"}` (3 days) |
| TX-12 | Unit | `compute` (coalesce) | `{nickname: null, first: "Alice"}` | `{display: "Alice"}` |
| TX-13 | Unit | `aggregate` (sum) | Array of `{amount: 10}` x 5 | `{total: 50}` |
| TX-14 | Unit | `aggregate` (count) | Array of 7 records | `{count: 7}` |
| TX-15 | Unit | `aggregate` (avg) | `[{v:10},{v:20},{v:30}]` | `{avg: 20}` |
| TX-16 | Unit | `static` | `{}` | `{source: "gr-ops"}` |
| TX-17 | Unit | `conditional` (true branch) | `{type: "JP"}` | `{origin: "Japan"}` |
| TX-18 | Unit | `conditional` (false branch) | `{type: "NA"}` | `{origin: "Domestic"}` |
| TX-19 | Unit | `conditional` (no else) | `{type: "NA"}` | Record unchanged |
| TX-20 | Unit | `lookup` | Record with dept_id matching a department | Department name copied |
| TX-21 | Unit | `lookup` (no match) | Record with nonexistent dept_id | Record unchanged, no error |

### 7.2 Transform Chain Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| TC-01 | Unit | Chain of 3 transforms: strip, rename, format | Final record has all three transforms applied in order |
| TC-02 | Unit | Empty chain | Input record returned unchanged |
| TC-03 | Unit | Chain where transform 2 uses field added by transform 1 | Works correctly |
| TC-04 | Unit | Chain with failing transform in middle | Chain halts, error returned, no partial output |
| TC-05 | Unit | Chain of 15 transforms | All execute correctly in order |
| TC-06 | Unit | Immutability check: input record after chain | Input record object unchanged |

### 7.3 Validation Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| V-01 | Unit | `field_rename` with nonexistent source field | Validation error |
| V-02 | Unit | `compute` with invalid formula syntax | Validation error |
| V-03 | Unit | `compute` with unresolvable `{{field}}` token | Validation error |
| V-04 | Unit | `conditional` with invalid ConditionExpression | Validation error |
| V-05 | Unit | `format` with unsupported format_type | Validation error |
| V-06 | Unit | `aggregate` with unsupported operation | Validation error |
| V-07 | Unit | Nested conditional with invalid inner transform | Validation error with path |
| V-08 | Unit | Type mismatch (format date on number field) | Validation warning |

### 7.4 Integration Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| I-01 | Integration | Create standalone transform, reference from route, execute route | Transform applied to projection |
| I-02 | Integration | Update standalone transform (new version), route still uses old version | Old transform behavior preserved |
| I-03 | Integration | Route with inline transforms, execute route | Inline transforms applied |
| I-04 | Integration | Guest-to-PR example with real ontology data | PII stripped, dates formatted, conditional applied |

### 7.5 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| Chain of 20 transforms on single record | Execute once | < 10ms |
| Chain of 5 transforms on 1,000 records (batch) | Backfill scenario | < 5s |
| Lookup transform with 10,000 target records | Single lookup | < 50ms (indexed) |

**Coverage target:** >=80% on transform executor and chain runner. 100% on validation logic.

---

## 8. Dependencies

| PRD | Relationship |
|-----|-------------|
| `data-infrastructure/data-routing.md` | Transforms are applied during route execution |
| `core/condition-expression.md` | Conditional transforms use the shared evaluator |
| `core/ontology-engine.md` | Validation checks field existence and types against ontology |
| `data/encryption.md` | `pii_strip` uses the encrypted flag from ontology properties |
| `platform/template-infrastructure.md` | Standalone transforms can be stored as reusable templates |
