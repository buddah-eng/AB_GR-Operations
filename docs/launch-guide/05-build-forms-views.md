# Building Forms and Views

> Forms define how data is entered. Views define how data is displayed.
> Both are stored as configuration rows in Postgres -- not code.
> The form builder generates FormKit schema. The view builder generates table/kanban/timeline configs.
> Build the essentials at launch; refine iteratively as your team uses the platform.

---

## How It Works

Forms and views are driven by two config tables:

| Table | Drives | UI Component |
|-------|--------|-------------|
| `form_configs` | Data entry forms | FormKit schema renderer |
| `view_configs` | Data display (lists, boards, timelines) | Table, kanban, timeline, detail, dashboard renderers |

The engine loads these configs from Postgres at runtime (cached with TTL) and the frontend renders them dynamically. Changing a config row changes the UI without redeploying.

---

## Form Configurations

### FormConfig Structure

A form config defines layout, field ordering, conditional visibility, and grouping for a concept.

```sql
INSERT INTO form_configs (concept_key, name, layout, fields, steps)
VALUES (
  'guest',
  'Guest Intake Form',
  'wizard',
  '[
    {"propertyKey": "name", "groupName": "basics", "colSpan": 2},
    {"propertyKey": "type", "groupName": "basics", "colSpan": 1},
    {"propertyKey": "department", "groupName": "basics", "colSpan": 1},
    {"propertyKey": "company", "groupName": "basics", "colSpan": 2},
    {"propertyKey": "status", "groupName": "status", "colSpan": 1},
    {"propertyKey": "interpreterRequired", "groupName": "status", "colSpan": 1,
     "showIf": {"type": "field", "field": "type", "operator": "eq", "value": "JP"}
    },
    {"propertyKey": "email", "groupName": "contact", "colSpan": 1},
    {"propertyKey": "phone", "groupName": "contact", "colSpan": 1},
    {"propertyKey": "bio", "groupName": "details", "colSpan": 2},
    {"propertyKey": "specialHandling", "groupName": "details", "colSpan": 2}
  ]',
  '[
    {"key": "basics", "label": "Basic Info", "description": "Guest identity and classification"},
    {"key": "status", "label": "Status", "description": "Confirmation status and requirements"},
    {"key": "contact", "label": "Contact", "description": "Contact information (encrypted at rest)"},
    {"key": "details", "label": "Details", "description": "Bio and special handling requirements"}
  ]'
);
```

### Layout Types

| Layout | Description | Use Case |
|--------|-------------|----------|
| `single` | All fields in a single column | Simple forms (3-5 fields) |
| `two-column` | Fields in a two-column grid | Medium forms (6-12 fields) |
| `wizard` | Multi-step form with progress indicator | Complex forms (10+ fields) |

### FormFieldConfig Properties

| Property | Type | Description |
|----------|------|-------------|
| `propertyKey` | string | References an ontology property key |
| `groupName` | string | Groups fields together (step key for wizard layout) |
| `colSpan` | 1 or 2 | Column width in two-column/wizard layouts |
| `showIf` | ConditionExpression | Conditional visibility -- show only when condition is true |
| `autocompleteSource` | string | Concept key for relation field autocomplete |
| `overrideLabel` | string | Override the ontology property's label |
| `overridePlaceholder` | string | Override the ontology property's placeholder |

### Example: Staff Entry Form

```sql
INSERT INTO form_configs (concept_key, name, layout, fields)
VALUES (
  'staff',
  'Staff Entry Form',
  'two-column',
  '[
    {"propertyKey": "name", "colSpan": 2},
    {"propertyKey": "email", "colSpan": 1},
    {"propertyKey": "phone", "colSpan": 1},
    {"propertyKey": "role", "colSpan": 1},
    {"propertyKey": "department", "colSpan": 1},
    {"propertyKey": "lineId", "colSpan": 1},
    {"propertyKey": "availability", "colSpan": 1},
    {"propertyKey": "reportsTo", "colSpan": 2}
  ]'
);
```

### Example: Schedule Event Form

```sql
INSERT INTO form_configs (concept_key, name, layout, fields)
VALUES (
  'schedule',
  'Schedule Event Form',
  'two-column',
  '[
    {"propertyKey": "name", "colSpan": 2},
    {"propertyKey": "eventType", "colSpan": 1},
    {"propertyKey": "status", "colSpan": 1},
    {"propertyKey": "startTime", "colSpan": 1},
    {"propertyKey": "endTime", "colSpan": 1},
    {"propertyKey": "venue", "colSpan": 1, "autocompleteSource": "venue"},
    {"propertyKey": "guestId", "colSpan": 1, "autocompleteSource": "guest"},
    {"propertyKey": "description", "colSpan": 2}
  ]'
);
```

---

## View Configurations

### ViewConfig Structure

A view config defines how records are displayed: as a table, kanban board, timeline, detail page, or dashboard.

### 5 View Types

| View Type | Description | Best For |
|-----------|-------------|----------|
| `table` | Sortable, filterable data table | Lists of records (guest list, staff list) |
| `kanban` | Card board grouped by a property | Status-based workflows (guest pipeline, prep tracker) |
| `timeline` | Chronological view by date range | Schedules, event planning |
| `detail` | Single-record detail page | Guest hub, staff profile |
| `dashboard` | Widget-based summary page | Operations overview |

### Example: All Guests Table View

```sql
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, row_action, filters, presets)
VALUES (
  'guest',
  'All Guests',
  'table',
  '[
    {"key": "name", "label": "Name", "sortable": true, "width": 200},
    {"key": "type", "label": "Type", "sortable": true, "width": 120},
    {"key": "department", "label": "Department", "sortable": true, "width": 120},
    {"key": "status", "label": "Status", "sortable": true, "width": 120},
    {"key": "company", "label": "Company", "sortable": true, "width": 150},
    {"key": "interpreterRequired", "label": "Interpreter", "sortable": true, "width": 100}
  ]',
  '{"key": "name", "direction": "asc"}',
  'navigate_to_detail',
  '[]',
  '[
    {"key": "confirmed", "label": "Confirmed Only", "filters": [{"field": "status", "operator": "eq", "value": "Confirmed"}]},
    {"key": "jp", "label": "JP Guests", "filters": [{"field": "type", "operator": "eq", "value": "JP"}]},
    {"key": "draft", "label": "Drafts", "filters": [{"field": "status", "operator": "eq", "value": "draft"}]}
  ]'
);
```

### Example: Guest Pipeline Kanban

```sql
INSERT INTO view_configs (concept_key, name, view_type, group_by, columns, sort)
VALUES (
  'guest',
  'Guest Pipeline',
  'kanban',
  'status',
  '[
    {"key": "name", "label": "Name"},
    {"key": "type", "label": "Type"},
    {"key": "department", "label": "Department"},
    {"key": "company", "label": "Company"}
  ]',
  '{"key": "name", "direction": "asc"}'
);
```

### Example: Schedule Timeline

```sql
INSERT INTO view_configs (concept_key, name, view_type, timeline_start, timeline_end, columns, sort)
VALUES (
  'schedule',
  'Convention Schedule',
  'timeline',
  'startTime',
  'endTime',
  '[
    {"key": "name", "label": "Activity"},
    {"key": "eventType", "label": "Type"},
    {"key": "venue", "label": "Venue"},
    {"key": "status", "label": "Status"}
  ]',
  '{"key": "startTime", "direction": "asc"}'
);
```

### Example: Prep Tracker Table

```sql
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, filters)
VALUES (
  'prep',
  'Prep Tracker',
  'table',
  '[
    {"key": "name", "label": "Task", "sortable": true},
    {"key": "guestId", "label": "Guest", "sortable": true},
    {"key": "status", "label": "Status", "sortable": true},
    {"key": "dueDate", "label": "Due Date", "sortable": true},
    {"key": "owner", "label": "Owner", "sortable": true}
  ]',
  '{"key": "dueDate", "direction": "asc"}',
  '[{"field": "status", "operator": "neq", "value": "complete"}]'
);
```

### Example: Staff Directory Table

```sql
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, row_action)
VALUES (
  'staff',
  'Staff Directory',
  'table',
  '[
    {"key": "name", "label": "Name", "sortable": true},
    {"key": "email", "label": "Email", "sortable": true},
    {"key": "role", "label": "Role", "sortable": true},
    {"key": "department", "label": "Department", "sortable": true},
    {"key": "phone", "label": "Phone"}
  ]',
  '{"key": "name", "direction": "asc"}',
  'inline_edit'
);
```

---

## ViewColumn Properties

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Property key from ontology |
| `label` | string | Column header text |
| `sortable` | boolean | Whether the column is sortable |
| `width` | number | Column width in pixels (table view) |
| `hidden` | boolean | Hidden by default (user can show) |

## ViewFilter Properties

| Property | Type | Description |
|----------|------|-------------|
| `field` | string | Property key to filter on |
| `operator` | string | `eq`, `neq`, `contains`, `gt`, `lt`, `gte`, `lte`, `in` |
| `value` | any | Value to compare against |

## ViewPreset Properties

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique preset identifier |
| `label` | string | Display label for the preset button |
| `filters` | ViewFilter[] | Filters to apply when preset is selected |

---

## Using the Builders (Visual Approach)

Instead of writing SQL, you can use the visual builders in the running application:

### Form Builder

Navigate to `/builder/form/:conceptKey` (e.g., `/builder/form/guest`).

The form builder provides:
- Drag-and-drop field ordering
- Layout selection (single, two-column, wizard)
- Conditional visibility rules
- Field grouping for wizard steps
- Live preview of the rendered form

The builder saves to the `form_configs` table via the API:
- `POST /api/form-configs` -- create a new form config
- `PUT /api/form-configs/:id` -- update an existing form config
- `GET /api/form-configs?conceptKey=guest` -- list form configs for a concept

### View Builder

Navigate to `/builder/view/:conceptKey` (e.g., `/builder/view/guest`).

The view builder provides:
- Column selection and ordering
- View type selection (table, kanban, timeline, detail, dashboard)
- Default filter and sort configuration
- Preset definition
- Kanban group-by property selection

The builder saves to the `view_configs` table via the API:
- `POST /api/view-configs` -- create a new view config
- `PUT /api/view-configs/:id` -- update an existing view config
- `GET /api/view-configs?conceptKey=guest` -- list view configs for a concept

---

## Page Configurations (Dashboard Widgets)

Page configs define dashboard-style pages composed of widgets.

```sql
INSERT INTO page_configs (name, slug, widgets, breakpoints)
VALUES (
  'Operations Dashboard',
  'dashboard',
  '[
    {"type": "stat_card", "title": "Total Guests", "conceptKey": "guest", "aggregation": "count"},
    {"type": "stat_card", "title": "Confirmed", "conceptKey": "guest", "aggregation": "count", "filter": {"field": "status", "value": "Confirmed"}},
    {"type": "stat_card", "title": "Prep Completion", "conceptKey": "prep", "aggregation": "percentage", "filter": {"field": "status", "value": "complete"}},
    {"type": "data_table", "title": "Recent Guests", "conceptKey": "guest", "limit": 5, "sort": {"key": "created_at", "direction": "desc"}},
    {"type": "prep_progress", "title": "Prep Tracker Progress", "conceptKey": "prep"},
    {"type": "timeline_preview", "title": "Upcoming Events", "conceptKey": "schedule", "limit": 10}
  ]',
  '{"desktop": {"columns": 3}, "tablet": {"columns": 2}, "mobile": {"columns": 1}}'
);
```

### Widget Types

| Widget Type | Description |
|-------------|-------------|
| `stat_card` | Single metric with optional comparison |
| `data_table` | Mini data table with limited rows |
| `chart` | Pie, bar, or line chart |
| `timeline_preview` | Upcoming events list |
| `prep_progress` | Prep completion progress bars |
| `action_banner` | Call-to-action banner |
| `quick_add` | Quick-add form for a concept |
| `activity_feed` | Recent activity log |

---

## Essential Configs for Launch

At minimum, create these configs before inviting your team:

| Config | Type | Priority |
|--------|------|----------|
| Guest intake form | `form_configs` | Required |
| All Guests table view | `view_configs` | Required |
| Staff entry form | `form_configs` | Required |
| Staff directory table view | `view_configs` | Required |
| Schedule event form | `form_configs` | Required |
| Schedule timeline view | `view_configs` | Required |
| Prep tracker table view | `view_configs` | Required |
| Operations dashboard | `page_configs` | Recommended |
| Guest pipeline kanban | `view_configs` | Recommended |

Everything else can be built iteratively as your team uses the platform.

---

## Verification

```sql
-- List all form configs
SELECT concept_key, name, layout
FROM form_configs
WHERE status = 'active'
ORDER BY concept_key;

-- List all view configs
SELECT concept_key, name, view_type
FROM view_configs
WHERE status = 'active'
ORDER BY concept_key;

-- Verify via the API
curl http://localhost:8080/api/form-configs?conceptKey=guest | jq '.'
curl http://localhost:8080/api/view-configs?conceptKey=guest | jq '.'
```

---

## Next Step

[06-create-workflows.md -- Creating Workflows](06-create-workflows.md)
