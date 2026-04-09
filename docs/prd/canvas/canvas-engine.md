# Canvas Engine

> Shared rendering infrastructure for all canvas views. Built on Vue Flow (MIT licensed, OSS-compatible
> with AGPL-3.0). Provides typed node components, styled edge types, canvas interaction modes, layout
> algorithms, state persistence, and performance optimization. Canvas and builder are parallel interfaces
> for different users reading/writing the same ontology and config data.

---

## Overview

The canvas engine is the foundational layer that powers every visual interface in the platform: the system graph, the workflow canvas, and the data lineage view. It wraps Vue Flow (an MIT-licensed Vue 3 library for node-based graph editors) with platform-specific node types, edge types, interaction modes, layout algorithms, and accessibility features.

Canvas is not a replacement for the builder. Builder serves technical/power users who think in forms, lists, and batch operations. Canvas serves visual/no-code users who think in systems and connections. Both interfaces read and write the same underlying ontology and config data in Postgres. A change made on canvas appears in builder, and vice versa.

The engine provides five node component types (ConceptNode, IntegrationNode, DepartmentNode, WorkflowNode, DataFlowNode), four edge component types (RelationshipEdge, DataFlowEdge, WorkflowEdge, DependencyEdge), three interaction modes (view, edit, focused), three layout algorithms (force-directed, hierarchical, grouped), and a persistence layer for user-specific layout positions.

**Dependencies:** `core/ontology-engine.md`, `core/rbac-engine.md`, `ui/builder-to-operator.md`

---

## Full Specification

### 1. Vue Flow Integration

#### Purpose

Define how Vue Flow is installed, configured, and themed to match the platform's visual identity.

#### Detail

**Installation:** Vue Flow is installed as `@vue-flow/core` (MIT license) with optional subpackages `@vue-flow/minimap`, `@vue-flow/controls`, and `@vue-flow/background`. All are MIT licensed and compatible with the platform's AGPL-3.0 license.

**Configuration:** The canvas engine wraps Vue Flow in a `CanvasProvider` component that initializes:

```typescript
interface CanvasConfig {
  readonly mode: 'view' | 'edit' | 'focused'
  readonly layoutAlgorithm: 'force-directed' | 'hierarchical' | 'grouped'
  readonly showMinimap: boolean
  readonly showControls: boolean
  readonly showBackground: boolean
  readonly snapToGrid: boolean
  readonly gridSize: number              // default: 20px
  readonly maxZoom: number               // default: 4
  readonly minZoom: number               // default: 0.1
  readonly fitViewOnLoad: boolean        // default: true
  readonly nodesDraggable: boolean       // derived from mode
  readonly nodesConnectable: boolean     // derived from mode
  readonly elementsSelectable: boolean   // derived from mode
}
```

**Theming:** The canvas applies platform design tokens to Vue Flow's CSS variables:

| Vue Flow Variable | Platform Token | Value |
|-------------------|---------------|-------|
| `--vf-node-bg` | `--surface-card` | White / dark surface |
| `--vf-node-text` | `--text-color` | Primary text |
| `--vf-node-border` | `--surface-border` | Subtle border |
| `--vf-edge-stroke` | `--primary-color` | Brand primary |
| `--vf-selection-bg` | `--highlight-bg` | Selection highlight |
| `--vf-handle-bg` | `--primary-color` | Connection handle |
| `--vf-minimap-bg` | `--surface-ground` | Minimap background |

Dark mode is supported by swapping token values via the platform's existing theme system.

**Vue Flow instance lifecycle:**

1. `CanvasProvider` mounts and creates a Vue Flow instance
2. Layout positions loaded from persistence layer (section 8)
3. Node and edge data loaded from the relevant data source (ontology, workflows, lineage)
4. Layout algorithm applied if no saved positions exist
5. `fitView()` called to center the graph in the viewport
6. User interactions begin based on the active mode

#### Acceptance Criteria

- [ ] Vue Flow installs with no peer dependency conflicts
- [ ] All `@vue-flow/*` packages are MIT licensed (verified in `package.json`)
- [ ] Platform theme tokens apply correctly in light and dark mode
- [ ] Canvas renders within 500ms for a 50-node graph on initial load

---

### 2. Node Types

#### Purpose

Define the five node component types rendered inside Vue Flow nodes. Each is a Vue 3 single-file component (SFC) that receives ontology or config data as props.

#### Detail

##### 2.1 ConceptNode

Renders an ontology concept. Primary node type in the system graph.

```typescript
interface ConceptNodeProps {
  readonly conceptKey: string
  readonly name: string
  readonly icon: string | null
  readonly propertyCount: number
  readonly relationshipCount: number
  readonly department: string | null
  readonly status: 'active' | 'deprecated'
  readonly hasWorkflows: boolean
}
```

**Visual:** Rounded rectangle, 180x80px default. Icon on the left, name centered, property/relationship counts as small badges in the bottom-right corner. Border color matches department color. Deprecated concepts render with reduced opacity (0.5) and a strikethrough on the name.

##### 2.2 IntegrationNode

Renders an external integration endpoint (API connection, calendar sync, external pipeline).

```typescript
interface IntegrationNodeProps {
  readonly integrationId: string
  readonly name: string
  readonly type: 'api' | 'calendar' | 'email' | 'webhook' | 'file_import'
  readonly status: 'connected' | 'disconnected' | 'error'
  readonly lastSyncAt: string | null
}
```

**Visual:** Rounded rectangle with a cloud icon, 160x70px. Status indicator dot (green=connected, grey=disconnected, red=error). Dashed border to distinguish from internal nodes.

##### 2.3 DepartmentNode

Renders a department as a large container region in the system graph (zoom level 1).

```typescript
interface DepartmentNodeProps {
  readonly departmentKey: string
  readonly name: string
  readonly color: string
  readonly conceptCount: number
  readonly memberCount: number
}
```

**Visual:** Large rounded rectangle (auto-sized to contain child nodes), semi-transparent fill matching the department color at 10% opacity, solid border at 30% opacity. Name in the top-left corner with concept count badge.

##### 2.4 WorkflowNode

Renders a workflow configuration. Used in both the system graph (as an indicator) and the workflow canvas (as the primary node type).

```typescript
interface WorkflowNodeProps {
  readonly workflowId: string
  readonly name: string
  readonly triggerType: 'domain_event' | 'field_changed' | 'scheduled' | 'manual'
  readonly enabled: boolean
  readonly actionCount: number
  readonly lastExecutedAt: string | null
}
```

**Visual:** Rectangle with a play icon, 160x60px. Color-coded by trigger type (domain_event=blue, scheduled=orange, manual=green, field_changed=purple). Disabled workflows render with reduced opacity. Action count badge in the bottom-right.

##### 2.5 DataFlowNode

Renders a data route endpoint or transform step. Used in data flow overlays and lineage views.

```typescript
interface DataFlowNodeProps {
  readonly routeId: string
  readonly name: string
  readonly direction: 'source' | 'destination' | 'transform'
  readonly piiFilterMode: 'strip' | 'pass' | 'hash'
  readonly fieldCount: number
}
```

**Visual:** Parallelogram shape (skewed rectangle), 150x60px. Direction indicated by arrow overlay (right-pointing for source, left-pointing for destination, bidirectional for transform). PII filter mode shown as a small shield icon (red=strip, green=pass, yellow=hash).

#### Acceptance Criteria

- [ ] All five node types render correctly inside Vue Flow
- [ ] Each node type has distinct visual styling that is identifiable at a glance
- [ ] Node props are typed and validated at component mount
- [ ] Nodes render department colors from the ontology scoping data
- [ ] Deprecated/disabled elements render with reduced opacity

---

### 3. Edge Types

#### Purpose

Define the four edge types with custom styling for visual differentiation.

#### Detail

##### 3.1 RelationshipEdge

Represents an ontology relationship between two concepts.

| Property | Value |
|----------|-------|
| Stroke | Solid, 2px |
| Color | Department color of the source concept, or `--primary-color` if cross-department |
| Label | Relationship label (e.g., "has pairings") |
| Cardinality marker | `1` or `*` at source/target handles based on cardinality type |
| Animated | No |

##### 3.2 DataFlowEdge

Represents a data route between two concepts or a data flow between a source and destination.

| Property | Value |
|----------|-------|
| Stroke | Dashed, 2px, dash pattern `8 4` |
| Color | `--cyan-500` (data flow teal) |
| Label | Route name or field summary (e.g., "name, bio, photo") |
| Animated | Yes (flowing dots animation indicating data direction) |
| PII indicator | Small shield icon on edge if PII filtering is active |

##### 3.3 WorkflowEdge

Represents a workflow trigger-to-action path or a cascade connection between workflows.

| Property | Value |
|----------|-------|
| Stroke | Solid, 3px |
| Color | Trigger type color (blue/orange/green/purple, matching WorkflowNode) |
| Label | Event name or condition summary |
| Animated | Yes (pulse animation indicating trigger direction) |

##### 3.4 DependencyEdge

Represents a structural dependency (concept inheritance, form dependency, constraint chain).

| Property | Value |
|----------|-------|
| Stroke | Dotted, 1px, dash pattern `2 4` |
| Color | `--text-color-secondary` (subtle grey) |
| Label | Dependency type (e.g., "extends", "requires") |
| Animated | No |

**Edge rendering:** All edge types use Vue Flow's custom edge component API. Each edge type is a Vue SFC that receives `sourceX`, `sourceY`, `targetX`, `targetY`, and edge data as props. Edges are rendered as SVG paths with the specified stroke styles.

**Edge animations:** DataFlowEdge and WorkflowEdge use CSS animations on SVG dash-offset to create the appearance of flowing motion along the edge path. Animation direction follows the data/workflow flow direction (source to target).

#### Acceptance Criteria

- [ ] All four edge types render with visually distinct styles
- [ ] Edge labels are readable and do not overlap nodes
- [ ] Animated edges animate smoothly at 60fps
- [ ] Edge colors match the platform's color system
- [ ] Cardinality markers on RelationshipEdge are accurate

---

### 4. Canvas Modes

#### Purpose

Define the three interaction modes that control what users can do on the canvas.

#### Detail

##### 4.1 View Mode

The default mode for operators and read-only users. Exploration only.

| Capability | Available |
|------------|-----------|
| Pan (drag background) | Yes |
| Zoom (scroll / pinch) | Yes |
| Click node to inspect | Yes (opens info tooltip) |
| Select nodes | Yes (for filtering / highlighting) |
| Drag nodes | No |
| Create nodes | No |
| Create edges | No |
| Delete elements | No |
| Context menu | Limited (inspect, filter, "Open in Builder") |

##### 4.2 Edit Mode

Available to users with `canvas:edit` permission (typically admins and directors). Full graph editing.

| Capability | Available |
|------------|-----------|
| All View Mode capabilities | Yes |
| Drag nodes to reposition | Yes |
| Right-click empty space to create node | Yes (opens concept creation dialog) |
| Drag between nodes to create edge | Yes (opens relationship creation dialog) |
| Select + Delete to remove | Yes (triggers deprecation flow with CI/QA check) |
| Context menu | Full (create, edit, delete, duplicate, group) |
| Undo/redo | Yes (section 9) |

**Edit mode writes to ontology:** Creating a node on canvas creates a concept row in Postgres via the domain CRUD API. Creating an edge creates a relationship row. Deletions trigger the standard deprecation pipeline (impact analysis, confirmation, soft-delete). The canvas is not a separate data store -- it writes directly to the same tables the builder reads.

##### 4.3 Focused Mode

A single concept is expanded to show its full detail. Used for deep inspection and inline editing.

| Capability | Available |
|------------|-----------|
| Surrounding nodes dimmed (opacity 0.3) | Yes |
| Selected node expanded to show properties | Yes |
| Property panel slides out from the right | Yes |
| Edit properties inline (if user has edit permission) | Yes |
| Navigate relationships by clicking edges | Yes |
| Exit focused mode | Click background or press Escape |

**Focused mode reuses the builder's property panel:** The same form rendering logic from `ui/dynamic-forms.md` and the same property-to-input mapping from `ui/builder-to-operator.md` are used. This ensures data consistency -- editing a concept's properties on canvas produces the exact same result as editing in the builder.

#### Acceptance Criteria

- [ ] View mode prevents all editing actions
- [ ] Edit mode requires `canvas:edit` permission via RBAC
- [ ] Focused mode dims surrounding nodes and expands the selected node
- [ ] Mode transitions are animated (200ms fade) and reversible
- [ ] Edit mode changes write to Postgres via the domain CRUD API

---

### 5. Layout Algorithms

#### Purpose

Define the three layout algorithms that position nodes automatically when no saved positions exist.

#### Detail

##### 5.1 Force-Directed (Default)

Used for the system graph when no specific structure is implied. Nodes repel each other; edges act as springs pulling connected nodes together. Produces organic, readable layouts for arbitrary graphs.

**Implementation:** Uses `d3-force` (BSD license, compatible with AGPL-3.0) with the following forces:

| Force | Parameter | Value |
|-------|-----------|-------|
| `forceLink` | distance | 200px |
| `forceManyBody` | strength | -300 |
| `forceCenter` | x, y | viewport center |
| `forceCollide` | radius | node width / 2 + 20px padding |

**Iteration:** 300 simulation ticks, then freeze positions. Simulation runs off-screen (nodes hidden during layout), then positions are applied and `fitView()` is called.

##### 5.2 Hierarchical

Used for workflow canvases where flow direction matters. Nodes are arranged left-to-right (or top-to-bottom) based on their position in the flow chain.

**Implementation:** Uses `dagre` (MIT license) with:

| Parameter | Value |
|-----------|-------|
| `rankdir` | `LR` (left to right) |
| `ranksep` | 150px (space between ranks) |
| `nodesep` | 80px (space between nodes in same rank) |
| `align` | `UL` (upper-left alignment) |

**Rank assignment:** Trigger nodes are rank 0. Each subsequent action increments the rank. Condition nodes (diamonds) are placed between the trigger rank and the first action rank.

##### 5.3 Grouped

Used for department-level views. Nodes are grouped into rectangular regions by `owner_department`, with cross-department edges routed around group boundaries.

**Implementation:** Custom algorithm:

1. Partition nodes by `owner_department`
2. Arrange department groups in a grid (2-3 columns, rows as needed)
3. Within each group, apply force-directed layout
4. Route cross-department edges around group boundaries using orthogonal edge routing
5. Size each group rectangle to fit its contents with 40px padding

#### Acceptance Criteria

- [ ] Force-directed layout produces a readable graph for 50+ nodes without excessive overlap
- [ ] Hierarchical layout produces a clear left-to-right flow for workflow chains
- [ ] Grouped layout visually separates departments with colored regions
- [ ] All layout algorithms complete in under 1 second for 100 nodes
- [ ] Layout positions are deterministic for the same input data (seeded RNG for force-directed)

---

### 6. Canvas Controls

#### Purpose

Define the standard UI controls available on every canvas view.

#### Detail

##### 6.1 Minimap

A small overview panel in the bottom-right corner showing the entire graph with a viewport indicator rectangle. Uses `@vue-flow/minimap`. Clicking on the minimap pans to that location. The minimap shows node positions as colored dots (color matches node type) and edge connections as thin lines.

**Sizing:** 200x140px default, collapsible via a toggle button.

##### 6.2 Search Bar

A floating search input in the top-left corner. Searches node names, concept keys, and property labels. Results are highlighted on the canvas (matching nodes glow, non-matching nodes dim). Selecting a search result pans and zooms to center the matching node.

**Implementation:** Client-side filtering against the current node data set. No API call required since all visible node data is already loaded.

**Keyboard shortcut:** `Ctrl+F` / `Cmd+F` focuses the search bar.

##### 6.3 Zoom Controls

A vertical button group in the bottom-left corner:

| Button | Action | Shortcut |
|--------|--------|----------|
| `+` | Zoom in 25% | `Ctrl+=` |
| `-` | Zoom out 25% | `Ctrl+-` |
| `Fit` | Fit entire graph in viewport | `Ctrl+0` |
| `1:1` | Reset to 100% zoom | `Ctrl+1` |

##### 6.4 Fullscreen Toggle

A button in the top-right corner that toggles the canvas between embedded (within the page layout) and fullscreen (covers the entire browser viewport). Uses the Fullscreen API.

**Keyboard shortcut:** `F11` or `Ctrl+Shift+F`.

##### 6.5 Mode Selector

A segmented control in the top toolbar showing the current mode (View / Edit / Focused). Only modes the user has permission for are enabled. Edit mode is greyed out and shows a tooltip ("Requires edit permission") for users without `canvas:edit` RBAC permission.

##### 6.6 Layout Selector

A dropdown in the top toolbar for choosing the layout algorithm. Options: "Auto (Force)", "Flow (Hierarchical)", "Departments (Grouped)". Changing the layout re-runs the algorithm and animates nodes to their new positions over 500ms.

#### Acceptance Criteria

- [ ] Minimap reflects the current graph state in real-time
- [ ] Search highlights matching nodes within 100ms of input
- [ ] Zoom controls work via both buttons and keyboard shortcuts
- [ ] Fullscreen toggle works across Chrome, Firefox, Safari, Edge
- [ ] Mode selector respects RBAC permissions

---

### 7. RBAC Integration

#### Purpose

Define how canvas visibility and editing are gated by the RBAC engine.

#### Detail

The canvas respects the same RBAC model as the builder. Permissions are checked at two levels:

**Canvas-level permissions:**

| Permission | Controls | Default |
|------------|----------|---------|
| `canvas:view` | Can see the canvas at all | Granted to all authenticated roles |
| `canvas:edit` | Can enter edit mode on the canvas | Granted to `admin` and `director` roles |

**Node-level permissions:** Each node on the canvas represents an ontology concept. The canvas calls `roleEngine.canPerformAction(roleKey, conceptKey, 'view')` to determine which nodes to render. Nodes the user cannot view are not rendered -- they are excluded from the graph entirely, not just hidden.

**Edge filtering:** Edges where either the source or target node is filtered out by RBAC are also removed. This prevents information leakage through visible edges connecting to invisible nodes.

**Edit operations:** When a user in edit mode attempts to create, modify, or delete a node/edge, the canvas calls the domain CRUD API, which applies the full RBAC pipeline (Section 5 of `core/rbac-engine.md`). If the operation is denied, the canvas shows a toast notification: "You don't have permission to {action} this {element}."

**Property panel in focused mode:** The property panel calls `roleEngine.getVisibleProperties()` and `roleEngine.getEditableProperties()` to determine which properties to show and which are editable. This is identical to the builder's behavior.

#### Acceptance Criteria

- [ ] Users without `canvas:view` see no canvas (page redirects to "not permitted")
- [ ] Nodes for concepts the user cannot view are excluded from the graph
- [ ] Edges connected to excluded nodes are also excluded
- [ ] Edit mode is only accessible to users with `canvas:edit` permission
- [ ] Property visibility in focused mode matches builder RBAC behavior exactly

---

### 8. State Persistence

#### Purpose

Define how canvas layout positions and user preferences are saved and restored.

#### Detail

Canvas layout positions (node x/y coordinates, zoom level, viewport center) are user-specific preferences -- they are not part of the ontology. Two persistence layers:

##### 8.1 Database Persistence (Primary)

A `canvas_layouts` table stores named layouts per user:

```sql
CREATE TABLE canvas_layouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  canvas_type     TEXT NOT NULL,           -- 'system_graph', 'workflow', 'lineage'
  canvas_context  TEXT,                    -- e.g., workflow ID, department key
  name            TEXT NOT NULL DEFAULT 'default',
  node_positions  JSONB NOT NULL,          -- { "node_id": { "x": 100, "y": 200 }, ... }
  viewport        JSONB NOT NULL,          -- { "x": 0, "y": 0, "zoom": 1 }
  layout_algo     TEXT,                    -- which algorithm produced this layout
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, canvas_type, canvas_context, name)
);
```

**Auto-save:** Positions are saved automatically 2 seconds after the user stops dragging nodes (debounced). The save is a PATCH to the layout record, updating only `node_positions`, `viewport`, and `updated_at`.

**Multiple layouts:** Users can save named layouts ("My view", "Presentation layout") and switch between them. The `default` layout is auto-created on first canvas load.

##### 8.2 Local Storage Fallback

If the database is unavailable or the save fails, positions are cached in `localStorage` under the key `canvas_layout:{canvas_type}:{canvas_context}`. On next load, the canvas checks `canvas_layouts` first, then falls back to `localStorage`.

**Load priority:**

1. `canvas_layouts` table (user's named layout for this canvas)
2. `localStorage` fallback
3. Run layout algorithm (no saved positions)

#### Acceptance Criteria

- [ ] Node positions persist across page reloads
- [ ] Each user has independent layout positions
- [ ] Auto-save debounces at 2 seconds to avoid excessive writes
- [ ] localStorage fallback works when database save fails
- [ ] Layout algorithm runs only when no saved positions exist

---

### 9. Undo/Redo

#### Purpose

Define the undo/redo system for edit mode changes.

#### Detail

Edit mode maintains an in-memory command stack. Each edit operation is recorded as a reversible command:

```typescript
interface CanvasCommand {
  readonly type: 'create_node' | 'delete_node' | 'create_edge' | 'delete_edge' | 'move_node' | 'edit_property'
  readonly timestamp: number
  readonly forward: () => Promise<void>   // execute the change
  readonly backward: () => Promise<void>  // reverse the change
  readonly description: string            // human-readable, e.g., "Create concept: Guest"
}
```

**Stack behavior:**

| Action | Effect |
|--------|--------|
| User performs an edit | Command pushed to undo stack, redo stack cleared |
| Undo (`Ctrl+Z`) | Pop from undo stack, execute `backward()`, push to redo stack |
| Redo (`Ctrl+Shift+Z`) | Pop from redo stack, execute `forward()`, push to undo stack |

**Stack limit:** 50 commands. Oldest commands are dropped when the limit is exceeded.

**Persistence:** The undo/redo stack is session-local (not persisted). Closing the canvas or switching modes clears the stack.

**API integration:** `forward()` and `backward()` call the domain CRUD API. Undoing a node creation calls the delete endpoint. Undoing a deletion calls the create endpoint with the original data. Move operations only update the `canvas_layouts` table, not the ontology.

#### Acceptance Criteria

- [ ] Undo reverses the last edit operation
- [ ] Redo re-applies the last undone operation
- [ ] Stack limit of 50 prevents unbounded memory growth
- [ ] Undo of a node creation deletes the ontology record
- [ ] Move-only operations (repositioning) do not create ontology changes

---

### 10. Performance

#### Purpose

Define performance strategies for large graphs.

#### Detail

##### 10.1 Lazy Loading

For graphs with more than 100 nodes, the canvas loads nodes in tiers:

1. **Viewport nodes:** Nodes within the current viewport bounds are loaded first (immediate render)
2. **Adjacent nodes:** Nodes connected to viewport nodes by one edge are loaded next (within 200ms)
3. **Remaining nodes:** All other nodes are loaded in background batches of 50 (non-blocking)

The API supports this via a `viewport` query parameter on the graph data endpoint: `GET /api/canvas/graph?viewport=x1,y1,x2,y2` returns nodes within the bounding box plus one-hop neighbors.

##### 10.2 Viewport Culling

Nodes and edges outside the current viewport are not rendered in the DOM. Vue Flow handles this natively via its `onlyRenderVisibleElements` option. This reduces DOM node count from thousands to dozens for large graphs.

##### 10.3 Level-of-Detail Rendering

At low zoom levels (< 0.5x), nodes render as simplified shapes (colored rectangles without text or icons). At very low zoom levels (< 0.2x), nodes render as dots. This reduces rendering cost when viewing the entire graph at a distance.

| Zoom Level | Rendering |
|------------|-----------|
| >= 0.5x | Full detail (icon, name, badges, status indicators) |
| 0.2x - 0.5x | Simplified (colored rectangle, name only) |
| < 0.2x | Minimal (colored dot, no text) |

##### 10.4 Edge Bundling

When more than 5 edges connect between two department groups, edges are bundled into a single thick edge with a count label (e.g., "12 connections"). Clicking the bundle expands to show individual edges.

#### Acceptance Criteria

- [ ] Canvas remains interactive (< 16ms frame time) with 200 visible nodes
- [ ] Initial render completes in under 1 second for 100-node graphs
- [ ] Viewport culling reduces DOM nodes to visible elements only
- [ ] Level-of-detail transitions are smooth (no flickering)
- [ ] Lazy loading shows a spinner for out-of-viewport nodes during initial load

---

### 11. Accessibility

#### Purpose

Define keyboard navigation and screen reader support for canvas interactions.

#### Detail

##### 11.1 Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next node (in DOM order) |
| `Shift+Tab` | Move focus to previous node |
| `Enter` | Open focused mode for the selected node |
| `Escape` | Exit focused mode, deselect |
| `Arrow keys` | Pan canvas (10px per press, 50px with Shift held) |
| `+` / `-` | Zoom in / out |
| `Delete` | Delete selected element (edit mode only, with confirmation) |
| `Ctrl+A` | Select all nodes |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo (edit mode) |
| `Ctrl+F` | Focus search bar |

Focus is indicated by a 2px outline in `--primary-color` around the focused node.

##### 11.2 Screen Reader Support

Each node has an `aria-label` constructed from its data:

- ConceptNode: `"{name} concept, {propertyCount} properties, {relationshipCount} relationships, department {department}"`
- WorkflowNode: `"{name} workflow, {triggerType} trigger, {actionCount} actions, {enabled ? 'enabled' : 'disabled'}"`
- Edges: `"Relationship from {sourceName} to {targetName}: {label}"`

The canvas container has `role="application"` with an `aria-label` describing the current view ("System graph canvas, {nodeCount} nodes, {edgeCount} connections").

##### 11.3 Reduced Motion

When the user has `prefers-reduced-motion: reduce` enabled, all edge animations are disabled, layout transitions are instant (no 500ms animation), and node drag follows the cursor without spring physics.

#### Acceptance Criteria

- [ ] All nodes are reachable via Tab key navigation
- [ ] Screen readers announce node type, name, and key metadata
- [ ] Reduced motion preference disables all animations
- [ ] Keyboard shortcuts do not conflict with browser defaults
- [ ] Focus indicators meet WCAG 2.1 AA contrast requirements

---

### 12. OSS License Compatibility

#### Purpose

Verify that all canvas dependencies are compatible with the platform's AGPL-3.0 license.

#### Detail

| Package | License | Compatible with AGPL-3.0 | Notes |
|---------|---------|--------------------------|-------|
| `@vue-flow/core` | MIT | Yes | Permissive, no restrictions |
| `@vue-flow/minimap` | MIT | Yes | Optional subpackage |
| `@vue-flow/controls` | MIT | Yes | Optional subpackage |
| `@vue-flow/background` | MIT | Yes | Optional subpackage |
| `d3-force` | BSD-3-Clause | Yes | Used for force-directed layout |
| `dagre` | MIT | Yes | Used for hierarchical layout |

No AGPL-incompatible dependencies are introduced by the canvas engine.

#### Acceptance Criteria

- [ ] All canvas dependencies have licenses listed in the compatibility table
- [ ] No GPL-2.0-only or proprietary dependencies are introduced
- [ ] License audit runs as part of the CI pipeline (`license-checker` or equivalent)

---

### 13. Test Plan

#### 13.1 Node Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| N-01 | Unit | ConceptNode renders with all props | Name, icon, badges visible |
| N-02 | Unit | ConceptNode renders deprecated state | Reduced opacity, strikethrough |
| N-03 | Unit | IntegrationNode status indicator colors | Green/grey/red match status |
| N-04 | Unit | DepartmentNode auto-sizes to contents | Container fits child nodes with padding |
| N-05 | Unit | WorkflowNode color matches trigger type | Blue/orange/green/purple correct |
| N-06 | Unit | DataFlowNode PII shield icon renders | Shield icon matches filter mode |

#### 13.2 Edge Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| E-01 | Unit | RelationshipEdge renders solid stroke | 2px solid line |
| E-02 | Unit | DataFlowEdge renders dashed + animated | Dash pattern visible, animation running |
| E-03 | Unit | WorkflowEdge color matches trigger type | Correct color applied |
| E-04 | Unit | DependencyEdge renders dotted stroke | Dotted line visible |
| E-05 | Unit | Edge labels do not overlap nodes | Labels positioned at edge midpoint |

#### 13.3 Mode Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| M-01 | Integration | View mode prevents node dragging | Drag attempt does not move node |
| M-02 | Integration | Edit mode allows node creation via context menu | Node created in ontology + canvas |
| M-03 | Integration | Focused mode dims surrounding nodes | Non-selected nodes at 0.3 opacity |
| M-04 | Integration | Edit mode without RBAC permission | Edit mode button disabled with tooltip |
| M-05 | Integration | Mode switch clears undo stack | Undo stack empty after mode change |

#### 13.4 Layout Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| L-01 | Unit | Force-directed layout produces no overlapping nodes | No node bounding boxes intersect |
| L-02 | Unit | Hierarchical layout orders nodes left-to-right by rank | Trigger at rank 0, actions at increasing ranks |
| L-03 | Unit | Grouped layout separates departments | No nodes from different departments in same region |
| L-04 | Performance | Layout algorithm completes for 100 nodes | Under 1 second |
| L-05 | Unit | Deterministic layout for same input | Same positions on repeated runs |

#### 13.5 Persistence Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| P-01 | Integration | Save layout after node drag | `canvas_layouts` row updated |
| P-02 | Integration | Load saved layout on canvas mount | Nodes at saved positions |
| P-03 | Integration | localStorage fallback when DB unavailable | Positions loaded from localStorage |
| P-04 | Integration | Multiple named layouts per user | User can switch between saved layouts |

#### 13.6 Performance Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| PF-01 | Performance | Render 50-node graph | Under 500ms initial render |
| PF-02 | Performance | Render 200-node graph with viewport culling | Under 1 second, < 16ms frame time |
| PF-03 | Performance | Pan/zoom at 200 nodes | Smooth 60fps interaction |
| PF-04 | Performance | Level-of-detail switch on zoom | No visible frame drop during transition |

#### 13.7 Accessibility Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| A-01 | Unit | Tab navigation visits all nodes | Focus moves through all nodes |
| A-02 | Unit | Screen reader labels are descriptive | aria-label includes name, type, counts |
| A-03 | Unit | Reduced motion disables animations | No CSS animations when preference set |
| A-04 | Unit | Focus indicator visible | 2px outline meets WCAG AA contrast |

**Coverage target:** >=80% on canvas engine components, layout algorithms, and RBAC integration. 100% on mode permission checks.

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `core/ontology-engine.md` | Canvas reads concept, property, and relationship data from the ontology |
| `core/rbac-engine.md` | Canvas visibility and editing gated by RBAC permissions |
| `ui/builder-to-operator.md` | Focused mode property panel reuses builder's form rendering |
| `ui/dynamic-forms.md` | Property editing on canvas uses the same form components |
| `api/domain-crud.md` | Edit mode changes write through the domain CRUD API |
| `canvas/system-graph.md` | Primary canvas view built on this engine |
| `canvas/workflow-canvas.md` | Workflow view built on this engine |
| `data-infrastructure/data-lineage.md` | Lineage view built on this engine |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Vue Flow over Cytoscape.js or D3-only | Vue Flow is Vue-native (no framework mismatch), MIT licensed, actively maintained, and supports custom node/edge components as Vue SFCs. Cytoscape uses its own rendering; D3 requires building graph interaction from scratch. |
| Canvas writes to ontology, not a separate store | Canvas and builder are parallel interfaces for the same data. A separate canvas data store would create sync conflicts and double the maintenance burden. |
| Layout positions in `canvas_layouts`, not ontology | Positions are per-user presentation preferences, not domain data. Storing them in ontology would pollute the shared model and create merge conflicts between users. |
| Undo/redo is session-local | Cross-session undo would require a full event-sourcing model on canvas operations. Session-local is sufficient for the use case (correcting recent mistakes) and avoids complexity. |
| d3-force + dagre over a single layout library | Each layout type has fundamentally different requirements. Force-directed is best served by d3-force; hierarchical by dagre. No single library excels at both. |
| RBAC filters nodes entirely, not hides them | Hiding nodes but showing their edges would leak information about concepts the user cannot access. Full exclusion is the only safe approach. |
