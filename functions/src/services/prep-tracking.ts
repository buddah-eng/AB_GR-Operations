/**
 * Prep Tracking Service
 *
 * Manages prep items for guests: batch creation from templates,
 * status updates, completion tracking, and overdue detection.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

// --- Types ---

export interface PrepItem {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly guest_id: string | null;
  readonly status: string;
  readonly due_date: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly archived: boolean;
}

export interface TemplateItem {
  readonly [key: string]: unknown;
  readonly name: string;
  readonly due_date?: string;
  readonly properties?: Record<string, unknown>;
}

export interface CompletionRate {
  readonly [key: string]: unknown;
  readonly total: number;
  readonly completed: number;
  readonly percent: number;
}

export interface DepartmentCompletion {
  readonly [key: string]: unknown;
  readonly department: string;
  readonly total: number;
  readonly completed: number;
  readonly percent: number;
}

// --- Public API ---

/**
 * Batch-insert prep items for a guest from a template list.
 */
export async function createPrepItems(
  guestId: string,
  templateItems: ReadonlyArray<TemplateItem>
): Promise<ReadonlyArray<PrepItem>> {
  if (templateItems.length === 0) {
    return [];
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];

  templateItems.forEach((item, idx) => {
    const offset = idx * 4;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
    );
    values.push(
      item.name,
      guestId,
      item.due_date ?? null,
      JSON.stringify(item.properties ?? {})
    );
  });

  const result = await query<PrepItem>(
    `INSERT INTO prep_items (name, guest_id, due_date, properties)
     VALUES ${placeholders.join(", ")}
     RETURNING *`,
    values
  );

  logger.info("Prep items created", {
    guestId,
    count: result.rowCount,
  });

  return result.rows;
}

/**
 * Update the status of a single prep item.
 */
export async function updatePrepItemStatus(
  prepItemId: string,
  status: string
): Promise<PrepItem> {
  const result = await query<PrepItem>(
    `UPDATE prep_items SET status = $1, updated_at = now()
     WHERE id = $2 AND NOT archived
     RETURNING *`,
    [status, prepItemId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Prep item not found: ${prepItemId}`);
  }

  logger.info("Prep item status updated", { prepItemId, status });

  return result.rows[0];
}

/**
 * Calculate the completion rate for a guest's prep items.
 */
export async function getCompletionRate(guestId: string): Promise<CompletionRate> {
  const result = await query<{ total: string; completed: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'complete')::text AS completed
     FROM prep_items
     WHERE guest_id = $1 AND NOT archived`,
    [guestId]
  );

  const total = parseInt(result.rows[0].total, 10);
  const completed = parseInt(result.rows[0].completed, 10);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, percent };
}

/**
 * Find all prep items that are past their due date and not yet complete.
 */
export async function getOverdueItems(): Promise<ReadonlyArray<PrepItem>> {
  const result = await query<PrepItem>(
    `SELECT * FROM prep_items
     WHERE due_date < CURRENT_DATE
       AND status != 'complete'
       AND NOT archived
     ORDER BY due_date ASC`,
    []
  );

  return result.rows;
}

/**
 * Aggregate completion rates grouped by department (via guest relationship).
 */
export async function getCompletionByDepartment(): Promise<ReadonlyArray<DepartmentCompletion>> {
  const result = await query<{ department: string; total: string; completed: string }>(
    `SELECT
       g.department,
       COUNT(p.id)::text AS total,
       COUNT(p.id) FILTER (WHERE p.status = 'complete')::text AS completed
     FROM prep_items p
     JOIN guests g ON p.guest_id = g.id
     WHERE NOT p.archived AND NOT g.archived
     GROUP BY g.department
     ORDER BY g.department`,
    []
  );

  return result.rows.map((row) => {
    const total = parseInt(row.total, 10);
    const completed = parseInt(row.completed, 10);
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      department: row.department,
      total,
      completed,
      percent,
    };
  });
}
