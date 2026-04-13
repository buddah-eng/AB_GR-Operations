/**
 * Ontology API Routes (Read-Only)
 *
 * Serves the domain ontology and configuration to the frontend.
 * These endpoints allow the Vue SPA to discover concepts, properties,
 * relationships, form configs, view configs, and page layouts at runtime.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import {
  getOntology,
  reloadOntology,
  getConceptByKey,
  getPropertiesForConcept,
  getRelationshipsForConcept,
  getFormConfig,
  getFormConfigByName,
  getViewConfigs,
  getViewConfigByName,
  getPageConfigs,
  getPageConfigBySlug,
} from "../ontology/loader";
import { requireAuth, requireRole } from "../auth/middleware";
import type { ApiResponse, OntologyCache } from "../ontology/types";

// --- Router ---

export const ontologyRouter = Router();

// --- GET /api/ontology ---
// Returns the full ontology (concepts, properties, relationships)

ontologyRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const ontology = await getOntology();
    const serialized = serializeOntology(ontology);

    const response: ApiResponse<typeof serialized> = {
      success: true,
      data: serialized,
    };
    // Ontology changes rarely — cache at CDN for 5 min, serve stale for 1 hour
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json(response);
  } catch (err) {
    handleError(res, err, "loading ontology");
  }
});

// --- GET /api/ontology/concepts ---
// Returns all concepts

ontologyRouter.get("/concepts", async (_req: Request, res: Response) => {
  try {
    const ontology = await getOntology();
    const concepts = Array.from(ontology.concepts.values());

    const response: ApiResponse<typeof concepts> = {
      success: true,
      data: concepts,
    };
    res.json(response);
  } catch (err) {
    handleError(res, err, "loading concepts");
  }
});

// --- GET /api/ontology/concepts/:key ---
// Returns a single concept with its properties and relationships

ontologyRouter.get("/concepts/:key", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const concept = await getConceptByKey(key);

    if (!concept) {
      res.status(404).json({
        success: false,
        error: `Concept "${key}" not found.`,
      } as ApiResponse<never>);
      return;
    }

    const properties = await getPropertiesForConcept(key);
    const relationships = await getRelationshipsForConcept(key);

    const data = {
      concept,
      properties,
      relationships,
    };

    const response: ApiResponse<typeof data> = {
      success: true,
      data,
    };
    res.json(response);
  } catch (err) {
    handleError(res, err, "loading concept");
  }
});

// --- GET /api/ontology/configs/views/:concept/:name ---
// Returns a single named view config
ontologyRouter.get(
  "/configs/views/:concept/:name",
  async (req: Request, res: Response) => {
    try {
      const { concept, name } = req.params;
      const viewConfig = await getViewConfigByName(concept, name);

      if (!viewConfig) {
        res.status(404).json({
          success: false,
          error: `No view config "${name}" found for concept "${concept}".`,
        } as ApiResponse<never>);
        return;
      }

      const response: ApiResponse<typeof viewConfig> = {
        success: true,
        data: viewConfig,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading view config");
    }
  }
);

// --- GET /api/ontology/configs/forms/:concept/:name ---
// Returns a single named form config
ontologyRouter.get(
  "/configs/forms/:concept/:name",
  async (req: Request, res: Response) => {
    try {
      const { concept, name } = req.params;
      const formConfig = await getFormConfigByName(concept, name);

      if (!formConfig) {
        res.status(404).json({
          success: false,
          error: `No form config "${name}" found for concept "${concept}".`,
        } as ApiResponse<never>);
        return;
      }

      const response: ApiResponse<typeof formConfig> = {
        success: true,
        data: formConfig,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading form config");
    }
  }
);

// --- GET /api/ontology/configs/pages/:slug ---
// Returns a single page config by slug
ontologyRouter.get(
  "/configs/pages/:slug",
  async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const pageConfig = await getPageConfigBySlug(slug);

      if (!pageConfig) {
        res.status(404).json({
          success: false,
          error: `No page config found for slug "${slug}".`,
        } as ApiResponse<never>);
        return;
      }

      const response: ApiResponse<typeof pageConfig> = {
        success: true,
        data: pageConfig,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading page config");
    }
  }
);

// --- GET /api/ontology/configs/forms/:concept ---
// Returns the form config for a concept

ontologyRouter.get(
  "/configs/forms/:concept",
  async (req: Request, res: Response) => {
    try {
      const { concept } = req.params;
      const formConfig = await getFormConfig(concept);

      if (!formConfig) {
        res.status(404).json({
          success: false,
          error: `No form config found for concept "${concept}".`,
        } as ApiResponse<never>);
        return;
      }

      const response: ApiResponse<typeof formConfig> = {
        success: true,
        data: formConfig,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading form config");
    }
  }
);

// --- GET /api/ontology/configs/views/:concept ---
// Returns all view configs for a concept

ontologyRouter.get(
  "/configs/views/:concept",
  async (req: Request, res: Response) => {
    try {
      const { concept } = req.params;
      const viewConfigs = await getViewConfigs(concept);

      const response: ApiResponse<typeof viewConfigs> = {
        success: true,
        data: viewConfigs,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading view configs");
    }
  }
);

// --- GET /api/ontology/configs/pages ---
// Returns all page configs

ontologyRouter.get("/configs/pages", async (_req: Request, res: Response) => {
  try {
    const pageConfigs = await getPageConfigs();

    const response: ApiResponse<typeof pageConfigs> = {
      success: true,
      data: pageConfigs,
    };
    res.json(response);
  } catch (err) {
    handleError(res, err, "loading page configs");
  }
});

// --- POST /api/ontology/reload ---
// Forces a full ontology cache refresh (admin only)

ontologyRouter.post(
  "/reload",
  requireAuth,
  requireRole(10), // Only high-priority roles (director level)
  async (_req: Request, res: Response) => {
    try {
      logger.info("Ontology reload requested by admin");
      const ontology = await reloadOntology();
      const serialized = serializeOntology(ontology);

      const response: ApiResponse<typeof serialized> = {
        success: true,
        data: serialized,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "reloading ontology");
    }
  }
);

// --- GET /api/ontology/visualization/graph ---
// Returns the system graph for the canvas view (fallback for /api/visualization/graph)

ontologyRouter.get(
  "/visualization/graph",
  async (_req: Request, res: Response) => {
    try {
      const { query: dbQuery } = await import("../db/client");

      const [concepts, relationships, properties] = await Promise.all([
        dbQuery("SELECT * FROM ontology_concepts WHERE status = 'active'"),
        dbQuery("SELECT * FROM ontology_relationships WHERE status = 'active'"),
        dbQuery(
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

      const nodes = concepts.rows.map((c: Record<string, unknown>) => ({
        id: c.key as string,
        type: "concept" as const,
        label: c.name as string,
        data: {
          key: c.key as string,
          name: c.name as string,
          pluralName: c.plural_name as string,
          icon: c.icon as string,
          propertyCount: propCounts[c.key as string] ?? 0,
          isConfig: c.is_config as boolean,
          isRegistry: c.is_registry as boolean,
        },
      }));

      const edges = relationships.rows.map((r: Record<string, unknown>) => ({
        id: `${r.source_concept_key}-${r.key}-${r.target_concept_key}`,
        source: r.source_concept_key as string,
        target: r.target_concept_key as string,
        type: "relationship" as const,
        label: r.label as string,
        data: {
          key: r.key as string,
          cardinality: r.cardinality as string,
        },
      }));

      const response: ApiResponse<{ nodes: typeof nodes; edges: typeof edges }> = {
        success: true,
        data: { nodes, edges },
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, "loading visualization graph");
    }
  }
);

// --- Serialization ---

/**
 * Converts the OntologyCache (which uses Maps) into a plain object
 * suitable for JSON serialization.
 */
function serializeOntology(ontology: OntologyCache): Record<string, unknown> {
  return {
    concepts: Object.fromEntries(ontology.concepts),
    properties: Object.fromEntries(
      Array.from(ontology.properties.entries()).map(
        ([key, props]) => [key, Array.from(props)]
      )
    ),
    relationships: Object.fromEntries(
      Array.from(ontology.relationships.entries()).map(
        ([key, rels]) => [key, Array.from(rels)]
      )
    ),
    events: Object.fromEntries(
      Array.from(ontology.events.entries()).map(
        ([key, evts]) => [key, Array.from(evts)]
      )
    ),
    constraints: Object.fromEntries(
      Array.from(ontology.constraints.entries()).map(
        ([key, cons]) => [key, Array.from(cons)]
      )
    ),
    loadedAt: ontology.loadedAt,
  };
}

// --- Error handling ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Internal error while ${context}: ${message}`,
  } as ApiResponse<never>);
}
