# ConditionExpression

> **Shorthand:** Recursive discriminated-union expression tree (`field | and | or | not`) evaluated against a flat key-value context to produce a boolean. Ten field operators, arbitrary nesting depth, stored as JSONB in Postgres, consumed by ontology constraints, form visibility, workflows, contract clauses, and RBAC scoping. One evaluation function, one serialization format, one UI builder.

---

## Overview

ConditionExpression is the universal logic engine for the convention operations platform. Every feature that needs "apply X when Y is true" encodes Y as a ConditionExpression. The system is intentionally small -- four node types, ten operators, one evaluator -- so that every team writes conditions the same way and every condition is portable between contexts.

The canonical TypeScript definition lives in `functions/src/ontology/types.ts`. The canonical storage format is the equivalent JSON stored in Postgres JSONB columns. There is no secondary representation; the TypeScript types and the JSONB payload are structurally identical.

### Design Principles

- **Composable.** Any expression can nest inside any other expression. A `NotCondition` wrapping an `AndCondition` wrapping three `FieldCondition`s is valid at any depth.
- **Context-agnostic.** The evaluator takes an expression and a flat `Record<string, unknown>` context. It does not know whether the context is a guest record, a staff record, or a form submission.
- **Single source of truth.** Postgres JSONB is the SOR. Every consumer reads the same column, same shape, same semantics.
- **Fail-safe.** Missing fields and null values resolve to well-defined outcomes (documented below), never to thrown exceptions during evaluation.

---

## Full Specification

### 1. Type System

**Purpose:** Define the four expression node types and ten field operators so that every condition across the platform is structurally valid by construction.

#### 1.1 Union Type

```typescript
type ConditionExpression =
  | FieldCondition
  | AndCondition
  | OrCondition
  | NotCondition
```

The `type` discriminant field on each interface enables exhaustive pattern matching.

#### 1.2 FieldCondition

```typescript
interface FieldCondition {
  readonly type: 'field'
  readonly field: string          // dot-path into context, e.g. "guest.vipTier"
  readonly operator: Operator
  readonly value?: unknown        // omitted for is_empty / is_not_empty
}
```

Operators:

| Operator | Semantics | Value required |
|---|---|---|
| `eq` | Strict equality after type coercion | Yes |
| `neq` | Negation of `eq` | Yes |
| `gt` | Greater than (numeric / date string) | Yes |
| `gte` | Greater than or equal | Yes |
| `lt` | Less than | Yes |
| `lte` | Less than or equal | Yes |
| `contains` | String includes substring, or array includes element | Yes |
| `not_contains` | Negation of `contains` | Yes |
| `is_empty` | Field is `undefined`, `null`, `""`, or `[]` | No |
| `is_not_empty` | Negation of `is_empty` | No |

#### 1.3 AndCondition

```typescript
interface AndCondition {
  readonly type: 'and'
  readonly conditions: ReadonlyArray<ConditionExpression>
}
```

Short-circuit: returns `false` on the first child that evaluates `false`. Empty array evaluates to `true` (vacuous truth).

#### 1.4 OrCondition

```typescript
interface OrCondition {
  readonly type: 'or'
  readonly conditions: ReadonlyArray<ConditionExpression>
}
```

Short-circuit: returns `true` on the first child that evaluates `true`. Empty array evaluates to `false`.

#### 1.5 NotCondition

```typescript
interface NotCondition {
  readonly type: 'not'
  readonly condition: ConditionExpression
}
```

Inverts the boolean result of its single child.

**Acceptance Criteria:**
- TypeScript compiler rejects any object that does not satisfy the union.
- `value` is optional only for `is_empty` and `is_not_empty`; runtime validation rejects missing `value` for all other operators.
- `conditions` array on `and`/`or` must contain at least zero elements (empty is allowed, semantics defined above).

---

### 2. Where It's Used

**Purpose:** Enumerate every consumer so that changes to the expression format or evaluator are tested against all integration points.

#### 2.1 Ontology Constraints

Column: `ontology_constraints.condition` (JSONB).
Determines when a constraint applies to an entity. The ontology engine calls `evaluateCondition` with the entity's property map as context.

#### 2.2 Form Field Visibility

Path: `form_configs.fields[].showIf` (JSONB, nullable).
The `FormFieldConfig` type includes an optional `showIf: ConditionExpression`. The form renderer evaluates `showIf` against the current form values to toggle field visibility in real time.

#### 2.3 Workflow Conditions

Column: `workflow_configs.condition` (JSONB).
A workflow fires only when its condition evaluates to `true` against the triggering event payload. This is checked before any workflow step executes.

#### 2.4 Contract Clause Inclusion

Column: `contract_clauses.condition` (JSONB, nullable).
Determines which clauses appear in a generated contract for a given guest. Context is the guest record plus event metadata.

#### 2.5 RBAC Data Scoping (Future)

Column: TBD.
Today RBAC uses four static scope types. ConditionExpression will replace these with arbitrary scope conditions, enabling rules like "user can view guests where `guest.region eq 'EMEA'` and `guest.vipTier gte 3`."

**Acceptance Criteria:**
- Each consumer column is typed as JSONB in Postgres and validated against `ConditionExpression` at write time.
- A change to the ConditionExpression union type triggers review of all five consumers.
- Each consumer has at least one integration test exercising a compound condition (and + or + field).

---

### 3. Evaluation Engine

**Purpose:** Provide a single, deterministic function that resolves any `ConditionExpression` against a flat context to a boolean.

#### 3.1 Signature

```typescript
function evaluateCondition(
  expression: ConditionExpression,
  context: Record<string, unknown>
): boolean
```

#### 3.2 Field Resolution

The `field` string is used as a direct key lookup on `context`. Dot-path support (e.g., `"address.city"`) is resolved by splitting on `.` and walking nested objects. If any segment is missing, the resolved value is `undefined`.

#### 3.3 Operator Evaluation Rules

| Operator | Logic |
|---|---|
| `eq` | `resolvedValue == expression.value` after coercion (see 3.4) |
| `neq` | `!(eq logic)` |
| `gt` | `Number(resolvedValue) > Number(expression.value)` |
| `gte` | `Number(resolvedValue) >= Number(expression.value)` |
| `lt` | `Number(resolvedValue) < Number(expression.value)` |
| `lte` | `Number(resolvedValue) <= Number(expression.value)` |
| `contains` | If resolved is string: `resolvedValue.includes(expression.value)`. If array: `resolvedValue.includes(expression.value)`. Otherwise `false`. |
| `not_contains` | `!(contains logic)` |
| `is_empty` | `resolvedValue` is `undefined`, `null`, `""`, or an array with length 0 |
| `is_not_empty` | `!(is_empty logic)` |

#### 3.4 Type Coercion

- Numeric operators (`gt`, `gte`, `lt`, `lte`): both sides coerced via `Number()`. If either side is `NaN`, the comparison returns `false`.
- `eq` / `neq`: loose equality (`==`) so that `"3" eq 3` is `true`. If either side is `null` or `undefined`, only `null == undefined` is `true`.
- `contains` / `not_contains`: `expression.value` is coerced to string when `resolvedValue` is a string.

#### 3.5 Compound Evaluation

- `and`: iterate `conditions`, return `false` on first `false`. Empty array returns `true`.
- `or`: iterate `conditions`, return `true` on first `true`. Empty array returns `false`.
- `not`: return `!evaluateCondition(condition, context)`.

#### 3.6 Missing Fields and Null Values

| Scenario | Resolved value | Effect on operators |
|---|---|---|
| Field key not in context | `undefined` | `is_empty` = `true`; `eq undefined` = `true`; numeric comparisons = `false` |
| Field value is `null` | `null` | `is_empty` = `true`; `eq null` = `true`; numeric comparisons = `false` |
| Field value is `""` | `""` | `is_empty` = `true`; `eq ""` = `true`; `contains ""` = `true` |

#### 3.7 Recursion Depth

No hardcoded limit. In practice, the UI builder caps nesting at 4 levels. The evaluator must handle at least 10 levels without stack overflow for programmatically generated conditions.

**Acceptance Criteria:**
- `evaluateCondition` is a pure function with no side effects.
- Every operator has a dedicated unit test for its happy path and its null/undefined/missing-field path.
- Compound nesting at 5+ levels returns correct results.
- `NaN` coercion in numeric operators always returns `false`, never throws.

---

### 4. Serialization

**Purpose:** Define how ConditionExpressions are persisted and validated so that every Postgres column stores a structurally valid expression.

#### 4.1 Storage Format

JSONB in Postgres. The JSON structure mirrors the TypeScript interfaces byte-for-byte (after `JSON.stringify`). No wrapper object, no version envelope -- the column value IS the expression.

Example stored value:

```json
{
  "type": "and",
  "conditions": [
    { "type": "field", "field": "guest.vipTier", "operator": "gte", "value": 2 },
    { "type": "not", "condition": { "type": "field", "field": "guest.banned", "operator": "eq", "value": true } }
  ]
}
```

#### 4.2 Write-Time Validation

Every write path (Cloud Functions, API endpoints) validates the incoming JSON against the `ConditionExpression` type before inserting into Postgres. Validation checks:

- `type` discriminant is one of `field`, `and`, `or`, `not`.
- `FieldCondition.operator` is one of the ten allowed values.
- `FieldCondition.value` is present when operator is not `is_empty` or `is_not_empty`.
- `AndCondition.conditions` and `OrCondition.conditions` are arrays.
- `NotCondition.condition` is a single expression, not an array.
- Recursive: every nested expression passes the same checks.

Validation failures return a 400 with a structured error pointing to the invalid node path.

#### 4.3 Column Locations

| Table | Column | Nullable |
|---|---|---|
| `ontology_constraints` | `condition` | No |
| `workflow_configs` | `condition` | No |
| `form_configs` | `fields[]→showIf` | Yes |
| `contract_clauses` | `condition` | Yes |

#### 4.4 Migration Safety

Adding a new operator or node type requires:
1. Update the TypeScript union in `types.ts`.
2. Update the evaluator.
3. Update write-time validation.
4. Verify no existing stored JSONB contains the new discriminant (shouldn't, but confirm).
5. Update the condition-builder UI to expose the new option.

**Acceptance Criteria:**
- Roundtrip test: construct a deeply nested expression in TypeScript, serialize to JSON, store in Postgres JSONB, read back, deserialize, evaluate -- result matches original in-memory evaluation.
- Invalid JSON rejected at write time with a 400, not a 500.
- Postgres `jsonb_typeof` on every condition column returns `'object'`, never `'null'` on non-nullable columns.

---

### 5. UI Representation

**Purpose:** Specify how the condition-builder-ui component maps to the ConditionExpression type system so that users can build conditions visually.

#### 5.1 Component Reference

See `ui/condition-builder-ui.md` for full UI specification. This section covers only the data contract between the UI and the expression type.

#### 5.2 Builder Structure

The builder renders a tree:
- **Row** = `FieldCondition`. Three inputs: field picker (dropdown of available fields), operator picker (dropdown filtered by field type), value input (text, number, date, or select depending on field type).
- **Group** = `AndCondition` or `OrCondition`. Toggle between AND/OR. Contains one or more rows or nested groups.
- **Negate** = `NotCondition`. A toggle on any row or group that wraps it in `{ type: 'not', condition: ... }`.

#### 5.3 Field Picker Context

Each consumer provides a field schema to the builder:
- Ontology constraints: entity property definitions.
- Form visibility: sibling field keys from the same form config.
- Workflow conditions: event payload schema.
- Contract clauses: guest record + event metadata schema.

#### 5.4 Operator Filtering

The builder filters operators by field type:
- **String fields:** eq, neq, contains, not_contains, is_empty, is_not_empty.
- **Number fields:** eq, neq, gt, gte, lt, lte, is_empty, is_not_empty.
- **Boolean fields:** eq, neq.
- **Array fields:** contains, not_contains, is_empty, is_not_empty.
- **Date fields:** eq, neq, gt, gte, lt, lte, is_empty, is_not_empty.

#### 5.5 Output

The builder emits a `ConditionExpression` JSON object on every change. No intermediate format. The parent form stores this directly into the relevant JSONB column.

**Acceptance Criteria:**
- Builder output passes write-time validation without transformation.
- Every operator available in the type system is reachable through the UI for at least one field type.
- Nesting to 4 levels renders without layout breakage.
- Empty builder (no conditions added) emits `null`, not an empty `and` or `or`.

---

### 6. Test Plan

**Purpose:** Define the full test matrix so that every operator, compound pattern, and edge case is covered before the evaluator ships.

#### 6.1 Unit Tests -- Field Operators

| Test | Expression | Context | Expected |
|---|---|---|---|
| eq match | `{type:'field', field:'x', operator:'eq', value:5}` | `{x: 5}` | `true` |
| eq mismatch | same, value 5 | `{x: 6}` | `false` |
| eq coercion | value `"5"` | `{x: 5}` | `true` |
| neq match | operator `neq`, value 5 | `{x: 6}` | `true` |
| gt true | operator `gt`, value 10 | `{x: 11}` | `true` |
| gt false | operator `gt`, value 10 | `{x: 10}` | `false` |
| gt NaN | operator `gt`, value 10 | `{x: "abc"}` | `false` |
| gte boundary | operator `gte`, value 10 | `{x: 10}` | `true` |
| lt true | operator `lt`, value 10 | `{x: 9}` | `true` |
| lte boundary | operator `lte`, value 10 | `{x: 10}` | `true` |
| contains string | operator `contains`, value `"oo"` | `{x: "food"}` | `true` |
| contains array | operator `contains`, value `3` | `{x: [1,2,3]}` | `true` |
| contains miss | operator `contains`, value `"zz"` | `{x: "food"}` | `false` |
| not_contains | operator `not_contains`, value `"zz"` | `{x: "food"}` | `true` |
| is_empty null | operator `is_empty` | `{x: null}` | `true` |
| is_empty undefined | operator `is_empty` | `{}` | `true` |
| is_empty string | operator `is_empty` | `{x: ""}` | `true` |
| is_empty array | operator `is_empty` | `{x: []}` | `true` |
| is_not_empty | operator `is_not_empty` | `{x: "a"}` | `true` |

#### 6.2 Unit Tests -- Compound Conditions

| Test | Expression | Expected |
|---|---|---|
| and all true | `{type:'and', conditions:[eq true, gt true]}` | `true` |
| and one false | `{type:'and', conditions:[eq true, eq false]}` | `false` |
| and empty | `{type:'and', conditions:[]}` | `true` |
| or one true | `{type:'or', conditions:[eq false, eq true]}` | `true` |
| or all false | `{type:'or', conditions:[eq false, eq false]}` | `false` |
| or empty | `{type:'or', conditions:[]}` | `false` |
| not true | `{type:'not', condition: eq true}` | `false` |
| not false | `{type:'not', condition: eq false}` | `true` |
| nested 3 deep | `and(or(field, field), not(field))` | correct |
| nested 5 deep | `not(and(or(not(and(field, field)), field), field))` | correct |

#### 6.3 Edge Cases

| Test | Scenario | Expected |
|---|---|---|
| Missing field, eq | field `"y"` not in context, eq `5` | `false` |
| Missing field, is_empty | field `"y"` not in context | `true` |
| Null value, contains | `{x: null}`, contains `"a"` | `false` |
| Boolean field, eq true | `{x: true}`, eq `true` | `true` |
| Date string, gt | `{x: "2026-05-01"}`, gt `"2026-04-01"` | `true` |
| Type mismatch, gt | `{x: "not-a-number"}`, gt `5` | `false` |

#### 6.4 Serialization Roundtrip

For each compound test case above:
1. Build the expression object in TypeScript.
2. `JSON.stringify` it.
3. Insert into a Postgres JSONB column.
4. `SELECT` it back.
5. `JSON.parse` the result.
6. Run `evaluateCondition` on the parsed result.
7. Assert the result matches step-1 in-memory evaluation.

#### 6.5 Validation Tests

| Test | Input | Expected |
|---|---|---|
| Unknown type | `{type:'xor', ...}` | 400 error |
| Unknown operator | `{type:'field', operator:'like', ...}` | 400 error |
| Missing value for eq | `{type:'field', field:'x', operator:'eq'}` | 400 error |
| Extra value for is_empty | `{type:'field', field:'x', operator:'is_empty', value:1}` | Accepted (value ignored) |
| conditions not array | `{type:'and', conditions:{}}` | 400 error |
| condition is array | `{type:'not', condition:[...]}` | 400 error |

**Acceptance Criteria:**
- All tests in 6.1 through 6.5 pass in CI.
- Coverage: 100% of branches in `evaluateCondition`.
- No test depends on external services; all use in-memory context objects and (for 6.4) a test Postgres instance.
