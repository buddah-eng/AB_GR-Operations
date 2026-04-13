# Department as Ontology Concept

> Department is a first-class ontology concept with its own table, scoping rules, templates, and lifecycle --
> not a flat text field on records. Creating a department from a template copies concepts, properties,
> relationships, view configs, form configs, workflow configs, and prep templates into department-scoped
> ownership. The department dashboard, settings page, and directory are all PageConfig-driven.

---

## Overview

Throughout the platform, "department" has been treated as a string field (`owner_department TEXT`) on ontology records and as a text column on staff records. This PRD elevates department to a first-class concept with its own table, lifecycle, configuration, and template integration.

A department is not just a label -- it is an organizational unit with a director, an assistant director, a set of ontology concepts it owns, a dashboard it controls, settings it configures, and templates it was provisioned from. The `departments` table is the source of truth for what departments exist, who leads them, and what state they are in.

This PRD also defines the department template application mechanism: when an admin creates a department from a template pack, the system creates deep copies of all template-provided ontology elements (concepts, properties, relationships, forms, views, workflows, prep templates) scoped to the new department. These copies are fully independent -- the department director can customize them without affecting the template or other departments.

**What this PRD covers:** The `departments` table, department lifecycle, template application, department dashboard, department settings, and the relationship between departments and ontology scoping.

**What this PRD does NOT cover:** Template content (that's `platform/template-library.md`). Template infrastructure (that's `platform/template-infrastructure.md`). The D0 setup flow (that's `platform/shared-services-setup.md`).

**Dependencies:**
- `core/ontology-engine.md` -- concept/property/relationship definitions
- `core/ontology-scoping.md` -- org-wide vs department ownership model
- `core/rbac-engine.md` -- role-based access to department resources
- `platform/multi-tenancy.md` -- department isolation model
- `platform/template-infrastructure.md` -- unified template system
- `api/domain-crud.md` -- CRUD for department records
- `core/audit-system.md` -- department changes are audited
- `ui/view-renderer.md` -- dashboard rendering
- `ui/dynamic-forms.md` -- settings form rendering
- `data/postgres-schema.md` -- schema conventions

---

## Full Specification

### 1. Departments Table

**Purpose:** Define the schema for departments as a first-class entity in Postgres.

**Detail:**

```sql
CREATE TABLE departments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT,
  icon                 TEXT,                  -- icon identifier (e.g., 'mdi:account-group')
  color                TEXT,                  -- hex color for canvas visualization
  director_id          UUID REFERENCES staff(id),
  assistant_director_id UUID REFERENCES staff(id),
  status               TEXT NOT NULL DEFAULT 'setup_in_progress'
                       CHECK (status IN ('setup_in_progress', 'active', 'inactive', 'archived')),
  template_source_id   UUID REFERENCES templates(id),  -- which template pack created this
  settings             JSONB NOT NULL DEFAULT '{}',
  sort_order           INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_by           UUID
);

CREATE INDEX idx_departments_status ON departments (status) WHERE status = 'active';
CREATE INDEX idx_departments_director ON departments (director_id);
```

**Column semantics:**

| Column | Purpose |
|--------|---------|
| `key` | Machine-readable identifier used in `owner_department` across all ontology tables. Immutable after creation. e.g., `gr`, `programming`, `operations` |
| `name` | Human-readable display name. Mutable. e.g., "Guest Relations" |
| `icon` | Material Design Icons identifier for canvas and navigation rendering |
| `color` | Department color for canvas visualization (`canvas/system-graph.md` section 4) |
| `director_id` | FK to staff. The user who manages this department's ontology, forms, views, and workflows |
| `assistant_director_id` | FK to staff. Shares director-level access within the department |
| `status` | Department lifecycle state |
| `template_source_id` | FK to the template pack that was applied to create this department (nullable for manually created departments) |
| `settings` | Department-specific configuration (notification preferences, default view, etc.) |
| `sort_order` | Display order in navigation and admin dashboard |

**Relationship to `owner_department`:** The `key` column in the `departments` table is the canonical source for all `owner_department` values across ontology tables. A foreign key constraint is not enforced at the database level (to avoid circular dependencies during bootstrap), but the API layer validates that any `owner_department` value matches an existing `departments.key`.

**Acceptance Criteria:**
- [ ] `departments` table exists with all specified columns and constraints
- [ ] `key` is unique and immutable after creation
- [ ] `director_id` and `assistant_director_id` reference valid staff records
- [ ] `status` CHECK constraint enforces valid lifecycle states
- [ ] API validates `owner_department` values against `departments.key`

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| DEPT-01 | Unit | Insert department with valid data | Row created with defaults |
| DEPT-02 | Unit | Insert department with duplicate key | Unique constraint violation |
| DEPT-03 | Unit | Insert department with invalid status | CHECK constraint violation |
| DEPT-04 | Integration | Set director_id to valid staff record | FK accepted |
| DEPT-05 | Integration | Set director_id to non-existent staff | FK violation |

---

### 2. Department Lifecycle

**Purpose:** Define the status transitions for a department.

**Detail:**

```
setup_in_progress → active → inactive → archived
                                 ↑          |
                                 └──────────┘
```

| Transition | Trigger | Who | Side Effects |
|-----------|---------|-----|-------------|
| `setup_in_progress` → `active` | Director accepts invitation and confirms department setup | Director or Admin | Department appears in navigation for all department members |
| `active` → `inactive` | Admin deactivates department (e.g., post-convention or department merger) | Admin only | Department hidden from navigation. Data preserved. Members see "Department is currently inactive." |
| `inactive` → `active` | Admin reactivates department | Admin only | Department reappears in navigation |
| `inactive` → `archived` | Admin archives department (permanent, typically end of convention year) | Admin only | Data preserved for audit/analytics. No writes permitted. Members see "Department is archived." |
| `archived` → `inactive` | Admin un-archives department | Admin only | Rare -- only for accidental archival |

**Write protection:** When a department is `inactive` or `archived`, writes to department-scoped ontology records and domain data are rejected by the API with HTTP 409 ("Department is not active"). Reads remain permitted for all statuses.

**Event emission:** Every status transition emits a `department.status_changed` domain event with `{ department_key, old_status, new_status, changed_by }`.

**Acceptance Criteria:**
- [ ] All status transitions follow the defined state machine
- [ ] Only admin can transition to inactive or archived
- [ ] Director can transition from setup_in_progress to active
- [ ] Writes to inactive/archived department data are rejected with 409
- [ ] Reads remain permitted for all department statuses
- [ ] Status transitions emit domain events

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| LC-01 | Integration | Director confirms setup → status becomes active | Status updated, navigation includes department |
| LC-02 | Integration | Admin deactivates department | Status inactive, writes rejected |
| LC-03 | Integration | Write to inactive department | 409 response |
| LC-04 | Integration | Read from archived department | Data returned normally |
| LC-05 | Integration | Non-admin attempts to archive | 403 Forbidden |

---

### 3. Department Ontology Scope

**Purpose:** Define how the departments table integrates with the existing ontology scoping model.

**Detail:**

The `departments` table replaces ad-hoc department key references throughout the system. The `owner_department` field on ontology tables now references a row in `departments`:

**Before (flat text):**
```sql
-- Any string could appear here, no validation
INSERT INTO ontology_concepts (key, name, owner_scope, owner_department)
VALUES ('guest', 'Guest', 'department', 'gr');
```

**After (validated against departments):**
```sql
-- API validates that 'gr' exists in departments.key before INSERT
INSERT INTO ontology_concepts (key, name, owner_scope, owner_department)
VALUES ('guest', 'Guest', 'department', 'gr');
```

The schema does not change (owner_department remains TEXT for simplicity), but the API layer now validates against the departments table.

**Department-specific ontology queries:**

```sql
-- Get all concepts owned by a department
SELECT * FROM ontology_concepts
WHERE owner_scope = 'department' AND owner_department = :dept_key;

-- Get all concepts visible to a department (own + org-wide)
SELECT * FROM ontology_concepts
WHERE owner_scope = 'org'
   OR (owner_scope = 'department' AND owner_department = :dept_key);
```

**Department directory endpoint:**

```
GET /api/departments                  -- list all departments (admin sees all, others see active only)
GET /api/departments/:key             -- get single department with metadata
GET /api/departments/:key/ontology    -- get all ontology elements owned by this department
GET /api/departments/:key/members     -- get all staff in this department
GET /api/departments/:key/stats       -- get department statistics (concept count, record count, member count)
```

**Acceptance Criteria:**
- [ ] API validates owner_department against departments.key on all ontology writes
- [ ] Invalid owner_department values rejected with 400
- [ ] Department directory endpoints return correctly scoped data
- [ ] /ontology endpoint returns only department-owned concepts
- [ ] /members endpoint returns only staff in that department
- [ ] /stats endpoint returns accurate counts

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SCOPE-01 | Integration | Create concept with valid owner_department | Accepted |
| SCOPE-02 | Integration | Create concept with non-existent owner_department | 400 error |
| SCOPE-03 | Integration | GET /departments/gr/ontology | Returns only GR-owned concepts |
| SCOPE-04 | Integration | GET /departments/gr/members | Returns only GR staff |
| SCOPE-05 | Integration | GET /departments as non-admin | Returns only active departments |

---

### 4. Template Application (Deep Copy)

**Purpose:** Define how creating a department from a template produces independent, department-scoped copies of all template content.

**Detail:**

When an admin selects a department template pack and clicks "Create Department," the system performs a deep copy of all template content into department-scoped ownership. This is a transactional operation -- either all elements are created or none are.

**Copy process:**

```
Template Pack (read-only source)
  ├── Concepts      → copy with owner_department = new_dept_key
  ├── Properties    → copy with owner_department = new_dept_key, concept_key updated
  ├── Relationships → copy with owner_department = new_dept_key, source/target keys updated
  ├── FormConfigs   → copy with owner_department = new_dept_key
  ├── ViewConfigs   → copy with owner_department = new_dept_key
  ├── PageConfigs   → copy with owner_department = new_dept_key
  ├── WorkflowConfigs → copy with owner_department = new_dept_key
  └── Prep Templates  → copy with owner_department = new_dept_key
```

**Key remapping:** Template content uses placeholder keys (e.g., `tpl_guest`, `tpl_prep_item`). During copy, these are remapped to department-prefixed keys (e.g., `gr_guest`, `gr_prep_item`) to avoid collisions with other departments created from the same template. The remapping table is stored in `departments.settings.key_remap` for traceability.

**Reference integrity:** Internal references within the copied elements (e.g., a workflow that references a concept key, a form config that references property keys, a relationship that references concept keys) are updated to use the remapped keys.

**Copy isolation:** Copies are fully independent of the template source. Changes to the template do not propagate to existing departments. Changes to department copies do not affect the template.

**API:**
```
POST /api/departments
Body: {
  key: "gr",
  name: "Guest Relations",
  template_id: "uuid-of-gr-template-pack",
  customizations: {
    name: "Guest Services",        // optional name override
    exclude: ["prep_templates"]    // optional component exclusion
  }
}
```

**Response includes:**
- The created department record
- A summary of what was copied: `{ concepts: 8, properties: 42, relationships: 12, forms: 5, views: 8, workflows: 6 }`

**Acceptance Criteria:**
- [ ] Template application creates deep copies (not references) of all elements
- [ ] All copies have `owner_scope = 'department'` and `owner_department` set to the new department key
- [ ] Placeholder keys are remapped to department-prefixed keys
- [ ] Internal references are updated with remapped keys
- [ ] Template application is transactional (all-or-nothing)
- [ ] Copy summary returned in API response
- [ ] Changes to the template do not affect existing departments
- [ ] Changes to department copies do not affect the template

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| COPY-01 | Integration | Apply GR template to create department | All elements copied with correct scoping |
| COPY-02 | Integration | Verify key remapping | Template key `tpl_guest` becomes `gr_guest` |
| COPY-03 | Integration | Verify reference integrity | Workflow referencing `tpl_guest` now references `gr_guest` |
| COPY-04 | Integration | Modify template after copy | Department copy unchanged |
| COPY-05 | Integration | Modify department copy | Template unchanged |
| COPY-06 | Integration | Apply same template to two departments | No key collisions, independent copies |
| COPY-07 | Integration | Template application with exclusions | Excluded components not copied |
| COPY-08 | Integration | Template application failure mid-copy | Transaction rolls back, no partial state |

---

### 5. Department Dashboard

**Purpose:** Define the department-level dashboard as a config-driven page.

**Detail:**

Every department has a dashboard at `/departments/:key/dashboard`. The dashboard is rendered by the PageConfig system (`ui/view-renderer.md` dashboard type) -- it is NOT a hardcoded Vue component.

**Default dashboard PageConfig (auto-generated on department creation):**

```json
{
  "pageType": "dashboard",
  "title": "{{department.name}} Dashboard",
  "department": "{{department.key}}",
  "widgets": [
    {
      "type": "stat_card",
      "title": "Total Records",
      "query": { "concept": "*", "aggregate": "count" },
      "span": 3
    },
    {
      "type": "stat_card",
      "title": "Active Staff",
      "query": { "concept": "staff", "filter": { "department": "{{department.key}}", "status": "active" }, "aggregate": "count" },
      "span": 3
    },
    {
      "type": "recent_activity",
      "title": "Recent Changes",
      "limit": 10,
      "span": 6
    },
    {
      "type": "concept_list",
      "title": "Quick Access",
      "concepts": "auto",
      "span": 12
    }
  ]
}
```

**Customization:** The department director can customize the dashboard through the page builder (drag-drop widget arrangement, add/remove widgets, configure widget queries). All changes are saved as PageConfig updates to Postgres.

**Template dashboards:** Department templates can include a pre-configured dashboard PageConfig that is more specific than the default (e.g., the GR template dashboard includes a "Guest Status Overview" widget and a "Prep Completion %" widget).

**Acceptance Criteria:**
- [ ] Every department has a dashboard page rendered from PageConfig
- [ ] Default dashboard is auto-generated on department creation
- [ ] Dashboard widgets display accurate, real-time data
- [ ] Director can customize the dashboard via the page builder
- [ ] Template-provided dashboards override the default
- [ ] Dashboard is department-scoped (shows only that department's data)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| DASH-01 | Integration | Create department → verify dashboard exists | PageConfig created, page renders |
| DASH-02 | Integration | Dashboard stat_card widget accuracy | Count matches actual record count |
| DASH-03 | Integration | Director customizes dashboard | PageConfig updated, new layout renders |
| DASH-04 | Integration | Department from template with custom dashboard | Template dashboard rendered, not default |
| DASH-05 | Integration | Dashboard shows only department-scoped data | No cross-department data leakage |

---

### 6. Department Settings Page

**Purpose:** Define the department-specific settings page.

**Detail:**

Each department has a settings page at `/departments/:key/settings`, accessible to the director and admin. The settings page is rendered from a FormConfig (config-driven, not hardcoded).

**Settings stored in `departments.settings` JSONB:**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `notification_preference` | select | `immediate` | How department members receive notifications |
| `default_view_type` | select | `table` | Default view type for new concept pages |
| `auto_assign_prep` | boolean | `true` | Auto-create prep checklists when records are created |
| `require_director_approval` | boolean | `false` | Require director sign-off on high-risk ontology changes |
| `custom_fields` | JSONB | `{}` | Department-specific metadata fields |

**Department branding (within org branding):**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `department_color` | color | (assigned from palette) | Department accent color for UI elements |
| `department_icon` | icon_picker | (from template or default) | Icon for navigation and canvas |

**Director management:**

The settings page also displays (read-only for directors, editable for admin):
- Current director and assistant director
- Department member count
- Department creation date and template source
- Department status

**Acceptance Criteria:**
- [ ] Settings page rendered from FormConfig (not hardcoded)
- [ ] Settings stored in departments.settings JSONB
- [ ] Director can edit department settings
- [ ] Admin can edit all department settings plus director assignment
- [ ] Settings changes are audited

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SETTINGS-01 | Integration | Director changes notification preference | Setting saved, reflected in notification behavior |
| SETTINGS-02 | Integration | Non-director attempts to edit settings | 403 Forbidden |
| SETTINGS-03 | Integration | Admin changes director assignment | director_id updated, new director gains access |
| SETTINGS-04 | Integration | Settings page renders from FormConfig | No hardcoded form elements |

---

### 7. Department Navigation

**Purpose:** Define how departments appear in the platform's navigation structure.

**Detail:**

The platform navigation is a sidebar with department grouping:

```
[Organization Logo]

Shared Services
  ├── Org Dashboard
  ├── User Management
  ├── Template Library
  └── Settings

──────────────────

Guest Relations          [icon] [color dot]
  ├── Dashboard
  ├── [Concept pages...]
  ├── Builder
  ├── Canvas
  └── Settings

Programming              [icon] [color dot]
  ├── Dashboard
  ├── [Concept pages...]
  ├── Builder
  ├── Canvas
  └── Settings

[+ Add Department]       (admin only)
```

**Navigation scoping:** Each user sees only the departments they are a member of (or have cross-department access to), plus the "Shared Services" section if they are admin. Department ordering follows `departments.sort_order`.

**Navigation data source:** The navigation structure is derived from:
1. `departments` table (which departments exist)
2. `staff.department` (which department the user belongs to)
3. RBAC screen access records (which pages the user can see)
4. PageConfig records (what pages exist per department)

**Acceptance Criteria:**
- [ ] Navigation shows only departments the user has access to
- [ ] Admin sees all departments plus Shared Services
- [ ] Department ordering follows sort_order
- [ ] Concept pages are auto-listed under each department based on PageConfig
- [ ] "Add Department" button visible only to admin

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| NAV-01 | Integration | GR director sees navigation | GR department listed with pages, no other departments |
| NAV-02 | Integration | Admin sees navigation | All departments + Shared Services listed |
| NAV-03 | Integration | Create new department | Navigation updates to include new department |
| NAV-04 | Integration | Deactivate department | Department removed from non-admin navigation |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `core/ontology-engine.md` | Department-owned concepts are ontology records |
| `core/ontology-scoping.md` | owner_department values validated against departments table |
| `core/rbac-engine.md` | Director/assistant-director role permissions per department |
| `platform/multi-tenancy.md` | Department isolation is the multi-tenancy model |
| `platform/template-infrastructure.md` | Template packs are applied to create departments |
| `platform/template-library.md` | Template content defines what a department starts with |
| `api/domain-crud.md` | Department CRUD endpoints |
| `core/audit-system.md` | Department lifecycle changes audited |
| `ui/view-renderer.md` | Dashboard widget rendering |
| `ui/dynamic-forms.md` | Settings form rendering |
| `shared-services/staff-management.md` | Director/member references |
| `canvas/system-graph.md` | Department regions on canvas use department color/icon |
| `platform/branding.md` | Department colors within org branding system |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Separate `departments` table rather than an ontology concept | Departments are structural -- they define the scoping boundary for ontology itself. Making them a regular ontology concept would create a circular dependency (ontology scoping depends on departments, which would depend on ontology). A dedicated table keeps the hierarchy clean. |
| `owner_department` remains TEXT, validated by API | Changing to a FK would require adding the `departments` table to every ontology table's FK graph, creating complex migration ordering. API-level validation achieves the same integrity with simpler schema evolution. |
| Deep copy (not references) for template application | References would create coupling: modifying the template would change all departments. Deep copies give each department full independence to customize. The cost is storage -- negligible for config data. |
| Key remapping with department prefix | Without remapping, two departments created from the same template would have identical concept keys, violating uniqueness. Prefixing with the department key guarantees uniqueness while preserving readability. |
| Dashboard as PageConfig, not hardcoded component | Consistent with the platform thesis: the source code is the engine, the database is the application. Department dashboards are config-driven so directors can customize them. |
| Settings page as FormConfig | Same principle. Department settings are a form rendered from config. If a new setting is needed, add a property to the FormConfig -- no code deployment required. |
