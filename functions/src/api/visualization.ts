/**
 * Visualization API Routes
 *
 * Serves the system graph data for the canvas view.
 * Returns nodes (concepts) and edges (relationships) from the ontology,
 * shaped to match the frontend VisualizationGraph interface.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import type { ApiResponse } from "../ontology/types";

// --- Types (mirror web/src/types/canvas.ts) ---

interface VisualizationNode {
  readonly id: string;
  readonly type: "concept" | "workflow" | "integration" | "department";
  readonly label: string;
  readonly sourceId: string;
  readonly sourceTable: string;
  readonly region?: string;
  readonly properties: Record<string, unknown>;
  readonly position?: { x: number; y: number };
}

interface VisualizationEdge {
  readonly id: string;
  readonly type: "relationship" | "data_flow" | "workflow";
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly label?: string;
  readonly properties: Record<string, unknown>;
  readonly animated?: boolean;
}

interface VisualizationRegion {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly nodeIds: readonly string[];
}

interface VisualizationGraphMetadata {
  readonly generatedAt: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly version?: string;
}

interface VisualizationGraph {
  readonly nodes: readonly VisualizationNode[];
  readonly edges: readonly VisualizationEdge[];
  readonly regions: readonly VisualizationRegion[];
  readonly metadata: VisualizationGraphMetadata;
}

// --- Router ---

export const visualizationRouter = Router();

// --- GET /api/visualization/graph ---
// Returns the system graph for the canvas view

visualizationRouter.get("/graph", async (_req: Request, res: Response) => {
  try {
    const [concepts, relationships, properties] = await Promise.all([
      query("SELECT * FROM ontology_concepts WHERE status = 'active'"),
      query("SELECT * FROM ontology_relationships WHERE status = 'active'"),
      query(
        "SELECT concept_key, count(*) as prop_count FROM ontology_properties WHERE status = 'active' GROUP BY concept_key"
      ),
    ]);

    const propCounts: Record<string, number> = {};
    for (const r of properties.rows) {
      propCounts[r.concept_key as string] = parseInt(
        r.prop_count as string,
        10
      );
    }

    const nodes: VisualizationNode[] = concepts.rows.map((c) => ({
      id: c.key as string,
      type: "concept" as const,
      label: c.name as string,
      sourceId: c.key as string,
      sourceTable: "ontology_concepts",
      properties: {
        key: c.key as string,
        name: c.name as string,
        pluralName: c.plural_name as string,
        icon: c.icon as string,
        propertyCount: propCounts[c.key as string] ?? 0,
        isConfig: c.is_config as boolean,
        isRegistry: c.is_registry as boolean,
      },
    }));

    const edges: VisualizationEdge[] = relationships.rows.map((r) => ({
      id: `${r.source_concept_key}-${r.key}-${r.target_concept_key}`,
      sourceNodeId: r.source_concept_key as string,
      targetNodeId: r.target_concept_key as string,
      type: "relationship" as const,
      label: r.label as string,
      properties: {
        key: r.key as string,
        cardinality: r.cardinality as string,
      },
    }));

    const graph: VisualizationGraph = {
      nodes,
      edges,
      regions: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };

    const response: ApiResponse<VisualizationGraph> = {
      success: true,
      data: graph,
    };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error loading visualization graph", { error: message });
    res.status(500).json({
      success: false,
      error: `Internal error while loading visualization graph: ${message}`,
    } as ApiResponse<never>);
  }
});
