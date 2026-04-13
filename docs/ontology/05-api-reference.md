# 05 - Ontology API Reference

This document covers every HTTP endpoint that serves or mutates the GR-Ops domain ontology. Endpoints are split into two Express routers mounted at different base paths.

| Router | Base path | Auth | Purpose |
|--------|-----------|------|---------|
| `ontologyRouter` | `/api/ontology` | Public (GET), Director+ (POST /reload) | Read-only access to ontology, configs, and visualization |
| `ontologyBuilderRouter` | `/api/builder` | Director+ (all routes) | CRUD for concepts, properties, relationships; default generation |

Source files:

- `functions/src/api/ontology-routes.ts` -- read-only router
- `functions/src/api/ontology-builder.ts` -- builder (mutation) router

---

## Common response envelope

Every endpoint returns a JSON body conforming to `ApiResponse<T>`:

```typescript
interface ApiResponse<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: string
  readonly meta?: {
    readonly total: number
    readonly page: number
    readonly limit: number
    readonly hasMore: boolean
  }
}
```

On success, `success` is `true` and `data` contains the payload.
On failure, `success` is `false` and `error` contains a human-readable message.

---

## Authentication and authorization

| Middleware | Import | Behavior |
|-----------|--------|----------|
| `requireAuth` | `../auth/middleware` | Rejects 401 if `req.user` is not set (no valid Firebase token). |
| `requireRole(maxPriority)` | `../auth/middleware` | Rejects 403 if `req.role.priority > maxPriority`. Lower numeric priority = higher access. |

Priority thresholds used:

| Constant | Value | Who qualifies |
|----------|-------|---------------|
| `DIRECTOR_PRIORITY` | `0` | Directors and admins |
| `10` (reload endpoint) | `10` | Director-level roles |

All builder endpoints apply `requireAuth` + `requireRole(DIRECTOR_PRIORITY)` at the router level. Read-only endpoints are public except `POST /reload`.

---

## Read-only endpoints (ontologyRouter)

### GET /api/ontology

Returns the full ontology cache: all concepts, properties, relationships, events, and constraints.

**Auth:** None (public).

**Caching:** `Cache-Control: public, max-age=300, stale-while-revalidate=3600` (5-minute CDN cache, 1-hour stale-while-revalidate).

**Response shape:**

```typescript
{
  success: true,
  data: {
    concepts: Record<string, Concept>,
    properties: Record<string, Property[]>,
    relationships: Record<string, Relationship[]>,
    events: Record<string, DomainEventDef[]>,
    constraints: Record<string, Constraint[]>,
    loadedAt: number
  }
}
```

The backend stores concepts/properties/relationships as `Map` objects internally. The `serializeOntology()` helper converts them to plain objects keyed by concept key before serialization.

**Example response (abridged):**

```json
{
  "success": true,
  "data": {
    "concepts": {
      "guest": {
        "id": "uuid-1",
        "key": "guest",
        "name": "Guest",
        "pluralName": "Guests",
        "icon": "pi pi-users",
        "isRegistry": false,
        "isConfig": false
      }
    },
    "properties": {
      "guest": [
        {
          "id": "uuid-2",
          "conceptKey": "guest",
          "key": "name",
          "label": "Name",
          "type": "text",
          "required": true,
          "sortOrder": 0
        }
      ]
    },
    "relationships": {
      "guest": [
        {
          "id": "uuid-3",
          "sourceConceptKey": "guest",
          "targetConceptKey": "staff",
          "key": "assigned_staff",
          "label": "Assigned Staff",
          "cardinality": "has-many"
        }
      ]
    },
    "events": {},
    "constraints": {},
    "loadedAt": 1712700000000
  }
}
```

---

### GET /api/ontology/concepts

Returns all active concepts as a flat array.

**Auth:** None.

**Response:** `ApiResponse<Concept[]>`

---

### GET /api/ontology/concepts/:key

Returns a single concept with its properties and relationships.

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Concept key (e.g., `guest`, `staff`, `schedule`) |

**Response:**

```typescript
{
  success: true,
  data: {
    concept: Concept,
    properties: Property[],
    relationships: Relationship[]
  }
}
```

**Errors:** `404` if concept key does not exist.

---

### GET /api/ontology/configs/forms/:concept

Returns the first active form config for a concept (the "default" form).

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `concept` | `string` | Concept key |

**Response:** `ApiResponse<FormConfig>`

**Errors:** `404` if no form config exists for the concept.

---

### GET /api/ontology/configs/forms/:concept/:name

Returns a specific named form config.

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `concept` | `string` | Concept key |
| `name` | `string` | Form config name (e.g., `default`, `wizard`) |

**Response:** `ApiResponse<FormConfig>`

**Errors:** `404` if the named form config does not exist.

**Backend FormConfig shape:**

```typescript
interface FormConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string
  readonly fields: ReadonlyArray<FormFieldConfig>
  readonly layout?: 'single' | 'two-column' | 'wizard'
  readonly steps?: ReadonlyArray<FormStep>
}

interface FormFieldConfig {
  readonly propertyKey: string
  readonly groupName?: string
  readonly colSpan?: 1 | 2
  readonly showIf?: ConditionExpression
  readonly autocompleteSource?: string
  readonly overrideLabel?: string
  readonly overridePlaceholder?: string
}
```

---

### GET /api/ontology/configs/views/:concept

Returns all active view configs for a concept.

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `concept` | `string` | Concept key |

**Response:** `ApiResponse<ViewConfig[]>`

---

### GET /api/ontology/configs/views/:concept/:name

Returns a specific named view config.

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `concept` | `string` | Concept key |
| `name` | `string` | View config name (e.g., `default`) |

**Response:** `ApiResponse<ViewConfig>`

**Errors:** `404` if the named view config does not exist.

**Backend ViewConfig shape:**

```typescript
interface ViewConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string
  readonly viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  readonly columns?: ReadonlyArray<ViewColumn>
  readonly filters?: ReadonlyArray<ViewFilter>
  readonly sort?: ViewSort
  readonly groupBy?: string
  readonly timelineStart?: string
  readonly timelineEnd?: string
  readonly rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  readonly presets?: ReadonlyArray<ViewPreset>
  readonly tabs?: ReadonlyArray<{
    readonly label: string
    readonly conceptKey: string
    readonly filter: Record<string, string>
    readonly viewName: string
  }>
}
```

---

### GET /api/ontology/configs/pages

Returns all active page configs.

**Auth:** None.

**Response:** `ApiResponse<PageConfig[]>`

---

### GET /api/ontology/configs/pages/:slug

Returns a single page config by its URL slug.

**Auth:** None.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `slug` | `string` | Page slug (e.g., `dashboard`, `guests`) |

**Response:** `ApiResponse<PageConfig>`

**Errors:** `404` if no page config exists for the slug.

---

### GET /api/ontology/visualization/graph

Returns graph data for the system canvas view. Queries Postgres directly (bypasses the ontology cache) for real-time node/edge data.

**Auth:** None.

**Response:**

```typescript
{
  success: true,
  data: {
    nodes: Array<{
      id: string
      type: 'concept'
      label: string
      data: {
        key: string
        name: string
        pluralName: string
        icon: string
        propertyCount: number
        isConfig: boolean
        isRegistry: boolean
      }
    }>,
    edges: Array<{
      id: string          // "{source}-{relKey}-{target}"
      source: string
      target: string
      type: 'relationship'
      label: string
      data: {
        key: string
        cardinality: string
      }
    }>
  }
}
```

---

### POST /api/ontology/reload

Forces a full ontology cache refresh. Invalidates the in-memory cache and reloads all five ontology tables from Postgres.

**Auth:** `requireAuth` + `requireRole(10)` (director-level).

**Request body:** None.

**Response:** Same shape as `GET /api/ontology` -- the freshly loaded ontology.

**When to use:** After direct database edits that bypass the builder API, or when the 5-minute cache TTL is too slow.

---

## Builder endpoints (ontologyBuilderRouter)

All builder endpoints require `requireAuth` + `requireRole(DIRECTOR_PRIORITY)` (priority <= 0). These middleware are applied at the router level.

Every mutation:
1. Validates RBAC scope permissions via `validateScopePermission()`
2. Wraps the database write in an audit context (`withAuditContext`)
3. Logs an audit claim (`logAuditClaim`)
4. Emits a domain event via the event bus (`emit`)
5. Reloads the ontology cache (`reloadOntology`)

### Concept CRUD

#### GET /api/builder/concepts

List all active concepts filtered by the caller's RBAC scope. Includes `property_count` and `relationship_count` aggregates.

**Response:** `ApiResponse<ConceptRow[]>` where each row includes the aggregate counts.

**Example response (abridged):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "key": "guest",
      "name": "Guest",
      "plural_name": "Guests",
      "icon": "pi pi-users",
      "owner_scope": "org",
      "property_count": "12",
      "relationship_count": "3"
    }
  ]
}
```

---

#### GET /api/builder/concepts/:key

Returns a single concept with its full `properties` and `relationships` arrays inlined.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Concept key |

**Response:**

```typescript
{
  success: true,
  data: {
    id: string
    key: string
    name: string
    // ...all concept columns
    properties: PropertyRow[]
    relationships: RelationshipRow[]
  }
}
```

**Errors:** `404` if concept not found.

---

#### POST /api/builder/concepts

Create a new concept. Also auto-generates default `FormConfig` and `ViewConfig` for the new concept (non-blocking; failure to generate defaults does not fail concept creation).

**Request body:**

```typescript
{
  key: string              // required, unique concept key
  name: string             // required, display name
  plural_name?: string     // defaults to name
  icon?: string            // PrimeIcons class
  description?: string
  extends?: string         // parent concept key (for inheritance)
  owner_scope?: 'org' | 'department'   // defaults to 'org'
  owner_department?: string | null
}
```

**Response:** `201 Created` with `ApiResponse<ConceptRow>`.

**Errors:**
- `403` if scope permission check fails.

**Domain event emitted:** `concept.created`

---

#### PUT /api/builder/concepts/:key

Update a concept. Creates a new version via the versioning service.

**Request body:** Partial concept fields to update. Include `change_reason` to document why.

```typescript
{
  name?: string
  plural_name?: string
  icon?: string
  description?: string
  change_reason?: string   // defaults to "Updated via builder"
}
```

**Response:** `ApiResponse<ConceptRow>` with the new version.

**Errors:**
- `404` if concept not found.
- `403` if scope permission check fails.
- `409` if versioning conflict.

**Domain event emitted:** `concept.updated`

---

#### DELETE /api/builder/concepts/:key

Deprecates a concept (sets `status = 'deprecated'`, `deprecated_at = now()`). Does NOT physically delete the row.

**Response:** `ApiResponse<{ status: 'deprecated' }>`

**Errors:**
- `404` if concept not found.
- `403` if scope permission check fails.

**Domain event emitted:** `concept.deprecated`

---

### Property CRUD

#### GET /api/builder/concepts/:key/properties

List properties for a concept, filtered by the caller's RBAC scope. Department-namespaced property keys are stripped before responding.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Concept key |

**Response:** `ApiResponse<PropertyRow[]>` with namespace-stripped keys.

---

#### POST /api/builder/concepts/:key/properties

Add a property to a concept.

**Request body:**

```typescript
{
  key: string               // required, property key
  label?: string            // defaults to key
  type?: PropertyType       // defaults to 'text'
  required?: boolean        // defaults to false
  default_value?: unknown
  placeholder?: string
  description?: string
  owner_scope?: 'org' | 'department'
  owner_department?: string | null
  sort_order?: number       // defaults to 0
  hidden?: boolean          // defaults to false
  read_only?: boolean       // defaults to false
  validation_rules?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    pattern?: string
  }
  options?: Array<{ value: string; label: string; color?: string }>
}
```

**Safety guardrails enforced:**

| Guardrail | HTTP status | Condition |
|-----------|-------------|-----------|
| Hidden + required conflict | `400` | `hidden === true && required === true` |
| Department property conflict | `409` | Department-scoped property collides with existing org-scoped property of the same key |

After creation, the endpoint runs `checkGuardrails()` against the concept's full property set and includes any warnings in the response.

**Response (with optional warnings):**

```typescript
{
  success: true,
  data: PropertyRow,
  warnings?: Array<{
    severity: string
    code: string
    message: string
  }>
}
```

**Status:** `201 Created`.

**Domain event emitted:** `property.created`

---

#### PUT /api/builder/properties/:id

Update a property by its UUID. Creates a new version.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string` | Property UUID |

**Request body:** Partial property fields to update. Include `change_reason` to document why.

**Safety guardrail:** Cannot change `type` when the property has data (currently a placeholder check -- see source for details).

**Errors:**
- `404` if property not found.
- `409` if versioning conflict.

**Domain event emitted:** `property.updated`

---

#### DELETE /api/builder/properties/:id

Deprecates a property. Blocked if the property key exists in any domain data table (`guests`, `staff`, `schedule_events`, `prep_items`).

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string` | Property UUID |

**Safety guardrail:** Checks `properties ? $1` across four domain tables. Returns `409` if any non-null values exist.

**Response:** `ApiResponse<{ status: 'deprecated' }>` on success.

**Error response (data exists):**

```json
{
  "success": false,
  "error": "Cannot delete property \"dietary_restrictions\" because it has data. Deprecate it instead."
}
```

**Domain event emitted:** `property.deprecated`

---

### Relationship CRUD

#### GET /api/builder/concepts/:key/relationships

List relationships where the concept is either the source or target.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Concept key |

**Response:** `ApiResponse<RelationshipRow[]>`

---

#### POST /api/builder/concepts/:key/relationships

Create a relationship originating from the given concept.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Source concept key |

**Request body:**

```typescript
{
  key: string                    // required, relationship key
  target_concept_key: string     // required, target concept key
  label?: string                 // defaults to key
  cardinality?: 'has-one' | 'has-many' | 'many-to-many'  // defaults to 'has-many'
  inverse_key?: string
  description?: string
  owner_scope?: 'org' | 'department'
  owner_department?: string | null
}
```

**Response:** `201 Created` with `ApiResponse<RelationshipRow>`.

**Domain event emitted:** `relationship.created`

---

### Default generation

#### POST /api/builder/concepts/:key/generate-defaults

Auto-generates a default `FormConfig` and `ViewConfig` for a concept based on its active properties.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | Concept key |

**Behavior:**

- **FormConfig:** All non-hidden properties in `sort_order`, single-column layout, each field with `colSpan: 1`.
- **ViewConfig:** First 6 non-hidden properties as table columns with type-based widths, sortable and filterable, sorted by `created_at desc`.

**Default column widths by property type:**

| Property type | Width (px) |
|--------------|------------|
| `text` | 200 |
| `rich_text` | 300 |
| `number` | 120 |
| `select` | 150 |
| `multi_select` | 200 |
| `date` | 140 |
| `datetime` | 180 |
| `checkbox` | 80 |
| `url` | 200 |
| `email` | 200 |
| `phone` | 150 |
| `relation` | 200 |
| `formula` | 150 |
| `rollup` | 150 |
| `files` | 120 |
| `people` | 180 |
| `status` | 130 |

Any type not listed defaults to 150px.

**Errors:**
- `404` if concept not found.
- `409` if both default form and default view already exist.

**Response:** `201 Created`

```typescript
{
  success: true,
  data: {
    formConfig: FormConfigRow | null,
    viewConfig: ViewConfigRow | null
  }
}
```

**Domain event emitted:** `concept.defaults_generated`

---

## Safety guardrails summary

The builder API enforces the following guardrails to prevent data loss and schema corruption:

| Rule | Endpoint | HTTP status | Description |
|------|----------|-------------|-------------|
| Cannot delete concept with data | `DELETE /concepts/:key` | 403/409 | Concept is deprecated, not deleted. Scope check prevents unauthorized deprecation. |
| Cannot delete property with data | `DELETE /properties/:id` | 409 | Checks `guests`, `staff`, `schedule_events`, `prep_items` for existing JSONB keys. |
| Cannot change property type with data | `PUT /properties/:id` | (placeholder) | Type change check exists in code but full enforcement is pending. |
| Cannot set hidden + required | `POST /concepts/:key/properties` | 400 | A hidden field cannot be required since operators cannot fill it in. |
| Department property conflict | `POST /concepts/:key/properties` | 409 | Department-scoped property cannot shadow an org-scoped property of the same key. |
| Scope permission | All mutations | 403 | Caller must have appropriate scope (org-wide = admin only, department = director of that department). |
| Defaults already exist | `POST /concepts/:key/generate-defaults` | 409 | Prevents duplicate default configs; edit existing ones instead. |

---

## Domain events emitted

Every builder mutation emits a structured domain event via `emit()`. Events follow this pattern:

```typescript
{
  eventName: string         // e.g. "concept.created"
  domain: "ontology"
  action: string            // "created" | "updated" | "deleted"
  recordId: string
  newValues?: object
  triggeredBy: string       // user email or "system"
  changeSet: string         // audit change set ID
}
```

Full list of events:

| Event name | Trigger |
|-----------|---------|
| `concept.created` | POST /concepts |
| `concept.updated` | PUT /concepts/:key |
| `concept.deprecated` | DELETE /concepts/:key |
| `property.created` | POST /concepts/:key/properties |
| `property.updated` | PUT /properties/:id |
| `property.deprecated` | DELETE /properties/:id |
| `relationship.created` | POST /concepts/:key/relationships |
| `concept.defaults_generated` | POST /concepts/:key/generate-defaults |

---

## Caching behavior

The ontology loader (`functions/src/ontology/loader.ts`) caches all data in memory with `TTL_ONTOLOGY_MS` (5 minutes). Cache keys:

| Data | Cache key pattern |
|------|-------------------|
| Full ontology | `ontology` |
| Form config (default) | `form:{conceptKey}` |
| Form config (named) | `form:{conceptKey}:{name}` |
| View configs (all for concept) | `views:{conceptKey}` |
| View config (named) | `views:{conceptKey}:{name}` |
| All page configs | `pages` |
| Page config (by slug) | `page:{slug}` |

Every builder mutation calls `reloadOntology()`, which invalidates the `ontology` cache key and reloads from Postgres. Config caches (forms, views, pages) are NOT automatically invalidated by builder mutations -- they rely on TTL expiry.

---

## Backend type reference

These types are defined in `functions/src/ontology/types.ts`. The backend uses `camelCase` field names in its TypeScript interfaces but stores `snake_case` columns in Postgres. The loader's parse functions handle the conversion.

### PropertyType (backend)

```typescript
type PropertyType =
  | 'text' | 'rich_text' | 'number' | 'select' | 'multi_select'
  | 'date' | 'datetime' | 'checkbox' | 'url' | 'email'
  | 'phone' | 'relation' | 'formula' | 'rollup' | 'files'
  | 'people' | 'status'
```

### Cardinality

```typescript
type Cardinality = 'has-one' | 'has-many' | 'many-to-many'
```
