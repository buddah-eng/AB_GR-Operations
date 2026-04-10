/**
 * Google Calendar Sync Service
 *
 * Provides bidirectional sync between the GR-Ops schedule and Google Calendar.
 * Uses the external pipeline infrastructure for actual API communication.
 * Tracks sync state per department in the calendar_sync_state table.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";

// --- Types ---

export interface CalendarSyncState {
  readonly id: string;
  readonly department: string;
  readonly calendar_id: string;
  readonly last_sync_at: string | null;
  readonly sync_token: string | null;
  readonly status: "idle" | "syncing" | "error";
  readonly last_error: string | null;
  readonly records_synced: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SyncResult {
  readonly department: string;
  readonly direction: "push" | "pull";
  readonly recordsSynced: number;
  readonly status: "completed" | "error";
  readonly error?: string;
}

// --- Push to Google Calendar ---

export async function syncToGoogleCalendar(
  departmentKey: string
): Promise<SyncResult> {
  if (!departmentKey) {
    throw new Error("departmentKey is required");
  }

  // Mark sync as in progress
  await upsertSyncState(departmentKey, { status: "syncing" });

  try {
    // Fetch schedule events for this department
    const eventsResult = await query(
      `SELECT id, name, start_time, end_time, venue_id, status, properties
       FROM schedule_events
       WHERE NOT archived
         AND (properties->>'department' = $1 OR $1 = 'all')
       ORDER BY start_time ASC`,
      [departmentKey]
    );

    const recordsSynced = eventsResult.rows.length;

    // Emit domain event for the external pipeline to pick up
    const event = createDomainEvent({
      eventName: "calendar.sync_push",
      domain: "calendar_sync",
      action: "synced",
      recordId: departmentKey,
      newValues: {
        department: departmentKey,
        direction: "push",
        eventCount: recordsSynced,
        events: eventsResult.rows.map((r) => ({
          id: r.id,
          name: r.name,
          startTime: r.start_time,
          endTime: r.end_time,
          venueId: r.venue_id,
        })),
      },
      triggeredBy: "system",
    });
    await emit(event);

    // Update sync state
    await upsertSyncState(departmentKey, {
      status: "idle",
      last_sync_at: new Date().toISOString(),
      records_synced: recordsSynced,
      last_error: null,
    });

    return {
      department: departmentKey,
      direction: "push",
      recordsSynced,
      status: "completed",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Calendar sync push failed", { department: departmentKey, error: message });

    await upsertSyncState(departmentKey, {
      status: "error",
      last_error: message,
    });

    return {
      department: departmentKey,
      direction: "push",
      recordsSynced: 0,
      status: "error",
      error: message,
    };
  }
}

// --- Pull from Google Calendar ---

export async function syncFromGoogleCalendar(
  departmentKey: string
): Promise<SyncResult> {
  if (!departmentKey) {
    throw new Error("departmentKey is required");
  }

  // Mark sync as in progress
  await upsertSyncState(departmentKey, { status: "syncing" });

  try {
    // Get current sync token
    const state = await getSyncState(departmentKey);
    const syncToken = state?.sync_token ?? null;

    // Emit domain event for the external pipeline to handle the pull
    const event = createDomainEvent({
      eventName: "calendar.sync_pull",
      domain: "calendar_sync",
      action: "synced",
      recordId: departmentKey,
      newValues: {
        department: departmentKey,
        direction: "pull",
        syncToken,
      },
      triggeredBy: "system",
    });
    await emit(event);

    // Update sync state (the actual record count comes from the pipeline callback)
    await upsertSyncState(departmentKey, {
      status: "idle",
      last_sync_at: new Date().toISOString(),
      last_error: null,
    });

    return {
      department: departmentKey,
      direction: "pull",
      recordsSynced: 0,
      status: "completed",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Calendar sync pull failed", { department: departmentKey, error: message });

    await upsertSyncState(departmentKey, {
      status: "error",
      last_error: message,
    });

    return {
      department: departmentKey,
      direction: "pull",
      recordsSynced: 0,
      status: "error",
      error: message,
    };
  }
}

// --- Get sync state ---

export async function getSyncState(
  departmentKey: string
): Promise<CalendarSyncState | null> {
  const result = await query(
    "SELECT * FROM calendar_sync_state WHERE department = $1",
    [departmentKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToSyncState(result.rows[0]);
}

// --- Upsert sync state ---

async function upsertSyncState(
  departmentKey: string,
  updates: Partial<Omit<CalendarSyncState, "id" | "department" | "created_at" | "updated_at">>
): Promise<void> {
  // Ensure row exists
  await query(
    `INSERT INTO calendar_sync_state (department, calendar_id)
     VALUES ($1, $2)
     ON CONFLICT (department) DO NOTHING`,
    [departmentKey, `calendar-${departmentKey}`]
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

  params.push(departmentKey);

  await query(
    `UPDATE calendar_sync_state SET ${setClauses.join(", ")} WHERE department = $${paramIdx}`,
    params
  );
}

// --- Row mapper ---

function rowToSyncState(row: Record<string, unknown>): CalendarSyncState {
  return {
    id: row.id as string,
    department: row.department as string,
    calendar_id: row.calendar_id as string,
    last_sync_at: row.last_sync_at
      ? (row.last_sync_at as Date).toISOString?.() ?? String(row.last_sync_at)
      : null,
    sync_token: (row.sync_token as string) ?? null,
    status: row.status as "idle" | "syncing" | "error",
    last_error: (row.last_error as string) ?? null,
    records_synced: (row.records_synced as number) ?? 0,
    created_at: (row.created_at as Date)?.toISOString?.() ?? new Date().toISOString(),
    updated_at: (row.updated_at as Date)?.toISOString?.() ?? new Date().toISOString(),
  };
}
