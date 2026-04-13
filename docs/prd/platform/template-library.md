# Template Library

> The template CONTENT and browsing UX -- not the infrastructure. Convention operations template packs
> for Guest Relations, Programming, Operations, Vendor Relations, Registration, and A/V & Tech.
> Each pack includes ontology concepts, properties, relationships, forms, views, workflows, and prep
> templates. Browse by category, preview before applying, customize during application.

---

## Overview

The template infrastructure (`platform/template-infrastructure.md`) defines HOW templates are stored, versioned, scoped, and applied. This PRD defines WHAT templates exist and how users discover, preview, and apply them.

The template library is a browsable catalog of department template packs and individual templates. For a convention operations platform, the library ships with curated packs that represent the most common convention departments. Each pack is a complete starter kit: ontology concepts with their properties and relationships, pre-configured forms and views, workflow automations, and prep checklists. Applying a pack to a new department creates a fully functional department in minutes.

The library is accessed in two contexts:
1. **During D0 setup** (`platform/shared-services-setup.md`) -- the admin browses the library to select which departments to create.
2. **Post-setup from the admin dashboard** (`platform/org-admin-dashboard.md`) -- the admin browses to add new departments or apply individual templates to existing departments.

**What this PRD covers:** Template content (what each pack includes), the template browser UI, template preview, customization during application, and template versioning strategy.

**What this PRD does NOT cover:** Template storage and CRUD API (that's `platform/template-infrastructure.md`). The D0 setup wizard flow (that's `platform/shared-services-setup.md`). Department creation mechanics (that's `core/department-as-concept.md`).

**Dependencies:**
- `platform/template-infrastructure.md` -- storage, versioning, CRUD API, import/export
- `core/department-as-concept.md` -- template application creates departments
- `core/ontology-engine.md` -- concepts, properties, relationships
- `core/ontology-scoping.md` -- template copies are department-scoped
- `ui/dynamic-forms.md` -- form configs in template packs
- `ui/view-renderer.md` -- view configs in template packs
- `automation/workflow-engine.md` -- workflow configs in template packs
- `platform/branding.md` -- template pack visual identity

---

## Full Specification

### 1. Convention Operations Template Packs

**Purpose:** Define the curated template packs that ship with the platform for convention operations.

**Detail:**

Each template pack is a complete department starter kit stored as a collection of records in the `templates` table with a shared `category` and a `pack_id` linking them. The packs are seed data -- they are inserted during deployment, not compiled into source code.

#### 1.1 Guest Relations Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `guest`, `pairing`, `prep_item`, `transport_booking`, `flight`, `contract`, `itinerary`, `guest_event` |
| **Properties (guest)** | name, email, phone, type (JP/NA/Industry/Other), company, status, bio, photo, dietary_requirements, accessibility_needs, arrival_date, departure_date, hotel_info, notes |
| **Properties (pairing)** | guest_id, staff_id, role (liaison/interpreter/backup), status, start_date, end_date, notes |
| **Properties (prep_item)** | guest_id, name, status (incomplete/in_progress/complete), due_date, assigned_to, category, notes |
| **Properties (transport_booking)** | guest_id, type (flight/ground/hotel_shuttle), provider, pickup_time, pickup_location, dropoff_location, status, driver_id, confirmation_number |
| **Relationships** | guest has_many pairings, guest has_many prep_items, guest has_many transport_bookings, guest has_many guest_events, pairing belongs_to staff, transport_booking belongs_to flight |
| **Forms** | Guest intake wizard (4 steps), Quick edit form, Transport booking form, Prep item form |
| **Views** | Guest master list (table), Guest by status (kanban), Guest arrival timeline, Prep completion dashboard, Transport overview |
| **Workflows** | Guest confirmed → create prep checklist, Guest confirmed → notify liaison, Transport booked → sync calendar, Prep item overdue → alert director |
| **Prep templates** | JP Guest Checklist (14 items), NA Guest Checklist (8 items), Industry Guest Checklist (6 items) |

#### 1.2 Programming Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `panel`, `screening`, `workshop`, `performer`, `program_track`, `panel_request` |
| **Properties (panel)** | title, description, type (panel/qa/workshop/screening), track_id, venue_id, start_time, end_time, status, max_panelists, guest_ids, moderator_id, av_requirements, notes |
| **Properties (program_track)** | name, description, color, sort_order |
| **Relationships** | panel belongs_to program_track, panel has_many guests, panel belongs_to venue, screening belongs_to venue |
| **Forms** | Panel creation form, Panel request form (external), Screening form |
| **Views** | Program grid (timeline by venue), Panel list (table), By track (kanban), Schedule conflicts view |
| **Workflows** | Panel approved → assign venue, Panel time changed → notify panelists, Panel request submitted → notify coordinator |

#### 1.3 Operations Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `task`, `incident`, `equipment_request`, `supply_order`, `radio_assignment` |
| **Properties (task)** | title, description, priority (low/medium/high/critical), status, assigned_to, due_date, venue_id, category, notes |
| **Properties (incident)** | title, description, severity, location, reported_by, resolved_by, resolution, occurred_at, resolved_at |
| **Relationships** | task belongs_to venue, equipment_request belongs_to venue, incident belongs_to venue |
| **Forms** | Task creation form, Incident report form, Equipment request form |
| **Views** | Task board (kanban by status), Active incidents (table), Equipment requests (table) |
| **Workflows** | Critical incident → notify all directors, Task overdue → escalate, Equipment delivered → mark task complete |

#### 1.4 Vendor Relations / Exhibits Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `vendor`, `booth`, `dealer_application`, `artist_application`, `booth_assignment` |
| **Properties (vendor)** | company_name, contact_name, email, phone, type (dealer/artist/sponsor), status, booth_assignment_id, payment_status, notes |
| **Properties (booth)** | number, location, size (standard/double/corner/endcap), type (dealer/artist), status (available/assigned/reserved), price, equipment_included |
| **Relationships** | vendor has_one booth_assignment, booth_assignment belongs_to booth, dealer_application belongs_to vendor |
| **Forms** | Vendor registration form, Booth assignment form, Dealer application (external) |
| **Views** | Vendor directory (table), Floor map (custom view), Booth availability (kanban by status) |
| **Workflows** | Application approved → assign booth → notify vendor, Payment received → confirm booth, Booth conflict → alert coordinator |

#### 1.5 Registration Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `attendee`, `registration_type`, `badge`, `ticket`, `discount_code` |
| **Properties (attendee)** | name, email, registration_type_id, badge_number, check_in_status, check_in_time, payment_status, notes |
| **Properties (registration_type)** | name, price, description, capacity, available_from, available_until |
| **Relationships** | attendee belongs_to registration_type, attendee has_one badge, discount_code belongs_to registration_type |
| **Forms** | Registration form (external), Badge printing form, Check-in form |
| **Views** | Attendee list (table), Check-in dashboard, Registration stats |
| **Workflows** | Registration complete → generate badge, Check-in → update stats, Capacity reached → disable registration type |

#### 1.6 A/V & Tech Pack

| Component | Items |
|-----------|-------|
| **Concepts** | `av_setup`, `projector`, `microphone`, `tech_request`, `streaming_session` |
| **Properties (av_setup)** | venue_id, event_id, projector_needed, mic_count, recording, streaming, setup_time, teardown_time, tech_lead_id, status, notes |
| **Properties (tech_request)** | requester, department, venue_id, request_type, description, priority, status, assigned_to |
| **Relationships** | av_setup belongs_to venue, av_setup belongs_to schedule_event, tech_request belongs_to venue |
| **Forms** | AV setup form, Tech request form |
| **Views** | Setup schedule (timeline), Active requests (kanban), Equipment inventory |
| **Workflows** | Event scheduled → create AV setup, Tech request submitted → notify tech lead, Setup complete → notify requester |

**Acceptance Criteria:**
- [ ] All 6 template packs exist as seed data in the templates table
- [ ] Each pack includes concepts, properties, relationships, forms, views, and workflows
- [ ] Template content follows the platform's ontology conventions (property types, naming)
- [ ] Template packs are independently selectable (applying GR does not require Programming)
- [ ] Each pack produces a functional department when applied

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| PACK-01 | Integration | Apply each of the 6 template packs | Each creates a functional department with all components |
| PACK-02 | Integration | Apply GR pack, verify concept count | 8 concepts created |
| PACK-03 | Integration | Apply GR pack, verify workflow triggers | Workflows fire on appropriate domain events |
| PACK-04 | Integration | Apply GR pack, verify form rendering | Guest intake wizard renders with 4 steps |
| PACK-05 | Integration | Apply two packs to different departments | No key collisions, independent copies |

---

### 2. Template Browser UI

**Purpose:** Define the browsable interface for discovering and selecting templates.

**Detail:**

The template browser is a dedicated page at `/admin/templates` and is also embedded within the setup wizard (`platform/shared-services-setup.md` step 2).

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│ Template Library                          [Search...]   │
├──────────┬──────────────────────────────────────────────┤
│ Category │                                              │
│ ○ All    │  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│ ● Depts  │  │  [icon]  │  │  [icon]  │  │  [icon]  │    │
│ ○ Forms  │  │  Guest   │  │ Program  │  │  Ops     │    │
│ ○ Views  │  │ Relations│  │  -ming   │  │          │    │
│ ○ Flows  │  │          │  │          │  │          │    │
│ ○ Prep   │  │ 8 concepts│ │ 6 concepts│ │ 5 concepts│   │
│          │  │ 5 forms  │  │ 3 forms  │  │ 3 forms  │    │
│          │  │ 5 views  │  │ 4 views  │  │ 3 views  │    │
│          │  │ [Preview]│  │ [Preview]│  │ [Preview]│    │
│          │  └─────────┘  └─────────┘  └─────────┘     │
│          │                                              │
│          │  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│          │  │  [icon]  │  │  [icon]  │  │  [icon]  │    │
│          │  │ Vendor   │  │ Regist.  │  │  A/V &   │    │
│          │  │ Relations│  │          │  │  Tech    │    │
│          │  │ ...      │  │ ...      │  │ ...      │    │
│          │  └─────────┘  └─────────┘  └─────────┘     │
└──────────┴──────────────────────────────────────────────┘
```

**Categories:**
- **Department Packs:** Complete department starters (the 6 packs from section 1)
- **Forms:** Individual form templates (e.g., "Multi-Step Intake Wizard", "Quick Edit Form")
- **Views:** Individual view templates (e.g., "Kanban Board", "Timeline View", "Dashboard Layout")
- **Workflows:** Individual workflow templates (e.g., "Status Change Notification", "Overdue Alert")
- **Prep Checklists:** Prep template collections

**Search:** Full-text search across template names, descriptions, and component names. Results update as the user types (debounced 300ms).

**Filtering:** Templates can be filtered by:
- Category (sidebar)
- Component count (e.g., "packs with 5+ concepts")
- Tags (e.g., "guest management", "scheduling", "logistics")

**Acceptance Criteria:**
- [ ] Template browser displays all available template packs as cards
- [ ] Category sidebar filters templates by type
- [ ] Search filters templates by name and description
- [ ] Each card shows component counts (concepts, forms, views, workflows)
- [ ] "Preview" button opens the template preview modal

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| UI-01 | Integration | Load template browser | All 6 packs displayed as cards |
| UI-02 | Integration | Filter by "Forms" category | Only form templates shown |
| UI-03 | Integration | Search "guest" | GR pack and guest-related templates shown |
| UI-04 | Unit | Debounced search (type "gue" quickly) | Only one search request sent |
| UI-05 | Integration | Non-admin accesses template browser | 403 Forbidden |

---

### 3. Template Preview

**Purpose:** Define the preview experience that lets admins understand what a template contains before applying it.

**Detail:**

Clicking "Preview" on a template card opens a full-screen modal with a tabbed layout:

**Tab 1: Overview**
- Template name, description, author, version
- Summary stats: concept count, property count, relationship count, form count, view count, workflow count
- Visual concept map: a mini system graph showing the template's concepts and relationships (rendered using the canvas engine `canvas/canvas-engine.md` in view-only mode)

**Tab 2: Concepts & Properties**
- Expandable list of all concepts in the pack
- Each concept shows its properties with types, required flags, and descriptions
- Relationship diagram between concepts

**Tab 3: Forms**
- Preview rendering of each form config (using the dynamic form renderer `ui/dynamic-forms.md` in preview mode with sample data)
- Form name, layout type (single/two-column/wizard), field count

**Tab 4: Views**
- Preview rendering of each view config (using the view renderer `ui/view-renderer.md` in preview mode with sample data)
- View name, type (table/kanban/timeline/dashboard), column/widget count

**Tab 5: Workflows**
- List of workflow configs with trigger type, condition summary, and action chain description
- Human-readable descriptions (e.g., "When a guest is confirmed, create a prep checklist and notify the assigned liaison")

**Tab 6: Prep Templates**
- List of prep template sets with item counts
- Expandable to show individual checklist items

**Footer:**
- "Apply to New Department" button (opens the department creation flow with this template pre-selected)
- "Apply to Existing Department" dropdown (available only for individual templates, not full packs)
- "Close" button

**Acceptance Criteria:**
- [ ] Preview modal shows all template components across 6 tabs
- [ ] Concept map renders using the canvas engine in view-only mode
- [ ] Form preview renders the actual form layout with sample data
- [ ] View preview renders the actual view with sample data
- [ ] Workflow descriptions are human-readable (no raw JSON)
- [ ] "Apply" buttons are available from the preview modal

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| PRV-01 | Integration | Preview GR template pack | 6 tabs populated with correct content |
| PRV-02 | Integration | Form preview renders | Guest intake wizard shown with 4 steps and sample data |
| PRV-03 | Integration | View preview renders | Guest list table shown with sample rows |
| PRV-04 | Integration | Concept map renders | 8 concepts with relationships shown |
| PRV-05 | Integration | "Apply" from preview | Department creation flow opens with template selected |

---

### 4. Template Customization During Application

**Purpose:** Define how admins customize template content before it is applied to a new department.

**Detail:**

Between clicking "Apply" and confirming creation, the admin sees a customization step:

**Customization options:**

| Option | UI | Effect |
|--------|-----|--------|
| Department name | Text input (pre-filled from template) | Overrides the department name |
| Concept selection | Checkbox list of concepts | Unchecked concepts are excluded from the copy |
| Property editing | Expandable per-concept property list with edit buttons | Add, remove, or modify properties before copy |
| Form selection | Checkbox list of forms | Unchecked forms are excluded |
| View selection | Checkbox list of views | Unchecked views are excluded |
| Workflow selection | Checkbox list of workflows with descriptions | Unchecked workflows are excluded |
| Prep template selection | Checkbox list of prep sets | Unchecked prep templates are excluded |

**Dependency warnings:** If the admin unchecks a concept that is referenced by a workflow or form, the system shows a warning: "The 'Guest Confirmed Notification' workflow references the 'guest' concept. Removing 'guest' will also remove this workflow."

**Preview after customization:** The admin can click "Preview Changes" to see what the final department will look like after customization (updated concept map, form list, etc.).

**Confirmation:** Clicking "Create Department" shows a final summary:
```
Creating department: Guest Services
From template: Guest Relations v2.1
Including: 7 concepts, 38 properties, 10 relationships, 4 forms, 4 views, 3 workflows
Excluding: 1 concept (itinerary), 1 form (itinerary form), 1 view (itinerary view)
```

**Acceptance Criteria:**
- [ ] Admin can customize department name before applying
- [ ] Admin can exclude specific concepts, forms, views, workflows, and prep templates
- [ ] Dependency warnings appear when excluding elements with dependents
- [ ] Dependent elements are automatically excluded when their parent is excluded
- [ ] "Preview Changes" reflects the customized selection
- [ ] Final confirmation summary shows what will be created and excluded

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| CUST-01 | Integration | Exclude a concept → dependent workflows auto-excluded | Warning shown, both excluded |
| CUST-02 | Integration | Customize department name | Department created with custom name |
| CUST-03 | Integration | Add a property during customization | Property included in the created department |
| CUST-04 | Integration | Preview after customization | Updated concept map reflects changes |
| CUST-05 | Integration | Create with all defaults (no customization) | Full template applied as-is |

---

### 5. Template Versioning

**Purpose:** Define how templates evolve across convention years and how versioning is managed.

**Detail:**

Templates evolve. The GR pack for 2026 might have different concepts than the 2027 version. The template versioning strategy:

**Version numbering:** Templates use semantic versioning: `major.minor`
- **Major:** Breaking changes (concepts renamed, removed, or restructured)
- **Minor:** Additive changes (new properties, forms, views, workflows added)

**Version history:** Each template record has a `version` column and a `previous_version_id` FK. The version chain allows browsing historical versions.

**Active vs. archived versions:**
- The latest version of each template is `status = 'active'` and is displayed in the browser.
- Previous versions are `status = 'archived'` and accessible via the version history panel.
- Only active versions can be applied to new departments.

**Version comparison:**
- The template browser shows a "Compare Versions" button when multiple versions exist.
- The comparison view shows added, removed, and modified components between two versions.
- This is useful for convention teams reviewing what changed between years.

**Upgrade path:** Templates applied to departments are deep copies. There is no automatic upgrade path when a template version changes. If a department director wants to adopt changes from a newer template version, they:
1. Browse the template library and preview the new version
2. Use "Compare" to see what changed
3. Manually apply desired changes through the builder/canvas
4. Alternatively, use import/export (`platform/template-infrastructure.md` section 5) to selectively import new components

**Acceptance Criteria:**
- [ ] Templates have semantic version numbers
- [ ] Version history is browsable in the template browser
- [ ] Only active versions are displayed by default
- [ ] Version comparison shows added, removed, and modified components
- [ ] Applying a template records which version was used (in departments.template_source_id)
- [ ] No automatic upgrade propagation to existing departments

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| VER-01 | Integration | Create template version 2.0 | New version active, old version archived |
| VER-02 | Integration | Browse version history | All versions listed with dates and change summaries |
| VER-03 | Integration | Compare v1.0 and v2.0 | Diff shows added/removed/modified components |
| VER-04 | Integration | Apply v2.0 to new department | v2.0 content copied, department.template_source_id references v2.0 |
| VER-05 | Integration | Attempt to apply archived version | Blocked with message directing to active version |

---

### 6. Community Templates (Future)

**Purpose:** Define the future direction for template sharing across convention organizations.

**Detail:**

This section describes a planned capability that is NOT in scope for the initial build but establishes the architectural foundation.

**Concept:** Conventions share templates with each other through a community repository. A gaming convention might publish their "Vendor Relations" pack that anime conventions could adopt.

**Foundation (built now):**
- Template import/export format (`platform/template-infrastructure.md` section 5) is the exchange medium
- Template export produces a self-contained JSON file with no references to the source organization
- Template import works on any deployment without prerequisite data

**Future additions (not in current scope):**
- Community template registry (hosted separately)
- Publish flow: export template → submit to registry → review → publish
- Browse community registry from within the template library
- Install from community registry (essentially import with UI)
- Ratings, reviews, and usage statistics

**Acceptance Criteria (current scope only):**
- [ ] Template export format is self-contained and deployment-independent
- [ ] Template import works on a fresh deployment without errors
- [ ] No blocking architectural decisions made for community features

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| COMM-01 | Integration | Export template from deployment A, import to deployment B | Template functional on deployment B |
| COMM-02 | Integration | Export template with department-specific references | References stripped or generalized in export |

---

### 7. Template Seeding

**Purpose:** Define how template packs are seeded into the database during deployment.

**Detail:**

Template packs are seed data, not source code. They are stored as JSON files in the repository's `seeds/templates/` directory and inserted into the `templates` table during migration/deployment.

**Seed file format:**

```json
{
  "format": "gr-ops-template-pack-v1",
  "pack": {
    "name": "Guest Relations",
    "key": "guest_relations",
    "description": "Complete department starter for managing convention guests...",
    "version": "1.0",
    "icon": "mdi:account-star",
    "color": "#4A90D9"
  },
  "components": {
    "concepts": [...],
    "properties": [...],
    "relationships": [...],
    "forms": [...],
    "views": [...],
    "workflows": [...],
    "prep_templates": [...]
  }
}
```

**Seeding process:**
1. During deployment, run `seed-templates.ts` migration script
2. Script reads all JSON files from `seeds/templates/`
3. For each file, inserts (or updates if key exists) template records
4. Idempotent: running the seed multiple times does not create duplicates

**Template authoring:** Template packs are authored by platform developers. The JSON format is documented so that convention teams can author their own packs and contribute them back.

**Acceptance Criteria:**
- [ ] Seed files exist for all 6 convention operations template packs
- [ ] Seeding script is idempotent
- [ ] Seed files follow a documented, versioned JSON format
- [ ] Templates are available in the browser immediately after deployment

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SEED-01 | Integration | Run seed script on fresh DB | All 6 packs inserted |
| SEED-02 | Integration | Run seed script twice | No duplicates, existing records updated if changed |
| SEED-03 | Integration | Seed file with invalid JSON | Script fails with clear error, no partial state |
| SEED-04 | Integration | Template browser after seeding | All 6 packs visible and previewable |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `platform/template-infrastructure.md` | Storage, versioning, CRUD API, import/export format |
| `core/department-as-concept.md` | Template application creates departments |
| `core/ontology-engine.md` | Template packs reference ontology constructs |
| `core/ontology-scoping.md` | Applied templates are department-scoped |
| `ui/dynamic-forms.md` | Form preview rendering |
| `ui/view-renderer.md` | View preview rendering |
| `ui/form-view-builder.md` | Form/view templates reference builder constructs |
| `automation/workflow-engine.md` | Workflow templates reference trigger/action types |
| `canvas/canvas-engine.md` | Concept map in preview uses canvas engine |
| `platform/branding.md` | Template pack colors and icons |
| `platform/shared-services-setup.md` | Template browser embedded in setup wizard |
| `platform/org-admin-dashboard.md` | Template browser accessible from admin dashboard |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Templates as seed data, not compiled code | Consistent with "source code = engine, database = application." Template packs are application content, not platform logic. Storing them as seed JSON files keeps the repo OSS-safe while still shipping useful defaults. |
| 6 curated packs for convention operations | The platform is purpose-built for convention operations. Shipping with department packs that cover the most common convention roles (GR, Programming, Operations, Vendors, Registration, A/V) provides immediate value. Additional packs can be added without code changes. |
| Deep copy, not reference, on application | Each department must be independently customizable. Template references would create coupling that violates department isolation. The storage cost of config-level deep copies is negligible. |
| No automatic upgrade propagation | Automatic upgrades to existing departments would overwrite director customizations. The manual adoption path (compare versions, apply changes) preserves department autonomy while enabling evolution. |
| Preview with sample data | Admins need to see what a template looks like in practice, not just a list of field names. Rendering actual forms and views with sample data makes the template's value immediately apparent. |
| Community templates as future work | The import/export foundation is built now. Community infrastructure (registry, publishing, ratings) is significant scope that should not block initial launch. The architectural decisions (self-contained export format, no org-specific references) ensure compatibility. |
