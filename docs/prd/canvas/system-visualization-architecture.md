# System Visualization Architecture

> The architectural keystone of the canvas system. Defines how the entire platform's data surfaces through
> visual representations, bridging builders, canvases, and the underlying ontology/config system. Every
> ontology concept, relationship, workflow, data route, quality rule, and integration endpoint auto-renders
> as a navigable, queryable visualization -- without any user drawing anything. This PRD defines the
> integration layer, the unified visualization model, the collector pattern, builder-canvas coherence,
> the data infrastructure bridge, caching, the API surface, and the test plan.

---

## Overview

The platform contains all the information needed to draw itself. Concepts and relationships ARE a graph. Workflows ARE flow diagrams. Data routes ARE data flow diagrams. Quality rules ARE dependency links. This architecture does not create new information -- it transforms existing config data into renderable graph structures that the canvas engine (`canvas/canvas-engine.md`) consumes.

This is the integration layer that sits between the platform's data sources (ontology tables, workflow_configs, data_routes, data_transforms, quality_rules, external_connections) and the canvas engine's rendering infrastructure. It defines:

1. **How builder edits and canvas edits both flow through the same config layer** -- they are parallel interfaces to the same data
2. **The unified visualization model** -- the `VisualizationGraph` type that all canvas views consume
3. **The collector pattern** -- one collector per data source, independent, RBAC-filtered, failure-isolated
4. **Builder-canvas coherence** -- changes in one interface appear in the other immediately
5. **The data infrastructure bridge** -- how all 11 data-infrastructure PRDs surface visually
6. **Caching and performance** -- assembled graphs cached per role+department+overlays
7. **The API surface** -- endpoints for graph retrieval, lineage, and health

Builder and canvas are PARALLEL interfaces for DIFFERENT users. Builders serve technical/power users who think in forms, lists, and batch operations. Canvas serves visual/no-code users who think in systems and connections. They read and write the SAME underlying ontology/config data. This architecture ensures they always agree.

**Dependencies:** Every data-producing PRD in the system feeds into this architecture. Key dependencies listed in section 12.

---

## Full Specification

### 1. Integration Architecture

#### Purpose

Define how builder edits and canvas edits both flow through the same config layer, ensuring that the canvas is never a separate data store and that both interfaces produce identical audit trails, domain events, and CI/QA validations.

#### Detail

##### 1.1 The Shared Config Layer

All platform configuration lives in Postgres tables. Both builders and canvases read from and write to these same tables:

| Config Domain | Postgres Table(s) | Builder Interface | Canvas Interface |
|--------------|-------------------|-------------------|-----------------|
| Ontology concepts | `ontology_concepts` | Concept Manager (list, create, edit, deprecate) | System graph (nodes, create via right-click, edit via panel) |
| Ontology properties | `ontology_properties` | Property Editor (list, add, reorder, edit) | System graph focused mode (property panel) |
| Ontology relationships | `ontology_relationships` | Relationship Editor (graph, add, edit) | System graph (edges, create via drag-connect) |
| Workflow configs | `workflow_configs` | 3-panel Workflow Builder (trigger, condition, actions) | Workflow canvas (flow diagram, drag actions from palette) |
| Data routes | `data_routes` | Route Builder (form-based, field mapping table) | Data flow canvas (drag connections between concepts/fields) |
| Data transforms | `data_transforms` | Transform Editor (chain builder) | Data flow canvas (drop from palette onto route edge) |
| Quality rules | `quality_rules` | Rule Builder (condition + threshold form) | System graph quality overlay (quality nodes) |
| External connections | `external_connections` | Integration Settings (connection forms) | System graph integration overlay (external nodes) |

Neither interface owns the data. Both are views into the same tables. The canvas-config bridge (`canvas/canvas-config-bridge.md`) ensures that canvas edits flow through the same API layer, CI/QA pipeline, and audit system as builder edits.

##### 1.2 The Event-Driven Update Flow

When ANY config changes -- regardless of which interface made it -- the following pipeline executes:

```
Config Change (builder OR canvas OR API OR import)
  |
  v
[1] API Layer writes to Postgres
  |
  v
[2] Domain event emitted via event bus (core/event-bus.md)
  |   (e.g., ontology_concept.created, workflow_config.updated, data_route.deleted)
  |
  v
[3] Event bus distributes to subscribers (ordered by priority):
  |   Priority 50:  Audit logger (core/audit-system.md)
  |   Priority 200: Route executor (data-infrastructure/data-routing.md)
  |   Priority 400: Workflow executor (automation/workflow-engine.md)
  |   Priority 700: Search indexer (data-infrastructure/platform-search.md)
  |   Priority 800: Notification engine (data-infrastructure/notifications.md)
  |   Priority 950: Real-time SSE broadcaster (data-infrastructure/real-time.md)
  |   Priority 960: Canvas-config bridge (canvas/canvas-config-bridge.md)
  |   Priority 970: Visualization cache invalidator (this PRD)
  |
  v
[4] Visualization cache invalidator:
  |   - Identifies which collector(s) are affected
  |   - Invalidates their cached output
  |   - Re-runs affected collectors
  |   - Computes graph diff (added/removed/changed nodes and edges)
  |   - Pushes diff to connected canvas clients via SSE
  |
  v
[5] Canvas clients apply diff:
      - New nodes animate in
      - Removed nodes fade out
      - Changed nodes update in place
      - Unchanged nodes preserve positions
```

This pipeline ensures that a concept created in the builder appears on the canvas within 2 seconds, and a relationship drawn on the canvas appears in the builder's relationship list within 2 seconds.

##### 1.3 Shared Data Consumption

The collector pattern (section 3) feeds BOTH canvas views AND builder views -- they consume the same data, presented differently:

| Data | Builder Presentation | Canvas Presentation |
|------|---------------------|---------------------|
| Ontology concepts | Searchable table with columns (key, name, property count, record count) | ConceptNode on the system graph (icon, name, department color, badges) |
| Relationships | Visual graph in Relationship Editor + row list | RelationshipEdge with label and cardinality markers |
| Workflow configs | 3-panel form (trigger, condition, actions) | Left-to-right flow diagram (trigger -> condition -> actions -> end) |
| Data routes | Form with field mapping table and PII mode selector | Left-to-right data flow diagram (source -> transform -> destination) |
| Quality rules | Rule form with condition builder and threshold inputs | QualityNode colored by health score, linked to monitored concept |

The data is the same. The presentation differs. The collectors normalize data into `VisualizationNode` and `VisualizationEdge` formats for canvas consumption. Builders consume the raw config records directly from the API.

#### Acceptance Criteria

- [ ] Both builder and canvas write to the same Postgres tables via the same API layer
- [ ] Config changes from either interface emit the same domain events
- [ ] The event pipeline updates both interfaces within 2 seconds
- [ ] Canvas edits produce the same audit trail entries as builder edits
- [ ] The visualization cache invalidator runs at priority 970 on the event bus

---

### 2. Unified Visualization Model

#### Purpose

Define the `VisualizationGraph` type that ALL canvas views consume. This is the single data contract between the visualization architecture and the canvas engine.

#### Detail

##### 2.1 Core Types

```typescript
interface VisualizationGraph {
  readonly nodes: ReadonlyArray<VisualizationNode>
  readonly edges: ReadonlyArray<VisualizationEdge>
  readonly regions: ReadonlyArray<VisualizationRegion>
  readonly metadata: GraphMetadata
}

interface VisualizationNode {
  readonly id: string                       // globally unique, format: "{sourceTable}:{sourceId}"
  readonly type: 'concept' | 'integration' | 'department' | 'workflow'
    | 'data_flow' | 'transform' | 'quality' | 'external'
  readonly label: string                    // from Property.label (User Language Standard, never internal keys)
  readonly sourceId: string                 // config record UUID this node represents
  readonly sourceTable: string              // which Postgres table (ontology_concepts, workflow_configs, etc.)
  readonly region?: string                  // department key for grouped layout assignment
  readonly properties: Record<string, unknown>  // type-specific metadata, passed as props to node SFC
  readonly position?: {                     // from canvas_layouts (user-placed) or auto-layout
    readonly x: number
    readonly y: number
  }
}

interface VisualizationEdge {
  readonly id: string                       // globally unique
  readonly type: 'relationship' | 'data_flow' | 'workflow' | 'dependency'
  readonly sourceNodeId: string             // must reference an existing node ID
  readonly targetNodeId: string             // must reference an existing node ID
  readonly label?: string
  readonly properties: Record<string, unknown>  // cardinality, PII indicators, transform chain, etc.
  readonly animated?: boolean               // for live data flow visualization
}

interface VisualizationRegion {
  readonly id: string                       // department key
  readonly label: string                    // department name
  readonly color: string                    // from branding config or department color hash
  readonly nodeIds: ReadonlyArray<string>   // nodes belonging to this region
}

interface GraphMetadata {
  readonly generatedAt: string              // ISO 8601
  readonly sourceVersions: Record<string, number>  // ontology version, workflow config version, etc.
  readonly nodeCount: number
  readonly edgeCount: number
  readonly regionCount: number
  readonly collectorResults: ReadonlyArray<CollectorResult>  // per-collector status
}

interface CollectorResult {
  readonly collector: string                // e.g., "ontology", "workflow", "data_route"
  readonly status: 'success' | 'partial' | 'failed'
  readonly nodeCount: number
  readonly edgeCount: number
  readonly durationMs: number
  readonly error?: string                   // present only on failure
}
```

##### 2.2 Concept Mapping Table

Every platform concept maps to a specific visualization element:

| Platform Concept | Node Type | Edge Type | Source Table |
|-----------------|-----------|-----------|-------------|
| Ontology concept | `concept` (ConceptNode) | -- | `ontology_concepts` |
| Ontology relationship | -- | `relationship` (RelationshipEdge) | `ontology_relationships` |
| Department | `department` (DepartmentNode) | -- (region, not edge) | `ontology_concepts.owner_department` (derived) |
| Workflow config | `workflow` (WorkflowNode) | `workflow` (WorkflowEdge) | `workflow_configs` |
| Data route | -- (edge only at system level) | `data_flow` (DataFlowEdge) | `data_routes` |
| Data transform | `transform` (TransformNode) | -- (inline on data flow edges) | `data_transforms` |
| Quality rule | `quality` (QualityNode) | `dependency` (DependencyEdge) | `quality_rules` |
| External connection | `external` (ExternalNode) | `data_flow` (DataFlowEdge for sync direction) | `external_connections` |
| Integration endpoint | `integration` (IntegrationNode) | `data_flow` (DataFlowEdge) | `external_pipelines` |

##### 2.3 Node Property Schemas

Each node type populates its `properties` object with type-specific metadata. The canvas engine passes these as props to the registered node SFC:

**ConceptNode properties:**
```typescript
{
  conceptKey: string
  icon: string | null
  propertyCount: number
  relationshipCount: number
  department: string | null
  status: 'active' | 'deprecated'
  hasWorkflows: boolean
}
```

**WorkflowNode properties:**
```typescript
{
  workflowId: string
  triggerType: 'domain_event' | 'field_changed' | 'scheduled' | 'manual'
  enabled: boolean
  actionCount: number
  lastExecutedAt: string | null
}
```

**DataFlowEdge properties:**
```typescript
{
  routeId: string
  routeName: string
  piiFilterMode: 'strip' | 'pass' | 'hash'
  executionMode: 'sync' | 'async'
  fieldCount: number
  sourceFields: ReadonlyArray<string>
  hasPiiFields: boolean
}
```

**QualityNode properties:**
```typescript
{
  ruleId: string
  severity: 'error' | 'warning' | 'info'
  healthScore: number | null
  violationCount: number
}
```

#### Acceptance Criteria

- [ ] `VisualizationGraph` is the sole input format consumed by all canvas views
- [ ] Every node traces back to a specific config record via `sourceId` + `sourceTable`
- [ ] The graph is serializable as JSON for caching and SSE transport
- [ ] Node labels use `Property.label` per the User Language Standard, never internal keys
- [ ] All eight node types and four edge types are represented in the mapping table
- [ ] `GraphMetadata.collectorResults` reports per-collector health

---

### 3. Collector Pattern

#### Purpose

Define the collector architecture: one collector per data source, each independent, each producing typed nodes and edges, each RBAC-filtered. Failure in one collector does not block others.

#### Detail

##### 3.1 Collector Interface

```typescript
interface VisualizationCollector {
  readonly name: string
  collect(context: CollectorContext): Promise<CollectorOutput>
}

interface CollectorContext {
  readonly roleKey: string                   // caller's RBAC role
  readonly departmentKey: string | null       // caller's department (null for admin)
  readonly filters: {
    readonly department?: string             // filter to specific department
    readonly conceptKey?: string             // filter to specific concept
    readonly overlays: ReadonlyArray<string> // which overlays are active
  }
}

interface CollectorOutput {
  readonly nodes: ReadonlyArray<VisualizationNode>
  readonly edges: ReadonlyArray<VisualizationEdge>
}
```

##### 3.2 Registered Collectors

| Collector | Reads From | Produces Nodes | Produces Edges |
|-----------|-----------|----------------|----------------|
| `OntologyCollector` | `ontology_concepts`, `ontology_properties`, `ontology_relationships` | ConceptNode per active concept, DepartmentNode per unique `owner_department` | RelationshipEdge per relationship where both endpoints are visible |
| `WorkflowCollector` | `workflow_configs` | WorkflowNode per active workflow | WorkflowEdge from trigger concept to action target concepts; CascadeEdge between chained workflows |
| `DataRouteCollector` | `data_routes`, `data_transforms` | TransformNode per route transform (when data flow overlay is active) | DataFlowEdge per enabled route |
| `QualityCollector` | `quality_rules`, `quality_scores` | QualityNode per active quality rule | DependencyEdge from rule to monitored concept |
| `ExternalPipelineCollector` | `external_connections`, `external_pipelines` | ExternalNode per external system, IntegrationNode per pipeline endpoint | DataFlowEdge showing sync direction |
| `LineageCollector` | `domain_audit_log`, `event_log`, `lineage_edges` (materialized view) | record_version nodes, transform nodes, source/destination nodes | Lineage edges (created_by, transformed_by, propagated_to, derived_from) |

##### 3.3 Collector Behavior

**RBAC filtering:** Each collector calls `roleEngine.canPerformAction(roleKey, conceptKey, 'view')` to filter its output. Nodes the caller cannot view are excluded entirely. Edges where either endpoint is excluded are also removed.

**Independence:** Collectors run in parallel via `Promise.allSettled()`. If the `QualityCollector` fails (e.g., quality_rules table is empty or service is down), the graph is assembled from the remaining collectors. The failed collector's status is recorded in `GraphMetadata.collectorResults`.

**Lazy execution:** Collectors are only invoked for active overlays. If the user has not toggled "Show Data Flows," the `DataRouteCollector` is not called. The `OntologyCollector` always runs (it provides the base graph).

| Overlay Toggle | Collectors Invoked |
|---------------|-------------------|
| Base (always) | `OntologyCollector` |
| Data Flows | `OntologyCollector` + `DataRouteCollector` |
| Workflows | `OntologyCollector` + `WorkflowCollector` |
| Quality | `OntologyCollector` + `QualityCollector` |
| Integrations | `OntologyCollector` + `ExternalPipelineCollector` |
| All overlays | All collectors |
| Lineage (on-demand) | `LineageCollector` (per-record, not per-graph) |

##### 3.4 OntologyCollector Detail

The most important collector. Produces the base graph that all other collectors attach to.

**Input:** `getOntology()` from `core/ontology-engine.md` (cached in-memory or Redis).

**Processing:**

```
1. Load all concepts from ontology cache
2. For each concept:
   a. Check RBAC: roleEngine.canPerformAction(roleKey, concept.key, 'view')
   b. If not visible: skip
   c. Create ConceptNode:
      - id: "ontology_concepts:{concept.id}"
      - type: "concept"
      - label: concept.name (not concept.key)
      - region: concept.owner_department
      - properties: { conceptKey, icon, propertyCount, relationshipCount, department, status, hasWorkflows }
3. For each relationship:
   a. Check: both source and target concepts are in the visible set
   b. If not: skip
   c. Create RelationshipEdge:
      - id: "ontology_relationships:{relationship.id}"
      - type: "relationship"
      - sourceNodeId: "ontology_concepts:{source.id}"
      - targetNodeId: "ontology_concepts:{target.id}"
      - label: relationship.label
      - properties: { cardinality, inverseKey }
4. For each unique owner_department in the visible concept set:
   a. Create DepartmentNode:
      - id: "department:{departmentKey}"
      - type: "department"
      - label: department name
      - region: departmentKey
      - properties: { color, conceptCount, memberCount }
```

##### 3.5 WorkflowCollector Detail

**Processing:**

```
1. Load enabled workflow configs from workflow_configs table
2. For each workflow:
   a. Determine the trigger concept (from workflow.trigger.event pattern, e.g., "guest.created" -> "guest")
   b. Check RBAC: roleEngine.canPerformAction(roleKey, triggerConceptKey, 'view')
   c. If not visible: skip
   d. Create WorkflowNode:
      - id: "workflow_configs:{workflow.id}"
      - type: "workflow"
      - label: workflow.name
      - region: trigger concept's department
      - properties: { triggerType, enabled, actionCount, lastExecutedAt }
   e. Create WorkflowEdge from trigger concept node to workflow node
   f. For each action that targets another concept:
      - Check RBAC on the target concept
      - If visible: create WorkflowEdge from workflow node to target concept node
3. For cascade detection (optional, when "Show Cascades" is active):
   a. For each workflow action that emits a domain event (e.g., create_record on concept X emits X.created)
   b. Find downstream workflows triggered by that event
   c. Create CascadeEdge connecting the originating action to the downstream workflow's trigger
```

##### 3.6 DataRouteCollector Detail

**Processing:**

```
1. Load enabled data routes from data_routes table
2. For each route:
   a. Check RBAC: both source and destination concepts must be visible to the caller
   b. If not: skip
   c. Create DataFlowEdge:
      - id: "data_routes:{route.id}"
      - type: "data_flow"
      - sourceNodeId: "ontology_concepts:{source_concept.id}"
      - targetNodeId: "ontology_concepts:{dest_concept.id}"
      - label: route.name
      - properties: { routeId, piiFilterMode, executionMode, fieldCount, hasPiiFields }
      - animated: true (for live data flow indicator)
   d. If route has a transform:
      - Create TransformNode:
        - id: "data_transforms:{transform.id}"
        - type: "transform"
        - label: transform.name
        - properties: { transformType, stepCount, status }
      - Split the edge: source -> transform -> destination
```

#### Acceptance Criteria

- [ ] Each collector reads from its respective Postgres table(s)
- [ ] Collectors run in parallel via `Promise.allSettled()`
- [ ] Failure in one collector does not block graph assembly
- [ ] All collectors respect RBAC (filter out nodes the caller cannot see)
- [ ] Collector output conforms to `VisualizationNode` / `VisualizationEdge` interfaces
- [ ] Lazy execution skips collectors for inactive overlays
- [ ] `GraphMetadata.collectorResults` reports each collector's status, timing, and counts

---

### 4. Graph Assembly Pipeline

#### Purpose

Define how individual collector outputs merge into a unified `VisualizationGraph`.

#### Detail

The assembly pipeline runs in sequence after all collectors complete:

```
[1] Collect
    - Run all active collectors in parallel
    - Gather nodes and edges from each collector
    |
    v
[2] Deduplicate
    - If two collectors produce the same node (e.g., a concept appears in OntologyCollector
      AND as a workflow target in WorkflowCollector), merge by node ID
    - Merging strategy: keep the node from OntologyCollector (authoritative), merge additional
      properties from other collectors (e.g., add hasWorkflows=true)
    |
    v
[3] Resolve References
    - For each edge, verify that both sourceNodeId and targetNodeId exist in the node set
    - Edges with missing endpoints are logged as warnings and excluded
    - This handles race conditions where a collector succeeded but its dependency did not
    |
    v
[4] Apply Regions
    - Group nodes by their `region` field (department key)
    - Create VisualizationRegion entries with department name, color, and node ID list
    - Nodes without a region are placed in a special "Unscoped" region
    |
    v
[5] Apply Layout
    - Load user-saved positions from canvas_layouts for positioned nodes
    - For unpositioned nodes, run the selected layout algorithm (force-directed, hierarchical, or grouped)
    - Merge saved positions with computed positions
    |
    v
[6] Apply Overlays
    - Merge optional layers based on user's active overlay toggles
    - Data flow edges only included if "Data Flows" overlay is active
    - Workflow edges only included if "Workflows" overlay is active
    - Quality nodes only included if "Quality" overlay is active
    |
    v
[7] Return VisualizationGraph
    - Complete graph with nodes, edges, regions, and metadata
```

#### Acceptance Criteria

- [ ] Assembly completes in <500ms for 50 concepts, 100 relationships, 20 workflows
- [ ] Deduplication merges nodes by ID without creating duplicates
- [ ] Missing edge endpoints produce warnings, not errors
- [ ] Regions are correctly assigned from department keys
- [ ] Saved positions are preserved; layout algorithm only runs for new/unpositioned nodes
- [ ] Overlays filter edges and nodes based on active toggles

---

### 5. Builder-Canvas Coherence

#### Purpose

Define how changes in one interface (builder or canvas) appear immediately in the other, ensuring both always reflect the same underlying state.

#### Detail

##### 5.1 Builder Edit -> Canvas Update

When a user creates, updates, or deletes a config record via the builder:

1. Builder calls the API endpoint (e.g., `POST /api/ontology/concepts`)
2. API writes to Postgres and emits a domain event (e.g., `ontology_concept.created`)
3. Event bus delivers the event to the visualization cache invalidator (priority 970)
4. Cache invalidator identifies the affected collector (OntologyCollector)
5. Invalidated collector re-runs with the caller's RBAC context
6. Graph diff is computed: new ConceptNode added, no edges changed
7. Diff pushed to connected canvas clients via SSE
8. Canvas applies the diff: new node appears with a scale-in animation at an auto-positioned location

**Specific scenarios:**

| Builder Action | Canvas Effect |
|---------------|---------------|
| Create concept in Concept Manager | ConceptNode appears on system graph at auto-positioned location |
| Edit concept name | ConceptNode label updates in place |
| Deprecate concept | ConceptNode fades out (or renders at 0.5 opacity if still visible) |
| Add relationship in Relationship Editor | RelationshipEdge appears between the two concept nodes |
| Create workflow in Workflow Builder | WorkflowNode appears (if workflow overlay is active) |
| Configure data route in Route Builder | DataFlowEdge appears (if data flow overlay is active) |
| Add quality rule in Rule Builder | QualityNode appears (if quality overlay is active) |

##### 5.2 Canvas Edit -> Builder Update

When a user creates, updates, or deletes via the canvas:

1. Canvas action dispatched to canvas-config bridge (`canvas/canvas-config-bridge.md`)
2. Bridge translates the spatial action into an API call
3. API writes to Postgres and emits a domain event
4. Builder receives the event via its own SSE subscription or next page load
5. Builder list/table reflects the new data

**Specific scenarios:**

| Canvas Action | Builder Effect |
|--------------|----------------|
| Right-click -> New Concept on system graph | Concept appears in Concept Manager table |
| Drag-connect two concepts | Relationship appears in Relationship Editor |
| Drag action from palette onto workflow flow | Action added to WorkflowConfig, visible in Workflow Builder |
| Drag connection from source to destination concept on data flow canvas | Data route appears in Route Builder list |
| Edit concept properties in focused mode panel | Property values update in Concept Manager detail view |

##### 5.3 Builder-to-Operator Translation Applies to Both

The builder-to-operator translation rules from `ui/builder-to-operator.md` apply equally to both interfaces:

- **Property-to-input mapping:** When a user edits a concept's properties in the canvas's focused mode property panel, the same FormKit input types are used as in the builder's edit form (text -> text input, select -> dropdown, date -> date picker, etc.)
- **Default generation:** When a concept is created on canvas, the same auto-generation rules fire: a default form, view, and page are created, exactly as they would be if the concept were created in the builder.
- **Guardrails:** The same builder guardrails (empty label warning, hidden-but-required conflict, duplicate label warning) apply to canvas edits. The canvas-config bridge runs the same validation pipeline.

##### 5.4 Same RBAC, Same CI/QA, Same Audit Trail

Regardless of which interface made the change:

- **RBAC:** The same `roleEngine.canPerformAction()` checks apply. A director who cannot edit org-wide concepts in the builder also cannot edit them on the canvas.
- **CI/QA pipeline:** The same risk assessment and review gates from `core/ontology-ci-qa.md` apply. High-risk changes from canvas create change requests just as they would from the builder.
- **Audit trail:** Canvas edits produce audit entries in `domain_audit_log` with `metadata.source = 'canvas'`. Builder edits produce entries with `metadata.source = 'builder'`. The entries are otherwise identical in structure and queryable by the same audit API.

#### Acceptance Criteria

- [ ] Creating a concept in the builder shows it on the canvas within 2 seconds
- [ ] Creating a concept on the canvas shows it in the builder's concept list within 2 seconds
- [ ] Creating a workflow in either interface shows it in both (when workflow overlay is active)
- [ ] Property edits on canvas use the same FormKit inputs as builder forms
- [ ] Canvas concept creation triggers the same default generation (form, view, page) as builder
- [ ] RBAC checks are identical in both interfaces (same permissions, same enforcement)
- [ ] Audit entries from both interfaces share the same schema, differ only in `metadata.source`

---

### 6. Data Infrastructure Bridge

#### Purpose

Define how all 11 data-infrastructure PRDs surface visually through the canvas system. Each infrastructure capability maps to a specific visual representation.

#### Detail

##### 6.1 Data Routing -> Data Flow Canvas Edges

**Source PRD:** `data-infrastructure/data-routing.md`

Data routes are the primary content of the data flow canvas (`canvas/data-flow-canvas.md`). Each enabled route produces a `DataFlowEdge` connecting source concept to destination concept. The edge carries metadata for PII indicators, execution mode (sync=solid, async=dashed), and field count.

At the field level (when concept nodes are expanded on the data flow canvas), individual `field_mappings` entries produce thin field-level edges connecting specific source fields to destination fields.

Multiple routes between the same concept pair are aggregated into a single thick edge with a count badge at the system graph level. They expand into individual edges on the data flow canvas.

##### 6.2 Data Transforms -> Transform Intermediate Nodes

**Source PRD:** `data-infrastructure/data-transforms.md`

When a route references a transform (via `transform_id` or `inline_transforms`), a `TransformNode` appears between source and destination on the data flow canvas. The node shows the transform chain steps (e.g., "pii_strip -> rename -> format"). Clicking expands to show individual steps.

On the system graph, transforms are not shown as separate nodes -- they are metadata on the DataFlowEdge (visible in the edge tooltip on hover).

##### 6.3 Internal Pipelines -> Aggregated Flow Paths

**Source PRD:** `data-infrastructure/internal-pipelines.md`

Internal pipelines are compositions of multiple routes. On the system graph, they render as aggregated flow paths: a thick DataFlowEdge spanning multiple concepts with a pipeline name label. On the data flow canvas, the pipeline decomposes into its constituent routes.

##### 6.4 External Pipelines -> Integration Map Nodes

**Source PRD:** `data-infrastructure/external-pipelines.md`

External pipeline endpoints render as `ExternalNode` instances positioned at the boundary of the system graph (outside department regions). Each external system shows its sync direction (inbound arrow, outbound arrow, or bidirectional) and last sync status (green/red/grey dot).

The integration overlay on the system graph shows all external connections. Clicking an ExternalNode opens a panel showing connection details, sync schedule, and recent sync history.

##### 6.5 Data Quality -> Quality Coverage Overlay

**Source PRD:** `data-infrastructure/data-quality.md`

The quality overlay colors concept nodes by their quality health score:

| Health Score | Node Color Treatment |
|-------------|---------------------|
| >= 80 (healthy) | Green tint on node border |
| 50-79 (warnings) | Yellow tint on node border |
| < 50 (violations) | Red tint on node border |
| No rules configured | Grey (unmonitored) |

`QualityNode` instances appear attached to their monitored concept via `DependencyEdge`. Each QualityNode shows its severity level and violation count. Hovering shows the rule name and current score.

Concepts without any quality rules show a subtle "Unmonitored" badge when the quality overlay is active, prompting administrators to add coverage.

##### 6.6 Data Lineage -> Provenance Trace Graphs

**Source PRD:** `data-infrastructure/data-lineage.md`

Lineage is rendered on-demand, not as a persistent overlay. When a user selects a specific record (via search or drill-down) and requests "Show Lineage," the `LineageCollector` produces a record-specific graph:

- **record_version nodes:** Specific versions of domain records in the change history
- **transform nodes:** Operations that changed data (workflow actions, route transforms, manual edits)
- **source nodes:** Origins (form submission, API import, registry pre-population)
- **destination nodes:** Endpoints (export, notification, external API call)

Lineage edges show which fields flowed along each connection. The graph is rendered using the hierarchical layout (left-to-right, showing time progression from origin to current state).

The lineage API endpoint is: `GET /api/visualization/lineage/:conceptKey/:recordId`

##### 6.7 Data Security -> PII Flow Indicators

**Source PRD:** `data-infrastructure/data-security.md` / `data/encryption.md`

PII indicators appear on multiple canvas surfaces:

| Surface | PII Indicator |
|---------|--------------|
| DataFlowEdge | Shield icon on edge: red=strip, green=pass, yellow=hash |
| ConceptNode (expanded fields) | Lock icon on fields with `ontology_properties.encrypted = true` |
| Data flow canvas field-level edges | Red accent on edges carrying PII fields |
| Security badge on route edges | Color-coded shield indicating PII filter mode |

The "Highlight PII Flows" toggle on the data flow canvas toolbar dims all non-PII edges and emphasizes PII paths with thicker, red-accented strokes.

##### 6.8 Data Observability -> Animated Flow Indicators

**Source PRD:** `data-infrastructure/data-observability.md`

When "Show Live Data" is toggled on the data flow canvas, observability metrics drive edge animations:

| Metric | Visual Effect |
|--------|--------------|
| `lastRunRecordsProcessed > 0` | Animated dots flow along the route edge |
| `throughput` (records/minute) | Dot speed and density proportional to throughput |
| `lastRunStatus = 'success'` | Green dots |
| `lastRunStatus = 'partial_failure'` | Yellow dots |
| `lastRunStatus = 'failure'` | Red dots, static (not flowing) |
| `isOverdue` | Edge pulses with red warning glow |

Animation data refreshes every 30 seconds from the observability API. The canvas engine handles the rendering loop using `requestAnimationFrame`.

##### 6.9 Notifications -> Notification Badges on Workflow Action Nodes

**Source PRD:** `data-infrastructure/notifications.md`

Workflow action nodes of type `notify` display a notification badge showing:
- The notification template name
- The recipient role(s)
- Last delivery status (green check for delivered, red X for failed)

On the system graph workflow overlay, concepts with notification-triggering workflows show a small bell icon badge.

##### 6.10 Real-Time -> SSE-Driven Canvas Updates

**Source PRD:** `data-infrastructure/real-time.md`

The real-time infrastructure provides the transport layer for canvas updates:

- **SSE endpoint:** `GET /api/events/stream` with topic filters for config change events
- **Heartbeat:** Every 30 seconds to detect connection loss
- **Reconnection:** Automatic with exponential backoff (5s, 10s, 20s, 40s, max 60s)
- **Catch-up:** On reconnect, `lastEventId` is sent to receive missed events
- **RBAC filtering:** SSE endpoint filters events by caller's permissions -- users only receive updates for config records they can view

Canvas clients subscribe to: `ontology_concept.*, ontology_relationship.*, workflow_config.*, data_route.*, data_transform.*, quality_rule.*, external_connection.*`

##### 6.11 Platform Search -> Canvas Search Bar

**Source PRD:** `data-infrastructure/platform-search.md`

The canvas search bar queries the same search index that powers the platform's global search:

- User types in the canvas search bar (`Ctrl+F`)
- Query sent to `GET /api/search?q={query}&types=concept,workflow,route`
- Results are highlighted on the canvas: matching nodes glow, non-matching nodes dim
- Selecting a result pans and zooms to center the matching node
- If the result is not on the current canvas (e.g., a workflow result on the system graph), the search offers to navigate to the appropriate canvas view

The search index updates when config changes occur (search indexer runs at priority 700 on the event bus), ensuring canvas search results reflect recent changes.

#### Acceptance Criteria

- [ ] All 11 data-infrastructure capabilities have defined visual representations
- [ ] Data routes render as DataFlowEdges with PII indicators
- [ ] Transforms render as intermediate TransformNodes on the data flow canvas
- [ ] External pipelines render as ExternalNodes at the graph boundary
- [ ] Quality overlay colors concept nodes by health score
- [ ] Lineage renders on-demand per record, not as a persistent overlay
- [ ] PII indicators appear on edges, fields, and as security badges
- [ ] Observability metrics drive edge animation speed and color
- [ ] Notification badges appear on `notify` action nodes
- [ ] SSE provides the transport for all real-time canvas updates
- [ ] Canvas search queries the same index as platform global search

---

### 7. Caching and Performance

#### Purpose

Define caching strategies for assembled graphs to ensure sub-second response times while maintaining consistency with the underlying data.

#### Detail

##### 7.1 Cache Architecture

The assembled `VisualizationGraph` is cached in memory (and optionally Redis for multi-instance deployments):

**Cache key structure:**
```
visualization:{roleKey}:{departmentKey}:{overlays}:{zoomLevel}
```

Example: `visualization:director:guest-relations:data_flow,workflow:department`

**Cache behavior:**

| Aspect | Value |
|--------|-------|
| TTL | 30 seconds |
| Storage | In-memory Map (single instance) or Redis (multi-instance) |
| Size limit | 100 cached graphs per instance |
| Eviction | LRU when size limit reached |

##### 7.2 Cache Invalidation

Cache is invalidated by event bus events. The visualization cache invalidator (priority 970) listens for:

| Event Pattern | Invalidation Scope |
|--------------|-------------------|
| `ontology_concept.*` | All cached graphs (ontology is the base layer) |
| `ontology_relationship.*` | All cached graphs |
| `ontology_property.*` | All cached graphs |
| `workflow_config.*` | Graphs with `workflow` overlay active |
| `data_route.*` | Graphs with `data_flow` overlay active |
| `data_transform.*` | Graphs with `data_flow` overlay active |
| `quality_rule.*` | Graphs with `quality` overlay active |
| `external_connection.*` | Graphs with `integrations` overlay active |
| `permission.*` | All cached graphs (RBAC changes affect visibility) |

##### 7.3 Diff-Based Updates

When a cache is invalidated, the system does not push the full graph to connected clients. Instead:

1. Re-run affected collectors
2. Re-assemble the graph
3. Compute a diff against the previous cached graph:
   ```typescript
   interface GraphDiff {
     readonly addedNodes: ReadonlyArray<VisualizationNode>
     readonly removedNodeIds: ReadonlyArray<string>
     readonly changedNodes: ReadonlyArray<{
       readonly id: string
       readonly changes: Record<string, unknown>  // only changed properties
     }>
     readonly addedEdges: ReadonlyArray<VisualizationEdge>
     readonly removedEdgeIds: ReadonlyArray<string>
     readonly changedEdges: ReadonlyArray<{
       readonly id: string
       readonly changes: Record<string, unknown>
     }>
   }
   ```
4. Push the diff via SSE to connected canvas clients
5. Canvas applies the diff: add new nodes, remove old nodes, update changed properties

This keeps SSE payload size small (typically < 1KB per change) rather than re-sending the full graph (which could be 50-200KB for a 50-concept ontology with overlays).

##### 7.4 Lazy Collector Execution

Collectors for inactive overlays are not executed. When a user toggles an overlay on:

1. Check if the graph for this overlay combination is cached
2. If cached: return immediately
3. If not cached: run the newly-needed collector, merge its output with the base graph, cache the result

This means the first toggle of a new overlay may take 200-500ms (collector execution + assembly), but subsequent accesses are < 10ms (cache hit).

#### Acceptance Criteria

- [ ] Cache hit returns assembled graph in < 10ms
- [ ] Cache miss (full assembly) completes in < 500ms for 50 concepts
- [ ] Cache invalidation targets only affected overlay combinations
- [ ] Diff-based updates keep SSE payloads under 5KB for single-record changes
- [ ] Lazy collector execution skips unused overlay collectors
- [ ] Permission changes (`permission.*` events) invalidate all cached graphs
- [ ] LRU eviction prevents unbounded memory growth (max 100 cached graphs)

---

### 8. API Surface

#### Purpose

Define the HTTP endpoints that canvas views and other consumers use to retrieve visualization data.

#### Detail

##### 8.1 Full Graph Endpoint

```
GET /api/visualization/graph
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `overlays` | comma-separated string | (none) | Active overlays: `data_flow`, `workflow`, `quality`, `integrations` |
| `department` | string | (all visible) | Filter to a specific department |
| `concept` | string | (none) | Focus on a specific concept (zoom level 3 data) |
| `zoom` | `system` \| `department` \| `concept` | `department` | Zoom level hint for level-of-detail |

**Response:** `VisualizationGraph` JSON. RBAC-filtered based on the authenticated user's role and department.

**Example:**
```
GET /api/visualization/graph?overlays=data_flow,workflow&department=guest-relations&zoom=department
```

##### 8.2 Record Lineage Endpoint

```
GET /api/visualization/lineage/:conceptKey/:recordId
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `direction` | `backward` \| `forward` \| `both` | `both` | Trace direction |
| `depth` | number | 3 | Max hops from center (max: 10) |
| `field` | string | (all fields) | Trace a specific field |

**Response:** `VisualizationGraph` JSON with lineage-specific nodes and edges. RBAC-filtered: the caller must have `lineage:read` permission and `canView` on the concept.

##### 8.3 System Health Endpoint

```
GET /api/visualization/health
```

**Response:**

```typescript
interface SystemHealthOverlay {
  readonly concepts: ReadonlyArray<{
    readonly conceptKey: string
    readonly qualityScore: number | null     // 0-100
    readonly ruleCount: number
    readonly violationCount: number
    readonly lastEvaluatedAt: string | null
  }>
  readonly routes: ReadonlyArray<{
    readonly routeId: string
    readonly lastRunStatus: 'success' | 'partial_failure' | 'failure' | null
    readonly lastRunAt: string | null
    readonly isOverdue: boolean
    readonly recordsProcessed: number
  }>
  readonly pipelines: ReadonlyArray<{
    readonly pipelineId: string
    readonly status: 'healthy' | 'degraded' | 'down'
    readonly lastHeartbeatAt: string | null
  }>
}
```

This endpoint provides data for the quality overlay and observability animations without requiring a full graph re-assembly.

##### 8.4 Authentication and RBAC

All endpoints require authentication via the platform's auth system (`core/auth-system.md`). RBAC filtering is applied at the collector level:

- `GET /api/visualization/graph` -- returns only nodes/edges the caller can view
- `GET /api/visualization/lineage/:concept/:id` -- requires `lineage:read` + `canView` on the concept
- `GET /api/visualization/health` -- requires `canvas:view` permission

#### Acceptance Criteria

- [ ] `GET /api/visualization/graph` returns valid `VisualizationGraph` JSON
- [ ] Graph is RBAC-filtered: different roles get different node/edge sets
- [ ] Response time < 500ms for medium-complexity graphs (50 concepts, 2 overlays)
- [ ] Lineage endpoint returns a per-record graph with correct trace depth
- [ ] Health endpoint returns current quality and observability data
- [ ] All endpoints require authentication
- [ ] Unauthorized access returns 403 with a user-friendly error message

---

### 9. Auto-Generated Diagram Types

#### Purpose

Define the specific diagram presets that auto-generate without user input. These are curated views of the unified graph, each answering a different question about the system.

#### Detail

| Diagram Type | Source Data | Collectors Used | Layout | Canvas View |
|-------------|------------|-----------------|--------|-------------|
| Entity-Relationship | Ontology concepts + relationships | OntologyCollector | Force-directed | System graph |
| Department Boundary Map | Ontology concepts + scoping | OntologyCollector | Grouped | System graph (zoom level 1) |
| Workflow Dependency Graph | Workflow configs + cascade detection | OntologyCollector + WorkflowCollector | Hierarchical | System graph with workflow overlay |
| Data Lineage Graph | Audit log + event log + routes | LineageCollector | Hierarchical (left-to-right) | On-demand per record |
| Integration Map | External connections + pipelines | OntologyCollector + ExternalPipelineCollector | Force-directed with externals on perimeter | System graph with integration overlay |
| Quality Coverage Map | Quality rules + scores | OntologyCollector + QualityCollector | Same as current layout + color overlay | System graph with quality overlay |

Each diagram type is selectable as a "view preset" in the canvas toolbar dropdown. Selecting a preset activates the appropriate overlays, sets the layout algorithm, and adjusts the zoom level.

#### Acceptance Criteria

- [ ] Each diagram type auto-generates from its data source with zero user configuration
- [ ] Diagrams update when source data changes (via the standard event-driven pipeline)
- [ ] Each diagram type is selectable as a canvas view preset
- [ ] Selecting a preset activates the correct overlays and layout algorithm

---

### 10. Lineage Integration Detail

#### Purpose

Define the on-demand lineage visualization that traces individual records through the system.

#### Detail

Lineage visualization is triggered by user action, not shown by default. Entry points:

| Entry Point | Action |
|-------------|--------|
| System graph Level 3 (concept detail) | "Show Lineage" button on a specific record in the property panel |
| Data flow canvas | Right-click a field -> "View Lineage" |
| Platform search | Search result context menu -> "Trace Data Origin" |
| Record detail view (builder) | "View Lineage" button in the record's audit section |

**Lineage graph rendering:**

1. User requests lineage for a specific record
2. System calls `GET /api/visualization/lineage/:conceptKey/:recordId?direction=both&depth=3`
3. `LineageCollector` builds the graph from audit_log + event_log data (see `data-infrastructure/data-lineage.md`)
4. Graph returned as a `VisualizationGraph` with lineage-specific node types
5. Canvas engine renders using hierarchical layout (left-to-right, time progression)
6. Nodes show: record name, version, timestamp, actor who made the change
7. Edges show: which fields flowed, edge type (created_by, transformed_by, propagated_to, derived_from)

**Lineage node appearance:**

| Node Type | Visual |
|-----------|--------|
| `record_version` | Rounded rectangle with record name + version badge |
| `transform` | Diamond with transform type icon (workflow, route, manual edit) |
| `source` | Circle with source type icon (form, API, import, registry) |
| `destination` | Circle with destination type icon (export, notification, external API) |

#### Acceptance Criteria

- [ ] Lineage renders on-demand per record, not as a persistent overlay
- [ ] Backward trace shows the complete chain from current value to origin
- [ ] Forward trace shows all downstream records that depend on this data
- [ ] Lineage graph uses hierarchical layout for readability
- [ ] Lineage requires `lineage:read` permission

---

### 11. Real-Time Synchronization

#### Purpose

Define how the visualization stays current when the platform changes, using SSE for push-based updates and diff computation for efficient transport.

#### Detail

##### 11.1 Event Bus Subscription

The visualization cache invalidator subscribes to the event bus at priority 970:

| Event Pattern | Action |
|--------------|--------|
| `ontology_concept.*` | Invalidate OntologyCollector cache, re-collect, compute diff |
| `ontology_relationship.*` | Invalidate OntologyCollector cache |
| `ontology_property.*` | Invalidate OntologyCollector cache |
| `workflow_config.*` | Invalidate WorkflowCollector cache |
| `data_route.*` | Invalidate DataRouteCollector cache |
| `data_transform.*` | Invalidate DataRouteCollector cache |
| `quality_rule.*` | Invalidate QualityCollector cache |
| `quality_score.*` | Update health overlay data (no full re-collect needed) |
| `external_connection.*` | Invalidate ExternalPipelineCollector cache |
| `permission.*` | Invalidate ALL caches (RBAC changes affect visibility) |

##### 11.2 SSE Push to Canvas Clients

After cache invalidation and diff computation:

1. The diff is serialized as a `GraphDiff` JSON payload
2. Pushed to connected canvas clients via the SSE endpoint
3. Each client receives only diffs relevant to their active overlays and RBAC scope
4. Canvas applies the diff:
   - Added nodes: appear with a scale-in animation (0 -> 1 over 300ms)
   - Removed nodes: fade out over 300ms
   - Changed nodes: properties update in place (label, badges, status dots)
   - Edge changes: similar add/remove/update behavior
   - Positions of unchanged nodes are preserved

##### 11.3 Conflict Handling

When a user is actively editing a node that receives an SSE update:

1. The update is queued (not applied immediately)
2. A notification banner shows: "This element was updated by {actor}. Your canvas will refresh when you finish editing."
3. When the user saves or cancels their edit, the queued updates are applied
4. If the user's edit conflicts with the SSE update (same record, different version), server-wins resolution applies (see `canvas/canvas-config-bridge.md` section 4)

##### 11.4 Fallback

If SSE is unavailable (network issues, server restart):

1. Canvas detects missing heartbeats (60 seconds without heartbeat)
2. "Live sync unavailable" indicator appears in the toolbar
3. Canvas falls back to polling `GET /api/visualization/graph` every 30 seconds
4. Editing is disabled during disconnected state
5. On reconnect: `lastEventId` sent to catch up on missed events

#### Acceptance Criteria

- [ ] Config changes appear on connected canvases within 2 seconds
- [ ] Diff-based SSE pushes keep payloads small (< 5KB for single-record changes)
- [ ] Active edits are not disrupted by incoming SSE updates (queued until edit completes)
- [ ] SSE reconnection catches up on missed events via `lastEventId`
- [ ] Fallback polling activates when SSE heartbeat is lost for 60 seconds
- [ ] Permission changes trigger full cache invalidation and graph re-evaluation

---

### 12. Test Plan

#### 12.1 Collector Unit Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-01 | Unit | OntologyCollector with 10 concepts, 15 relationships | Produces 10 ConceptNodes, 15 RelationshipEdges |
| SVA-02 | Unit | OntologyCollector with RBAC filter (director, 1 department) | Only department concepts + org-wide visible |
| SVA-03 | Unit | WorkflowCollector with 5 active workflows | 5 WorkflowNodes, WorkflowEdges to trigger/target concepts |
| SVA-04 | Unit | WorkflowCollector cascade detection | CascadeEdges connect chained workflows |
| SVA-05 | Unit | DataRouteCollector with 3 routes, 1 with transform | 3 DataFlowEdges, 1 TransformNode |
| SVA-06 | Unit | DataRouteCollector PII indicators | hasPiiFields=true for routes with encrypted source fields |
| SVA-07 | Unit | QualityCollector with 4 rules | 4 QualityNodes with correct severity and health |
| SVA-08 | Unit | ExternalPipelineCollector with 2 connections | 2 ExternalNodes with sync direction and status |
| SVA-09 | Unit | Collector failure (DB connection error) | Returns empty output, status='failed' in metadata |
| SVA-10 | Unit | Collector RBAC: admin vs director vs coordinator | Different node counts per role |

#### 12.2 Assembly Integration Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-11 | Integration | Assemble graph from all collectors (50 concepts) | Complete graph in < 500ms |
| SVA-12 | Integration | Deduplication: concept in ontology + workflow target | Single node with merged properties |
| SVA-13 | Integration | Resolve references: edge with missing target | Edge excluded, warning logged |
| SVA-14 | Integration | Region assignment: 3 departments | 3 VisualizationRegions with correct node lists |
| SVA-15 | Integration | Overlay filtering: only data_flow active | No workflow or quality nodes in result |
| SVA-16 | Integration | Lazy collector: toggle workflow overlay on | WorkflowCollector runs, result merged with base |
| SVA-17 | Integration | One collector fails, others succeed | Graph assembled from successful collectors |

#### 12.3 RBAC Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-18 | Integration | Admin requests graph | All concepts, relationships, routes, workflows visible |
| SVA-19 | Integration | Director requests graph | Own department + org-wide concepts; other departments excluded |
| SVA-20 | Integration | Coordinator requests graph | Only concepts with canView permission |
| SVA-21 | Integration | Cross-department edge where target is hidden | Edge excluded from graph |
| SVA-22 | Integration | Route where destination concept is hidden | DataFlowEdge excluded |
| SVA-23 | Integration | Permission change event | All caches invalidated, graph re-evaluated |

#### 12.4 Coherence Tests (Builder <-> Canvas)

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-24 | Integration | Create concept in builder -> canvas reflects | ConceptNode appears in graph within 2 seconds |
| SVA-25 | Integration | Create concept on canvas -> builder reflects | Concept appears in builder concept list within 2 seconds |
| SVA-26 | Integration | Edit concept name in builder | ConceptNode label updates on canvas |
| SVA-27 | Integration | Deprecate concept in builder | ConceptNode fades/removed on canvas |
| SVA-28 | Integration | Create workflow in builder -> workflow overlay | WorkflowNode appears when overlay is active |
| SVA-29 | Integration | Create route on data flow canvas -> builder | Route appears in builder route list |
| SVA-30 | Integration | Edit concept properties on canvas panel | Builder detail view shows updated values |
| SVA-31 | Integration | Canvas concept creation triggers default generation | Default form, view, page auto-created (same as builder) |

#### 12.5 Caching Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-32 | Unit | Cache hit for same role+department+overlays | Returns in < 10ms |
| SVA-33 | Unit | Cache miss triggers full assembly | Assembles and caches in < 500ms |
| SVA-34 | Integration | Ontology change invalidates cache | Next request returns fresh data |
| SVA-35 | Integration | Workflow change invalidates only workflow-overlay caches | Base graph cache preserved |
| SVA-36 | Unit | LRU eviction at 100 cached graphs | Oldest entry evicted |
| SVA-37 | Integration | Diff computation: add 1 concept | Diff contains 1 addedNode, 0 removedNodeIds |
| SVA-38 | Integration | Diff computation: remove 1 concept with 3 edges | Diff contains 1 removedNodeId, 3 removedEdgeIds |

#### 12.6 API Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-39 | Integration | GET /api/visualization/graph (no params) | Returns base graph with RBAC filtering |
| SVA-40 | Integration | GET /api/visualization/graph?overlays=data_flow | Returns graph with DataFlowEdges included |
| SVA-41 | Integration | GET /api/visualization/graph?department=gr | Returns only GR department concepts |
| SVA-42 | Integration | GET /api/visualization/lineage/guest/uuid | Returns lineage graph for specific record |
| SVA-43 | Integration | GET /api/visualization/health | Returns quality scores and route health |
| SVA-44 | Integration | Unauthenticated request | 401 Unauthorized |
| SVA-45 | Integration | Request from role without canvas:view | 403 Forbidden |

#### 12.7 Real-Time Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| SVA-46 | Integration | Config change -> SSE diff push | Connected clients receive diff within 2 seconds |
| SVA-47 | Integration | SSE diff payload size for 1 concept add | < 1KB |
| SVA-48 | Integration | SSE reconnection with lastEventId | Missed events replayed in order |
| SVA-49 | Integration | Edit conflict: SSE update during active edit | Update queued, notification shown |
| SVA-50 | Integration | SSE heartbeat loss for 60 seconds | Fallback to 30-second polling |

#### 12.8 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| Full assembly: 50 concepts, 100 relationships, 20 workflows, 10 routes | All collectors | < 500ms |
| Cache hit | Same request repeated | < 10ms |
| Diff computation | 1 concept added to 50-concept graph | < 50ms |
| SSE push latency | Config change to client receipt | < 2 seconds |
| Lineage graph: record with 30-change audit history | LineageCollector | < 2 seconds |
| API response: full graph, 50 concepts, 2 overlays | /api/visualization/graph | < 500ms |

**Coverage target:** >=80% on collector logic, assembly pipeline, diff computation, and RBAC filtering. 100% on collector failure isolation (every collector failure must be handled gracefully). 100% on coherence paths (every builder-to-canvas and canvas-to-builder flow must be tested).

---

## Dependencies

| PRD | What It Provides |
|-----|-----------------|
| `core/ontology-engine.md` | Concepts, properties, relationships -- the base graph data |
| `core/ontology-scoping.md` | Department ownership for region grouping |
| `core/rbac-engine.md` | `canPerformAction()`, `getVisibleProperties()` for RBAC filtering |
| `core/event-bus.md` | Event distribution for cache invalidation and real-time updates |
| `core/audit-system.md` | Audit entries correlated by change_set for lineage |
| `core/ontology-ci-qa.md` | CI/QA pipeline that canvas edits go through |
| `automation/workflow-engine.md` | Workflow configs for flow diagrams and cascade detection |
| `data-infrastructure/data-routing.md` | Data routes for flow edges and PII indicators |
| `data-infrastructure/data-transforms.md` | Transform details for intermediate flow nodes |
| `data-infrastructure/data-quality.md` | Quality rules and scores for health overlay |
| `data-infrastructure/data-lineage.md` | Lineage graph structure for per-record tracing |
| `data-infrastructure/data-observability.md` | Pipeline health metrics for animated flow indicators |
| `data-infrastructure/external-pipelines.md` | External connections for integration map |
| `data-infrastructure/internal-pipelines.md` | Internal pipelines for aggregated flow paths |
| `data-infrastructure/data-security.md` | PII classification for security indicators |
| `data-infrastructure/notifications.md` | Notification metadata for action node badges |
| `data-infrastructure/real-time.md` | SSE transport for pushing graph diffs to clients |
| `data-infrastructure/platform-search.md` | Search index for canvas search bar |
| `canvas/canvas-engine.md` | Rendering infrastructure that consumes `VisualizationGraph` |
| `canvas/canvas-config-bridge.md` | Bidirectional binding between canvas actions and config mutations |
| `canvas/canvas-rbac.md` | Canvas-specific permissions layered on RBAC |
| `canvas/system-graph.md` | Primary consumer of the assembled graph |
| `canvas/workflow-canvas.md` | Consumer of workflow-specific graph data |
| `canvas/data-flow-canvas.md` | Consumer of route-specific graph data |
| `ui/builder-to-operator.md` | Property-to-input mapping used in canvas property panels |
| `process/user-language-standard.md` | Node labels use Property.label, never internal keys |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Written as the architectural keystone | This PRD integrates with every other PRD in the system. It had to be written with full system context. |
| Collector pattern (one per source) | Each data source is independent; failures are isolated; new sources added without changing assembly. A monolithic query would couple all sources and make partial failure impossible. |
| Collectors run via `Promise.allSettled()` | `allSettled` returns results for all promises regardless of individual failures. `all` would abort on the first failure. Convention platforms need resilience -- a quality rule database outage should not blank the entire canvas. |
| RBAC at collection time, not render time | Filtering at render time risks leaking node existence (the node would be in the client-side graph data, just not rendered). Collection-time filtering means unauthorized nodes never leave the server. |
| Diff-based SSE updates, not full graph re-send | A 50-concept graph with overlays can be 100-200KB of JSON. Pushing the full graph on every change wastes bandwidth and causes visible re-render flicker. Diffs are typically < 1KB and enable smooth animations. |
| Cached per role+department+overlays | Different users see different graphs due to RBAC. Caching must account for this. Overlay combinations determine which collectors ran. The cache key captures all dimensions that affect the graph output. |
| Lazy collector execution | Running all 6 collectors for every request wastes time when most users only have 1-2 overlays active. Lazy execution means the first toggle of a new overlay is slightly slower (200-500ms) but subsequent requests are cached. |
| Lineage is on-demand, not persistent | Lineage graphs are per-record and can be large (50+ nodes for a record with extensive change history). Including lineage in the base graph would overwhelm the system graph visualization. On-demand generation keeps the base graph clean. |
| Canvas and builder are parallel, not replacements | Some users prefer visual editing (canvas). Others prefer form-based editing (builder). Forcing all users into one paradigm reduces productivity. Both interfaces write to the same tables, so there is no sync risk. The visualization architecture ensures they always agree. |
| Event bus priority 970 for cache invalidator | After the SSE broadcaster (950) and canvas-config bridge (960), ensuring that SSE transport is ready before the cache invalidator pushes diffs. Before low-priority handlers. |
| Same CI/QA pipeline for both interfaces | Canvas edits that bypass governance would create a security and consistency risk. The same risk assessment, review gates, and approval flows apply regardless of which interface initiated the change. |
