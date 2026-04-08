# Domain CRUD API

> **One router, every concept.** Five RESTful endpoints on `/api/domains/:concept`
> handle create, list, get, update, and archive for any concept defined in the
> ontology. Postgres is the system of record. Every route validates the concept,
> enforces RBAC at row and field level, and emits domain events on writes. The
> router is concept-agnostic -- add a concept to the ontology and the API exists
> immediately. Everything ships.

---

## Overview

`domainRouter` (exported from `functions/src/api/domains.ts`) is an Express
router mounted at `/api/domains`. It exposes five endpoints parameterized by
`:concept` and, where applicable, `:id`. Authentication is enforced globally via
`requireAuth` middleware applied to the router.

The processing pattern is identical across endpoints:

1. **validateConcept** -- confirm the concept exists in the ontology or 404.
2. **RBAC gate** -- `canPerformAction()` checks the caller's role against the
   requested action (`view`, `create`, `edit`, `delete`) or 403.
3. **Scope / filter** -- data-scope filters restrict visible rows;
   field-level filters restrict visible or writable properties.
4. **Execute** -- query or mutate the database.
5. **Event** -- write operations fire a `DomainEvent` via `emit()`.
6. **Respond** -- return `ApiResponse<T>` JSON.

No endpoint contains concept-specific logic. Behavior differences come entirely
from the ontology definition and the RBAC configuration for each concept/role
pair.

---

## 1. Route Definitions

### 1.1 Purpose

Define the five concept-agnostic endpoints that cover the full CRUD lifecycle
plus soft delete.

### 1.2 Endpoints

| Method   | Path                         | Action  | Handler line | Description                |
|----------|------------------------------|---------|--------------|----------------------------|
| `POST`   | `/api/domains/:concept`      | create  | L156         | Create a new record        |
| `GET`    | `/api/domains/:concept`      | list    | L44          | List with pagination/filter/sort |
| `GET`    | `/api/domains/:concept/:id`  | get     | L121         | Fetch a single record      |
| `PUT`    | `/api/domains/:concept/:id`  | update  | L212         | Update changed fields only |
| `DELETE` | `/api/domains/:concept/:id`  | archive | L293         | Soft-delete (archive) a record |

All routes are registered on `domainRouter` (`Router()`), which applies
`requireAuth` middleware at the router level (L40).

### 1.3 Acceptance Criteria

- Each endpoint resolves `:concept` dynamically against the ontology.
- No endpoint contains hardcoded concept names.
- `requireAuth` runs before every handler.

---

## 2. Request Processing Flow

### 2.1 Purpose

Document the uniform pipeline every request passes through so that developers
can predict behavior without reading each handler.

### 2.2 Detail

Each handler follows this sequence (function names reference `domains.ts`):

| Step | Function / Call | What it does |
|------|-----------------|--------------|
| 1 | `validateConcept(conceptKey, res)` | Looks up concept via `getConceptByKey()`. Returns 404 if missing. |
| 2 | `roleEngine.canPerformAction(roleKey, conceptKey, action)` | Checks role permission for `view`/`create`/`edit`/`delete`. Returns 403 on failure via `sendError()`. |
| 3 | `roleEngine.buildDataScopeFilter()` | (list) Row-level scope filter combined with user-supplied filters via `combineFilters()`. |
| 4 | `roleEngine.filterWritePayload()` | (create/update) Strips fields the caller's role cannot write. |
| 5 | Database operation | `queryDatabasePage` / `getPage` / `createPage` / `updatePage` / `archivePage` |
| 6 | `roleEngine.filterRecord()` | (list/get) Removes properties the caller's role cannot see from the response. |
| 7 | `createDomainEvent()` + `emit()` | (create/update/delete) Publishes a domain event. |
| 8 | `res.json()` / `res.status(201).json()` | Returns `ApiResponse<T>` envelope. |

The role key defaults to `"viewer"` when absent (`req.role?.roleKey ?? "viewer"`).

### 2.3 Acceptance Criteria

- Every handler begins with `validateConcept` and an RBAC check before any
  database call.
- Write endpoints filter the payload before persisting.
- Read endpoints filter the response before returning.

---

## 3. Filtering

### 3.1 Purpose

Allow callers to filter list results using query-string parameters without
knowing anything about the underlying storage layer.

### 3.2 Detail

**Query syntax:** `filter[fieldName]=value`

`buildFilterFromQuery(query, properties)` (L392) iterates over query params,
matches the `filter[...]` pattern via regex, resolves each field key against the
ontology `Property[]`, and delegates to `buildSingleFilter(prop, value)` (L420).

`buildSingleFilter` maps the ontology property type to the correct Postgres
comparison operator:

| Ontology type | Operator | Example |
|---------------|----------|---------|
| `text`, `rich_text`, `email`, `phone`, `url` | `LIKE` (contains) | `filter[name]=Acme` |
| `number` | `= (numeric)` | `filter[capacity]=500` |
| `select`, `status` | `= (exact)` | `filter[status]=Active` |
| `multi_select` | `contains` | `filter[tags]=VIP` |
| `checkbox` | `= (boolean)` | `filter[active]=true` |
| `date`, `datetime` | `= (date)` | `filter[startDate]=2026-06-15` |

Unknown property types are silently skipped (returns `undefined`).

When multiple filters are present, they are combined with AND logic. A single
filter is passed directly; two or more are wrapped in `{ and: [...] }`.

`combineFilters(a, b)` (L477) merges the user-supplied filter with the RBAC
data-scope filter using AND. Either side may be `undefined`.

### 3.3 Acceptance Criteria

- `filter[field]=value` for every supported type produces the correct WHERE clause.
- Unknown fields are ignored, not errored.
- Data-scope filters are always AND-ed on top of user filters.

---

## 4. Sorting and Pagination

### 4.1 Purpose

Provide deterministic ordering and bounded result sets.

### 4.2 Detail

**Sorting:** `sort=fieldKey&direction=asc|desc`

`buildSortFromQuery(query, properties)` (L454) resolves the sort key against
ontology properties. If the field is not found, no sort is applied. Direction
defaults to `ascending` unless explicitly set to `"desc"`.

**Pagination:** `page=N&limit=N`

`clampInt(value, min, max, defaultVal)` (L546) parses and bounds both values:

| Param  | Min | Max   | Default |
|--------|-----|-------|---------|
| `page` | 1   | 10000 | 1       |
| `limit`| 1   | 200   | 50      |

The list handler passes `Math.min(limit, 100)` as the page size to the query
layer. The response envelope includes `meta.total`, `meta.page`, `meta.limit`,
and `meta.hasMore`.

### 4.3 Acceptance Criteria

- `sort` on an unknown field is a no-op, not an error.
- `limit` is clamped to `[1, 200]` and page size to the query layer never
  exceeds 100.
- `page` and `limit` reject non-numeric values gracefully (fall back to defaults).

---

## 5. RBAC Integration

### 5.1 Purpose

Enforce authorization at every layer: action permission, row-level scoping,
field-level read filtering, and field-level write filtering.

### 5.2 Detail

Four `roleEngine` calls appear across the handlers:

| Call | Used in | Purpose |
|------|---------|---------|
| `canPerformAction(roleKey, conceptKey, action)` | All five endpoints | Gate: can this role perform `view`/`create`/`edit`/`delete` on this concept? Returns boolean; handler sends 403 via `sendError()` on `false`. |
| `buildDataScopeFilter(roleKey, conceptKey, userId)` | List (L69) | Returns a filter that restricts rows to those the user is allowed to see (e.g., own records only). Merged with query filters via `combineFilters()`. |
| `filterRecord(roleKey, conceptKey, properties)` | List (L93), Get (L137) | Removes properties the role is not permitted to read from the response object. Runs per-record. |
| `filterWritePayload(roleKey, conceptKey, payload)` | Create (L173), Update (L234) | Strips properties the role is not permitted to write before the payload reaches the database. |

The role key is extracted from `req.role?.roleKey` and defaults to `"viewer"`.

### 5.3 Acceptance Criteria

- A role without `view` permission receives 403 on GET.
- A role without `create` permission receives 403 on POST.
- A role without `edit` permission receives 403 on PUT.
- A role without `delete` permission receives 403 on DELETE.
- Data-scope filters are applied even when no user-supplied filters are present.
- Read responses never contain fields the role cannot see.
- Write payloads never persist fields the role cannot edit.

---

## 6. Domain Events

### 6.1 Purpose

Decouple side effects (workflows, notifications, audit logs) from the CRUD
layer by emitting structured events on every write.

### 6.2 Detail

Every write operation constructs a `DomainEvent` via `createDomainEvent()` and
publishes it via `emit()`.

**Create** (L189):

```
createDomainEvent({
  eventName: `${conceptKey}.created`,
  domain: conceptKey,
  action: "created",
  recordId: record.id,
  newValues: filteredPayload,
  triggeredBy: req.user?.email ?? "system",
})
```

**Update** (L268):

```
createDomainEvent({
  eventName: `${conceptKey}.updated`,
  domain: conceptKey,
  action: "updated",
  recordId: id,
  changedFields,
  previousValues,
  newValues: changedPayload,
  triggeredBy: req.user?.email ?? "system",
})
```

**Delete** (L310):

```
createDomainEvent({
  eventName: `${conceptKey}.deleted`,
  domain: conceptKey,
  action: "deleted",
  recordId: id,
  triggeredBy: req.user?.email ?? "system",
})
```

Event names follow the pattern `{concept}.{action}` (e.g., `sponsor.created`,
`session.updated`, `attendee.deleted`).

### 6.3 Acceptance Criteria

- Every successful create emits `{concept}.created` with `newValues`.
- Every successful update emits `{concept}.updated` with `changedFields`,
  `previousValues`, and `newValues`.
- Every successful delete emits `{concept}.deleted` with `recordId`.
- All events include `triggeredBy` (user email or `"system"`).
- Events are emitted after the database write succeeds.

---

## 7. Change Tracking

### 7.1 Purpose

Avoid unnecessary writes and enable precise downstream triggers by computing
the minimal diff between old and new values.

### 7.2 Detail

The update handler (L212) implements change tracking:

1. **Fetch existing record:** `getPage(id)` retrieves the current state;
   `pageToFlatObject()` flattens it to a key-value map (`existingFlat`).
2. **Filter payload:** `filterWritePayload()` strips non-writable fields.
3. **Compute diff:** `changedFields` is the subset of keys where
   `JSON.stringify(filteredPayload[key]) !== JSON.stringify(existingFlat[key])`.
4. **Short-circuit:** If `changedFields.length === 0`, the handler returns the
   existing record without writing (L243).
5. **Write only changed fields:** `changedPayload` is built from
   `changedFields` only (L254). This is what gets persisted.
6. **Build `previousValues`:** For each changed field, the old value is pulled
   from `existingFlat` and included in the domain event.

This means downstream listeners can inspect `changedFields` to decide whether
to trigger (e.g., fire a workflow only when `status` changes, not when `notes`
changes).

### 7.3 Acceptance Criteria

- An update with no actual changes returns 200 with the existing record and
  does not write to the database.
- An update with partial changes writes only the changed fields.
- The domain event's `changedFields` array matches exactly the fields that
  were modified.
- `previousValues` in the event contains the old values for changed fields only.

---

## 8. Error Handling

### 8.1 Purpose

Return consistent, actionable error responses for every failure mode.

### 8.2 Detail

| Function | Status | When |
|----------|--------|------|
| `validateConcept()` (L336) | 404 | Concept key not found in ontology. Message includes a pointer to `/api/ontology/concepts`. |
| `sendError()` (L560) | 403 | RBAC check fails. Each handler provides a context-specific message (e.g., "You do not have permission to view {pluralName}"). |
| `handleError()` (L567) | 500 (or `err.status` if present) | Unexpected exceptions. Logs via `logger.error()` with context string (e.g., "listing records", "creating record"). Returns the error message in the response body. |

All error responses use the `ApiResponse<never>` shape: `{ success: false, error: "..." }`.

### 8.3 Acceptance Criteria

- Unknown concept returns 404 with a helpful message.
- RBAC denial returns 403 with an action-specific message.
- Unexpected errors return 500, are logged with context, and do not leak stack
  traces.
- Every error response matches the `{ success: false, error }` envelope.

---

## 9. Test Plan

### 9.1 CRUD Operations

- [ ] POST creates a record and returns 201 with the record body.
- [ ] GET list returns paginated results inside the `ApiResponse` envelope.
- [ ] GET single returns one record by ID.
- [ ] PUT updates only changed fields and returns the updated record.
- [ ] PUT with no changes returns 200 without a database write.
- [ ] DELETE archives the record and returns `{ success: true, data: null }`.

### 9.2 RBAC Enforcement

- [ ] A role without `view` permission gets 403 on GET list.
- [ ] A role without `view` permission gets 403 on GET single.
- [ ] A role without `create` permission gets 403 on POST.
- [ ] A role without `edit` permission gets 403 on PUT.
- [ ] A role without `delete` permission gets 403 on DELETE.
- [ ] `buildDataScopeFilter` restricts list results to scoped rows.
- [ ] `filterRecord` strips non-readable fields from GET responses.
- [ ] `filterWritePayload` strips non-writable fields from POST/PUT payloads.

### 9.3 Filtering

- [ ] `filter[textField]=value` produces a LIKE/contains clause.
- [ ] `filter[numberField]=42` produces a numeric equality clause.
- [ ] `filter[selectField]=Option` produces an exact match clause.
- [ ] `filter[checkboxField]=true` produces a boolean clause.
- [ ] `filter[dateField]=2026-06-15` produces a date equality clause.
- [ ] Unknown filter fields are ignored silently.
- [ ] Multiple filters combine with AND.

### 9.4 Sorting and Pagination

- [ ] `sort=field&direction=asc` returns results in ascending order.
- [ ] `sort=field&direction=desc` returns results in descending order.
- [ ] `sort=unknownField` is a no-op.
- [ ] `limit=0` clamps to 1; `limit=999` clamps to 200.
- [ ] `page=abc` falls back to default (1).
- [ ] Response meta includes `total`, `page`, `limit`, `hasMore`.

### 9.5 Domain Event Emission

- [ ] POST emits `{concept}.created` with `newValues` and `triggeredBy`.
- [ ] PUT emits `{concept}.updated` with `changedFields`, `previousValues`,
      `newValues`, and `triggeredBy`.
- [ ] PUT with no changes does not emit an event.
- [ ] DELETE emits `{concept}.deleted` with `recordId` and `triggeredBy`.

### 9.6 Change Tracking Accuracy

- [ ] `changedFields` contains exactly the modified keys.
- [ ] `previousValues` maps each changed key to its old value.
- [ ] `newValues` maps each changed key to its new value.
- [ ] Unchanged fields are absent from all three.

### 9.7 Error Handling

- [ ] Request with unknown concept returns 404 with guidance message.
- [ ] Unauthorized action returns 403.
- [ ] Thrown exception returns 500 and is logged with context.
- [ ] All error responses conform to `{ success: false, error }`.
