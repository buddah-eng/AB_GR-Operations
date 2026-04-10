/**
 * Data Routing Service
 *
 * Subscribes to the domain event bus at priority 600 (after workflows at 500,
 * before webhooks at 900). When a domain event fires, matching routes extract
 * source fields, apply transform chains, filter PII per mode, and write
 * projection records to the destination concept table.
 *
 * CRUD operations for data_routes and data_transforms tables.
 */

import * as logger from "firebase-functions/logger";
import { subscribe, matchesPattern } from "../events/bus";
import { query } from "../db/client";
import { isPiiField, computeHmac, isHmacConfigured } from "../encryption/crypto";
import { executeTransformChain, validateTransformChain } from "./transforms";
import type { TransformStep } from "./transforms";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface DataRoute {
  readonly id: string;
  readonly name: string;
  readonly source_concept: string;
  readonly dest_concept: string;
  readonly field_mappings: ReadonlyArray<FieldMapping>;
  readonly transform_id: string | null;
  readonly pii_mode: "strip" | "pass" | "hash";
  readonly trigger_event: string;
  readonly execution_mode: "sync" | "async";
  readonly owner_scope: string;
  readonly owner_department: string | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FieldMapping {
  readonly source: string;
  readonly dest: string;
}

export interface DataTransform {
  readonly id: string;
  readonly name: string;
  readonly transform_chain: ReadonlyArray<TransformStep>;
  readonly reusable: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RouteFilters {
  readonly source_concept?: string;
  readonly dest_concept?: string;
  readonly trigger_event?: string;
  readonly active?: boolean;
}

// --- Registration ---

/**
 * Registers the data routing handler on the event bus at priority 600.
 * Call once during app startup.
 *
 * @returns An unsubscribe function.
 */
export function registerDataRouting(): () => void {
  return subscribe("*", handleDomainEvent, 600);
}

// --- Event handler ---

/**
 * Loads active routes matching the event pattern, then executes each.
 */
export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  let routes: ReadonlyArray<DataRoute>;

  try {
    routes = await loadActiveRoutesByEvent(event.eventName);
  } catch (err) {
    logger.error("Failed to load data routes", { error: err });
    return;
  }

  if (routes.length === 0) return;

  logger.info(`Data routing: ${routes.length} route(s) match "${event.eventName}"`);

  for (const route of routes) {
    try {
      await executeRoute(route, event);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Data route "${route.name}" failed`, { error: message, routeId: route.id });
    }
  }
}

// --- Route execution ---

/**
 * Executes a single route: extract source fields, apply transforms,
 * filter PII, and write to destination concept.
 */
export async function executeRoute(
  route: DataRoute,
  event: DomainEvent
): Promise<Record<string, unknown>> {
  // 1. Build source record from event data
  const sourceRecord = buildSourceRecord(event);

  // 2. Apply field mappings
  const mapped = applyFieldMappings(sourceRecord, route.field_mappings);

  // 3. Load and apply transform chain if transform_id is set
  let transformed = mapped;
  if (route.transform_id) {
    const transform = await getTransformById(route.transform_id);
    if (transform) {
      const result = executeTransformChain(transform.transform_chain, transformed);
      transformed = result.record as Record<string, unknown>;
    }
  }

  // 4. Apply PII filtering
  const filtered = applyPiiMode(transformed, route.pii_mode);

  // 5. Write projection record to destination
  const projection = {
    ...filtered,
    _source_concept: route.source_concept,
    _source_record_id: event.recordId,
    _route_id: route.id,
    _projected_at: new Date().toISOString(),
  };

  await writeProjection(route.dest_concept, projection);

  return projection;
}

// --- Helpers ---

function buildSourceRecord(event: DomainEvent): Record<string, unknown> {
  return {
    ...(event.newValues ?? {}),
    _record_id: event.recordId,
    _event_name: event.eventName,
    _triggered_by: event.triggeredBy,
  };
}

function applyFieldMappings(
  record: Readonly<Record<string, unknown>>,
  mappings: ReadonlyArray<FieldMapping>
): Record<string, unknown> {
  if (mappings.length === 0) return { ...record };

  const result: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (record[mapping.source] !== undefined) {
      result[mapping.dest] = record[mapping.source];
    }
  }
  return result;
}

function applyPiiMode(
  record: Readonly<Record<string, unknown>>,
  mode: "strip" | "pass" | "hash"
): Record<string, unknown> {
  switch (mode) {
    case "pass":
      return { ...record };

    case "strip": {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (!isPiiField(key)) {
          result[key] = value;
        }
      }
      return result;
    }

    case "hash": {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (isPiiField(key) && typeof value === "string" && value.length > 0) {
          result[key] = isHmacConfigured() ? computeHmac(value) : "[HASHED]";
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    default:
      return { ...record };
  }
}

async function writeProjection(
  destConcept: string,
  projection: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO data_projections (dest_concept, source_record_id, route_id, data, projected_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      destConcept,
      projection._source_record_id,
      projection._route_id,
      JSON.stringify(projection),
      projection._projected_at,
    ]
  );
}

// --- Active route loading ---

async function loadActiveRoutesByEvent(
  eventName: string
): Promise<ReadonlyArray<DataRoute>> {
  const result = await query<{
    id: string;
    name: string;
    source_concept: string;
    dest_concept: string;
    field_mappings: ReadonlyArray<FieldMapping>;
    transform_id: string | null;
    pii_mode: "strip" | "pass" | "hash";
    trigger_event: string;
    execution_mode: "sync" | "async";
    owner_scope: string;
    owner_department: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    "SELECT * FROM data_routes WHERE active = true"
  );

  return result.rows.filter((route) =>
    matchesPattern(route.trigger_event, eventName)
  );
}

// --- CRUD: data_routes ---

/**
 * Lists routes with optional filters.
 */
export async function listRoutes(
  filters?: RouteFilters
): Promise<ReadonlyArray<DataRoute>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.source_concept) {
    conditions.push(`source_concept = $${paramIdx++}`);
    params.push(filters.source_concept);
  }
  if (filters?.dest_concept) {
    conditions.push(`dest_concept = $${paramIdx++}`);
    params.push(filters.dest_concept);
  }
  if (filters?.trigger_event) {
    conditions.push(`trigger_event = $${paramIdx++}`);
    params.push(filters.trigger_event);
  }
  if (filters?.active !== undefined) {
    conditions.push(`active = $${paramIdx++}`);
    params.push(filters.active);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT * FROM data_routes ${whereClause} ORDER BY created_at DESC`,
    params
  );

  return result.rows as unknown as ReadonlyArray<DataRoute>;
}

/**
 * Gets a single route by ID.
 */
export async function getRouteById(id: string): Promise<DataRoute | null> {
  const result = await query(
    "SELECT * FROM data_routes WHERE id = $1",
    [id]
  );

  return (result.rows[0] as unknown as DataRoute) ?? null;
}

/**
 * Creates a new data route.
 */
export async function createRoute(
  data: Omit<DataRoute, "id" | "created_at" | "updated_at">
): Promise<DataRoute> {
  const result = await query(
    `INSERT INTO data_routes (name, source_concept, dest_concept, field_mappings, transform_id, pii_mode, trigger_event, execution_mode, owner_scope, owner_department, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.name,
      data.source_concept,
      data.dest_concept,
      JSON.stringify(data.field_mappings),
      data.transform_id,
      data.pii_mode,
      data.trigger_event,
      data.execution_mode,
      data.owner_scope,
      data.owner_department,
      data.active,
    ]
  );

  return result.rows[0] as unknown as DataRoute;
}

/**
 * Updates an existing route.
 */
export async function updateRoute(
  id: string,
  data: Partial<Omit<DataRoute, "id" | "created_at" | "updated_at">>
): Promise<DataRoute | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields: ReadonlyArray<keyof typeof data> = [
    "name", "source_concept", "dest_concept", "field_mappings",
    "transform_id", "pii_mode", "trigger_event", "execution_mode",
    "owner_scope", "owner_department", "active",
  ];

  for (const field of fields) {
    if (data[field] !== undefined) {
      const value = field === "field_mappings" ? JSON.stringify(data[field]) : data[field];
      setClauses.push(`${field} = $${paramIdx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return getRouteById(id);

  setClauses.push(`updated_at = now()`);
  params.push(id);

  const result = await query(
    `UPDATE data_routes SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    params
  );

  return (result.rows[0] as unknown as DataRoute) ?? null;
}

/**
 * Deletes a route by ID.
 */
export async function deleteRoute(id: string): Promise<boolean> {
  const result = await query(
    "DELETE FROM data_routes WHERE id = $1",
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

// --- CRUD: data_transforms ---

/**
 * Gets a single transform by ID.
 */
export async function getTransformById(id: string): Promise<DataTransform | null> {
  const result = await query(
    "SELECT * FROM data_transforms WHERE id = $1",
    [id]
  );

  return (result.rows[0] as unknown as DataTransform) ?? null;
}

/**
 * Creates a new data transform.
 */
export async function createTransform(
  data: Omit<DataTransform, "id" | "created_at" | "updated_at">
): Promise<DataTransform> {
  const validationError = validateTransformChain(data.transform_chain);
  if (validationError) {
    throw new Error(`Invalid transform chain: ${validationError}`);
  }

  const result = await query(
    `INSERT INTO data_transforms (name, transform_chain, reusable)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.name, JSON.stringify(data.transform_chain), data.reusable]
  );

  return result.rows[0] as unknown as DataTransform;
}
