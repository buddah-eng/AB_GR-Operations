# RBAC Completion

> RBAC is deny-by-default but permissions were never seeded. Only the director role has permission rows.
> Every other role (assistant_director, department_head, coordinator, liaison, interpreter, volunteer, viewer) gets 403 on every API call.
> This PRD seeds the full permission matrix, visible/editable properties per role, data scopes, screen access, and the contract tables that the contract service expects.

---

## Overview

The RBAC engine works exactly as designed: deny by default, check permission rows before every operation, filter visible/editable properties, apply data-scope WHERE clauses. The problem is that only `director` has permission rows. Every other role -- assistant_director, department_head, coordinator, liaison, interpreter, volunteer, viewer -- has zero rows in the `permissions`, `data_scopes`, or `screen_access` tables. They get 403 Forbidden on every API call.

This PRD populates the permission matrix so that all 8 roles can operate within their intended access boundaries. It covers findings L4, L7, L8, H3, H4, D1.

**Canonical role list (8 roles):** `admin`, `director`, `assistant_director`, `department_head`, `coordinator`, `liaison`, `interpreter`, `volunteer`, `viewer`. The `admin` role is platform-level (shared services team). The `director` role is department-level (full department access). `assistant_director` mirrors director permissions within department scope. `department_head` is the existing DB role (priority 80) that earlier PRD drafts called `manager` -- same priority level, same scope.

Note: The `admin` role is not listed in the permission matrix below because admin permissions are handled by the RBAC engine's admin bypass (admin has unrestricted access to all concepts, all fields, all screens).

**Dependencies:** `core/rbac-engine.md` (engine must be implemented), `platform/data-wiring.md` (ontology properties must be seeded so visible_properties references are valid)

---

## Full Specification

### 1. Full Permission Matrix (7 Roles x All Concepts)

#### Purpose

Define and seed the complete permission matrix so that every role has explicit permission rows for every concept they need to access.

#### Detail

**Permission matrix (8 roles, excluding admin which has unrestricted access):**

| Role | guest | staff | schedule_event | prep_item | pairings | venue | transport_booking | contract |
|------|-------|-------|---------------|-----------|----------|-------|-------------------|----------|
| **director** | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD |
| **assistant_director** | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD |
| **department_head** | CRUD | CRU | CRUD | CRUD | CRUD | CRU | CRU | CRU |
| **coordinator** | CRU | R | CRU | CRUD | CRU | R | CRU | R |
| **liaison** | RU | R | R | RU | R | R | R | R |
| **interpreter** | R | R | R | R | R | R | R | - |
| **volunteer** | R | R | R | RU | R | R | - | - |
| **viewer** | R | R | R | R | R | R | R | R |

Legend: C=canCreate, R=canView, U=canEdit, D=canDelete, -=no access

`assistant_director` has the same permissions as `director` but is department-scoped (see Section 4 data scopes). `department_head` maps to the existing `department_head` role in the DB (priority 80); earlier PRD drafts referred to this as `manager`.

This produces one row in the `permissions` table for each cell with any access. Cells with `-` get no row (deny by default handles them).

The seed migration inserts all permission rows in a single migration file.

#### Acceptance Criteria

- [ ] All 8 roles have permission rows for every concept they can access **(L4, L7, H3)**
- [ ] Director has full CRUD on all concepts **(L4)**
- [ ] Assistant director has full CRUD on all concepts, department-scoped **(L4)**
- [ ] Department head has CRUD/CRU per the matrix (department-scoped) **(L4, L7, H3)**
- [ ] Coordinator has CRU on guest (can create and edit guests, cannot delete) **(L7, H3)**
- [ ] Liaison has RU on guest and prep_item (can view and update status, cannot create or delete) **(L7, H3)**
- [ ] Interpreter has read-only access to relevant concepts **(L7, H3)**
- [ ] Volunteer has RU on prep_item (can view and mark items complete) **(L7, H3)**
- [ ] Viewer has read-only access to all concepts **(L7, H3)**
- [ ] Roles with no access to a concept have no permission row (deny by default) **(L4)**

---

### 2. Visible Properties Per Role

#### Purpose

Each role sees different fields. The director sees everything. The liaison sees only what they need to serve their assigned guests. The viewer sees summary fields only.

#### Detail

**visible_properties by role for the `guest` concept (representative example):**

| Role | visible_properties |
|------|-------------------|
| **director** | `[id, name, type, department, company, bio, status, email, phone, arrival_date, departure_date, dietary, autographs, notes, created_at, updated_at]` |
| **assistant_director** | `[id, name, type, department, company, bio, status, email, phone, arrival_date, departure_date, dietary, autographs, notes, created_at, updated_at]` |
| **department_head** | `[id, name, type, department, company, status, email, arrival_date, departure_date, notes]` |
| **coordinator** | `[id, name, type, department, company, status, email, arrival_date, departure_date]` |
| **liaison** | `[id, name, type, status, company, arrival_date, departure_date, dietary]` |
| **interpreter** | `[id, name, type, status, company]` |
| **volunteer** | `[id, name, type, status]` |
| **viewer** | `[id, name, type, department, status]` |

Similar matrices apply to staff, schedule_event, prep_item, pairings, venue, transport_booking, and contract concepts. The full set is defined in the seed migration.

**Key principle:** `id` is always included in visible_properties so that row references work. `status` is included for any role that needs to see record state.

#### Acceptance Criteria

- [ ] Director visible_properties includes all fields for every concept **(H3)**
- [ ] Assistant director visible_properties matches director (department-scoped) **(H3)**
- [ ] Department head visible_properties includes department-relevant fields **(H3)**
- [ ] Coordinator visible_properties is scoped to operational fields **(H3)**
- [ ] Liaison visible_properties is minimal: guest identity, status, travel dates, dietary **(H3)**
- [ ] Interpreter visible_properties is limited to identity and status **(H3)**
- [ ] Volunteer visible_properties is limited to task-relevant fields **(H3)**
- [ ] Viewer visible_properties includes summary fields only **(H3)**
- [ ] Every role's visible_properties includes `id` **(H3)**

---

### 3. Editable Properties Per Role

#### Purpose

Editable properties control which fields a role can write. A liaison can update a guest's dietary info but not their contract terms. A volunteer can mark a prep item complete but not change its title.

#### Detail

**editable_properties by role for the `guest` concept (representative example):**

| Role | editable_properties |
|------|-------------------|
| **director** | `[name, type, department, company, bio, status, email, phone, arrival_date, departure_date, dietary, autographs, notes]` |
| **assistant_director** | `[name, type, department, company, bio, status, email, phone, arrival_date, departure_date, dietary, autographs, notes]` |
| **department_head** | `[name, type, company, status, email, arrival_date, departure_date, notes]` |
| **coordinator** | `[name, type, company, status, email, arrival_date, departure_date]` |
| **liaison** | `[status, dietary, notes]` |
| **interpreter** | `[]` (read-only) |
| **volunteer** | `[]` (read-only) |
| **viewer** | `[]` (read-only) |

**For `prep_item`:**

| Role | editable_properties |
|------|-------------------|
| **director** | all fields |
| **coordinator** | `[title, status, due_date, assigned_to, notes]` |
| **liaison** | `[status, notes]` |
| **volunteer** | `[status]` |

The `filterWritePayload` method in the RBAC engine strips any fields not in the editable list before the record reaches the database.

#### Acceptance Criteria

- [ ] Director can edit all fields on all concepts **(H3)**
- [ ] Liaison editable_properties for guest is limited to `[status, dietary, notes]` **(H3)**
- [ ] Volunteer editable_properties for prep_item is limited to `[status]` **(H3)**
- [ ] Read-only roles (interpreter, viewer) have empty editable_properties **(H3)**
- [ ] `filterWritePayload` strips fields not in the editable list before database write **(H3)**

---

### 4. Data Scope Seeds

#### Purpose

Data scopes restrict which rows a role can see. Directors see everything. Coordinators see only their department's records. Liaisons see only records related to their assigned guests.

#### Detail

**Data scope seeds:**

| Role | Concept | scopeType | Configuration |
|------|---------|-----------|---------------|
| **director** | all | `all` | No restriction |
| **assistant_director** | all | `department` | `field: 'department', value: $userDepartment` |
| **department_head** | all | `department` | `field: 'department', value: $userDepartment` |
| **coordinator** | guest | `department` | `field: 'department', value: $userDepartment` |
| **coordinator** | prep_item | `department` | `field: 'department', value: $userDepartment` (via guest join) |
| **coordinator** | schedule_event | `department` | `field: 'department', value: $userDepartment` |
| **liaison** | guest | `relation` | `relationPath: 'assigned_liaison_id'` (direct column) |
| **liaison** | prep_item | `relation` | `relationPath: 'assigned_to'` (direct column) |
| **interpreter** | all | `all` | No restriction (read-only access anyway) |
| **volunteer** | prep_item | `relation` | `relationPath: 'assigned_to'` |
| **viewer** | all | `all` | No restriction (read-only access anyway) |

**Department-based scoping for coordinator:** The coordinator's data scope uses `scopeType: 'department'` with `field: 'department'`. The value is resolved at query time from the authenticated user's department assignment.

#### Acceptance Criteria

- [ ] Director data scope is `all` for every concept (no WHERE clause appended) **(H3)**
- [ ] Coordinator data scope filters by department for guest, prep_item, schedule_event **(H3)**
- [ ] Liaison data scope filters guests by `assigned_liaison_id = $userId` **(H3)**
- [ ] Volunteer data scope filters prep_items by `assigned_to = $userId` **(H3)**
- [ ] Data scope seeds are inserted in the migration alongside permission seeds **(H3)**

---

### 5. Relation-Based Data Scoping Extension

#### Purpose

The current `buildDataScopeFilter` returns simple `{ column, operator, value }` filters. But liaison-to-guest scoping through the `pairings` table requires a subquery: `WHERE id IN (SELECT guest_id FROM pairings WHERE staff_id = $uid)`. The engine can't express this today.

#### Detail

- Extend the `DataScope` interface to support a `subquery` scope type:
  ```typescript
  interface DataScope {
    // ...existing fields...
    scopeType: 'relation' | 'field' | 'department' | 'all' | 'subquery'
    subqueryTable?: string     // e.g. 'pairings'
    subqueryColumn?: string    // e.g. 'guest_id' (the column to match against the target table's id)
    subqueryFilter?: string    // e.g. 'staff_id' (the column to match against $userId)
  }
  ```
- `buildDataScopeFilter` handles the new `subquery` type by returning:
  ```typescript
  { type: 'subquery', sql: 'id IN (SELECT $subqueryColumn FROM $subqueryTable WHERE $subqueryFilter = $1)', params: [userId] }
  ```
- The query builder must handle this new filter shape alongside the existing simple filters
- This is the architectural extension needed for liaison access to guests via pairings

**Seed for liaison-guest via pairings:**
```
{ roleKey: 'liaison', conceptKey: 'guest', scopeType: 'subquery',
  subqueryTable: 'pairings', subqueryColumn: 'guest_id', subqueryFilter: 'staff_id' }
```

#### Acceptance Criteria

- [ ] `DataScope` interface supports `subquery` scope type **(L8)**
- [ ] `buildDataScopeFilter` generates a parameterized subquery for the `subquery` type **(L8)**
- [ ] Liaison accessing guests returns only guests they are paired with (via pairings join) **(L8)**
- [ ] The subquery uses parameterized values, never string interpolation **(L8)**
- [ ] Existing scope types (`relation`, `field`, `department`, `all`) continue to work unchanged **(L8)**

---

### 6. Screen Access Seeds Per Role

#### Purpose

Screen access controls which pages appear in each role's navigation. Without seeds, all pages are hidden (deny by default) or all pages are shown (if the UI defaults to showing everything when no records exist).

#### Detail

**Screen access matrix:**

| Page Slug | director | assistant_director | department_head | coordinator | liaison | interpreter | volunteer | viewer |
|-----------|----------|-------------------|-----------------|-------------|---------|-------------|-----------|--------|
| dashboard | yes | yes | yes | yes | yes | yes | yes | yes |
| guests | yes | yes | yes | yes | yes | yes | no | yes |
| staff | yes | yes | yes | no | no | no | no | yes |
| schedule | yes | yes | yes | yes | yes | yes | yes | yes |
| prep-tracker | yes | yes | yes | yes | yes | no | yes | yes |
| pairings | yes | yes | yes | yes | no | no | no | no |
| venues | yes | yes | yes | yes | no | no | no | yes |
| travel | yes | yes | yes | yes | yes | no | no | yes |
| contracts | yes | yes | yes | no | no | no | no | no |
| settings | yes | no | no | no | no | no | no | no |
| builders | yes | no | no | no | no | no | no | no |
| canvas | yes | yes | yes | no | no | no | no | no |

Insert one `screen_access` row per `(role_key, page_slug)` pair where `visible = true`.

#### Acceptance Criteria

- [ ] Screen access seeds exist for all 8 roles **(H3)**
- [ ] Director can see all pages including settings and builders **(H3)**
- [ ] Liaison sees only dashboard, guests, schedule, prep-tracker, and travel **(H3)**
- [ ] Volunteer sees only dashboard, schedule, and prep-tracker **(H3)**
- [ ] Settings page is visible only to director **(H3)**
- [ ] Pages without a screen_access row for a role are hidden from that role's navigation **(H3)**

---

### 7. Contract Tables Creation

#### Purpose

The contract service queries `contract_templates`, `contract_clauses`, and `guest_contracts` tables, but they don't exist. Contract generation workflows will fail until these tables are created.

**Architectural note:** These are **domain tables** for the contract assembly engine, NOT template storage. The unified `templates` table (defined in `platform/template-infrastructure.md`) stores reusable presets (record_set, notification, form_preset, view_preset, workflow). Contract tables are separate because contract assembly requires conditional clause inclusion per guest type, clause ordering, and per-guest rendered output tracking (draft/sent/signed/countersigned/expired) -- capabilities that go beyond simple template storage. See `platform/template-infrastructure.md` Section 6 for the full distinction.

#### Detail

**Tables to create:**

**contract_templates:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text, not null | e.g. "Standard JP Guest Contract" |
| description | text | |
| guest_type | text | Which guest type this template applies to (JP, NA, other, or null for universal) |
| content_template | text, not null | Template body with `{{variable}}` placeholders |
| version | integer, default 1 | |
| active | boolean, default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**contract_clauses:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| template_id | uuid FK | References contract_templates.id |
| clause_key | text, not null | e.g. "travel_reimbursement", "nda" |
| title | text, not null | |
| body | text, not null | Clause text with optional `{{variable}}` placeholders |
| required | boolean, default true | Whether this clause is mandatory |
| sort_order | integer | Display order within the template |

**guest_contracts:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | References guests.id |
| template_id | uuid FK | References contract_templates.id |
| rendered_content | text | The fully rendered contract with variables replaced |
| status | text, default 'draft' | draft, sent, signed, countersigned, expired |
| signed_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Seed data:**
- One template per guest type (JP, NA, other)
- Standard clauses: appearance_fee, travel_reimbursement, accommodation, nda, cancellation_policy
- JP-specific clause: interpreter_provision
- No guest_contracts seeded (these are generated by workflows at runtime)

#### Acceptance Criteria

- [ ] `contract_templates` table exists with the defined schema **(D1, H4)**
- [ ] `contract_clauses` table exists with FK to contract_templates **(D1, H4)**
- [ ] `guest_contracts` table exists with FKs to guests and contract_templates **(D1, H4)**
- [ ] At least one template per guest type is seeded **(D1, H4)**
- [ ] Standard clauses are seeded for each template **(D1, H4)**
- [ ] JP template includes interpreter_provision clause **(D1, H4)**
- [ ] Contract service can query these tables without error **(D1)**

---

## Finding Coverage Matrix

| Finding ID | Section | Description |
|------------|---------|-------------|
| L4, L7, H3 | 1 | Only director has permissions; all other roles get 403 |
| H3 | 2, 3, 4, 6 | Full permission matrix: visible/editable properties, data scopes, screen access |
| L8 | 5 | Relation-based data scoping needs subquery support (pairings join) |
| D1, H4 | 7 | Contract tables don't exist |

---

## Test Plan

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | Liaison calls GET /api/guests | 200 (not 403); returns only paired guests with restricted fields |
| T-02 | Coordinator calls GET /api/guests | 200; returns only department-scoped guests |
| T-03 | Volunteer calls GET /api/prep-items | 200; returns only assigned prep items |
| T-04 | Volunteer calls DELETE /api/prep-items/:id | 403 Forbidden (no delete permission) |
| T-05 | Viewer calls PUT /api/guests/:id | 403 Forbidden (no edit permission) |
| T-06 | Liaison calls PUT /api/guests/:id with `{name, dietary}` | 200; name stripped (not in editable_properties), dietary saved |
| T-07 | Director queries contract_templates | Returns seeded templates |
| T-08 | Liaison navigates to /settings | Page hidden from nav; direct URL access redirected |
| T-09 | Coordinator navigates to /guests | Page visible in nav; data scoped to department |
| T-10 | Subquery scope: liaison queries guests | SQL includes `IN (SELECT guest_id FROM pairings WHERE staff_id = $1)` |
| T-11 | Interpreter calls POST /api/guests | 403 (no create permission) |
| T-12 | Director calls GET /api/screen-access | Returns all pages as visible |
