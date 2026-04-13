# 06 - Frontend Integration

This document describes how the Vue 3 frontend consumes the ontology API and transforms backend data into rendered forms and views. It covers the Pinia store, the composable layer, type definitions, and the end-to-end data flow from Postgres to screen.

Source files:

- `web/src/stores/ontology.ts` -- Pinia store
- `web/src/composables/useFormSchema.ts` -- FormKit schema bridge
- `web/src/composables/useFormConfig.ts` -- FormConfig loader + adapter composable
- `web/src/composables/useConfigAdapter.ts` -- backend-to-frontend ViewConfig adapter
- `web/src/composables/useViewConfig.ts` -- ViewConfig loader composable
- `web/src/composables/useConceptData.ts` -- domain record loader composable
- `web/src/composables/usePageConfig.ts` -- PageConfig loader composable
- `web/src/types/forms.ts` -- form type definitions
- `web/src/types/views.ts` -- view type definitions
- `web/src/types/index.ts` -- shared ontology types

---

## Ontology Pinia store

**File:** `web/src/stores/ontology.ts`

The `useOntologyStore` is a setup-style Pinia store that loads and normalizes the full ontology from the API.

### State

```typescript
const concepts = ref<OntologyConcept[]>([])
const version = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
```

### Getters

```typescript
getConceptByKey: (key: string) => OntologyConcept | undefined
```

Builds an internal `Map<string, OntologyConcept>` from the concepts array for O(1) lookup by key.

```typescript
getPropertiesForConcept: (conceptKey: string) => OntologyProperty[]
```

Returns `concept.properties` for the given concept key, or `[]` if not found.

```typescript
getRelationshipsForConcept: (conceptKey: string) => OntologyRelationship[]
```

Returns `concept.relationships` for the given concept key, or `[]` if not found.

### Action: loadOntology

```typescript
async function loadOntology(): Promise<void>
```

Fetches `GET /api/ontology` and normalizes the response into `OntologyConcept[]`. Handles two response formats:

1. **Object format** (real backend): `concepts` is a `Record<string, Concept>`, `properties` and `relationships` are separate `Record<string, Property[]>` maps. The store merges properties and relationships into each concept object.

2. **Array format** (Vercel shim): `concepts` is already an `OntologyConcept[]` with properties/relationships inlined.

**Field name normalization during load:**

The store handles backend `snake_case` to frontend `camelCase` conversion inline:

**Concept fields:**

| Backend field | Frontend field | Fallback chain |
|---------------|---------------|----------------|
| `name` | `label` | `c.label` -> `c.name` -> concept key |
| `pluralName` or `plural_name` | `pluralLabel` | `c.pluralLabel` -> `c.pluralName` -> `c.plural_name` -> `label + 's'` |
| `icon` | `icon` | `c.icon` -> `'pi pi-box'` |

**Relationship fields (per-relationship mapping inside each concept):**

| Backend field | Frontend field | Fallback chain |
|---------------|---------------|----------------|
| `key` | `key` | -- |
| `label` | `label` | -- |
| `target_concept_key` | `targetConcept` | `rel.targetConcept` -> `rel.target` -> `rel.target_concept_key` |
| `cardinality` | `cardinality` | `rel.cardinality` -> `'has-many'` |

> **Note:** The three-step `targetConcept` fallback chain handles data from the real backend (`target_concept_key`), the Vercel shim (`target`), and pre-normalized data (`targetConcept`).

### Fallback defaults

If the API call fails and no concepts have been loaded yet, the store falls back to four hardcoded concepts with empty properties/relationships:

| Key | Label | Plural Label | Icon |
|-----|-------|-------------|------|
| `guest` | Guest | Guests | `pi pi-users` |
| `staff` | Staff | Staff | `pi pi-id-card` |
| `schedule` | Event | Schedule | `pi pi-calendar` |
| `prep` | Prep Item | Prep Tracker | `pi pi-check-square` |

Note that `staff` uses the same word for both singular and plural labels, and `schedule` uses a different word for each (`Event` singular, `Schedule` plural). These values match the production seed data.

This ensures the app remains navigable even when the backend is unreachable.

---

## useFormSchema composable

**File:** `web/src/composables/useFormSchema.ts`

Converts a `FormConfig` and its resolved `OntologyProperty[]` into FormKit schema nodes that `<FormKit type="form">` can render.

### Signature

```typescript
function useFormSchema(
  config: Ref<FormConfig>,
  properties: Ref<OntologyProperty[]>,
  formValues: Ref<Record<string, unknown>>,
): {
  schemaFields: ComputedRef<FormKitSchemaField[]>
  stepSchemas: ComputedRef<Array<{
    key: string
    label: string
    description?: string
    icon?: string
    fields: FormKitSchemaField[]
  }>>
  convertFields: (fields: FormFieldConfig[]) => FormKitSchemaField[]
  evaluateCondition: (condition: ConditionExpression) => boolean
}
```

### PROPERTY_TYPE_INPUT_MAP

Defined in `web/src/types/forms.ts`. Maps ontology property types to FormKit input types. Several entries use PrimeVue-backed custom FormKit inputs (registered via `@formkit/addons` or custom input plugins), not native HTML inputs:

| Ontology type | FormKit `$formkit` | PrimeVue component | Notes |
|---------------|-------------------|-------------------|-------|
| `text` | `text` | -- | Native HTML text input |
| `textarea` | `textarea` | -- | Native HTML textarea |
| `number` | `number` | -- | Native HTML number input |
| `integer` | `number` | -- | Adds `step="1"` attribute |
| `decimal` | `number` | -- | Adds `step="0.01"` attribute |
| `boolean` | `primeToggle` | `ToggleSwitch` | PrimeVue toggle switch, not a native checkbox |
| `date` | `primeDatePicker` | `DatePicker` | PrimeVue calendar picker, not native `<input type="date">` |
| `datetime` | `primeDatePicker` | `DatePicker` | PrimeVue calendar with `showTime: true` via attrs |
| `time` | `time` | -- | Native HTML time input |
| `email` | `email` | -- | Also adds `email` validation rule |
| `url` | `url` | -- | Also adds `url` validation rule |
| `phone` | `tel` | -- | Native HTML tel input |
| `select` | `select` | -- | Maps `property.options` to FormKit options |
| `multi_select` | `primeTagList` | `AutoComplete` (multi) | PrimeVue tag-based multi-select, not native checkboxes |
| `radio` | `radio` | -- | Maps `property.options` to FormKit options |
| `currency` | `number` | -- | Adds `step="0.01"` attribute |
| `percentage` | `number` | -- | Adds `step="1"`, `min="0"` attributes |
| `relation` | `primeAutocomplete` | `AutoComplete` | PrimeVue autocomplete for FK lookups; options passed via `attrs` |
| `checkbox` | `primeToggle` | `ToggleSwitch` | Backend `checkbox` type maps to PrimeVue toggle, same as `boolean` |

Any unknown type falls back to `text`.

> **Note on PrimeVue inputs:** The `primeToggle`, `primeDatePicker`, `primeTagList`, and `primeAutocomplete` identifiers are custom FormKit input registrations that wrap PrimeVue components. They are NOT native FormKit or HTML input types. These must be registered in the FormKit config for schema-driven rendering to work.

### buildValidation

```typescript
function buildValidation(
  field: FormFieldConfig,
  property: OntologyProperty | undefined,
): string
```

Builds a pipe-delimited FormKit validation string from field config and property metadata. Rules applied:

| Condition | Validation rule |
|-----------|----------------|
| `field.required` or `property.required` | `required` |
| Property type is `email` | `email` |
| Property type is `url` | `url` |
| Property type is `number`, `integer`, `decimal`, `currency`, or `percentage` | `number` |
| `validationRules.minLength` and `maxLength` both set | `length:{min},{max}` |
| `validationRules.minLength` only | `length:{min}` |
| `validationRules.maxLength` only | `length:0,{max}` |
| `validationRules.min` | `min:{min}` |
| `validationRules.max` | `max:{max}` |
| `validationRules.pattern` | `matches:/{pattern}/` |

Example output: `"required|email|length:0,255"`

### fieldToSchemaNode

```typescript
function fieldToSchemaNode(
  field: FormFieldConfig,
  property: OntologyProperty | undefined,
): FormKitSchemaField
```

Converts a single field config + ontology property into a FormKit schema node. The returned object:

```typescript
interface FormKitSchemaField {
  $formkit: string                // FormKit input type
  name: string                    // field key (used as form model key)
  label: string                   // display label
  placeholder?: string
  help?: string                   // help text below input
  validation?: string             // pipe-delimited validation rules
  options?: Array<{ value: string; label: string }>
  disabled?: boolean              // true if field or property is readOnly
  step?: string                   // for number inputs
  min?: string                    // for percentage
  attrs?: Record<string, unknown>
}
```

Label resolution priority: `field.label` > `property.label` > `formatKeyAsLabel(field.key)`.

The `formatKeyAsLabel` helper title-cases raw keys: `"dietary_restrictions"` becomes `"Dietary Restrictions"`.

### Conditional visibility (showIf)

Fields with a `showIf` expression are evaluated against the current form values. Hidden fields and fields whose `showIf` evaluates to `false` are filtered out before schema generation.

The `evaluateCondition` function supports the full `ConditionExpression` tree:

| Type | Behavior |
|------|----------|
| `comparison` | Evaluates a single field against a value using an operator |
| `and` | All children must be true |
| `or` | At least one child must be true |
| `not` | Inverts the child condition |

Supported comparison operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `greater_than`, `less_than`, `greater_or_equal`, `less_or_equal`, `is_empty`, `is_not_empty`, `in`, `not_in`, `between`.

### Wizard support

When `config.steps` is defined, the composable produces `stepSchemas` -- an array of step objects, each containing its own `fields` array of FormKit schema nodes. This enables multi-step wizard forms.

---

## useFormConfig composable

**File:** `web/src/composables/useFormConfig.ts`

Loads a named FormConfig from the API and adapts it from backend shape to frontend shape. This is the FormConfig equivalent of `useViewConfig` -- the gap analysis in earlier versions of this document incorrectly stated it did not exist.

### Signature

```typescript
function useFormConfig(
  conceptKey: Ref<string> | string,
  formName: Ref<string> | string,
): {
  config: Ref<FormConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}
```

### Behavior

- Calls `GET /api/ontology/configs/forms/{concept}/{name}` on mount.
- Passes the raw response through `adaptFormConfig()` (internal adapter function).
- Re-fetches automatically if either `conceptKey` or `formName` is a `Ref` and its value changes.
- Exposes a `reload()` function for manual refresh.

### adaptFormConfig (internal)

The composable includes a full adapter that bridges backend-to-frontend differences:

| Backend field | Frontend field | Transformation |
|---------------|---------------|----------------|
| `name` | `title` | Used as title only if it does not look like a slug (no hyphens or underscores) |
| `layout: 'single'` | `layout: 'single-column'` | String remapped |
| `fields[].propertyKey` | `fields[].key` | Checks `key`, `propertyKey`, `property_key` in priority order |
| `fields[].overrideLabel` | `fields[].label` | Also checks `override_label` (snake_case) |
| `fields[].overridePlaceholder` | `fields[].placeholder` | Also checks `override_placeholder` |
| `concept_key` | `conceptKey` | Snake-to-camel conversion |
| Step fields as strings | Step fields as objects | `["name", "type"]` becomes `[{ key: "name" }, { key: "type" }]` |

This adapter solves gap analysis items 5, 6, and 8 from the previous version of this document (FormConfig field key mismatch, layout value mismatch, and no form config adapter).

### Usage example

```typescript
import { useFormConfig } from '@/composables/useFormConfig'

const { config, loading, error } = useFormConfig('guest', 'default')

// config.value is a fully adapted FormConfig ready for useFormSchema()
```

---

## useConfigAdapter composable

**File:** `web/src/composables/useConfigAdapter.ts`

Handles the `snake_case` (backend/Postgres) to `camelCase` (frontend) field name conversion for ViewConfig objects.

### adaptViewConfig

```typescript
function adaptViewConfig(raw: Record<string, unknown>): ViewConfig
```

Accepts a raw API response object and returns a typed `ViewConfig`. Handles both naming conventions for every field:

| Backend field (`snake_case`) | Frontend field (`camelCase`) |
|------------------------------|------------------------------|
| `view_type` | `viewType` |
| `concept_key` | `conceptKey` |
| `group_by` | `groupBy` |
| `timeline_start` | `timelineStart` |
| `timeline_end` | `timelineEnd` |
| `row_action` | `rowAction` |
| `render_mode` | `renderMode` |
| `property_key` (column) | `propertyKey` (column) |

Each field checks for the camelCase variant first (already converted), then falls back to the snake_case variant. This makes the adapter safe to call on data from either naming convention.

### adaptColumns

```typescript
function adaptColumns(
  raw: Record<string, unknown>[] | undefined
): ViewColumn[] | undefined
```

Internal helper that normalizes column objects. Maps `property_key` to `propertyKey` and populates `key` from whichever variant is present.

### getColumnKey

```typescript
function getColumnKey(col: ViewColumn): string
```

Resolves the effective property key from a column, checking `col.key` first, then `col.propertyKey`, defaulting to `''`.

---

## useViewConfig composable

**File:** `web/src/composables/useViewConfig.ts`

Loads a named ViewConfig from the API and adapts it for frontend use.

### Signature

```typescript
function useViewConfig(
  conceptKey: Ref<string> | string,
  viewName: Ref<string> | string,
): {
  config: Ref<ViewConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}
```

### Behavior

- Calls `GET /api/ontology/configs/views/{concept}/{name}` on mount.
- Passes the raw response through `adaptViewConfig()`.
- Re-fetches automatically if either `conceptKey` or `viewName` is a `Ref` and its value changes.
- Exposes a `reload()` function for manual refresh.

---

## useConceptData composable

**File:** `web/src/composables/useConceptData.ts`

Loads domain records for a given concept from the generic domain CRUD API. This is the data-fetching composable that feeds table, kanban, and timeline views with actual records.

### Signature

```typescript
function useConceptData(
  conceptKey: Ref<string> | string,
  options?: Ref<UseConceptDataOptions> | UseConceptDataOptions,
): {
  records: Ref<Record<string, unknown>[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  total: Ref<number>
  reload: () => Promise<void>
}

interface UseConceptDataOptions {
  filters?: Record<string, unknown>
  sort?: { field: string; direction: 'asc' | 'desc' }
  page?: number
  limit?: number
}
```

### Behavior

- Calls `GET /api/domains/{conceptKey}` on mount with optional query parameters for filtering, sorting, and pagination.
- Handles two response formats:
  - **Real backend:** Response is a flat array (unwrapped from `ApiResponse.data`). `total` falls back to array length.
  - **Vercel shim:** Response is `{ records: [...], total: N }`.
- Filter parameters are passed as `filter[fieldName]=value` query parameters.
- Sort is passed as `sortBy` and `sortDir` query parameters.
- On error, resets `records` to `[]` and `total` to `0`.

### Usage example

```typescript
import { useConceptData } from '@/composables/useConceptData'

const { records, loading, total, reload } = useConceptData('guest', {
  filters: { status: 'confirmed' },
  sort: { field: 'name', direction: 'asc' },
  page: 1,
  limit: 25,
})
```

---

## usePageConfig composable

**File:** `web/src/composables/usePageConfig.ts`

Loads a PageConfig by URL slug from the API. PageConfigs drive dashboard-style pages with widget grids and responsive breakpoint layouts.

### Signature

```typescript
function usePageConfig(
  slug: Ref<string> | string,
): {
  config: Ref<PageConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}
```

### PageConfig type

```typescript
interface PageConfig {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly widgets: ReadonlyArray<PageWidget>
  readonly breakpoints?: {
    readonly desktop: ReadonlyArray<PageWidgetLayout>
    readonly tablet?: ReadonlyArray<PageWidgetLayout>
    readonly mobile?: ReadonlyArray<PageWidgetLayout>
  }
}

interface PageWidget {
  readonly widgetId: string
  readonly type: string           // 'stat-card' | 'chart' | 'table' | 'list'
  readonly title?: string
  readonly conceptKey?: string
  readonly filter?: Record<string, unknown>
  readonly displayOptions?: Record<string, unknown>
}

interface PageWidgetLayout {
  readonly widgetId: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}
```

### Behavior

- Calls `GET /api/ontology/configs/pages/{slug}` on mount.
- Re-fetches automatically if `slug` is a `Ref` and its value changes.
- No adapter transformation is applied -- the API response is used directly as `PageConfig`.

### Usage example

```typescript
import { usePageConfig } from '@/composables/usePageConfig'

const { config, loading, error } = usePageConfig('dashboard')

// config.value.widgets contains the widget definitions
// config.value.breakpoints.desktop contains the grid layout positions
```

---

## Frontend type definitions

### OntologyConcept (frontend)

**File:** `web/src/types/index.ts`

```typescript
interface OntologyConcept {
  key: string
  label: string           // backend: "name"
  pluralLabel: string     // backend: "pluralName"
  icon: string
  properties: OntologyProperty[]
  relationships: OntologyRelationship[]
}
```

### OntologyProperty (frontend)

```typescript
interface OntologyProperty {
  key: string
  label: string
  type: string             // backend: PropertyType union
  required: boolean
  options?: Array<{ value: string; label: string; color?: string }>
  placeholder?: string
  hidden?: boolean
  readOnly?: boolean
  description?: string
  validationRules?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    pattern?: string
  }
}
```

### OntologyRelationship (frontend)

```typescript
interface OntologyRelationship {
  key: string
  label: string
  targetConcept: string    // backend: "targetConceptKey"
  cardinality: 'has-one' | 'has-many' | 'many-to-many'
}
```

### FormConfig (frontend)

**File:** `web/src/types/forms.ts`

```typescript
interface FormConfig {
  id: string
  title: string
  description?: string
  layout: 'single-column' | 'two-column' | 'wizard'
  fields?: FormFieldConfig[]
  steps?: FormStep[]
  conceptKey?: string
  showCancel?: boolean
  submitLabel?: string
  cancelLabel?: string
}
```

### ViewConfig (frontend)

**File:** `web/src/types/views.ts`

```typescript
interface ViewConfig {
  id: string
  name?: string
  title?: string
  description?: string
  viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  conceptKey: string
  columns?: ViewColumn[]
  filters?: ViewFilter[]
  sort?: ViewSort
  sorts?: ViewSort[]
  groupBy?: string
  timelineStart?: string
  timelineEnd?: string
  dateField?: string          // legacy alias for timelineStart
  endDateField?: string       // legacy alias for timelineEnd
  rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  renderMode?: 'card-rows' | 'dense-table'
  tabs?: ViewTab[]
  widgets?: DashboardWidget[]
  presets?: ViewPreset[]
  activePresetId?: string
  filterCondition?: ConditionExpression
  pageSize?: number
}
```

---

## End-to-end data flow

```
Postgres tables                  Backend                           Frontend
-----------------     ---------------------------     --------------------------------
ontology_concepts     loader.ts (parseConcept)        Pinia store (loadOntology)
ontology_properties   loader.ts (parseProperty)         |
ontology_relationships loader.ts (parseRelationship)    v
        |                   |                     OntologyConcept[] (normalized)
        v                   v                           |
  OntologyCache       ontology-routes.ts               |
  (Map-based)         (serializeOntology)               |
        |                   |                           v
        v                   v                     getConceptByKey()
  5-min in-memory     GET /api/ontology            getPropertiesForConcept()
  cache (TTL)         (JSON response)              getRelationshipsForConcept()
                            |                           |
                            v                           v
     .----------------------------------------------------------.
     |                         |                        |        |
  form_configs          view_configs            page_configs   domain tables
  table                 table                   table          (guests, staff, ...)
     |                         |                        |        |
     v                         v                        v        v
  GET /configs/          GET /configs/            GET /configs/ GET /api/domains/:key
  forms/:c/:n            views/:c/:n             pages/:slug    |
     |                         |                        |        |
     v                         v                        v        v
  useFormConfig()        useViewConfig()          usePageConfig() useConceptData()
  -> adaptFormConfig()   -> adaptViewConfig()     -> PageConfig   -> records[]
  -> FormConfig          -> ViewConfig                   |        |
     |                         |                        v        v
     v                         v              DashboardPage    DynamicView
  useFormSchema()        DynamicView            (widget grid)   (table/kanban/
  (config, props, vals)  (table/kanban/                          timeline/detail)
     |                    timeline/detail)
     v
  FormKitSchemaField[]
     |
     v
  DynamicForm component
  (<FormKit type="form" :schema="schemaFields">)
```

### Step-by-step walkthrough

1. **Postgres** stores ontology concepts, properties, and relationships in five tables (`ontology_concepts`, `ontology_properties`, `ontology_relationships`, `ontology_events`, `ontology_constraints`). Config tables (`form_configs`, `view_configs`, `page_configs`) store rendering instructions.

2. **Loader** (`functions/src/ontology/loader.ts`) reads all five tables in parallel, parses `snake_case` Postgres rows into `camelCase` TypeScript objects, resolves concept inheritance (parent properties merged into child), and caches the result as an `OntologyCache` with a 5-minute TTL.

3. **API routes** (`ontology-routes.ts`) serve the cached ontology. `serializeOntology()` converts `Map` instances to plain objects for JSON serialization.

4. **Pinia store** (`ontology.ts`) calls `GET /api/ontology`, normalizes the response into `OntologyConcept[]` (merging separate properties/relationships maps into each concept), and handles the `snake_case` to `camelCase` field name differences inline.

5. **Form rendering path:** A page component calls `useFormConfig(conceptKey, formName)`, which fetches the form config from `GET /api/ontology/configs/forms/{concept}/{name}` and runs it through `adaptFormConfig()` to normalize field keys (`propertyKey` -> `key`), layout values (`'single'` -> `'single-column'`), and step fields (strings -> objects). The component looks up the concept's properties from the Pinia store, then passes both into `useFormSchema()`. The composable resolves each field's ontology property, maps the property type to a FormKit input type (including PrimeVue custom inputs), builds validation rules, and produces `FormKitSchemaField[]`. The `DynamicForm` component renders this schema.

6. **View rendering path:** A page component calls `useViewConfig(conceptKey, viewName)`, which fetches the view config from the API and runs it through `adaptViewConfig()` for field name normalization. The resulting `ViewConfig` drives `DynamicView`, which renders the appropriate view type (table, kanban, timeline, detail, or dashboard).

7. **Data loading path:** View and list components call `useConceptData(conceptKey, options)` to fetch domain records from `GET /api/domains/{conceptKey}`. The composable passes filter, sort, and pagination parameters as query strings. It handles both backend response formats (flat array from Express, wrapped `{ records, total }` from Vercel shim). The returned `records` ref feeds into the view renderer.

8. **Dashboard rendering path:** Dashboard pages call `usePageConfig(slug)` to fetch the page config from `GET /api/ontology/configs/pages/{slug}`. The returned `PageConfig` contains a `widgets` array and responsive `breakpoints` layout. Each widget uses its `conceptKey` to call `useConceptData()` independently, and the grid layout is driven by the breakpoint positions.

---

## Frontend vs backend type differences

The backend and frontend define similar but distinct types. Key structural differences:

### Concept

| Aspect | Backend (`Concept`) | Frontend (`OntologyConcept`) |
|--------|---------------------|------------------------------|
| Name field | `name: string` | `label: string` |
| Plural | `pluralName: string` | `pluralLabel: string` |
| Properties | Separate `Map<string, Property[]>` | Inlined `properties: OntologyProperty[]` |
| Relationships | Separate `Map<string, Relationship[]>` | Inlined `relationships: OntologyRelationship[]` |
| Metadata | `id`, `extends`, `isRegistry`, `isConfig` | Not present |

### Property

| Aspect | Backend (`Property`) | Frontend (`OntologyProperty`) |
|--------|---------------------|-------------------------------|
| Concept ref | `conceptKey: string` | Not present (inlined on concept) |
| ID | `id: string` | Not present |
| Sort order | `sortOrder: number` | Not present |
| Default value | `defaultValue?: unknown` | Not present |
| Postgres column | `postgresColumn?: string` | Not present |

### Relationship

| Aspect | Backend (`Relationship`) | Frontend (`OntologyRelationship`) |
|--------|--------------------------|-----------------------------------|
| Source/target | `sourceConceptKey`, `targetConceptKey` | `targetConcept` only |
| ID | `id: string` | Not present |
| Inverse | `inverseKey?: string` | Not present |
| Description | `description?: string` | Not present |

### FormConfig

| Aspect | Backend | Frontend |
|--------|---------|----------|
| Layout values | `'single' \| 'two-column' \| 'wizard'` | `'single-column' \| 'two-column' \| 'wizard'` |
| Field key | `propertyKey` | `key` |
| Title | `name` (config name) | `title` (display title) |
| UI extras | Not present | `showCancel`, `submitLabel`, `cancelLabel` |
| Override fields | `overrideLabel`, `overridePlaceholder` | `label`, `placeholder` (direct) |
| Autocomplete | `autocompleteSource` | Not present |

### ViewConfig

| Aspect | Backend | Frontend |
|--------|---------|----------|
| Column key | `propertyKey` only | `propertyKey` and `key` (dual) |
| Column width | `number` (pixels) | `string` (CSS value) |
| Multiple sorts | Not present | `sorts?: ViewSort[]` |
| Render mode | Not present | `renderMode?: 'card-rows' \| 'dense-table'` |
| Widgets | Separate `PageConfig.widgets` | Inlined `widgets?: DashboardWidget[]` |
| Presets | `{ name, filter }` | `{ id, name, description, viewType, columns, filters, sorts, ... }` |
| Filter condition | Not present | `filterCondition?: ConditionExpression` |
| Page size | Not present | `pageSize?: number` |

### PropertyType

| Backend types (17) | Frontend PROPERTY_TYPE_INPUT_MAP entries (19) | Mapping gap |
|--------------------|-----------------------------------------------|-------------|
| `text`, `rich_text`, `number`, `select`, `multi_select`, `date`, `datetime`, `checkbox`, `url`, `email`, `phone`, `relation`, `formula`, `rollup`, `files`, `people`, `status` | `text`, `textarea`, `number`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `phone`, `select`, `multi_select`, `radio`, `currency`, `percentage`, `relation`, `checkbox` | 7 types exist only on one side |

**Backend types mapped in PROPERTY_TYPE_INPUT_MAP (10 of 17):** `text`, `number`, `select`, `multi_select`, `date`, `datetime`, `checkbox` (-> `primeToggle`), `url`, `email`, `phone`, `relation` (-> `primeAutocomplete`).

**Backend types NOT in PROPERTY_TYPE_INPUT_MAP (7 of 17):** `rich_text`, `formula`, `rollup`, `files`, `people`, `status`. These fall back to `text` via `resolveInputType()`.

**Frontend-only types in PROPERTY_TYPE_INPUT_MAP (9 of 19):** `textarea`, `integer`, `decimal`, `boolean`, `time`, `radio`, `currency`, `percentage`. These exist in the map and render correctly but have no corresponding backend `PropertyType` union member.

The `resolveInputType()` function falls back to `'text'` for any unrecognized type, so backend-only types without a map entry will render as plain text inputs.

---

## Gap analysis: backend features not yet consumed by frontend

### 1. Events and constraints not loaded

The `GET /api/ontology` response includes `events` and `constraints` maps, but the Pinia store discards them during normalization. The `OntologyConcept` type has no fields for events or constraints.

**Impact:** Domain events and conditional defaults/required fields defined in the ontology are invisible to the frontend.

### 2. Concept inheritance metadata not preserved

Backend concepts have `extends`, `isRegistry`, and `isConfig` fields. The store does not carry these through to `OntologyConcept`.

**Impact:** The frontend cannot display inheritance hierarchies or distinguish config concepts from domain concepts in the UI.

### 3. Property metadata partially consumed

Backend properties include `id`, `conceptKey`, `sortOrder`, `defaultValue`, and `postgresColumn`. The frontend `OntologyProperty` type does not include these.

**Impact:**
- `sortOrder` is respected by the backend when ordering properties, but the frontend relies on array order rather than an explicit sort field.
- `defaultValue` from the ontology is not used to pre-populate forms (only `FormFieldConfig.defaultValue` is used, which is a frontend-only field).
- Property `id` is needed for builder PUT/DELETE operations but is not available via the read-only Pinia store.

### 4. Relationship detail loss

Backend relationships include `sourceConceptKey`, `inverseKey`, and `description`. The frontend collapses relationships to `{ key, label, targetConcept, cardinality }`.

**Impact:** Inverse relationship navigation and relationship descriptions are not available in the UI.

### ~~5. FormConfig field key mismatch~~ (RESOLVED)

~~The backend `FormFieldConfig` uses `propertyKey` to reference properties. The frontend `FormFieldConfig` uses `key`.~~

**Status:** Resolved by `useFormConfig` composable (`web/src/composables/useFormConfig.ts`). The internal `adaptFormFields()` function checks `key`, `propertyKey`, and `property_key` in priority order.

### ~~6. Backend layout value 'single' vs frontend 'single-column'~~ (RESOLVED)

~~The backend stores layout as `'single'`, but the frontend `FormLayout` type expects `'single-column'`.~~

**Status:** Resolved by `useFormConfig` composable. The internal `adaptLayout()` function maps `'single'` to `'single-column'`.

### 7. ViewConfig column width type mismatch

Backend `ViewColumn.width` is `number` (pixels). Frontend `ViewColumn.width` is `string` (CSS value). The `adaptViewConfig()` composable passes through the raw value without conversion.

**Impact:** If the backend returns `width: 200` (number) and the frontend expects `"200px"` (string), column widths may be ignored or misapplied depending on how the renderer consumes them.

### ~~8. No form config adapter~~ (RESOLVED)

~~`useConfigAdapter.ts` provides `adaptViewConfig()` for view configs, but there is no equivalent `adaptFormConfig()` for form configs.~~

**Status:** Resolved. `useFormConfig` composable (`web/src/composables/useFormConfig.ts`) contains a full `adaptFormConfig()` function that handles layout values, field key mapping, label/placeholder overrides, step field normalization (string arrays to objects), and concept key snake-to-camel conversion.

### 9. Builder API not consumed by frontend store

The Pinia store only uses read-only endpoints. The builder endpoints (`/api/builder/*`) are not integrated into any frontend store or composable.

**Impact:** An admin UI for the ontology builder would need its own API layer and store, or the existing store would need builder actions added.

### 10. Visualization graph endpoint data shape

The `/api/ontology/visualization/graph` endpoint returns `{ nodes, edges }` with a specific shape. The frontend canvas types (`web/src/types/canvas.ts`) define `VisualizationNode` and `VisualizationEdge` types. Whether these align is not verified by the adapter layer.

**Impact:** The canvas view may need its own adapter if the API response shape drifts from the frontend type expectations.

---

## Recipe: How to add a new ontology-driven view

This recipe walks through adding a new ontology-driven page for a concept (e.g., adding a `/vendors` page backed by a `vendor` concept).

### Prerequisites

- The concept exists in `ontology_concepts` (created via `POST /api/builder/concepts` or seed migration).
- The concept has properties in `ontology_properties`.
- The domain table exists in Postgres (e.g., `vendors` with a `properties` JSONB column).

### Step 1: Seed a ViewConfig

Insert a view config into the `view_configs` table (or call `POST /api/builder/concepts/vendor/generate-defaults` to auto-generate one):

```sql
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, version, status)
VALUES (
  'vendor',
  'default',
  'table',
  '[
    {"propertyKey": "name", "width": 200, "sortable": true, "filterable": true},
    {"propertyKey": "type", "width": 150, "sortable": true, "filterable": true},
    {"propertyKey": "contact_email", "width": 200, "sortable": true}
  ]',
  '{"field": "created_at", "direction": "desc"}',
  1,
  'active'
);
```

### Step 2: Seed a FormConfig

```sql
INSERT INTO form_configs (concept_key, name, fields, layout, version, status)
VALUES (
  'vendor',
  'default',
  '[
    {"propertyKey": "name", "colSpan": 2},
    {"propertyKey": "type", "colSpan": 1},
    {"propertyKey": "contact_email", "colSpan": 1}
  ]',
  'single',
  1,
  'active'
);
```

### Step 3: Add a route in the Vue router

```typescript
// web/src/router/index.ts
{
  path: '/vendors',
  name: 'vendors',
  component: () => import('@/views/ConfigListPage.vue'),
  meta: { conceptKey: 'vendor', viewName: 'default' },
},
{
  path: '/vendors/:id',
  name: 'vendor-detail',
  component: () => import('@/views/ConfigDetailPage.vue'),
  meta: { conceptKey: 'vendor' },
},
{
  path: '/vendors/new',
  name: 'vendor-new',
  component: () => import('@/views/ConfigFormPage.vue'),
  meta: { conceptKey: 'vendor', formName: 'default' },
},
```

### Step 4: Add navigation entry (optional)

If the concept should appear in the sidebar, add it to the navigation config or let the ontology-driven nav auto-discover it.

### Step 5: Verify the data flow

The following chain fires automatically -- no additional code is needed:

1. **ConfigListPage** reads `conceptKey` and `viewName` from route meta.
2. It calls `useViewConfig('vendor', 'default')` which fetches `GET /api/ontology/configs/views/vendor/default` and runs it through `adaptViewConfig()`.
3. It calls `useConceptData('vendor')` which fetches `GET /api/domains/vendor` and returns the records.
4. It looks up `vendor` in the Pinia ontology store via `getConceptByKey('vendor')` to resolve property labels, types, and formatting.
5. The `DynamicView` component renders the table using the `ViewConfig` columns and the domain records.

For forms, the same pattern applies:

1. **ConfigFormPage** reads `conceptKey` and `formName` from route meta.
2. It calls `useFormConfig('vendor', 'default')` which fetches and adapts the form config.
3. It looks up properties via `getPropertiesForConcept('vendor')` from the Pinia store.
4. It passes both into `useFormSchema(config, properties, formValues)` which produces `FormKitSchemaField[]`.
5. The `DynamicForm` component renders the schema using `<FormKit type="form" :schema="schemaFields">`.

### Key composable reference

| Composable | Purpose | API endpoint |
|------------|---------|-------------|
| `useViewConfig(concept, name)` | Load + adapt ViewConfig | `GET /api/ontology/configs/views/:concept/:name` |
| `useFormConfig(concept, name)` | Load + adapt FormConfig | `GET /api/ontology/configs/forms/:concept/:name` |
| `usePageConfig(slug)` | Load PageConfig for dashboards | `GET /api/ontology/configs/pages/:slug` |
| `useConceptData(concept, opts)` | Load domain records | `GET /api/domains/:concept` |
| `useFormSchema(config, props, vals)` | Convert FormConfig to FormKit schema | (no API call, pure transform) |
| `useOntologyStore().loadOntology()` | Load full ontology into Pinia | `GET /api/ontology` |
