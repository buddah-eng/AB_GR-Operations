/**
 * Data Lineage Service
 *
 * Traces data provenance and impact by querying the audit log, event log,
 * and data routes tables. Returns structured graph data suitable for
 * canvas rendering.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

// --- Types ---

export interface LineageNode {
  readonly id: string;
  readonly concept_key: string;
  readonly record_id: string;
  readonly action: string;
  readonly actor_id: string;
  readonly timestamp: string;
  readonly change_set?: string;
}

export interface LineageEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: string;
}

export interface LineageGraph {
  readonly nodes: ReadonlyArray<LineageNode>;
  readonly edges: ReadonlyArray<LineageEdge>;
}

export interface ImpactAnalysis {
  readonly source_concept: string;
  readonly source_field: string;
  readonly affected_routes: ReadonlyArray<{
    readonly route_id: string;
    readonly route_name: string;
    readonly dest_concept: string;
    readonly trigger_event: string;
  }>;
  readonly affected_concepts: ReadonlyArray<string>;
}

// --- Backward trace ---

/**
 * Trace where this record's data came from.
 * Queries domain_audit_log for all mutations on this record,
 * then follows change_set references to find source records.
 */
export async function traceBackward(
  conceptKey: string,
  recordId: string
): Promise<LineageGraph> {
  try {
    // Find all audit entries for this record
    const auditResult = await query(
      `SELECT id, change_set, actor_id, actor_type, action,
              table_name, record_id, created_at
       FROM domain_audit_log
       WHERE record_id = $1
       ORDER BY created_at ASC
       LIMIT 100`,
      [recordId]
    );

    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const visitedChangeSets = new Set<string>();

    for (const row of auditResult.rows) {
      const r = row as Record<string, unknown>;
      const nodeId = r.id as string;
      nodes.push({
        id: nodeId,
        concept_key: conceptKey,
        record_id: r.record_id as string,
        action: r.action as string,
        actor_id: r.actor_id as string,
        timestamp: r.created_at as string,
        change_set: r.change_set as string | undefined,
      });

      // Follow change_set to find related source records
      const changeSet = r.change_set as string | undefined;
      if (changeSet && !visitedChangeSets.has(changeSet)) {
        visitedChangeSets.add(changeSet);

        const relatedResult = await query(
          `SELECT id, change_set, actor_id, actor_type, action,
                  table_name, record_id, created_at
           FROM domain_audit_log
           WHERE change_set = $1 AND record_id != $2
           ORDER BY created_at ASC
           LIMIT 50`,
          [changeSet, recordId]
        );

        for (const related of relatedResult.rows) {
          const rel = related as Record<string, unknown>;
          const relNodeId = rel.id as string;
          nodes.push({
            id: relNodeId,
            concept_key: rel.table_name as string,
            record_id: rel.record_id as string,
            action: rel.action as string,
            actor_id: rel.actor_id as string,
            timestamp: rel.created_at as string,
            change_set: rel.change_set as string | undefined,
          });

          edges.push({
            from: relNodeId,
            to: nodeId,
            relationship: "same_change_set",
          });
        }
      }
    }

    // Also check event_log for events that created this record
    const eventResult = await query(
      `SELECT event_id, event_name, record_id, triggered_by, timestamp, change_set
       FROM event_log
       WHERE record_id = $1
       ORDER BY timestamp ASC
       LIMIT 50`,
      [recordId]
    );

    for (const row of eventResult.rows) {
      const r = row as Record<string, unknown>;
      const eventNodeId = `evt-${r.event_id as string}`;
      nodes.push({
        id: eventNodeId,
        concept_key: conceptKey,
        record_id: r.record_id as string,
        action: r.event_name as string,
        actor_id: r.triggered_by as string,
        timestamp: r.timestamp as string,
        change_set: r.change_set as string | undefined,
      });
    }

    return { nodes, edges };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Backward trace failed", { error: message, conceptKey, recordId });
    return { nodes: [], edges: [] };
  }
}

// --- Forward trace ---

/**
 * Trace what downstream records depend on this record.
 * Queries data_routes for routes sourced from this concept,
 * then checks event_log for triggered downstream actions.
 */
export async function traceForward(
  conceptKey: string,
  recordId: string
): Promise<LineageGraph> {
  try {
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];

    // Find events triggered by this record
    const eventResult = await query(
      `SELECT event_id, event_name, record_id, triggered_by, timestamp,
              change_set, workflows_triggered, actions_executed
       FROM event_log
       WHERE record_id = $1
       ORDER BY timestamp ASC
       LIMIT 100`,
      [recordId]
    );

    for (const row of eventResult.rows) {
      const r = row as Record<string, unknown>;
      const eventNodeId = `evt-${r.event_id as string}`;
      nodes.push({
        id: eventNodeId,
        concept_key: conceptKey,
        record_id: r.record_id as string,
        action: r.event_name as string,
        actor_id: r.triggered_by as string,
        timestamp: r.timestamp as string,
        change_set: r.change_set as string | undefined,
      });

      // Follow change_set to find downstream records created/updated
      const changeSet = r.change_set as string | undefined;
      if (changeSet) {
        const downstreamResult = await query(
          `SELECT id, change_set, actor_id, action,
                  table_name, record_id, created_at
           FROM domain_audit_log
           WHERE change_set = $1 AND record_id != $2
           ORDER BY created_at ASC
           LIMIT 50`,
          [changeSet, recordId]
        );

        for (const downstream of downstreamResult.rows) {
          const ds = downstream as Record<string, unknown>;
          const dsNodeId = ds.id as string;
          nodes.push({
            id: dsNodeId,
            concept_key: ds.table_name as string,
            record_id: ds.record_id as string,
            action: ds.action as string,
            actor_id: ds.actor_id as string,
            timestamp: ds.created_at as string,
            change_set: ds.change_set as string | undefined,
          });

          edges.push({
            from: eventNodeId,
            to: dsNodeId,
            relationship: "triggered",
          });
        }
      }
    }

    // Find data routes that source from this concept
    const routeResult = await query(
      `SELECT id, name, dest_concept, trigger_event
       FROM data_routes
       WHERE source_concept = $1 AND active = true`,
      [conceptKey]
    );

    for (const row of routeResult.rows) {
      const r = row as Record<string, unknown>;
      const routeNodeId = `route-${r.id as string}`;
      nodes.push({
        id: routeNodeId,
        concept_key: r.dest_concept as string,
        record_id: r.id as string,
        action: "data_route",
        actor_id: "system",
        timestamp: new Date().toISOString(),
      });

      edges.push({
        from: recordId,
        to: routeNodeId,
        relationship: "routes_to",
      });
    }

    return { nodes, edges };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Forward trace failed", { error: message, conceptKey, recordId });
    return { nodes: [], edges: [] };
  }
}

// --- Impact analysis ---

/**
 * Determines what downstream concepts and routes would be affected
 * if a specific field on a concept changes.
 */
export async function getImpactAnalysis(
  conceptKey: string,
  fieldKey: string
): Promise<ImpactAnalysis> {
  try {
    // Find data routes that source from this concept and map this field
    const routeResult = await query(
      `SELECT id, name, dest_concept, trigger_event, field_mappings
       FROM data_routes
       WHERE source_concept = $1 AND active = true`,
      [conceptKey]
    );

    const affectedRoutes: Array<{
      readonly route_id: string;
      readonly route_name: string;
      readonly dest_concept: string;
      readonly trigger_event: string;
    }> = [];

    const affectedConceptsSet = new Set<string>();

    for (const row of routeResult.rows) {
      const r = row as Record<string, unknown>;
      const mappings = r.field_mappings as Array<Record<string, unknown>> | undefined;

      // Check if field_mappings reference this field
      const fieldIsRouted = mappings?.some(
        (m) => m.source_field === fieldKey || m.sourceField === fieldKey
      ) ?? true; // If no mappings detail, assume all fields are routed

      if (fieldIsRouted) {
        const destConcept = r.dest_concept as string;
        affectedRoutes.push({
          route_id: r.id as string,
          route_name: r.name as string,
          dest_concept: destConcept,
          trigger_event: r.trigger_event as string,
        });
        affectedConceptsSet.add(destConcept);
      }
    }

    return {
      source_concept: conceptKey,
      source_field: fieldKey,
      affected_routes: affectedRoutes,
      affected_concepts: [...affectedConceptsSet],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Impact analysis failed", { error: message, conceptKey, fieldKey });
    return {
      source_concept: conceptKey,
      source_field: fieldKey,
      affected_routes: [],
      affected_concepts: [],
    };
  }
}
