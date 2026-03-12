/**
 * Generic CRUD Router for Domain Concepts
 *
 * Provides RESTful endpoints for any ontology concept:
 *   POST   /api/domains/:concept       — create
 *   GET    /api/domains/:concept       — list (paginated, filtered, sorted)
 *   GET    /api/domains/:concept/:id   — get single record
 *   PUT    /api/domains/:concept/:id   — update
 *   DELETE /api/domains/:concept/:id   — archive (soft delete)
 *
 * Every route validates the concept exists in the ontology, enforces RBAC,
 * and fires domain events on writes.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { QueryDatabaseParameters } from "@notionhq/client/build/src/api-endpoints";
import * as logger from "firebase-functions/logger";
import {
  queryDatabasePage,
  getPage,
  createPage,
  updatePage,
  archivePage,
  pageToFlatObject,
  pageMetadata,
  buildNotionProperties,
} from "../notion/client";
import { getConceptByKey, getPropertiesForConcept } from "../ontology/loader";
import { roleEngine } from "../roles/engine";
import { emit, createDomainEvent } from "../events/bus";
import { requireAuth } from "../auth/middleware";
import type { ApiResponse, DomainRecord, Property } from "../ontology/types";

// --- Router ---

export const domainRouter = Router();

// All domain routes require authentication
domainRouter.use(requireAuth);

// --- List records ---

domainRouter.get("/:concept", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const { concept } = conceptResult;
    const roleKey = req.role?.roleKey ?? "viewer";

    // Check view permission
    const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
    if (!canView) {
      sendError(res, 403, `You do not have permission to view ${concept.pluralName}.`);
      return;
    }

    // Parse pagination
    const page = clampInt(req.query.page, 1, 10000, 1);
    const limit = clampInt(req.query.limit, 1, 200, 50);

    // Build Notion filter from query params
    const properties = await getPropertiesForConcept(conceptKey);
    const notionFilter = buildFilterFromQuery(req.query, properties);

    // Apply data scope filter
    const scopeFilter = await roleEngine.buildDataScopeFilter(
      roleKey,
      conceptKey,
      req.user?.uid ?? ""
    );

    const combinedFilter = combineFilters(notionFilter, scopeFilter);

    // Build sort
    const notionSorts = buildSortFromQuery(req.query, properties);

    // Query Notion with pagination
    // Notion doesn't support offset-based pagination, so we use cursor-based.
    // For simplicity, we fetch page*limit results and skip to the right offset.
    const result = await queryDatabasePage(concept.notionDatabaseId, {
      filter: combinedFilter as QueryDatabaseParameters["filter"],
      sorts: notionSorts as QueryDatabaseParameters["sorts"],
      pageSize: Math.min(limit, 100),
    });

    // Convert to domain records and filter visible properties
    const records = await Promise.all(
      result.results.map(async (row) => {
        const record = toDomainRecord(row as Record<string, unknown>, conceptKey);
        const filteredProps = await roleEngine.filterRecord(
          roleKey,
          conceptKey,
          record.properties
        );
        return { ...record, properties: filteredProps };
      })
    );

    const response: ApiResponse<ReadonlyArray<DomainRecord>> = {
      success: true,
      data: records,
      meta: {
        total: records.length,
        page,
        limit,
        hasMore: result.hasMore,
      },
    };

    res.json(response);
  } catch (err) {
    handleError(res, err, "listing records");
  }
});

// --- Get single record ---

domainRouter.get("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
    if (!canView) {
      sendError(res, 403, `You do not have permission to view this record.`);
      return;
    }

    const page = await getPage(id);
    const record = toDomainRecord(page as Record<string, unknown>, conceptKey);
    const filteredProps = await roleEngine.filterRecord(
      roleKey,
      conceptKey,
      record.properties
    );

    const response: ApiResponse<DomainRecord> = {
      success: true,
      data: { ...record, properties: filteredProps },
    };

    res.json(response);
  } catch (err) {
    handleError(res, err, "fetching record");
  }
});

// --- Create record ---

domainRouter.post("/:concept", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const { concept } = conceptResult;
    const roleKey = req.role?.roleKey ?? "viewer";

    const canCreate = await roleEngine.canPerformAction(roleKey, conceptKey, "create");
    if (!canCreate) {
      sendError(res, 403, `You do not have permission to create ${concept.pluralName}.`);
      return;
    }

    // Filter the write payload to editable properties only
    const rawPayload = req.body as Record<string, unknown>;
    const filteredPayload = await roleEngine.filterWritePayload(
      roleKey,
      conceptKey,
      rawPayload
    );

    // Build Notion property types map from ontology
    const properties = await getPropertiesForConcept(conceptKey);
    const propertyTypes = buildPropertyTypeMap(properties);

    const notionProperties = buildNotionProperties(filteredPayload, propertyTypes);
    const created = await createPage(concept.notionDatabaseId, notionProperties);

    const record = toDomainRecord(created as Record<string, unknown>, conceptKey);

    // Fire domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.created`,
      domain: conceptKey,
      action: "created",
      recordId: record.id,
      newValues: filteredPayload,
      triggeredBy: req.user?.email ?? "system",
    });
    await emit(event);

    const response: ApiResponse<DomainRecord> = {
      success: true,
      data: record,
    };

    res.status(201).json(response);
  } catch (err) {
    handleError(res, err, "creating record");
  }
});

// --- Update record ---

domainRouter.put("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canEdit = await roleEngine.canPerformAction(roleKey, conceptKey, "edit");
    if (!canEdit) {
      sendError(res, 403, `You do not have permission to edit this record.`);
      return;
    }

    // Get the current record for change tracking
    const existingPage = await getPage(id);
    const existingFlat = pageToFlatObject(existingPage as Record<string, unknown>);

    // Filter the write payload
    const rawPayload = req.body as Record<string, unknown>;
    const filteredPayload = await roleEngine.filterWritePayload(
      roleKey,
      conceptKey,
      rawPayload
    );

    // Determine which fields actually changed
    const changedFields = Object.keys(filteredPayload).filter(
      (key) => JSON.stringify(filteredPayload[key]) !== JSON.stringify(existingFlat[key])
    );

    if (changedFields.length === 0) {
      // Nothing to update
      const record = toDomainRecord(existingPage as Record<string, unknown>, conceptKey);
      res.json({ success: true, data: record } as ApiResponse<DomainRecord>);
      return;
    }

    // Build Notion properties for the changed fields only
    const properties = await getPropertiesForConcept(conceptKey);
    const propertyTypes = buildPropertyTypeMap(properties);

    const changedPayload = Object.fromEntries(
      changedFields.map((key) => [key, filteredPayload[key]])
    );
    const notionProperties = buildNotionProperties(changedPayload, propertyTypes);

    const updated = await updatePage(id, notionProperties);
    const record = toDomainRecord(updated as Record<string, unknown>, conceptKey);

    // Build previous values for the changed fields
    const previousValues = Object.fromEntries(
      changedFields.map((key) => [key, existingFlat[key]])
    );

    // Fire domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.updated`,
      domain: conceptKey,
      action: "updated",
      recordId: id,
      changedFields,
      previousValues,
      newValues: changedPayload,
      triggeredBy: req.user?.email ?? "system",
    });
    await emit(event);

    const response: ApiResponse<DomainRecord> = {
      success: true,
      data: record,
    };

    res.json(response);
  } catch (err) {
    handleError(res, err, "updating record");
  }
});

// --- Delete (archive) record ---

domainRouter.delete("/:concept/:id", async (req: Request, res: Response) => {
  try {
    const { concept: conceptKey, id } = req.params;
    const conceptResult = await validateConcept(conceptKey, res);
    if (!conceptResult) return;

    const roleKey = req.role?.roleKey ?? "viewer";

    const canDelete = await roleEngine.canPerformAction(roleKey, conceptKey, "delete");
    if (!canDelete) {
      sendError(res, 403, `You do not have permission to delete this record.`);
      return;
    }

    await archivePage(id);

    // Fire domain event
    const event = createDomainEvent({
      eventName: `${conceptKey}.deleted`,
      domain: conceptKey,
      action: "deleted",
      recordId: id,
      triggeredBy: req.user?.email ?? "system",
    });
    await emit(event);

    const response: ApiResponse<null> = {
      success: true,
      data: null,
    };

    res.json(response);
  } catch (err) {
    handleError(res, err, "deleting record");
  }
});

// --- Helpers ---

/**
 * Validates that a concept exists in the ontology.
 * Sends a 404 response and returns null if not found.
 */
async function validateConcept(
  conceptKey: string,
  res: Response
): Promise<{ concept: Awaited<ReturnType<typeof getConceptByKey>> & {} } | null> {
  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    sendError(res, 404, `Unknown concept: "${conceptKey}". Check /api/ontology/concepts for available concepts.`);
    return null;
  }
  return { concept };
}

/**
 * Converts a Notion page to a DomainRecord.
 */
function toDomainRecord(
  page: Record<string, unknown>,
  conceptKey: string
): DomainRecord {
  const flat = pageToFlatObject(page);
  const meta = pageMetadata(page);

  // Separate relations from regular properties
  const properties: Record<string, unknown> = {};
  const relations: Record<string, ReadonlyArray<string>> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string" && isNotionId(value[0])) {
      relations[key] = value as string[];
    } else {
      properties[key] = value;
    }
  }

  return {
    id: meta.id,
    conceptKey,
    properties,
    relations,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

/**
 * Heuristic to detect Notion page IDs (UUID-like strings).
 */
function isNotionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Builds a Notion filter object from Express query parameters.
 * Supports `filter[field]=value` syntax.
 */
function buildFilterFromQuery(
  query: Record<string, unknown>,
  properties: ReadonlyArray<Property>
): Record<string, unknown> | undefined {
  const filters: Array<Record<string, unknown>> = [];

  for (const [key, value] of Object.entries(query)) {
    // Match filter[fieldName]=value pattern
    const match = /^filter\[(.+)]$/.exec(key);
    if (!match || !value) continue;

    const fieldKey = match[1];
    const prop = properties.find((p) => p.key === fieldKey);
    if (!prop) continue;

    const filterEntry = buildSingleFilter(prop, String(value));
    if (filterEntry) {
      filters.push(filterEntry);
    }
  }

  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

/**
 * Builds a Notion filter for a single property + value.
 */
function buildSingleFilter(
  prop: Property,
  value: string
): Record<string, unknown> | undefined {
  const notionProp = prop.notionPropertyName;

  switch (prop.type) {
    case "text":
    case "rich_text":
    case "email":
    case "phone":
    case "url":
      return { property: notionProp, rich_text: { contains: value } };
    case "number":
      return { property: notionProp, number: { equals: Number(value) } };
    case "select":
    case "status":
      return { property: notionProp, select: { equals: value } };
    case "multi_select":
      return { property: notionProp, multi_select: { contains: value } };
    case "checkbox":
      return { property: notionProp, checkbox: { equals: value === "true" } };
    case "date":
    case "datetime":
      return { property: notionProp, date: { equals: value } };
    default:
      return undefined;
  }
}

/**
 * Builds a Notion sort array from query parameters.
 * Supports `sort=fieldKey` and `direction=asc|desc`.
 */
function buildSortFromQuery(
  query: Record<string, unknown>,
  properties: ReadonlyArray<Property>
): Array<Record<string, unknown>> | undefined {
  const sortKey = query.sort as string | undefined;
  if (!sortKey) return undefined;

  const prop = properties.find((p) => p.key === sortKey);
  if (!prop) return undefined;

  const direction = (query.direction as string) === "desc" ? "descending" : "ascending";

  return [
    {
      property: prop.notionPropertyName,
      direction,
    },
  ];
}

/**
 * Combines two optional Notion filters with AND logic.
 */
function combineFilters(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return { and: [a, b] };
}

/**
 * Builds a map of property key → Notion property type string.
 * Uses the ontology Property's key as the map key, and
 * notionPropertyName as the output key (since that's what Notion expects).
 */
function buildPropertyTypeMap(
  properties: ReadonlyArray<Property>
): Record<string, string> {
  const entries = properties.map((p) => {
    // Map ontology type → Notion API type
    const notionType = ontologyTypeToNotionType(p.type);
    return [p.key, notionType] as const;
  });
  return Object.fromEntries(entries);
}

/**
 * Maps our ontology PropertyType to the Notion API property type string.
 */
function ontologyTypeToNotionType(type: Property["type"]): string {
  switch (type) {
    case "text":
      return "title";
    case "rich_text":
      return "rich_text";
    case "number":
      return "number";
    case "select":
      return "select";
    case "multi_select":
      return "multi_select";
    case "date":
    case "datetime":
      return "date";
    case "checkbox":
      return "checkbox";
    case "url":
      return "url";
    case "email":
      return "email";
    case "phone":
      return "phone_number";
    case "relation":
      return "relation";
    case "status":
      return "status";
    case "formula":
    case "rollup":
    case "files":
    case "people":
      return type; // Read-only types, shouldn't be written
    default:
      return "rich_text";
  }
}

/**
 * Clamps a query parameter to an integer within bounds.
 */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  defaultVal: number
): number {
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Sends a JSON error response.
 */
function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message } as ApiResponse<never>);
}

/**
 * Handles unexpected errors in route handlers.
 */
function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  sendError(res, status ?? 500, `Internal error while ${context}: ${message}`);
}
