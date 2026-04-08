# RBAC Engine

> **Permissions, field-level filtering, data scoping.**
> Roles are ontology-defined, admin-editable through the ontology web builder -- not a hardcoded enum.
> Postgres is the system of record. The RBAC engine reads role, permission, data-scope, and screen-access rows at runtime, caches them, and evaluates every access check in-process.
> Deny by default. If no permission row exists for a role+concept pair, the answer is "no."
> This is a Phase 1 / Foundation deliverable (`_orchestration.md` line 21). Auth resolves identity; RBAC evaluates permissions. They build in parallel.

---

## Overview

The RBAC engine is the single authority that answers three questions for every authenticated request:

1. **Can this role do this action on this concept?** (CRUD gate)
2. **Which rows can this role see?** (data scoping / WHERE clause)
3. **Which fields can this role see or edit?** (property filtering)

Roles are data, not code. They live in the `roles` table in Postgres, are created and edited by admins through the ontology web builder, and are referenced by key throughout the system. The engine never imports a list of role names -- it reads whatever roles the ontology defines at runtime.

Permissions, data scopes, and screen-access records are also Postgres rows, each keyed by `role_key + concept_key` (or `role_key + page_slug` for screens). The `RoleEngine` class loads them into a TTL cache and exposes a small, deterministic API that every request handler calls before touching data.

**Key interfaces** (defined in `functions/src/ontology/types.ts`):

| Interface | Purpose |
|-----------|---------|
| `Role` | Identity of a role -- key, name, priority, operational flag |
| `Permission` | CRUD booleans + visible/editable property lists per role+concept |
| `DataScope` | Row-level filter definition per role+concept |
| `ScreenAccess` | Page visibility flag per role+page |
| `StaffingTemplate` | Operational staffing rules that reference role keys |

**Key source file:** `functions/src/roles/engine.ts` -- contains `RoleEngine`, parsers, cache wiring, singleton export.

---

## 1. Roles as Ontology Concepts

### Purpose

Roles define who people are in the system. They are first-class ontology concepts stored in Postgres, not constants compiled into the application.

### Detail

The `roles` table contains:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid / PK | Stable identifier |
| `key` | text, unique | Machine name used in permission lookups. e.g. `director`, `liaison`, `volunteer` |
| `name` | text | Human-readable label. e.g. "Director", "Liaison" |
| `description` | text, nullable | Explains what this role does |
| `priority` | integer | Hierarchy rank. Lower number = broader access. Used for conflict resolution when a user holds multiple roles |
| `is_operational` | boolean | `true` = staffing/scheduling role; `false` = application-only role |

The `Role` interface in `types.ts` (line 310-317) mirrors this schema exactly.

**Example roles** (illustrative -- these are data rows, not code):

| key | name | priority | is_operational |
|-----|------|----------|----------------|
| `director` | Director | 10 | true |
| `manager` | Manager | 20 | true |
| `liaison` | Liaison | 30 | true |
| `volunteer` | Volunteer | 50 | true |
| `viewer` | Viewer | 100 | false |

Admins can add, rename, reorder, or retire roles at any time through the ontology web builder. The engine will pick up changes on the next cache cycle.

### Inputs / Outputs

- **Input:** Admin edits via ontology web builder write to Postgres `roles` table.
- **Output:** Role rows are read by the RBAC engine, referenced by `key` in permission and data-scope records, and used by staffing templates.

### Acceptance Criteria

- [ ] Roles are loaded from Postgres at runtime, never from a hardcoded list.
- [ ] Adding a new role row (with permissions) immediately grants access after cache TTL expires or `reload()` is called.
- [ ] Deleting a role row causes all permission checks for that key to return `false` (deny by default).
- [ ] `priority` is used to resolve conflicts when a user holds multiple roles -- lowest priority value wins.
- [ ] `is_operational` flag is queryable so staffing logic can distinguish scheduling roles from app-only roles.

---

## 2. Permission Model

### Purpose

Each permission record defines what a single role can do with a single concept -- which CRUD operations are allowed, which properties are visible, and which are editable.

### Detail

The `Permission` interface (`types.ts` lines 319-329):

```typescript
interface Permission {
  readonly id: string
  readonly roleKey: string             // FK to roles.key
  readonly conceptKey: string          // FK to concepts.key
  readonly canView: boolean
  readonly canEdit: boolean
  readonly canCreate: boolean
  readonly canDelete: boolean
  readonly visibleProperties: ReadonlyArray<string>   // property keys
  readonly editableProperties?: ReadonlyArray<string> // if absent, falls back to visibleProperties
}
```

**Postgres table: `permissions`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid / PK | |
| `role_key` | text, FK | References `roles.key` |
| `concept_key` | text, FK | References `concepts.key` |
| `can_view` | boolean, default false | |
| `can_create` | boolean, default false | |
| `can_edit` | boolean, default false | |
| `can_delete` | boolean, default false | |
| `visible_properties` | text[] | Array of property keys the role can read |
| `editable_properties` | text[], nullable | Array of property keys the role can write. If null, falls back to `visible_properties` |

**Deny by default.** If no permission row exists for a `(role_key, concept_key)` pair, every check returns `false` and every property list returns `[]`. This is enforced in `RoleEngine.findPermission()` -- when the lookup returns `undefined`, the caller treats it as full denial.

The `parsePermission()` function in `engine.ts` (line 288-309) coerces raw DB rows into the `Permission` interface, defaulting all booleans to `false` and parsing property arrays from comma-separated strings or native arrays.

### Inputs / Outputs

- **Input:** `roleKey`, `conceptKey`, and an action string (maps to CRUD via `toCrudAction()`).
- **Output:** `boolean` for action checks; `ReadonlyArray<string>` for property lists.

### Acceptance Criteria

- [ ] A missing permission row results in denial for all actions and empty property lists.
- [ ] All four CRUD booleans default to `false` when not explicitly set.
- [ ] `editableProperties` falls back to `visibleProperties` when undefined or empty (see `getEditableProperties()` line 167-175).
- [ ] Permission records are cached with TTL; `reload()` clears the cache.
- [ ] The `toCrudAction()` mapper handles both past-tense event actions (`created`, `updated`, `deleted`) and imperative forms (`create`, `edit`, `delete`), defaulting unknown actions to `view`.

---

## 3. Data Scoping

### Purpose

Data scoping restricts which rows a role can access for a given concept. It generates Postgres `WHERE` clauses that are appended to every query.

### Detail

The `DataScope` interface (`types.ts` lines 331-339):

```typescript
interface DataScope {
  readonly id: string
  readonly roleKey: string
  readonly conceptKey: string
  readonly scopeType: 'relation' | 'field' | 'department' | 'all'
  readonly relationPath?: string   // e.g. "pairings.staff" = current user
  readonly field?: string
  readonly value?: string
}
```

**Scope types and their Postgres WHERE clauses:**

| scopeType | Meaning | Generated WHERE | Example |
|-----------|---------|-----------------|---------|
| `all` | No restriction. Role sees every row. | *(none -- query runs unfiltered)* | Director sees all events |
| `relation` | Rows where a relation column references the current user | `WHERE {relationPath} = $userId` | Liaison sees only events they are assigned to |
| `field` | Rows where a specific field matches a specific value | `WHERE {field} = {value}` | A role that only sees records with `status = 'active'` |
| `department` | Rows where a department column matches a value | `WHERE {field} = {value}` | Registration team sees only registration records |

`buildDataScopeFilter()` (`engine.ts` lines 183-231) implements the dispatch:

1. Load all data-scope records from cache.
2. Find the scope matching `(roleKey, conceptKey)`.
3. If `scopeType === 'all'` or no scope record exists, return `undefined` (no restriction).
4. Otherwise, return a filter object describing the WHERE clause:
   - **`field`**: `{ column: scope.field, operator: '=', value: scope.value }`
   - **`relation`**: `{ column: scope.relationPath, operator: '=', value: userId }`
   - **`department`**: `{ column: scope.field, operator: '=', value: scope.value }`

The query layer receives this filter and appends it as a parameterized WHERE clause to the Postgres query. No raw string interpolation -- all values are bound parameters.

### Inputs / Outputs

- **Input:** `roleKey: string`, `conceptKey: string`, `userId: string`.
- **Output:** `Record<string, unknown> | undefined`. `undefined` means "no restriction." A defined object is a filter descriptor passed to the query builder.

### Acceptance Criteria

- [ ] `scopeType: 'all'` produces no WHERE clause.
- [ ] `scopeType: 'relation'` filters rows to those related to the authenticated user's ID.
- [ ] `scopeType: 'field'` filters rows where a named column equals a configured value.
- [ ] `scopeType: 'department'` filters rows by department match.
- [ ] Missing scope records are treated as "all" (no restriction) -- this is a conscious design choice; restrict by adding a scope row.
- [ ] Filter values are always parameterized, never interpolated into SQL.
- [ ] Scopes are cached alongside permissions; `reload()` clears both.

---

## 4. RoleEngine Methods

### Purpose

`RoleEngine` is the public API surface for all access-control decisions. It is instantiated once as a singleton (`roleEngine` export in `engine.ts` line 284) and called by request handlers, middleware, and API resolvers.

### 4.1 `canPerformAction(roleKey, conceptKey, action)`

**Purpose:** Gate a CRUD operation.

**Inputs:**
- `roleKey: string` -- the user's role key.
- `conceptKey: string` -- the ontology concept being accessed.
- `action: EventAction | string` -- the operation (e.g. `"create"`, `"updated"`, `"view"`).

**Detail:** Looks up the permission record via `findPermission()`. Maps the action to a CRUD verb via `toCrudAction()`. Returns the corresponding boolean. Returns `false` if no permission record exists.

**Output:** `Promise<boolean>`.

**Acceptance Criteria:**
- [ ] Returns `false` when no permission record exists (deny by default).
- [ ] Correctly maps past-tense event actions to CRUD verbs.
- [ ] Unknown actions map to `view`.

---

### 4.2 `getVisibleProperties(roleKey, conceptKey)`

**Purpose:** Return property keys a role is allowed to read for a concept.

**Inputs:** `roleKey: string`, `conceptKey: string`.

**Detail:** Finds the permission record. Returns `perm.visibleProperties`. Returns `[]` if no record exists.

**Output:** `Promise<ReadonlyArray<string>>`.

**Acceptance Criteria:**
- [ ] Returns `[]` when no permission exists (deny by default -- no fields visible).
- [ ] Returns the exact array from the permission record when it exists.

---

### 4.3 `getEditableProperties(roleKey, conceptKey)`

**Purpose:** Return property keys a role is allowed to write for a concept.

**Inputs:** `roleKey: string`, `conceptKey: string`.

**Detail:** Finds the permission record. If `editableProperties` is defined and non-empty, returns it. Otherwise falls back to `visibleProperties`. Returns `[]` if no record exists. (See `engine.ts` lines 167-175.)

**Output:** `Promise<ReadonlyArray<string>>`.

**Acceptance Criteria:**
- [ ] Returns `[]` when no permission exists.
- [ ] Returns `editableProperties` when defined and non-empty.
- [ ] Falls back to `visibleProperties` when `editableProperties` is undefined or empty.

---

### 4.4 `filterRecord(roleKey, conceptKey, record)`

**Purpose:** Strip fields from a read response that the role cannot see.

**Inputs:** `roleKey: string`, `conceptKey: string`, `record: Record<string, unknown>`.

**Detail:** Gets `visibleProperties`. Filters the record to only include keys present in that list. Returns `{}` if no permission exists. (See `engine.ts` lines 237-252.)

**Output:** `Promise<Record<string, unknown>>` -- a new object; the original is not mutated.

**Acceptance Criteria:**
- [ ] Returns `{}` for roles with no permission record.
- [ ] Includes only keys listed in `visibleProperties`.
- [ ] Does not mutate the input record.
- [ ] System/internal keys (e.g. `id`) should be included in `visibleProperties` if they need to survive filtering.

---

### 4.5 `filterWritePayload(roleKey, conceptKey, payload)`

**Purpose:** Strip fields from a write request that the role cannot edit.

**Inputs:** `roleKey: string`, `conceptKey: string`, `payload: Record<string, unknown>`.

**Detail:** Gets `editableProperties`. Filters the payload to only include keys present in that list. Returns `{}` if no permission exists. (See `engine.ts` lines 257-269.)

**Output:** `Promise<Record<string, unknown>>`.

**Acceptance Criteria:**
- [ ] Returns `{}` for roles with no permission record.
- [ ] Includes only keys listed in the editable set (with the fallback logic from `getEditableProperties`).
- [ ] Does not mutate the input payload.

---

### 4.6 `buildDataScopeFilter(roleKey, conceptKey, userId)`

**Purpose:** Generate a row-level filter for Postgres queries.

**Inputs:** `roleKey: string`, `conceptKey: string`, `userId: string`.

**Detail:** See Section 3 above. Returns `undefined` for unrestricted scopes; returns a filter descriptor object otherwise.

**Output:** `Promise<Record<string, unknown> | undefined>`.

**Acceptance Criteria:**
- [ ] Returns `undefined` for `scopeType: 'all'` and for missing scope records.
- [ ] Returns a correctly shaped filter for `relation`, `field`, and `department` scope types.
- [ ] The `userId` parameter is passed through for `relation` scopes; it is not used for `field` or `department` scopes.

---

### 4.7 `reload()`

**Purpose:** Force-clear the in-memory permission and data-scope caches.

**Inputs:** None.

**Detail:** Sets both internal promises to `null` and calls `cache.invalidate()` for both cache keys. Next access will reload from Postgres. (See `engine.ts` lines 274-279.)

**Output:** `void` (synchronous).

**Acceptance Criteria:**
- [ ] After `reload()`, the next call to any method fetches fresh data from the database.
- [ ] Both `permissions` and `data_scopes` caches are invalidated.

---

## 5. Permission Evaluation Flow

### Purpose

Document the full request lifecycle from authentication through to filtered response, so that every developer understands exactly when and how RBAC is applied.

### Detail

```
Client Request
  |
  v
[1] Auth Middleware (core/auth-system)
    - Validates Firebase token or API key
    - Extracts userId and roleKey from token claims
    - Attaches { userId, roleKey } to request context
    - Rejects unauthenticated requests (401)
  |
  v
[2] RBAC Middleware / Handler entry
    - Reads roleKey and conceptKey from context + route
    - Calls roleEngine.canPerformAction(roleKey, conceptKey, action)
    - If false --> 403 Forbidden, request ends
  |
  v
[3] Data Scope Filter
    - Calls roleEngine.buildDataScopeFilter(roleKey, conceptKey, userId)
    - Passes returned filter to the query builder
    - Query builder appends it as a parameterized WHERE clause
    - Postgres executes query with row-level restriction
  |
  v
[4] Field Filtering (Read path)
    - For each record in the result set:
      roleEngine.filterRecord(roleKey, conceptKey, record)
    - Strips properties the role cannot see
    - Response contains only permitted fields
  |
  v
[4b] Field Filtering (Write path)
    - Before persisting:
      roleEngine.filterWritePayload(roleKey, conceptKey, payload)
    - Strips properties the role cannot edit
    - Only permitted fields reach the database
  |
  v
[5] Response
    - Filtered data returned to client
    - Audit event emitted via event bus (core/event-bus)
```

### Inputs / Outputs

- **Input:** Raw HTTP request with auth token.
- **Output:** Filtered, scope-restricted response or 401/403 rejection.

### Acceptance Criteria

- [ ] No data query executes without a preceding `canPerformAction()` check.
- [ ] Every query includes the data-scope filter when one is defined.
- [ ] Read responses pass through `filterRecord()` before serialization.
- [ ] Write payloads pass through `filterWritePayload()` before persistence.
- [ ] 403 responses do not leak information about the existence of the resource.
- [ ] The flow works identically for REST endpoints, and MCP tool calls.

---

## 6. Screen Access

### Purpose

Control which pages/screens in the UI are visible to each role. This is a UI-level gate -- it does not replace server-side permission checks, but prevents the client from rendering pages the user cannot use.

### Detail

The `ScreenAccess` interface (`types.ts` lines 341-346):

```typescript
interface ScreenAccess {
  readonly id: string
  readonly roleKey: string
  readonly pageSlug: string    // e.g. "staffing", "reports", "admin/roles"
  readonly visible: boolean
}
```

**Postgres table: `screen_access`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid / PK | |
| `role_key` | text, FK | References `roles.key` |
| `page_slug` | text | URL path segment or screen identifier |
| `visible` | boolean, default false | Whether the page appears in the role's navigation |

The client fetches screen-access records for the authenticated user's role at login and uses them to:
- Show or hide navigation items.
- Redirect unauthorized page visits to a "not permitted" screen.

**Deny by default:** If no `ScreenAccess` row exists for a `(role_key, page_slug)` pair, the page is hidden. Admins must explicitly grant visibility.

### Inputs / Outputs

- **Input:** `roleKey: string`, optionally filtered by `pageSlug`.
- **Output:** Array of `ScreenAccess` records; client filters nav based on `visible === true`.

### Acceptance Criteria

- [ ] Pages with no `ScreenAccess` row for a role are hidden from that role's UI.
- [ ] Adding a `ScreenAccess` row with `visible: true` immediately makes the page appear after cache refresh.
- [ ] Screen access is a UI convenience only -- server-side RBAC (Sections 2-5) is the enforcement layer.
- [ ] The screen-access endpoint returns only records for the requesting user's role, not all roles.

---

## 7. Test Plan

### 7.1 Unit Tests -- RoleEngine Methods

Each method gets isolated tests with mocked permission/data-scope data.

| Test | Method | Scenario | Expected |
|------|--------|----------|----------|
| U-01 | `canPerformAction` | Permission row exists, `canEdit: true` | `true` |
| U-02 | `canPerformAction` | Permission row exists, `canDelete: false` | `false` |
| U-03 | `canPerformAction` | No permission row for role+concept | `false` |
| U-04 | `canPerformAction` | Action string `"updated"` maps to `edit` | Uses `canEdit` |
| U-05 | `canPerformAction` | Unknown action string `"archive"` | Maps to `view`, uses `canView` |
| U-06 | `getVisibleProperties` | Permission row with `["name", "email"]` | Returns `["name", "email"]` |
| U-07 | `getVisibleProperties` | No permission row | Returns `[]` |
| U-08 | `getEditableProperties` | `editableProperties` defined and non-empty | Returns `editableProperties` |
| U-09 | `getEditableProperties` | `editableProperties` undefined | Falls back to `visibleProperties` |
| U-10 | `getEditableProperties` | `editableProperties` is empty array | Falls back to `visibleProperties` |
| U-11 | `filterRecord` | Record has 5 keys, visible list has 2 | Returns object with 2 keys |
| U-12 | `filterRecord` | No permission row | Returns `{}` |
| U-13 | `filterRecord` | Record is not mutated | Original object unchanged after call |
| U-14 | `filterWritePayload` | Payload has 4 keys, editable list has 1 | Returns object with 1 key |
| U-15 | `filterWritePayload` | No permission row | Returns `{}` |
| U-16 | `buildDataScopeFilter` | scopeType `all` | Returns `undefined` |
| U-17 | `buildDataScopeFilter` | scopeType `relation` with `relationPath` set | Returns filter with userId |
| U-18 | `buildDataScopeFilter` | scopeType `field` with `field` and `value` | Returns equality filter |
| U-19 | `buildDataScopeFilter` | scopeType `department` with `field` and `value` | Returns department filter |
| U-20 | `buildDataScopeFilter` | No scope record | Returns `undefined` |
| U-21 | `reload` | Call reload, then access permissions | Fresh data loaded from DB |

### 7.2 Integration Tests -- Full Request Flow

| Test | Scenario | Expected |
|------|----------|----------|
| I-01 | Authenticated director requests all events | 200, all rows, all fields |
| I-02 | Authenticated liaison requests all events | 200, only their assigned events, restricted fields |
| I-03 | Authenticated volunteer requests event delete | 403 Forbidden |
| I-04 | Unauthenticated request | 401 Unauthorized |
| I-05 | Role with no permission row for the concept | 403 Forbidden |
| I-06 | Write request with extra fields beyond editable set | Extra fields silently stripped, permitted fields saved |
| I-07 | Admin adds a new role with permissions, then requests as that role | Access granted per new permission rows |
| I-08 | Screen access endpoint returns only pages visible to the requesting role | Hidden pages omitted from response |

### 7.3 Edge Cases

| Test | Scenario | Expected |
|------|----------|----------|
| E-01 | User holds multiple roles | Highest-priority role (lowest `priority` number) is used |
| E-02 | Permission row has empty `visibleProperties` array | `filterRecord` returns `{}` -- deny by default |
| E-03 | Data scope `relation` type but `relationPath` is null | Returns `undefined` (no filter, graceful fallback) |
| E-04 | Data scope `field` type but `field` is null | Returns `undefined` (graceful fallback) |
| E-05 | Cache TTL expires mid-request | In-flight request uses its own cached promise; next request reloads |
| E-06 | Concurrent requests during `reload()` | Each request gets a consistent snapshot; no partial state |
| E-07 | Role key exists in `roles` table but has zero permission rows | All access checks return `false`, all property lists return `[]` |
| E-08 | Very large `visibleProperties` array (50+ keys) | `filterRecord` performs correctly without performance degradation |
