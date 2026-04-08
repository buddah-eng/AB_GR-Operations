# Condition Builder UI

> **Shorthand:** Shared Vue component (`<ConditionBuilder>`) that renders a visual tree editor for `ConditionExpression` JSON. Field picker loaded from ontology store, operators filtered by field type, compound AND/OR/NOT grouping with drag-reorder and nested indentation, human-readable preview below the builder. One component consumed by form `showIf`, workflow conditions, constraint conditions, and contract clause conditions. Outputs valid `ConditionExpression` JSONB on every change — no intermediate format. Postgres is the SOR.

---

## Overview

The Condition Builder UI is the single visual interface for constructing `ConditionExpression` objects across the entire platform. Rather than requiring users to write JSON or understand the expression tree, this component provides a drag-and-drop tree builder where each row is a field condition and rows can be grouped into AND/OR blocks with optional NOT negation.

The component is framework-level infrastructure — it is embedded inside the ontology web builder's Constraint Editor (`core/ontology-web-builder.md` Section 4), inside the form builder's field `showIf` panel (`ui/form-view-builder.md` Section 1), inside the workflow builder's condition panel (`automation/workflow-builder.md`), and inside the contract clause editor (`ui/in-app-documents.md` Section 5). Every consumer passes a `conceptKey` prop; the builder loads that concept's properties from the ontology store and populates the field picker accordingly.

The output is always a valid `ConditionExpression` as defined in `core/condition-expression.md`. There is no adapter layer between the builder and the database — the emitted JSON is stored directly into the relevant JSONB column (`ontology_constraints.condition`, `form_configs.fields[]→showIf`, `workflow_configs.condition`, `contract_clauses.condition`).

**Dependencies:** `core/condition-expression.md` (type system, evaluation engine), `core/ontology-engine.md` (property definitions), `data/postgres-schema.md` (JSONB storage columns)

---

## Full Specification

### 1. Component API

**Purpose:** Define the public interface so that every consumer integrates the builder identically.

**Detail:**

```vue
<ConditionBuilder
  v-model="expression"
  :conceptKey="'guest'"
  :fieldSchema="customFields"    <!-- optional override -->
  :maxDepth="4"                  <!-- default: 4 -->
  :readonly="false"              <!-- default: false -->
/>
```

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `modelValue` | `ConditionExpression \| null` | Yes | `null` | Two-way binding via `v-model`. The expression tree. |
| `conceptKey` | `string` | Yes | — | Ontology concept key. The builder loads properties for this concept from the ontology store. |
| `fieldSchema` | `FieldSchema[]` | No | `null` | Optional override. When provided, the builder uses this field list instead of loading from the ontology. Used by workflow conditions where the context is an event payload, not a concept. |
| `maxDepth` | `number` | No | `4` | Maximum nesting depth for compound groups. The UI prevents adding a group beyond this depth. |
| `readonly` | `boolean` | No | `false` | When true, the builder renders the tree but all controls are disabled. Used for review screens. |

**Events:**

| Event | Payload | When |
|-------|---------|------|
| `update:modelValue` | `ConditionExpression \| null` | Every change — field selection, operator change, value change, group restructure, drag-reorder. |
| `valid` | `boolean` | After every change. `true` if the current expression passes client-side validation. `false` if incomplete (e.g., a field row has no operator selected). |

**Output contract:** The emitted `ConditionExpression` is structurally identical to the JSONB stored in Postgres. No transformation, no wrapper, no version envelope. When the user clears all conditions, the component emits `null` — not an empty `{ type: 'and', conditions: [] }`.

**Usage across consumers:**

| Consumer | conceptKey | fieldSchema override | Storage column |
|----------|------------|---------------------|----------------|
| Ontology Constraint Editor | Entity concept key | No | `ontology_constraints.condition` |
| Form field `showIf` | Form's concept key | No | `form_configs.fields[]→showIf` |
| Workflow condition | — | Yes (event payload schema) | `workflow_configs.condition` |
| Contract clause condition | `'guest'` | No (guest + event metadata merged) | `contract_clauses.condition` |

**Acceptance Criteria:**
- `v-model` binding emits valid `ConditionExpression` on every structural change.
- Emitting `null` when all conditions are removed, not an empty compound node.
- `fieldSchema` override completely replaces ontology-loaded fields when provided.
- `readonly` mode renders the full tree with all controls disabled; no structural changes possible.
- `maxDepth` prevents adding a new group when the current depth equals the limit; the "Add Group" button is disabled with a tooltip.

---

### 2. Field Picker

**Purpose:** Let the user select which field (property) the condition evaluates, scoped to the relevant concept.

**Detail:**

The field picker is a searchable dropdown that lists all non-deprecated properties for the concept identified by `conceptKey`. Properties are loaded from the ontology store (`core/ontology-engine.md` Section 1.2) on component mount and whenever `conceptKey` changes.

Each option displays:
- **Label** — the property's `label` field (e.g., "VIP Tier").
- **Key** — the property's `key` in muted text (e.g., `vipTier`).
- **Type badge** — a small colored pill showing the property type (e.g., "number", "select").

The dropdown groups properties by category when the concept has more than 15 properties: core typed columns first, then JSONB dynamic properties, then inherited properties (from `extends` parent). Each group has a header.

When `fieldSchema` is provided (workflow conditions), the dropdown renders that list instead, with the same label/key/type display.

**Search:** The dropdown supports type-ahead search, filtering by label or key substring match. Keyboard navigation (arrow keys, Enter to select, Escape to close).

On selection, the component:
1. Sets the `field` value on the current `FieldCondition` node.
2. Reads the selected property's type.
3. Resets the operator picker to show only operators valid for that type.
4. Clears any previously entered value (since the type may have changed).

**Acceptance Criteria:**
- Dropdown loads all non-deprecated properties for the concept within 200 ms of mount.
- Deprecated properties are excluded from the dropdown.
- Type badge renders correctly for all 17 property types.
- Search filters by label and key; case-insensitive.
- Selecting a field resets operator and value to prevent type mismatches.
- When `conceptKey` changes, the field list reloads and any selections referencing now-invalid properties are highlighted with a warning icon.

---

### 3. Operator Picker

**Purpose:** Show only the operators valid for the selected field's type, preventing invalid condition construction.

**Detail:**

The operator picker is a dropdown that renders immediately after a field is selected. Its options are filtered based on the selected property's type, following the mapping defined in `core/condition-expression.md` Section 5.4:

| Property Type | Available Operators |
|---------------|-------------------|
| `text`, `rich_text`, `email`, `url`, `phone` | `eq`, `neq`, `contains`, `not_contains`, `is_empty`, `is_not_empty` |
| `number`, `integer`, `currency` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `is_empty`, `is_not_empty` |
| `date`, `datetime`, `time` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `is_empty`, `is_not_empty` |
| `checkbox` (boolean) | `eq`, `neq` |
| `select`, `status` | `eq`, `neq`, `is_empty`, `is_not_empty` |
| `multi_select` | `contains`, `not_contains`, `is_empty`, `is_not_empty` |
| `relation`, `people` | `eq`, `neq`, `is_empty`, `is_not_empty` |
| `files`, `image` | `is_empty`, `is_not_empty` |
| `formula`, `rollup` | Determined by the formula/rollup's output type |
| `json` | `is_empty`, `is_not_empty` |

Each operator displays with a human-readable label:

| Operator | Display Label |
|----------|--------------|
| `eq` | equals |
| `neq` | does not equal |
| `gt` | is greater than |
| `gte` | is greater than or equal to |
| `lt` | is less than |
| `lte` | is less than or equal to |
| `contains` | contains |
| `not_contains` | does not contain |
| `is_empty` | is empty |
| `is_not_empty` | is not empty |

When an operator is selected:
- If the operator is `is_empty` or `is_not_empty`, the value input is hidden (no value needed).
- Otherwise, the value input renders with a type-appropriate control (see Section 4).

**Acceptance Criteria:**
- Only operators valid for the selected field type appear in the dropdown.
- Switching the field to a different type resets the operator if the current operator is no longer valid.
- `is_empty` / `is_not_empty` selection hides the value input.
- All 10 operators are reachable through the UI for at least one field type.
- Operator labels are human-readable, not raw enum values.

---

### 4. Value Input

**Purpose:** Render a type-appropriate input control for the condition value so that users enter valid data without manual type conversion.

**Detail:**

The value input renders after a field and operator are selected (except for `is_empty`/`is_not_empty`). The input type is determined by the selected property's type:

| Property Type | Input Control | Behavior |
|---------------|--------------|----------|
| `text`, `rich_text`, `email`, `url`, `phone` | Text input | Free-form string. Placeholder shows example based on type (e.g., "user@example.com" for email). |
| `number`, `integer`, `currency` | Number input | Numeric keypad. `integer` restricts to whole numbers. `currency` shows currency symbol prefix. |
| `date` | Date picker | Calendar dropdown. Value stored as ISO 8601 date string (`YYYY-MM-DD`). |
| `datetime` | Date+time picker | Calendar + time selector. Value stored as ISO 8601 datetime string. |
| `time` | Time picker | Hour/minute selector. Value stored as `HH:MM` string. |
| `checkbox` (boolean) | Toggle switch | Two states: true / false. |
| `select`, `status` | Select dropdown | Options loaded from the property's `options` array. Displays option labels; stores option values. |
| `multi_select` | Select dropdown (single value) | For `contains`/`not_contains`, the user picks one option to check for. Options from property definition. |
| `relation`, `people` | Entity search dropdown | Typeahead search against the related concept's records. Displays name; stores UUID. |
| `files`, `image` | N/A | Only `is_empty`/`is_not_empty` available; no value input needed. |
| `json` | N/A | Only `is_empty`/`is_not_empty` available; no value input needed. |

**Validation:** The value input runs client-side validation on blur:
- Number inputs reject non-numeric input.
- Date inputs reject invalid dates.
- Select inputs reject values not in the options list.
- Validation errors render inline below the input in red text.

**Acceptance Criteria:**
- Each property type renders its corresponding input control.
- Select/status fields populate options from the property's ontology definition.
- Date values are stored in ISO 8601 format regardless of display locale.
- Boolean fields render a toggle, not a text input.
- Entity search (relation/people) loads results from the domain CRUD API with debounced typeahead.
- Invalid input shows inline error; the `valid` event emits `false`.

---

### 5. Compound Logic

**Purpose:** Enable AND/OR/NOT grouping so users can build multi-condition expressions with arbitrary nesting.

**Detail:**

The builder renders as a tree structure:

```
[ AND ▾ ]                           ← Root group (toggle AND/OR)
  ├── [ field: type ] [ eq ] [ JP ]              ← FieldCondition row
  ├── [ OR ▾ ]                                    ← Nested group
  │     ├── [ field: vipTier ] [ gte ] [ 3 ]
  │     └── [ field: interpreterRequired ] [ eq ] [ true ]
  └── [ field: status ] [ neq ] [ cancelled ]
```

**Root group:** The builder always starts with a root `AndCondition` or `OrCondition`. The user can toggle between AND/OR via a segmented control at the top of the root group. When only one condition exists, the root group is implicit (the output is a single `FieldCondition`, not an `and` wrapping one child).

**Add condition:** A "+ Add condition" button at the bottom of each group appends a new empty `FieldCondition` row.

**Add group:** A "+ Add group" button at the bottom of each group creates a nested `AndCondition` (default) inside the current group. The nested group can be toggled to OR independently.

**NOT toggle:** Each row and each group has a "NOT" toggle button. When activated, the node is wrapped in `{ type: 'not', condition: ... }`. The UI renders a red "NOT" badge and a strikethrough-style visual indicator. Toggling off removes the `NotCondition` wrapper.

**Drag to reorder:** Conditions within a group can be reordered by dragging. Drag handles appear on hover. Dragging a group moves the entire group and its children. Drag-and-drop does not change nesting level — to move a condition into or out of a group, the user must delete and re-create it (or use cut/paste if implemented in a future iteration).

**Delete:** Each row and group has a delete (trash) icon. Deleting a group deletes all its children. A confirmation dialog appears when deleting a group with two or more children.

**Visual indentation:** Nested groups are indented with a left border colored by depth:
- Depth 0 (root): no border.
- Depth 1: blue left border.
- Depth 2: green left border.
- Depth 3: orange left border.
- Depth 4 (max default): red left border (signals maximum depth reached).

**Depth enforcement:** When current depth equals `maxDepth`, the "Add group" button is disabled with tooltip "Maximum nesting depth reached."

**Acceptance Criteria:**
- AND/OR toggle at group level changes the group's `type` between `'and'` and `'or'`.
- NOT toggle wraps/unwraps the node in a `NotCondition`.
- Drag-reorder updates the `conditions` array order without changing nesting.
- Deleting a group with children shows a confirmation dialog.
- Nesting beyond `maxDepth` is prevented in the UI.
- Visual indentation with colored borders renders correctly at all depth levels.
- Output after reorder/restructure is a valid `ConditionExpression`.

---

### 6. Human-Readable Preview

**Purpose:** Render a plain-text summary of the condition tree so that non-technical users can verify the logic without reading the tree structure.

**Detail:**

Below the tree builder, a preview panel renders the current expression as a human-readable sentence. The preview updates in real time on every change.

**Rendering rules:**

| Node Type | Rendering |
|-----------|-----------|
| `FieldCondition` | `"{label} {operator_label} {value_label}"` — e.g., "type equals JP" |
| `AndCondition` | Children joined with " AND " — e.g., "type equals JP AND vipTier is greater than 3" |
| `OrCondition` | Children joined with " OR ", wrapped in parentheses when nested — e.g., "(vipTier is greater than 3 OR interpreterRequired equals true)" |
| `NotCondition` | "NOT ({child_text})" — e.g., "NOT (status equals cancelled)" |

**Labels:** The preview uses property `label` (not `key`) for field names, operator display labels (from Section 3), and option labels (not raw values) for select fields.

**Formatting:**
- Keywords AND, OR, NOT rendered in bold.
- Field names rendered in monospace or a distinct color.
- Long previews (more than 3 lines) collapse to a summary with a "Show full preview" toggle.

**Empty state:** When no conditions exist, the preview shows "No conditions defined — this will always evaluate to true."

**Acceptance Criteria:**
- Preview renders within 50 ms of any builder change.
- Field names use `label`, not `key`.
- Select field values show option labels, not raw stored values.
- AND/OR/NOT keywords are visually distinct (bold or colored).
- Nested OR groups are parenthesized to prevent ambiguity.
- Empty builder shows the "always true" message.

---

### 7. Test Plan

**Purpose:** Validate builder functionality end-to-end, covering field loading, operator filtering, compound construction, output correctness, and cross-consumer integration.

#### 7.1 Field Picker

| Test | Steps | Expected |
|------|-------|----------|
| Load properties | Mount builder with `conceptKey="guest"` | Dropdown contains all non-deprecated guest properties |
| Search filter | Type "vip" in search | Only properties with "vip" in label or key appear |
| Type badge | Open dropdown | Each property shows correct type badge |
| Deprecated exclusion | Deprecate a property, remount builder | Deprecated property absent from dropdown |
| ConceptKey change | Change `conceptKey` from "guest" to "staff" | Field list reloads with staff properties |
| fieldSchema override | Provide custom `fieldSchema` array | Dropdown uses provided fields, ignores ontology |

#### 7.2 Operator Filtering

| Test | Steps | Expected |
|------|-------|----------|
| Text field operators | Select a text property | Operators: eq, neq, contains, not_contains, is_empty, is_not_empty |
| Number field operators | Select a number property | Operators: eq, neq, gt, gte, lt, lte, is_empty, is_not_empty |
| Checkbox operators | Select a checkbox property | Operators: eq, neq only |
| Type switch reset | Select text field + "contains", then switch to number field | Operator resets (contains not valid for number) |
| is_empty hides value | Select any field, choose is_empty | Value input disappears |

#### 7.3 Value Input

| Test | Steps | Expected |
|------|-------|----------|
| Text input | Select text field + eq | Text input renders |
| Number input | Select number field + gt | Number input renders, rejects non-numeric |
| Date picker | Select date field + gte | Date picker renders, stores ISO 8601 |
| Select dropdown | Select a select field + eq | Dropdown populated from property options |
| Boolean toggle | Select checkbox field + eq | Toggle renders with true/false states |
| Entity search | Select relation field + eq | Typeahead search dropdown renders |

#### 7.4 Compound Logic

| Test | Steps | Expected |
|------|-------|----------|
| Add condition | Click "+ Add condition" | New empty row appended to group |
| Add group | Click "+ Add group" | Nested AND group created inside current group |
| Toggle AND/OR | Click group toggle | Group `type` switches; output reflects change |
| NOT toggle | Click NOT on a row | Row wrapped in `NotCondition`; red badge visible |
| Drag reorder | Drag row 2 above row 1 | `conditions` array reordered; output updated |
| Delete row | Click trash on a row | Row removed; output updated |
| Delete group | Click trash on a group with 3 children | Confirmation dialog shown; on confirm, group and children removed |
| Max depth | Add groups to depth 4 | "Add group" disabled at depth 4 with tooltip |

#### 7.5 Output Validation

| Test | Steps | Expected |
|------|-------|----------|
| Single condition | Add one field condition | Output is `FieldCondition` object, not wrapped in and/or |
| Multiple conditions | Add two conditions in AND group | Output is `AndCondition` with two `FieldCondition` children |
| Nested expression | Create AND group containing OR group containing two fields | Output matches nested `ConditionExpression` tree |
| Empty builder | Remove all conditions | Output is `null` |
| Schema validation | Capture output, run through write-time validation | Passes without error |
| Roundtrip | Save output to Postgres JSONB, reload into builder | Builder renders identical tree |

#### 7.6 Human-Readable Preview

| Test | Steps | Expected |
|------|-------|----------|
| Single condition | type equals JP | Preview: "type equals JP" |
| AND group | type eq JP AND vipTier gte 3 | Preview: "type equals JP AND vipTier is greater than or equal to 3" |
| Nested OR | AND(field, OR(field, field)) | OR group parenthesized in preview |
| NOT | NOT(status eq cancelled) | Preview: "NOT (status equals cancelled)" |
| Empty | No conditions | Preview: "No conditions defined — this will always evaluate to true" |
| Select labels | status eq confirmed | Preview shows "confirmed" (label), not raw value if different |

#### 7.7 Cross-Consumer Integration

| Test | Steps | Expected |
|------|-------|----------|
| Constraint Editor | Open ontology constraint, build condition, save | `ontology_constraints.condition` contains valid JSONB |
| Form showIf | Open form builder, set showIf on a field, save | `form_configs.fields[]→showIf` contains valid JSONB |
| Workflow condition | Open workflow builder, set condition, save | `workflow_configs.condition` contains valid JSONB |
| Contract clause | Open contract clause editor, set condition, save | `contract_clauses.condition` contains valid JSONB |
| Readonly mode | Open condition in review screen | Tree renders; all controls disabled; no emit on interaction |

**Acceptance Criteria:**
- All tests in 7.1-7.7 pass in CI.
- No test depends on external services — ontology data mocked via the ontology store.
- Builder output passes `ConditionExpression` write-time validation for every test that produces a non-null output.
- Coverage target: >= 90% of component branches.
