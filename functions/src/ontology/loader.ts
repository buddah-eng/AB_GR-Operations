/**
 * Ontology Loader
 *
 * Reads the five ontology databases from Notion (concepts, properties,
 * relationships, events, constraints) and assembles a typed OntologyCache.
 * Results are cached in memory with a 5-minute TTL via MemoryCache.
 */

import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS } from "../notion/cache";
import { queryDatabase, pageToFlatObject, pageMetadata } from "../notion/client";
import { getOntologyDatabaseId } from "../notion/databases";
import type {
  Concept,
  Property,
  Relationship,
  DomainEventDef,
  Constraint,
  OntologyCache,
  SelectOption,
  ConditionExpression,
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

// --- Cache key ---

const ONTOLOGY_CACHE_KEY = "ontology";
const FORMS_CACHE_PREFIX = "form:";
const VIEWS_CACHE_PREFIX = "views:";
const PAGES_CACHE_KEY = "pages";

// --- Ontology loading ---

/**
 * Loads the full ontology from Notion and builds a typed OntologyCache.
 */
export async function loadOntology(): Promise<OntologyCache> {
  logger.info("Loading ontology from Notion...");
  const startMs = Date.now();

  const [
    conceptRows,
    propertyRows,
    relationshipRows,
    eventRows,
    constraintRows,
  ] = await Promise.all([
    queryDatabase(getOntologyDatabaseId("concepts")),
    queryDatabase(getOntologyDatabaseId("properties")),
    queryDatabase(getOntologyDatabaseId("relationships")),
    queryDatabase(getOntologyDatabaseId("events")),
    queryDatabase(getOntologyDatabaseId("constraints")),
  ]);

  // --- Build concept map ---
  const concepts = new Map<string, Concept>();
  for (const row of conceptRows) {
    const flat = pageToFlatObject(row as Record<string, unknown>);
    const meta = pageMetadata(row as Record<string, unknown>);
    const concept = parseConcept(meta.id, flat);
    if (concept) {
      concepts.set(concept.key, concept);
    }
  }

  // --- Build properties map (conceptKey → Property[]) ---
  const properties = new Map<string, ReadonlyArray<Property>>();
  const propsByConceptKey = new Map<string, Property[]>();
  for (const row of propertyRows) {
    const flat = pageToFlatObject(row as Record<string, unknown>);
    const meta = pageMetadata(row as Record<string, unknown>);
    const prop = parseProperty(meta.id, flat);
    if (prop) {
      const existing = propsByConceptKey.get(prop.conceptKey) ?? [];
      propsByConceptKey.set(prop.conceptKey, [...existing, prop]);
    }
  }
  for (const [key, props] of propsByConceptKey.entries()) {
    properties.set(key, props.sort((a, b) => a.sortOrder - b.sortOrder));
  }

  // --- Build relationships map ---
  const relationships = new Map<string, ReadonlyArray<Relationship>>();
  const relsByConceptKey = new Map<string, Relationship[]>();
  for (const row of relationshipRows) {
    const flat = pageToFlatObject(row as Record<string, unknown>);
    const meta = pageMetadata(row as Record<string, unknown>);
    const rel = parseRelationship(meta.id, flat);
    if (rel) {
      const existing = relsByConceptKey.get(rel.sourceConceptKey) ?? [];
      relsByConceptKey.set(rel.sourceConceptKey, [...existing, rel]);
    }
  }
  for (const [key, rels] of relsByConceptKey.entries()) {
    relationships.set(key, rels);
  }

  // --- Build events map ---
  const events = new Map<string, ReadonlyArray<DomainEventDef>>();
  const eventsByConceptKey = new Map<string, DomainEventDef[]>();
  for (const row of eventRows) {
    const flat = pageToFlatObject(row as Record<string, unknown>);
    const meta = pageMetadata(row as Record<string, unknown>);
    const evt = parseDomainEventDef(meta.id, flat);
    if (evt) {
      const existing = eventsByConceptKey.get(evt.conceptKey) ?? [];
      eventsByConceptKey.set(evt.conceptKey, [...existing, evt]);
    }
  }
  for (const [key, evts] of eventsByConceptKey.entries()) {
    events.set(key, evts);
  }

  // --- Build constraints map ---
  const constraints = new Map<string, ReadonlyArray<Constraint>>();
  const constraintsByConceptKey = new Map<string, Constraint[]>();
  for (const row of constraintRows) {
    const flat = pageToFlatObject(row as Record<string, unknown>);
    const meta = pageMetadata(row as Record<string, unknown>);
    const constraint = parseConstraint(meta.id, flat);
    if (constraint) {
      const existing = constraintsByConceptKey.get(constraint.conceptKey) ?? [];
      constraintsByConceptKey.set(constraint.conceptKey, [...existing, constraint]);
    }
  }
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
    `${propertyRows.length} properties, ` +
    `${relationshipRows.length} relationships, ` +
    `${eventRows.length} events, ` +
    `${constraintRows.length} constraints in ${elapsedMs}ms`
  );

  return ontologyCache;
}

// --- Public API ---

/**
 * Returns the cached ontology, loading from Notion if necessary.
 */
export async function getOntology(): Promise<OntologyCache> {
  return cache.getOrLoad(ONTOLOGY_CACHE_KEY, loadOntology, TTL_ONTOLOGY_MS);
}

/**
 * Forces a full reload of the ontology from Notion.
 */
export async function reloadOntology(): Promise<OntologyCache> {
  cache.invalidate(ONTOLOGY_CACHE_KEY);
  const freshOntology = await loadOntology();
  cache.set(ONTOLOGY_CACHE_KEY, freshOntology, TTL_ONTOLOGY_MS);
  return freshOntology;
}

/**
 * Returns a single concept by key, or undefined if not found.
 */
export async function getConceptByKey(key: string): Promise<Concept | undefined> {
  const ontology = await getOntology();
  return ontology.concepts.get(key);
}

/**
 * Returns all properties defined for a concept.
 */
export async function getPropertiesForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Property>> {
  const ontology = await getOntology();
  return ontology.properties.get(conceptKey) ?? [];
}

/**
 * Returns all relationships where the given concept is the source.
 */
export async function getRelationshipsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Relationship>> {
  const ontology = await getOntology();
  return ontology.relationships.get(conceptKey) ?? [];
}

/**
 * Returns all event definitions for a concept.
 */
export async function getEventsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<DomainEventDef>> {
  const ontology = await getOntology();
  return ontology.events.get(conceptKey) ?? [];
}

/**
 * Returns all constraints for a concept.
 */
export async function getConstraintsForConcept(
  conceptKey: string
): Promise<ReadonlyArray<Constraint>> {
  const ontology = await getOntology();
  return ontology.constraints.get(conceptKey) ?? [];
}

// --- Form config loader ---

/**
 * Loads the form config for a concept from the Notion Forms database.
 */
export async function getFormConfig(conceptKey: string): Promise<FormConfig | undefined> {
  const cacheKey = `${FORMS_CACHE_PREFIX}${conceptKey}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const dbId = getOntologyDatabaseId("forms");
        const rows = await queryDatabase(dbId, {
          filter: {
            property: "Concept Key",
            rich_text: { equals: conceptKey },
          },
        });
        if (rows.length === 0) return undefined;
        const flat = pageToFlatObject(rows[0] as Record<string, unknown>);
        const meta = pageMetadata(rows[0] as Record<string, unknown>);
        return parseFormConfig(meta.id, flat, conceptKey);
      } catch {
        logger.warn(`No form config found for concept: ${conceptKey}`);
        return undefined;
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- View config loader ---

/**
 * Loads all view configs for a concept from the Notion Views database.
 */
export async function getViewConfigs(
  conceptKey: string
): Promise<ReadonlyArray<ViewConfig>> {
  const cacheKey = `${VIEWS_CACHE_PREFIX}${conceptKey}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const dbId = getOntologyDatabaseId("views");
        const rows = await queryDatabase(dbId, {
          filter: {
            property: "Concept Key",
            rich_text: { equals: conceptKey },
          },
        });
        return rows.map((row) => {
          const flat = pageToFlatObject(row as Record<string, unknown>);
          const meta = pageMetadata(row as Record<string, unknown>);
          return parseViewConfig(meta.id, flat, conceptKey);
        });
      } catch {
        logger.warn(`No view configs found for concept: ${conceptKey}`);
        return [];
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- Page config loader ---

/**
 * Loads all page configs from the Notion Pages database.
 */
export async function getPageConfigs(): Promise<ReadonlyArray<PageConfig>> {
  return cache.getOrLoad(
    PAGES_CACHE_KEY,
    async () => {
      try {
        const dbId = getOntologyDatabaseId("pages");
        const rows = await queryDatabase(dbId);
        return rows.map((row) => {
          const flat = pageToFlatObject(row as Record<string, unknown>);
          const meta = pageMetadata(row as Record<string, unknown>);
          return parsePageConfig(meta.id, flat);
        });
      } catch {
        logger.warn("No page configs found");
        return [];
      }
    },
    TTL_ONTOLOGY_MS
  );
}

// --- Parsers: Notion flat object → typed ontology object ---

function parseConcept(id: string, flat: Readonly<Record<string, unknown>>): Concept | null {
  const key = asString(flat["Key"]);
  const name = asString(flat["Name"]);
  if (!key || !name) {
    logger.warn("Skipping concept row with missing Key or Name", { id });
    return null;
  }

  return {
    id,
    key,
    name,
    pluralName: asString(flat["Plural Name"]) ?? `${name}s`,
    extends: asString(flat["Extends"]) ?? undefined,
    notionDatabaseId: asString(flat["Database ID"]) ?? "",
    icon: asString(flat["Icon"]) ?? undefined,
    description: asString(flat["Description"]) ?? undefined,
    isRegistry: asBool(flat["Is Registry"]),
    isConfig: asBool(flat["Is Config"]),
  };
}

function parseProperty(id: string, flat: Readonly<Record<string, unknown>>): Property | null {
  const conceptKey = asString(flat["Concept Key"]);
  const key = asString(flat["Key"]);
  if (!conceptKey || !key) {
    logger.warn("Skipping property row with missing Concept Key or Key", { id });
    return null;
  }

  return {
    id,
    conceptKey,
    key,
    label: asString(flat["Label"]) ?? key,
    type: (asString(flat["Type"]) ?? "text") as Property["type"],
    required: asBool(flat["Required"]),
    defaultValue: flat["Default Value"] ?? undefined,
    placeholder: asString(flat["Placeholder"]) ?? undefined,
    description: asString(flat["Description"]) ?? undefined,
    notionPropertyName: asString(flat["Notion Property Name"]) ?? key,
    options: parseSelectOptions(flat["Options"]),
    minLength: asNumber(flat["Min Length"]) ?? undefined,
    maxLength: asNumber(flat["Max Length"]) ?? undefined,
    min: asNumber(flat["Min"]) ?? undefined,
    max: asNumber(flat["Max"]) ?? undefined,
    pattern: asString(flat["Pattern"]) ?? undefined,
    sortOrder: asNumber(flat["Sort Order"]) ?? 0,
    hidden: asBool(flat["Hidden"]),
    readOnly: asBool(flat["Read Only"]),
  };
}

function parseRelationship(
  id: string,
  flat: Readonly<Record<string, unknown>>
): Relationship | null {
  const sourceConceptKey = asString(flat["Source Concept Key"]);
  const targetConceptKey = asString(flat["Target Concept Key"]);
  const key = asString(flat["Key"]);
  if (!sourceConceptKey || !targetConceptKey || !key) {
    logger.warn("Skipping relationship row with missing fields", { id });
    return null;
  }

  return {
    id,
    sourceConceptKey,
    targetConceptKey,
    key,
    label: asString(flat["Label"]) ?? key,
    cardinality: (asString(flat["Cardinality"]) ?? "has-many") as Relationship["cardinality"],
    notionRelationName: asString(flat["Notion Relation Name"]) ?? key,
    inverseKey: asString(flat["Inverse Key"]) ?? undefined,
    description: asString(flat["Description"]) ?? undefined,
  };
}

function parseDomainEventDef(
  id: string,
  flat: Readonly<Record<string, unknown>>
): DomainEventDef | null {
  const conceptKey = asString(flat["Concept Key"]);
  const eventKey = asString(flat["Event Key"]);
  if (!conceptKey || !eventKey) {
    logger.warn("Skipping event def row with missing fields", { id });
    return null;
  }

  return {
    id,
    conceptKey,
    eventKey,
    fullEventName: asString(flat["Full Event Name"]) ?? `${conceptKey}.${eventKey}`,
    triggerType: (asString(flat["Trigger Type"]) ?? "on_create") as DomainEventDef["triggerType"],
    description: asString(flat["Description"]) ?? undefined,
    changedFields: asStringArray(flat["Changed Fields"]) ?? undefined,
    schedule: asString(flat["Schedule"]) ?? undefined,
  };
}

function parseConstraint(
  id: string,
  flat: Readonly<Record<string, unknown>>
): Constraint | null {
  const conceptKey = asString(flat["Concept Key"]);
  const name = asString(flat["Name"]);
  if (!conceptKey || !name) {
    logger.warn("Skipping constraint row with missing fields", { id });
    return null;
  }

  return {
    id,
    conceptKey,
    name,
    extends: asString(flat["Extends"]) ?? undefined,
    condition: parseConditionExpression(flat["Condition"]),
    defaults: parseJsonField(flat["Defaults"]) as Record<string, unknown> | undefined,
    requiredFields: asStringArray(flat["Required Fields"]) ?? undefined,
    description: asString(flat["Description"]) ?? undefined,
  };
}

function parseFormConfig(
  id: string,
  flat: Readonly<Record<string, unknown>>,
  conceptKey: string
): FormConfig {
  const fieldsJson = parseJsonField(flat["Fields"]) as FormFieldConfig[] | undefined;
  const stepsJson = parseJsonField(flat["Steps"]) as FormStep[] | undefined;

  return {
    id,
    conceptKey,
    name: asString(flat["Name"]) ?? `${conceptKey} form`,
    fields: fieldsJson ?? [],
    layout: (asString(flat["Layout"]) as FormConfig["layout"]) ?? "single",
    steps: stepsJson ?? undefined,
  };
}

function parseViewConfig(
  id: string,
  flat: Readonly<Record<string, unknown>>,
  conceptKey: string
): ViewConfig {
  const columnsJson = parseJsonField(flat["Columns"]) as ViewColumn[] | undefined;
  const filtersJson = parseJsonField(flat["Filters"]) as ViewFilter[] | undefined;
  const sortJson = parseJsonField(flat["Sort"]) as ViewSort | undefined;
  const presetsJson = parseJsonField(flat["Presets"]) as ViewPreset[] | undefined;

  return {
    id,
    conceptKey,
    name: asString(flat["Name"]) ?? `${conceptKey} view`,
    viewType: (asString(flat["View Type"]) as ViewConfig["viewType"]) ?? "table",
    columns: columnsJson ?? undefined,
    filters: filtersJson ?? undefined,
    sort: sortJson ?? undefined,
    groupBy: asString(flat["Group By"]) ?? undefined,
    timelineStart: asString(flat["Timeline Start"]) ?? undefined,
    timelineEnd: asString(flat["Timeline End"]) ?? undefined,
    rowAction: (asString(flat["Row Action"]) as ViewConfig["rowAction"]) ?? undefined,
    presets: presetsJson ?? undefined,
  };
}

function parsePageConfig(
  id: string,
  flat: Readonly<Record<string, unknown>>
): PageConfig {
  const widgetsJson = parseJsonField(flat["Widgets"]) as WidgetConfig[] | undefined;
  const breakpointsJson = parseJsonField(flat["Breakpoints"]) as PageConfig["breakpoints"] | undefined;

  return {
    id,
    name: asString(flat["Name"]) ?? "Unnamed Page",
    slug: asString(flat["Slug"]) ?? "/unknown",
    widgets: widgetsJson ?? [],
    breakpoints: breakpointsJson ?? undefined,
  };
}

// --- Parsing utility helpers ---

function asString(val: unknown): string | null {
  if (typeof val === "string" && val.length > 0) return val;
  return null;
}

function asNumber(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  return null;
}

function asBool(val: unknown): boolean {
  return val === true;
}

function asStringArray(val: unknown): ReadonlyArray<string> | null {
  if (Array.isArray(val)) {
    return val.filter((v): v is string => typeof v === "string");
  }
  // Support comma-separated string
  if (typeof val === "string" && val.length > 0) {
    return val.split(",").map((s) => s.trim());
  }
  return null;
}

function parseSelectOptions(val: unknown): ReadonlyArray<SelectOption> | undefined {
  if (!val) return undefined;
  // Options might be stored as JSON string or as a multi_select array
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as SelectOption[];
    } catch {
      return val.split(",").map((v) => ({ value: v.trim(), label: v.trim() }));
    }
  }
  if (Array.isArray(val)) {
    return val.map((v) =>
      typeof v === "string" ? { value: v, label: v } : (v as SelectOption)
    );
  }
  return undefined;
}

function parseConditionExpression(val: unknown): ConditionExpression {
  if (typeof val === "string" && val.length > 0) {
    try {
      return JSON.parse(val) as ConditionExpression;
    } catch {
      // Fallback: treat as a simple "is not empty" condition
      return { type: "field", field: val, operator: "is_not_empty" };
    }
  }
  if (typeof val === "object" && val !== null) {
    return val as ConditionExpression;
  }
  // Default condition that always matches
  return { type: "field", field: "_id", operator: "is_not_empty" };
}

function parseJsonField(val: unknown): unknown | undefined {
  if (typeof val === "string" && val.length > 0) {
    try {
      return JSON.parse(val);
    } catch {
      return undefined;
    }
  }
  if (typeof val === "object" && val !== null) {
    return val;
  }
  return undefined;
}
