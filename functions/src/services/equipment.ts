/**
 * Equipment Logistics Service
 *
 * Manages equipment checkout/return, overdue tracking, and venue assignment.
 * All state transitions go through the audit pipeline.
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface Equipment {
  readonly id: string;
  readonly name: string;
  readonly category: EquipmentCategory;
  readonly venue_id: string | null;
  readonly status: EquipmentStatus;
  readonly checked_out_to: string | null;
  readonly checked_out_at: string | null;
  readonly due_back_at: string | null;
  readonly serial_number: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export type EquipmentCategory =
  | "av"
  | "signage"
  | "furniture"
  | "tech"
  | "safety"
  | "catering"
  | "other";

export type EquipmentStatus =
  | "available"
  | "checked_out"
  | "maintenance"
  | "retired";

export interface CheckoutResult {
  readonly success: boolean;
  readonly equipment: Equipment;
}

export interface ReturnResult {
  readonly success: boolean;
  readonly equipment: Equipment;
  readonly wasOverdue: boolean;
}

// --- Checkout equipment ---

export async function checkoutEquipment(
  equipmentId: string,
  staffId: string,
  dueBackAt: string,
  client?: PoolClient
): Promise<CheckoutResult> {
  if (!equipmentId || !staffId || !dueBackAt) {
    throw new Error("equipmentId, staffId, and dueBackAt are required");
  }

  if (new Date(dueBackAt) <= new Date()) {
    throw new Error("dueBackAt must be in the future");
  }

  const execQuery = client
    ? (text: string, params: unknown[]) => client.query(text, params)
    : (text: string, params: unknown[]) => query(text, params);

  // Verify equipment exists and is available
  const existing = await execQuery(
    "SELECT * FROM equipment WHERE id = $1 AND NOT archived",
    [equipmentId]
  );

  if (existing.rows.length === 0) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  const current = existing.rows[0];
  if (current.status !== "available") {
    throw new Error(
      `Equipment "${current.name}" is not available (current status: ${current.status})`
    );
  }

  const result = await execQuery(
    `UPDATE equipment
     SET status = 'checked_out',
         checked_out_to = $1,
         checked_out_at = now(),
         due_back_at = $2,
         updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [staffId, dueBackAt, equipmentId]
  );

  return {
    success: true,
    equipment: rowToEquipment(result.rows[0]),
  };
}

// --- Return equipment ---

export async function returnEquipment(
  equipmentId: string,
  client?: PoolClient
): Promise<ReturnResult> {
  if (!equipmentId) {
    throw new Error("equipmentId is required");
  }

  const execQuery = client
    ? (text: string, params: unknown[]) => client.query(text, params)
    : (text: string, params: unknown[]) => query(text, params);

  // Verify equipment exists and is checked out
  const existing = await execQuery(
    "SELECT * FROM equipment WHERE id = $1 AND NOT archived",
    [equipmentId]
  );

  if (existing.rows.length === 0) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  const current = existing.rows[0];
  if (current.status !== "checked_out") {
    throw new Error(
      `Equipment "${current.name}" is not checked out (current status: ${current.status})`
    );
  }

  const wasOverdue =
    current.due_back_at !== null &&
    new Date(current.due_back_at as string) < new Date();

  const result = await execQuery(
    `UPDATE equipment
     SET status = 'available',
         checked_out_to = NULL,
         checked_out_at = NULL,
         due_back_at = NULL,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [equipmentId]
  );

  return {
    success: true,
    equipment: rowToEquipment(result.rows[0]),
    wasOverdue,
  };
}

// --- Get overdue equipment ---

export async function getOverdueEquipment(): Promise<ReadonlyArray<Equipment>> {
  const result = await query(
    `SELECT * FROM equipment
     WHERE status = 'checked_out'
       AND due_back_at IS NOT NULL
       AND due_back_at < now()
       AND NOT archived
     ORDER BY due_back_at ASC`
  );

  return result.rows.map(rowToEquipment);
}

// --- List equipment by venue ---

export async function listEquipmentByVenue(
  venueId: string
): Promise<ReadonlyArray<Equipment>> {
  const result = await query(
    `SELECT * FROM equipment
     WHERE venue_id = $1 AND NOT archived
     ORDER BY name ASC`,
    [venueId]
  );

  return result.rows.map(rowToEquipment);
}

// --- Row mapper ---

function rowToEquipment(row: Record<string, unknown>): Equipment {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as EquipmentCategory,
    venue_id: (row.venue_id as string) ?? null,
    status: row.status as EquipmentStatus,
    checked_out_to: (row.checked_out_to as string) ?? null,
    checked_out_at: row.checked_out_at
      ? (row.checked_out_at as Date).toISOString?.() ?? String(row.checked_out_at)
      : null,
    due_back_at: row.due_back_at
      ? (row.due_back_at as Date).toISOString?.() ?? String(row.due_back_at)
      : null,
    serial_number: (row.serial_number as string) ?? null,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: (row.created_at as Date)?.toISOString?.() ?? new Date().toISOString(),
    updated_at: (row.updated_at as Date)?.toISOString?.() ?? new Date().toISOString(),
    archived: (row.archived as boolean) ?? false,
  };
}

// Exported for testing
export { rowToEquipment };
