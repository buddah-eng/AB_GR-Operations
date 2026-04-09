# Auto-Visualization Engine

> The platform diagrams itself. Every ontology concept, relationship, workflow, data route, quality rule,
> and integration endpoint auto-renders as a navigable, queryable visualization — without any user
> drawing anything. This PRD defines WHAT auto-generates, from WHAT data, in WHAT format, and HOW
> it stays current. The canvas engine renders it; this engine produces it.

---

## Overview

The system graph, workflow canvas, and data flow canvas all need data — structured graph data that
describes what to render, where to place it, and how to connect it. That data comes from the ontology,
workflow configs, data routes, quality rules, and external integrations. This engine reads ALL of those
sources and produces a unified visualization model that the canvas engine consumes.

The key insight: the platform already contains all the information needed to draw itself. Concepts and
relationships ARE a graph. Workflows ARE flow diagrams. Data routes ARE data flow diagrams. Quality
rules ARE dependency links. The auto-visualization engine doesn't create new information — it
transforms existing config data into renderable graph structures.

This PRD was written last because it integrates with every other PRD in the system.

---

## Full Specification

### 1. Visualization Model

**Purpose:** Define the universal graph structure that all canvas views consume.

**Detail:**

```typescript
interface VisualizationGraph {
  nodes: VisualizationNode[]
  edges: VisualizationEdge[]
  regions: VisualizationRegion[]
  metadata: GraphMetadata
}

interface VisualizationNode {
  id: string
  type: 'concept' | 'integration' | 'department' | 'workflow' | 'transform' | 'quality_rule' | 'external_source'
  label: string                    // from Property.label (User Language Standard)
  sourceId: string                 // ontology record ID this node represents
  sourceTable: string              // which config table (ontology_concepts, workflow_configs, etc.)
  region?: string                  // department key for grouping
  properties: Record<string, unknown>  // type-specific metadata
  position?: { x: number, y: number } // from canvas_layouts (user-placed) or auto-layout
}

interface VisualizationEdge {
  id: string
  type: 'relationship' | 'data_flow' | 'workflow_path' | 'dependency' | 'quality_check' | 'integration_sync'
  sourceNodeId: string
  targetNodeId: string
  label?: string
  properties: Record<string, unknown>  // cardinality, PII indicators, transform chain, etc.
  animated?: boolean               // for live data flow visualization
}

interface VisualizationRegion {
  id: string
  label: string                    // department name
  color: string                    // from branding config
  nodeIds: string[]                // nodes in this region
}

interface GraphMetadata {
  generatedAt: string              // ISO 8601
  sourceVersions: Record<string, number>  // ontology cache version, workflow config version, etc.
  nodeCount: number
  edgeCount: number
}
```

**Acceptance Criteria:**
- [ ] VisualizationGraph is the sole input format consumed by all canvas views
- [ ] Every node traces back to a specific config record via sourceId + sourceTable
- [ ] The graph is serializable as JSON for caching and SSE transport

---

### 2. Source Data Collectors

**Purpose:** Define how each data source maps to visualization nodes and edges.

**Detail:**

| Source | PRD | Produces Nodes | Produces Edges |
|--------|-----|---------------|----------------|
| Ontology concepts | core/ontology-engine.md | ConceptNode per active concept | — |
| Ontology relationships | core/ontology-engine.md | — | RelationshipEdge per relationship |
| Ontology scoping | core/ontology-scoping.md | DepartmentNode per unique owner_department | Region groupings |
| Workflow configs | automation/workflow-engine.md | WorkflowNode per active workflow | WorkflowPathEdge from trigger concept to action target concepts |
| Data routes | data-infrastructure/data-routing.md | TransformNode per route transform | DataFlowEdge from source concept to destination concept |
| Quality rules | data-infrastructure/data-quality.md | QualityRuleNode per active rule | DependencyEdge from rule to concept it monitors |
| External connections | data-infrastructure/external-pipelines.md | ExternalSourceNode per connection | IntegrationSyncEdge from external to internal concept |
| Data pipelines | data-infrastructure/internal-pipelines.md | — (pipelines are compositions of routes) | Aggregated flow edges showing pipeline paths |

**Collector implementation:**

```typescript
interface VisualizationCollector {
  collect(filters: CollectorFilters): Promise<{ nodes: VisualizationNode[], edges: VisualizationEdge[] }>
}

// One collector per source
class OntologyCollector implements VisualizationCollector { ... }
class WorkflowCollector implements VisualizationCollector { ... }
class DataRouteCollector implements VisualizationCollector { ... }
class QualityRuleCollector implements VisualizationCollector { ... }
class ExternalPipelineCollector implements VisualizationCollector { ... }
class PipelineCollector implements VisualizationCollector { ... }
```

**Acceptance Criteria:**
- [ ] Each collector reads from its respective Postgres table(s)
- [ ] Collectors are independent — failure in one doesn't block others
- [ ] Collector output conforms to VisualizationNode/Edge interfaces
- [ ] All collectors respect RBAC (filter out nodes the caller can't see)

---

### 3. Graph Assembly

**Purpose:** Define how individual collector outputs merge into a unified graph.

**Detail:**

The assembly pipeline:

1. **Collect** — run all collectors in parallel, gather nodes and edges
2. **Deduplicate** — if two collectors produce the same node (e.g., a concept appears in ontology AND as a workflow target), merge by sourceId
3. **Resolve references** — edges reference nodes by sourceId; verify all edge endpoints exist in the node set
4. **Apply regions** — group nodes by owner_department into VisualizationRegions
5. **Apply layout** — load user-saved positions from canvas_layouts; apply auto-layout (force-directed or hierarchical) to unpositioned nodes
6. **Apply overlays** — merge optional layers (data flows, workflows, quality) based on user's toggle state
7. **Return** — complete VisualizationGraph

**Caching:**

The assembled graph is cached in memory with a 30-second TTL. Cache key includes:
- Caller's role + department (RBAC filtering varies per user)
- Active overlays (data_flow, workflow, quality)
- Zoom level (system, department, concept)

Cache invalidated when:
- Ontology changes (via ontology.invalidated event)
- Workflow configs change
- Data routes change
- Quality rules change

**Acceptance Criteria:**
- [ ] Assembly completes in <500ms for 50 concepts, 100 relationships, 20 workflows
- [ ] Cache hit returns in <10ms
- [ ] RBAC filtering produces different graphs for different roles
- [ ] Missing node references in edges produce warnings, not errors

---

### 4. Auto-Generated Diagram Types

**Purpose:** Define the specific diagram types that auto-generate without user input.

**Detail:**

Beyond the node-edge system graph, the engine produces specialized diagram data:

#### 4.1 Entity-Relationship Diagram
- Source: ontology concepts + relationships
- Format: concepts as entities with property lists, relationships as labeled edges with cardinality
- Like a database ER diagram but derived from the ontology, not the physical schema
- Auto-generates when a new concept is created

#### 4.2 Department Boundary Map
- Source: ontology scoping (owner_scope, owner_department)
- Format: departments as colored regions, concepts grouped inside, cross-department edges highlighted
- Shows the isolation boundaries and data sharing points

#### 4.3 Workflow Dependency Graph
- Source: workflow configs
- Format: workflows as nodes, edges where one workflow's action triggers another workflow's event
- Shows cascade chains: "guest.confirmed → workflow A → creates prep items → workflow B → notifies liaison"
- Auto-generates when a new workflow is created

#### 4.4 Data Lineage Graph
- Source: data-lineage service (data-infrastructure/data-lineage.md)
- Format: records as nodes, transforms as intermediate nodes, provenance as edges
- Generated on-demand for a specific record ("show me where this data came from")

#### 4.5 Integration Map
- Source: external connections + external pipelines
- Format: platform at center, external systems around the perimeter, sync edges showing direction and status
- Auto-generates from external_connections table

#### 4.6 Quality Coverage Map
- Source: quality rules + quality scores
- Format: concepts as nodes sized by record count, colored by quality score (green=healthy, yellow=warnings, red=violations)
- Shows which concepts have quality rules vs which are unmonitored

**Acceptance Criteria:**
- [ ] Each diagram type auto-generates from its data source with zero user configuration
- [ ] Diagrams update in real-time when source data changes
- [ ] Each diagram type is selectable as a canvas "view preset"

---

### 5. Real-Time Updates

**Purpose:** Define how the visualization stays current as the platform changes.

**Detail:**

The auto-visualization engine subscribes to the event bus at priority 970 (after real-time SSE at 960):

| Event Pattern | Action |
|---------------|--------|
| `ontology.*` | Invalidate ontology collector cache, re-collect |
| `workflow_config.*` | Invalidate workflow collector cache |
| `data_route.*` | Invalidate route collector cache |
| `quality_rule.*` | Invalidate quality collector cache |
| `external_connection.*` | Invalidate external collector cache |

On cache invalidation:
1. Re-run the affected collector(s)
2. Re-assemble the graph (incremental — only merge changed nodes/edges)
3. Compute diff (added/removed/changed nodes and edges)
4. Push diff to connected canvas clients via SSE (CanvasGraphUpdate event)

The canvas engine applies the diff without full re-render — nodes slide to new positions, edges animate in/out.

**Acceptance Criteria:**
- [ ] Ontology change → canvas updates within 5 seconds
- [ ] Only changed portions of the graph are re-sent (diff, not full graph)
- [ ] Canvas transitions are smooth (animated, not jarring redraws)

---

### 6. API

**Purpose:** Define the HTTP API for fetching visualization data.

**Detail:**

```
GET /api/visualization/graph?overlays=data_flow,workflow&department=gr&zoom=department
```

Parameters:
- `overlays` — comma-separated: `data_flow`, `workflow`, `quality`, `integrations`, `lineage`
- `department` — focus on a specific department (zoom level 2)
- `concept` — focus on a specific concept (zoom level 3)
- `zoom` — `system`, `department`, `concept`
- `diagram` — specific diagram type: `er`, `boundary`, `dependency`, `lineage`, `integration`, `quality`

Response: `VisualizationGraph` JSON

```
GET /api/visualization/lineage/:conceptKey/:recordId
```

Returns a lineage-specific graph for a single record.

All endpoints require authentication. RBAC applied to graph content.

**Acceptance Criteria:**
- [ ] API returns valid VisualizationGraph JSON
- [ ] RBAC filtering produces appropriate graphs per role
- [ ] Response time <500ms for medium-complexity graphs (50 concepts)

---

### 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Ontology collector | Unit | Produces correct nodes from concepts | Node count matches active concepts |
| Relationship collector | Unit | Produces correct edges | Edge count matches relationships |
| Workflow collector | Unit | Produces workflow nodes + path edges | Cross-workflow cascades detected |
| Route collector | Unit | Produces data flow edges with PII indicators | PII routes flagged |
| Quality collector | Unit | Produces quality nodes + dependency edges | Rules linked to correct concepts |
| Graph assembly | Integration | Merges all collectors, deduplicates, resolves refs | Complete graph with no orphan edges |
| RBAC filtering | Integration | Different roles get different graphs | Director sees own dept only |
| Cache behavior | Unit | Cache hit <10ms, invalidation works | Fresh data after ontology change |
| ER diagram | Integration | Auto-generates from ontology | Correct entities and cardinalities |
| Workflow dependency | Integration | Detects cascade chains | Multi-workflow chains rendered |
| Real-time update | Integration | Ontology change → graph diff pushed | Canvas updates within 5s |
| API endpoint | Integration | Returns valid VisualizationGraph | Schema validates |

**Coverage target:** ≥80% on collectors and assembly logic.

---

### 8. Dependencies

| PRD | What it provides |
|-----|-----------------|
| `core/ontology-engine.md` | Concepts, properties, relationships |
| `core/ontology-scoping.md` | Department ownership for regions |
| `automation/workflow-engine.md` | Workflow configs for flow diagrams |
| `data-infrastructure/data-routing.md` | Data routes for flow edges |
| `data-infrastructure/data-transforms.md` | Transform details for flow nodes |
| `data-infrastructure/data-quality.md` | Quality rules for coverage map |
| `data-infrastructure/data-lineage.md` | Lineage graphs for record tracing |
| `data-infrastructure/external-pipelines.md` | External connections for integration map |
| `data-infrastructure/data-observability.md` | Pipeline health for animated flow indicators |
| `data-infrastructure/real-time.md` | SSE for pushing graph updates |
| `canvas/canvas-engine.md` | Rendering infrastructure that consumes this engine's output |
| `canvas/system-graph.md` | Primary consumer of the assembled graph |
| `canvas/workflow-canvas.md` | Consumer of workflow-specific graph data |
| `canvas/data-flow-canvas.md` | Consumer of route-specific graph data |
| `canvas/canvas-rbac.md` | RBAC rules applied during collection |
| `process/user-language-standard.md` | Node labels use Property.label, not keys |

---

### 9. Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Written last | References every other PRD in the system — needed full context |
| Collector pattern | Each data source is independent; failures are isolated; new sources added without changing assembly |
| Diff-based updates | Full graph re-send on every change would be expensive; diffs keep SSE payload small |
| RBAC at collection time | Filtering at render time risks leaking node existence; collection-time filtering means unauthorized nodes never enter the graph |
| Cached per role+department | Different users see different graphs; caching must account for this |
| 6 diagram types | Each answers a different question about the system; they're views of the same underlying data, not separate systems |
