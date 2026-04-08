# Ontology Engine

> Self-describing domain model loaded from Postgres at runtime. Five ontology tables (concepts, properties,
> relationships, events, constraints) define what the platform manages. Config tables (forms, views, pages,
> workflows) define how it's presented and automated. Adding a domain = adding rows, not code.

---

## Overview

The ontology engine is the core of the platform. It reads the domain model from Postgres at startup, caches it in memory (target: Redis), and exposes it to every other subsystem — the CRUD API validates against it, the RBAC engine filters fields by it, the form renderer builds UI from it, the workflow engine triggers actions by it.

The ontology is defined by five table families: **Concepts** (what entities exist), **Properties** (what fields they have), **Relationships** (how they connect), **Events** (what domain events they emit), and **Constraints** (conditional rules). On top of these, four config table families define presentation and automation: **FormConfigs**, **ViewConfigs**, **PageConfigs**, **WorkflowConfigs**.

The engine is implemented in `functions/src/ontology/types.ts` (type system) and `functions/src/ontology/loader.ts` (loading, caching, public API). The loader currently reads from an external data store; this is replaced with Postgres queries. The type system and public API remain unchanged.

---

## Full Specification

### 1. Ontology Data Model

**Purpose:** Define the five core ontology structures.

**Dependencies:** `data/postgres-schema.md` (table definitions)

#### 1.1 Concept

Defined in `types.ts:40-52`. A concept represents a domain entity type.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `key` | string | Unique identifier, e.g., "guest", "staff", "schedule" |
| `name` | string | Display name, e.g., "Guest" |
| `pluralName` | string | Plural display name, e.g., "Guests" |
| `extends` | string? | Parent concept key for inheritance |
| `icon` | string? | PrimeIcons name for UI |
| `description` | string? | Human-readable description |
| `isRegistry` | boolean | Year-over-year persistent data |
| `isConfig` | boolean | Platform config, not domain data |

**Inheritance:** A concept with `extends: "guest"` inherits all properties and constraints from the parent. The loader resolves inheritance chains at load time.

#### 1.2 Property

Defined in `types.ts:56-79`. A property is a field definition on a concept.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `conceptKey` | string | Which concept this belongs to |
| `key` | string | Field key, e.g., "name", "status" |
| `label` | string | Display label |
| `type` | PropertyType | One of 17 types (see below) |
| `required` | boolean | Is this field required? |
| `defaultValue` | any? | Default value for new records |
| `placeholder` | string? | Input placeholder text |
| `description` | string? | Help text |
| `options` | SelectOption[]? | For select/multi_select types |
| `minLength` / `maxLength` | number? | String length validation |
| `min` / `max` | number? | Numeric range validation |
| `pattern` | string? | Regex validation |
| `sortOrder` | number | Display order (lower = first) |
| `hidden` | boolean | Hidden from default views |
| `readOnly` | boolean | Computed/formula fields |

**17 Property Types:** `text`, `rich_text`, `number`, `select`, `multi_select`, `date`, `datetime`, `checkbox`, `url`, `email`, `phone`, `relation`, `formula`, `rollup`, `files`, `people`, `status`

Each type maps to a Postgres column type (for core fields) or a JSONB value pattern (for dynamic fields), and to a FormKit input type for rendering.

#### 1.3 Relationship

Defined in `types.ts:87-99`. Connects two concepts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `sourceConceptKey` | string | Source concept |
| `targetConceptKey` | string | Target concept |
| `key` | string | Relationship key, e.g., "pairings" |
| `label` | string | Display label |
| `cardinality` | `has-one` \| `has-many` \| `many-to-many` | Relationship type |
| `inverseKey` | string? | Key on the target side |
| `description` | string? | |

**Cardinality mapping to Postgres:**
- `has-one`: FK column on source table
- `has-many`: FK column on target table
- `many-to-many`: Junction table

#### 1.4 DomainEventDef

Defined in `types.ts:103-112`. Declares what events a concept can emit.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `conceptKey` | string | Which concept |
| `eventKey` | string | Event name, e.g., "created", "status_changed" |
| `fullEventName` | string | Full pattern, e.g., "guest.created" |
| `triggerType` | TriggerType | When it fires |
| `changedFields` | string[]? | For `on_field_change`: which fields |
| `schedule` | string? | Cron expression for `scheduled` |

**6 Trigger Types:** `on_create`, `on_update`, `on_delete`, `on_field_change`, `scheduled`, `manual`

#### 1.5 Constraint

Defined in `types.ts:116-126`. Conditional rules applied to concepts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `conceptKey` | string | Which concept |
| `name` | string | E.g., "JP Guest" |
| `extends` | string? | Parent concept for inheritance |
| `condition` | ConditionExpression | When this constraint applies |
| `defaults` | Record<string, any>? | Default values to apply |
| `requiredFields` | string[]? | Additional required fields |
| `description` | string? | |

**Example:** A "JP Guest" constraint with condition `{type: 'field', field: 'type', operator: 'eq', value: 'JP'}` sets `interpreterRequired: true` as a default and adds `interpreterRequired` to required fields.

**Acceptance Criteria:**
- [ ] All five ontology types loadable from Postgres
- [ ] Type system matches `types.ts` interfaces exactly
- [ ] Inheritance resolution works for concepts with `extends`

---

### 2. Ontology Loading

**Purpose:** Define how the ontology is loaded from Postgres and cached.

**Dependencies:** `data/postgres-schema.md`

**Detail:**

The loader (`functions/src/ontology/loader.ts`) exposes:

```typescript
// Load full ontology (cached)
getOntology(): Promise<OntologyCache>

// Force reload
reloadOntology(): Promise<OntologyCache>

// Single concept lookup
getConceptByKey(key: string): Promise<Concept | undefined>

// Properties for a concept
getPropertiesForConcept(conceptKey: string): Promise<ReadonlyArray<Property>>

// Relationships for a concept
getRelationshipsForConcept(conceptKey: string): Promise<ReadonlyArray<Relationship>>

// Events for a concept
getEventsForConcept(conceptKey: string): Promise<ReadonlyArray<DomainEventDef>>

// Constraints for a concept
getConstraintsForConcept(conceptKey: string): Promise<ReadonlyArray<Constraint>>

// Config loaders
getFormConfig(conceptKey: string): Promise<FormConfig | undefined>
getViewConfigs(conceptKey: string): Promise<ReadonlyArray<ViewConfig>>
getPageConfigs(): Promise<ReadonlyArray<PageConfig>>
```

**Loading process (`loadOntology()`):**
1. Query 5 ontology tables in parallel (concepts, properties, relationships, events, constraints)
2. Parse each row through typed parsers (`parseConcept`, `parseProperty`, etc.)
3. Build `OntologyCache` — a set of Maps keyed by concept key
4. Resolve inheritance chains (properties and constraints inherited from parent concepts)
5. Cache result with TTL

**OntologyCache structure** (from `types.ts:159-166`):
```typescript
interface OntologyCache {
  concepts: ReadonlyMap<string, Concept>
  properties: ReadonlyMap<string, ReadonlyArray<Property>>      // conceptKey → props
  relationships: ReadonlyMap<string, ReadonlyArray<Relationship>>
  events: ReadonlyMap<string, ReadonlyArray<DomainEventDef>>
  constraints: ReadonlyMap<string, ReadonlyArray<Constraint>>
  loadedAt: number
}
```

**Acceptance Criteria:**
- [ ] Ontology loads from Postgres in <100ms for 50 concepts
- [ ] Parallel loading of 5 tables verified
- [ ] Parser errors for malformed rows logged but don't crash the load

---

### 3. Caching Strategy

**Purpose:** Define cache behavior for ontology data.

**Detail:**

| Aspect | Current | Target |
|--------|---------|--------|
| Backend | In-memory Map | Redis |
| TTL | 5 minutes (`TTL_ONTOLOGY_MS`) | 5 minutes (same) |
| Invalidation | `reloadOntology()` clears cache | `reloadOntology()` clears Redis key + publishes invalidation to all instances |
| Scope | Per-instance (diverges under multiple instances) | Shared across all Cloud Run instances |
| Warmup | First request triggers load | Startup hook pre-loads ontology |

**Cache key structure:**
- `ontology:cache` — full OntologyCache
- `form:{conceptKey}` — FormConfig per concept
- `views:{conceptKey}` — ViewConfig[] per concept
- `pages` — all PageConfigs

**Invalidation triggers:**
- Ontology web builder saves a change → calls `reloadOntology()`
- `reloadOntology()` clears Redis keys and publishes `ontology.invalidated` event
- All Cloud Run instances subscribe and clear their local in-memory cache

**Acceptance Criteria:**
- [ ] Cache hit returns in <1ms
- [ ] Cache miss loads from Postgres in <100ms
- [ ] Invalidation propagates to all instances within 5 seconds
- [ ] No stale ontology served after a web builder change

---

### 4. Config Subsystems

**Purpose:** Define the four config types that drive UI and automation.

**Detail:**

#### 4.1 FormConfig (`types.ts:170-192`)

Drives dynamic form rendering.

| Field | Type | Description |
|-------|------|-------------|
| `conceptKey` | string | Which concept |
| `name` | string | Form name |
| `fields` | FormFieldConfig[] | Field list with overrides |
| `layout` | `single` \| `two-column` \| `wizard` | Form layout style |
| `steps` | FormStep[]? | For wizard layout: step definitions |

**FormFieldConfig** includes: `propertyKey`, `groupName`, `colSpan`, `showIf` (ConditionExpression for conditional visibility), `autocompleteSource` (concept key for relation autocomplete), `overrideLabel`, `overridePlaceholder`.

#### 4.2 ViewConfig (`types.ts:195-232`)

Drives dynamic view rendering.

| Field | Type | Description |
|-------|------|-------------|
| `conceptKey` | string | Which concept |
| `name` | string | View name |
| `viewType` | `table` \| `kanban` \| `timeline` \| `detail` \| `dashboard` | View type |
| `columns` | ViewColumn[]? | Column definitions |
| `filters` | ViewFilter[]? | Default filters |
| `sort` | ViewSort? | Default sort |
| `groupBy` | string? | For kanban: property key to group by |
| `timelineStart` / `timelineEnd` | string? | For timeline: date property keys |
| `rowAction` | `navigate_to_detail` \| `inline_edit` \| `none` | Row click behavior |
| `presets` | ViewPreset[]? | Named filter presets |

#### 4.3 PageConfig (`types.ts:234-261`)

Drives dashboard page composition.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Page name |
| `slug` | string | URL path |
| `widgets` | WidgetConfig[] | Widget definitions |
| `breakpoints` | { desktop, tablet?, mobile? } | Responsive grid layouts |

**Widget types:** `stat_card`, `data_table`, `chart`, `timeline_preview`, `prep_progress`, `action_banner`, `quick_add`, `activity_feed`

#### 4.4 WorkflowConfig (`types.ts:265-306`)

Drives workflow automation. (Detailed in `automation/workflow-engine.md`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Workflow name |
| `trigger` | WorkflowTrigger | What fires it |
| `condition` | ConditionExpression? | When it applies |
| `actions` | WorkflowAction[] | What it does |
| `enabled` | boolean | Active flag |

**Acceptance Criteria:**
- [ ] Each config type loadable from Postgres with caching
- [ ] Missing config returns sensible defaults (empty form, basic table view)
- [ ] Config changes via web builder take effect within cache TTL

---

### 5. Concept Inheritance

**Purpose:** Define how `extends` works for concept inheritance.

**Detail:**

When concept B extends concept A:
1. B inherits all of A's properties (B can override by defining a property with the same key)
2. B inherits all of A's constraints (B's constraints are evaluated in addition to A's)
3. B does NOT inherit A's relationships (relationships are directional and concept-specific)
4. B does NOT inherit A's events (events are concept-specific)

**Resolution at load time:**
```
loadOntology() → for each concept with extends:
  1. Find parent concept
  2. Merge parent properties (parent first, child overrides)
  3. Concatenate parent constraints + child constraints
  4. Store merged result in OntologyCache
```

**Circular inheritance** is detected at load time and logged as an error. The child concept is loaded without inheritance in this case.

**Use case:** A "VIP Guest" concept extending "Guest" inherits all guest properties but adds `greenRoomRequired: boolean` and a constraint that sets `specialHandling: "VIP"` by default.

**Acceptance Criteria:**
- [ ] Child concept has parent's properties + its own
- [ ] Child property with same key as parent overrides parent's
- [ ] Circular inheritance detected and handled gracefully
- [ ] Inheritance chain depth of 3+ works correctly

**Test Plan:**
- Unit: create parent + child concepts in test data, verify merged properties
- Unit: override a parent property in child, verify child's version wins
- Unit: circular extends detected and logged
- Integration: API returns merged properties for inherited concept

---

### 6. Ontology-to-Schema Bridge

**Purpose:** Define how ontology concepts map to Postgres tables.

**Detail:**

Each concept maps to a Postgres table. The table has:
- **Typed core columns** for frequently queried fields (id, name, status, department, etc.)
- **JSONB `properties` column** for ontology-defined dynamic fields
- **Standard metadata columns** (created_at, updated_at, created_by, archived)

The bridge determines which property goes where:
- Properties marked in the ontology with `isCore: true` (or matching a predefined list) → typed column
- All other properties → stored in `properties` JSONB

**Query translation:**
```sql
-- Ontology property "status" (typed column):
SELECT * FROM guests WHERE status = 'Confirmed'

-- Ontology property "specialHandling" (JSONB):
SELECT * FROM guests WHERE properties->>'specialHandling' LIKE '%VIP%'

-- Combined:
SELECT * FROM guests 
WHERE status = 'Confirmed' 
  AND properties->>'interpreterRequired' = 'true'
```

**Acceptance Criteria:**
- [ ] Ontology properties correctly route to typed columns vs JSONB
- [ ] CRUD API transparently handles both storage types
- [ ] GIN index on JSONB enables performant dynamic field queries

---

### 7. Current Implementation Status

**Purpose:** Inventory what exists.

| Component | Status | File |
|-----------|--------|------|
| Full type system (all interfaces) | **Built** | `functions/src/ontology/types.ts` |
| Ontology loader + caching | **Built** | `functions/src/ontology/loader.ts` |
| All parsers (concept, property, relationship, event, constraint) | **Built** | `loader.ts:322-579` |
| Config loaders (forms, views, pages) | **Built** | `loader.ts:230-318` |
| Public API (getOntology, getConceptByKey, etc.) | **Built** | `loader.ts:165-225` |
| Frontend ontology store | **Built** | `web/src/stores/ontology.ts` |
| Seeding scripts | **Built** | `setup/src/seed-ontology.ts` |
| Postgres query layer | **Planned** | Replace current data access |
| Redis caching | **Planned** | Replace in-memory cache |
| Inheritance resolution | **Planned** | Add to loader |
| Ontology web builder | **Planned** | See `core/ontology-web-builder.md` |

---

### 8. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Parser unit tests | Unit | Each parser (parseConcept, parseProperty, etc.) handles valid input, missing fields, malformed data | All parsers return typed objects or null with warning |
| Loading integration | Integration | loadOntology() fetches from Postgres, builds cache | Cache contains correct concept/property/relationship counts |
| Cache hit/miss | Unit | getOntology() returns cached on hit, loads on miss | <1ms hit, <100ms miss |
| Cache invalidation | Integration | reloadOntology() clears cache, next call reloads | Fresh data after invalidation |
| Inheritance resolution | Unit | Child concept merges parent properties and constraints | Merged result matches expected |
| Circular inheritance | Unit | Concept A extends B extends A | Detected, logged, gracefully handled |
| Config loading | Integration | getFormConfig(), getViewConfigs(), getPageConfigs() | Correct configs returned per concept |
| Ontology-to-schema bridge | Integration | Property routes to typed column vs JSONB correctly | CRUD works for both storage types |

**Coverage target:** ≥80% on `ontology/loader.ts` and all parser functions.
