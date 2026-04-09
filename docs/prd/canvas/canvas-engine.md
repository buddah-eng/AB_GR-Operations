# Canvas Engine

> Technical rendering infrastructure for all canvas views. Built on Vue Flow (MIT licensed, OSS-compatible
> with AGPL-3.0). Defines the node type system, edge type system, canvas interaction modes, layout
> algorithms, interaction primitives, state persistence, undo/redo architecture, performance strategies,
> accessibility, and theming. The canvas engine renders nodes and edges it receives -- it does not know
> about ontology, workflows, or data routes. It is a generic, typed graph rendering engine.

---

## Overview

The canvas engine is the rendering layer that powers every visual interface in the platform: the system graph, the workflow canvas, the data flow canvas, and on-demand lineage views. It wraps Vue Flow (an MIT-licensed Vue 3 library for node-based graph editors) with platform-specific node type registration, custom edge renderers, three interaction modes, three layout algorithms, and a full accessibility layer.

Canvas and builder are PARALLEL interfaces for different users. Builders serve technical/power users who think in forms, lists, and batch operations. Canvas serves visual/no-code users who think in systems and connections. Both read and write the SAME underlying ontology and config data in Postgres. The canvas engine itself is agnostic to domain concepts -- it receives a `VisualizationGraph` (defined in `canvas/system-visualization-architecture.md`) and renders it.

The engine provides eight registered node component types, four custom edge renderers, three interaction modes, three layout algorithms, a persistence layer for user-saved positions, an undo/redo stack, and performance optimization strategies for graphs up to 500 nodes.

**Dependencies:** `canvas/system-visualization-architecture.md` (data contract), `ui/builder-to-operator.md` (property panel rendering), `core/rbac-engine.md` (permission checks for mode access)

---

## Full Specification

### 1. Vue Flow Integration

#### Purpose

Define how Vue Flow is installed, configured, and themed to match the platform's visual identity.

#### Detail

**Installation:** Vue Flow is installed as `@vue-flow/core` (MIT license) with optional subpackages `@vue-flow/minimap`, `@vue-flow/controls`, and `@vue-flow/background`. All packages are MIT licensed and compatible with the platform's AGPL-3.0 license.

**Configuration:** The canvas engine wraps Vue Flow in a `CanvasProvider` component that initializes the graph instance:

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

**Theming:** The canvas applies platform design tokens (from `branding.md`) to Vue Flow's CSS variables:

| Vue Flow Variable | Platform Token | Value |
|-------------------|---------------|-------|
| `--vf-node-bg` | `--surface-card` | White / dark surface |
| `--vf-node-text` | `--text-color` | Primary text |
| `--vf-node-border` | `--surface-border` | Subtle border |
| `--vf-edge-stroke` | `--primary-color` | Brand primary |
| `--vf-selection-bg` | `--highlight-bg` | Selection highlight |
| `--vf-handle-bg` | `--primary-color` | Connection handle |
| `--vf-minimap-bg` | `--surface-ground` | Minimap background |

Dark mode is supported by swapping token values via the platform's existing theme system. All node and edge components inherit these tokens for consistent branding.

**Vue Flow instance lifecycle:**

1. `CanvasProvider` mounts and creates a Vue Flow instance
2. Layout positions loaded from persistence layer (section 8)
3. Node and edge data loaded as a `VisualizationGraph` from the visualization architecture layer
4. Layout algorithm applied if no saved positions exist
5. `fitView()` called to center the graph in the viewport
6. User interactions begin based on the active mode

#### Acceptance Criteria

- [ ] Vue Flow installs with no peer dependency conflicts
- [ ] All `@vue-flow/*` packages are MIT licensed (verified in `package.json`)
- [ ] Platform theme tokens apply correctly in light and dark mode
- [ ] Canvas renders within 500ms for a 50-node graph on initial load
- [ ] Dark mode transition does not require canvas remount

---

### 2. Node Type System

#### Purpose

Define how custom node components are registered, typed, and rendered. The node type system is extensible -- new node types can be added by registering a Vue SFC with a type key, without modifying the engine core.

#### Detail

##### 2.1 Node Type Registry

All node types are registered with the canvas engine at initialization. Each registration maps a type string to a Vue 3 single-file component (SFC):

```typescript
interface NodeTypeRegistration {
  readonly type: string                    // matches VisualizationNode.type
  readonly component: Component            // Vue 3 SFC
  readonly defaultSize: { width: number, height: number }
  readonly handles: ReadonlyArray<HandlePosition>  // 'top' | 'right' | 'bottom' | 'left'
  readonly selectable: boolean
  readonly draggable: boolean              // can be overridden by mode
}
```

The engine ships with eight registered node types. Consuming views (system graph, workflow canvas, data flow canvas) do not register their own -- they use these shared types.

##### 2.2 ConceptNode

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

**Visual:** Rounded rectangle, 180x80px default. Icon on the left (24x24px, from PrimeIcons), name centered in semibold weight, property and relationship counts as small grey badges in the bottom-right corner. Border color matches department color (from ontology scoping). Deprecated concepts render with reduced opacity (0.5) and a strikethrough on the name. Connection handles appear on all four sides in edit mode.

##### 2.3 IntegrationNode

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

**Visual:** Rounded rectangle with a cloud icon, 160x70px. Status indicator dot in top-right corner (green=connected, grey=disconnected, red=error). Dashed border (dash pattern `6 3`) to distinguish from internal nodes. Type-specific sub-icon overlaid on the cloud (calendar icon for calendar, envelope for email, etc.).

##### 2.4 DepartmentNode

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

**Visual:** Large rounded rectangle (auto-sized to contain child nodes with 40px padding), semi-transparent fill matching the department color at 10% opacity, solid border at 30% opacity. Department name in the top-left corner in uppercase small text. Concept count badge next to the name. Member count badge below. Collapse/expand toggle in the top-right corner.

##### 2.5 WorkflowNode

Renders a workflow configuration. Used in both the system graph overlay and the workflow canvas.

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

**Visual:** Rectangle with a play icon, 160x60px. Background color-coded by trigger type (domain_event=`--blue-500`, scheduled=`--orange-500`, manual=`--green-500`, field_changed=`--purple-500`). Disabled workflows render with reduced opacity (0.5) and a "Disabled" badge. Action count badge in the bottom-right.

##### 2.6 DataFlowNode

Renders a data route endpoint or transform step. Used in data flow overlays and the data flow canvas.

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

##### 2.7 TransformNode

Renders a data transform step in a routing pipeline.

```typescript
interface TransformNodeProps {
  readonly transformId: string
  readonly name: string
  readonly transformType: string          // e.g., 'pii_strip', 'field_rename', 'format'
  readonly stepCount: number
  readonly status: 'active' | 'deprecated'
}
```

**Visual:** Hexagonal shape, 140x60px. Transform type icon centered. Step count as a small badge. Deprecated transforms show a yellow status indicator.

##### 2.8 QualityNode

Renders a data quality rule or quality score indicator.

```typescript
interface QualityNodeProps {
  readonly ruleId: string
  readonly name: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly healthScore: number | null     // 0-100, null if not yet evaluated
  readonly violationCount: number
}
```

**Visual:** Small circular node, 50px diameter. Color fill based on health: green (score >= 80), yellow (50-79), red (< 50), grey (null/unevaluated). Severity icon in center (exclamation for error, warning triangle for warning, info circle for info). Violation count as a red badge if > 0.

##### 2.9 ExternalNode

Renders an external system endpoint (outside the platform boundary).

```typescript
interface ExternalNodeProps {
  readonly externalId: string
  readonly name: string
  readonly systemType: 'crm' | 'calendar' | 'email' | 'spreadsheet' | 'api' | 'custom'
  readonly syncDirection: 'inbound' | 'outbound' | 'bidirectional'
  readonly lastSyncStatus: 'success' | 'failure' | 'never' | null
}
```

**Visual:** Rounded rectangle with double border (inner solid, outer dashed), 160x70px. System type icon centered. Sync direction arrow overlay (inbound=left arrow, outbound=right arrow, bidirectional=double arrow). Last sync status dot (green/red/grey).

#### Acceptance Criteria

- [ ] All eight node types render correctly inside Vue Flow
- [ ] Each node type has distinct visual styling identifiable at a glance
- [ ] Node props are typed and validated at component mount
- [ ] New node types can be registered without modifying engine core code
- [ ] Deprecated/disabled elements render with reduced opacity
- [ ] Node sizes and handle positions are configurable per type

---

### 3. Edge Type System

#### Purpose

Define the four custom edge renderers with distinct visual styling. Each edge type is a Vue SFC that receives source/target coordinates and edge data as props, rendering as SVG paths with custom stroke styles.

#### Detail

##### 3.1 RelationshipEdge

Represents an ontology relationship between two concepts.

| Property | Value |
|----------|-------|
| Stroke | Solid, 2px |
| Color | Department color of the source concept, or `--primary-color` if cross-department |
| Label | Relationship label (e.g., "has sessions") |
| Cardinality marker | `1` or `*` at source/target handles based on cardinality type |
| Animated | No |
| Hover behavior | Edge thickens to 3px, label background becomes opaque |

##### 3.2 DataFlowEdge

Represents a data route between two concepts or a data flow between source and destination.

| Property | Value |
|----------|-------|
| Stroke | Dashed, 2px, dash pattern `8 4` |
| Color | `--cyan-500` (data flow teal) |
| Label | Route name or field summary (e.g., "name, bio, photo") |
| Animated | Yes (flowing dots animation indicating data direction, CSS `stroke-dashoffset`) |
| PII indicator | Small shield icon on edge midpoint if PII filtering is active |
| Hover behavior | Route detail tooltip with field count and PII mode |

##### 3.3 WorkflowEdge

Represents a workflow trigger-to-action path or a cascade connection between workflows.

| Property | Value |
|----------|-------|
| Stroke | Solid, 3px |
| Color | Trigger type color (blue/orange/green/purple, matching WorkflowNode) |
| Label | Event name or condition summary |
| Animated | Yes (pulse animation indicating trigger direction) |
| Hover behavior | Shows workflow name and trigger description |

##### 3.4 DependencyEdge

Represents a structural dependency (concept inheritance, quality rule attachment, constraint chain).

| Property | Value |
|----------|-------|
| Stroke | Dotted, 1px, dash pattern `2 4` |
| Color | `--text-color-secondary` (subtle grey) |
| Label | Dependency type (e.g., "extends", "monitors", "requires") |
| Animated | No |
| Hover behavior | Shows dependency description |

**Edge rendering implementation:** All edge types use Vue Flow's custom edge component API. Each edge type is a Vue SFC that receives `sourceX`, `sourceY`, `targetX`, `targetY`, `sourcePosition`, `targetPosition`, and typed edge data as props. Edges are rendered as SVG `<path>` elements with the specified stroke styles. Edge paths use smooth bezier curves (`getBezierPath` from Vue Flow) by default, with orthogonal routing available for grouped layouts.

**Edge animations:** DataFlowEdge and WorkflowEdge use CSS animations on `stroke-dashoffset` to create the appearance of flowing motion along the edge path. Animation direction follows the data/workflow flow direction (source to target). Animation speed is configurable but defaults to 3 seconds per full edge traversal.

**Edge labels:** Labels are rendered as `<foreignObject>` elements inside the SVG, positioned at the edge midpoint. Labels have a semi-transparent background (`--surface-card` at 85% opacity) to ensure readability against crossing edges.

#### Acceptance Criteria

- [ ] All four edge types render with visually distinct styles
- [ ] Edge labels are readable and do not overlap nodes
- [ ] Animated edges animate smoothly at 60fps
- [ ] Edge colors match the platform's design token system
- [ ] Cardinality markers on RelationshipEdge are accurate
- [ ] Custom edge types can be registered at initialization like node types

---

### 4. Canvas Modes

#### Purpose

Define the three interaction modes that control what users can do on the canvas: view (explore), edit (create/connect/delete), and focused (single element expanded).

#### Detail

##### 4.1 View Mode (Explore)

The default mode for operators and read-only users. Exploration only.

| Capability | Available |
|------------|-----------|
| Pan (drag background) | Yes |
| Zoom (scroll / pinch) | Yes |
| Click node to inspect | Yes (opens info tooltip or read-only property panel) |
| Select single node | Yes |
| Multi-select (Shift+click or drag-select) | Yes (for highlighting / filtering) |
| Drag nodes | No |
| Create nodes | No |
| Create edges | No |
| Delete elements | No |
| Context menu | Limited: inspect, filter, "Open in Builder", copy link |
| Keyboard shortcuts | Pan, zoom, search, select all |

##### 4.2 Edit Mode (Create / Connect / Delete)

Available to users with `canvas:edit` permission (typically admins and directors). Full graph editing. The mode is entered via the mode selector in the toolbar.

| Capability | Available |
|------------|-----------|
| All View Mode capabilities | Yes |
| Drag nodes to reposition | Yes (positions saved to canvas_layouts) |
| Right-click empty space to create node | Yes (opens creation dialog specific to canvas view context) |
| Drag from connection handle to create edge | Yes (opens configuration dialog) |
| Select + Delete key to remove | Yes (triggers deprecation flow with CI/QA check) |
| Context menu | Full: create, edit, delete, duplicate, group, "Open in Builder" |
| Undo/redo | Yes (section 9) |
| Multi-select + batch operations | Yes (delete multiple, group into region) |

**Edit mode writes to config:** Creating a node on canvas creates a config record (concept, workflow, route) in Postgres via the domain CRUD API. Creating an edge creates a relationship or route record. Deletions trigger the standard deprecation pipeline (impact analysis, confirmation, soft-delete). The canvas is not a separate data store. All edits flow through the canvas-config bridge (`canvas/canvas-config-bridge.md`).

##### 4.3 Focused Mode (Single Element Expanded)

A single element is expanded to show its full detail. Used for deep inspection and inline editing.

| Capability | Available |
|------------|-----------|
| Surrounding nodes dimmed (opacity 0.3) | Yes |
| Selected node expanded to show internals | Yes (properties, workflows, routes depending on node type) |
| Property panel slides out from the right (480px wide) | Yes |
| Edit properties inline (if user has edit permission) | Yes |
| Navigate related elements by clicking edges | Yes (focus transfers to clicked target) |
| Exit focused mode | Click background, press Escape, or zoom out |

**Focused mode reuses the builder's property panel:** The same form rendering logic from `ui/dynamic-forms.md` and the same property-to-input mapping from `ui/builder-to-operator.md` are used. This ensures data consistency -- editing a concept's properties on canvas produces the exact same result as editing in the builder.

**Mode transitions:**

| From | To | Trigger | Animation |
|------|----|---------|-----------|
| View | Edit | Click "Edit" in mode selector | Toolbar highlights, edit handles fade in (200ms) |
| Edit | View | Click "View" in mode selector | Edit handles fade out (200ms), undo stack preserved |
| View/Edit | Focused | Double-click node or press Enter on selected node | Non-selected nodes dim (200ms), selected node scales up, panel slides in |
| Focused | View/Edit | Click background, press Escape, or zoom out | Node scales down, panel slides out, surrounding nodes restore opacity |

#### Acceptance Criteria

- [ ] View mode prevents all editing actions (drag, create, delete)
- [ ] Edit mode requires `canvas:edit` permission via RBAC
- [ ] Focused mode dims surrounding nodes and expands the selected node
- [ ] Mode transitions are animated (200ms) and reversible
- [ ] Edit mode changes write to Postgres via the domain CRUD API
- [ ] Focused mode property panel uses the same FormKit rendering as the builder

---

### 5. Layout Algorithms

#### Purpose

Define the three layout algorithms that position nodes automatically when no saved positions exist. Each algorithm is appropriate for different graph structures.

#### Detail

##### 5.1 Force-Directed (d3-force)

**When to use:** The system graph when no specific structure is implied. Organic layouts for arbitrary graphs where relationships are not strictly hierarchical.

**Implementation:** Uses `d3-force` (BSD-3-Clause license, compatible with AGPL-3.0):

| Force | Parameter | Value |
|-------|-----------|-------|
| `forceLink` | distance | 200px |
| `forceManyBody` | strength | -300 |
| `forceCenter` | x, y | viewport center |
| `forceCollide` | radius | node width / 2 + 20px padding |

**Iteration:** 300 simulation ticks, then freeze positions. Simulation runs off-screen (nodes hidden during layout computation), then positions are applied with a 500ms animation and `fitView()` is called.

**Determinism:** Seeded random number generator (seed derived from sorted node IDs) ensures the same input produces the same layout on repeated runs.

##### 5.2 Hierarchical (dagre)

**When to use:** Workflow canvases where flow direction matters. Trigger-to-action chains. Any directed acyclic graph where rank ordering is meaningful.

**Implementation:** Uses `dagre` (MIT license):

| Parameter | Value |
|-----------|-------|
| `rankdir` | `LR` (left to right) for workflows, `TB` (top to bottom) configurable |
| `ranksep` | 150px (space between ranks) |
| `nodesep` | 80px (space between nodes in the same rank) |
| `align` | `UL` (upper-left alignment) |

**Rank assignment:** Trigger/source nodes are rank 0. Each subsequent step increments the rank. Condition nodes (diamonds) are placed between the trigger rank and the first action rank. Parallel branches maintain the same rank.

##### 5.3 Grouped (by department)

**When to use:** Department-level views on the system graph. Any graph where nodes belong to named groups and cross-group connections should be visually distinct.

**Implementation:** Custom algorithm:

1. Partition nodes by `region` (department key from `VisualizationRegion`)
2. Arrange department groups in a grid layout: `ceil(sqrt(groupCount))` columns
3. Departments with more nodes get proportionally larger regions
4. Within each group, apply force-directed layout (using d3-force with reduced repulsion)
5. Route cross-department edges around group boundaries using orthogonal edge routing
6. Size each group rectangle to fit its contents with 40px padding

**Layout selection in toolbar:** A dropdown in the canvas toolbar offers "Auto (Force)", "Flow (Hierarchical)", "Departments (Grouped)". Changing the layout re-runs the algorithm and animates nodes to their new positions over 500ms.

#### Acceptance Criteria

- [ ] Force-directed layout produces a readable graph for 50+ nodes without excessive overlap
- [ ] Hierarchical layout produces a clear left-to-right flow for workflow chains
- [ ] Grouped layout visually separates departments with colored regions
- [ ] All layout algorithms complete in under 1 second for 100 nodes
- [ ] Layout positions are deterministic for the same input data (seeded RNG for force-directed)
- [ ] Layout transitions animate nodes from old to new positions over 500ms

---

### 6. Interaction Primitives

#### Purpose

Define the low-level interaction primitives available on every canvas view: pan, zoom, select, multi-select, drag, connect, context menu, and keyboard shortcuts.

#### Detail

##### 6.1 Pan and Zoom

| Interaction | Input | Behavior |
|-------------|-------|----------|
| Pan | Click and drag on background | Viewport translates with cursor |
| Pan | Arrow keys | 10px per press, 50px with Shift held |
| Zoom in | Scroll up / pinch out / `Ctrl+=` | 10% per scroll step, centered on cursor |
| Zoom out | Scroll down / pinch in / `Ctrl+-` | 10% per scroll step, centered on cursor |
| Fit view | `Ctrl+0` or Fit button | Zoom and pan to fit all nodes in viewport |
| Reset zoom | `Ctrl+1` or 1:1 button | Set zoom to 100%, centered on current focus |
| Zoom range | — | Clamped to `minZoom` (0.1) and `maxZoom` (4) |

##### 6.2 Selection

| Interaction | Input | Behavior |
|-------------|-------|----------|
| Select node | Click on node | Node gets focus ring, previous selection cleared |
| Multi-select (additive) | Shift + click on node | Node added to selection set |
| Multi-select (box) | Click and drag on background while holding Shift | All nodes within the drag rectangle are selected |
| Select all | `Ctrl+A` | All visible nodes selected |
| Deselect | Click on background (without Shift) | All selections cleared |
| Select edge | Click on edge label or edge path | Edge gets highlight, info tooltip shown |

##### 6.3 Drag (Edit Mode Only)

| Interaction | Input | Behavior |
|-------------|-------|----------|
| Drag node | Click and drag on node | Node follows cursor, connected edges redraw |
| Drag multi-selection | Click and drag any selected node | All selected nodes move together, maintaining relative positions |
| Snap to grid | When `snapToGrid` is enabled | Node position snaps to nearest grid point on drop |
| Drag feedback | During drag | Node scales up 1.02, subtle shadow added |

##### 6.4 Connect (Edit Mode Only)

| Interaction | Input | Behavior |
|-------------|-------|----------|
| Start connection | Click and drag from a connection handle | Temporary edge follows cursor |
| Valid drop target | Drag over another node's connection handle | Target handle glows green |
| Invalid drop target | Drag over non-node area or same node | Cursor shows "not allowed" |
| Complete connection | Drop on valid target handle | Configuration dialog opens for edge type |
| Cancel connection | Drop on invalid target or press Escape | Temporary edge disappears |

##### 6.5 Context Menu

| Interaction | Input | Behavior |
|-------------|-------|----------|
| Node context menu | Right-click on node | Shows actions available for that node type + mode |
| Edge context menu | Right-click on edge | Shows edge actions (inspect, delete if edit mode) |
| Background context menu | Right-click on empty space (edit mode) | Shows "Create" options appropriate to canvas view |

Context menu items are dynamically filtered by RBAC. Actions the user lacks permission for are omitted entirely (not greyed out) to avoid clutter.

##### 6.6 Keyboard Shortcuts

| Shortcut | Action | Mode |
|----------|--------|------|
| `Ctrl+F` / `Cmd+F` | Focus search bar | All |
| `Tab` / `Shift+Tab` | Navigate between nodes | All |
| `Enter` | Open focused mode on selected node | All |
| `Escape` | Exit focused mode / deselect | All |
| `Delete` / `Backspace` | Delete selected element(s) | Edit |
| `Ctrl+Z` / `Cmd+Z` | Undo | Edit |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo | Edit |
| `Ctrl+A` / `Cmd+A` | Select all | All |
| `Ctrl+C` / `Cmd+C` | Copy deep link to selected element | All |
| `F11` or `Ctrl+Shift+F` | Toggle fullscreen | All |
| `+` / `-` | Zoom in / out | All |
| Arrow keys | Pan canvas | All |

#### Acceptance Criteria

- [ ] Pan and zoom work via mouse, trackpad, and keyboard
- [ ] Multi-select works via Shift+click and box selection
- [ ] Drag preserves relative positions for multi-selection
- [ ] Connection handles only appear in edit mode
- [ ] Context menus filter actions by RBAC (omit unauthorized actions)
- [ ] Keyboard shortcuts do not conflict with browser defaults
- [ ] All interactions are smooth at 60fps

---

### 7. Component Architecture

#### Purpose

Define how canvas components compose into a complete canvas view. The architecture follows a provider pattern where the `CanvasProvider` manages state and child components consume it.

#### Detail

**Component tree:**

```
CanvasProvider
  |-- CanvasToolbar
  |     |-- ModeSelector (View / Edit / Focused)
  |     |-- LayoutSelector (Force / Hierarchical / Grouped)
  |     |-- OverlayToggles (Data Flow, Workflows, Quality, etc.)
  |     |-- SearchBar
  |     |-- UndoRedoButtons
  |     |-- ZoomDisplay
  |     |-- FullscreenToggle
  |-- CanvasViewport (wraps VueFlow)
  |     |-- NodeRenderer (dispatches to registered node type SFCs)
  |     |-- EdgeRenderer (dispatches to registered edge type SFCs)
  |     |-- ConnectionLine (temporary edge during drag-to-connect)
  |     |-- SelectionBox (during multi-select drag)
  |-- MiniMap (bottom-right, collapsible)
  |-- PropertyPanel (right side, 480px, shown in focused mode)
  |-- ContextMenu (positioned at right-click location)
  |-- StatusBar (bottom, shows node/edge counts, connection status, zoom level)
```

**CanvasProvider responsibilities:**

- Initialize Vue Flow instance
- Manage canvas mode state
- Manage node/edge data (received from visualization architecture layer)
- Manage selection state
- Manage undo/redo stack
- Provide canvas context to all child components via Vue's `provide/inject`
- Coordinate with the canvas-config bridge for edit operations

**NodeRenderer:** Receives a `VisualizationNode`, looks up the registered component by `node.type`, and renders it with the correct props. Unknown node types render as a generic grey rectangle with the type name.

**EdgeRenderer:** Receives a `VisualizationEdge`, looks up the registered edge component by `edge.type`, and renders it with custom SVG paths. Unknown edge types render as a plain solid grey line.

#### Acceptance Criteria

- [ ] CanvasProvider initializes all child components correctly
- [ ] NodeRenderer dispatches to the correct SFC for each node type
- [ ] EdgeRenderer dispatches to the correct SFC for each edge type
- [ ] Unknown node/edge types render gracefully (not errors)
- [ ] PropertyPanel reuses builder form components via the same FormKit bridge
- [ ] All components are individually testable via Vue Test Utils

---

### 8. API Contract

#### Purpose

Define what data format the canvas engine CONSUMES. The engine does not fetch data itself -- it receives a `VisualizationGraph` from the system visualization architecture layer.

#### Detail

The canvas engine's sole input is a `VisualizationGraph`:

```typescript
interface VisualizationGraph {
  readonly nodes: ReadonlyArray<VisualizationNode>
  readonly edges: ReadonlyArray<VisualizationEdge>
  readonly regions: ReadonlyArray<VisualizationRegion>
  readonly metadata: GraphMetadata
}

interface VisualizationNode {
  readonly id: string
  readonly type: string                    // must match a registered node type
  readonly label: string                   // from Property.label (User Language Standard)
  readonly sourceId: string                // config record ID this node represents
  readonly sourceTable: string             // which config table
  readonly region?: string                 // department key for grouping
  readonly properties: Record<string, unknown>  // passed as props to the node SFC
  readonly position?: { readonly x: number, readonly y: number }
}

interface VisualizationEdge {
  readonly id: string
  readonly type: string                    // must match a registered edge type
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly label?: string
  readonly properties: Record<string, unknown>
  readonly animated?: boolean
}

interface VisualizationRegion {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly nodeIds: ReadonlyArray<string>
}

interface GraphMetadata {
  readonly generatedAt: string
  readonly sourceVersions: Record<string, number>
  readonly nodeCount: number
  readonly edgeCount: number
}
```

**Data flow:** The consuming canvas view (system graph, workflow canvas, data flow canvas) calls the visualization architecture API, receives a `VisualizationGraph`, and passes it to the `CanvasProvider`. The engine then maps `VisualizationNode` entries to registered node components and `VisualizationEdge` entries to registered edge components.

**Validation:** On receiving a graph, the engine validates:
1. All `edge.sourceNodeId` and `edge.targetNodeId` reference existing node IDs
2. All `node.type` values match registered node types (warn for unknown, render fallback)
3. All `edge.type` values match registered edge types (warn for unknown, render fallback)

#### Acceptance Criteria

- [ ] Engine accepts any valid `VisualizationGraph` without knowledge of its source
- [ ] Edges referencing nonexistent nodes are logged as warnings and skipped
- [ ] Unknown node/edge types render as generic fallbacks, not errors
- [ ] Graph metadata is accessible for display in the status bar

---

### 9. State Persistence

#### Purpose

Define how canvas layout positions and user preferences are saved and restored across sessions.

#### Detail

Canvas layout positions (node x/y coordinates, zoom level, viewport center) are user-specific preferences -- they are not part of the ontology or config data.

##### 9.1 Database Persistence (Primary)

A `canvas_layouts` table stores named layouts per user:

```sql
CREATE TABLE canvas_layouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  canvas_type     TEXT NOT NULL,           -- 'system_graph', 'workflow', 'data_flow', 'lineage'
  canvas_context  TEXT,                    -- e.g., workflow ID, department key, route pair
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

**Multiple layouts:** Users can save named layouts ("My view", "Presentation layout") and switch between them via a dropdown in the toolbar. The `default` layout is auto-created on first canvas load.

##### 9.2 Local Storage Fallback

If the database is unavailable or the save fails, positions are cached in `localStorage` under the key `canvas_layout:{canvas_type}:{canvas_context}`. On next load, the canvas checks `canvas_layouts` first, then falls back to `localStorage`.

**Load priority:**

1. `canvas_layouts` table (user's named layout for this canvas)
2. `localStorage` fallback
3. Run layout algorithm (no saved positions exist)

#### Acceptance Criteria

- [ ] Node positions persist across page reloads
- [ ] Each user has independent layout positions
- [ ] Auto-save debounces at 2 seconds to avoid excessive writes
- [ ] localStorage fallback works when database save fails
- [ ] Layout algorithm runs only when no saved positions exist
- [ ] Multiple named layouts can be saved and switched

---

### 10. Undo/Redo Stack Architecture

#### Purpose

Define the undo/redo system for edit mode changes. The stack is session-local and backed by reversible commands that interact with the platform's versioning service.

#### Detail

Edit mode maintains an in-memory command stack. Each edit operation is recorded as a reversible command:

```typescript
interface CanvasCommand {
  readonly id: string
  readonly type: 'create_node' | 'delete_node' | 'create_edge' | 'delete_edge'
    | 'move_node' | 'edit_property' | 'batch'
  readonly timestamp: number
  readonly changeSetId: string            // links to the config mutation's change_set
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
| New action after undo | Redo stack cleared (standard behavior) |

**Stack limit:** 50 commands. Oldest commands are dropped when the limit is exceeded.

**Persistence:** The undo/redo stack is session-local (not persisted across page reloads). Switching canvas modes preserves the stack within the session.

**API integration:** `forward()` and `backward()` call the domain CRUD API via the canvas-config bridge. Undoing a node creation calls the delete/deprecation endpoint. Undoing a deletion calls the create endpoint with the original data. Move-only operations (repositioning) only update the `canvas_layouts` table, not config data.

**Batch commands:** A single user action that produces multiple API calls (e.g., creating a concept + auto-generating default form/view/page) is wrapped in a single `batch` command. Undoing a batch reverses all constituent operations atomically via change-set rollback.

**Failed validations:** Commands that fail CI/QA validation are not added to the stack. Commands that are pending review are not undoable until applied or rejected.

#### Acceptance Criteria

- [ ] Undo reverses the last edit operation via API
- [ ] Redo re-applies the last undone operation
- [ ] Stack limit of 50 prevents unbounded memory growth
- [ ] Undo of a node creation deletes the config record
- [ ] Move-only operations (repositioning) do not create config changes
- [ ] Batch commands undo atomically
- [ ] Failed validations and pending reviews are excluded from the stack

---

### 11. Performance

#### Purpose

Define performance strategies for rendering large graphs: lazy loading, viewport culling, level-of-detail rendering, and edge bundling.

#### Detail

##### 11.1 Lazy Loading

For graphs with more than 100 nodes, the canvas loads nodes in tiers:

1. **Viewport nodes:** Nodes within the current viewport bounds are loaded first (immediate render)
2. **Adjacent nodes:** Nodes connected to viewport nodes by one edge are loaded next (within 200ms)
3. **Remaining nodes:** All other nodes are loaded in background batches of 50 (non-blocking)

The visualization API supports viewport-scoped queries: `GET /api/visualization/graph?viewport=x1,y1,x2,y2` returns nodes within the bounding box plus one-hop neighbors.

##### 11.2 Viewport Culling

Nodes and edges outside the current viewport are not rendered in the DOM. Vue Flow handles this natively via its `onlyRenderVisibleElements` option. This reduces DOM node count from thousands to dozens for large graphs.

##### 11.3 Level-of-Detail Rendering

At low zoom levels, nodes render as progressively simplified shapes to reduce rendering cost:

| Zoom Level | Rendering |
|------------|-----------|
| >= 0.5x | Full detail (icon, name, badges, status indicators, connection handles in edit mode) |
| 0.2x - 0.5x | Simplified (colored rectangle with name only, no badges, no icons) |
| < 0.2x | Minimal (colored dot proportional to node importance, no text) |

Transitions between detail levels use a 150ms crossfade to avoid visual popping.

##### 11.4 Edge Bundling

When more than 5 edges connect between two department groups (regions), edges are bundled into a single thick edge with a count label (e.g., "12 connections"). Clicking the bundle expands to show individual edges in a popover or by temporarily unbundling.

Edge bundling is applied only in the grouped layout at zoom levels below 0.5x. At higher zoom levels or in other layouts, all edges render individually.

#### Acceptance Criteria

- [ ] Canvas remains interactive (< 16ms frame time) with 200 visible nodes
- [ ] Initial render completes in under 1 second for 100-node graphs
- [ ] Viewport culling reduces DOM nodes to visible elements only
- [ ] Level-of-detail transitions are smooth (150ms crossfade, no flickering)
- [ ] Lazy loading shows a subtle placeholder for out-of-viewport nodes during initial load
- [ ] Edge bundling activates only when threshold (5+) is met

---

### 12. Accessibility

#### Purpose

Define keyboard navigation, ARIA labels, screen reader support, and reduced-motion compliance.

#### Detail

##### 12.1 Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next node (in tab order, which follows layout position) |
| `Shift+Tab` | Move focus to previous node |
| `Enter` | Open focused mode for the selected node |
| `Escape` | Exit focused mode, deselect, close open panels |
| `Arrow keys` | Pan canvas (10px per press, 50px with Shift held) |
| `+` / `-` | Zoom in / out |
| `Delete` | Delete selected element (edit mode only, with confirmation) |
| `Ctrl+A` | Select all nodes |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo (edit mode) |
| `Ctrl+F` | Focus search bar |
| `Space` | Activate the focused node (same as Enter) |

Focus is indicated by a 2px outline in `--primary-color` around the focused node. Focus outline meets WCAG 2.1 AA contrast requirements (minimum 3:1 contrast ratio against adjacent colors).

##### 12.2 ARIA Labels

Each node has an `aria-label` constructed from its data:

| Node Type | ARIA Label Pattern |
|-----------|-------------------|
| ConceptNode | `"{name} concept, {propertyCount} fields, {relationshipCount} connections, department {department}"` |
| WorkflowNode | `"{name} workflow, {triggerType} trigger, {actionCount} actions, {enabled ? 'enabled' : 'disabled'}"` |
| DepartmentNode | `"{name} department, {conceptCount} concepts, {memberCount} members"` |
| IntegrationNode | `"{name} integration, {type}, status {status}"` |
| QualityNode | `"{name} quality rule, severity {severity}, health {healthScore}%"` |

Edges have ARIA labels: `"{edgeType} from {sourceName} to {targetName}: {label}"`

The canvas container has `role="application"` with an `aria-label` describing the current view: `"Canvas: {canvasType}, {nodeCount} elements, {edgeCount} connections"`.

##### 12.3 Screen Reader Support

- Nodes are focusable (`tabindex="0"`) and announced with their ARIA labels
- The toolbar is a standard `role="toolbar"` with labeled buttons
- Status changes (node added, node deleted, mode changed) are announced via an ARIA live region (`role="status"`)
- The property panel is a `role="complementary"` landmark with an `aria-label`

##### 12.4 Reduced Motion

When the user has `prefers-reduced-motion: reduce` enabled:

- All edge animations (flowing dots, pulse effects) are disabled
- Layout transitions are instant (no 500ms node animation)
- Node drag follows the cursor directly without spring physics
- Level-of-detail transitions are instant (no crossfade)
- Mode transitions are instant (no fade effects)

#### Acceptance Criteria

- [ ] All nodes are reachable via Tab key navigation
- [ ] Screen readers announce node type, name, and key metadata
- [ ] Reduced motion preference disables all animations
- [ ] Keyboard shortcuts do not conflict with browser defaults
- [ ] Focus indicators meet WCAG 2.1 AA contrast requirements (3:1 minimum)
- [ ] Status changes are announced via ARIA live region
- [ ] Canvas is operable without a mouse (keyboard-only users can pan, zoom, select, inspect)

---

### 13. Theming

#### Purpose

Define how the canvas engine integrates with the platform's branding and design token system.

#### Detail

The canvas engine does not define its own colors, fonts, or spacing. It consumes design tokens from the platform's branding configuration (`branding.md`). All visual properties are derived from CSS custom properties, enabling runtime theme switching without component remounting.

**Token categories used by the canvas:**

| Category | Tokens Used | Where |
|----------|-------------|-------|
| Surface | `--surface-card`, `--surface-ground`, `--surface-border` | Node backgrounds, canvas background, borders |
| Text | `--text-color`, `--text-color-secondary` | Node labels, edge labels, badges |
| Primary | `--primary-color`, `--primary-color-text` | Selection rings, connection handles, active indicators |
| Status | `--green-500`, `--yellow-500`, `--red-500`, `--blue-500`, `--orange-500`, `--purple-500`, `--cyan-500` | Node status dots, edge colors, trigger type colors |
| Typography | `--font-family`, `--font-size` | All text rendering |

**Custom branding:** When a convention configures custom branding (primary color, logo, accent colors), the canvas automatically reflects those choices through the design token cascade. No canvas-specific branding configuration is needed.

#### Acceptance Criteria

- [ ] Canvas renders correctly with any valid set of design tokens
- [ ] Dark mode transition updates all canvas colors without remount
- [ ] Custom convention branding (primary color changes) applies to selection rings, handles, and active indicators
- [ ] No hardcoded color values in canvas component CSS

---

### 14. OSS License Compatibility

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

### 15. Test Plan

#### 15.1 Node Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| N-01 | Unit | ConceptNode renders with all props | Name, icon, badges visible |
| N-02 | Unit | ConceptNode renders deprecated state | Reduced opacity, strikethrough |
| N-03 | Unit | IntegrationNode status indicator colors | Green/grey/red match status |
| N-04 | Unit | DepartmentNode auto-sizes to contents | Container fits child nodes with padding |
| N-05 | Unit | WorkflowNode color matches trigger type | Blue/orange/green/purple correct |
| N-06 | Unit | DataFlowNode PII shield icon renders | Shield icon matches filter mode |
| N-07 | Unit | TransformNode renders hexagonal shape | Hexagon visible, step count badge present |
| N-08 | Unit | QualityNode renders health-based color | Green/yellow/red/grey matches score range |
| N-09 | Unit | ExternalNode renders double border | Inner solid, outer dashed visible |
| N-10 | Unit | Unknown node type renders fallback | Grey rectangle with type label, no error |

#### 15.2 Edge Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| E-01 | Unit | RelationshipEdge renders solid stroke with cardinality | 2px solid, `1` and `*` markers |
| E-02 | Unit | DataFlowEdge renders dashed + animated | Dash pattern visible, animation running |
| E-03 | Unit | WorkflowEdge color matches trigger type | Correct color applied |
| E-04 | Unit | DependencyEdge renders dotted stroke | Dotted line visible |
| E-05 | Unit | Edge labels do not overlap nodes | Labels positioned at edge midpoint with background |
| E-06 | Unit | Unknown edge type renders fallback | Grey solid line, no error |

#### 15.3 Mode Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| M-01 | Integration | View mode prevents node dragging | Drag attempt does not move node |
| M-02 | Integration | View mode prevents node creation | Right-click does not show "Create" option |
| M-03 | Integration | Edit mode allows node creation via context menu | Context menu shows creation options |
| M-04 | Integration | Focused mode dims surrounding nodes | Non-selected nodes at 0.3 opacity |
| M-05 | Integration | Edit mode without RBAC permission | Edit option disabled with tooltip in mode selector |
| M-06 | Integration | Mode transition preserves undo stack | Stack intact after View -> Edit -> View |
| M-07 | Integration | Focused mode shows property panel | Panel slides in from right, 480px wide |

#### 15.4 Layout Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| L-01 | Unit | Force-directed layout produces no overlapping nodes | No node bounding boxes intersect |
| L-02 | Unit | Hierarchical layout orders nodes left-to-right by rank | Trigger at rank 0, actions at increasing ranks |
| L-03 | Unit | Grouped layout separates departments | No nodes from different departments in same region |
| L-04 | Performance | Layout algorithm completes for 100 nodes | Under 1 second |
| L-05 | Unit | Deterministic layout for same input | Same positions on repeated runs (seeded RNG) |
| L-06 | Integration | Layout change animates nodes to new positions | 500ms animation, no teleporting |

#### 15.5 Interaction Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| I-01 | Integration | Pan via mouse drag on background | Viewport translates smoothly |
| I-02 | Integration | Zoom via scroll wheel | Zoom changes centered on cursor position |
| I-03 | Integration | Multi-select via Shift+click | Multiple nodes in selection set |
| I-04 | Integration | Box selection via Shift+drag | All nodes in rectangle selected |
| I-05 | Integration | Context menu filtered by RBAC | Unauthorized actions omitted |
| I-06 | Integration | Connect via handle drag (edit mode) | Temporary edge follows cursor, dialog on drop |
| I-07 | Integration | Keyboard-only navigation | Tab through nodes, Enter to focus, Escape to exit |

#### 15.6 Persistence Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| P-01 | Integration | Save layout after node drag | `canvas_layouts` row updated |
| P-02 | Integration | Load saved layout on canvas mount | Nodes at saved positions |
| P-03 | Integration | localStorage fallback when DB unavailable | Positions loaded from localStorage |
| P-04 | Integration | Multiple named layouts per user | User can switch between saved layouts |

#### 15.7 Performance Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| PF-01 | Performance | Render 50-node graph | Under 500ms initial render |
| PF-02 | Performance | Render 200-node graph with viewport culling | Under 1 second, < 16ms frame time |
| PF-03 | Performance | Pan/zoom at 200 nodes | Smooth 60fps interaction |
| PF-04 | Performance | Level-of-detail switch on zoom | No visible frame drop during transition |
| PF-05 | Performance | Edge bundling with 20+ cross-department edges | Bundles render in < 100ms |

#### 15.8 Accessibility Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| A-01 | Unit | Tab navigation visits all nodes | Focus moves through all nodes in layout order |
| A-02 | Unit | Screen reader labels are descriptive | aria-label includes name, type, counts |
| A-03 | Unit | Reduced motion disables animations | No CSS animations when preference set |
| A-04 | Unit | Focus indicator visible | 2px outline meets WCAG AA contrast (3:1) |
| A-05 | Unit | ARIA live region announces state changes | Mode changes, node additions announced |
| A-06 | Integration | Canvas operable keyboard-only | All core interactions possible without mouse |

**Coverage target:** >=80% on canvas engine components, layout algorithms, and interaction handlers. 100% on mode permission checks and ARIA label generation.

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/system-visualization-architecture.md` | Defines the `VisualizationGraph` data contract consumed by this engine |
| `canvas/canvas-config-bridge.md` | Translates canvas edit actions into config mutations |
| `canvas/canvas-rbac.md` | Determines mode access and per-element edit permissions |
| `core/rbac-engine.md` | Canvas visibility and editing gated by RBAC permissions |
| `ui/builder-to-operator.md` | Focused mode property panel reuses builder's form rendering |
| `ui/dynamic-forms.md` | Property editing on canvas uses the same form components |
| `api/domain-crud.md` | Edit mode changes write through the domain CRUD API |
| `canvas/system-graph.md` | Primary canvas view built on this engine |
| `canvas/workflow-canvas.md` | Workflow view built on this engine |
| `canvas/data-flow-canvas.md` | Data flow view built on this engine |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Vue Flow over Cytoscape.js or D3-only | Vue Flow is Vue-native (no framework mismatch), MIT licensed, actively maintained, and supports custom node/edge components as Vue SFCs. Cytoscape uses its own rendering; D3 requires building graph interaction from scratch. |
| Eight node types, four edge types | Each visual element type in the platform has distinct semantics and visual requirements. A generic "node" component with conditional rendering would be harder to maintain, test, and extend. Typed components with typed props catch errors at compile time. |
| Node type registry pattern | Extensibility without engine modification. New node types (e.g., for future features like template nodes or approval nodes) can be registered at initialization without changing engine internals. |
| Engine is domain-agnostic | The engine renders `VisualizationGraph` data without knowing what it represents. This separation means the engine can be tested independently and reused for any graph visualization need (lineage, dependency analysis, etc.). |
| Canvas writes to config via bridge, not directly | Canvas and builder must be indistinguishable in the audit trail. The bridge enforces the same API pipeline (auth, RBAC, validation, CI/QA, audit, events) for both interfaces. |
| Layout positions in `canvas_layouts`, not ontology | Positions are per-user presentation preferences, not domain data. Storing them in ontology would pollute the shared model and create merge conflicts between users. |
| Undo/redo is session-local, max 50 | Cross-session undo would require full event-sourcing on canvas operations. Session-local is sufficient for correcting recent mistakes and avoids complexity. 50 commands covers typical editing sessions. |
| d3-force + dagre over a single layout library | Each layout type has fundamentally different requirements. Force-directed is best served by d3-force; hierarchical by dagre. No single library excels at both. |
| ARIA `role="application"` on canvas container | The canvas is a custom interactive widget, not a standard document. `role="application"` tells screen readers to pass all keystrokes through to the application, enabling the full keyboard shortcut set. |
| Reduced motion fully disables animations | Partially reducing animations (e.g., slowing them) can still cause discomfort. Full disable is the safest approach and follows WCAG 2.1 guidance. |
