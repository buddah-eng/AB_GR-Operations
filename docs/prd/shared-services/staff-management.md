# Staff Management

> **Org-wide shared service for staff records, role assignment, department membership, and a searchable directory.**
> Staff are platform users who operate the system -- every authenticated human maps to exactly one `staff` row.
> Roles are ontology-defined and admin-assigned through the staff management UI; they drive all RBAC permissions.
> Postgres is the system of record. The `staff` table uses typed core columns plus a JSONB `properties` column for ontology-defined dynamic fields.
> This is a Phase 5 / Shared Services deliverable (`_orchestration.md` line 93). Depends on `domain-crud`, `rbac-engine`, and `dynamic-forms`.

---

## Overview

Staff management is the people backbone of the platform. Every person who logs in, assigns a volunteer, approves a schedule, or edits a guest record is a staff member. The `staff` table stores their identity, contact information, role assignment, department membership, availability, and dynamic properties.

Roles are not hardcoded. They are ontology-defined rows in the `roles` table (see `core/rbac-engine.md`). An admin assigns one or more role keys to a staff record through the staff management UI; those role keys determine what the person can see and do everywhere in the system.

Each staff member belongs to one primary department. Cross-department access is granted via RBAC data-scope records, not by changing department membership. This keeps the org chart clean while allowing flexible access patterns.

The staff directory is a searchable, filterable view of all staff records. It surfaces name, role, department, availability, and contact information -- scoped by the viewer's RBAC permissions. A director sees every field; a volunteer sees name, role, and department only.

**Key relationships:**

| Relationship | Target | Cardinality | Notes |
|-------------|--------|-------------|-------|
| `staff.role_keys` | `roles` | many-to-many | Staff hold one or more ontology-defined roles |
| `staff.department` | departments | has-one | Primary department membership |
| `staff → volunteers` | `volunteers` | has-one (optional) | A volunteer extends a staff record |
| `staff → schedule_events` | `schedule_events` | has-many | Staff assigned to shifts/events |

---

## 1. Staff Concept

### Purpose

Define the core data model for staff records -- the typed columns, JSONB properties, indexes, and constraints that make up the `staff` table.

### Detail

#### `staff` table

```sql
CREATE TABLE staff (
  -- Typed core columns
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  role_keys       TEXT[] NOT NULL DEFAULT '{}',
  department      TEXT NOT NULL,
  phone           TEXT,
  languages       TEXT[] NOT NULL DEFAULT '{}',
  availability    TEXT NOT NULL DEFAULT 'available'
                  CHECK (availability IN ('available', 'limited', 'unavailable', 'on_leave')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'pending')),

  -- Dynamic properties (ontology-defined)
  properties      JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES staff(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

-- Indexes
CREATE INDEX idx_staff_email ON staff (email);
CREATE INDEX idx_staff_department ON staff (department) WHERE NOT archived;
CREATE INDEX idx_staff_availability ON staff (availability) WHERE NOT archived;
CREATE INDEX idx_staff_role_keys ON staff USING GIN (role_keys);
CREATE INDEX idx_staff_properties ON staff USING GIN (properties);
CREATE INDEX idx_staff_active ON staff (status) WHERE NOT archived;
```

**Column rationale:**

| Column | Why typed | Notes |
|--------|-----------|-------|
| `name` | Every query, sort, and display uses it | NOT NULL, freeform text |
| `email` | Authentication identity, unique constraint | Must match Firebase auth email |
| `role_keys` | RBAC lookups on every request | Array of FK references to `roles.key` |
| `department` | Data scoping, directory filtering | FK to department concept |
| `phone` | Contact directory, emergency use | Nullable -- not all staff provide |
| `languages` | Volunteer matching, guest assignment | Array of ISO 639-1 codes |
| `availability` | Scheduling, directory filtering | Enum: available, limited, unavailable, on_leave |
| `status` | Lifecycle gating | active = can log in; inactive = disabled; pending = invited but not confirmed |
| `properties` | Ontology-defined dynamic fields | Convention-specific fields (e.g., `badge_name`, `dietary_restrictions`) |

**Staff are platform users.** The `email` column links to the Firebase auth identity. When a user authenticates, the auth middleware resolves their email to a staff row, reads `role_keys`, and attaches the resolved roles to the request context. The RBAC engine then evaluates permissions using those role keys.

### Acceptance Criteria

- [ ] `staff` table is created with all typed columns and a JSONB `properties` column.
- [ ] `email` has a unique constraint; duplicate inserts are rejected.
- [ ] `role_keys` is a text array; empty array is valid (results in deny-all via RBAC).
- [ ] `availability` enforces the CHECK constraint; invalid values are rejected by Postgres.
- [ ] `status` enforces the CHECK constraint.
- [ ] GIN index on `role_keys` supports `@>` (contains) queries for role-based lookups.
- [ ] GIN index on `properties` supports JSONB path queries.
- [ ] `archived` soft-delete: queries default to `WHERE NOT archived` via partial indexes.
- [ ] `updated_at` is set automatically on every update (via trigger or application layer).

---

## 2. Role Assignment

### Purpose

Define how ontology-defined roles are assigned to staff records, how assignments are validated, and how they flow into RBAC evaluation.

### Detail

Roles are assigned by writing to the `role_keys` array on the staff record. There is no separate join table -- the array column is the source of truth.

**Assignment flow:**

```
Admin opens staff management UI
  → Selects a staff record
  → Opens role assignment panel
  → Sees all ontology-defined roles (loaded from `roles` table)
  → Checks/unchecks roles
  → Saves → PATCH /api/staff/:id { role_keys: ['director', 'liaison'] }
  → API validates role keys exist in `roles` table
  → Postgres UPDATE staff SET role_keys = $1 WHERE id = $2
  → Event emitted: staff.updated { changedFields: ['role_keys'] }
  → RBAC cache invalidated for this user on next request
```

**Validation rules:**

1. Every key in the `role_keys` array must exist in the `roles` table. The API rejects unknown keys with a 400 response.
2. At least one role should be assigned for the staff member to have any permissions. An empty array is valid but results in deny-all.
3. Role assignment requires the `can_edit` permission on the `staff` concept. Only admins (e.g., `director`, `manager`) typically have this.
4. Role changes emit a `staff.updated` domain event with `changedFields: ['role_keys']` and `previousValues` / `newValues` carrying the old and new arrays.

**Multi-role resolution:**

A staff member can hold multiple roles (e.g., `manager` + `liaison`). When the RBAC engine evaluates permissions, it checks each role and applies the most permissive result (union of permissions). For conflicts, the role with the lowest `priority` value wins (see `rbac-engine.md` Section 1).

**UI behavior:**

The role assignment panel displays:

| Element | Content |
|---------|---------|
| Role list | All roles from `roles` table, grouped by `is_operational` flag |
| Checkboxes | Current assignments pre-checked |
| Role description | Shown on hover/expand for each role |
| Save button | Disabled until changes are made |
| Audit note | Optional text field for `change_reason` (logged in audit) |

### Acceptance Criteria

- [ ] Roles are loaded from the `roles` table at runtime, never from a hardcoded list.
- [ ] Assigning a nonexistent role key returns HTTP 400 with a descriptive error.
- [ ] Role changes emit a `staff.updated` domain event with before/after values.
- [ ] Only users with `can_edit` permission on the `staff` concept can modify role assignments.
- [ ] Multi-role staff get the union of permissions from all assigned roles.
- [ ] Role assignment changes take effect after RBAC cache TTL expires or on next login.
- [ ] Audit log records who changed roles, when, and the before/after state.

---

## 3. Department Membership

### Purpose

Define how staff relate to departments, how primary membership is assigned, and how cross-department access works without changing department affiliation.

### Detail

Each staff member has exactly one `department` value -- their primary department. This determines:

1. **Data scoping:** If a role has a `department` data scope, the staff member sees only records matching their department.
2. **Directory grouping:** The staff directory groups and filters by department.
3. **Reporting:** Headcount, coverage, and staffing reports roll up by department.

**Department values** are defined as a concept in the ontology (e.g., `guest_relations`, `registration`, `programming`, `logistics`, `security`). The `department` column on `staff` stores the concept key.

**Cross-department access:**

A staff member who needs to see data from another department does not change their `department` value. Instead, an admin creates an RBAC data-scope record that broadens the staff member's visibility:

- `scopeType: 'all'` -- sees all departments (e.g., directors).
- `scopeType: 'department'` with a different department value -- sees a specific other department.
- Multiple data-scope records can grant access to multiple departments.

This separation ensures the org chart (who reports where) is independent of data access (who sees what).

**Department change flow:**

```
Admin opens staff record
  → Changes department dropdown
  → Saves → PATCH /api/staff/:id { department: 'logistics' }
  → Event emitted: staff.updated { changedFields: ['department'] }
  → Data scoping recalculated on next query
```

### Acceptance Criteria

- [ ] Every staff record has exactly one non-null `department` value.
- [ ] Department values are validated against the ontology-defined department list.
- [ ] Changing a department emits a `staff.updated` event with before/after values.
- [ ] Cross-department access is handled via RBAC data scopes, not by adding multiple departments.
- [ ] Directory filtering by department returns only staff whose `department` column matches.
- [ ] Department headcount queries use `COUNT(*) ... GROUP BY department WHERE NOT archived`.

---

## 4. Staff Directory

### Purpose

Define the searchable directory view that lets authorized users find staff by name, role, department, or availability, with contact information visibility governed by RBAC.

### Detail

The staff directory is a standard view rendered by the view-renderer (`ui/view-renderer.md`) using the `staff` concept's view configuration. It supports table layout with filters, search, and pagination.

**Directory query:**

```
GET /api/staff?view=directory&page=1&pageSize=50&sort=name&order=asc
  &filter[department]=guest_relations
  &filter[availability]=available
  &search=kim
```

The API layer:

1. Authenticates the request (auth middleware).
2. Checks `canPerformAction(roleKey, 'staff', 'view')` -- 403 if denied.
3. Applies `buildDataScopeFilter()` -- restricts rows by department/role.
4. Applies user-supplied filters (`department`, `availability`, role, etc.).
5. Applies search (ILIKE on `name` and `email`).
6. Paginates and sorts.
7. Calls `filterRecord()` on each result -- strips fields the role cannot see.
8. Returns filtered results.

**Field visibility by role (illustrative):**

| Field | Director | Manager | Liaison | Volunteer |
|-------|----------|---------|---------|-----------|
| `name` | visible | visible | visible | visible |
| `email` | visible | visible | visible | hidden |
| `phone` | visible | visible | hidden | hidden |
| `department` | visible | visible | visible | visible |
| `role_keys` | visible | visible | visible | hidden |
| `availability` | visible | visible | visible | hidden |
| `languages` | visible | visible | visible | visible |
| `properties` | visible | visible | filtered | hidden |

These are configured via permission records in the RBAC engine, not hardcoded.

**Filter panel:**

| Filter | Type | Options |
|--------|------|---------|
| Department | Multi-select dropdown | Loaded from ontology department list |
| Role | Multi-select dropdown | Loaded from `roles` table |
| Availability | Multi-select dropdown | `available`, `limited`, `unavailable`, `on_leave` |
| Status | Single-select | `active`, `inactive`, `pending` |
| Search | Text input | Searches `name` and `email` via ILIKE |

**Export:**

The directory supports CSV export for authorized roles (typically director/manager). Export respects the same RBAC field filtering as the UI -- the CSV contains only the columns the exporting user can see.

### Acceptance Criteria

- [ ] Directory returns only staff records the requesting user's data scope allows.
- [ ] Field filtering strips fields the requesting role cannot see (via `filterRecord()`).
- [ ] Search matches against `name` and `email` using case-insensitive partial match.
- [ ] Filters on `department`, `role_keys`, `availability`, and `status` work independently and in combination.
- [ ] Pagination returns correct `total`, `page`, `pageSize`, and `totalPages` metadata.
- [ ] Sort works on `name`, `department`, `role_keys`, and `availability`.
- [ ] CSV export respects RBAC field visibility.
- [ ] Archived staff (`archived = true`) are excluded from the directory unless explicitly requested.
- [ ] The directory loads in under 500ms for up to 1,000 staff records.

---

## 5. Test Plan

### 5.1 Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| Create staff with valid fields | `{ name, email, role_keys, department }` | Row inserted, `id` returned, `status = 'active'`, `availability = 'available'` |
| Create staff with duplicate email | Same email as existing | Postgres unique constraint error, API returns 409 |
| Create staff with invalid role key | `role_keys: ['nonexistent']` | API returns 400, no row inserted |
| Create staff with invalid availability | `availability: 'vacation'` | Postgres CHECK constraint error |
| Update role_keys | `PATCH { role_keys: ['volunteer'] }` | Array updated, `staff.updated` event emitted with `changedFields: ['role_keys']` |
| Update department | `PATCH { department: 'logistics' }` | Column updated, event emitted |
| Soft delete | `PATCH { archived: true }` | Row remains, excluded from default queries |

### 5.2 RBAC Tests

| Test | Role | Action | Expected |
|------|------|--------|----------|
| Director views all staff | `director` | `GET /api/staff` | All staff returned, all fields visible |
| Volunteer views directory | `volunteer` | `GET /api/staff` | Only name, department, languages visible; email, phone stripped |
| Liaison edits own record | `liaison` | `PATCH /api/staff/:self` | Allowed for own record (relation scope) |
| Liaison edits other record | `liaison` | `PATCH /api/staff/:other` | 403 Forbidden |
| Manager assigns roles | `manager` | `PATCH { role_keys }` | Allowed (has `can_edit` on `staff`) |
| Volunteer assigns roles | `volunteer` | `PATCH { role_keys }` | 403 Forbidden |

### 5.3 Directory Tests

| Test | Input | Expected |
|------|-------|----------|
| Filter by department | `?filter[department]=guest_relations` | Only GR staff returned |
| Filter by role | `?filter[role_keys]=volunteer` | Only volunteers returned |
| Filter by availability | `?filter[availability]=available` | Only available staff returned |
| Combined filters | `?filter[department]=logistics&filter[availability]=available` | Intersection of both filters |
| Search by name | `?search=kim` | Staff with "kim" in name or email |
| Pagination | `?page=2&pageSize=10` | Correct offset, total metadata accurate |
| Sort by name | `?sort=name&order=desc` | Descending alphabetical |
| No results | `?filter[department]=nonexistent` | Empty array, `total: 0` |

### 5.4 Integration Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Auth → Staff resolution | User logs in with Firebase token | Auth middleware resolves email → staff row → role_keys → request context |
| Role change → RBAC effect | Admin changes user's role from `volunteer` to `manager` | After cache TTL, user's next request evaluates with `manager` permissions |
| Department change → scope effect | Admin moves user from `logistics` to `guest_relations` | User's data scope filter now returns GR records |
| Staff creation → event | New staff record created | `staff.created` event emitted, audit log entry written |
| Staff archival → directory | Staff record archived | No longer appears in directory queries |

### 5.5 Performance Tests

| Test | Scenario | Threshold |
|------|----------|-----------|
| Directory load | 1,000 staff, no filters | < 500ms |
| Filtered directory | 1,000 staff, 3 active filters | < 300ms |
| Search | 1,000 staff, partial name match | < 300ms |
| CSV export | 500 staff, all visible columns | < 2s |
