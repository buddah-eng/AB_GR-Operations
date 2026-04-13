# Shared Services Setup (D0 Bootstrap)

> The Day Zero flow for shared services / sysadmin teams to bootstrap a new convention from scratch.
> Organization creation, department provisioning from templates, role hierarchy setup, user invitation,
> and org-wide settings -- all through the platform UI in under 30 minutes by a non-developer.

---

## Overview

Before any department leader touches the platform, a shared services team must set up the organizational skeleton: the convention itself (name, year, dates, venues), the departments that compose it, the role hierarchy that governs access, and the initial user accounts that staff the leadership. This is Day Zero (D0) -- the bootstrap phase that transforms an empty platform deployment into a configured organization ready for department-level customization.

The D0 flow is a guided, multi-step setup wizard accessible only to the first authenticated user (who automatically receives the `admin` role) or to any user with the `admin` role thereafter. It walks through organization creation, department provisioning from the template library (`platform/template-library.md`), role hierarchy definition, user invitation, and org-wide settings configuration.

The setup wizard writes all configuration to Postgres via the standard API layer -- the same endpoints that the builder and canvas use. Every write goes through the full pipeline (auth, RBAC, audit, validation, event emission). The wizard is a convenience layer, not a bypass.

**What this PRD covers:** The D0 bootstrap flow, the setup wizard UI, the admin control plane for managing the organization post-setup, and the "under 30 minutes" acceptance gate.

**What this PRD does NOT cover:** Individual department customization (that's Layer 2 -- department leaders using builders, canvas, and templates). Template content (that's `platform/template-library.md`). Template infrastructure (that's `platform/template-infrastructure.md`).

**Dependencies:**
- `core/auth-system.md` -- first user authentication, admin role assignment
- `core/rbac-engine.md` -- role hierarchy, permission assignment
- `core/ontology-engine.md` -- concept/property/relationship creation
- `core/ontology-scoping.md` -- org-wide vs department-owned scoping
- `platform/multi-tenancy.md` -- department isolation model
- `platform/template-infrastructure.md` -- template storage and application
- `platform/template-library.md` -- browsable template packs
- `shared-services/staff-management.md` -- user/staff record creation
- `api/domain-crud.md` -- all writes go through domain CRUD
- `core/audit-system.md` -- all setup actions are audited
- `platform/branding.md` -- org-wide branding configuration

---

## Full Specification

### 1. First-User Bootstrap

**Purpose:** Define how the very first user to access a fresh deployment becomes the organization admin and enters the setup wizard.

**Detail:**

When a fresh deployment has zero rows in the `staff` table, the platform enters bootstrap mode:

1. The first user authenticates via Firebase OAuth (`core/auth-system.md`).
2. The platform detects `SELECT count(*) FROM staff` returns 0.
3. The user is automatically assigned the `admin` role and a staff record is created:
   ```sql
   INSERT INTO staff (name, email, role_keys, department, status)
   VALUES (:name, :email, ARRAY['admin'], 'shared_services', 'active');
   ```
4. The user is redirected to the setup wizard at `/setup`.
5. Bootstrap mode is a one-time event. Once the first staff record exists, subsequent users authenticate normally and must be invited.

**Security considerations:**
- Bootstrap mode is only active when `staff` count is zero. Once any staff record exists, the bootstrap path is permanently closed.
- The bootstrap check happens server-side in the auth middleware, not client-side.
- If the deployment is pre-seeded with staff records (e.g., from a template import), bootstrap mode never activates.

**Acceptance Criteria:**
- [ ] First authenticated user on a fresh deployment automatically receives `admin` role
- [ ] First user is redirected to `/setup` wizard
- [ ] Bootstrap mode is inactive once any staff record exists
- [ ] Bootstrap check is server-side (cannot be triggered by client manipulation)
- [ ] Staff record created with `department = 'shared_services'`

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| BS-01 | Integration | First user authenticates on empty DB | Admin role assigned, redirected to /setup |
| BS-02 | Integration | Second user authenticates after first user exists | Normal auth flow, no bootstrap |
| BS-03 | Integration | Attempt to access /setup without admin role | 403 Forbidden |
| BS-04 | Unit | Bootstrap check with 0 staff rows | Returns true |
| BS-05 | Unit | Bootstrap check with 1+ staff rows | Returns false |

---

### 2. Organization Creation

**Purpose:** Define the first step of the setup wizard -- creating the convention organization.

**Detail:**

Step 1 of the setup wizard collects organization-level information:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Convention Name | text | Yes | e.g., "Anime Boston" |
| Convention Year | number | Yes | e.g., 2026 |
| Convention Start Date | date | Yes | First day of the convention |
| Convention End Date | date | Yes | Last day of the convention |
| Planning Start Date | date | No | When planning begins (typically 12-14 months before) |
| Primary Venue | text | Yes | e.g., "Hynes Convention Center" |
| Secondary Venues | text[] | No | Additional venues |
| Organization Website | url | No | Public website URL |
| Timezone | select | Yes | IANA timezone (default: America/New_York) |

This data is stored in an `organization` table:

```sql
CREATE TABLE organization (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  year            INTEGER NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  planning_start  DATE,
  primary_venue   TEXT NOT NULL,
  secondary_venues TEXT[] NOT NULL DEFAULT '{}',
  website         TEXT,
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',
  branding        JSONB NOT NULL DEFAULT '{}',
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation:**
- `end_date > start_date`
- `planning_start < start_date` (if provided)
- `year` matches the year of `start_date`
- Timezone must be a valid IANA timezone identifier

**Acceptance Criteria:**
- [ ] Organization record created with all required fields
- [ ] Date validation enforced (end > start, planning < start)
- [ ] Timezone stored as IANA identifier
- [ ] Organization data accessible via `GET /api/organization`
- [ ] Organization update via `PUT /api/organization` (admin only)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| ORG-01 | Integration | Create organization with valid data | Record created, 201 response |
| ORG-02 | Unit | end_date before start_date | Validation error |
| ORG-03 | Unit | Invalid timezone | Validation error |
| ORG-04 | Integration | Non-admin attempts to create organization | 403 Forbidden |
| ORG-05 | Integration | Update organization settings | Updated, audit trail created |

---

### 3. Department Provisioning

**Purpose:** Define how the admin creates departments from templates during setup.

**Detail:**

Step 2 of the setup wizard presents the template library (`platform/template-library.md`) and lets the admin select which departments to create. The flow:

1. **Browse templates:** The wizard displays available department template packs with previews (see `platform/template-library.md` for template browser UX).
2. **Select departments:** Admin checks the departments they want to create. Common selections for a convention:
   - Guest Relations
   - Programming
   - Operations
   - Registration
   - Vendor Relations / Exhibits
   - A/V & Tech
3. **Customize before applying:** For each selected department, the admin can:
   - Edit the department name (e.g., "Guest Relations" -> "Guest Services")
   - Preview what concepts, forms, views, and workflows the template will create
   - Deselect specific template components they don't need
4. **Apply templates:** Clicking "Create Departments" triggers `POST /api/templates/:id/apply` for each selected template pack. This creates:
   - A row in the `departments` table (`core/department-as-concept.md`)
   - Department-scoped ontology concepts, properties, and relationships
   - Department-scoped form configs, view configs, and page configs
   - Department-scoped workflow configs
   - Department-scoped prep templates (if applicable)

**Manual department creation:** The admin can also create a department from scratch (no template) by clicking "Create Blank Department." This creates only the `departments` table row and org-wide default concepts. The department leader then builds everything in the builder/canvas.

**Post-creation state:** After department provisioning, each department has:
- A row in `departments` with status `setup_in_progress`
- All template-provided ontology elements with `owner_scope = 'department'`
- Default forms, views, and pages (auto-generated per `ui/builder-to-operator.md` section 3)
- No assigned director yet (that happens in step 4)

**Acceptance Criteria:**
- [ ] Template library is browsable within the setup wizard
- [ ] Admin can select multiple departments for batch creation
- [ ] Template application creates all ontology elements scoped to the department
- [ ] Admin can customize department name before applying template
- [ ] Blank department creation produces a valid but empty department
- [ ] Each department gets a status of `setup_in_progress` after creation
- [ ] Template application goes through the full write pipeline (audit, events)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| DEPT-01 | Integration | Apply "Guest Relations" template pack | Department created with all GR concepts, forms, views, workflows |
| DEPT-02 | Integration | Create blank department | Department row created, no template-specific ontology |
| DEPT-03 | Integration | Apply 3 templates in batch | All 3 departments created with correct scoping |
| DEPT-04 | Integration | Customize department name before apply | Department created with custom name, template content intact |
| DEPT-05 | Integration | Template application audit trail | All created records appear in audit log with change_set grouping |

---

### 4. Role Hierarchy Setup

**Purpose:** Define how the admin configures the role hierarchy during setup.

**Detail:**

Step 3 of the setup wizard presents the role hierarchy editor. The platform ships with default roles (seeded in the `roles` table per `core/rbac-engine.md`):

| Default Role | Priority | is_operational | Description |
|-------------|----------|----------------|-------------|
| `admin` | 1 | false | Shared services / sysadmin. Full platform access. |
| `director` | 10 | true | Department head. Full access within their department. |
| `assistant_director` | 15 | true | Department second-in-command. Same access as director within department scope. |
| `department_head` | 80 | true | Sub-department lead. Department-scoped access. |
| `coordinator` | 20 | true | Team lead within a department. |
| `liaison` | 30 | true | Assigned to specific records (e.g., guest liaison). |
| `interpreter` | 40 | true | Language interpreter. Read-only access to relevant concepts. |
| `volunteer` | 50 | true | General volunteer. Limited access. |
| `viewer` | 100 | false | Read-only access. |

**Canonical role list (8 operational + 1 platform):** The `admin` role is platform-level (shared services team). The `director` role is department-level (full department access). `assistant_director` mirrors director permissions within department scope. `department_head` is the role at priority 80 that earlier PRD drafts referred to as `manager` -- same priority level, same scope. This list must remain consistent with `core/rbac-completion.md` which seeds the full permission matrix.

The admin can:
- **Add roles:** Create new role records (e.g., `driver`, `stage_manager`).
- **Edit roles:** Change name, description, priority order.
- **Remove default roles:** Delete roles that don't apply to this convention.
- **Set permissions:** For each role, define default permissions on org-wide concepts. Department-specific permissions are configured by department leaders later.

The role editor uses the same interface as the ontology web builder's role management section (`core/ontology-web-builder.md`), embedded within the setup wizard context.

**Admin role is immutable:** The `admin` role cannot be deleted, renamed, or have its priority changed. It is the root of the hierarchy.

**Acceptance Criteria:**
- [ ] Default roles are pre-seeded and displayed in the wizard
- [ ] Admin can add, edit, reorder, and remove roles
- [ ] Admin role cannot be deleted or demoted
- [ ] Role changes go through the full write pipeline
- [ ] Permissions editor allows setting CRUD + field visibility per role per org-wide concept

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| ROLE-01 | Integration | Add custom role "interpreter" | Role created in roles table with correct priority |
| ROLE-02 | Integration | Attempt to delete admin role | Rejected with clear error message |
| ROLE-03 | Integration | Reorder roles by priority | Priority values updated, RBAC cache refreshed |
| ROLE-04 | Integration | Set permissions for "coordinator" on "staff" concept | Permission record created |
| ROLE-05 | Unit | Role priority conflict resolution | Lowest priority number wins for multi-role users |

---

### 5. User Invitation and Role Assignment

**Purpose:** Define how the admin invites users and assigns them to departments and roles during setup.

**Detail:**

Step 4 of the setup wizard is the user invitation flow:

1. **Invite by email:** Admin enters email addresses (one per line or comma-separated) for each role/department combination.
2. **Assignment matrix:** A table showing departments as columns and roles as rows. Admin drags email addresses into cells to assign role+department.
3. **Invitation dispatch:** For each invited user, the system:
   - Creates a staff record with `status = 'pending'` and the assigned `role_keys` and `department`
   - Generates a one-time invitation link (scoped token per `core/auth-system.md` section on token-scoped auth)
   - Sends an invitation email via the notification system (`data-infrastructure/notifications.md`)
4. **Invitation acceptance:** When an invited user clicks the link:
   - They authenticate via Firebase OAuth
   - Their email is matched to the pending staff record
   - Status changes to `active`
   - They are redirected to their department dashboard

**Director assignment:** When a user is assigned the `director` role for a department, the `departments` table row is updated with `director_id`. When assigned `assistant_director`, the `assistant_director_id` is updated. A department can have at most one director and one assistant director.

**Bulk invitation:** The admin can upload a CSV file with columns: `name, email, department, role`. The system validates all rows before creating any records (atomic batch).

**Acceptance Criteria:**
- [ ] Admin can invite users by email with role and department assignment
- [ ] Invitation creates a pending staff record
- [ ] Invitation email contains a one-time link
- [ ] Accepting the invitation activates the staff record
- [ ] Director assignment updates the departments table
- [ ] Bulk CSV import validates all rows before creating records
- [ ] Invitation links expire after 7 days

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| INV-01 | Integration | Invite user as GR director | Staff record created, department.director_id updated |
| INV-02 | Integration | Accept invitation via link | Staff status changes to active |
| INV-03 | Integration | Expired invitation link | Rejected with clear message |
| INV-04 | Integration | Bulk CSV import with 10 users | All 10 records created in correct departments |
| INV-05 | Integration | CSV with invalid email | Entire batch rejected with per-row error details |
| INV-06 | Integration | Duplicate email invitation | Rejected with "user already invited" message |

---

### 6. Org-Wide Settings

**Purpose:** Define the organization-level settings configured during setup and editable afterward.

**Detail:**

Step 5 (final step) of the setup wizard presents org-wide settings. These are stored in the `organization.settings` JSONB column:

**Branding:**
- Convention logo upload
- Primary and secondary colors (integrated with `platform/branding.md`)
- Font selection from approved list

**Communication:**
- Default notification channels (email, in-app, or both)
- Email sender name and reply-to address
- Digest mode preference (immediate, hourly, daily)

**Scheduling:**
- Convention timezone (set in step 1, editable here)
- Working hours for planning phase (e.g., 9am-6pm for scheduling constraints)
- Event time slot granularity (15min, 30min, 1hr)

**Security:**
- Session timeout duration (default: 8 hours)
- API key auto-expiration (default: 90 days)
- Invitation link expiration (default: 7 days)

**Data:**
- Year-over-year registry enabled (default: true, per `data/yoy-registry.md`)
- Nightly backup schedule (default: 2am local time, per `data/versioning-backups.md`)
- Data retention policy (default: 3 years)

All settings have sensible defaults. The admin can skip this step and configure later via the admin dashboard (`platform/org-admin-dashboard.md`).

**Acceptance Criteria:**
- [ ] All settings have sensible defaults (skip-safe)
- [ ] Branding changes are reflected immediately across the platform
- [ ] Settings are stored in the organization.settings JSONB column
- [ ] Settings are editable post-setup via the admin dashboard
- [ ] Settings changes are audited

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SET-01 | Integration | Skip settings step entirely | Defaults applied, platform functional |
| SET-02 | Integration | Change primary brand color | All UI components reflect new color |
| SET-03 | Integration | Set notification preference to daily digest | Notifications batch according to preference |
| SET-04 | Integration | Update timezone after setup | All date displays update to new timezone |
| SET-05 | Integration | Non-admin attempts to modify org settings | 403 Forbidden |

---

### 7. Setup Wizard UX

**Purpose:** Define the wizard interaction model, progress tracking, and re-entry behavior.

**Detail:**

**Wizard structure:**
1. Organization Details (required)
2. Departments (required -- at least one)
3. Roles (optional -- defaults are usable)
4. Invite Team (optional -- can invite later)
5. Settings (optional -- defaults apply)

**Progress persistence:** Wizard progress is saved to the `organization.settings` JSONB under a `setup_progress` key after each step. If the admin leaves and returns, the wizard resumes at the last incomplete step.

**Completion:** When the admin clicks "Finish Setup" on the final step (or any step after steps 1-2 are complete), the `organization.settings.setup_complete` flag is set to `true`. The admin is redirected to the org admin dashboard (`platform/org-admin-dashboard.md`).

**Re-entry:** After setup is complete, the admin can access any setup section from the admin dashboard settings page. The wizard is not shown again, but all the same forms are available as individual settings pages.

**Estimated time:** The wizard is designed to complete in under 30 minutes for a standard 6-department convention with 10-15 initial users. Timer shown in the wizard footer for the admin's awareness.

**Acceptance Criteria:**
- [ ] Wizard saves progress after each step
- [ ] Wizard resumes at last incomplete step on re-entry
- [ ] Steps 1-2 are required before "Finish Setup" is available
- [ ] Steps 3-5 can be skipped with defaults
- [ ] "Finish Setup" sets the setup_complete flag and redirects to admin dashboard
- [ ] A standard 6-department setup completes in under 30 minutes
- [ ] All wizard steps are accessible post-setup via admin dashboard settings

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| WIZ-01 | E2E | Complete full wizard (6 departments, default roles, 10 invitations) | Under 30 minutes, all data in Postgres |
| WIZ-02 | Integration | Leave wizard after step 2, return | Wizard resumes at step 3 |
| WIZ-03 | Integration | Attempt "Finish Setup" before step 2 | Button disabled |
| WIZ-04 | Integration | Skip steps 3-5 and finish | Defaults applied, platform functional |
| WIZ-05 | E2E | Post-setup, access settings from admin dashboard | All settings editable |

---

### 8. Post-Setup Lifecycle

**Purpose:** Define what happens after the initial setup is complete.

**Detail:**

After D0 bootstrap:

1. **Department directors are notified:** Each invited director receives an email with their invitation link and a brief description of what awaits them (their department's dashboard, builder, and canvas).
2. **Department status transitions:** Each department starts at `setup_in_progress`. When the director first logs in and confirms their department configuration, the status changes to `active`.
3. **Shared services team continues:** The admin retains full access to all departments, the template library, user management, and org-wide settings via the admin dashboard.
4. **Adding departments later:** New departments can be created at any time from the admin dashboard using the same template library flow. D0 is not the only opportunity.
5. **Year-over-year setup:** When a new convention year begins, the admin can create a new organization record. The YoY registry (`data/yoy-registry.md`) carries persistent data forward. Department templates from the previous year can be exported and re-imported.

**Acceptance Criteria:**
- [ ] Department directors receive invitation emails after setup
- [ ] Department status transitions from setup_in_progress to active on director first login
- [ ] New departments can be added post-setup via the admin dashboard
- [ ] YoY setup re-uses previous year's templates and registry data

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| POST-01 | Integration | Director accepts invitation and logs in | Department status changes to active |
| POST-02 | Integration | Admin creates new department after setup | Department created with template, no wizard needed |
| POST-03 | Integration | New year setup with YoY registry | Persistent records carry forward |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `core/auth-system.md` | Firebase OAuth for first user, invitation tokens |
| `core/rbac-engine.md` | Role hierarchy, permission assignment |
| `core/ontology-engine.md` | Concept creation during department provisioning |
| `core/ontology-scoping.md` | Org-wide vs department scoping for all created elements |
| `core/audit-system.md` | Every setup action is audited |
| `data/postgres-schema.md` | Base Postgres schema must exist before setup writes (organization, departments, staff, roles tables) |
| `platform/multi-tenancy.md` | Department isolation model |
| `platform/template-infrastructure.md` | Template storage, versioning, apply endpoint |
| `platform/template-library.md` | Template packs browsed during department provisioning |
| `core/department-as-concept.md` | departments table, department lifecycle |
| `shared-services/staff-management.md` | Staff record creation for invited users |
| `data-infrastructure/notifications.md` | Invitation emails |
| `platform/branding.md` | Branding settings in org-wide config |
| `platform/org-admin-dashboard.md` | Post-setup admin control center |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| First user auto-admin via bootstrap mode | A fresh deployment has no users. Someone must become admin. Auto-assigning the first authenticated user is secure (requires Firebase auth) and simple. Bootstrap mode closes permanently after first user. |
| Setup wizard writes through standard API | The wizard is a convenience UI, not a privileged bypass. Using the same API ensures audit trail, RBAC enforcement, and event emission for all setup operations. |
| Template-first department creation | Non-developers cannot build ontology from scratch. Templates provide a starting point that covers 80%+ of common needs. Blank department option exists for edge cases. |
| Under-30-minute target | Convention organizers are volunteers with limited time. If setup takes hours, adoption fails. The template-first approach makes 30 minutes realistic for 6 departments. |
| Roles are seeded, not hardcoded | Default roles are data rows that the admin can modify. The platform never references role keys except `admin` (which is immutable). This preserves the ontology-defined role principle. |
| Invitation-based user onboarding | Self-registration is inappropriate for a volunteer organization with defined role structures. Invitations ensure every user has a pre-assigned role and department. |
