/**
 * Prep Tracking Service
 *
 * Business logic for guest preparation item management:
 * - Batch creation from templates
 * - Status updates (incomplete, complete, overdue, na)
 * - Completion rate calculations (per-guest, per-department)
 * - Overdue item detection
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export type PrepItemStatus = "incomplete" | "complete" | "overdue" | "na";

export interface PrepItemRecord {
  readonly id: string;
  readonly name: string;
  readonly guest_id: string | null;
  readonly status: PrepItemStatus;
  readonly due_date: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export interface TemplateItem {
  readonly name: string;
  readonly category?: string;
  readonly due_date?: string;
  readonly assigned_to?: string;
  readonly auto_complete_event?: string;
}

export interface CompletionRate {
  readonly total: number;
  readonly complete: number;
  readonly percent: number;
}

export interface DepartmentCompletion {
  readonly department: string;
  readonly total: number;
  readonly complete: number;
  readonly percent: number;
}

// --- Service functions ---

/**
 * Batch-creates prep items for a guest from template items.
 * Returns all created prep item records.
 */
export async function createPrepItems(
  guestId: string,
  templateItems: ReadonlyArray<TemplateItem>,
  client?: PoolClient
): Promise<ReadonlyArray<PrepItemRecord>> {
  if (templateItems.length === 0) {
    return [];
  }

  const results: PrepItemRecord[] = [];

  for (const item of templateItems) {
    const properties: Record<string, unknown> = {};
    if (item.category) properties.category = item.category;
    if (item.assigned_to) properties.assigned_to = item.assigned_to;
    if (item.auto_complete_event) properties.auto_complete_event = item.auto_complete_event;

    const sql = `
      INSERT INTO prep_items (name, guest_id, status, due_date, properties)
      VALUES ($1, $2, 'incomplete', $3, $4)
      RETURNING *
    `;

    const params = [
      item.name,
      guestId,
      item.due_date ?? null,
      JSON.stringify(properties),
    ];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    results.push(rowToPrepItemRecord(result.rows[0]));
  }

  return results;
}

/**
 * Updates the status of a single prep item.
 * Returns the updated record or null if not found.
 */
export async function updatePrepItemStatus(
  prepItemId: string,
  status: PrepItemStatus,
  client?: PoolClient
): Promise<PrepItemRecord | null> {
  const sql = `
    UPDATE prep_items
    SET status = $1, updated_at = now()
    WHERE id = $2 AND NOT archived
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [status, prepItemId])
    : await query(sql, [status, prepItemId]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToPrepItemRecord(result.rows[0]);
}

/**
 * Returns the completion rate for a given guest.
 */
export async function getCompletionRate(guestId: string): Promise<CompletionRate> {
  const result = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'complete') AS complete
     FROM prep_items
     WHERE guest_id = $1 AND NOT archived`,
    [guestId]
  );

  const total = parseInt(result.rows[0].total as string, 10);
  const complete = parseInt(result.rows[0].complete as string, 10);

  return {
    total,
    complete,
    percent: total > 0 ? Math.round((complete / total) * 100) : 0,
  };
}

/**
 * Returns all prep items for a given guest.
 */
export async function getPrepItemsByGuest(guestId: string): Promise<ReadonlyArray<PrepItemRecord>> {
  const result = await query(
    "SELECT * FROM prep_items WHERE guest_id = $1 AND NOT archived ORDER BY created_at ASC",
    [guestId]
  );

  return result.rows.map(rowToPrepItemRecord);
}

/**
 * Returns a single prep item by ID.
 */
export async function getPrepItemById(prepItemId: string): Promise<PrepItemRecord | null> {
  const result = await query(
    "SELECT * FROM prep_items WHERE id = $1 AND NOT archived",
    [prepItemId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToPrepItemRecord(result.rows[0]);
}

/**
 * Returns all overdue prep items (status = 'incomplete' and due_date < today).
 */
export async function getOverdueItems(): Promise<ReadonlyArray<PrepItemRecord>> {
  const result = await query(
    `SELECT * FROM prep_items
     WHERE status = 'incomplete'
       AND due_date < CURRENT_DATE
       AND NOT archived
     ORDER BY due_date ASC`
  );

  return result.rows.map(rowToPrepItemRecord);
}

/**
 * Returns completion rates grouped by department (via guest.department).
 */
export async function getCompletionByDepartment(): Promise<ReadonlyArray<DepartmentCompletion>> {
  const result = await query(
    `SELECT
       g.department,
       COUNT(pi.id) AS total,
       COUNT(pi.id) FILTER (WHERE pi.status = 'complete') AS complete
     FROM prep_items pi
     JOIN guests g ON g.id = pi.guest_id
     WHERE NOT pi.archived AND NOT g.archived
     GROUP BY g.department
     ORDER BY g.department ASC`
  );

  return result.rows.map((row) => {
    const total = parseInt(row.total as string, 10);
    const complete = parseInt(row.complete as string, 10);
    return {
      department: (row.department as string) ?? "unassigned",
      total,
      complete,
      percent: total > 0 ? Math.round((complete / total) * 100) : 0,
    };
  });
}

/**
 * Marks overdue items: updates status to 'overdue' for items
 * that are 'incomplete' and past their due date.
 * Returns the count of items updated.
 */
export async function markOverdueItems(client?: PoolClient): Promise<number> {
  const sql = `
    UPDATE prep_items
    SET status = 'overdue', updated_at = now()
    WHERE status = 'incomplete'
      AND due_date < CURRENT_DATE
      AND NOT archived
  `;

  const result = client
    ? await client.query(sql)
    : await query(sql);

  return result.rowCount ?? 0;
}

// --- Helpers ---

export function rowToPrepItemRecord(row: Record<string, unknown>): PrepItemRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    guest_id: (row.guest_id as string) ?? null,
    status: (row.status as PrepItemStatus) ?? "incomplete",
    due_date: row.due_date instanceof Date
      ? row.due_date.toISOString().split("T")[0]
      : (row.due_date as string) ?? null,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at as string) ?? new Date().toISOString(),
    archived: (row.archived as boolean) ?? false,
  };
}
