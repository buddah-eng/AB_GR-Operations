# Data Lineage & Provenance

> Trace any piece of data back to its origin through every transformation. Lineage model: source -> transform ->
> destination chain. Every record field knows its provenance. Automatic lineage derived from audit log + event log +
> route execution log. Forward and backward trace queries. Impact analysis for change propagation. Structured for
> canvas visualization rendering.

---

## Overview

When a guest's dietary restriction shows "vegetarian" in the transport driver's briefing document, someone will eventually ask: where did that come from? Was it entered by the guest on a self-service form? Imported from last year's registry? Updated by a liaison during a phone call? Copied from a contract template? Changed by a workflow action?

The data lineage system answers these questions by interpreting the audit trail, event log, and route execution records that already exist in the platform. It does not create a separate lineage store -- it builds a queryable graph on top of existing data. The audit system records WHO changed WHAT and WHEN. The event system records WHAT HAPPENED NEXT. The lineage system connects these into a coherent provenance chain and exposes it for queries, visualization, and impact analysis.

This is a read-side service. It writes nothing to domain tables. Its only storage is an optional `lineage_edges` materialized view (or table) that pre-computes the graph for performance. All source-of-truth data remains in the audit and event logs.

**Phase:** Depends on audit system, event bus, data routing (when implemented). Blocks data observability (lineage feeds freshness and flow tracking). Read-only service -- no write-path dependencies.

---

## Full Specification

### 1. Lineage Model

#### Purpose

Define the graph structure that represents data flow through the platform.

#### Detail

The lineage graph consists of **nodes** and **edges**.

**Nodes** represent data states or transformation points:

| Node Type | What | Example |
|-----------|------|---------|
| `record_version` | A specific version of a domain record | Guest #42 at version 3 |
| `transform` | An operation that changed data | Workflow action, route transform, manual edit |
| `source` | The origin of data entering the platform | Form submission, API import, registry pre-population |
| `destination` | An endpoint where data was consumed | Export, notification, external API call |

**Edges** represent data flow between nodes:

```ts
interface LineageEdge {
  readonly id: string
  readonly sourceNodeType: 'record_version' | 'transform' | 'source'
  readonly sourceNodeId: string           // record_id:version or transform_id
  readonly targetNodeType: 'record_version' | 'transform' | 'destination'
  readonly targetNodeId: string
  readonly edgeType: 'created_by' | 'transformed_by' | 'propagated_to' | 'derived_from'
  readonly changeSetId: string            // links to audit_log.change_set
  readonly fields: ReadonlyArray<string>  // which fields flowed along this edge
  readonly timestamp: string              // ISO 8601
  readonly actorId: string
  readonly actorType: string
}
```

**Edge types:**

| Edge Type | Meaning | Example |
|-----------|---------|---------|
| `created_by` | Record was created by this source | Guest record created by self-service form submission |
| `transformed_by` | Record was modified by this transform | Workflow action updated guest status |
| `propagated_to` | Data was copied to a downstream record via a route | Guest dietary info propagated to transport briefing |
| `derived_from` | Record field values were derived from another record | Contract fields derived from guest record + template |

#### Acceptance Criteria

- [ ] Lineage graph is a directed acyclic graph (DAG) with no cycles
- [ ] Every edge links to a valid `change_set` UUID in the audit log
- [ ] Edge `fields` array accurately identifies which fields were part of the data flow
- [ ] All four edge types are supported and distinguishable

---

### 2. Lineage Sources

#### Purpose

Define all the origin types that data can enter the platform through, so lineage traces can identify the ultimate source.

#### Detail

| Source Type | How Detected | Metadata Captured |
|-------------|-------------|-------------------|
| `user_input` | Audit log entry with `actor_type = 'human'` and action `INSERT` | Actor ID, session ID, IP, form config ID |
| `api_import` | Audit log entry with `actor_type = 'api_client'` | API client ID, endpoint, batch ID |
| `workflow_action` | Event log entry with `workflows_triggered` containing the workflow ID | Workflow config ID, triggering event ID |
| `data_route` | Route execution log entry | Route ID, source concept, transform applied |
| `external_pipeline` | Audit log entry with `actor_type = 'external_token'` or specific `metadata.source` | Pipeline name, external system ID |
| `registry_prepopulation` | Audit log entry with `metadata.source = 'yoy_registry'` | Source registry table, source year, match confidence |
| `system_migration` | Audit log entry with `actor_type = 'system'` and actor_id indicating migration | Migration script name, batch timestamp |
| `ai_agent` | Audit log entry with `actor_type = 'ai_agent'` | Delegating user ID, MCP tool used |

The lineage system derives source type from existing audit log metadata. No additional tagging is required at write time -- the audit system already captures all necessary context.

#### Acceptance Criteria

- [ ] All eight source types are identifiable from existing audit log data
- [ ] Source type detection logic handles edge cases (e.g., system actor that is NOT a migration)
- [ ] Source metadata is extractable without additional writes to any table

---

### 3. Lineage Tracking

#### Purpose

Define how lineage data is collected -- automatically from existing logs vs. explicitly via metadata.

#### Detail

**3a. Automatic Lineage (Primary)**

The lineage engine constructs edges by correlating three existing data sources:

1. **Audit log** (`domain_audit_log` + `ontology_audit_log`): Provides WHO changed WHAT, WHEN, and the before/after field values.
2. **Event log** (`event_log`): Provides WHICH events fired and WHICH workflows ran as a result.
3. **Route execution log** (from data routing): Provides WHICH routes propagated data and WHAT transforms were applied.

The correlation key is `change_set` UUID, which is shared across all three:

```
audit_log.change_set = event_log.change_set
event_log.workflows_triggered → downstream audit_log.change_set (via workflow execution)
route_execution.source_change_set → route_execution.target_change_set
```

The lineage engine traverses these links to build the full graph. This is a read-time operation -- no writes occur during lineage construction.

**3b. Explicit Lineage (Supplementary)**

For cases where automatic derivation is insufficient, records can carry optional lineage metadata:

```sql
ALTER TABLE domain_data ADD COLUMN IF NOT EXISTS lineage_metadata JSONB;
```

The `lineage_metadata` JSONB field stores:

```json
{
  "source_type": "registry_prepopulation",
  "source_record_id": "uuid-of-registry-record",
  "source_year": 2025,
  "fields_from_source": ["name", "email", "dietary_restrictions"],
  "match_confidence": 0.95
}
```

This is set by the code that creates the record (e.g., the YoY pre-population job) and is read by the lineage engine as a supplementary data source.

#### Acceptance Criteria

- [ ] Automatic lineage derives edges from audit_log + event_log + route execution without additional writes
- [ ] `change_set` UUID is the primary correlation key across all three sources
- [ ] Explicit lineage metadata is optional and supplementary
- [ ] The lineage engine merges automatic and explicit lineage into a single graph

---

### 4. Lineage Queries

#### Purpose

Define the query API for tracing data backward (provenance) and forward (impact).

#### Detail

**4a. Backward Trace: "Where did this field value come from?"**

```ts
interface BackwardTraceRequest {
  readonly conceptKey: string
  readonly recordId: string
  readonly fieldKey: string          // specific field to trace
  readonly maxDepth: number          // default 10, max 50
}

interface BackwardTraceResult {
  readonly targetField: string
  readonly currentValue: unknown
  readonly traceChain: ReadonlyArray<LineageEdge>  // ordered from most recent to origin
  readonly origin: {
    readonly sourceType: string
    readonly actorId: string
    readonly timestamp: string
    readonly metadata: Record<string, unknown>
  }
}
```

The backward trace walks the lineage graph from the current record version backward through `derived_from` and `created_by` edges, filtering to edges that include the requested field in their `fields` array. Implementation joins `domain_audit_log` -> `event_log` (via `change_set`) -> upstream `domain_audit_log` (via `workflows_triggered`), recursing until the origin is found.

**4b. Forward Trace: "What downstream records depend on this field?"**

```ts
interface ForwardTraceRequest {
  readonly conceptKey: string
  readonly recordId: string
  readonly fieldKey: string
  readonly maxDepth: number          // default 10, max 50
}

interface ForwardTraceResult {
  readonly sourceField: string
  readonly dependents: ReadonlyArray<{
    readonly conceptKey: string
    readonly recordId: string
    readonly fieldKey: string
    readonly lastPropagatedAt: string
    readonly traceEdges: ReadonlyArray<LineageEdge>
  }>
}
```

The forward trace walks `propagated_to` and `transformed_by` edges from the source record outward.

#### Acceptance Criteria

- [ ] Backward trace returns the complete chain from current value to origin
- [ ] Forward trace returns all downstream dependents within the depth limit
- [ ] Traces respect the `maxDepth` limit to prevent unbounded recursion
- [ ] Both trace directions handle circular references gracefully (detect and terminate)
- [ ] Trace queries require `lineage:read` permission via RBAC

---

### 5. Lineage Visualization Data

#### Purpose

Structure lineage data for frontend canvas rendering (nodes and edges for graph visualization).

#### Detail

The lineage API returns data structured for rendering as a directed graph:

```ts
interface LineageGraphData {
  readonly nodes: ReadonlyArray<LineageNode>
  readonly edges: ReadonlyArray<LineageVisualEdge>
}

interface LineageNode {
  readonly id: string
  readonly type: 'record_version' | 'transform' | 'source' | 'destination'
  readonly label: string              // human-readable, e.g. "Guest: John Smith (v3)"
  readonly conceptKey: string | null  // null for non-record nodes
  readonly recordId: string | null
  readonly timestamp: string
  readonly metadata: Record<string, unknown>
  readonly position: { x: number, y: number } | null  // null = auto-layout
}

interface LineageVisualEdge {
  readonly id: string
  readonly source: string             // node ID
  readonly target: string             // node ID
  readonly edgeType: string
  readonly label: string              // e.g. "dietary_restrictions, name"
  readonly fields: ReadonlyArray<string>
  readonly timestamp: string
}
```

The API endpoint (`GET /api/lineage/graph`) accepts:
- `conceptKey` + `recordId`: center the graph on this record
- `direction`: `backward`, `forward`, or `both` (default: `both`)
- `depth`: how many hops from center (default: 3, max: 10)

Node positions are either auto-computed (layered layout algorithm) or provided by a saved layout. The frontend canvas component handles rendering.

#### Acceptance Criteria

- [ ] Graph data includes all nodes and edges within the requested depth
- [ ] Node labels are human-readable (concept name + record display field + version)
- [ ] Edge labels summarize the fields that flowed along the edge
- [ ] The graph structure is valid (all edge source/target IDs reference existing nodes)
- [ ] Auto-layout positions nodes in a readable left-to-right or top-to-bottom layout

---

### 6. Impact Analysis

#### Purpose

Answer "if I change this field, where does it propagate?" before the change is made.

#### Detail

Impact analysis is a forward trace query that does NOT require the change to have happened yet. It examines:

1. **Active data routes** that include the field in their source mapping
2. **Active workflows** whose trigger conditions reference the field
3. **Active quality rules** whose conditions reference the field
4. **Active contract templates** that interpolate the field

```ts
interface ImpactAnalysisRequest {
  readonly conceptKey: string
  readonly fieldKey: string
}

interface ImpactAnalysisResult {
  readonly field: string
  readonly impacts: ReadonlyArray<{
    readonly type: 'route' | 'workflow' | 'quality_rule' | 'contract_template'
    readonly targetId: string
    readonly targetName: string
    readonly description: string    // e.g. "Route: guest.dietary -> transport_briefing.special_requirements"
  }>
  readonly downstreamRecordCount: number  // estimated number of records that would be affected
}
```

The impact analysis endpoint (`GET /api/lineage/impact`) is read-only and uses configuration data (routes, workflows, rules, templates) rather than historical lineage. It answers "what COULD be affected" not "what WAS affected."

**Use case:** Before updating a guest's dietary restrictions, the liaison sees: "This field propagates to: transport briefing (via route), catering order (via workflow), event schedule notes (via workflow). 3 downstream records would be updated."

#### Acceptance Criteria

- [ ] Impact analysis returns all four impact types (routes, workflows, quality rules, templates)
- [ ] Downstream record count is an estimate based on current data scope
- [ ] Impact analysis is read-only and does not modify any data
- [ ] The endpoint requires `lineage:read` permission

---

### 7. Integration with Audit System

#### Purpose

The audit trail IS the raw lineage data. The lineage service interprets it.

#### Detail

The lineage engine is a read-side consumer of the audit system. It does not write to audit tables or modify audit data. The relationship:

- `domain_audit_log` provides: record mutations with before/after values, actor context, change_set UUIDs
- `ontology_audit_log` provides: config changes that affect data flow (route definitions, workflow configs)
- `event_log` provides: event-to-workflow linkage via `change_set` and `workflows_triggered`

The lineage engine's queries join across these tables using `change_set` as the correlation key.

**Performance consideration:** Full lineage queries can be expensive on large audit logs. The optional `lineage_edges` materialized view pre-computes the graph:

```sql
CREATE MATERIALIZED VIEW lineage_edges AS
SELECT
  d1.record_id AS source_record_id,
  d1.table_name AS source_table,
  d2.record_id AS target_record_id,
  d2.table_name AS target_table,
  d1.change_set AS source_change_set,
  d2.change_set AS target_change_set,
  e.event_type,
  d1.created_at AS source_timestamp,
  d2.created_at AS target_timestamp
FROM domain_audit_log d1
JOIN event_log e ON e.change_set = d1.change_set
JOIN domain_audit_log d2 ON d2.change_set = ANY(
  SELECT unnest(e.workflows_triggered::uuid[])
)
WHERE d1.action IN ('INSERT', 'UPDATE')
  AND d2.action IN ('INSERT', 'UPDATE');

CREATE INDEX idx_lineage_source ON lineage_edges (source_record_id, source_table);
CREATE INDEX idx_lineage_target ON lineage_edges (target_record_id, target_table);

-- Refresh nightly or on-demand
REFRESH MATERIALIZED VIEW CONCURRENTLY lineage_edges;
```

If the materialized view does not exist or is stale, the lineage engine falls back to live queries against the audit and event logs.

#### Acceptance Criteria

- [ ] Lineage engine reads from audit_log + event_log without writing to them
- [ ] `change_set` UUID is the correlation key across all source tables
- [ ] Materialized view is optional and the engine works without it
- [ ] Materialized view refresh does not lock reads (CONCURRENTLY)

---

### 8. Integration with Event Log

#### Purpose

The `change_set` UUID links audit entries to events to downstream effects, forming the lineage chain.

#### Detail

The traceability chain defined in `audit-system.md` section 5 is the foundation of lineage:

```
audit_log row (who changed what)
  └── change_set UUID
        └── event_log row (which event fired)
              └── workflows_triggered[] (which workflows ran)
                    └── domain_audit_log rows (what the workflows changed)
                          └── event_log rows (which events those changes fired)
                                └── ... (recursive until chain ends)
```

The lineage engine traverses this chain in both directions. The `change_set` UUID is the only linkage needed -- no additional foreign keys or lineage-specific columns are required.

#### Acceptance Criteria

- [ ] Lineage traversal follows the change_set chain across audit_log -> event_log -> downstream audit_log
- [ ] Recursive traversal terminates when no further downstream events exist
- [ ] Chain depth is bounded by `maxDepth` parameter

---

## 9. Test Plan

### 9.1 Lineage Model Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-01 | Unit | Build lineage edge from audit log entry | Edge has correct source, target, fields, timestamp |
| T-02 | Unit | Edge type classification: human INSERT -> `created_by` | Correct edge type |
| T-03 | Unit | Edge type classification: workflow UPDATE -> `transformed_by` | Correct edge type |
| T-04 | Unit | Edge type classification: route propagation -> `propagated_to` | Correct edge type |

### 9.2 Backward Trace Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-05 | Integration | Trace guest email to origin (user input via form) | Chain ends at `user_input` source with correct actor |
| T-06 | Integration | Trace field updated by workflow | Chain includes workflow transform node |
| T-07 | Integration | Trace field pre-populated from registry | Chain includes `registry_prepopulation` source |
| T-08 | Integration | Trace with maxDepth=1 | Returns only immediate parent, not full chain |
| T-09 | Integration | Trace field that was never changed | Returns single origin node (creation event) |

### 9.3 Forward Trace Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-10 | Integration | Trace guest dietary field forward | Returns transport briefing as dependent |
| T-11 | Integration | Forward trace with no downstream dependents | Returns empty dependents array |
| T-12 | Integration | Forward trace with maxDepth=2 | Returns dependents up to 2 hops away |

### 9.4 Impact Analysis Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-13 | Integration | Impact analysis for field used in route | Route appears in impacts |
| T-14 | Integration | Impact analysis for field used in workflow condition | Workflow appears in impacts |
| T-15 | Integration | Impact analysis for field used in quality rule | Quality rule appears in impacts |
| T-16 | Integration | Impact analysis for field with no downstream usage | Returns empty impacts |
| T-17 | Integration | Impact analysis estimates downstream record count | Count matches active records in target concepts |

### 9.5 Visualization Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-18 | Unit | Graph data structure validity | All edge source/target IDs reference existing nodes |
| T-19 | Unit | Node labels include concept name and record identifier | Labels are human-readable |
| T-20 | Integration | Graph with depth=3 centered on a record | Returns correct node/edge count |

### 9.6 Performance Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-21 | Integration | Backward trace on record with 50-change audit history | Completes in < 2 seconds |
| T-22 | Integration | Forward trace with 20 downstream dependents | Completes in < 2 seconds |
| T-23 | Integration | Impact analysis across 10 routes and 5 workflows | Completes in < 1 second |
| T-24 | Integration | Materialized view refresh on 100k audit rows | Completes in < 30 seconds |

### 9.7 Permission Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-25 | Integration | User without `lineage:read` calls trace endpoint | 403 Forbidden |
| T-26 | Integration | User with `lineage:read` calls trace endpoint | 200 with correct trace data |

### Coverage Target

80% minimum across lineage engine, trace queries, impact analysis, and graph construction. Edge type classification and source type detection require 100% (core logic).

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Read-side service over separate lineage writes | The audit and event logs already contain all lineage data. Duplicating it would create consistency risk and double the write cost. |
| `change_set` UUID as sole correlation key | This is already the proven linkage mechanism in the audit system. No new infrastructure needed. |
| Materialized view is optional | Small deployments and convention-scale data do not need pre-computed lineage. The live query path is sufficient for < 1M audit rows. |
| Impact analysis uses config, not history | "What could happen" (config-based) is more useful for pre-change decisions than "what has happened" (history-based). |
| Graph visualization data structured for canvas | The platform already uses canvas-based rendering for workflow builders. Lineage uses the same node/edge data format for consistency. |
| DAG assumption (no cycles) | Data should flow forward through the system. Cycles indicate a misconfigured route or workflow, which lineage detection can flag as an anomaly. |
