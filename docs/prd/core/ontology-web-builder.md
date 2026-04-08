# Ontology Web Builder

> Admin UI for managing the ontology model in-browser. Concept Manager, Property Editor, Relationship
> Editor, Constraint Editor, Form/View Builder integration, and safety guardrails — all scoped by RBAC.
> Postgres is the SOR. Every change increments a version. Nothing with data gets deleted; it gets deprecated.

---

## Overview

The Ontology Web Builder is the administrative interface for creating and modifying the domain model that the ontology engine loads from Postgres. Instead of editing rows directly, authorized users manage concepts, properties, relationships, and constraints through a purpose-built UI with type-safe controls, live previews, and safety guardrails that prevent destructive changes to populated structures.

The builder reads and writes the same five ontology table families described in `core/ontology-engine.md` — concepts, properties, relationships, events, constraints — plus the four config table families (FormConfigs, ViewConfigs, PageConfigs, WorkflowConfigs). It enforces RBAC scoping: admins see all concepts, directors see their department's concepts plus org-wide concepts (read-only), and other roles are excluded entirely. Every mutation increments the concept's `version` field and, for org-wide changes, requires a `changeReason` string stored in the audit log via `core/event-bus.md`.

The builder does not replace the ontology engine; it is a management layer on top of it. After a change is saved, the engine's cache is invalidated and the updated ontology is reloaded.

**Dependencies:** `core/ontology-engine.md`, `core/rbac-engine.md`, `core/event-bus.md`, `data/postgres-schema.md`, `ui/condition-builder-ui.md`, `ui/form-view-builder.md`

---

## Full Specification

### 1. Concept Manager

**Purpose:** List, create, edit, and deprecate ontology concepts.

**Detail:**

The Concept Manager is the top-level screen. It renders a searchable, filterable table of all concepts visible to the current user. Each row shows the concept's `key`, `name`, `icon`, and aggregate counts: number of properties, number of records (from the entity table), and number of relationships where the concept is source or target.

**Create concept:** A slide-over form with fields for `key` (slug, immutable after creation), `name`, `plural`, `icon` (icon picker), `description` (rich text), and `extends` (optional parent concept selector). On save, a row is inserted into the `concepts` table, `version` is set to `1`, and a `concept.created` domain event is emitted.

**Edit concept:** All fields except `key` are editable. Each save increments `version`.

**Deprecation:** Concepts that have zero records can be hard-deleted. Concepts with one or more records cannot be deleted — the user is presented with a "Deprecate" action instead, which sets `status = 'deprecated'` and `deprecatedAt = now()`. Deprecated concepts are hidden from end-user UIs but remain visible (greyed out) in the builder.

**Scope filtering:** The RBAC engine supplies the user's scope. Admins see all concepts. Directors see concepts scoped to their department (full CRUD) and org-wide concepts (read-only). The API enforces the same scope — the UI simply reflects it.

**Acceptance Criteria:**
- Table loads all concepts within the user's scope in under 500 ms.
- Property, record, and relationship counts render correctly.
- New concept is persisted to Postgres and appears in the table without page reload.
- `key` field is immutable after first save.
- Delete button is disabled when record count > 0; deprecate button is shown instead.
- Deprecated concepts show a visual indicator and are excluded from concept selectors elsewhere.
- Director role cannot edit org-wide concepts.
- Every create/edit emits a domain event via the event bus.

---

### 2. Property Editor

**Purpose:** Manage the fields (properties) belonging to a concept.

**Detail:**

Accessed by selecting a concept in the Concept Manager. The Property Editor renders an ordered list of properties. Each property row shows `key`, `name`, `type` badge, and validation summary (e.g., "required, min 1, max 100").

**Add property:** Opens a form with `key`, `name`, `type` (picker from the 17 supported types: `text`, `richText`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `phone`, `select`, `multiSelect`, `currency`, `file`, `image`, `json`), `description`, `defaultValue`, and validation rules.

**Reorder:** Drag-and-drop reordering updates the `sortOrder` column.

**Edit property:** All fields are editable except `type` when the property has data (i.e., at least one record has a non-null value for that property key). When type change is blocked, the UI shows a tooltip: "Cannot change type — property has data. Create a new property instead."

**Deprecation:** Properties with data cannot be deleted. They are deprecated (`status = 'deprecated'`), which hides them from end-user forms but preserves the data.

**Validation rules:** A sub-panel per property with rule builders depending on type — `required` (boolean toggle), `min`/`max` (number inputs, context-sensitive: character count for text, value range for numbers, item count for multiSelect), `pattern` (regex input with live test, for text types only).

**Select option editor:** For `select` and `multiSelect` types, an inline sub-editor to add, reorder, rename, and deprecate options. Options with existing data cannot be deleted — only deprecated (hidden from new entries, still displayed on existing records).

**Field render preview:** A live preview panel shows how the field will render in a form context (text input, dropdown, date picker, etc.) using the current configuration.

**Acceptance Criteria:**
- All 17 property types are available in the type picker.
- Drag-and-drop reorder persists `sortOrder` on drop.
- Type selector is disabled with explanatory tooltip when property has data.
- Validation rule form adapts to the selected type (e.g., `pattern` only for text types).
- Select option editor supports add, reorder, rename, deprecate — not delete when data exists.
- Live preview updates as the user changes type, validation, and default value.
- Version increments on every property change.
- Properties with data show "Deprecate" instead of "Delete."

---

### 3. Relationship Editor

**Purpose:** Define and visualize how concepts connect to each other.

**Detail:**

The Relationship Editor displays a visual graph of concept connections. Each node is a concept; each edge is a relationship. Clicking an edge or using the side panel reveals details: source concept, target concept, `forwardLabel` (e.g., "has sessions"), `inverseLabel` (e.g., "belongs to convention"), cardinality (`one-to-one`, `one-to-many`, `many-to-many`), and a live count of records using that relationship.

**Add relationship:** A form with source concept selector, target concept selector, cardinality picker (radio group), `forwardLabel`, `inverseLabel`, and optional `description`. On save, a row is inserted into the `relationships` table.

**Edit relationship:** Labels and description are always editable. Cardinality can only be changed if no data violates the new constraint (e.g., changing `one-to-many` to `one-to-one` is blocked if any source record has multiple targets). The API validates this server-side.

**Delete:** Relationships with zero linked records can be hard-deleted. Relationships with existing data cannot be deleted — deprecation only.

**Record counts:** Each relationship edge displays the count of linked record pairs. This helps administrators understand usage before making changes.

**Acceptance Criteria:**
- Visual graph renders all relationships for the selected concept (or all concepts in a global view).
- Add relationship form enforces unique source+target+forwardLabel combinations.
- Cardinality change is blocked with a clear message when data would violate the new constraint.
- Relationships with linked records show "Deprecate" instead of "Delete."
- Record count on each edge is accurate and updates after data changes.
- Version increments on every relationship change.

---

### 4. Constraint Editor

**Purpose:** Define conditional business rules on concept records.

**Detail:**

Constraints are conditional rules that enforce data integrity or set defaults based on record state. The Constraint Editor lists all constraints for a concept and provides a builder UI for creating new ones.

**ConditionExpression builder:** Uses the shared `ConditionExpression` UI component defined in `ui/condition-builder-ui.md`. The builder renders a tree of conditions (field, operator, value) with AND/OR grouping. Each node in the tree corresponds to a `ConditionExpression` node in the stored JSON.

**Actions:** When the condition evaluates to true, one or more actions fire:
- `setDefault(property, value)` — sets a default value on the field.
- `setRequired(property, true|false)` — makes a field required or optional.
- `setVisible(property, true|false)` — shows or hides a field in forms.
- `setReadOnly(property, true|false)` — locks a field from editing.
- `validate(property, rule)` — adds a dynamic validation rule.

**Preview panel:** Shows a human-readable summary of the constraint. Example: "When `type = JP`, set `interpreterRequired = true` and require `interpreterRequired`."

**Acceptance Criteria:**
- ConditionExpression builder renders with correct field list from the concept's properties.
- All operators supported by the ontology engine are available in the operator picker.
- AND/OR grouping works to arbitrary depth.
- Each action type (setDefault, setRequired, setVisible, setReadOnly, validate) is configurable.
- Preview panel updates live as the user builds the condition and actions.
- Saved constraint is stored in the `constraints` table and loaded by the ontology engine on next cache refresh.
- Version increments on every constraint change.

---

### 5. Form Builder Integration

**Purpose:** Link ontology concepts to their form configurations.

**Detail:**

From the Concept Manager or Property Editor, a "Configure Forms" button navigates to the form builder defined in `ui/form-view-builder.md`, pre-filtered to the selected concept.

**Quick-create default form:** A one-click action generates a default form configuration from the concept's current properties. The generated form includes all non-deprecated properties in `sortOrder`, grouped into a single section, with field types mapped from property types. The user can then customize the form in the full form builder.

**Acceptance Criteria:**
- "Configure Forms" button navigates to the form builder with the correct concept pre-selected.
- Quick-create generates a valid FormConfig with all non-deprecated properties.
- Generated form respects property `sortOrder`.
- Generated field types match property types (e.g., `select` property produces a dropdown field).
- If a default form already exists, quick-create is disabled with a message: "Default form already exists. Edit it in the form builder."

---

### 6. View Builder Integration

**Purpose:** Link ontology concepts to their view (list/table) configurations.

**Detail:**

From the Concept Manager, a "Configure Views" button navigates to the view builder defined in `ui/form-view-builder.md`, pre-filtered to the selected concept.

**Quick-create default table view:** A one-click action generates a default table view from the concept's current properties. The generated view includes the first 6 non-deprecated properties (by `sortOrder`) as columns, with default column widths based on type (wider for `richText`, narrower for `boolean`). The user can then customize the view in the full view builder.

**Acceptance Criteria:**
- "Configure Views" button navigates to the view builder with the correct concept pre-selected.
- Quick-create generates a valid ViewConfig with up to 6 columns from non-deprecated properties.
- Column widths are type-appropriate defaults.
- If a default view already exists, quick-create is disabled with a message: "Default view already exists. Edit it in the view builder."

---

### 7. Safety Guardrails

**Purpose:** Prevent destructive or inconsistent changes to a live ontology.

**Detail:**

The guardrails are enforced at the API layer (server-side) and reflected in the UI (client-side). The UI disables or hides destructive actions; the API rejects them with structured error responses if the UI is bypassed.

| Rule | Enforcement | UI Behavior |
|------|-------------|-------------|
| No type change on populated properties | API rejects `PATCH` to `type` when data exists | Type selector disabled; tooltip explains why |
| No delete on concepts with records | API rejects `DELETE` when record count > 0 | Delete button hidden; Deprecate shown instead |
| No delete on properties with data | API rejects `DELETE` when non-null values exist | Delete button hidden; Deprecate shown instead |
| No delete on relationships with data | API rejects `DELETE` when linked records exist | Delete button hidden; Deprecate shown instead |
| Deprecation instead of deletion | `status` set to `deprecated`, `deprecatedAt` set | Deprecated items greyed out, hidden from end-users |
| Version increment on every change | API increments `version` on every `INSERT`/`UPDATE` | Version badge shown on concept detail |
| Change reason for org-wide modifications | API requires `changeReason` field for org-scope changes | Modal prompts for reason before save |
| Cardinality tightening blocked by data | API validates existing data against new cardinality | Cardinality options disabled with explanation |

**Acceptance Criteria:**
- Every guardrail in the table above is enforced server-side regardless of client behavior.
- UI accurately reflects which actions are available vs blocked.
- Attempting a blocked action via direct API call returns a `409 Conflict` with a `reason` field.
- `changeReason` is stored in the audit log alongside the domain event.
- Version is monotonically increasing and never skipped.

---

### 8. Test Plan

**Purpose:** Validate all builder functionality end-to-end.

**Detail:**

#### 8.1 Concept CRUD
- Create a concept with all fields populated. Verify it appears in the table and in Postgres.
- Edit `name`, `plural`, `icon`, `description`, `extends`. Verify version increments.
- Attempt to edit `key` after creation. Verify it is rejected.
- Delete a concept with zero records. Verify hard-delete succeeds.
- Attempt to delete a concept with records. Verify it is blocked and deprecation is offered.
- Deprecate a concept. Verify it is hidden from end-user concept selectors but visible (greyed) in builder.

#### 8.2 Property CRUD
- Add a property of each of the 17 types. Verify each persists correctly.
- Reorder properties via drag-and-drop. Verify `sortOrder` updates.
- Edit a property's validation rules. Verify they are enforced on record save.
- Attempt to change type on a property with data. Verify it is blocked.
- Deprecate a property with data. Verify it is hidden from forms but data is preserved.
- Add and deprecate select options. Verify deprecated options display on existing records but are hidden from new entries.

#### 8.3 Relationship CRUD
- Create a relationship with each cardinality type. Verify graph renders correctly.
- Edit labels on a relationship. Verify version increments.
- Attempt to tighten cardinality when data violates the new constraint. Verify it is blocked.
- Delete a relationship with zero linked records. Verify hard-delete.
- Attempt to delete a relationship with linked records. Verify deprecation is offered.

#### 8.4 Constraint CRUD
- Create a constraint with a single condition and single action. Verify it is stored and loaded.
- Create a constraint with nested AND/OR conditions. Verify evaluation is correct.
- Edit a constraint's actions. Verify the preview updates.
- Delete a constraint. Verify it is removed from the ontology engine's cache on next reload.

#### 8.5 Scope Filtering
- Log in as admin. Verify all concepts are visible and editable.
- Log in as director. Verify department concepts are editable and org-wide concepts are read-only.
- Log in as a role without builder access. Verify the builder is inaccessible (403).
- Attempt an API call outside the user's scope. Verify it is rejected.

#### 8.6 Safety Guardrails
- For each guardrail in Section 7, perform the blocked action via the UI and verify the action is prevented.
- For each guardrail, perform the blocked action via direct API call and verify a `409 Conflict` response.
- Modify an org-wide concept without providing `changeReason`. Verify the API rejects it.
- Modify an org-wide concept with `changeReason`. Verify the reason is stored in the audit log.

#### 8.7 Version Tracking
- Perform 5 sequential edits to a concept. Verify version increments from 1 to 6.
- Verify that property and relationship changes also increment the parent concept's version.
- Query the audit log for a concept. Verify all changes are recorded with correct timestamps, actors, and change reasons.

#### 8.8 Form and View Builder Integration
- Quick-create a default form for a concept. Verify FormConfig matches properties.
- Attempt quick-create when a default form exists. Verify it is blocked.
- Quick-create a default table view. Verify ViewConfig has up to 6 columns with correct widths.
- Navigate to form/view builder via the integration buttons. Verify correct concept is pre-selected.

**Acceptance Criteria:**
- All test cases in 8.1-8.8 pass.
- No test requires manual database inspection — all assertions use API responses or UI state.
- Tests cover both happy path and error/guardrail paths.
