# Ontology Scoping

Source: `functions/src/ontology/scoping.ts`

Every ontology table row carries two ownership columns: `owner_scope` and `owner_department`. Together they determine who can read, who can write, how queries are filtered, how property keys are stored in JSONB, and whether a new property collides with an existing one.

---

## Ownership Model

```typescript
export type OwnerScope = "org" | "department";
```

| `owner_scope` | `owner_department` | Meaning |
|---|---|---|
| `"org"` | `NULL` | Org-wide definition. Visible to everyone, writable only by admins. |
| `"department"` | e.g. `"sales"` | Department-owned definition. Visible to that department (and admins / granted departments). Writable by the owning department's director and admins. |

A department can extend org-wide concepts by adding its own department-scoped properties. Two departments can independently define the same property key on the same concept without conflict (composite uniqueness on `concept_key, key, owner_department`).

---

## Permission Rules

### Constants

```typescript
/** Roles with priority <= this value are considered admin. */
export const ADMIN_PRIORITY_THRESHOLD = -1;

/** Role priority for director-level access. */
export const DIRECTOR_PRIORITY = 0;
```

Priority is a numeric value on the caller's role. Lower numbers mean higher authority.

### Write Permission Check

```typescript
export function validateScopePermission(
  rolePriority: number,
  ownerScope: OwnerScope,
  ownerDepartment: string | null,
  callerDepartment: string | null
): ScopePermissionResult;
```

Decision table:

| Record scope | Caller role | Caller department matches? | Result |
|---|---|---|---|
| `org` | admin (`priority <= -1`) | n/a | Allowed |
| `org` | non-admin | n/a | Denied -- "Only administrators can modify org-wide ontology records." |
| `department` | admin | n/a | Allowed |
| `department` | director (`priority <= 0`) | yes | Allowed |
| `department` | director | no | Denied -- "You can only modify records owned by your department ({callerDepartment})." (shows the caller's department or "none" if null) |
| `department` | other (`priority > 0`) | any | Denied -- "Insufficient permissions for this action." |
| `department` | any | `owner_department` is `NULL` | Denied -- "Department-scoped record is missing owner_department." |

Return type:

```typescript
export interface ScopePermissionResult {
  readonly allowed: boolean;
  readonly reason?: string;   // present when allowed === false
}
```

### Read Visibility

All users can read org-wide records. Department records are visible to the owning department, to admins, and to any department explicitly granted cross-department access via RBAC.

---

## Query Filtering

```typescript
export function buildScopeFilter(
  rolePriority: number,
  callerDepartment: string | null,
  grantedDepartments?: ReadonlyArray<string>
): { clause: string; params: ReadonlyArray<string> };
```

Returns a SQL `WHERE` clause fragment and its parameterized values. Callers append this clause to any ontology query to enforce row-level visibility.

### Behavior by Role

| Role | Generated clause | Effect |
|---|---|---|
| Admin (`priority <= -1`) | `1=1` | No filter; sees every record. |
| Director/other with own department | `(owner_scope = 'org' OR (owner_scope = 'department' AND owner_department IN ($1, ...)))` | Sees org-wide records plus own department plus any granted departments. |
| User with no department and no grants | `owner_scope = 'org'` | Sees only org-wide records. |

The `grantedDepartments` parameter supports cross-department RBAC. If a user has been granted access to departments `["sales", "ops"]`, those are merged with the caller's own department into the `IN (...)` list. Duplicates are deduplicated.

### Usage Pattern

```typescript
const { clause, params } = buildScopeFilter(
  caller.rolePriority,
  caller.department,
  caller.grantedDepartments
);

const result = await query(
  `SELECT * FROM ontology_properties WHERE concept_key = $1 AND ${clause}`,
  [conceptKey, ...params]
);
```

---

## Property Namespacing (JSONB Storage)

When department-scoped properties are stored in JSONB columns alongside org-wide properties, they are namespaced to avoid key collisions.

### Convention

```
{department}__{key}
```

Two underscores separate the department slug from the property key.

### Functions

```typescript
/** Formats: "sales" + "priority" -> "sales__priority" */
export function formatPropertyKey(key: string, department: string): string;

/** Strips: "sales__priority" -> "priority". No-op if no prefix. */
export function stripPropertyPrefix(namespacedKey: string): string;
```

`stripPropertyPrefix` finds the first `__` separator and returns everything after it. If no separator is found, the original key is returned unchanged.

---

## Visible Properties

```typescript
export async function getVisibleProperties(
  conceptKey: string,
  callerDepartment: string | null,
  rolePriority: number,
  grantedDepartments?: ReadonlyArray<string>
): Promise<ReadonlyArray<VisibleProperty>>;
```

Returns the union of properties visible to a caller on a given concept, ordered by `sort_order` then `key`. Only `status = 'active'` properties are returned.

```typescript
export interface VisibleProperty {
  readonly id: string;
  readonly conceptKey: string;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly ownerScope: OwnerScope;
  readonly ownerDepartment: string | null;
  readonly displayLabel?: string;
}
```

### Display Label Behavior

For admin users viewing department-scoped properties, the `displayLabel` field is augmented with the department name to disambiguate cross-department properties:

| Caller | `ownerScope` | `displayLabel` |
|---|---|---|
| Admin | `department` (dept = `"sales"`) | `"Priority (SALES)"` |
| Admin | `org` | same as `label` |
| Non-admin | any | same as `label` |

---

## Conflict Detection

```typescript
export async function checkPropertyConflict(
  conceptKey: string,
  propertyKey: string,
  ownerDepartment: string
): Promise<PropertyConflictResult>;
```

Called before creating a department-scoped property. Checks whether an active org-wide property with the same `key` already exists on the same concept.

```typescript
export interface PropertyConflictResult {
  readonly conflict: boolean;
  readonly status?: 409;
  readonly message?: string;
}
```

### Conflict Rules

The conflict check query filters by `status = 'active'`, so deprecated or rolled-back org-wide properties do not block new department properties.

| Existing property | New property | Result |
|---|---|---|
| Org-wide `key="priority"` (`status='active'`) | Department `key="priority"` | **409 Conflict** -- department properties cannot shadow active org-wide definitions. |
| Org-wide `key="priority"` (`status='deprecated'`) | Department `key="priority"` | **No conflict** -- only active org-wide properties block. |
| Dept A `key="priority"` | Dept B `key="priority"` | **No conflict** -- composite uniqueness (`concept_key`, `key`, `version`, `owner_department`) allows this. |
| None | Any | **No conflict**. |

The 409 response body includes a message explaining the collision:

```
Cannot create department property "priority" on concept "task":
an org-wide property with the same key already exists.
Department-scoped properties cannot shadow org-wide definitions.
```

This rule prevents ambiguity: if an org-wide property exists, every department already has access to it. Allowing a department to create a same-key property would create two competing definitions of the same field.

---

## Database Schema Assumptions

The scoping module expects these columns on all ontology tables:

| Column | Type | Constraint |
|---|---|---|
| `owner_scope` | `text` | `CHECK (owner_scope IN ('org', 'department'))` |
| `owner_department` | `text` | `NULL` when `owner_scope = 'org'` |
| `status` | `text` | One of 4 valid values: `'active'` (live), `'pending_review'` (awaiting CI/QA approval), `'deprecated'` (soft-deleted, retained for history), `'rolled_back'` (reverted via rollback window). Only `'active'` rows are loaded by the ontology loader and returned by scoped queries. |

The `ontology_properties` table additionally requires:

| Column | Type | Notes |
|---|---|---|
| `concept_key` | `text` | FK to `ontology_concepts.key` |
| `key` | `text` | Property identifier |
| `label` | `text` | Human-readable name |
| `type` | `text` | Property data type |
| `sort_order` | `integer` | Display ordering |

Composite unique constraint on `ontology_properties`: `(concept_key, key, version, owner_department)`. The `version` column is included so that the versioning service can store multiple historical versions of the same property. Only the row with `status = 'active'` represents the current definition; prior versions have `status = 'deprecated'` or `'rolled_back'`.
