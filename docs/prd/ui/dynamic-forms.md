# Dynamic Forms — FormKit Schema Bridge + DynamicForm Component

> Ontology-driven forms. One component renders any concept's create/edit form. No hardcoded form markup anywhere.

## Shorthand

- **What**: `DynamicForm` Vue component + `buildFormKitSchema()` bridge function.
- **Input**: `FormConfig` from ontology store (Postgres SOR).
- **Output**: Fully rendered, validated, submittable form via FormKit schema API.
- **Replaces**: Every hardcoded form in the web app.
- **Stack**: Vue 3, FormKit (`@formkit/vue ^1.6.0`), Pinia ontology store, Tailwind CSS grid.

---

## Overview

The ontology already defines `FormConfig`, `FormFieldConfig`, and `FormStep` (see `functions/src/ontology/types.ts:170-193`). Today those types exist but forms are still written by hand. This spec bridges the gap: a pure function converts `FormConfig` into a FormKit schema array, and a single `<DynamicForm>` component consumes it. Layout modes (single-column, two-column, wizard), conditional visibility, relation autocomplete, and pre-population are all driven by the ontology config with zero per-concept template code.

---

## 1. FormKit Schema Bridge

### Purpose

Pure, testable function that converts an ontology `FormConfig` into a FormKit-compatible schema array. This is the single translation layer between the platform's data model and the rendering engine.

### Detail

**Function signature:**

```ts
function buildFormKitSchema(
  config: FormConfig,
  properties: ReadonlyArray<PropertyDefinition>
): FormKitSchemaNode[]
```

**Property type to FormKit input mapping:**

| Ontology `propertyType` | FormKit `$formkit` input | Notes |
|---|---|---|
| `text` | `text` | Standard text input |
| `select` | `select` | Options from `PropertyDefinition.options` |
| `date` | `datepicker` | FormKit Pro datepicker |
| `relation` | `autocomplete` | See section 5 |
| `checkbox` | `checkbox` | Boolean toggle |
| `rich_text` | `textarea` | Multiline, plain text fallback |
| `number` | `number` | Numeric input |
| `email` | `email` | Email with built-in validation |
| `url` | `url` | URL input |
| `multi_select` | `taglist` | FormKit Pro taglist |

**Validation mapping:**

| Ontology validation rule | FormKit validation string | Example |
|---|---|---|
| `required: true` | `'required'` | `'required'` |
| `minLength: N` | `'length:N'` | `'length:3'` |
| `maxLength: N` | `'length:0,N'` | `'length:0,255'` |
| `minLength + maxLength` | `'length:min,max'` | `'length:3,255'` |
| `pattern: '/regex/'` | `'matches:/regex/'` | `'matches:/^[A-Z]/'` |
| `min: N` (number) | `'min:N'` | `'min:0'` |
| `max: N` (number) | `'max:N'` | `'max:9999'` |

Multiple rules are pipe-delimited: `'required|length:3,255|matches:/^[A-Z]/'`.

**Field-level overrides from `FormFieldConfig`:**

- `overrideLabel` replaces the label derived from `PropertyDefinition.label`.
- `overridePlaceholder` sets the `placeholder` attribute.
- `colSpan` is passed through as a data attribute for CSS grid layout.
- `groupName` wraps consecutive same-group fields in a FormKit `group` node.

### Acceptance Criteria

- [ ] Each ontology property type maps to exactly one FormKit input type per the table above.
- [ ] All validation rules translate correctly; pipe-delimited when combined.
- [ ] `overrideLabel` and `overridePlaceholder` take precedence over property-derived defaults.
- [ ] `groupName` produces FormKit `group` schema nodes wrapping the correct fields.
- [ ] Function is pure: no side effects, no API calls, no store access.
- [ ] Unknown property types fall back to `text` input with a console warning.

---

## 2. DynamicForm Component

### Purpose

Single Vue component that replaces every hardcoded form in the application. Given a concept key and optional record ID, it fetches the form config, builds the schema, renders the form, and handles submission.

### Detail

**Usage:**

```vue
<!-- Create -->
<DynamicForm concept="guest" @saved="onSaved" />

<!-- Edit -->
<DynamicForm concept="guest" :recordId="id" @saved="onSaved" />
```

**Props:**

| Prop | Type | Required | Description |
|---|---|---|---|
| `concept` | `string` | Yes | Ontology concept key (e.g. `'guest'`, `'event'`, `'exhibitor'`) |
| `recordId` | `string \| null` | No | Record ID for edit mode. `null`/omitted = create mode. |
| `registryData` | `Record<string, unknown> \| null` | No | Pre-fill data from YoY registry (see section 6). |
| `layout` | `'single' \| 'two-column' \| 'wizard'` | No | Override layout from FormConfig. |

**Emits:**

| Event | Payload | When |
|---|---|---|
| `saved` | `{ id: string, data: Record<string, unknown> }` | After successful POST or PUT |
| `error` | `{ message: string, errors: Record<string, string[]> }` | API returns validation errors |
| `cancel` | `void` | User clicks cancel |

**Lifecycle:**

1. On mount, read `FormConfig` for `concept` from the Pinia ontology store.
2. Read `PropertyDefinition[]` for the concept from the same store.
3. Call `buildFormKitSchema(config, properties)` to produce the schema.
4. If `recordId` is set, fetch the record via `GET /api/{concept}/{recordId}` and populate form values.
5. If `registryData` is provided and no `recordId`, merge registry data into initial form values.
6. Render `<FormKit type="form" :schema="schema" :value="initialValues" @submit="handleSubmit" />`.
7. On submit: `POST /api/{concept}` (create) or `PUT /api/{concept}/{recordId}` (edit). Postgres is the SOR.
8. On success, emit `saved`. On 422, map API field errors back to FormKit node errors.

### Acceptance Criteria

- [ ] `<DynamicForm concept="guest" />` renders the guest form with zero additional template markup.
- [ ] Create mode sends POST; edit mode sends PUT. Correct HTTP verb always used.
- [ ] API 422 errors surface inline on the correct fields.
- [ ] Component is concept-agnostic: works for any concept that has a `FormConfig` in the ontology.
- [ ] All existing hardcoded forms can be replaced with `<DynamicForm>` with no behavioral regression.
- [ ] Loading state shown while fetching config or record data.

---

## 3. Layout Modes

### Purpose

Support three layout strategies driven by `FormConfig.layout`, with zero per-form CSS.

### Detail

**Single Column (default):**

- Fields stack vertically, full width.
- Applied when `layout` is `'single'` or omitted.

**Two-Column:**

- CSS grid: `grid-template-columns: repeat(2, 1fr)` with Tailwind utility classes.
- Each field defaults to `colSpan: 1` (half width).
- `FormFieldConfig.colSpan: 2` makes a field span full width.
- Responsive: collapses to single column below `md` breakpoint.

```html
<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
  <!-- FormKit nodes rendered here; colSpan:2 fields get class "md:col-span-2" -->
</div>
```

**Wizard:**

- Uses the FormKit multi-step plugin (`@formkit/addons` multi-step).
- Steps defined by `FormConfig.steps: FormStep[]`.
- Each `FormStep.fields` lists the property keys that belong to that step.
- Step labels from `FormStep.label`.
- Validation runs per-step before advancing. User cannot proceed until current step is valid.
- Final step includes the submit button.

### Acceptance Criteria

- [ ] `layout: 'single'` renders all fields in a single vertical stack.
- [ ] `layout: 'two-column'` renders a CSS grid; `colSpan: 2` fields span full width.
- [ ] Two-column layout collapses to single column on screens below `md` breakpoint.
- [ ] `layout: 'wizard'` renders a multi-step form with step labels from `FormStep.label`.
- [ ] Wizard enforces per-step validation before the user can advance.
- [ ] Layout mode can be overridden via the `layout` prop on `DynamicForm`.

---

## 4. Conditional Visibility

### Purpose

Fields appear or disappear reactively based on the current form values, driven by `FormFieldConfig.showIf`.

### Detail

`showIf` holds a `ConditionExpression` (already defined in the ontology type system). The schema bridge emits FormKit's `if` condition on the schema node:

```ts
// Inside buildFormKitSchema, for a field with showIf:
{
  $formkit: 'text',
  if: '$get(otherField).value === "VIP"',
  name: 'dietaryNotes',
  label: 'Dietary Notes',
}
```

**Supported operators in `ConditionExpression`:**

| Operator | FormKit `if` expression | Example |
|---|---|---|
| `equals` | `$get(field).value === value` | Show dietary notes when guestType equals "VIP" |
| `notEquals` | `$get(field).value !== value` | Hide field when status is not "active" |
| `in` | `['a','b'].includes($get(field).value)` | Show when role is in ["speaker", "panelist"] |
| `isNotEmpty` | `$get(field).value !== '' && $get(field).value != null` | Show when a prerequisite field has a value |
| `isEmpty` | `$get(field).value === '' \|\| $get(field).value == null` | Show fallback field when primary is blank |

**Behavior:**

- Hidden fields are not rendered in the DOM (not just `display:none`).
- Hidden fields are excluded from the submitted payload.
- Visibility re-evaluates reactively as the user types or selects values.
- Nested conditions (AND/OR) are translated to compound JS expressions in the `if` string.

### Acceptance Criteria

- [ ] A field with `showIf: { field: 'type', operator: 'equals', value: 'VIP' }` only appears when the `type` field value is `'VIP'`.
- [ ] Hidden fields are omitted from the form submission payload.
- [ ] Visibility updates instantly as the user changes the controlling field's value.
- [ ] Compound conditions (AND, OR) evaluate correctly.
- [ ] No errors thrown when the referenced field does not yet have a value (initial render).

---

## 5. Relation Autocomplete

### Purpose

Fields of type `relation` render as a searchable autocomplete that queries a related concept's records. User sees a human-readable label; the form stores the record ID.

### Detail

**Configuration:**

- `FormFieldConfig.autocompleteSource` specifies the related concept key (e.g., `'organization'`).
- The schema bridge maps `relation` to FormKit `autocomplete` (from `@formkit/pro` or a custom input).

**Behavior:**

1. User types at least 2 characters.
2. Component debounces (300ms), then calls `GET /api/{autocompleteSource}?search={query}&limit=10`.
3. API returns `{ results: [{ id: string, label: string }] }`.
4. Dropdown displays `label` values.
5. On selection, the form value stores the `id`.
6. In edit mode, the existing relation ID is resolved to its label on load via `GET /api/{autocompleteSource}/{id}`.

**Schema output:**

```ts
{
  $formkit: 'autocomplete',
  name: 'organizationId',
  label: 'Organization',
  options: [], // populated dynamically
  selectionAppearance: 'text-input',
  // dynamic option loading handled by DynamicForm event wiring
}
```

### Acceptance Criteria

- [ ] Typing 2+ characters triggers a debounced API search against the related concept.
- [ ] Dropdown displays human-readable labels from the API response.
- [ ] Selected value stored in the form is the record `id`, not the label.
- [ ] In edit mode, existing relation is displayed as its label on initial load.
- [ ] Clearing the autocomplete input clears the stored ID.
- [ ] No API call fires for fewer than 2 characters.

---

## 6. Pre-Population

### Purpose

Forms open pre-filled with the correct data: existing record data in edit mode, or YoY registry data for streamlined re-registration.

### Detail

**Edit Mode (`recordId` provided):**

1. `DynamicForm` calls `GET /api/{concept}/{recordId}`.
2. Response data is mapped to FormKit initial values keyed by `propertyKey`.
3. Relation fields resolve their IDs to display labels (see section 5).
4. Date fields are parsed into the format expected by the datepicker.
5. Form renders fully populated. User modifies and submits (PUT).

**Create Mode with Registry Data (`registryData` provided):**

1. `registryData` prop contains key-value pairs from the YoY registry (prior year records).
2. Values are merged into the form's initial values.
3. Fields pre-filled from registry data get a subtle visual indicator (e.g., a small badge or muted help text: "Pre-filled from previous year").
4. User can override any pre-filled value.
5. On submit, POST is used (new record).

**Priority order for initial values:**

1. Explicit `recordId` fetch (edit mode) -- highest priority.
2. `registryData` prop (create with registry context).
3. `PropertyDefinition.defaultValue` from ontology.
4. Empty / FormKit default -- lowest priority.

### Acceptance Criteria

- [ ] Edit mode loads and displays all existing field values including relations and dates.
- [ ] Registry pre-fill populates matching fields and shows a visual indicator.
- [ ] User can override any pre-filled value without restriction.
- [ ] Priority order is respected: record data > registry data > ontology defaults > empty.
- [ ] Loading spinner shown while fetching record data; form is not interactive until data is loaded.

---

## 7. Test Plan

### Purpose

Verify every layer -- schema bridge, component rendering, conditional logic, autocomplete integration, and end-to-end submit flow.

### Detail

**7.1 Schema Bridge Unit Tests**

| Test | Assertion |
|---|---|
| Text property produces `{ $formkit: 'text' }` | Input type is `text` |
| Select property includes options array | Options match `PropertyDefinition.options` |
| Date property produces `datepicker` | Input type is `datepicker` |
| Relation property produces `autocomplete` | Input type is `autocomplete` |
| Checkbox property produces `checkbox` | Input type is `checkbox` |
| Rich text property produces `textarea` | Input type is `textarea` |
| Unknown property type falls back to `text` | Input type is `text`, console warning emitted |
| `required` validation maps to `'required'` | Validation string includes `required` |
| `minLength: 3` maps to `'length:3'` | Validation string includes `length:3` |
| `pattern` maps to `'matches:/regex/'` | Validation string includes `matches` |
| Combined validations are pipe-delimited | String is `'required\|length:3,255'` |
| `overrideLabel` replaces default label | Label matches override |
| `groupName` creates FormKit group wrapper | Schema contains `group` node |

**7.2 Layout Rendering Tests**

| Test | Assertion |
|---|---|
| Default layout renders single column | No grid classes present |
| Two-column layout renders grid | `grid-cols-2` class present |
| `colSpan: 2` field spans full width | `col-span-2` class on that field's wrapper |
| Wizard layout renders step tabs | Step labels from `FormStep.label` visible |
| Wizard blocks advancement on invalid step | Next button disabled / validation errors shown |

**7.3 Conditional Visibility Tests**

| Test | Assertion |
|---|---|
| Field with `showIf equals` hidden initially | Field not in DOM when condition is false |
| Field appears when controlling value matches | Field rendered after user input |
| Hidden field excluded from submit payload | Submitted data does not contain the key |
| Compound AND condition requires both truthy | Field hidden when only one condition met |

**7.4 Relation Autocomplete Tests**

| Test | Assertion |
|---|---|
| Typing 2+ chars fires debounced API call | `GET /api/{concept}?search=...` called after 300ms |
| Fewer than 2 chars does not fire API call | No network request |
| Selection stores ID, displays label | Form value is ID string; visible text is label |
| Edit mode resolves existing relation to label | Label displayed on load |

**7.5 Submit Flow Tests**

| Test | Assertion |
|---|---|
| Create mode sends POST to `/api/{concept}` | HTTP method is POST |
| Edit mode sends PUT to `/api/{concept}/{id}` | HTTP method is PUT |
| Success emits `saved` with id and data | Event payload matches API response |
| 422 response maps errors to fields | Inline error messages appear on correct inputs |
| Network error shows global error message | User-facing error banner displayed |

**7.6 Pre-Population Tests**

| Test | Assertion |
|---|---|
| Edit mode populates all field values | Each field's value matches record data |
| Registry data pre-fills matching fields | Fields show registry values with indicator |
| User can override pre-filled values | Modified value is what gets submitted |
| Priority order respected | Record data wins over registry data wins over defaults |

### Acceptance Criteria

- [ ] All unit tests in 7.1 pass for the schema bridge function.
- [ ] All component tests in 7.2 - 7.6 pass in the Vue Test Utils + Vitest harness.
- [ ] No test relies on hardcoded concept-specific form structure.
- [ ] Tests mock the API layer; no real network calls in unit/component tests.
- [ ] Coverage threshold: 100% of `buildFormKitSchema` branches, 90%+ of `DynamicForm` component lines.
