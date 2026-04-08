# PRD: View Renderer

> Ontology-driven rendering engine. `ViewConfig` declares what to show; the renderer decides how.

**Status:** Draft
**Date:** 2026-04-08
**Source of record:** Postgres
**Depends on:** `functions/src/ontology/types.ts` (ViewConfig, PageConfig, WidgetConfig)
**Proof of concept:** `web/src/views/DomainListView.vue` (working dynamic table)

---

## Shorthand

- Five view types: **table, kanban, timeline, detail, dashboard**.
- Each view type has a dedicated renderer component; `<DynamicView>` dispatches.
- ViewConfig drives columns, filters, sort, grouping, timeline fields, row actions.
- PageConfig + WidgetConfig drive dashboard layout with responsive breakpoints.
- ViewPresets give named filter snapshots (personal + shared).
- DomainListView.vue already renders a dynamic PrimeVue DataTable from ontology properties -- this PRD generalizes that pattern to all five types.

---

## Overview

The operations platform stores all domain data in Postgres and exposes it through a concept-based ontology. Each concept (guest, session, venue, prep_item, etc.) has one or more `ViewConfig` records that declare how data should be presented. Today `DomainListView.vue` hard-codes a single table renderer that reads `ontologyStore.getPropertiesForConcept()` and renders the first 8 columns in a PrimeVue DataTable. This PRD replaces that with a general-purpose view renderer that reads the full `ViewConfig` -- columns, filters, sort, groupBy, timeline fields, row action, presets -- and renders the correct view type.

The dashboard view type uses `PageConfig` instead, which composes multiple `WidgetConfig` items into a responsive grid.

Everything ships. No external dependencies beyond PrimeVue and the existing ontology store.

---

## 1. View Types

### Purpose

Map each `ViewConfig.viewType` value to a dedicated renderer component so that a single `<DynamicView>` call produces the correct UI.

### Detail

| viewType    | Renderer Component      | Primary Data Source       |
|-------------|-------------------------|---------------------------|
| `table`     | `ViewTable.vue`         | ViewConfig.columns        |
| `kanban`    | `ViewKanban.vue`        | ViewConfig.groupBy        |
| `timeline`  | `ViewTimeline.vue`      | ViewConfig.timelineStart/End |
| `detail`    | `ViewDetail.vue`        | ViewConfig.columns (as field list) |
| `dashboard` | `ViewDashboard.vue`     | PageConfig.widgets        |

`DynamicView` reads the `viewType` field and renders the matching component via `<component :is="...">`. Unknown view types fall back to table.

### Acceptance Criteria

- [ ] Each of the five view types resolves to its own Vue component.
- [ ] Unknown or missing `viewType` defaults to table.
- [ ] Switching `viewType` on a ViewConfig re-renders the correct component without page reload.

---

## 2. Table View

### Purpose

Replace the current `DomainListView.vue` hard-coded table with a fully config-driven PrimeVue DataTable that respects all `ViewColumn` properties.

### Detail

**Current state (DomainListView.vue):**
- Uses `ontologyStore.getPropertiesForConcept()`, takes first 8 columns.
- All columns set `sortable` unconditionally.
- No filtering, no column widths, no editable cells, no row actions.
- Pagination threshold hard-coded at 25.

**Target state (ViewTable.vue):**

Columns are driven by `ViewConfig.columns: ViewColumn[]`:

```
ViewColumn {
  propertyKey: string   // maps to record.properties[key]
  width?: number        // column width in px; undefined = auto
  sortable?: boolean    // show sort controls
  filterable?: boolean  // show column filter input
  editable?: boolean    // inline cell editing
}
```

Behavior:
- **Column rendering:** Iterate `ViewConfig.columns`. Each column maps `field` to `properties.${propertyKey}`. Apply `width` as column style. Conditionally enable `sortable` and `filterable` per column.
- **Pagination:** PrimeVue paginator. Default 25 rows. Configurable via `ViewConfig.displayOptions` if extended later.
- **Row action:** `ViewConfig.rowAction` controls click behavior:
  - `navigate_to_detail` -- router push to `/:concept/:id`.
  - `inline_edit` -- row enters edit mode on click.
  - `none` -- no click handler.
- **Sorting:** Server-side sort via `ViewConfig.sort` (field + direction). Client-side sort toggle per sortable column.
- **Filtering:** `ViewConfig.filters` provide pre-applied filters. Column-level `filterable` enables user-driven filter inputs.
- **Editable cells:** Columns with `editable: true` render PrimeVue cell editor. On edit complete, PATCH to `/api/domains/:concept/:id`.

### Acceptance Criteria

- [ ] Table renders columns matching `ViewConfig.columns` in order.
- [ ] Column widths, sortable, filterable, editable flags are respected per column.
- [ ] Row click triggers the action defined by `rowAction`.
- [ ] `ViewConfig.sort` applies as default sort on load.
- [ ] `ViewConfig.filters` apply as pre-set filter state.
- [ ] Editable cells persist changes via API on blur/enter.
- [ ] Pagination activates when row count exceeds page size.
- [ ] Empty state message displays when no records match (matches existing DomainListView behavior).

---

## 3. Kanban View

### Purpose

Render records as cards grouped into columns by a select/status property, with drag-and-drop to change status.

### Detail

**Config:** `ViewConfig.groupBy` must reference a property of type `select` or `status`. The property's option values define the kanban columns.

**Layout:**
- Horizontal scrollable container. Each kanban column has a header (option label + record count).
- Cards within each column are vertically stacked and scrollable.
- Card content shows fields from `ViewConfig.columns` (first 3-4 fields as card summary).

**Drag-and-drop:**
- Use HTML5 drag API or a lightweight Vue drag library (vuedraggable).
- Dragging a card from column A to column B triggers:
  1. Optimistic UI update (move card immediately).
  2. PATCH `/api/domains/:concept/:id` with `{ [groupByField]: newValue }`.
  3. On failure, revert card position and show toast error.

**Sorting within columns:** Cards sorted by `ViewConfig.sort` if provided, otherwise by creation date descending.

**Filters:** `ViewConfig.filters` apply before grouping. Cards not matching filters are excluded entirely.

### Acceptance Criteria

- [ ] Kanban renders one column per option value of the `groupBy` property.
- [ ] Each column displays its record count in the header.
- [ ] Cards display the first 3-4 fields from `ViewConfig.columns`.
- [ ] Drag-and-drop between columns updates the `groupBy` field via API.
- [ ] Failed API update reverts the card to its original column with error toast.
- [ ] `ViewConfig.filters` exclude non-matching records from all columns.
- [ ] `ViewConfig.sort` orders cards within each column.
- [ ] Empty columns still render (with zero count) so users see all possible states.

---

## 4. Timeline View

### Purpose

Display records on a horizontal timeline using date fields, enabling time-based navigation of events, sessions, or milestones.

### Detail

**Config:**
- `ViewConfig.timelineStart` -- property key for the start date/datetime.
- `ViewConfig.timelineEnd` -- property key for the end date/datetime. If absent, events render as points rather than ranges.

**Layout:**
- Horizontal axis = time. Zoom levels: day, week, month.
- Records render as bars (if start+end) or points (if start only).
- Bar/point label shows the record's display name (first column from `ViewConfig.columns` or the record title).
- Vertical stacking when events overlap.

**Interaction:**
- Click an event to open detail view (uses `rowAction` if `navigate_to_detail`, otherwise shows a popover with `ViewConfig.columns` fields).
- Scroll/pan to navigate time. Zoom controls for day/week/month.
- Today marker line.

**Filters and sort:**
- `ViewConfig.filters` restrict which records appear on the timeline.
- `ViewConfig.sort` is ignored (time axis provides implicit ordering).

**Implementation:** Custom SVG/Canvas rendering or a lightweight timeline library. Keep dependency minimal.

### Acceptance Criteria

- [ ] Events with start+end render as horizontal bars positioned by date.
- [ ] Events with start only render as point markers.
- [ ] Clicking an event navigates to detail or shows popover based on `rowAction`.
- [ ] Zoom levels (day, week, month) change the visible time range.
- [ ] Overlapping events stack vertically without clipping.
- [ ] Today marker line renders at the current date position.
- [ ] `ViewConfig.filters` exclude non-matching records from the timeline.
- [ ] Empty state renders when no records have valid date fields.

---

## 5. Dashboard View

### Purpose

Compose multiple widgets into a responsive page layout using `PageConfig` and `WidgetConfig`.

### Detail

**PageConfig** defines the dashboard:
```
PageConfig {
  id: string
  name: string
  slug: string                    // URL path, e.g., "/dashboard/convention-overview"
  widgets: WidgetConfig[]
  breakpoints?: {
    desktop: WidgetLayout[]       // grid positions for >= 1024px
    tablet?: WidgetLayout[]       // grid positions for 768-1023px
    mobile?: WidgetLayout[]       // grid positions for < 768px
  }
}
```

**WidgetLayout** positions each widget on a CSS grid:
```
WidgetLayout {
  widgetId: string
  x: number      // column start
  y: number      // row start
  w: number      // column span
  h: number      // row span
}
```

**Widget types and their rendering:**

| Widget Type        | Renders                                   | Data Source                        |
|--------------------|-------------------------------------------|------------------------------------|
| `stat_card`        | Single number + label + optional trend    | Aggregation query on conceptKey    |
| `data_table`       | Compact table (reuses ViewTable)          | conceptKey + filter                |
| `chart`            | Bar/line/pie via displayOptions.chartType | conceptKey + filter + aggregation  |
| `timeline_preview` | Compact timeline (reuses ViewTimeline)    | conceptKey + filter                |
| `prep_progress`    | Progress bar(s) for prep completion       | prep_item concept + filter         |
| `action_banner`    | CTA banner with button                    | Static config from displayOptions  |
| `quick_add`        | Inline form to create a record            | conceptKey determines form fields  |
| `activity_feed`    | Chronological list of recent changes      | Audit log / recent records         |

**WidgetConfig** for each:
```
WidgetConfig {
  widgetId: string
  type: (one of the above)
  title?: string
  conceptKey?: string
  filter?: Record<string, unknown>
  displayOptions?: Record<string, unknown>
}
```

**Responsive behavior:**
- Desktop layout is required. Tablet and mobile are optional overrides.
- If tablet/mobile layouts are not provided, widgets stack vertically in source order.
- Grid uses 12-column system. `WidgetLayout.x` and `w` are column units. `y` and `h` are row units.

**Each widget:**
- Renders inside a card container with optional title header.
- Fetches its own data based on `conceptKey` and `filter`.
- Shows loading skeleton while data loads.
- Shows error state if data fetch fails (does not crash the dashboard).

### Acceptance Criteria

- [ ] Dashboard renders all widgets from `PageConfig.widgets`.
- [ ] Widgets are positioned according to `breakpoints.desktop` layout on desktop viewports.
- [ ] Widgets reflow to tablet/mobile layout at the correct breakpoints, or stack vertically if no override is defined.
- [ ] Each of the 8 widget types renders its expected content.
- [ ] `stat_card` shows a numeric value with label.
- [ ] `data_table` reuses the table renderer with compact styling.
- [ ] `chart` renders the correct chart type from `displayOptions.chartType`.
- [ ] `prep_progress` shows progress bar(s) with percentage.
- [ ] `quick_add` submits a new record via POST and refreshes the relevant widget(s).
- [ ] `activity_feed` lists recent changes in reverse chronological order.
- [ ] Widget data fetch failures display an error state within the widget card, not a page-level crash.
- [ ] Loading skeletons appear while widget data is in flight.

---

## 6. View Presets

### Purpose

Let users apply named filter combinations instantly and save their own for reuse.

### Detail

**Data model:** `ViewPreset` from `ViewConfig.presets`:
```
ViewPreset {
  name: string                        // e.g., "JP Guests Only", "Overdue Prep Items"
  filter: Record<string, unknown>     // filter state to apply
}
```

**Preset types:**
- **Shared presets:** Defined in ViewConfig by admins. Visible to all users viewing this concept. Stored in the ontology alongside the ViewConfig.
- **Personal presets:** Created by individual users. Stored in a `user_view_presets` Postgres table keyed by `(userId, viewConfigId, presetName)`.

**UI:**
- Preset selector dropdown above the view (table, kanban, timeline -- not dashboard).
- "Save Current Filters as Preset" button when active filters differ from any existing preset.
- Shared presets appear first, separated from personal presets by a divider.
- Admins see a "Save as Shared Preset" option in addition to personal save.

**Behavior:**
- Selecting a preset applies its `filter` to the current view, replacing any active filter state.
- Active preset name is highlighted in the dropdown.
- Clearing filters deselects any active preset.
- Deleting a personal preset removes it from the dropdown. Shared presets can only be removed by admins (via ontology config).

### Acceptance Criteria

- [ ] Shared presets from `ViewConfig.presets` appear in the preset dropdown.
- [ ] Selecting a preset applies its filter state to the current view.
- [ ] Active preset is visually indicated in the dropdown.
- [ ] Users can save current filter state as a personal preset with a custom name.
- [ ] Personal presets persist across sessions (stored in Postgres).
- [ ] Admins can save shared presets visible to all users.
- [ ] Clearing all filters deselects the active preset.
- [ ] Personal presets can be deleted by their owner.

---

## 7. DynamicView Component

### Purpose

Single entry point component that reads a ViewConfig from the ontology store and renders the correct view type with full filter/sort/pagination support.

### Detail

**API:**
```vue
<DynamicView concept="guest" viewName="default" />
```

**Props:**
| Prop       | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `concept`  | string | yes      | Concept key (e.g., `guest`, `session`, `venue`)  |
| `viewName` | string | yes      | View name within the concept (e.g., `default`, `by-status`) |
| `filters`  | object | no       | Override filters passed from parent (merged with ViewConfig.filters) |

**Internal flow:**
1. On mount, read `ViewConfig` from `ontologyStore.getViewConfig(concept, viewName)`.
2. Resolve `viewType` to renderer component (`ViewTable`, `ViewKanban`, `ViewTimeline`, `ViewDetail`, `ViewDashboard`).
3. Fetch data from `/api/domains/:concept` with filters and sort as query params.
4. Pass data + config to the renderer component.
5. Handle pagination (offset/limit params to API).
6. Expose filter/sort state as reactive refs for the preset UI to bind to.

**Error handling:**
- Missing ViewConfig: render error message with concept/viewName for debugging.
- API failure: render empty state with retry button (same pattern as current DomainListView).
- Missing required config fields (e.g., kanban without `groupBy`): render warning with specific guidance.

**Reactivity:**
- Changing `concept` or `viewName` prop triggers full re-fetch.
- Changing filters or sort triggers data re-fetch but preserves the renderer.

### Acceptance Criteria

- [ ] `<DynamicView concept="guest" viewName="default" />` renders the view type defined in the matching ViewConfig.
- [ ] Component reads ViewConfig from ontology store, not from props.
- [ ] Data is fetched from the correct API endpoint with filters and sort applied.
- [ ] Pagination params are sent to the API and paginator UI updates accordingly.
- [ ] Changing `concept` or `viewName` re-fetches config and data.
- [ ] Override `filters` prop merges with ViewConfig.filters.
- [ ] Missing ViewConfig shows a descriptive error, not a blank screen.
- [ ] API errors show retry button with toast notification.

---

## 8. Test Plan

### Purpose

Verify each view type renders correctly and all interactive behaviors work end-to-end.

### Detail

**Unit tests (Vitest + Vue Test Utils):**

| Test                              | Asserts                                                        |
|-----------------------------------|----------------------------------------------------------------|
| DynamicView dispatches viewType   | Correct renderer component is mounted for each viewType value  |
| DynamicView unknown viewType      | Falls back to ViewTable                                        |
| ViewTable column rendering        | Columns match ViewConfig.columns in count, order, and field    |
| ViewTable sortable/filterable     | Sort and filter controls appear only on enabled columns        |
| ViewTable editable cells          | Cell editor activates; blur triggers PATCH request             |
| ViewTable rowAction navigate      | Row click calls router.push with correct path                  |
| ViewTable pagination              | Paginator renders when records exceed page size                |
| ViewKanban column grouping        | Correct number of columns for groupBy option values            |
| ViewKanban card content           | Cards display expected fields from ViewConfig.columns          |
| ViewKanban drag-and-drop          | Moving card triggers PATCH with new groupBy value              |
| ViewKanban drag failure revert    | Failed PATCH reverts card to original column                   |
| ViewTimeline bar positioning      | Events with start+end render bars at correct x positions       |
| ViewTimeline point markers        | Events with start only render as points                        |
| ViewTimeline click                | Click navigates to detail or shows popover                     |
| ViewDashboard widget rendering    | All widgets from PageConfig render in the grid                 |
| ViewDashboard responsive layout   | Desktop/tablet/mobile breakpoints apply correct WidgetLayout   |
| ViewDashboard stat_card           | Displays numeric value and label                               |
| ViewDashboard quick_add           | Form submission creates record via POST                        |
| ViewDashboard widget error        | Failed widget shows error state, others unaffected             |
| ViewPreset selection              | Selecting preset applies its filter to the view                |
| ViewPreset save personal          | Saving preset persists to Postgres and appears in dropdown     |
| ViewPreset delete personal        | Deleted preset removed from dropdown                           |

**Integration tests (Cypress or Playwright):**

| Test                              | Asserts                                                        |
|-----------------------------------|----------------------------------------------------------------|
| Table full flow                   | Load page, verify columns, sort a column, filter, paginate     |
| Kanban drag flow                  | Load kanban, drag card, verify API call, verify card moved     |
| Timeline navigation               | Load timeline, zoom in/out, click event, verify navigation     |
| Dashboard load                    | Load dashboard page by slug, verify all widgets render         |
| Preset round-trip                 | Apply preset, verify filter, save new preset, reload, verify   |

### Acceptance Criteria

- [ ] All unit tests pass in CI.
- [ ] All integration tests pass in CI.
- [ ] No test relies on external services (API calls are mocked in unit tests).
- [ ] Integration tests use seeded Postgres data, not production.
- [ ] Test coverage includes error/empty states for every view type.
