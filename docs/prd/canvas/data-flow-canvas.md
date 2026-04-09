# Data Flow Canvas

> Field-level data routing visualization on a spatial canvas. Source concepts on the left, transform nodes in the
> middle, destination concepts on the right. Auto-generated from the `data_routes` table -- no manual drawing needed
> for existing routes. Expand concepts to see individual fields, drag between fields to create mappings, drop
> transforms onto edges to insert processing nodes. PII indicators on every sensitive field. Live data animation
> from observability metrics. A sub-view of the system graph, not a standalone screen.

---

## Overview

Data routing (`data-infrastructure/data-routing.md`) defines how data fans out from one concept to many destinations. The configuration lives in the `data_routes` table as rows with field mappings, transform references, and PII filter modes. Today, understanding a routing topology requires reading JSON field mappings and cross-referencing transform definitions -- there is no visual representation.

The Data Flow Canvas renders the routing graph spatially: source concepts appear on the left, transform nodes in the middle, and destination concepts on the right. Edges connect source fields to destination fields through optional transform nodes. The canvas is auto-generated from existing route data -- no manual drawing is required to see the current state. Users can also create and edit routes directly on the canvas by dragging connections between concepts and fields.

This is a **parallel interface** to the builder. Both read and write the same `data_routes`, `data_transforms`, `ontology_concepts`, and `ontology_properties` tables. Canvas edits produce the same audit trail, go through the same CI/QA pipeline, and respect the same RBAC permissions as builder edits.

**Dependencies:**
- `canvas/canvas-engine.md` -- rendering engine, layout algorithms, interaction primitives
- `canvas/canvas-config-bridge.md` -- bidirectional binding between canvas state and config tables
- `canvas/canvas-rbac.md` -- visibility and edit permissions on canvas elements
- `data-infrastructure/data-routing.md` -- route definitions, field mappings, PII filter modes
- `data-infrastructure/data-transforms.md` -- transform chain definitions
- `data-infrastructure/data-lineage.md` -- lineage graph structure (node/edge format)
- `data-infrastructure/data-observability.md` -- pipeline health metrics for live data animation
- `data-infrastructure/real-time.md` -- SSE for live updates when routes change
- `core/rbac-engine.md` -- field-level permission enforcement
- `core/ontology-ci-qa.md` -- CI/QA pipeline for change validation
- `core/event-bus.md` -- domain events for route mutations

---

## 1. Visualization Model

### Purpose

Define the spatial layout of data flow elements on the canvas -- how source concepts, transforms, and destination concepts are arranged and connected.

### Detail

The data flow canvas uses a **left-to-right directed graph layout** with three columns:

```
 SOURCE (left)          TRANSFORMS (middle)        DESTINATIONS (right)
+----------------+     +------------------+       +------------------+
| Guest          |     | pii_strip        |       | PR Profile       |
|   name       --|---->|                  |------>|   display_name   |
|   email      --|--+  +------------------+       |   public_bio     |
|   bio        --|--|-->| format (truncate)|------>|   profile_image  |
|   photo_url  --|--+   +------------------+       +------------------+
|   flight_num --|--+
|   dietary    --|--|   +------------------+       +------------------+
+----------------+  +-->| guest-to-xport   |------>| Transport Brief  |
                    |   | compute(pickup)  |       |   pickup_label   |
                    +-->| format (date)    |------>|   arrival_display |
                        +------------------+       +------------------+
```

**Node types:**

| Node Type | Visual | Data Source |
|-----------|--------|-------------|
| `source_concept` | Rounded rectangle, left column, expandable to show fields | `ontology_concepts` where concept is a route source |
| `dest_concept` | Rounded rectangle, right column, expandable to show fields | `ontology_concepts` where concept is a route destination |
| `transform` | Diamond or hexagonal node, middle column | `data_transforms` referenced by routes |
| `pii_filter` | Shield icon node, appears when `pii_filter_mode != 'pass'` | Route's `pii_filter_mode` config |
| `field` | Row inside an expanded concept node | `ontology_properties` for the concept |

**Edge types:**

| Edge Type | Visual | Meaning |
|-----------|--------|---------|
| `route` | Solid directional arrow | Data flow from source concept to destination concept |
| `field_mapping` | Thin solid line, visible when concepts are expanded | Specific field-to-field mapping within a route |
| `transform_input` | Dashed arrow into transform node | Data entering a transform |
| `transform_output` | Dashed arrow out of transform node | Data leaving a transform |

**Layout algorithm:** Sugiyama-style layered layout with the three fixed columns. Within each column, nodes are ordered to minimize edge crossings. The canvas engine (`canvas-engine.md`) provides the layout primitives; this PRD defines the column assignment and ordering constraints.

### Acceptance Criteria

- [ ] Source concepts render in the left column, transforms in the middle, destinations on the right
- [ ] Edges flow left-to-right with directional arrows
- [ ] Expanding a concept node reveals its fields as individual rows
- [ ] Field-level edges are visible only when both source and destination concepts are expanded
- [ ] Transform nodes appear between their source and destination concepts
- [ ] PII filter nodes appear automatically when a route has `pii_filter_mode != 'pass'`
- [ ] Layout algorithm minimizes edge crossings within each column

---

## 2. Auto-Generation from Route Data

### Purpose

Render the routing graph automatically from the `data_routes` table without requiring manual drawing.

### Detail

When the data flow canvas loads, it queries the route configuration and builds the visual graph:

**Data sources:**

```
GET /api/data-routes?enabled=true&source={conceptKey}&dept={dept}
GET /api/data-transforms/{transformId}  (for each referenced transform)
GET /api/ontology/concepts/{conceptKey}/properties  (for field-level detail)
```

**Graph construction algorithm:**

1. Fetch all enabled routes matching the current scope (department filter, concept filter).
2. For each route:
   a. Create or reuse a source concept node (keyed by `source_concept_key`).
   b. Create or reuse a destination concept node (keyed by `dest_concept_key`).
   c. If `transform_id` or `inline_transforms` exists, create a transform node.
   d. If `pii_filter_mode` is `strip` or `hash`, create a PII filter node.
   e. Create edges: source -> pii_filter -> transform -> destination.
3. Run the layout algorithm to position all nodes.
4. Render the graph on the canvas.

**Scope controls:** The canvas provides filter controls at the top:
- **Department filter:** Show routes owned by a specific department or all departments.
- **Source concept filter:** Show routes from a specific source concept.
- **Destination concept filter:** Show routes to a specific destination concept.
- **PII filter:** Highlight or isolate routes that handle PII fields.

**No manual drawing required:** Existing routes are always rendered. The user can then modify the graph by adding new routes, fields, or transforms (see section 6). The canvas state is always derivable from the `data_routes` table -- the canvas does not store its own topology.

### Acceptance Criteria

- [ ] Canvas auto-renders all enabled routes for the current scope on load
- [ ] Scope filters narrow the visible routes without requiring a page reload
- [ ] Adding a route via the builder API causes the canvas to update in real-time (via SSE)
- [ ] Disabling a route removes it from the canvas visualization
- [ ] The graph is fully reconstructible from route data -- no canvas-specific topology storage
- [ ] Empty state: "No data routes configured. Create a route by dragging from a source concept to a destination." with a link to the builder route creation form

---

## 3. Field-Level Detail

### Purpose

Allow users to expand concept nodes to see individual fields and draw field-level connections to create or inspect field mappings.

### Detail

**Collapsed state (default):** A concept node shows the concept name, icon, field count, and a summary of connected routes (e.g., "3 routes out, 1 route in"). Edges connect at the concept level.

**Expanded state:** Clicking a concept node or pressing the expand chevron reveals all fields as rows inside the node. Each field row shows:

| Element | Content |
|---------|---------|
| Field name | Property label from ontology (human-readable) |
| Type indicator | Small icon for the property type (text, number, date, etc.) |
| PII indicator | Lock icon if `ontology_properties.encrypted = true` |
| Connection dots | Left dot (input) and right dot (output) for dragging connections |

**Field-level edges:** When both source and destination concepts are expanded, the route-level edge dissolves into individual field mapping edges. Each edge corresponds to one entry in the route's `field_mappings` JSONB:

```
Source field "name" -----> Destination field "display_name"
Source field "bio"  -----> Destination field "public_bio"
```

Fields that are in `source_fields` but not in `field_mappings` (excluded by PII filtering or not mapped) show with a dimmed connection dot.

**Unmapped fields:** Fields on the destination concept that have no incoming mapping show with an empty connection dot and a subtle "unmapped" label. This helps users identify incomplete routes.

### Acceptance Criteria

- [ ] Concept nodes toggle between collapsed and expanded states
- [ ] Expanded nodes show all fields from `ontology_properties` for the concept
- [ ] Field rows display the property label, type icon, and PII indicator
- [ ] Route-level edges dissolve into field-level edges when both endpoints are expanded
- [ ] Each field mapping edge corresponds to one entry in `field_mappings` JSONB
- [ ] Unmapped destination fields are visually distinguished
- [ ] PII fields show a lock icon regardless of collapsed/expanded state
- [ ] Expanding a concept does not change the layout of other nodes (the expanded node grows in place)

---

## 4. Transform Visualization

### Purpose

Render transform chains as intermediate nodes between source and destination concepts, with clickable editing.

### Detail

**Transform node display:** Each transform referenced by a route renders as a node in the middle column. The node shows:

| Element | Content |
|---------|---------|
| Transform name | `data_transforms.name` or "Inline Transform" for inline transforms |
| Transform type summary | List of transform types in the chain (e.g., "pii_strip -> rename -> format") |
| Step count | Number of transforms in the chain |
| Status indicator | Green dot if the transform is `active`, yellow if `deprecated` |

**Transform chain expansion:** Clicking a transform node expands it to show each step in the chain as a sub-row:

```
+----------------------------+
| guest-to-pr-profile        |
|   1. pii_strip             |
|   2. field_rename: name -> display_name |
|   3. format: bio (truncate 280) |
|   4. conditional: type=JP   |
|   5. static: source=gr-ops  |
+----------------------------+
```

Each step shows its type and a one-line summary of its configuration. Clicking a step opens a side panel with the full transform configuration editor (same editor used in the builder, loaded via the config bridge).

**PII filter as transform node:** When a route has `pii_filter_mode = 'strip'` or `'hash'`, a dedicated PII filter node appears before the transform node in the pipeline. This node shows:
- Mode: "Strip PII" or "Hash PII"
- Fields affected: list of encrypted fields that will be filtered
- Shield icon with red accent

**Edge routing through transforms:** When transforms exist, the source-to-destination edge is split:
```
Source concept --> PII filter node --> Transform node --> Destination concept
```

Each segment is a separate edge with directional arrows.

### Acceptance Criteria

- [ ] Transform nodes render in the middle column with name and type summary
- [ ] Clicking a transform node expands to show individual chain steps
- [ ] Clicking a chain step opens the transform configuration editor in a side panel
- [ ] PII filter nodes appear before transform nodes when `pii_filter_mode != 'pass'`
- [ ] PII filter nodes show the filter mode and affected fields
- [ ] Edges route through transform and PII filter nodes in the correct pipeline order
- [ ] Deprecated transforms show a yellow status indicator
- [ ] Inline transforms display as "Inline Transform" with the chain steps visible on expansion

---

## 5. PII Indicators

### Purpose

Make PII classification and handling visually explicit on the data flow canvas so users can see where sensitive data flows and where it is filtered.

### Detail

**Field-level PII indicators:**

| Visual | Condition |
|--------|-----------|
| Lock icon (closed) | Field has `ontology_properties.encrypted = true` |
| Lock icon (open) | Field is PII but the route passes it through (`pii_filter_mode = 'pass'`) |
| No lock icon | Field is not classified as PII |

**Route-level security badge:** A route that includes any PII field in its `source_fields` shows a security badge on the route edge:

| Badge | Condition |
|-------|-----------|
| Green shield | All PII stripped (`pii_filter_mode = 'strip'`) |
| Yellow shield | PII hashed (`pii_filter_mode = 'hash'`) |
| Red shield | PII passed through (`pii_filter_mode = 'pass'`) |
| No badge | No PII fields in the route's source fields |

**PII flow highlighting:** A toggle control "Highlight PII Flows" on the canvas toolbar enables a mode where:
- All PII field rows are highlighted with a red border
- All edges carrying PII data are drawn with a thicker, red-accented stroke
- Non-PII edges are dimmed
- PII filter nodes pulse with a subtle animation

This mode helps security reviewers audit PII handling across the routing topology.

**PII classification tooltip:** Hovering over a PII lock icon shows a tooltip:
```
Classification: PII (encrypted at rest)
Filter mode on this route: strip
This field is removed before reaching the destination.
```

### Acceptance Criteria

- [ ] PII fields display a lock icon in both collapsed and expanded concept views
- [ ] Lock icon distinguishes between stripped and passed-through PII
- [ ] Route edges show the correct security badge based on PII filter mode
- [ ] "Highlight PII Flows" toggle dims non-PII edges and emphasizes PII paths
- [ ] PII tooltips explain the classification and filter mode in plain language
- [ ] The canvas renders correctly when no PII fields exist (no badges, no lock icons)

---

## 6. Fan-Out Visualization

### Purpose

Clearly display one-to-many data flows where a single source field connects to multiple destination fields or concepts.

### Detail

When a source field is mapped to multiple destinations (via separate routes), the canvas renders a **fan-out pattern**:

```
                          +-> PR Profile: display_name
Guest: name ----+---------+
                          +-> Transport Brief: guest_name
                          +-> Schedule Entry: speaker_name
```

**Visual treatment:**
- The source field's output dot has a small "3" badge indicating the fan-out count.
- Edges from the source dot split at a junction point, then diverge to each destination.
- Each edge is individually selectable and shows the route name on hover.

**Fan-out summary:** When a concept node is collapsed, the concept-level edge shows a count label: "3 routes" or "12 field mappings". This gives a quick sense of the data distribution complexity.

**One-to-many at the concept level:** When multiple routes share the same source concept but target different destination concepts, the source concept has multiple outgoing edges. The layout algorithm spaces these edges to avoid overlap.

### Acceptance Criteria

- [ ] Fan-out from a single source field to multiple destinations renders as branching edges
- [ ] Fan-out count badge appears on the source field's output dot
- [ ] Each fan-out edge is individually selectable and shows route name on hover
- [ ] Collapsed concept nodes show route/mapping count labels on edges
- [ ] Layout algorithm prevents edge overlap on fan-out patterns
- [ ] Fan-out of 10+ routes from a single source concept remains readable (edges spaced, scrollable)

---

## 7. Canvas Editing

### Purpose

Define the interactions for creating and modifying data routes directly on the canvas.

### Detail

All canvas edits go through the canvas-config bridge (`canvas/canvas-config-bridge.md`), which translates canvas actions into config mutations. All mutations go through the CI/QA pipeline (`core/ontology-ci-qa.md`) and produce audit trail entries.

**7.1 Create Route: Drag from Source to Destination**

1. User drags from a source concept node's output handle to a destination concept node's input handle.
2. Canvas shows a temporary dashed edge during the drag.
3. On drop, the **route creation wizard** opens as a side panel:
   - Source concept (pre-filled)
   - Destination concept (pre-filled)
   - Route name (auto-suggested: "{source}-to-{dest}")
   - PII filter mode (default: `strip`)
   - Execution mode (default: `async`)
   - Transform selection (optional, from existing transforms or create inline)
4. On wizard completion, the config bridge calls `POST /api/data-routes` with the route definition.
5. The new route appears on the canvas after the CI/QA pipeline validates and applies the change.

**7.2 Map Fields: Drag from Source Field to Destination Field**

1. User expands both source and destination concept nodes.
2. User drags from a source field's output dot to a destination field's input dot.
3. Canvas shows a temporary dashed edge during the drag.
4. On drop, if a route already exists between these concepts:
   - The field mapping is added to the existing route's `field_mappings` JSONB.
   - Config bridge calls `PUT /api/data-routes/:id` with the updated field mappings.
5. On drop, if no route exists:
   - The route creation wizard opens (same as 7.1) with the field mapping pre-filled.

**7.3 Add Transform: Drag from Palette onto Edge**

1. A transform palette panel on the canvas sidebar lists available transforms (standalone from `data_transforms` table) and a "New Inline Transform" option.
2. User drags a transform from the palette onto an existing route edge.
3. The edge highlights to indicate it can accept a transform drop.
4. On drop:
   - If the route has no transform: set `transform_id` to the dropped transform's ID.
   - If the route already has a transform: prompt to replace or chain (append to existing chain).
5. Config bridge calls `PUT /api/data-routes/:id` with the updated transform reference.

**7.4 Configure PII: Right-Click Field**

1. User right-clicks a field row inside an expanded concept node.
2. Context menu shows:
   - "Set Classification" -> submenu: PII / Sensitive / Internal / Public
   - "View Lineage" (opens lineage trace for this field)
   - "View Routes" (highlights all routes using this field)
3. Selecting a classification updates `ontology_properties.encrypted` (for PII) or a new `classification` metadata field.
4. Config bridge calls the ontology update API. Change goes through CI/QA pipeline.

**All edits produce:**
- Audit trail entry via `withAuditContext` / `logAuditClaim`
- Domain event via event bus
- CI/QA validation (low-risk additive changes auto-apply; high-risk changes enter review queue)

### Acceptance Criteria

- [ ] Dragging from source to destination concept opens the route creation wizard
- [ ] Dragging from source field to destination field creates a field mapping on the existing route
- [ ] Dragging from source field to destination field with no existing route opens the route creation wizard
- [ ] Dragging a transform from the palette onto a route edge inserts the transform
- [ ] Right-clicking a field shows a context menu with PII classification options
- [ ] All canvas edits go through the CI/QA pipeline
- [ ] All canvas edits produce audit trail entries
- [ ] Route creation wizard pre-fills source and destination from the drag action
- [ ] Temporary dashed edges display during drag operations for visual feedback
- [ ] Invalid drop targets (e.g., dragging onto a non-concept node) reject the drop with visual feedback

---

## 8. Data Flow Animation

### Purpose

Visualize real-time data movement along route edges using animated particles driven by data observability metrics.

### Detail

**Toggle control:** A "Show Live Data" toggle on the canvas toolbar enables data flow animation. Off by default to avoid visual noise during editing.

**Animation model:** When enabled, the canvas fetches observability metrics from `data-infrastructure/data-observability.md`:

```
GET /api/observability/pipeline-health?type=route&enabled=true
```

For each active route with recent execution data:

| Metric | Animation Effect |
|--------|-----------------|
| `lastRunRecordsProcessed > 0` | Animated dots flow along the route edge from source to destination |
| `throughput` (records/minute) | Dot speed and density proportional to throughput |
| `lastRunStatus = 'success'` | Green dots |
| `lastRunStatus = 'partial_failure'` | Yellow dots |
| `lastRunStatus = 'failure'` | Red dots, static (not flowing) |
| `isOverdue` | Edge pulses with a red warning glow |

**Particle system:** Each flowing dot represents a batch of records processed. Higher throughput = more dots, faster movement. This gives an intuitive sense of data volume and velocity.

**Refresh interval:** Animation data refreshes every 30 seconds from the observability API. The animation interpolates between data points for smooth visual continuity.

**Performance:** Animation uses requestAnimationFrame and canvas-level rendering (not DOM elements per particle). The canvas engine handles the rendering loop.

### Acceptance Criteria

- [ ] "Show Live Data" toggle enables and disables the animation
- [ ] Animated dots flow along route edges in the direction of data flow
- [ ] Dot color reflects the route's last execution status (green/yellow/red)
- [ ] Dot speed and density reflect throughput metrics
- [ ] Overdue routes show a pulsing red warning on the edge
- [ ] Routes with no recent execution show static edges (no animation)
- [ ] Animation refreshes every 30 seconds without jarring visual transitions
- [ ] Animation does not degrade canvas interaction performance (targeting 60fps)

---

## 9. Integration with System Graph

### Purpose

Define how the data flow canvas relates to the broader system graph canvas and how users navigate between them.

### Detail

The data flow canvas is a **sub-view** of the system graph canvas (`canvas/canvas-engine.md`). The system graph shows concepts as nodes and relationships as edges at a high level. Data flow edges are one type of relationship visible on the system graph.

**Navigation from system graph to data flow canvas:**

1. On the system graph, data flow relationships between concepts are rendered as a distinct edge type (dashed line with a data-flow icon).
2. Clicking a data flow edge opens the data flow canvas, focused on that specific source-destination pair.
3. The data flow canvas loads with the source concept on the left, destination concept on the right, and all routes between them visible.
4. A "Back to System Graph" breadcrumb allows returning to the system graph view.

**Navigation from data flow canvas to system graph:**

1. The breadcrumb trail shows: System Graph > Data Flow: {source} -> {dest}
2. Clicking "System Graph" returns to the system graph, centered on the source concept.

**Deep linking:** The data flow canvas URL includes the scope:
```
/canvas/data-flow?source=guest&dest=pr_guest_profile
/canvas/data-flow?dept=guest-relations
/canvas/data-flow  (all routes, filtered by user's RBAC)
```

### Acceptance Criteria

- [ ] Data flow edges on the system graph are visually distinct from relationship edges
- [ ] Clicking a data flow edge on the system graph opens the data flow canvas for that pair
- [ ] Breadcrumb trail enables navigation back to the system graph
- [ ] Deep link URLs load the correct scope and filters
- [ ] Data flow canvas respects the same RBAC rules as the system graph (canvas-rbac.md)

---

## 10. UX Checklist Compliance

### Purpose

Verify the data flow canvas meets all UX requirements from `process/ux-checklist.md`.

### Detail

**The Four Questions:**

| Question | Answer on Data Flow Canvas |
|----------|---------------------------|
| What is this? | Page title: "Data Flow Canvas" + subtitle: "Visualize how data routes from source concepts to destinations" |
| Why am I here? | Breadcrumb: System Graph > Data Flow: {scope description} |
| What can I do? | Toolbar actions: zoom, filter, "Show Live Data" toggle, transform palette. Edit handles on nodes when user has edit permissions. |
| What happens when I do it? | Drag feedback (dashed edge), wizard panels, success/error toasts, CI/QA status indicators on affected nodes. |

**Empty States:**

| Scenario | Message |
|----------|---------|
| No routes exist | "No data routes configured. Drag from a source concept to a destination concept to create your first route, or use the builder to define routes." |
| No routes match filters | "No routes match your current filters. Try adjusting the department or concept filters." |
| No permission to view | "You do not have access to view data routes. Contact your department director." |

**Loading States:**
- Canvas shows a skeleton layout with placeholder node shapes while route data loads.
- Transform palette shows a loading spinner while transforms load.
- "Show Live Data" toggle is disabled until observability data loads.

**Error Handling:**
- Route creation failure: toast with "Unable to create route: {validation error}". The temporary dashed edge reverts.
- Field mapping failure: toast with "Unable to add field mapping: {error}". The temporary edge reverts.
- SSE disconnection: "Connection lost" banner at the top of the canvas. Editing disabled. Last-known state displayed.

**Accessibility:**
- All nodes are keyboard-navigable (Tab to move between nodes, Enter to expand/select).
- Edges are not individually focusable but are described via node tooltips ("Connected to: PR Profile via 3 field mappings").
- ARIA labels on toolbar buttons and filter controls.
- Status indicators (PII, security badges) use icon + color, never color alone.

### Acceptance Criteria

- [ ] Page title and breadcrumbs are visible without scrolling
- [ ] Empty states are defined for all three scenarios (no data, no matches, no permission)
- [ ] Loading skeleton renders within 100ms of page load
- [ ] All toolbar buttons have ARIA labels
- [ ] PII indicators use icon + color, never color alone
- [ ] Error messages display as toasts with plain-language text
- [ ] Keyboard navigation reaches all interactive elements

---

## 11. Test Plan

### 11.1 Visualization Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-01 | Unit | Render graph from 1 route with 3 field mappings | Source on left, destination on right, 3 field-level edges |
| DFC-02 | Unit | Render graph from 5 routes sharing 1 source concept | 1 source node, 5 destination nodes, edges do not overlap |
| DFC-03 | Unit | Render route with transform and PII filter | 4 nodes in pipeline: source -> PII filter -> transform -> destination |
| DFC-04 | Unit | Expand concept node | Fields displayed as rows, field-level edges replace route-level edge |
| DFC-05 | Unit | Collapse concept node | Fields hidden, field-level edges merge back to route-level edge |
| DFC-06 | Unit | Fan-out: 1 source field mapped to 3 destinations | Branching edges with fan-out count badge "3" |
| DFC-07 | Unit | PII field indicator | Lock icon appears on fields with `encrypted = true` |
| DFC-08 | Unit | Security badge on route | Green shield for strip, yellow for hash, red for pass |

### 11.2 Auto-Generation Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-09 | Integration | Load canvas with 10 enabled routes | All 10 routes rendered with correct topology |
| DFC-10 | Integration | Disable a route via builder API | Route disappears from canvas within SSE refresh interval |
| DFC-11 | Integration | Apply department filter | Only routes owned by that department are visible |
| DFC-12 | Integration | Apply source concept filter | Only routes from that source concept are visible |
| DFC-13 | Integration | No routes exist | Empty state message displayed |

### 11.3 Editing Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-14 | Integration | Drag from source concept to destination concept | Route creation wizard opens with pre-filled concepts |
| DFC-15 | Integration | Complete route creation wizard | New route appears on canvas, audit log entry created |
| DFC-16 | Integration | Drag from source field to destination field (route exists) | Field mapping added to existing route |
| DFC-17 | Integration | Drag from source field to destination field (no route) | Route creation wizard opens with pre-filled field mapping |
| DFC-18 | Integration | Drag transform from palette onto route edge | Transform assigned to route, transform node appears |
| DFC-19 | Integration | Right-click field -> Set Classification -> PII | Lock icon appears, CI/QA pipeline triggered |
| DFC-20 | Integration | Canvas edit fails CI/QA validation | Error toast, temporary edge reverts, affected node shows red X |

### 11.4 Animation Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-21 | Integration | Enable "Show Live Data" with active routes | Animated dots flow along route edges |
| DFC-22 | Unit | Route with `lastRunStatus = 'failure'` | Red static dots on the edge |
| DFC-23 | Unit | Route with `isOverdue = true` | Edge pulses with red warning glow |
| DFC-24 | Unit | "Show Live Data" disabled | No animation, static edges |

### 11.5 Navigation Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-25 | Integration | Click data flow edge on system graph | Data flow canvas opens focused on that source-destination pair |
| DFC-26 | Integration | Click "Back to System Graph" breadcrumb | Returns to system graph centered on source concept |
| DFC-27 | Integration | Deep link `/canvas/data-flow?source=guest` | Canvas loads with guest as source filter |

### 11.6 RBAC Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| DFC-28 | Integration | Coordinator with view-only permission opens canvas | No edit handles, no drag capability, "View only" tooltips |
| DFC-29 | Integration | Volunteer opens canvas | See-only mode, informational display |
| DFC-30 | Integration | Director drags route between own department concepts | Route creation wizard opens, route created successfully |
| DFC-31 | Integration | Coordinator attempts to drag between concepts without edit permission | Drop rejected with "Insufficient permissions" message |

### 11.7 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| Canvas with 50 routes, 200 field mappings | Initial render | < 2 seconds to first interactive render |
| Expand concept with 30 fields | Click expand | < 200ms to show field rows and redraw edges |
| "Show Live Data" with 50 animated routes | 60fps animation loop | No frame drops below 30fps |
| SSE update while user is editing | Concurrent edit + incoming change | No canvas freeze, merge without losing local state |

**Coverage target:** >=80% on graph construction, layout algorithm, and edit interaction handlers. 100% on PII indicator logic and RBAC enforcement for edit actions.

---

## 12. Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/canvas-engine.md` | Rendering engine, layout primitives, interaction model |
| `canvas/canvas-config-bridge.md` | Bidirectional binding: canvas actions -> config mutations, config changes -> canvas updates |
| `canvas/canvas-rbac.md` | Visibility and edit permission enforcement on canvas elements |
| `data-infrastructure/data-routing.md` | Source data: `data_routes` table, field mappings, PII filter modes |
| `data-infrastructure/data-transforms.md` | Transform definitions for transform nodes |
| `data-infrastructure/data-observability.md` | Pipeline health metrics for live data animation |
| `data-infrastructure/real-time.md` | SSE push for route changes |
| `core/rbac-engine.md` | `getVisibleProperties()`, `canPerformAction()` for field/action filtering |
| `core/ontology-ci-qa.md` | CI/QA pipeline for canvas edit validation |
| `core/event-bus.md` | Domain events for route mutations |
| `core/audit-system.md` | Audit trail for canvas edits |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Left-to-right layout with three fixed columns | Matches the mental model of data flow: source -> process -> destination. Consistent with data mapping tools users may already know. |
| Auto-generation from `data_routes` table, no canvas-specific topology | Canvas is a view of the config, not a separate data store. This ensures canvas and builder always agree. |
| PII filter as a separate visual node | Makes PII handling explicit and auditable on the canvas. Security reviewers can see at a glance where PII is stripped. |
| "Show Live Data" off by default | Animation is useful for monitoring but distracting during editing. Defaulting to off prioritizes the editing use case. |
| Sub-view of system graph, not standalone | Reduces navigation complexity. Users discover data flows in context of the broader system, then drill in. |
| Canvas edits go through the same CI/QA pipeline as builder edits | Critical for data integrity. Parallel interfaces must not bypass governance. |
