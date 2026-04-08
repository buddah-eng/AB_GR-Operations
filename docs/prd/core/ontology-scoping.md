# Ontology Scoping (Org-Wide vs Department-Owned)

> Every ontology record carries `owner_scope` ('org'|'department') and `owner_department`.
> Org-wide records are admin-only. Department records are managed by the dept director + admin.
> Scoping is enforced at the API, the web builder, and the query layer. No exceptions.
> A department can extend org-wide concepts with dept-scoped properties without touching the org definition.

---

## Overview

The ontology is one shared graph of concepts, properties, relationships, and workflows. Scoping splits that graph into two tiers: **org-wide** (platform-level, admin-governed) and **department-owned** (director-governed within a single department). Every ontology table row carries the pair (`owner_scope`, `owner_department`) defined in `data/postgres-schema.md`, and every mutation checks those columns before allowing a write.

This document specifies exactly which records belong to each tier, how the web builder filters by scope, how departments extend org-wide concepts via the property extension pattern, and how conflicts between departments are resolved. It is the detailed expansion of section 1 ("Ontology Scoping") in `platform/multi-tenancy.md`.

Scoping is a data concern, not an infrastructure concern. There is one Postgres instance, one API, one event bus. Departments are isolated by the values in these two columns and by the RBAC layer that reads them.

---

## Full Specification

### 1. Scope Model

**Purpose:** Define the ownership and mutability rules for every ontology record.

**Detail:**

Every ontology table (`ontology_concepts`, `ontology_properties`, `ontology_relationships`, `ontology_constraints`, `ontology_workflows`, `ontology_forms`, `ontology_views`) includes:

```sql
owner_scope       TEXT NOT NULL DEFAULT 'org'
                  CHECK (owner_scope IN ('org', 'department')),
owner_department  TEXT
```

Rules:

| `owner_scope` | `owner_department` | Who can create/modify | Who can read/use |
|---|---|---|---|
| `org` | `NULL` | Admin only | All departments |
| `department` | e.g. `'gr'` | GR director + admin | GR staff by default; other depts if granted via RBAC |

Invariants:
- `owner_scope = 'org'` requires `owner_department IS NULL`.
- `owner_scope = 'department'` requires `owner_department IS NOT NULL`.
- A database CHECK constraint enforces this pair (see `data/postgres-schema.md`).
- Changing `owner_scope` from `department` to `org` (promoting a concept) requires admin and triggers the CI/QA pipeline (`core/ontology-ci-qa.md`).
- Changing `owner_scope` from `org` to `department` (demoting a concept) is admin-only and rare; it narrows visibility so the pipeline validates no cross-dept dependencies break.

**Acceptance Criteria:**
- [ ] INSERT with `owner_scope = 'department'` and `owner_department IS NULL` fails at the database level
- [ ] INSERT with `owner_scope = 'org'` and `owner_department IS NOT NULL` fails at the database level
- [ ] API rejects mutation of an org-wide record when caller role is director (HTTP 403)
- [ ] API accepts mutation of a department record when caller is that department's director or an admin

---

### 2. What's Org-Wide

**Purpose:** Enumerate the classes of ontology records that belong to the org tier and explain why.

**Detail:**

Org-wide records are the shared backbone. They exist so that every department can interoperate without negotiating per-pair contracts.

| Category | Examples | Rationale |
|---|---|---|
| Core shared concepts | `staff`, `volunteer`, `venue`, `schedule_event`, `equipment` | Every department references these; inconsistent definitions would break cross-dept queries |
| Cross-department relationships | `staff` -- assigned_to -- `schedule_event`, `volunteer` -- shifts_at -- `venue` | Joining across departments requires a single source definition |
| Platform roles | `admin`, `director`, `coordinator`, `volunteer` (role records) | Roles are ontology-defined; platform-level roles must be consistent |
| Platform-level workflows | New-staff-onboarding, venue-conflict-check, schedule-publish | Workflows that span departments cannot be owned by one department |
| Shared constraints | `venue.capacity >= 0`, `schedule_event.start < schedule_event.end` | Data integrity rules on shared concepts are org-wide |

Modification rules:
- Only admin can create, update, or deprecate org-wide records.
- Changes go through the CI/QA pipeline: validate, test, review, merge.
- Department directors can **request** changes to org-wide records (creates a `pending_review` version); admin approves or rejects.

**Acceptance Criteria:**
- [ ] All core shared concepts seeded with `owner_scope = 'org'` and `owner_department IS NULL`
- [ ] Director attempt to UPDATE an org-wide concept row returns 403
- [ ] Director can submit a change request that sets `status = 'pending_review'` on a new version row
- [ ] Admin can approve the pending version, promoting it to `status = 'active'`

---

### 3. What's Department-Owned

**Purpose:** Enumerate the classes of ontology records that belong to a department and explain the boundary.

**Detail:**

Department-owned records let a director model their domain without waiting on admin or affecting other departments.

| Category | Examples | Rationale |
|---|---|---|
| Department-specific concepts | `guest` (GR), `exhibit_booth` (Exhibits), `panel` (Programming) | Only one department defines and manages these |
| Additional properties on shared concepts | GR adds `liaison_notes` to `staff` | Extension without mutation of the org definition (see section 5) |
| Department forms | GR guest intake form, Exhibits dealer application form | Each department designs its own data-entry UX |
| Department views | GR guest list view, Exhibits floor map view | Each department designs its own read UX |
| Department workflows | GR: guest-confirmed -> create-itinerary -> notify-liaison | Automations scoped to department events |
| Department constraints | GR: `guest.panel_limit <= 8` | Business rules that only apply within the department |

Modification rules:
- The department's director and any admin can create, update, or deprecate department-owned records.
- Changes still go through the CI/QA pipeline but the approval chain is shorter (director is the approver for their own department).
- A department-owned record is invisible to other departments unless explicitly shared via RBAC (see `platform/multi-tenancy.md` section 3).

**Acceptance Criteria:**
- [ ] Director can create a concept with `owner_scope = 'department'` and `owner_department` set to their department key
- [ ] Director cannot create a concept with `owner_department` set to a different department's key
- [ ] Department-owned concept automatically gets CRUD API endpoints (zero deploy)
- [ ] Department-owned concept is not visible in another department's web builder unless cross-dept permission is granted

---

### 4. Web Builder Scope Filtering

**Purpose:** Define how the ontology web builder presents scoped records to the logged-in user.

**Detail:**

The web builder is the primary UI for directors to manage ontology records. It filters what is visible and what is editable based on the user's role and department.

**Visibility rules:**

| User role | Sees org-wide records | Sees own-dept records | Sees other-dept records |
|---|---|---|---|
| Admin | Yes (read/write) | Yes (read/write) | Yes (read/write) |
| Director (`dept = 'gr'`) | Yes (read-only) | Yes (read/write) | No (unless RBAC grants read) |
| Coordinator | Yes (read-only) | Yes (read-only, unless RBAC grants write) | No |

**Query construction:**

The API endpoint backing the web builder's ontology list applies this filter:

```
WHERE owner_scope = 'org'
   OR (owner_scope = 'department' AND owner_department = :caller_department)
   OR (owner_scope = 'department' AND owner_department IN (:granted_departments))
```

`:granted_departments` is resolved from RBAC permission records that grant the caller cross-department visibility on ontology records.

**Edit guards:**

- Before any mutation, the API checks:
  1. Is the record org-wide? If yes, caller must be admin.
  2. Is the record department-owned? If yes, caller must be admin or the owning department's director.
- The web builder disables edit controls (greys out fields, hides delete button) for records the user cannot modify, so the 403 path is a safety net, not the primary UX.

**Admin approval flow for org-wide changes requested by a director:**
1. Director clicks "Request Change" on an org-wide record in the builder.
2. System creates a new version row with `status = 'pending_review'` and `changed_by = director`.
3. Admin sees the pending version in their review queue.
4. Admin approves (sets `status = 'active'`, increments `version`) or rejects (sets `status = 'rolled_back'`).

**Acceptance Criteria:**
- [ ] Director sees only org-wide + own-department records in the web builder (no other department's records unless granted)
- [ ] Edit controls are disabled on org-wide records for directors
- [ ] Director can create new department-owned concepts, properties, forms, views, workflows
- [ ] Director cannot set `owner_department` to a department other than their own
- [ ] Admin can see and edit all records regardless of scope

---

### 5. Property Extension Pattern

**Purpose:** Allow departments to add properties to org-wide concepts without modifying the org-wide definition.

**Detail:**

A common need: GR director wants a `liaison_notes` field on the `staff` concept. The `staff` concept is org-wide. The director cannot (and should not) modify it. Instead, the director creates a **department-scoped property** that references the org-wide concept.

The `ontology_properties` row looks like:

| Column | Value |
|---|---|
| `concept_key` | `staff` |
| `key` | `liaison_notes` |
| `name` | `Liaison Notes` |
| `data_type` | `text` |
| `owner_scope` | `department` |
| `owner_department` | `gr` |

This property is stored in the entity's JSONB `properties` column (not as a typed column, since it is dept-scoped and may change without schema migration).

**Visibility of extended properties:**

- GR views, forms, and API responses for `staff` entities include `liaison_notes`.
- Exhibits views, forms, and API responses for `staff` entities do **not** include `liaison_notes` unless Exhibits is explicitly granted visibility via RBAC.
- Admin views include all properties across all departments.

**Query behavior:**

When GR queries `staff`:
```
SELECT s.*, s.properties->>'liaison_notes' AS liaison_notes
FROM entities s
JOIN ontology_concepts c ON s.concept_id = c.id
WHERE c.key = 'staff'
```

The API layer includes `liaison_notes` in the response only when the caller's department is `gr` or the caller has cross-dept read permission on that property.

**Write behavior:**

When GR writes to `staff.liaison_notes`:
- The API confirms the property exists in `ontology_properties` with `owner_department = 'gr'`.
- The value is written to the entity's JSONB `properties` field.
- The property key in JSONB is stored as-is (`liaison_notes`), not namespaced, because conflict resolution is handled at the ontology layer (see section 6), not at the storage layer.

**Acceptance Criteria:**
- [ ] Director can create a property on an org-wide concept with `owner_scope = 'department'` and their department key
- [ ] The property appears in the director's department views and forms
- [ ] The property does NOT appear in other departments' views and forms (unless RBAC grants access)
- [ ] The property value is stored in the entity's JSONB `properties` column
- [ ] Admin can see all department-extended properties on any entity

---

### 6. Conflict Resolution

**Purpose:** Define how to handle two departments adding the same property key to the same concept.

**Detail:**

Scenario: GR director adds `notes` to `staff`. Exhibits director also adds `notes` to `staff`. Both are valid within their department. They must not collide.

**Resolution: composite uniqueness.**

The `ontology_properties` table enforces uniqueness on:

```sql
UNIQUE (concept_key, key, owner_department)
```

This means:
- (`staff`, `notes`, `gr`) -- GR's version
- (`staff`, `notes`, `exhibits`) -- Exhibits' version

These are two distinct property definitions. Each department sees only their version (plus org-wide properties where `owner_department IS NULL`).

**Storage in JSONB:**

The entity's JSONB `properties` column stores department-scoped values under a namespaced key internally:

```json
{
  "gr__notes": "GR's value for this staff member",
  "exhibits__notes": "Exhibits' value for this staff member"
}
```

The `{department}__{property_key}` convention is an internal storage detail. The API layer strips the namespace prefix when returning data to a caller — a GR caller sees `notes`, not `gr__notes`.

**Org-wide properties take precedence in key collisions:**

If an org-wide property `notes` exists on `staff`, departments cannot create a department-scoped property with the same key. The API rejects the attempt with a 409 Conflict. This prevents ambiguity: an org-wide `notes` must mean the same thing everywhere.

**Acceptance Criteria:**
- [ ] Two departments can each create a property with the same key on the same concept without error
- [ ] Each department sees only their version of the property in views and forms
- [ ] JSONB storage uses `{department}__{key}` namespacing for department-scoped properties
- [ ] API strips namespace prefix in responses (caller sees `notes`, not `gr__notes`)
- [ ] Creating a department-scoped property that collides with an org-wide property key returns 409 Conflict
- [ ] Admin views show all versions with department labels (e.g., "notes (GR)", "notes (Exhibits)")

---

### 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| **Scope enforcement — org** | Integration | Admin creates org-wide concept; director attempts to modify it | Director gets 403; admin succeeds |
| **Scope enforcement — dept** | Integration | Director creates dept concept; different director attempts to modify it | Second director gets 403 |
| **Scope enforcement — DB constraint** | Unit | INSERT `owner_scope='department', owner_department=NULL` | Database CHECK constraint rejects |
| **Visibility filtering — web builder** | Integration | Director A logs in; verify they see org-wide + own dept, not Dept B | Query returns correct filtered set |
| **Visibility filtering — API** | Integration | Director A calls GET /ontology/concepts; verify response excludes Dept B | Response contains no Dept B records unless RBAC grants |
| **Property extension — create** | Integration | GR director adds `liaison_notes` to org-wide `staff` concept | Property created with `owner_scope='department', owner_department='gr'` |
| **Property extension — visibility** | Integration | Exhibits user queries `staff`; verify `liaison_notes` is absent | GR-scoped property excluded from Exhibits response |
| **Property extension — write** | Integration | GR user writes `liaison_notes` on a staff entity | Value stored in JSONB `properties`; retrievable by GR user |
| **Conflict resolution — same key** | Integration | GR and Exhibits both create `notes` on `staff` | Both succeed; stored as `gr__notes` and `exhibits__notes` |
| **Conflict resolution — org collision** | Integration | Org-wide `notes` exists on `staff`; director tries to create dept `notes` | 409 Conflict returned |
| **Conflict resolution — read** | Integration | GR user reads `staff` with both dept `notes` values stored | GR user sees only their `notes`, not Exhibits' |
| **Admin omniscience** | Integration | Admin queries `staff` with dept-extended properties | All department properties visible with department labels |
| **Scope promotion** | E2E | Admin promotes a dept concept to org-wide | `owner_scope` updated; CI/QA pipeline validates; all depts can now see it |
| **Cross-dept grant** | E2E | Admin grants Exhibits read on GR's `guest` concept | Exhibits user can view `guest` records with permitted fields |
