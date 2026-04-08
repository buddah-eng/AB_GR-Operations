# Multi-Tenancy (Department Isolation)

> One Postgres instance, one API, one event bus. Departments are tenants isolated by ontology scoping
> (org-wide vs dept-owned concepts) and RBAC (role permissions per concept per field), not by infrastructure.
> Onboarding a new department = adding ontology rows + permission records. Zero deploys.

---

## Overview

The platform serves all convention departments from a single deployment. Department isolation is achieved through two mechanisms: **ontology scoping** (concepts are either org-wide or department-owned) and **RBAC** (roles have per-concept, per-field permissions with data scoping that can restrict visibility to a department).

This is not multi-tenancy in the traditional sense (separate databases or schemas per tenant). It's logical isolation within a shared data model, which is appropriate for a single organization where cross-department visibility is a feature, not a bug — a director should be able to see guest data when planning programming.

---

## Full Specification

### 1. Ontology Scoping

**Purpose:** Define how concepts are owned at org vs department level.

**Detail:**

Every ontology record has `owner_scope` and `owner_department`:

| `owner_scope` | `owner_department` | Who can modify | Who can use |
|---|---|---|---|
| `org` | NULL | Admin only | All departments |
| `department` | `"gr"` | GR director + admin | GR staff (+ other depts if granted) |
| `department` | `"exhibits"` | Exhibits director + admin | Exhibits staff (+ others if granted) |

**Org-wide concepts** (admin-managed):
- Core shared concepts: staff, volunteer, venue, schedule_event, equipment
- Cross-department relationships
- Platform roles and permissions
- Platform-level workflows

**Department-owned concepts** (director-managed):
- Department-specific concepts: guest (GR), exhibit_booth (Exhibits), panel (Programming)
- Additional properties on shared concepts (GR director adds "liaison_notes" to staff)
- Department forms, views, and workflows
- Department-specific constraints

**The web builder enforces scoping:** A director sees only their department's concepts + org-wide concepts. They can create/edit department-owned items. They cannot modify org-wide config without admin approval (see `core/ontology-ci-qa.md`).

**Acceptance Criteria:**
- [ ] Department director can create concepts scoped to their department
- [ ] Department director cannot modify org-wide concepts
- [ ] Org-wide concepts visible to all departments
- [ ] Department concepts invisible to other departments unless explicitly shared

### 2. Department Onboarding

**Purpose:** Define the process for adding a new department.

**Detail:**

Onboarding Exhibits department:

1. **Admin creates department entry** in the departments config
2. **Admin creates department roles** (e.g., "exhibits_volunteer", "exhibits_coordinator", "exhibits_director") as ontology-defined role records
3. **Admin assigns base permissions** for department roles on org-wide concepts (e.g., exhibits_volunteer can view venues and schedule_events)
4. **Exhibits director creates department concepts** via ontology web builder:
   - `exhibit_booth`: name, location, size, type (dealer/artist), status
   - `dealer`: company, contact, products, booth assignment
5. **Exhibits director configures permissions** for department roles on department concepts
6. **Exhibits director creates forms and views** via form/view builder
7. **Exhibits director creates workflows** (e.g., dealer approved → create booth assignment → notify logistics)

**All of this is config — zero code deployed.**

**Acceptance Criteria:**
- [ ] New department operational within one admin session (no deploys)
- [ ] Department concepts have CRUD API endpoints immediately
- [ ] Department forms render in the UI immediately
- [ ] Department workflows fire on domain events immediately

### 3. Cross-Department Visibility

**Purpose:** Define how departments share data.

**Detail:**

Departments need to see each other's data in specific, controlled ways:

| Scenario | Solution |
|---|---|
| Programming needs to see GR guest list for panel planning | Programming coordinator gets `can_view` on `guest` concept with `visible_properties` limited to name, type, department |
| GR needs to see schedule for itinerary building | GR has `can_view` on `schedule_event` (org-wide concept) |
| Logistics needs to see all venue assignments | Logistics role has `can_view` on venue + booth + schedule with department scope = 'all' |
| Volunteer coordinator sees all departments' volunteer needs | Coordinator role has `can_view` on `volunteer_shift` across all departments |

Cross-department access is always **explicit and permission-based**. A department's data is never visible to another department unless an admin or the owning director grants permission via RBAC records.

**Acceptance Criteria:**
- [ ] Cross-department access requires explicit permission records
- [ ] Field-level filtering applies (Programming sees guest name, not contract details)
- [ ] Data scoping applies (department scope restricts to own department's records by default)

### 4. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Scope enforcement | Integration | Director creates concept, verify owner_scope/owner_department set correctly | Concept scoped to department |
| Scope visibility | Integration | Director A cannot see Director B's department-specific concepts in web builder | Only own + org-wide visible |
| Cross-dept access | Integration | Grant Programming read on GR guests, verify field filtering | Limited fields visible |
| Onboarding flow | E2E | Create department, roles, concepts, permissions, forms — verify operational | CRUD + forms + events working |
| Org-wide protection | Integration | Director attempts to modify org-wide concept → rejected | 403 or blocked in UI |

**Decisions/Rationale:**
- Logical isolation over physical isolation: a single database enables cross-department JOINs and analytics that separate databases would make difficult. The RBAC layer provides sufficient isolation for a single-org deployment.
