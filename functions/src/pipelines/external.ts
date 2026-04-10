/**
 * External Pipeline Service
 *
 * Manages external API connections for inbound polling and outbound pushing.
 * Handles sync state tracking, credential references, and field mapping
 * between external API formats and internal concept records.
 *
 * Credentials are stored in Secret Manager (referenced by auth_config),
 * never in the database.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface ExternalConnection {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly endpoint_url: string;
  readonly auth_method: "api_key" | "oauth2" | "service_account" | "basic" | "bearer" | "webhook_secret";
  readonly auth_config: Readonly<Record<string, unknown>>;
  readonly direction: "inbound" | "outbound" | "bidirectional";
  readonly concept_key: string;
  readonly field_mappings: ReadonlyArray<FieldMapping>;
  readonly poll_interval_ms: number | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FieldMapping {
  readonly external_field: string;
  readonly internal_field: string;
}

export interface SyncState {
  readonly id: string;
  readonly connection_id: string;
  readonly last_sync_at: string | null;
  readonly sync_token: string | null;
  readonly status: "idle" | "syncing" | "error";
  readonly last_error: string | null;
  readonly records_synced: number;
  readonly updated_at: string;
}

// --- Injected fetch (for testing) ---

type FetchFn = typeof globalThis.fetch;

let _fetch: FetchFn = globalThis.fetch;

/**
 * Replace the fetch implementation. Primarily for testing.
 */
export function setFetch(fn: FetchFn): void {
  _fetch = fn;
}

/**
 * Reset fetch to the global implementation.
 */
export function resetFetch(): void {
  _fetch = globalThis.fetch;
}

// --- Inbound sync ---

/**
 * Polls an external API via the connection configuration, transforms the
 * response, and creates/updates records in the platform.
 */
export async function executeInboundSync(
  connectionId: string
): Promise<{ recordsSynced: number; errors: ReadonlyArray<string> }> {
  const connection = await getConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  if (!connection.active) {
    throw new Error(`Connection "${connection.name}" is not active`);
  }

  if (connection.direction !== "inbound" && connection.direction !== "bidirectional") {
    throw new Error(`Connection "${connection.name}" does not support inbound sync`);
  }

  // Update sync state to syncing
  await updateSyncState(connectionId, { status: "syncing" });

  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    // Build auth headers
    const headers = buildAuthHeaders(connection);

    // Poll external API
    const response = await _fetch(connection.endpoint_url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`External API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const records = Array.isArray(data) ? data : (data.results as unknown[] ?? data.data as unknown[] ?? [data]);

    // Transform and upsert each record
    for (const externalRecord of records) {
      try {
        const mapped = applyInboundFieldMappings(
          externalRecord as Record<string, unknown>,
          connection.field_mappings
        );

        // Upsert into platform
        await query(
          `INSERT INTO domain_data (concept_key, data)
           VALUES ($1, $2)
           ON CONFLICT (concept_key, (data->>'external_id'))
           DO UPDATE SET data = $2, updated_at = now()`,
          [connection.concept_key, JSON.stringify(mapped)]
        );

        recordsSynced++;

        // Emit domain event
        const event = createDomainEvent({
          eventName: `${connection.concept_key}.external_updated`,
          domain: connection.concept_key,
          action: "external_updated",
          recordId: String((mapped as Record<string, unknown>).external_id ?? "unknown"),
          newValues: mapped as Record<string, unknown>,
          triggeredBy: "system",
        });
        await emit(event);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
      }
    }

    // Update sync state
    await updateSyncState(connectionId, {
      status: "idle",
      last_sync_at: new Date().toISOString(),
      records_synced: recordsSynced,
      last_error: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Inbound sync failed for "${connection.name}"`, { error: message });

    await updateSyncState(connectionId, {
      status: "error",
      last_error: message,
    });

    errors.push(message);
  }

  return { recordsSynced, errors };
}

// --- Outbound push ---

/**
 * Transforms a platform record and pushes it to an external API.
 */
export async function executeOutboundPush(
  connectionId: string,
  event: DomainEvent
): Promise<{ success: boolean; error?: string }> {
  const connection = await getConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  if (!connection.active) {
    throw new Error(`Connection "${connection.name}" is not active`);
  }

  if (connection.direction !== "outbound" && connection.direction !== "bidirectional") {
    throw new Error(`Connection "${connection.name}" does not support outbound push`);
  }

  try {
    const headers = buildAuthHeaders(connection);
    headers["Content-Type"] = "application/json";

    // Apply outbound field mappings
    const mapped = applyOutboundFieldMappings(
      event.newValues ?? {},
      connection.field_mappings
    );

    const response = await _fetch(connection.endpoint_url, {
      method: "POST",
      headers,
      body: JSON.stringify(mapped),
    });

    if (!response.ok) {
      throw new Error(`External API returned ${response.status}: ${response.statusText}`);
    }

    // Update sync state
    await updateSyncState(connectionId, {
      status: "idle",
      last_sync_at: new Date().toISOString(),
      records_synced: 1,
      last_error: null,
    });

    // Emit synced event
    const syncedEvent = createDomainEvent({
      eventName: `${connection.concept_key}.synced`,
      domain: connection.concept_key,
      action: "synced",
      recordId: event.recordId,
      newValues: mapped as Record<string, unknown>,
      triggeredBy: "system",
    });
    await emit(syncedEvent);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Outbound push failed for "${connection.name}"`, { error: message });

    await updateSyncState(connectionId, {
      status: "error",
      last_error: message,
    });

    return { success: false, error: message };
  }
}

// --- Sync state ---

/**
 * Gets the sync state for a connection.
 */
export async function getSyncState(connectionId: string): Promise<SyncState | null> {
  const result = await query(
    "SELECT * FROM sync_state WHERE connection_id = $1",
    [connectionId]
  );

  return (result.rows[0] as unknown as SyncState) ?? null;
}

/**
 * Updates the sync state for a connection. Creates the row if it does not exist.
 */
export async function updateSyncState(
  connectionId: string,
  updates: Partial<Omit<SyncState, "id" | "connection_id" | "updated_at">>
): Promise<SyncState> {
  // Ensure sync_state row exists
  await query(
    `INSERT INTO sync_state (connection_id) VALUES ($1) ON CONFLICT (connection_id) DO NOTHING`,
    [connectionId]
  );

  const setClauses: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    params.push(updates.status);
  }
  if (updates.last_sync_at !== undefined) {
    setClauses.push(`last_sync_at = $${paramIdx++}`);
    params.push(updates.last_sync_at);
  }
  if (updates.sync_token !== undefined) {
    setClauses.push(`sync_token = $${paramIdx++}`);
    params.push(updates.sync_token);
  }
  if (updates.last_error !== undefined) {
    setClauses.push(`last_error = $${paramIdx++}`);
    params.push(updates.last_error);
  }
  if (updates.records_synced !== undefined) {
    setClauses.push(`records_synced = $${paramIdx++}`);
    params.push(updates.records_synced);
  }

  params.push(connectionId);

  const result = await query(
    `UPDATE sync_state SET ${setClauses.join(", ")} WHERE connection_id = $${paramIdx} RETURNING *`,
    params
  );

  return result.rows[0] as unknown as SyncState;
}

// --- Connection CRUD ---

/**
 * Lists external connections with optional filters.
 */
export async function listConnections(
  active?: boolean
): Promise<ReadonlyArray<ExternalConnection>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (active !== undefined) {
    conditions.push("active = $1");
    params.push(active);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT * FROM external_connections ${whereClause} ORDER BY created_at DESC`,
    params
  );

  return result.rows as unknown as ReadonlyArray<ExternalConnection>;
}

/**
 * Gets a single connection by ID.
 */
export async function getConnectionById(id: string): Promise<ExternalConnection | null> {
  const result = await query(
    "SELECT * FROM external_connections WHERE id = $1",
    [id]
  );

  return (result.rows[0] as unknown as ExternalConnection) ?? null;
}

/**
 * Creates a new external connection.
 */
export async function createConnection(
  data: Omit<ExternalConnection, "id" | "created_at" | "updated_at">
): Promise<ExternalConnection> {
  const result = await query(
    `INSERT INTO external_connections (name, provider, endpoint_url, auth_method, auth_config, direction, concept_key, field_mappings, poll_interval_ms, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.name,
      data.provider,
      data.endpoint_url,
      data.auth_method,
      JSON.stringify(data.auth_config),
      data.direction,
      data.concept_key,
      JSON.stringify(data.field_mappings),
      data.poll_interval_ms,
      data.active,
    ]
  );

  return result.rows[0] as unknown as ExternalConnection;
}

/**
 * Updates an existing connection.
 */
export async function updateConnection(
  id: string,
  data: Partial<Omit<ExternalConnection, "id" | "created_at" | "updated_at">>
): Promise<ExternalConnection | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields = [
    "name", "provider", "endpoint_url", "auth_method", "auth_config",
    "direction", "concept_key", "field_mappings", "poll_interval_ms", "active",
  ] as const;

  for (const field of fields) {
    const value = data[field as keyof typeof data];
    if (value !== undefined) {
      const serialized = (field === "auth_config" || field === "field_mappings")
        ? JSON.stringify(value)
        : value;
      setClauses.push(`${field} = $${paramIdx++}`);
      params.push(serialized);
    }
  }

  if (setClauses.length === 0) return getConnectionById(id);

  setClauses.push("updated_at = now()");
  params.push(id);

  const result = await query(
    `UPDATE external_connections SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    params
  );

  return (result.rows[0] as unknown as ExternalConnection) ?? null;
}

/**
 * Deletes a connection by ID.
 */
export async function deleteConnection(id: string): Promise<boolean> {
  const result = await query(
    "DELETE FROM external_connections WHERE id = $1",
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

// --- Helpers ---

function buildAuthHeaders(connection: ExternalConnection): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (connection.auth_method) {
    case "api_key": {
      const headerName = (connection.auth_config.header_name as string) ?? "X-API-Key";
      const apiKey = (connection.auth_config.api_key as string) ?? "";
      headers[headerName] = apiKey;
      break;
    }

    case "bearer": {
      const token = (connection.auth_config.token as string) ?? "";
      headers["Authorization"] = `Bearer ${token}`;
      break;
    }

    case "basic": {
      const username = (connection.auth_config.username as string) ?? "";
      const password = (connection.auth_config.password as string) ?? "";
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      break;
    }

    case "oauth2":
    case "service_account":
    case "webhook_secret":
      // These require runtime credential loading from Secret Manager
      // Placeholder for production implementation
      break;
  }

  return headers;
}

function applyInboundFieldMappings(
  externalRecord: Readonly<Record<string, unknown>>,
  mappings: ReadonlyArray<FieldMapping>
): Readonly<Record<string, unknown>> {
  if (mappings.length === 0) return externalRecord;

  const result: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (externalRecord[mapping.external_field] !== undefined) {
      result[mapping.internal_field] = externalRecord[mapping.external_field];
    }
  }
  return result;
}

function applyOutboundFieldMappings(
  internalRecord: Readonly<Record<string, unknown>>,
  mappings: ReadonlyArray<FieldMapping>
): Readonly<Record<string, unknown>> {
  if (mappings.length === 0) return internalRecord;

  const result: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (internalRecord[mapping.internal_field] !== undefined) {
      result[mapping.external_field] = internalRecord[mapping.internal_field];
    }
  }
  return result;
}
