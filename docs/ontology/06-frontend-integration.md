# 06 - Frontend Integration

This document describes how the Vue 3 frontend consumes the ontology API and transforms backend data into rendered forms and views. It covers the Pinia store, the composable layer, type definitions, and the end-to-end data flow from Postgres to screen.

Source files:

- `web/src/stores/ontology.ts` -- Pinia store
- `web/src/composables/useFormSchema.ts` -- FormKit schema bridge
- `web/src/composables/useConfigAdapter.ts` -- backend-to-frontend ViewConfig adapter
- `web/src/composables/useViewConfig.ts` -- ViewConfig loader composable
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

| Backend field | Frontend field | Fallback |
|---------------|---------------|----------|
| `name` | `label` | concept key |
| `pluralName` or `plural_name` | `pluralLabel` | `label + 's'` |
| `icon` | `icon` | `'pi pi-box'` |
| `target_concept_key` | `targetConcept` | -- |
| `cardinality` | `cardinality` | `'has-many'` |

### Fallback defaults

If the API call fails and no concepts have been loaded yet, the store falls back to four hardcoded concepts with empty properties/relationships:

| Key | Label | Icon |
|-----|-------|------|
| `guest` | Guest | `pi pi-users` |
| `staff` | Staff | `pi pi-id-card` |
| `schedule` | Event | `pi pi-calendar` |
| `prep` | Prep Item | `pi pi-check-square` |

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

Defined in `web/src/types/forms.ts`. Maps all 17 ontology property types to FormKit input types:

| Ontology type | FormKit `$formkit` | Notes |
|---------------|-------------------|-------|
| `text` | `text` | |
| `textarea` | `textarea` | |
| `number` | `number` | |
| `integer` | `number` | Adds `step="1"` attribute |
| `decimal` | `number` | Adds `step="0.01"` attribute |
| `boolean` | `checkbox` | |
| `date` | `date` | |
| `datetime` | `datetime-local` | |
| `time` | `time` | |
| `email` | `email` | Also adds `email` validation rule |
| `url` | `url` | Also adds `url` validation rule |
| `phone` | `tel` | |
| `select` | `select` | Maps `property.options` to FormKit options |
| `multi_select` | `checkbox` | Maps `property.options` to FormKit options |
| `radio` | `radio` | Maps `property.options` to FormKit options |
| `currency` | `number` | Adds `step="0.01"` attribute |
| `percentage` | `number` | Adds `step="1"`, `min="0"` attributes |

Any unknown type falls back to `text`.

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
                      -----------------------------------
                      |                                 |
              form_configs table               view_configs table
              page_configs table                        |
                      |                                 v
                      v                     useViewConfig(concept, name)
              GET /api/ontology/              -> adaptViewConfig()
              configs/forms/:c/:n             -> ViewConfig (typed)
                      |                                 |
                      v                                 v
              FormConfig (raw)              DynamicView component
                      |
                      v
              useFormSchema(config, properties, values)
                      |
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

5. **Form rendering path:** A page component gets the `FormConfig` from `GET /api/ontology/configs/forms/{concept}/{name}`, looks up the concept's properties from the Pinia store, and passes both into `useFormSchema()`. The composable resolves each field's ontology property, maps the property type to a FormKit input type, builds validation rules, and produces `FormKitSchemaField[]`. The `DynamicForm` component renders this schema.

6. **View rendering path:** A page component calls `useViewConfig(conceptKey, viewName)`, which fetches the view config from the API and runs it through `adaptViewConfig()` for field name normalization. The resulting `ViewConfig` drives `DynamicView`, which renders the appropriate view type (table, kanban, timeline, detail, or dashboard).

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

| Backend types (17) | Frontend types (17) | Mapping gap |
|--------------------|---------------------|-------------|
| `text`, `rich_text`, `number`, `select`, `multi_select`, `date`, `datetime`, `checkbox`, `url`, `email`, `phone`, `relation`, `formula`, `rollup`, `files`, `people`, `status` | `text`, `textarea`, `number`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `phone`, `select`, `multi_select`, `radio`, `currency`, `percentage` | 9 types exist only on one side |

The backend defines `rich_text`, `checkbox`, `relation`, `formula`, `rollup`, `files`, `people`, `status` which have no corresponding entry in `PROPERTY_TYPE_INPUT_MAP`.

The frontend defines `textarea`, `integer`, `decimal`, `boolean`, `time`, `radio`, `currency`, `percentage` which are not in the backend `PropertyType` union.

The `resolveInputType()` function falls back to `'text'` for any unrecognized type, so backend-only types will render as plain text inputs.

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

### 5. FormConfig field key mismatch

The backend `FormFieldConfig` uses `propertyKey` to reference properties. The frontend `FormFieldConfig` uses `key`. The `useFormSchema` composable works with the frontend type, so any raw backend form config must be mapped before use.

**Impact:** There is no adapter composable for FormConfig equivalent to `adaptViewConfig()`. If a backend form config is used directly, property resolution will fail because the composable looks up `field.key` in the property map, not `field.propertyKey`.

### 6. Backend layout value 'single' vs frontend 'single-column'

The backend stores layout as `'single'`, but the frontend `FormLayout` type expects `'single-column'`. No adapter normalizes this difference.

**Impact:** Forms loaded directly from the API may not match the layout switch logic in DynamicForm if it checks for exact string equality.

### 7. ViewConfig column width type mismatch

Backend `ViewColumn.width` is `number` (pixels). Frontend `ViewColumn.width` is `string` (CSS value). The `adaptViewConfig()` composable passes through the raw value without conversion.

**Impact:** If the backend returns `width: 200` (number) and the frontend expects `"200px"` (string), column widths may be ignored or misapplied depending on how the renderer consumes them.

### 8. No form config adapter

`useConfigAdapter.ts` provides `adaptViewConfig()` for view configs, but there is no equivalent `adaptFormConfig()` for form configs. The `useFormSchema` composable expects a frontend-shaped `FormConfig`.

**Impact:** Any component that loads a form config from the API must manually map field names. This is a missing piece in the adapter layer.

### 9. Builder API not consumed by frontend store

The Pinia store only uses read-only endpoints. The builder endpoints (`/api/builder/*`) are not integrated into any frontend store or composable.

**Impact:** An admin UI for the ontology builder would need its own API layer and store, or the existing store would need builder actions added.

### 10. Visualization graph endpoint data shape

The `/api/ontology/visualization/graph` endpoint returns `{ nodes, edges }` with a specific shape. The frontend canvas types (`web/src/types/canvas.ts`) define `VisualizationNode` and `VisualizationEdge` types. Whether these align is not verified by the adapter layer.

**Impact:** The canvas view may need its own adapter if the API response shape drifts from the frontend type expectations.
