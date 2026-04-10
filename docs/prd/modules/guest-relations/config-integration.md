# GR Module — Config-Driven Integration

> Every GR operational page renders through ViewConfig, FormConfig, or PageConfig loaded from Postgres.
> No hardcoded DataTable layouts. No bespoke 700-line Vue files. The rendering engine (Phases 3-4.5) is
> the foundation — this PRD connects it to GR Module views. This was the missing piece that caused
> the first Phase 6 attempt to fail.

---

## Overview

The platform spent Phases 1-4.5 building a config-driven rendering engine: `FormConfig` → `buildFormKitSchema()` → `<DynamicForm>`, `ViewConfig` → `<DynamicView>` → five renderer components (table, kanban, timeline, detail, dashboard), `PageConfig` → widget grid layout. The first Phase 6 attempt bypassed all of it — every GR page was a hardcoded Vue file with inline PrimeVue components, static column definitions, and manual data fetching.

This PRD defines the integration bridge: how each GR operational page maps to config records in Postgres, how the Vue router loads configs instead of hardcoded components, and what seed data is required so pages render correctly on first load.

**The rule:** If a page can be rendered by `<DynamicView>` or `<DynamicForm>`, it MUST be. The only pages that remain as custom Vue components are structural shells that compose config-driven renderers — they don't contain rendering logic themselves.

**Dependencies:**
- `ui/view-renderer.md` — `<DynamicView>` and the five view type renderers
- `ui/dynamic-forms.md` — `<DynamicForm>` and `buildFormKitSchema()`
- `ui/form-view-builder.md` — admin UI for editing FormConfig/ViewConfig
- `core/ontology-engine.md` — concept/property loading
- `data/postgres-schema.md` — `form_configs`, `view_configs`, `page_configs` tables
- `modules/guest-relations/overview.md` — GR concepts and relationships

---

## 1. Page-to-Config Mapping

### Purpose

Define exactly which config type drives each GR operational page. This is the integration contract that was missing before.

### Detail

| Page | Current File | Replace With | Config Source | Config Record |
|------|-------------|-------------|---------------|---------------|
| Dashboard | `DashboardView.vue` (hardcoded widgets) | `<ConfigDashboard>` shell → `<DynamicView viewType="dashboard">` | `page_configs` | `slug: 'gr-dashboard'` |
| Guest List | `GuestListView.vue` (hardcoded DataTable) | `<ConfigListPage>` shell → `<DynamicView>` | `view_configs` | `concept_key: 'guest', name: 'default-list'` |
| New Guest | `NewGuestWizardView.vue` (hardcoded form) | `<ConfigFormPage>` shell → `<DynamicForm>` | `form_configs` | `concept_key: 'guest', name: 'intake-wizard'` |
| Guest Detail | `GuestDetailTabs.vue` (hardcoded tabs) | `<ConfigDetailPage>` shell → `<DynamicView viewType="detail">` + tab config | `view_configs` | `concept_key: 'guest', name: 'detail-view'` |
| Staff List | `StaffListView.vue` (hardcoded DataTable) | `<ConfigListPage>` shell → `<DynamicView>` | `view_configs` | `concept_key: 'staff', name: 'default-list'` |
| Schedule | `ScheduleView.vue` (hardcoded) | `<ConfigListPage>` shell → `<DynamicView viewType="timeline">` | `view_configs` | `concept_key: 'schedule_event', name: 'timeline-view'` |
| Prep Tracker | `PrepTrackerView.vue` (hardcoded) | `<ConfigListPage>` shell → `<DynamicView viewType="kanban">` | `view_configs` | `concept_key: 'prep_item', name: 'kanban-tracker'` |
| Workflows | `WorkflowManagerView.vue` (hardcoded) | `<ConfigListPage>` shell → `<DynamicView>` | `view_configs` | `concept_key: 'workflow_config', name: 'default-list'` |
| Settings | `SettingsView.vue` (hardcoded) | `<DeptSettingsPage>` shell → department-centric config panels | ontology config + `form_configs` | Multiple config records per setting area |

### Shell Components

Shell components are thin Vue files that:
1. Extract the route parameter (concept key, record ID)
2. Load the relevant config from the API (`GET /api/config/views?concept=guest&name=default-list`)
3. Pass the config to `<DynamicView>` or `<DynamicForm>`
4. Handle page-level concerns: breadcrumbs, page title, action buttons

Shell components contain NO rendering logic, NO column definitions, NO form fields. They are structural wrappers.

```vue
<!-- Example: ConfigListPage.vue (shell) -->
<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-surface-800">{{ pageTitle }}</h1>
      <Button v-if="canCreate" label="New" icon="pi pi-plus" @click="navigateToForm" />
    </div>
    <DynamicView
      v-if="viewConfig"
      :config="viewConfig"
      :concept-key="conceptKey"
      :records="records"
      @row-action="handleRowAction"
    />
  </div>
</template>
```

### Acceptance Criteria

- [ ] Every page in the mapping table renders from its designated config type
- [ ] Zero hardcoded column definitions, field definitions, or widget layouts in view files
- [ ] Shell components contain <50 lines of template code
- [ ] Config records loaded from API, not imported from local files

---

## 2. Seed Data — ViewConfig Records

### Purpose

Define the initial ViewConfig records that must exist in Postgres for GR pages to render on first load.

### Detail

#### 2.1 Guest List ViewConfig

```json
{
  "concept_key": "guest",
  "name": "default-list",
  "view_type": "table",
  "columns": [
    { "property_key": "name", "width": "auto", "sortable": true },
    { "property_key": "type", "width": "80px", "sortable": true },
    { "property_key": "status", "width": "120px", "sortable": true, "renderer": "status-badge" },
    { "property_key": "company", "width": "auto", "sortable": true },
    { "property_key": "department", "width": "120px", "sortable": true },
    { "property_key": "prep_completion", "width": "100px", "renderer": "progress-bar" }
  ],
  "filters": [
    { "property_key": "status", "type": "select", "default": null },
    { "property_key": "type", "type": "select", "default": null },
    { "property_key": "department", "type": "select", "default": null }
  ],
  "sort": { "property_key": "name", "direction": "asc" },
  "row_action": "navigate_to_detail",
  "presets": [
    { "name": "Needs Attention", "filters": { "needs_attention": true }, "shared": true },
    { "name": "Confirmed Only", "filters": { "status": "confirmed" }, "shared": true },
    { "name": "JP Guests", "filters": { "type": "JP" }, "shared": true }
  ]
}
```

#### 2.2 Staff List ViewConfig

```json
{
  "concept_key": "staff",
  "name": "default-list",
  "view_type": "table",
  "columns": [
    { "property_key": "name", "width": "auto", "sortable": true },
    { "property_key": "role_key", "width": "120px", "sortable": true, "renderer": "role-badge" },
    { "property_key": "department", "width": "120px", "sortable": true },
    { "property_key": "email", "width": "auto", "sortable": true }
  ],
  "sort": { "property_key": "name", "direction": "asc" },
  "row_action": "navigate_to_detail"
}
```

#### 2.3 Prep Tracker ViewConfig (Kanban)

```json
{
  "concept_key": "prep_item",
  "name": "kanban-tracker",
  "view_type": "kanban",
  "group_by": "status",
  "columns": [
    { "property_key": "name" },
    { "property_key": "guest_id", "renderer": "relation-link" },
    { "property_key": "due_date", "renderer": "relative-date" },
    { "property_key": "assigned_to", "renderer": "avatar" }
  ]
}
```

#### 2.4 Schedule ViewConfig (Timeline)

```json
{
  "concept_key": "schedule_event",
  "name": "timeline-view",
  "view_type": "timeline",
  "timeline_start": "start_time",
  "timeline_end": "end_time",
  "columns": [
    { "property_key": "name" },
    { "property_key": "event_type" },
    { "property_key": "venue_id", "renderer": "relation-link" }
  ]
}
```

#### 2.5 Guest Detail ViewConfig

```json
{
  "concept_key": "guest",
  "name": "detail-view",
  "view_type": "detail",
  "columns": [
    { "property_key": "name", "section": "header" },
    { "property_key": "type", "section": "header" },
    { "property_key": "status", "section": "header", "renderer": "status-badge" },
    { "property_key": "company", "section": "details" },
    { "property_key": "department", "section": "details" },
    { "property_key": "bio", "section": "details", "renderer": "rich-text" }
  ],
  "tabs": [
    { "label": "Prep Items", "concept_key": "prep_item", "filter": { "guest_id": "{{record.id}}" }, "view_name": "kanban-tracker" },
    { "label": "Pairings", "concept_key": "pairing", "filter": { "guest_id": "{{record.id}}" }, "view_name": "default-list" },
    { "label": "Transport", "concept_key": "transport_booking", "filter": { "guest_id": "{{record.id}}" }, "view_name": "default-list" },
    { "label": "Contracts", "concept_key": "generated_contract", "filter": { "guest_id": "{{record.id}}" }, "view_name": "default-list" },
    { "label": "Schedule", "concept_key": "schedule_event", "filter": { "guest_id": "{{record.id}}" }, "view_name": "timeline-view" }
  ]
}
```

### Acceptance Criteria

- [ ] All ViewConfig records in this section exist in the seed migration
- [ ] Guest list renders with the columns and filters defined here
- [ ] Prep tracker renders as a kanban board grouped by status
- [ ] Schedule renders as a timeline
- [ ] Guest detail renders header fields + tabbed sub-views
- [ ] All renderers referenced (status-badge, progress-bar, relation-link, etc.) are implemented

---

## 3. Seed Data — FormConfig Records

### Purpose

Define the initial FormConfig records for GR forms.

### Detail

#### 3.1 Guest Intake Wizard

```json
{
  "concept_key": "guest",
  "name": "intake-wizard",
  "layout": "wizard",
  "steps": [
    {
      "label": "Basic Info",
      "fields": ["name", "type", "company", "bio"]
    },
    {
      "label": "Contact",
      "fields": ["email", "phone", "preferred_language"]
    },
    {
      "label": "Convention Details",
      "fields": ["department", "status", "special_requirements", "dietary_restrictions"]
    }
  ],
  "fields": [
    { "property_key": "name", "required": true },
    { "property_key": "type", "required": true },
    { "property_key": "company" },
    { "property_key": "bio", "input_type": "textarea" },
    { "property_key": "email", "required": true },
    { "property_key": "phone" },
    { "property_key": "preferred_language" },
    { "property_key": "department", "required": true },
    { "property_key": "status", "default": "draft" },
    { "property_key": "special_requirements", "input_type": "textarea" },
    { "property_key": "dietary_restrictions" }
  ]
}
```

#### 3.2 Quick Guest Edit Form

```json
{
  "concept_key": "guest",
  "name": "quick-edit",
  "layout": "two-column",
  "fields": [
    { "property_key": "name", "required": true },
    { "property_key": "type", "required": true },
    { "property_key": "status", "required": true },
    { "property_key": "company" },
    { "property_key": "department", "required": true },
    { "property_key": "bio", "input_type": "textarea", "span": "full" }
  ]
}
```

### Acceptance Criteria

- [ ] Guest intake wizard renders as a multi-step form from FormConfig
- [ ] All fields derive labels from ontology Property.label
- [ ] Validation rules derive from ontology Property.validation_rules
- [ ] Form submission goes through the standard write pipeline

---

## 4. Seed Data — PageConfig Records

### Purpose

Define the dashboard widget layout.

### Detail

#### 4.1 GR Dashboard

```json
{
  "name": "GR Dashboard",
  "slug": "gr-dashboard",
  "widgets": [
    {
      "type": "stat-card",
      "title": "Total Guests",
      "query": { "concept": "guest", "aggregate": "count" },
      "position": { "x": 0, "y": 0, "w": 3, "h": 1 }
    },
    {
      "type": "stat-card",
      "title": "Confirmed",
      "query": { "concept": "guest", "aggregate": "count", "filter": { "status": "confirmed" } },
      "position": { "x": 3, "y": 0, "w": 3, "h": 1 }
    },
    {
      "type": "stat-card",
      "title": "Prep Completion",
      "query": { "concept": "prep_item", "aggregate": "avg", "field": "completion_pct" },
      "position": { "x": 6, "y": 0, "w": 3, "h": 1 },
      "renderer": "percentage"
    },
    {
      "type": "stat-card",
      "title": "Active Bookings",
      "query": { "concept": "transport_booking", "aggregate": "count", "filter": { "status": ["booked", "driver_en_route", "waiting"] } },
      "position": { "x": 9, "y": 0, "w": 3, "h": 1 }
    },
    {
      "type": "alert-list",
      "title": "Action Required",
      "query": { "concept": "guest", "filter": { "needs_attention": true }, "limit": 10 },
      "position": { "x": 0, "y": 1, "w": 6, "h": 3 }
    },
    {
      "type": "view-embed",
      "title": "Upcoming Schedule",
      "view_ref": { "concept_key": "schedule_event", "view_name": "timeline-view" },
      "filter": { "start_time": { "$gte": "{{now}}", "$lte": "{{now+24h}}" } },
      "position": { "x": 6, "y": 1, "w": 6, "h": 3 }
    },
    {
      "type": "view-embed",
      "title": "Prep Tracker Overview",
      "view_ref": { "concept_key": "prep_item", "view_name": "kanban-tracker" },
      "filter": { "status": { "$ne": "complete" } },
      "position": { "x": 0, "y": 4, "w": 12, "h": 4 }
    }
  ]
}
```

### Acceptance Criteria

- [ ] Dashboard renders from PageConfig, not hardcoded Vue template
- [ ] Stat cards query live data from concept APIs
- [ ] View-embed widgets render embedded DynamicView components
- [ ] Widget positions define a responsive grid layout
- [ ] Adding/removing widgets requires only a PageConfig change, not a code change

---

## 5. Routing Architecture

### Purpose

Define how Vue Router routes map to config-driven shell components instead of hardcoded views.

### Detail

```typescript
// web/src/router/index.ts — GR module routes

const grRoutes = [
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/shells/ConfigDashboard.vue'),
    meta: { pageConfig: 'gr-dashboard' }
  },
  {
    path: '/guests',
    name: 'guest-list',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'default-list' }
  },
  {
    path: '/guests/new',
    name: 'new-guest',
    component: () => import('@/views/shells/ConfigFormPage.vue'),
    meta: { conceptKey: 'guest', formName: 'intake-wizard' }
  },
  {
    path: '/guests/:id',
    name: 'guest-detail',
    component: () => import('@/views/shells/ConfigDetailPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'detail-view' }
  },
  {
    path: '/staff',
    name: 'staff-list',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'staff', viewName: 'default-list' }
  },
  {
    path: '/schedule',
    name: 'schedule',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'schedule_event', viewName: 'timeline-view' }
  },
  {
    path: '/prep',
    name: 'prep-tracker',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'prep_item', viewName: 'kanban-tracker' }
  },
  {
    path: '/workflows',
    name: 'workflow-list',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'workflow_config', viewName: 'default-list' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/shells/DeptSettingsPage.vue'),
    meta: { department: 'guest-relations' }
  }
]
```

**Key pattern:** Routes use route `meta` to specify which config to load. Shell components read `route.meta.conceptKey` and `route.meta.viewName` to fetch the appropriate config from the API. The same `ConfigListPage.vue` shell serves Guest List, Staff List, Prep Tracker, and Workflows — the config determines what renders.

### Config Loading Composable

```typescript
// web/src/composables/useConfigLoader.ts
export function useViewConfig(conceptKey: string, viewName: string) {
  const config = ref<ViewConfig | null>(null)
  const loading = ref(true)

  onMounted(async () => {
    config.value = await api.get(`/api/config/views`, {
      params: { concept: conceptKey, name: viewName }
    })
    loading.value = false
  })

  return { config, loading }
}
```

### Acceptance Criteria

- [ ] All GR routes use shell components, not hardcoded view files
- [ ] Route meta specifies concept key + config name
- [ ] Config loaded from API on route navigation
- [ ] Same shell component reused across different concept pages
- [ ] Config loading composable handles loading/error states

---

## 6. Settings Page — Department-Centric

### Purpose

Define how the settings page renders department-specific configuration panels instead of a generic settings form.

### Detail

The settings page is organized by department, not by feature. When a GR director opens settings, they see GR-specific configuration:

**Settings sections (from ontology config):**

| Section | Config Source | What It Controls |
|---------|-------------|-----------------|
| Department Info | `ontology_concepts WHERE key='guest_relations_dept'` | Department name, description, icon |
| Guest Properties | `ontology_properties WHERE concept_key='guest'` | Which fields exist, types, validation, order |
| Status Workflow | `ontology_events + workflow_configs` | Guest lifecycle states and transitions |
| Roles & Permissions | `permissions WHERE concept_key LIKE 'gr_%'` | Who can see/edit what |
| Data Routes | `data_routes WHERE source_department='guest-relations'` | How GR data fans out to other departments |
| Templates | `templates WHERE category='guest_relations'` | Prep checklists, notification templates, contract templates |
| Integrations | `external_connections WHERE department='guest-relations'` | FlightAware, Blacklane, etc. |

Each section renders as a card with a summary + edit capability. Editing opens the appropriate builder (property editor, workflow builder, etc.). The settings page itself is a layout shell — the content is config-driven.

### Acceptance Criteria

- [ ] Settings page is organized by department, not by generic feature categories
- [ ] Each section reads its data from the ontology/config tables
- [ ] Editing a section opens the appropriate builder UI
- [ ] A new department onboarded via ontology sees its own settings automatically

---

## 7. List View Rendering — Card Layouts

### Purpose

Define how list views render as cards/records instead of raw spreadsheet grids (R3).

### Detail

**The rule:** List views MUST NOT look like spreadsheets. Each record is a visually distinct unit.

The `<DynamicView viewType="table">` renderer (ViewTable.vue) must support two rendering modes:

| Mode | When | Visual |
|------|------|--------|
| `dense-table` | ViewConfig has `renderMode: 'dense'` or >8 columns | Traditional DataTable for data-heavy admin views |
| `card-rows` (default) | Default for operational views | Each row is a card with structured field layout |

**Card row layout:**

```
+------------------------------------------------------------------+
| [Avatar/Icon]  Name                    Status Badge    Type Tag   |
|                Company Name             Prep: ██████░░ 72%       |
|                Department               Last updated: 2h ago     |
+------------------------------------------------------------------+
```

Each card row shows:
- Primary identifier (name, title) — large, bold
- Secondary info (company, department) — normal weight, muted color
- Status indicator — badge with color
- Key metric — progress bar, count, or date
- Visual grouping — clear separation between records

This is NOT a PrimeVue DataTable with card styling. It's a distinct renderer that reads the same ViewConfig columns but renders them in a structured card layout.

### Acceptance Criteria

- [ ] Default list view rendering uses card-row layout, not raw DataTable
- [ ] Card rows show primary identifier, secondary info, status, and key metric
- [ ] Dense table mode available for admin/data-heavy views via ViewConfig option
- [ ] Switching between card and dense modes requires only a ViewConfig change
- [ ] List views "feel like an app, not a spreadsheet"

---

## 8. Migration Plan

### Purpose

Define the steps to migrate from hardcoded views to config-driven rendering.

### Detail

**Phase 6 implementation order:**

1. **Seed migration** — Create the ViewConfig, FormConfig, and PageConfig records in a new migration file (`XXX-gr-config-seeds.sql`)
2. **Shell components** — Create the 4 shell components: `ConfigListPage.vue`, `ConfigFormPage.vue`, `ConfigDetailPage.vue`, `ConfigDashboard.vue`, `DeptSettingsPage.vue`
3. **Config loading composable** — Create `useViewConfig`, `useFormConfig`, `usePageConfig` composables
4. **Router update** — Replace hardcoded component imports with shell component imports + meta
5. **Renderer updates** — Ensure `<DynamicView>` handles all five view types with card-row default
6. **Delete hardcoded views** — Remove `GuestListView.vue`, `DashboardView.vue`, `NewGuestWizardView.vue`, etc.
7. **Behavioral verification** — Navigate to each page, confirm data loads from DB and renders correctly

**What is NOT deleted:**
- `DomainListView.vue` — generic domain browser, already semi-dynamic (becomes the fallback for concepts without specific ViewConfig)
- `LoginView.vue` — auth flow, not config-driven
- Canvas views (`SystemGraphView.vue`, `DataFlowCanvasView.vue`, `WorkflowCanvasView.vue`) — these are canvas renderers, not config-driven list/form views
- `GuestHubView.vue` — navigation hub, if it's purely structural

### Acceptance Criteria

- [ ] All hardcoded GR view files are deleted after migration
- [ ] All GR pages render correctly from config
- [ ] No regression in existing functionality
- [ ] Behavioral verification passes: load guest list, create guest, view guest detail, check dashboard

---

## 9. Test Plan

### 9.1 Config Loading Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CI-01 | Unit | Load ViewConfig for guest list | Returns config with columns, filters, sort |
| CI-02 | Unit | Load FormConfig for intake wizard | Returns config with steps and fields |
| CI-03 | Unit | Load PageConfig for dashboard | Returns config with widget definitions |
| CI-04 | Unit | Load config for non-existent concept | Returns null, shell shows empty state |
| CI-05 | Integration | API endpoint GET /api/config/views?concept=guest&name=default-list | Returns seed ViewConfig |

### 9.2 Shell Component Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CI-06 | Unit | ConfigListPage receives ViewConfig | Renders DynamicView with correct props |
| CI-07 | Unit | ConfigFormPage receives FormConfig | Renders DynamicForm with correct props |
| CI-08 | Unit | ConfigDashboard receives PageConfig | Renders widget grid with correct positions |
| CI-09 | Unit | Shell with loading config | Shows skeleton/loading state |
| CI-10 | Unit | Shell with failed config load | Shows error message, not blank page |

### 9.3 End-to-End Rendering Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CI-11 | Integration | Navigate to /guests | Guest list renders with columns from ViewConfig |
| CI-12 | Integration | Navigate to /guests/new | Wizard form renders with steps from FormConfig |
| CI-13 | Integration | Navigate to /guests/:id | Detail view renders with header + tabs from ViewConfig |
| CI-14 | Integration | Navigate to /dashboard | Dashboard renders widgets from PageConfig |
| CI-15 | Integration | Navigate to /prep | Kanban board renders from ViewConfig |
| CI-16 | Integration | Navigate to /schedule | Timeline view renders from ViewConfig |

### 9.4 Behavioral Verification Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CI-17 | E2E | Seed DB with guest data, navigate to /guests | Real guest names visible in card-row layout |
| CI-18 | E2E | Fill guest intake wizard, submit | Guest created in DB via write pipeline |
| CI-19 | E2E | Navigate to /dashboard | Stat cards show correct counts from DB |
| CI-20 | E2E | Modify ViewConfig in DB (add column), reload page | New column appears without code change |

**Coverage target:** >=80% on config loading, shell components, and rendering dispatch. 100% on the behavioral verification tests (CI-17 through CI-20) — these prove the ontology thesis.

---

## 10. Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Shell components instead of removing all Vue files | Routes still need a Vue component to mount. Shells are thin (<50 lines) and reusable across concepts. |
| Config loaded from API, not compiled into bundle | Allows admin to change view layout without redeployment. The database IS the application. |
| Card-row default instead of DataTable | R3: "list views don't feel like an app, they look like spreadsheets." Cards create visual structure. |
| Same ConfigListPage for multiple concepts | Proves the platform thesis: one engine, multiple applications via config. |
| Delete hardcoded views after migration | No backwards compatibility needed. Clean break prevents "just add one more column to the old view." |
| Seed configs in a migration file | Config is data, not code. Seed data belongs in migrations alongside schema changes. |
