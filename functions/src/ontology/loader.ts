/**
 * Ontology Loader
 *
 * Reads the five ontology tables from Postgres (concepts, properties,
 * relationships, events, constraints) and assembles a typed OntologyCache.
 * Results are cached in memory with a 5-minute TTL.
 * Resolves concept inheritance at load time.
 */

import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS } from "../cache";
import { query } from "../db/client";
import type {
  Concept,
  Property,
  Relationship,
  DomainEventDef,
  Constraint,
  OntologyCache,
  SelectOption,
  ConditionExpression,
  ValidationRules,
  FormConfig,
  FormFieldConfig,
  FormStep,
  ViewConfig,
  ViewColumn,
  ViewFilter,
  ViewSort,
  ViewPreset,
  PageConfig,
  WidgetConfig,
} from "./types";

// --- Cache keys ---

const ONTOLOGY_CACHE_KEY = "ontology";
const FORMS_CACHE_PREFIX = "form:";
const VIEWS_CACHE_PREFIX = "views:";
const PAGES_CACHE_KEY = "pages";

// --- Ontology loading ---

export async function loadOntology(): Promise<OntologyCache> {
  logger.info("Loading ontology from Postgres...");
  const startMs = Date.now();

  const [
    conceptRows,
    propertyRows,
    relationshipRows,
    eventRows,
    constraintRows,
  ] = await Promise.all([
    query("SELECT * FROM ontology_concepts WHERE status = 'active'"),
    query("SELECT * FROM ontology_properties WHERE status = 'active' ORDER BY sort_order"),
    query("SELECT * FROM ontology_relationships WHERE status = 'active'"),
    query("SELECT * FROM ontology_events WHERE status = 'active'"),
    query("SELECT * FROM ontology_constraints WHERE status = 'active'"),
  ]);

  // --- Build concept map ---
  const concepts = new Map<string, Concept>();
  for (const row of conceptRows.rows) {
    const concept = parseConcept(row);
    if (concept) {
      concepts.set(concept.key, concept);
    }
  }

  // --- Build properties map (conceptKey -> Property[]) ---
  const propsByConceptKey = new Map<string, Property[]>();
  for (const row of propertyRows.rows) {
    const prop = parseProperty(row);
    if (prop) {
      const existing = propsByConceptKey.get(prop.conceptKey) ?? [];
      propsByConceptKey.set(prop.conceptKey, [...existing, prop]);
    }
  }

  // --- Build relationships map ---
  const relsByConceptKey = new Map<string, Relationship[]>();
  for (const row of relationshipRows.rows) {
    const rel = parseRelationship(row);
    if (rel) {
      const existing = relsByConceptKey.get(rel.sourceConceptKey) ?? [];
      relsByConceptKey.set(rel.sourceConceptKey, [...existing, rel]);
    }
  }

  // --- Build events map ---
  const eventsByConceptKey = new Map<string, DomainEventDef[]>();
  for (const row of eventRows.rows) {
    const evt = parseDomainEventDef(row);
    if (evt) {
      const existing = eventsByConceptKey.get(evt.conceptKey) ?? [];
      eventsByConceptKey.set(evt.conceptKey, [...existing, evt]);
    }
  }

  // --- Build constraints map ---
  const constraintsByConceptKey = new Map<string, Constraint[]>();
  for (const row of constraintRows.rows) {
    const constraint = parseConstraint(row);
    if (constraint) {
      const existing = constraintsByConceptKey.get(constraint.conceptKey) ?? [];
      constraintsByConceptKey.set(constraint.conceptKey, [...existing, constraint]);
    }
  }

  // --- Resolve inheritance ---
  resolveInheritance(concepts, propsByConceptKey, constraintsByConceptKey);

  // --- Freeze maps ---
  const properties = new Map<string, ReadonlyArray<Property>>();
  for (const [key, props] of propsByConceptKey.entries()) {
    properties.set(key, props);
  }

  const relationships = new Map<string, ReadonlyArray<Relationship>>();
  for (const [key, rels] of relsByConceptKey.entries()) {
    relationships.set(key, rels);
  }

  const events = new Map<string, ReadonlyArray<DomainEventDef>>();
  for (const [key, evts] of eventsByConceptKey.entries()) {
    events.set(key, evts);
  }

  const constraints = new Map<string, ReadonlyArray<Constraint>>();
  for (const [key, cons] of constraintsByConceptKey.entries()) {
    constraints.set(key, cons);
  }

  const ontologyCache: OntologyCache = {
    concepts,
    properties,
    relationships,
    events,
    constraints,
    loadedAt: Date.now(),
  };

  const elapsedMs = Date.now() - startMs;
  logger.info(
    `Ontology loaded: ${concepts.size} concepts, ` +
    `${propertyRows.rowCount} properties, ` +
    `${relationshipRows.rowCount} relationships, ` +
    `${eventRows.rowCount} events, ` +
    `${constraintRows.rowCount} constraints in ${elapsedMs}ms`
  );

  return ontologyCache;
}

// --- Inheritance resolution ---

function resolveInheritance(
  concepts: ReadonlyMap<string, Concept>,
  propsByConceptKey: Map<string, Property[]>,
  constraintsByConceptKey: Map<string, Constraint[]>
): void {
  const visited = new Set<string>();
  const resolving = new Set<string>();

  function resolve(conceptKey: string): void {
    if (visited.has(conceptKey)) return;

    if (resolving.has(conceptKey)) {
      logger.error(`Circular inheritance detected for concept: ${conceptKey}`);
      visited.add(conceptKey);
      return;
    }

    const concept = concepts.get(conceptKey);
    if (!concept?.extends) {
      visited.add(conceptKey);
      return;
    }

    resolving.add(conceptKey);

    // Resolve parent first
    resolve(concept.extends);

    const parentProps = propsByConceptKey.get(concept.extends) ?? [];
    const childProps = propsByConceptKey.get(conceptKey) ?? [];

    // Merge: parent properties first, child overrides by key
    const childPropKeys = new Set(childProps.map((p) => p.key));
    const mergedProps = [
      ...parentProps.filter((p) => !childPropKeys.has(p.key)),
      ...childProps,
    ].sort((a, b) => a.sortOrder - b.sortOrder);

    propsByConceptKey.set(conceptKey, mergedProps);

    // Concatenate constraints (parent + child)
    const parentConstraints = constraintsByConceptKey.get(concept.extends) ?? [];
    const childConstraints = constraintsByConceptKey.get(conceptKey) ?? [];
    constraintsByConceptKey.set(conceptKey, [...parentConstraints, ...childConstraints]);

    resolving.delete(conceptKey);
    visited.add(conceptKey);
  }

  for (const key of concepts.keys()) {
    resolve(key);
  }
}

// --- Public API ---

export async function getOntology(): Promise<OntologyCache> {
  return cache.getOrLoad(ONTOLOGY_CACHE_KEY, loadOntology, TTL_ONTOLOGY_MS);
}

export async function reloadOntology(): Promise<OntologyCache> {
  cache.invalidate(ONTOLOGY_CACHE_KEY);
  const freshOntology = await loadOntology();
  cache.set(ONTOLOGY_CACHE_KEY, freshOntology, TTL_ONTOLOGY_MS);
  return freshOntology;
}

export async function getConceptByKey(key: string): Promise<Concept | undefined> {
  const ontology = await getOntology();
  return ontology.concepts.get(key);
}

export async function getPropertiesForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Property>> {
  const ontology = await getOntology();
  return ontology.properties.get(conceptKey) ?? [];
}

export async function getRelationshipsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Relationship>> {
  const ontology = await getOntology();
  return ontology.relationships.get(conceptKey) ?? [];
}

export async function getEventsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<DomainEventDef>> {
  const ontology = await getOntology();
  return ontology.events.get(conceptKey) ?? [];
}

export async function getConstraintsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Constraint>> {
  const ontology = await getOntology();
  return ontology.constraints.get(conceptKey) ?? [];
}

// --- Form config loader ---

export async function getFormConfig(conceptKey: string): Promise<FormConfig | undefined> {
  const cacheKey = `${FORMS_CACHE_PREFIX}${conceptKey}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM form_configs WHERE concept_key = $1 AND status = 'active' LIMIT 1",
          [conceptKey]
        );
        if (result.rows.length === 0) return undefined;
        return parseFormConfig(result.rows[0]);
      } catch {
        logger.warn(`No form config found for concept: ${conceptKey}`);
        return undefined;
      }
    },
    TTL_ONTOLOGY_MS
  );
}

export async function getFormConfigByName(
  conceptKey: string,
  name: string
): Promise<FormConfig | undefined> {
  const cacheKey = `${FORMS_CACHE_PREFIX}${conceptKey}:${name}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM form_configs WHERE concept_key = $1 AND name = $2 AND status = 'active' LIMIT 1",
          [conceptKey, name]
        );
        if (result.rows.length === 0) return undefined;
        return parseFormConfig(result.rows[0]);
      } catch {
        logger.warn(`No form config found: ${conceptKey}/${name}`);
        return undefined;
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- View config loader ---

export async function getViewConfigs(
  conceptKey: string
): Promise<ReadonlyArray<ViewConfig>> {
  const cacheKey = `${VIEWS_CACHE_PREFIX}${conceptKey}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM view_configs WHERE concept_key = $1 AND status = 'active'",
          [conceptKey]
        );
        return result.rows.map(parseViewConfig);
      } catch {
        logger.warn(`No view configs found for concept: ${conceptKey}`);
        return [];
      }
    },
    TTL_ONTOLOGY_MS
  );
}

export async function getViewConfigByName(
  conceptKey: string,
  name: string
): Promise<ViewConfig | undefined> {
  const cacheKey = `${VIEWS_CACHE_PREFIX}${conceptKey}:${name}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM view_configs WHERE concept_key = $1 AND name = $2 AND status = 'active' LIMIT 1",
          [conceptKey, name]
        );
        if (result.rows.length === 0) return undefined;
        return parseViewConfig(result.rows[0]);
      } catch {
        logger.warn(`No view config found: ${conceptKey}/${name}`);
        return undefined;
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- Page config loader ---

export async function getPageConfigs(): Promise<ReadonlyArray<PageConfig>> {
  return cache.getOrLoad(
    PAGES_CACHE_KEY,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM page_configs WHERE status = 'active'"
        );
        return result.rows.map(parsePageConfig);
      } catch {
        logger.warn("No page configs found");
        return [];
      }
    },
    TTL_ONTOLOGY_MS
  );
}

export async function getPageConfigBySlug(
  slug: string
): Promise<PageConfig | undefined> {
  const cacheKey = `page:${slug}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT * FROM page_configs WHERE slug = $1 AND status = 'active' LIMIT 1",
          [slug]
        );
        if (result.rows.length === 0) return undefined;
        return parsePageConfig(result.rows[0]);
      } catch {
        logger.warn(`No page config found for slug: ${slug}`);
        return undefined;
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- Parsers: Postgres row -> typed ontology object ---

function parseConcept(row: Record<string, unknown>): Concept | null {
  const key = row.key as string | undefined;
  const name = row.name as string | undefined;
  if (!key || !name) {
    logger.warn("Skipping concept row with missing key or name", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    key,
    name,
    pluralName: (row.plural_name as string) ?? `${name}s`,
    extends: (row.extends as string) ?? undefined,
    icon: (row.icon as string) ?? undefined,
    description: (row.description as string) ?? undefined,
    isRegistry: row.is_registry === true,
    isConfig: row.is_config === true,
  };
}

function parseProperty(row: Record<string, unknown>): Property | null {
  const conceptKey = row.concept_key as string | undefined;
  const key = row.key as string | undefined;
  if (!conceptKey || !key) {
    logger.warn("Skipping property row with missing concept_key or key", { id: row.id });
    return null;
  }

  const validationRules = row.validation_rules as ValidationRules | null;

  return {
    id: row.id as string,
    conceptKey,
    key,
    label: (row.label as string) ?? key,
    type: (row.type as Property["type"]) ?? "text",
    required: row.required === true,
    defaultValue: row.default_value ?? undefined,
    placeholder: (row.placeholder as string) ?? undefined,
    description: (row.description as string) ?? undefined,
    postgresColumn: (row.postgres_column as string) ?? undefined,
    options: parseSelectOptions(row.options),
    validationRules: validationRules ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
    hidden: row.hidden === true,
    readOnly: row.read_only === true,
  };
}

function parseRelationship(row: Record<string, unknown>): Relationship | null {
  const sourceConceptKey = row.source_concept_key as string | undefined;
  const targetConceptKey = row.target_concept_key as string | undefined;
  const key = row.key as string | undefined;
  if (!sourceConceptKey || !targetConceptKey || !key) {
    logger.warn("Skipping relationship row with missing fields", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    sourceConceptKey,
    targetConceptKey,
    key,
    label: (row.label as string) ?? key,
    cardinality: (row.cardinality as Relationship["cardinality"]) ?? "has-many",
    inverseKey: (row.inverse_key as string) ?? undefined,
    description: (row.description as string) ?? undefined,
  };
}

function parseDomainEventDef(row: Record<string, unknown>): DomainEventDef | null {
  const conceptKey = row.concept_key as string | undefined;
  const eventKey = row.event_key as string | undefined;
  if (!conceptKey || !eventKey) {
    logger.warn("Skipping event def row with missing fields", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    conceptKey,
    eventKey,
    fullEventName: (row.full_event_name as string) ?? `${conceptKey}.${eventKey}`,
    triggerType: (row.trigger_type as DomainEventDef["triggerType"]) ?? "on_create",
    description: (row.description as string) ?? undefined,
    changedFields: (row.changed_fields as string[]) ?? undefined,
    schedule: (row.schedule as string) ?? undefined,
  };
}

function parseConstraint(row: Record<string, unknown>): Constraint | null {
  const conceptKey = row.concept_key as string | undefined;
  const name = row.name as string | undefined;
  if (!conceptKey || !name) {
    logger.warn("Skipping constraint row with missing fields", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    conceptKey,
    name,
    extends: (row.extends as string) ?? undefined,
    condition: parseConditionExpression(row.condition),
    defaults: (row.defaults as Record<string, unknown>) ?? undefined,
    requiredFields: (row.required_fields as string[]) ?? undefined,
    description: (row.description as string) ?? undefined,
  };
}

function parseFormConfig(row: Record<string, unknown>): FormConfig {
  return {
    id: row.id as string,
    conceptKey: row.concept_key as string,
    name: (row.name as string) ?? "default",
    fields: (row.fields as FormFieldConfig[]) ?? [],
    layout: (row.layout as FormConfig["layout"]) ?? "single",
    steps: (row.steps as FormStep[]) ?? undefined,
  };
}

function parseViewConfig(row: Record<string, unknown>): ViewConfig {
  return {
    id: row.id as string,
    conceptKey: row.concept_key as string,
    name: (row.name as string) ?? "default",
    viewType: (row.view_type as ViewConfig["viewType"]) ?? "table",
    columns: (row.columns as ViewColumn[]) ?? undefined,
    filters: (row.filters as ViewFilter[]) ?? undefined,
    sort: (row.sort as ViewSort) ?? undefined,
    groupBy: (row.group_by as string) ?? undefined,
    timelineStart: (row.timeline_start as string) ?? undefined,
    timelineEnd: (row.timeline_end as string) ?? undefined,
    rowAction: (row.row_action as ViewConfig["rowAction"]) ?? undefined,
    presets: (row.presets as ViewPreset[]) ?? undefined,
    tabs: (row.tabs as ViewConfig["tabs"]) ?? undefined,
  };
}

function parsePageConfig(row: Record<string, unknown>): PageConfig {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "Unnamed Page",
    slug: (row.slug as string) ?? "/unknown",
    widgets: (row.widgets as WidgetConfig[]) ?? [],
    breakpoints: (row.breakpoints as PageConfig["breakpoints"]) ?? undefined,
  };
}

// --- Parsing utility helpers ---

function parseSelectOptions(val: unknown): ReadonlyArray<SelectOption> | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) {
    return val.map((v) =>
      typeof v === "string" ? { value: v, label: v } : (v as SelectOption)
    );
  }
  return undefined;
}

function parseConditionExpression(val: unknown): ConditionExpression {
  if (typeof val === "object" && val !== null) {
    return val as ConditionExpression;
  }
  if (typeof val === "string" && val.length > 0) {
    try {
      return JSON.parse(val) as ConditionExpression;
    } catch {
      return { type: "field", field: val, operator: "is_not_empty" };
    }
  }
  return { type: "field", field: "_id", operator: "is_not_empty" };
}
