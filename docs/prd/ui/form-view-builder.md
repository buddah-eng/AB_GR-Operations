# Form & View Builder

> **Shorthand:** Drag-drop config UI for forms and views. Form builder: property list → drop-zone canvas → field config panel (label override, `showIf` via ConditionBuilder, `colSpan`). Layout picker (single/two-column/wizard). View builder: type picker (table/kanban/timeline/dashboard), column ordering, filter builder (shared ConditionBuilder), sort config, groupBy config. Quick-create generates baseline form/view from concept properties. All changes validated and routed through the config CI/QA pipeline. Saves `FormConfig` and `ViewConfig` to Postgres. Postgres is the SOR.

---

## Overview

The Form & View Builder is the administrative interface for designing how data is displayed and collected across the platform. Instead of hardcoding form layouts or table columns, authorized users configure forms and views visually — dragging properties onto a canvas, setting visibility conditions, choosing layouts, and arranging columns. The builder saves structured configuration to Postgres (`form_configs` and `view_configs` tables), which the dynamic form renderer (`ui/dynamic-forms.md`) and view renderer (`ui/view-renderer.md`) consume at runtime.

The builder operates on concepts from the ontology engine. Every concept can have multiple named form configs (e.g., "Guest Intake Form", "Quick Edit Form") and multiple named view configs (e.g., "Master Table", "By Status Kanban", "Arrival Timeline"). The builder reads property definitions from the ontology store and ensures that every configured field references a valid, non-deprecated property.

Quick-create support allows admins to generate a baseline form or view from a concept's properties in one click — accessed from the ontology web builder (`core/ontology-web-builder.md` Sections 5-6). The generated config serves as a starting point that can be refined in the full builder.

All form and view configuration changes are subject to the config CI/QA pipeline (`core/ontology-ci-qa.md`): automated validation on save, optional human review for risky changes, staging preview, and rollback support.

**Dependencies:** `core/ontology-engine.md` (property definitions), `core/condition-expression.md` (showIf, filters), `ui/condition-builder-ui.md` (shared condition builder component), `ui/dynamic-forms.md` (form rendering), `ui/view-renderer.md` (view rendering), `core/ontology-ci-qa.md` (validation pipeline), `data/postgres-schema.md` (form_configs, view_configs tables)

---

## Full Specification

### 1. Form Builder

**Purpose:** Provide a visual drag-and-drop interface for designing form layouts that the dynamic form renderer consumes at runtime.

**Detail:**

The form builder screen is a three-panel layout:

**Left Panel — Property List:**
- Displays all non-deprecated properties for the selected concept, loaded from the ontology store.
- Each property shows its `label`, `key`, `type` badge, and a drag handle.
- Properties already placed on the canvas show a checkmark and are greyed out (but remain draggable for adding to a different form section).
- Search bar filters properties by label or key.
- "Unplaced properties" count shows how many concept properties have not been added to the form.

**Center Panel — Form Canvas:**
- The canvas is a vertical stack of drop zones representing form sections.
- Each section has a header (editable section title) and one or more field slots.
- Drag a property from the left panel onto a drop zone to add it as a form field.
- Fields within a section can be reordered by dragging.
- Fields can be moved between sections by dragging across section boundaries.
- Drop zone highlights (blue border, background tint) indicate valid drop targets during drag.
- Each field on the canvas shows: label, type icon, and a summary of its configuration (colSpan, showIf indicator).

**Right Panel — Field Config:**
When a field on the canvas is selected (clicked), the right panel shows its configuration:

| Config | Type | Description |
|--------|------|-------------|
| `label` | Text input | Override the property's default label for this form. Empty = use property label. |
| `placeholder` | Text input | Override placeholder text. |
| `helpText` | Text input | Tooltip or helper text displayed below the field. |
| `colSpan` | Select: 1, 2 | How many columns the field spans in a two-column layout. Default: 1. Ignored in single-column. |
| `showIf` | ConditionBuilder | Optional visibility condition. Renders the shared `<ConditionBuilder>` component from `ui/condition-builder-ui.md` with `conceptKey` set to the form's concept. When set, the field is only visible at runtime when the condition evaluates to `true` against the current form values. |
| `required` | Toggle | Override the property's `required` setting for this form context. |
| `readOnly` | Toggle | Make the field read-only in this form regardless of ontology setting. |
| `defaultValue` | Type-appropriate input | Override the property's default value for this form. |

**Layout Picker:**
A toolbar above the canvas offers three layout modes:

| Layout | Behavior |
|--------|----------|
| `single` | One field per row. Full-width. Simple vertical form. |
| `two-column` | Two fields per row. Fields with `colSpan: 2` span the full width. Responsive: collapses to single-column on mobile. |
| `wizard` | Multi-step form. Each step is a section. Navigation bar shows step titles. "Next" / "Back" buttons between steps. Validation runs per-step before advancing. |

**Wizard Step Editor:**
When layout is `wizard`, the center panel renders a step navigator above the canvas. Each step corresponds to a form section. The step editor supports:
- Reorder steps by drag.
- Rename steps (the section title becomes the step title).
- Add/remove steps (which adds/removes sections).
- Per-step validation: configure which fields must be valid before the user can advance to the next step.

**Live Preview:**
A toggle in the toolbar switches the center panel from "Edit" mode to "Preview" mode. Preview mode renders the form exactly as the dynamic form renderer would, using the current `FormConfig`. The preview:
- Populates with sample data (empty record) to show field rendering.
- Respects `showIf` conditions by allowing the user to fill in values and see fields appear/disappear.
- Shows wizard step navigation in wizard layout.
- Does not submit data — it is read-only.

**Save:**
On save, the builder serializes the canvas state into a `FormConfig` object and writes it to the `form_configs` table:

```typescript
interface FormConfig {
  id: string
  conceptKey: string
  name: string
  layout: 'single' | 'two-column' | 'wizard'
  fields: FormFieldConfig[]
  steps?: FormStep[]       // wizard only
}

interface FormFieldConfig {
  propertyKey: string
  label?: string           // override
  placeholder?: string
  helpText?: string
  colSpan?: 1 | 2
  showIf?: ConditionExpression | null
  required?: boolean       // override
  readOnly?: boolean
  defaultValue?: unknown
  sortOrder: number
  sectionIndex: number
}

interface FormStep {
  title: string
  sectionIndex: number
  validationFields: string[]  // property keys that must be valid before advancing
}
```

The save path runs through the CI/QA validation pipeline before the config becomes active.

**Acceptance Criteria:**
- Drag from property list to canvas adds the field; the property shows a checkmark in the left panel.
- Reordering fields on the canvas updates `sortOrder` in the output.
- Field config panel renders the correct controls for the selected field.
- `showIf` opens the shared ConditionBuilder component with the correct concept.
- Layout picker switches between single, two-column, and wizard; the canvas restructures accordingly.
- Wizard step editor supports add, remove, reorder, and rename.
- Live preview renders the form identically to the dynamic form renderer.
- Save produces a `FormConfig` JSON that passes CI/QA validation.
- Form referencing a deprecated property shows a warning banner: "Field '{label}' references deprecated property '{key}'. Remove or replace it."

---

### 2. View Builder

**Purpose:** Provide a visual configuration interface for table, kanban, timeline, and dashboard views that the view renderer consumes at runtime.

**Detail:**

The view builder is a single-screen editor with a type picker, a configuration area, and a live preview.

**View Type Picker:**
A top-level segmented control selects the view type: `table`, `kanban`, `timeline`, `dashboard`. Switching types resets type-specific configuration but preserves shared config (filters, sort).

#### 2.1 Table View Config

| Config Area | Controls | Description |
|-------------|----------|-------------|
| **Columns** | Drag-and-drop list of properties | Add properties as columns. Reorder by drag. Each column shows: property label, type badge. |
| **Column Width** | Number input per column | Default widths auto-calculated by type. Manually adjustable. |
| **Column Visibility** | Toggle per column | Show/hide columns without removing them from config. |
| **Row Action** | Select: navigate_to_detail, inline_edit, none | What happens when a user clicks a row. |

#### 2.2 Kanban View Config

| Config Area | Controls | Description |
|-------------|----------|-------------|
| **Group By** | Property selector (select/status types only) | Which property defines the kanban columns. |
| **Card Fields** | Drag-and-drop list | Which properties display on each kanban card. |
| **Card Title** | Property selector | Which property is the card title (default: `name`). |
| **Column Order** | Drag-and-drop of group values | Reorder the kanban columns (option values). |

#### 2.3 Timeline View Config

| Config Area | Controls | Description |
|-------------|----------|-------------|
| **Start Field** | Property selector (date/datetime types only) | Which property marks the start of the timeline item. |
| **End Field** | Property selector (date/datetime types only) | Which property marks the end. If omitted, items render as points. |
| **Label Field** | Property selector | What text displays on the timeline bar. |
| **Color Field** | Property selector (select/status types only) | Which property determines the bar color (mapped from option colors). |
| **Scale** | Select: hour, day, week, month | Default timeline zoom level. |

#### 2.4 Dashboard View Config

| Config Area | Controls | Description |
|-------------|----------|-------------|
| **Widgets** | Drag-and-drop grid | Add stat cards, charts, and embedded views. Each widget is a `WidgetConfig` referencing a concept, an aggregation, and a display type. |
| **Layout** | Grid with breakpoints | Responsive grid positions. Configured via drag-resize on the canvas. |

Dashboard widgets are defined in `ui/view-renderer.md` and are beyond the scope of this builder PRD except for the placement/sizing UI.

#### 2.5 Shared Config (All View Types)

**Filter Builder:**
Uses the shared `<ConditionBuilder>` component from `ui/condition-builder-ui.md`. The resulting `ConditionExpression` is stored in the `filters` JSONB column of `view_configs`. At runtime, the view renderer evaluates the filter to determine which records to display.

**Sort Config:**
A list of sort rules, each specifying:
- Property key (dropdown of concept properties).
- Direction: ascending or descending.
- Priority: drag-reorder to set sort priority.

Multiple sort rules are applied in order (primary sort, secondary sort, etc.).

**Presets:**
Named filter/sort/group combinations that users can switch between at runtime. Each preset stores a `ViewPreset`:

```typescript
interface ViewPreset {
  name: string
  filters?: ConditionExpression | null
  sort?: ViewSort[]
  groupBy?: string
}
```

Presets are configured in the builder and selectable at runtime via a dropdown in the view header.

**Save:**
On save, the builder serializes the configuration into a `ViewConfig` object and writes it to the `view_configs` table:

```typescript
interface ViewConfig {
  id: string
  conceptKey: string
  name: string
  viewType: 'table' | 'kanban' | 'timeline' | 'dashboard'
  columns?: ViewColumn[]     // table
  groupBy?: string           // kanban
  timelineStart?: string     // timeline
  timelineEnd?: string       // timeline
  filters?: ConditionExpression | null
  sort?: ViewSort[]
  rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  presets?: ViewPreset[]
}

interface ViewColumn {
  propertyKey: string
  width?: number
  visible: boolean
  sortOrder: number
}

interface ViewSort {
  propertyKey: string
  direction: 'asc' | 'desc'
}
```

The save path runs through the CI/QA validation pipeline.

**Acceptance Criteria:**
- View type picker switches between table, kanban, timeline, and dashboard.
- Table: columns can be added, removed, reordered, and resized.
- Kanban: groupBy selector limits to select/status properties; column order is configurable.
- Timeline: start/end selectors limit to date/datetime properties.
- Filter builder opens the shared ConditionBuilder with the correct concept.
- Sort config supports multiple rules with drag-reorder priority.
- Presets can be added, named, and configured with filter/sort/group combinations.
- Save produces a `ViewConfig` JSON that passes CI/QA validation.
- Switching view type preserves shared config (filters, sort) and resets type-specific config.

---

### 3. Quick-Create

**Purpose:** Generate a baseline form or view configuration from a concept's properties in one click, accessible from the ontology web builder.

**Detail:**

Quick-create is triggered from the ontology web builder (`core/ontology-web-builder.md` Sections 5-6) via "Generate default form" and "Generate default view" buttons.

#### 3.1 Quick-Create Form

Generates a `FormConfig` with:
- `name`: "Default" (or "Default Form").
- `layout`: `single`.
- `fields`: All non-deprecated properties in `sortOrder`, mapped to `FormFieldConfig` entries. No label overrides, no `showIf`, `colSpan` defaults to 1.
- No wizard steps.

The generated config is saved directly to `form_configs` with `status = 'active'` (no review gate for initial generation). The user is then navigated to the form builder to customize.

**Guard:** If a form config named "Default" already exists for the concept, the button is disabled with tooltip: "Default form already exists. Edit it in the form builder."

#### 3.2 Quick-Create View

Generates a `ViewConfig` with:
- `name`: "Default" (or "Default Table").
- `viewType`: `table`.
- `columns`: First 6 non-deprecated properties by `sortOrder`, mapped to `ViewColumn` entries. Column widths auto-calculated by type:
  - `text`, `rich_text`: 200px
  - `number`, `integer`, `currency`: 100px
  - `date`, `datetime`: 150px
  - `boolean`/`checkbox`: 80px
  - `select`, `status`: 120px
  - `email`, `url`: 180px
  - All others: 150px
- `rowAction`: `navigate_to_detail`.
- No filters, no sort, no presets.

The generated config is saved directly to `view_configs`. The user is then navigated to the view builder to customize.

**Guard:** If a view config named "Default" already exists for the concept, the button is disabled with tooltip: "Default view already exists. Edit it in the view builder."

**Acceptance Criteria:**
- Quick-create form generates a valid `FormConfig` with all non-deprecated properties in `sortOrder`.
- Quick-create view generates a valid `ViewConfig` with up to 6 columns and type-appropriate widths.
- Generated configs pass CI/QA validation without modification.
- Button is disabled when a default config already exists for the concept.
- After generation, the user is navigated to the full builder with the new config loaded.
- Generated config respects property `sortOrder` ordering.

---

### 4. CI/QA Integration

**Purpose:** Ensure all form and view configuration changes are validated and routed through the config CI/QA pipeline before becoming active.

**Detail:**

Every save from the form or view builder triggers the config CI/QA pipeline defined in `core/ontology-ci-qa.md`. The validation checks specific to form and view configs are:

#### 4.1 Form Config Validation

| Check | Rule | Error on Failure |
|-------|------|------------------|
| Property existence | Every `propertyKey` in `fields` must reference an existing property on the concept | "Field '{key}' references unknown property" |
| Property status | Fields referencing deprecated properties generate a warning (not a block) | Warning: "Field '{key}' references deprecated property" |
| Type compatibility | `showIf` conditions must reference valid fields with compatible operators | "showIf on '{key}' references invalid field or operator" |
| Layout consistency | Wizard layout requires at least 2 steps | "Wizard layout requires at least 2 steps" |
| Step coverage | In wizard layout, every field must belong to a step | "Field '{key}' is not assigned to any wizard step" |
| colSpan validity | `colSpan` values must be 1 or 2 | "Invalid colSpan value on '{key}'" |
| Duplicate fields | No duplicate `propertyKey` values within the same form | "Duplicate field '{key}'" |
| showIf validation | `showIf` expressions must pass `ConditionExpression` write-time validation | "Invalid showIf expression on '{key}'" |

#### 4.2 View Config Validation

| Check | Rule | Error on Failure |
|-------|------|------------------|
| Property existence | Every `propertyKey` in columns/cardFields/sort must reference a valid property | "Column '{key}' references unknown property" |
| GroupBy type | `groupBy` property must be of type `select` or `status` | "groupBy property '{key}' must be select or status type" |
| Timeline fields | `timelineStart` and `timelineEnd` must be `date` or `datetime` properties | "Timeline field '{key}' must be date or datetime type" |
| Filter validation | `filters` must pass `ConditionExpression` write-time validation | "Invalid filter expression" |
| Sort field validity | Sort properties must exist on the concept | "Sort field '{key}' references unknown property" |
| Preset validation | Each preset's filters and sort must pass validation | "Invalid preset '{name}'" |

#### 4.3 Pipeline Routing

| Change Type | Risk Level | Pipeline Path |
|-------------|------------|---------------|
| New form/view config | Low | Validate → auto-apply (no review) |
| Edit existing config (non-destructive) | Low | Validate → auto-apply |
| Remove field from form | Medium | Validate → review (department director) |
| Change view type | Medium | Validate → review (department director) |
| Delete form/view config | High | Validate → review (admin) |

**Acceptance Criteria:**
- Every form/view save triggers automated validation before the config becomes active.
- Validation errors block the save and display inline in the builder.
- Validation warnings (deprecated properties) display but do not block the save.
- High-risk changes require human review before the config becomes active.
- The CI/QA pipeline logs all validation results to the audit log.
- A failed validation does not modify the existing active config.

---

### 5. Test Plan

**Purpose:** Validate all builder functionality end-to-end.

#### 5.1 Form Builder

| Test | Steps | Expected |
|------|-------|----------|
| Drag property to canvas | Drag "name" from left panel to canvas | Field appears on canvas; "name" checked in left panel |
| Reorder fields | Drag field 2 above field 1 | `sortOrder` updated in output |
| Field config - label | Select field, change label to "Full Name" | Output field has `label: "Full Name"` |
| Field config - showIf | Select field, open ConditionBuilder, add condition | Output field has valid `showIf` expression |
| Field config - colSpan | Set colSpan to 2 in two-column layout | Field spans full width in preview |
| Layout switch | Switch from single to two-column | Canvas re-renders with two-column grid |
| Wizard steps | Switch to wizard, add 3 steps, assign fields | Output has `steps` array with 3 entries |
| Wizard reorder | Drag step 3 to position 1 | Steps reordered; fields reassigned |
| Live preview | Toggle to preview mode | Form renders identically to dynamic form renderer |
| showIf in preview | Set showIf on a field, fill in triggering value in preview | Field appears/disappears based on condition |
| Save validation | Save form with all fields populated | `FormConfig` written to `form_configs`, passes validation |
| Deprecated property | Add a deprecated property to form | Warning displayed; save allowed |
| Duplicate field | Add same property twice | Validation error: "Duplicate field" |

#### 5.2 View Builder

| Test | Steps | Expected |
|------|-------|----------|
| Table columns | Add 5 properties as columns, reorder | Output `columns` array has 5 entries in correct order |
| Column width | Manually set column width to 250px | Output column has `width: 250` |
| Kanban groupBy | Select "status" as groupBy | Output has `groupBy: "status"` |
| Kanban groupBy type check | Attempt to select "name" (text type) as groupBy | Not available in dropdown (filtered to select/status types) |
| Timeline fields | Select date properties for start/end | Output has `timelineStart` and `timelineEnd` |
| Timeline field type check | Attempt to select text property for timeline start | Not available in dropdown (filtered to date/datetime) |
| Filter builder | Open filter, build condition with ConditionBuilder | Output has valid `filters` expression |
| Sort config | Add two sort rules, reorder | Output `sort` array has 2 entries in correct priority |
| Presets | Create a preset with filters and sort | Output `presets` array contains the preset |
| View type switch | Switch from table to kanban | Table-specific config cleared; shared config preserved |
| Save validation | Save view with all config populated | `ViewConfig` written to `view_configs`, passes validation |

#### 5.3 Quick-Create

| Test | Steps | Expected |
|------|-------|----------|
| Generate default form | Click quick-create on a concept with 10 properties | `FormConfig` created with 10 fields in sortOrder |
| Generate default view | Click quick-create on a concept with 10 properties | `ViewConfig` created with 6 columns, correct widths |
| Guard - form exists | Quick-create when "Default" form exists | Button disabled with tooltip |
| Guard - view exists | Quick-create when "Default" view exists | Button disabled with tooltip |
| Navigate after create | Quick-create generates config | User navigated to full builder with new config loaded |
| Property ordering | Concept with properties at sortOrder 5, 2, 8, 1 | Generated config fields ordered 1, 2, 5, 8 |

#### 5.4 CI/QA Validation

| Test | Steps | Expected |
|------|-------|----------|
| Unknown property | Save form with a propertyKey that does not exist | Validation error blocks save |
| Invalid showIf | Save form with malformed showIf expression | Validation error blocks save |
| Wizard with 1 step | Save wizard layout with only 1 step | Validation error: "Wizard layout requires at least 2 steps" |
| Invalid groupBy type | Save kanban view with groupBy on text property | Validation error: "groupBy must be select or status type" |
| Invalid timeline field | Save timeline view with text field as timelineStart | Validation error: "must be date or datetime type" |
| Deprecated property warning | Save form with deprecated property | Warning displayed; save succeeds |
| High-risk change | Delete an existing form config | Change routed to admin review |

**Acceptance Criteria:**
- All tests in 5.1-5.4 pass in CI.
- Drag-and-drop tests use a UI testing framework (e.g., Cypress) for realistic interaction simulation.
- Every generated config (from quick-create and manual builder) passes CI/QA validation.
- No test depends on external services — ontology data mocked via the ontology store.
- Coverage target: >= 85% of component branches.
