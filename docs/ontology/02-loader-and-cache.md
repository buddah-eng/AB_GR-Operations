# Ontology Loader and Cache

This document describes the runtime pipeline that reads the five ontology tables
from Postgres, parses them into typed TypeScript objects, resolves concept
inheritance, and serves the result from an in-memory cache with
stale-while-revalidate semantics.

Source files covered:

- `functions/src/ontology/loader.ts` -- loading, parsing, inheritance, public API
- `functions/src/cache.ts` -- generic `MemoryCache` class and TTL constants
- `functions/src/ontology/types.ts` -- all ontology type definitions
- `functions/src/db/client.ts` -- Postgres query helper

---

## 1. Pipeline Overview

The full loading pipeline has five sequential stages:

```
Postgres (5 tables, parallel)
  -> Parse rows into typed objects
    -> Build Maps (conceptKey -> T[])
      -> Resolve inheritance (depth-first)
        -> Freeze and return OntologyCache
```

A single call to `loadOntology()` executes the entire pipeline and returns a
frozen `OntologyCache`. The public accessor `getOntology()` wraps this behind
the cache so the pipeline only runs on a cold start or after the TTL expires.

---

## 2. Stage 1: Parallel Query

```typescript
async function loadOntology(): Promise<OntologyCache>
```

Five SQL queries execute in parallel via `Promise.all`:

| Table                    | Query filter             | Ordering          |
|--------------------------|--------------------------|--------------------|
| `ontology_concepts`      | `status = 'active'`      | --                 |
| `ontology_properties`    | `status = 'active'`      | `ORDER BY sort_order` |
| `ontology_relationships` | `status = 'active'`      | --                 |
| `ontology_events`        | `status = 'active'`      | --                 |
| `ontology_constraints`   | `status = 'active'`      | --                 |

All five queries use `SELECT *`. Only rows with `status = 'active'` are loaded.
Properties are ordered by `sort_order` so downstream consumers (form renderers,
table columns) receive them in the intended sequence.

The `query()` function from `db/client.ts` logs a warning for any query that
takes longer than 200ms.

---

## 3. Stage 2: Parsing

Each row returned by Postgres is an untyped `Record<string, unknown>`. A
dedicated parser function converts it to the corresponding ontology type,
performing validation and column-name mapping (snake_case to camelCase).

Every parser follows the same contract:

1. Validate required fields (return `null` with a warning log on failure).
2. Map Postgres column names to TypeScript property names.
3. Apply defaults for optional fields (e.g., `label` defaults to `key`).
4. Return the typed, readonly object.

### 3.1 `parseConcept`

```typescript
function parseConcept(row: Record<string, unknown>): Concept | null
```

Required fields: `key`, `name`. Returns `null` if either is missing.

Column mapping:

| Postgres column | TypeScript field | Default           |
|-----------------|------------------|-------------------|
| `id`            | `id`             | --                |
| `key`           | `key`            | -- (required)     |
| `name`          | `name`           | -- (required)     |
| `plural_name`   | `pluralName`     | `"${name}s"`     |
| `extends`       | `extends`        | `undefined`       |
| `icon`          | `icon`           | `undefined`       |
| `description`   | `description`    | `undefined`       |
| `is_registry`   | `isRegistry`     | `false`           |
| `is_config`     | `isConfig`       | `false`           |

### 3.2 `parseProperty`

```typescript
function parseProperty(row: Record<string, unknown>): Property | null
```

Required fields: `concept_key`, `key`. Returns `null` if either is missing.

Column mapping:

| Postgres column    | TypeScript field   | Default         |
|--------------------|--------------------|-----------------|
| `id`               | `id`               | --              |
| `concept_key`      | `conceptKey`       | -- (required)   |
| `key`              | `key`              | -- (required)   |
| `label`            | `label`            | `key`           |
| `type`             | `type`             | `"text"`        |
| `required`         | `required`         | `false`         |
| `default_value`    | `defaultValue`     | `undefined`     |
| `placeholder`      | `placeholder`      | `undefined`     |
| `description`      | `description`      | `undefined`     |
| `postgres_column`  | `postgresColumn`   | `undefined`     |
| `options`          | `options`          | `undefined`     |
| `validation_rules` | `validationRules`  | `undefined`     |
| `sort_order`       | `sortOrder`        | `0`             |
| `hidden`           | `hidden`           | `false`         |
| `read_only`        | `readOnly`         | `false`         |

The `options` column is processed through `parseSelectOptions`, which normalizes
both string arrays (e.g., `["draft", "active"]`) and object arrays (e.g.,
`[{value: "draft", label: "Draft"}]`) into `SelectOption[]`.

### 3.3 `parseRelationship`

```typescript
function parseRelationship(row: Record<string, unknown>): Relationship | null
```

Required fields: `source_concept_key`, `target_concept_key`, `key`. Returns
`null` if any is missing.

Column mapping:

| Postgres column       | TypeScript field    | Default       |
|-----------------------|---------------------|---------------|
| `id`                  | `id`                | --            |
| `source_concept_key`  | `sourceConceptKey`  | -- (required) |
| `target_concept_key`  | `targetConceptKey`  | -- (required) |
| `key`                 | `key`               | -- (required) |
| `label`               | `label`             | `key`         |
| `cardinality`         | `cardinality`       | `"has-many"`  |
| `inverse_key`         | `inverseKey`        | `undefined`   |
| `description`         | `description`       | `undefined`   |

### 3.4 `parseDomainEventDef`

```typescript
function parseDomainEventDef(row: Record<string, unknown>): DomainEventDef | null
```

Required fields: `concept_key`, `event_key`. Returns `null` if either is missing.

Column mapping:

| Postgres column    | TypeScript field  | Default                            |
|--------------------|-------------------|------------------------------------|
| `id`               | `id`              | --                                 |
| `concept_key`      | `conceptKey`      | -- (required)                      |
| `event_key`        | `eventKey`        | -- (required)                      |
| `full_event_name`  | `fullEventName`   | `"${conceptKey}.${eventKey}"`      |
| `trigger_type`     | `triggerType`     | `"on_create"`                      |
| `description`      | `description`     | `undefined`                        |
| `changed_fields`   | `changedFields`   | `undefined`                        |
| `schedule`         | `schedule`        | `undefined`                        |

### 3.5 `parseConstraint`

```typescript
function parseConstraint(row: Record<string, unknown>): Constraint | null
```

Required fields: `concept_key`, `name`. Returns `null` if either is missing.

Column mapping:

| Postgres column    | TypeScript field  | Default        |
|--------------------|-------------------|----------------|
| `id`               | `id`              | --             |
| `concept_key`      | `conceptKey`      | -- (required)  |
| `name`             | `name`            | -- (required)  |
| `extends`          | `extends`         | `undefined`    |
| `condition`        | `condition`       | (see below)    |
| `defaults`         | `defaults`        | `undefined`    |
| `required_fields`  | `requiredFields`  | `undefined`    |
| `description`      | `description`     | `undefined`    |

The `condition` column is processed through `parseConditionExpression`, which
handles three cases:

1. **Object** -- cast directly to `ConditionExpression`.
2. **JSON string** -- parsed with `JSON.parse`. On parse failure, falls back to
   a `FieldCondition` treating the string as a field name with operator
   `is_not_empty`.
3. **Falsy / missing** -- defaults to `{ type: "field", field: "_id", operator: "is_not_empty" }`.

### 3.6 Config parsers

Three additional parsers handle UI configuration tables. These do not return
`null` on missing fields; they apply defaults for every field.

```typescript
function parseFormConfig(row: Record<string, unknown>): FormConfig
function parseViewConfig(row: Record<string, unknown>): ViewConfig
function parsePageConfig(row: Record<string, unknown>): PageConfig
```

`parseFormConfig` produces a `FormConfig` with `conceptKey` read from the
`concept_key` column, `name` defaulting to `"default"`, `layout` defaulting
to `"single"`, and `fields`/`steps` coming directly from the JSONB column.
`fields` defaults to `[]` when absent.

`parseViewConfig` produces a `ViewConfig` with `name` defaulting to
`"default"`, `viewType` defaulting to `"table"`, and all list fields
(`columns`, `filters`, `presets`, `tabs`) read directly from JSONB columns.
Additional fields parsed from the row: `sort` (a `ViewSort` object),
`groupBy` (from `group_by` column), `timelineStart` (from `timeline_start`),
`timelineEnd` (from `timeline_end`), and `rowAction` (from `row_action`,
typed as `'navigate_to_detail' | 'inline_edit' | 'none'`). All default to
`undefined` when absent.

`parsePageConfig` produces a `PageConfig` with `name` defaulting to
`"Unnamed Page"`, `slug` defaulting to `"/unknown"`, `widgets` (a
`WidgetConfig[]`) defaulting to `[]`, and `breakpoints` (an object with
`desktop`, optional `tablet`, and optional `mobile` layout arrays) defaulting
to `undefined`.

### 3.7 Error handling strategy

All five ontology parsers return `null` when required fields are missing and log
a warning with the row's `id` for tracing. The loader silently skips `null`
results, so a single malformed row does not prevent the rest of the ontology
from loading. The config parsers (`parseFormConfig`, `parseViewConfig`,
`parsePageConfig`) never return `null`; they apply defaults to every field.

---

## 4. Stage 3: Build Maps

After parsing, the loader assembles five `Map` structures keyed by concept key:

| Map variable             | Key type | Value type         | Lookup semantics                       |
|--------------------------|----------|--------------------|----------------------------------------|
| `concepts`               | `string` | `Concept`          | Single concept per key                 |
| `propsByConceptKey`      | `string` | `Property[]`       | All properties for a concept           |
| `relsByConceptKey`       | `string` | `Relationship[]`   | All outgoing relationships for a concept |
| `eventsByConceptKey`     | `string` | `DomainEventDef[]` | All event definitions for a concept    |
| `constraintsByConceptKey`| `string` | `Constraint[]`     | All constraints for a concept          |

Properties, relationships, events, and constraints are accumulated using
immutable array spread:

```typescript
const existing = propsByConceptKey.get(prop.conceptKey) ?? [];
propsByConceptKey.set(prop.conceptKey, [...existing, prop]);
```

The concept map is keyed by `concept.key` (not `concept.id`), which is the
stable string identifier used throughout the system (e.g., `"event"`,
`"staff_assignment"`).

---

## 5. Stage 4: Inheritance Resolution

```typescript
function resolveInheritance(
  concepts: ReadonlyMap<string, Concept>,
  propsByConceptKey: Map<string, Property[]>,
  constraintsByConceptKey: Map<string, Constraint[]>
): void
```

Any concept with an `extends` field inherits from its parent concept. The
algorithm resolves the full inheritance tree at load time so downstream consumers
never need to walk the chain themselves.

### 5.1 Algorithm

The algorithm uses depth-first traversal with circular-reference detection:

1. Maintain two sets: `visited` (fully resolved) and `resolving` (currently in
   the recursion stack).
2. For each concept key in the concept map, call `resolve(conceptKey)`.
3. Inside `resolve`:
   - If `visited` contains this key, return immediately (already resolved).
   - If `resolving` contains this key, log an error for circular inheritance,
     mark as visited, and return (breaks the cycle).
   - If the concept has no `extends` field, mark as visited and return (base concept).
   - Add to `resolving`, then recursively `resolve(concept.extends)` first.
   - Merge parent properties into child properties.
   - Concatenate parent constraints before child constraints.
   - Remove from `resolving`, add to `visited`.

### 5.2 Property merge rules

Properties are merged with child-overrides-parent semantics:

1. Collect child property keys into a `Set`.
2. Take all parent properties whose key is **not** in the child set.
3. Append all child properties after the filtered parent properties.
4. Sort the merged array by `sortOrder`.

This means: if parent defines property `"name"` and child also defines
`"name"`, the child's version wins. All other parent properties are inherited.

### 5.3 Constraint merge rules

Constraints use simple concatenation: parent constraints appear first, followed
by child constraints. Both sets apply; child constraints do not override parent
constraints.

### 5.4 Relationships and events

Relationships and events are **not** inherited. Each concept only has the
relationships and events explicitly defined for it.

### 5.5 Circular inheritance

If concept A extends B and B extends A (directly or transitively), the algorithm
detects the cycle via the `resolving` set, logs an error, and breaks the loop.
The concept involved in the cycle retains only its own directly defined
properties and constraints.

---

## 6. Stage 5: Freeze

After inheritance resolution, the mutable `Map<string, Property[]>` maps are
copied into `Map<string, ReadonlyArray<Property>>` maps. This enforces
immutability at the type level. The resulting `OntologyCache` object carries a
`loadedAt` timestamp (epoch milliseconds) and is stored in the memory cache.

```typescript
interface OntologyCache {
  readonly concepts: ReadonlyMap<string, Concept>
  readonly properties: ReadonlyMap<string, ReadonlyArray<Property>>
  readonly relationships: ReadonlyMap<string, ReadonlyArray<Relationship>>
  readonly events: ReadonlyMap<string, ReadonlyArray<DomainEventDef>>
  readonly constraints: ReadonlyMap<string, ReadonlyArray<Constraint>>
  readonly loadedAt: number
}
```

---

## 7. Caching Strategy

### 7.1 MemoryCache class

`functions/src/cache.ts` exports a singleton `MemoryCache` instance (`cache`)
used by the loader and all config loaders.

```typescript
class MemoryCache {
  get<T>(key: string): T | undefined
  getEntry<T>(key: string): CacheEntry<T> | undefined
  set<T>(key: string, data: T, ttlMs: number): void
  isStale(key: string): boolean
  isRefreshing(key: string): boolean
  getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T>
  invalidate(key: string): void
  clear(): void
  size(): number
}
```

Each entry stores the data, its `loadedAt` timestamp, and its `ttlMs`.

### 7.2 Stale-while-revalidate

`getOrLoad` implements stale-while-revalidate:

1. **Cold miss** -- no entry exists. Call `loader()`, store the result, return it.
   The first caller pays the full latency cost.
2. **Fresh hit** -- entry exists and `Date.now() - loadedAt <= ttlMs`. Return
   the cached data immediately.
3. **Stale hit** -- entry exists but TTL has expired. Return the stale data
   immediately, then kick off `refreshInBackground` in a fire-and-forget
   promise. The next caller after the refresh completes gets fresh data.

Only one background refresh runs per key at a time. The `pendingRefreshes` set
prevents duplicate concurrent refreshes. If the background refresh fails, the
stale data remains in the cache and the next stale hit will attempt another
refresh.

### 7.3 TTL constants

```typescript
export const TTL_ONTOLOGY_MS = 5 * 60 * 1000;  // 5 minutes
export const TTL_DOMAIN_MS   = 1 * 60 * 1000;  // 1 minute
```

All ontology and config loaders use `TTL_ONTOLOGY_MS`.

### 7.4 Cache keys

| Key pattern                        | What it caches               | Loader function            |
|------------------------------------|------------------------------|----------------------------|
| `"ontology"`                       | Full `OntologyCache`         | `loadOntology()`           |
| `"form:<conceptKey>"`              | `FormConfig` (default form)  | `getFormConfig()`          |
| `"form:<conceptKey>:<name>"`       | `FormConfig` (named form)    | `getFormConfigByName()`    |
| `"views:<conceptKey>"`             | `ViewConfig[]` (all views)   | `getViewConfigs()`         |
| `"views:<conceptKey>:<name>"`      | `ViewConfig` (named view)    | `getViewConfigByName()`    |
| `"pages"`                          | `PageConfig[]` (all pages)   | `getPageConfigs()`         |
| `"page:<slug>"`                    | `PageConfig` (by slug)       | `getPageConfigBySlug()`    |

### 7.5 Invalidation

`reloadOntology()` explicitly invalidates the `"ontology"` cache key, re-runs
the full loading pipeline, and stores the fresh result. This is the only
function that forces an immediate reload. There is no automatic invalidation of
form/view/page caches when the ontology changes; they expire naturally via TTL.

### 7.6 Redis caching

Redis caching is planned but not yet implemented. The current implementation
uses only the in-memory `MemoryCache`. In a multi-instance deployment (e.g.,
multiple Cloud Run revisions), each instance maintains its own cache and may
serve slightly different ontology snapshots during the TTL window.

---

## 8. Public API Reference

All functions are `async` and return `Promise`. On first call they trigger the
loading pipeline; subsequent calls within the TTL window return cached data.

### 8.1 Ontology accessors

```typescript
// Executes the full 5-stage loading pipeline and returns a fresh OntologyCache.
// Called internally by getOntology() on a cache miss. Also exported for direct
// use when a guaranteed-fresh load is needed (e.g., during tests or seeding).
export async function loadOntology(): Promise<OntologyCache>

// Returns the full OntologyCache, loading from Postgres if needed.
export async function getOntology(): Promise<OntologyCache>

// Invalidates the cache and reloads from Postgres immediately.
export async function reloadOntology(): Promise<OntologyCache>

// Returns a single concept by its string key, or undefined.
export async function getConceptByKey(key: string): Promise<Concept | undefined>

// Returns all properties for a concept (inheritance already resolved).
export async function getPropertiesForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Property>>

// Returns all outgoing relationships for a concept.
export async function getRelationshipsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Relationship>>

// Returns all domain event definitions for a concept.
export async function getEventsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<DomainEventDef>>

// Returns all constraints for a concept (inheritance already resolved).
export async function getConstraintsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Constraint>>
```

### 8.2 Form config accessors

```typescript
// Returns the default (first active) form config for a concept.
export async function getFormConfig(
  conceptKey: string
): Promise<FormConfig | undefined>

// Returns a named form config for a concept.
export async function getFormConfigByName(
  conceptKey: string,
  name: string
): Promise<FormConfig | undefined>
```

Both query the `form_configs` table with `status = 'active'` and `LIMIT 1`.
Results are cached under `form:<conceptKey>` or `form:<conceptKey>:<name>`.

### 8.3 View config accessors

```typescript
// Returns all active view configs for a concept.
export async function getViewConfigs(
  conceptKey: string
): Promise<ReadonlyArray<ViewConfig>>

// Returns a single named view config for a concept.
export async function getViewConfigByName(
  conceptKey: string,
  name: string
): Promise<ViewConfig | undefined>
```

Both query the `view_configs` table with `status = 'active'`. Results are cached
under `views:<conceptKey>` or `views:<conceptKey>:<name>`.

### 8.4 Page config accessors

```typescript
// Returns all active page configs.
export async function getPageConfigs(): Promise<ReadonlyArray<PageConfig>>

// Returns a single page config by slug.
export async function getPageConfigBySlug(
  slug: string
): Promise<PageConfig | undefined>
```

Both query the `page_configs` table with `status = 'active'`. Results are cached
under `pages` or `page:<slug>`.

---

## 9. Utility Parsers

### 9.1 `parseSelectOptions`

```typescript
function parseSelectOptions(val: unknown): ReadonlyArray<SelectOption> | undefined
```

Normalizes the `options` column on a property row:

- If `val` is falsy, returns `undefined`.
- If `val` is an array of strings, maps each string `s` to `{ value: s, label: s }`.
- If `val` is an array of objects, casts each to `SelectOption` (expects
  `value`, `label`, optional `color`).
- Otherwise returns `undefined`.

### 9.2 `parseConditionExpression`

```typescript
function parseConditionExpression(val: unknown): ConditionExpression
```

Normalizes the `condition` column on a constraint row. Always returns a valid
`ConditionExpression` (never `null` or `undefined`):

- **Object** -- returned as-is (cast to `ConditionExpression`).
- **Non-empty string** -- attempted `JSON.parse`. On success, the parsed object
  is returned. On parse failure, treated as a field name and wrapped in
  `{ type: "field", field: val, operator: "is_not_empty" }`.
- **Falsy / empty / other** -- returns a default sentinel:
  `{ type: "field", field: "_id", operator: "is_not_empty" }`.

---

## 10. Performance Characteristics

- **Cold load** -- five parallel SQL queries plus in-memory parsing. Typical
  cold load is logged with elapsed milliseconds. Expected range: 50-200ms
  depending on database latency and row count.
- **Warm read** -- single `Map.get` call behind `cache.getOrLoad`. Sub-millisecond.
- **Stale refresh** -- happens in the background; the requesting call returns
  stale data immediately and does not block.
- **Memory footprint** -- the entire ontology lives in a single `OntologyCache`
  object. For a typical deployment with tens of concepts and hundreds of
  properties, this is well under 1 MB.
