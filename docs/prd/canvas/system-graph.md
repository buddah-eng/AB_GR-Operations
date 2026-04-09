# System Graph

> Auto-generated interactive graph view of the entire ontology. Concepts render as nodes, relationships
> render as edges, departments render as colored regions. Three zoom levels: system (departments + cross-dept
> flows), department (concepts + relationships), concept (properties + attached workflows). Editable on
> canvas — changes write directly to the ontology. Like Obsidian's graph view, but editable and RBAC-aware.

---

## Overview

The system graph is the primary canvas view. It auto-generates a node-edge graph from the ontology engine's data — concepts, relationships, properties, department scoping, data routes, and workflow attachments — without requiring manual graph construction. When an admin adds a concept in the builder, it appears on the system graph. When a user creates a relationship on the canvas, it appears in the builder.

The system graph provides three zoom levels that progressively reveal detail: system level (bird's-eye view of departments and cross-department data flows), department level (concepts and their relationships within a department), and concept level (a single concept expanded to show properties, forms, views, and attached workflows). Users navigate between levels by zooming or double-clicking.

The system graph is built on the canvas engine (`canvas/canvas-engine.md`) and uses its node types, edge types, layout algorithms, and interaction modes. It adds ontology-specific data loading, multi-zoom rendering, editing interactions, overlay toggles, and real-time synchronization.

**Dependencies:** `canvas/canvas-engine.md`, `core/ontology-engine.md`, `core/rbac-engine.md`, `data-infrastructure/data-routing.md`, `automation/workflow-engine.md`, `ui/builder-to-operator.md`

---

## Full Specification

### 1. Auto-Generation from Ontology

#### Purpose

Define how the ontology data is queried and transformed into a renderable node-edge graph.

#### Detail

The system graph does not store its own graph data. On load, it queries the ontology engine and transforms the result into Vue Flow nodes and edges:

**Data loading pipeline:**

```
1. getOntology() → OntologyCache (concepts, properties, relationships, events, constraints)
2. RBAC filter: for each concept, check roleEngine.canPerformAction(roleKey, conceptKey, 'view')
   → Remove concepts the user cannot see
3. For each visible concept → create a ConceptNode
4. For each relationship where both source and target are visible → create a RelationshipEdge
5. If data flow overlay is on: load data routes → create DataFlowEdge for each route
6. If workflow overlay is on: load workflow configs → create WorkflowEdge indicators
7. Group concepts by owner_department → create DepartmentNode containers
8. Apply layout algorithm (or load saved positions from canvas_layouts)
9. Render via canvas engine
```

**ConceptNode data mapping:**

| Ontology Field | Node Prop | Source |
|----------------|-----------|--------|
| `concept.key` | `conceptKey` | `concepts` table |
| `concept.name` | `name` | `concepts` table |
| `concept.icon` | `icon` | `concepts` table |
| `properties.length` | `propertyCount` | `properties` map |
| `relationships.length` | `relationshipCount` | `relationships` map |
| `concept.owner_department` | `department` | Ontology scoping |
| `concept.deprecated` | `status` | `concepts` table |
| `workflowConfigs.length > 0` | `hasWorkflows` | `workflow_configs` table |

**RelationshipEdge data mapping:**

| Ontology Field | Edge Prop | Source |
|----------------|-----------|--------|
| `relationship.sourceConceptKey` | `source` (node ID) | `relationships` table |
| `relationship.targetConceptKey` | `target` (node ID) | `relationships` table |
| `relationship.label` | `label` | `relationships` table |
| `relationship.cardinality` | Cardinality markers | `relationships` table |

**Refresh:** When the ontology changes (detected via SSE push from the event bus or polling with 30-second interval), the graph data is reloaded and the canvas performs a diff update — only changed nodes/edges are added, removed, or updated. Positions of unchanged nodes are preserved.

#### Acceptance Criteria

- [ ] System graph renders automatically from ontology data with no manual graph construction
- [ ] RBAC-filtered concepts are excluded from the graph entirely
- [ ] Relationships where either endpoint is filtered are also excluded
- [ ] Graph updates when ontology changes without losing user's viewport position
- [ ] Loading a 50-concept ontology produces a rendered graph in under 1 second

---

### 2. Zoom Levels

#### Purpose

Define the three semantic zoom levels that progressively reveal detail.

#### Detail

Zoom levels are triggered by the current zoom factor of the Vue Flow viewport. The transitions are smooth — as the user zooms in, nodes crossfade between their level representations.

##### 2.1 Level 1: System View (zoom < 0.4x)

The bird's-eye view. Shows the entire organizational structure.

**Visible elements:**

| Element | Rendering |
|---------|-----------|
| DepartmentNode | Large colored regions with department name and concept count |
| Cross-department DataFlowEdge | Thick edges between department regions showing data routes |
| IntegrationNode | Positioned at department boundaries where external connections exist |
| Individual ConceptNodes | Not visible (too small at this zoom) |

**Use case:** Understanding the overall system architecture. "Which departments exist? How does data flow between them? Where are external integrations?"

##### 2.2 Level 2: Department View (zoom 0.4x - 1.2x)

The working view. Shows concepts and their relationships within departments.

**Visible elements:**

| Element | Rendering |
|---------|-----------|
| ConceptNode | Full node rendering with icon, name, badges |
| RelationshipEdge | Labeled edges between concepts |
| DepartmentNode | Subtle background region (reduced opacity) |
| Workflow indicators | Small animated dots on concept nodes that have attached workflows |
| Data flow indicators | Thin dashed lines showing active data routes between concepts |

**Use case:** Understanding a department's domain model. "What concepts does Guest Relations manage? How are guests related to pairings? Which concepts have workflows?"

##### 2.3 Level 3: Concept View (zoom > 1.2x or double-click on node)

The detail view. A single concept expanded to show its internals.

**Visible elements:**

| Element | Rendering |
|---------|-----------|
| Selected ConceptNode (expanded) | Large card showing: name, description, all properties (grouped by type), attached forms, attached views, attached workflows |
| Related ConceptNodes | Normal size, positioned around the expanded node |
| RelationshipEdges | Labeled with cardinality and relationship key |
| Property list | Scrollable list inside the expanded node showing property name, type, required flag |
| Attached workflows | Listed with trigger type icon and name |
| "Open in Builder" button | Navigation link to the builder CRUD view for this concept |

**Entering Level 3:** Double-click a concept node at Level 2, or use the search bar to find and focus a concept. The canvas transitions to focused mode (from `canvas/canvas-engine.md` section 4.3).

**Exiting Level 3:** Click the background, press Escape, or zoom out past 1.2x. The canvas transitions back to Level 2 with the previously expanded node in the center.

**Zoom level transitions:**

| From | To | Trigger | Animation |
|------|----|---------|-----------| 
| Level 1 | Level 2 | Zoom in past 0.4x | Department regions fade, concept nodes fade in |
| Level 2 | Level 3 | Zoom in past 1.2x or double-click | Non-selected nodes dim, selected node expands |
| Level 2 | Level 1 | Zoom out past 0.4x | Concept nodes fade, department regions emphasized |
| Level 3 | Level 2 | Zoom out past 1.2x or press Escape | Expanded node collapses, surrounding nodes restore opacity |

#### Acceptance Criteria

- [ ] Zoom level transitions are smooth with crossfade animations
- [ ] Level 1 shows departments and cross-department flows only
- [ ] Level 2 shows concepts and relationships within departments
- [ ] Level 3 shows full concept detail including properties and workflows
- [ ] Double-clicking a node at Level 2 enters Level 3 focused on that node
- [ ] Zooming out from Level 3 returns to Level 2

---

### 3. Editing on Canvas

#### Purpose

Define how users create, modify, and delete ontology elements directly on the canvas.

#### Detail

All editing requires edit mode (from `canvas/canvas-engine.md` section 4.2) and `canvas:edit` RBAC permission. Every edit operation writes to the ontology via the domain CRUD API — the canvas is not a separate data store.

##### 3.1 Create Concept

**Trigger:** Right-click empty canvas space at Level 2 zoom.

**Flow:**

1. Context menu appears with "New Concept" option
2. User clicks "New Concept"
3. A modal dialog opens with minimal fields: name, key (auto-generated from name), icon picker, department selector (defaults to the department region the user right-clicked within)
4. User fills fields and clicks "Create"
5. Canvas calls `POST /api/domain/concepts` with the form data
6. On success: a new ConceptNode appears at the click position with a creation animation (scale from 0 to 1 over 300ms)
7. The undo stack records a `create_node` command

**Auto-generated defaults:** When a concept is created on canvas, the same default generation rules from `ui/builder-to-operator.md` section 3 apply — a default form, view, and page are auto-generated.

##### 3.2 Create Relationship

**Trigger:** Drag from one concept node's connection handle to another concept node at Level 2 zoom.

**Flow:**

1. User hovers over a concept node — connection handles appear on all four sides
2. User clicks and drags from a handle — a temporary edge follows the cursor
3. User drops on another concept node's handle
4. A relationship configuration dialog opens: label, key (auto-generated), cardinality (dropdown: has-one, has-many, many-to-many), inverse key
5. User fills fields and clicks "Create"
6. Canvas calls `POST /api/domain/relationships` with the form data
7. On success: a new RelationshipEdge appears between the two nodes
8. The undo stack records a `create_edge` command

**Validation:** The dialog prevents self-referential relationships (source = target) and duplicate relationships (same source + target + key).

##### 3.3 Edit Concept

**Trigger:** Click a concept node at Level 2 or Level 3 zoom.

**Flow:**

1. A property panel slides out from the right side of the canvas (480px wide)
2. The panel shows the same form as the builder's concept edit view — all properties, forms, views, and workflows
3. The form uses the same `FormKit` rendering and property-to-input mapping from `ui/builder-to-operator.md`
4. User edits fields and clicks "Save" (or auto-save if enabled)
5. Canvas calls `PUT /api/domain/concepts/:key` with the updated data
6. On success: the ConceptNode updates to reflect changes (name, icon, property count)
7. The undo stack records an `edit_property` command

**Read-only for view mode:** In view mode, clicking a node opens the property panel in read-only mode (all fields disabled, no save button).

##### 3.4 Delete Element

**Trigger:** Select a node or edge, then press Delete key or right-click and select "Delete."

**Flow:**

1. A confirmation dialog appears: "Deleting {element name} will trigger the deprecation pipeline. This checks for downstream dependencies, active workflows, and data routes. Continue?"
2. If the user confirms, the canvas calls the deprecation endpoint
3. The deprecation pipeline runs: impact analysis (from `data-infrastructure/data-lineage.md` section 6), CI/QA checks, cascade evaluation
4. If the pipeline approves: the element is soft-deleted (marked deprecated, not physically removed)
5. The node/edge fades out with a 300ms animation
6. The undo stack records a `delete_node` or `delete_edge` command

**Impact preview:** Before the user confirms deletion, the dialog shows an impact summary: "This concept is referenced by 3 relationships, 2 workflows, and 1 data route. Deleting it will deprecate all of them."

#### Acceptance Criteria

- [ ] Right-click on empty space offers "New Concept" in edit mode only
- [ ] Dragging between nodes creates a relationship with a configuration dialog
- [ ] Click on a node opens the property panel with the same form as builder
- [ ] Delete triggers the deprecation pipeline, not immediate removal
- [ ] Impact analysis shows downstream dependencies before deletion confirmation
- [ ] All edits write to the ontology via the domain CRUD API
- [ ] All edits are recorded in the undo stack

---

### 4. Department Visualization

#### Purpose

Define how departments are rendered as colored regions on the canvas.

#### Detail

Departments are derived from the ontology scoping model. Each concept has an `owner_department` field that determines which department region it belongs to.

**Department colors:** Each department has an assigned color stored in the ontology (or derived from a hash of the department key for auto-assignment). Colors are used for:

- DepartmentNode background fill (10% opacity)
- DepartmentNode border (30% opacity)
- RelationshipEdge stroke color (for intra-department edges)
- ConceptNode border accent

**Department layout:** When the grouped layout algorithm is active (default for Level 1), departments are arranged in a grid:

```
[Guest Relations]  [Programming]  [Public Relations]
[Registration]     [Operations]   [Art Show]
[Scheduling]       [Transport]    [Volunteers]
```

Grid dimensions are computed as `ceil(sqrt(departmentCount))` columns. Departments with more concepts get larger regions.

**Cross-department edges:** Edges that cross department boundaries are rendered with a neutral color (`--primary-color`) and routed around department regions using orthogonal routing to avoid crossing through unrelated departments.

**Department header:** Each department region shows a header bar with: department name, concept count badge, member count badge, and a collapse/expand toggle. Collapsing a department replaces it with a compact summary node.

#### Acceptance Criteria

- [ ] Each department renders as a distinctly colored region
- [ ] Concepts are grouped within their owner department's region
- [ ] Cross-department edges are visually distinct from intra-department edges
- [ ] Department regions auto-size to fit their concepts
- [ ] Department headers show name and concept count

---

### 5. Data Flow Overlay

#### Purpose

Define the toggleable data flow visualization that shows data routes between concepts.

#### Detail

The data flow overlay is activated via a toggle button in the canvas toolbar: "Show Data Flows." When enabled, it queries the data routing system and renders DataFlowEdges between concepts that have active data routes.

**Data source:** `GET /api/data-routes?enabled=true` returns all active data routes. Each route has a `source_concept_key` and `dest_concept_key` that map to ConceptNodes on the graph.

**Edge rendering per route:**

| Route Property | Edge Visualization |
|----------------|-------------------|
| `name` | Edge label |
| `source_fields` | Tooltip showing field list |
| `pii_filter_mode` | Shield icon (red=strip, green=pass, yellow=hash) |
| `execution_mode` | Solid edge for sync, dashed for async |
| `trigger_fields` | Tooltip showing trigger condition |

**Aggregation:** If multiple routes exist between the same two concepts, they are aggregated into a single thick edge with a count badge ("3 routes"). Clicking the edge expands to show individual routes in a popover.

**Direction:** DataFlowEdges are animated with flowing dots to indicate the direction of data flow (source to destination). The animation speed is constant (3 seconds per full edge traversal).

**PII indicator:** Routes with `pii_filter_mode: 'strip'` show a small red shield icon on the edge, indicating PII is being filtered. This is a critical visual cue for administrators reviewing data flow security.

**Overlay behavior:**

| State | Effect |
|-------|--------|
| Overlay off (default) | No DataFlowEdges rendered |
| Overlay on | DataFlowEdges rendered on top of RelationshipEdges |
| Overlay on + hover route | Route edge highlighted, source and destination nodes highlighted |
| Overlay on + click route | Route detail popover shows: name, field mappings, PII mode, last executed |

#### Acceptance Criteria

- [ ] Data flow overlay is off by default
- [ ] Enabling the overlay loads and renders all active data routes
- [ ] PII filter mode is visually indicated on each edge
- [ ] Multiple routes between same concepts are aggregated
- [ ] Route direction is indicated by animated flow
- [ ] Overlay can be toggled without losing the user's viewport position

---

### 6. Workflow Overlay

#### Purpose

Define the toggleable workflow visualization that shows workflow paths on the system graph.

#### Detail

The workflow overlay is activated via a toggle button in the canvas toolbar: "Show Workflows." When enabled, it queries the workflow engine and renders workflow indicators on concepts that have attached workflows.

**Data source:** `GET /api/workflow-configs?enabled=true` returns all active workflow configs. Each workflow has a `trigger.event` that identifies the triggering concept (e.g., `"guest.created"` triggers on the `guest` concept).

**Rendering:**

| Workflow Element | Visualization |
|------------------|---------------|
| Trigger concept | Pulsing glow effect on the ConceptNode border (color matches trigger type) |
| Action targets | Small arrow indicators from trigger concept to target concepts (e.g., if an action creates a `pairing` record, an arrow points from `guest` to `pairing`) |
| Workflow edge | WorkflowEdge connecting trigger concept to action target concepts |
| Cascade chains | When workflow A's action emits an event that triggers workflow B, a cascading dashed edge connects them |

**Animated flow:** Workflow edges show an animated pulse traveling from trigger to action targets. The pulse color matches the trigger type (blue for domain_event, orange for scheduled, green for manual, purple for field_changed).

**Click to drill:** Clicking a workflow edge or indicator opens a "View Workflow" popover with: workflow name, trigger description, condition summary, action list. A "Open in Workflow Canvas" button navigates to the full workflow canvas view (`canvas/workflow-canvas.md`).

**Cross-concept cascade visualization:** When "Show Cascades" is enabled (sub-toggle within the workflow overlay), the system traces workflow chains: workflow A triggers on `guest.created`, creates a `pairing` record, which emits `pairing.created`, which triggers workflow B. The cascade is rendered as a chain of connected WorkflowEdges with sequential numbering (1, 2, 3...).

#### Acceptance Criteria

- [ ] Workflow overlay is off by default
- [ ] Concepts with attached workflows show visual indicators
- [ ] Workflow edges connect trigger concepts to action target concepts
- [ ] Cascade chains are traceable across multiple workflow hops
- [ ] Clicking a workflow indicator offers navigation to the workflow canvas
- [ ] Animated pulses indicate trigger type by color

---

### 7. Real-Time Synchronization

#### Purpose

Define how the system graph stays in sync when the ontology changes outside the canvas.

#### Detail

The system graph must reflect ontology changes made via:
- The builder interface (admin adds a concept or relationship)
- The domain CRUD API (external integration creates data)
- Another user's canvas session (concurrent editing)

**Mechanism:** Server-Sent Events (SSE) from the platform's event bus. The canvas subscribes to ontology change events:

| Event | Canvas Response |
|-------|----------------|
| `concept.created` | Add new ConceptNode at auto-positioned location |
| `concept.updated` | Update ConceptNode props (name, icon, status) |
| `concept.deleted` | Remove ConceptNode with fade-out animation |
| `relationship.created` | Add new RelationshipEdge |
| `relationship.deleted` | Remove RelationshipEdge with fade-out animation |
| `workflow_config.created` | Update workflow indicators (if overlay active) |
| `workflow_config.updated` | Update workflow indicators |
| `data_route.created` | Update data flow overlay (if active) |

**SSE connection:**

```typescript
interface CanvasSSEConfig {
  readonly endpoint: '/api/events/stream'
  readonly eventFilter: 'concept.*,relationship.*,workflow_config.*,data_route.*'
  readonly reconnectInterval: 5000   // ms, with exponential backoff
  readonly maxReconnectAttempts: 10
}
```

**Conflict resolution:** If the user is actively editing a node that receives an SSE update, the update is queued and applied after the user finishes editing (saves or cancels). A notification banner shows: "This concept was updated by {actor}. Your canvas will refresh when you finish editing."

**Fallback:** If SSE is unavailable (network issues), the canvas falls back to polling the ontology endpoint every 30 seconds. A "Live sync unavailable" indicator appears in the canvas toolbar.

#### Acceptance Criteria

- [ ] Ontology changes made in builder appear on canvas within 2 seconds
- [ ] Ontology changes made on canvas appear in builder within 2 seconds
- [ ] SSE connection auto-reconnects on network interruption
- [ ] Concurrent edit conflicts are handled gracefully with user notification
- [ ] Fallback polling activates when SSE is unavailable

---

### 8. RBAC-Aware Rendering

#### Purpose

Define how RBAC permissions affect what is visible and editable on the system graph.

#### Detail

The system graph applies RBAC at multiple levels, all using the same `RoleEngine` from `core/rbac-engine.md`:

**Node visibility:**

| Role | Sees |
|------|------|
| Admin | All concepts across all departments |
| Director | Own department's concepts + org-wide concepts + cross-department data flows |
| Manager | Own department's concepts |
| Liaison | Concepts they have `canView` permission for |
| Volunteer | Concepts they have `canView` permission for (typically read-only) |

**Data scope interaction:** The system graph shows concepts (schema-level), not records (data-level). Data scoping (`buildDataScopeFilter`) does not apply to graph rendering — it applies when the user drills into a concept's records. However, if a role has no permission to view a concept at all (`canView: false`), the concept node is excluded from the graph.

**Edit permission per element:**

| Action | Required Permission |
|--------|-------------------|
| View system graph | `canvas:view` (screen access) |
| Enter edit mode | `canvas:edit` (screen access) |
| Create concept | `canvas:edit` + concept create permission for the target department |
| Create relationship | `canvas:edit` + edit permission on both source and target concepts |
| Edit concept properties | `canEdit` on the specific concept |
| Delete concept | `canDelete` on the specific concept |

**Visual permission cues:** In edit mode, nodes the user cannot edit show a lock icon in the corner. Connection handles do not appear on non-editable nodes. Right-click context menus omit unavailable actions rather than showing disabled items.

#### Acceptance Criteria

- [ ] Directors see own department + org-wide concepts
- [ ] Admins see all concepts across all departments
- [ ] Non-viewable concepts are excluded from the graph (not just hidden)
- [ ] Non-editable nodes show lock icons in edit mode
- [ ] Context menus omit actions the user lacks permission for
- [ ] Permission checks use the same RoleEngine methods as the builder

---

### 9. Integration with Builder

#### Purpose

Define navigation between the canvas and the traditional builder interface.

#### Detail

Canvas and builder are parallel interfaces. Users should be able to move between them fluidly:

**Canvas to Builder:**

| Trigger | Target |
|---------|--------|
| "Open in Builder" button on concept node (Level 3 or property panel) | Builder concept edit page: `/builder/concepts/{conceptKey}` |
| "Open in Builder" button on relationship edge | Builder relationship edit page: `/builder/relationships/{relationshipId}` |
| "Open in Workflow Builder" on workflow indicator | Workflow builder: `/builder/workflows/{workflowId}` |
| "Open in Data Route Builder" on data flow edge | Data route editor: `/builder/data-routes/{routeId}` |

**Builder to Canvas:**

| Trigger | Target |
|---------|--------|
| "View on Canvas" button in builder concept list | System graph centered on that concept at Level 2 zoom |
| "View on Canvas" button in builder relationship view | System graph with that edge highlighted |
| "View on Canvas" button in workflow builder | Workflow canvas for that workflow |

**Deep linking:** The system graph supports URL parameters for deep linking:

```
/canvas/system-graph?focus={conceptKey}           → centers on concept, Level 2
/canvas/system-graph?focus={conceptKey}&zoom=3     → centers on concept, Level 3
/canvas/system-graph?dept={departmentKey}          → centers on department, Level 1
/canvas/system-graph?overlay=data-flow             → opens with data flow overlay active
/canvas/system-graph?overlay=workflows             → opens with workflow overlay active
```

#### Acceptance Criteria

- [ ] "Open in Builder" navigates to the correct builder page for any element
- [ ] "View on Canvas" from builder opens the system graph focused on the correct element
- [ ] Deep link URLs restore the correct focus, zoom level, and overlay state
- [ ] Navigation between canvas and builder preserves the user's context

---

### 10. Test Plan

#### 10.1 Auto-Generation Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| AG-01 | Integration | Load ontology with 10 concepts, 15 relationships | Graph renders 10 nodes, 15 edges |
| AG-02 | Integration | Concept without `canView` permission excluded | Node not in graph, edges to it also absent |
| AG-03 | Integration | Ontology with zero concepts | Empty canvas with "No concepts defined" message |
| AG-04 | Integration | Concept with `owner_department` groups correctly | Node inside correct department region |
| AG-05 | Unit | ConceptNode data mapping from ontology | All props correctly derived |

#### 10.2 Zoom Level Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| ZL-01 | Integration | Zoom below 0.4x | Only department regions and cross-dept edges visible |
| ZL-02 | Integration | Zoom between 0.4x and 1.2x | Concept nodes and relationship edges visible |
| ZL-03 | Integration | Zoom above 1.2x on a concept | Concept expanded with properties and workflows |
| ZL-04 | Integration | Double-click concept at Level 2 | Transitions to Level 3 focused on that concept |
| ZL-05 | Integration | Press Escape at Level 3 | Returns to Level 2 |
| ZL-06 | Unit | Zoom level transition crossfade | Smooth animation, no flickering |

#### 10.3 Editing Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| ED-01 | Integration | Right-click empty space → New Concept | Concept created in ontology + node on canvas |
| ED-02 | Integration | Drag between two nodes → New Relationship | Relationship created in ontology + edge on canvas |
| ED-03 | Integration | Click node → edit property in panel → save | Ontology updated, node label reflects change |
| ED-04 | Integration | Select node → Delete → confirm | Deprecation pipeline runs, node fades out |
| ED-05 | Integration | Undo after creating concept | Concept deleted from ontology, node removed |
| ED-06 | Integration | Redo after undoing concept creation | Concept re-created, node reappears |
| ED-07 | Integration | Edit mode without `canvas:edit` permission | Edit mode button disabled |
| ED-08 | Integration | Delete concept with 3 downstream dependencies | Impact dialog shows 3 dependencies |

#### 10.4 Overlay Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| OV-01 | Integration | Toggle data flow overlay on | DataFlowEdges appear for all active routes |
| OV-02 | Integration | Toggle data flow overlay off | DataFlowEdges disappear |
| OV-03 | Integration | Data route with PII strip | Red shield icon on edge |
| OV-04 | Integration | Multiple routes between same concepts | Aggregated edge with count badge |
| OV-05 | Integration | Toggle workflow overlay on | Workflow indicators appear on concept nodes |
| OV-06 | Integration | Click workflow indicator | Popover with workflow details and "Open in Workflow Canvas" button |
| OV-07 | Integration | Show cascades sub-toggle | Cascade chains rendered with numbered sequence |

#### 10.5 Real-Time Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| RT-01 | Integration | Create concept in builder while canvas is open | New node appears on canvas within 2 seconds |
| RT-02 | Integration | Delete concept in builder while canvas is open | Node fades out on canvas within 2 seconds |
| RT-03 | Integration | SSE connection drops and reconnects | Canvas resumes live sync after reconnect |
| RT-04 | Integration | Concurrent edit conflict | Notification banner shown, update queued |
| RT-05 | Integration | SSE unavailable | Fallback to 30-second polling |

#### 10.6 RBAC Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| RB-01 | Integration | Director views system graph | Own department + org-wide concepts visible |
| RB-02 | Integration | Admin views system graph | All concepts visible |
| RB-03 | Integration | Volunteer with limited permissions | Only permitted concepts visible |
| RB-04 | Integration | Non-editable node in edit mode | Lock icon shown, no connection handles |
| RB-05 | Integration | Context menu on non-deletable node | "Delete" option absent from menu |

#### 10.7 Integration Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| INT-01 | Integration | "Open in Builder" on concept node | Navigates to builder concept page |
| INT-02 | Integration | "View on Canvas" from builder | System graph opens, focused on concept |
| INT-03 | Integration | Deep link with focus + zoom parameters | Canvas loads at correct focus and zoom level |
| INT-04 | Integration | Deep link with overlay parameter | Canvas loads with specified overlay active |

#### 10.8 Performance Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| PF-01 | Performance | Load system graph with 50 concepts | Under 1 second initial render |
| PF-02 | Performance | Load system graph with 200 concepts | Under 2 seconds with lazy loading |
| PF-03 | Performance | Toggle overlay on 100-concept graph | Overlay renders in under 500ms |
| PF-04 | Performance | Zoom level transition | Under 300ms animation |

**Coverage target:** >=80% on auto-generation logic, zoom level transitions, and editing flows. 100% on RBAC filtering logic.

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/canvas-engine.md` | System graph is built on the canvas engine |
| `core/ontology-engine.md` | System graph reads all graph data from the ontology |
| `core/rbac-engine.md` | Node visibility and edit permissions |
| `data-infrastructure/data-routing.md` | Data flow overlay reads route definitions |
| `data-infrastructure/data-lineage.md` | Impact analysis for deletion confirmation |
| `automation/workflow-engine.md` | Workflow overlay reads workflow configs |
| `ui/builder-to-operator.md` | Property panel reuses builder form rendering |
| `api/domain-crud.md` | All edits write through the domain CRUD API |
| `core/event-bus.md` | Real-time sync via SSE |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Auto-generate from ontology, not manual graph construction | The system graph should always reflect the current ontology state. Manual graph construction would drift from the ontology and create a maintenance burden. |
| Three zoom levels with semantic meaning | Arbitrary zoom creates visual noise. Three defined levels (system, department, concept) map to how users think about organizational structure: big picture, department focus, element detail. |
| Edit mode writes directly to ontology | Canvas and builder must stay in sync. Writing to a separate graph store would create two sources of truth. The ontology is the single source of truth. |
| Deletion triggers deprecation pipeline, not immediate removal | Convention operations data has downstream dependencies. Immediate deletion would break workflows, data routes, and forms that reference the deleted concept. The deprecation pipeline ensures safe removal. |
| Overlays are off by default | Most users visit the system graph to understand the domain model (concepts and relationships). Data flows and workflows are secondary concerns that add visual noise. On-demand overlays keep the default view clean. |
| SSE for real-time with polling fallback | SSE provides low-latency updates without the complexity of WebSockets. Polling fallback ensures the graph stays reasonably current even in degraded network conditions. |
| Lock icons instead of hidden context menu items | Showing what the user cannot do (with a lock) teaches them about the permission model. Hiding options entirely leaves users confused about why certain actions are unavailable. Context menu items are hidden (not locked) because the menu is transient and hiding reduces clutter. |
