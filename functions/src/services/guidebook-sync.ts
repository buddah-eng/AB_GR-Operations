/**
 * Guidebook Integration Service
 *
 * Pushes schedule, guest bios, and venue information to Guidebook
 * via the external pipeline infrastructure. Tracks publish status
 * in the guidebook_sync_log table.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";

// --- Types ---

export type GuidebookSyncType = "schedule" | "guest_bios" | "venue_info" | "full";

export interface GuidebookSyncLog {
  readonly id: string;
  readonly sync_type: GuidebookSyncType;
  readonly records_pushed: number;
  readonly status: "pending" | "in_progress" | "completed" | "failed";
  readonly error: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface PublishResult {
  readonly syncLogId: string;
  readonly syncType: GuidebookSyncType;
  readonly recordsPushed: number;
  readonly status: "completed" | "failed";
  readonly error?: string;
}

// --- Publish to Guidebook ---

export async function publishToGuidebook(
  syncType: GuidebookSyncType
): Promise<PublishResult> {
  if (!syncType) {
    throw new Error("syncType is required");
  }

  const validTypes: ReadonlyArray<GuidebookSyncType> = ["schedule", "guest_bios", "venue_info", "full"];
  if (!validTypes.includes(syncType)) {
    throw new Error(`Invalid syncType: ${syncType}. Must be one of: ${validTypes.join(", ")}`);
  }

  // Create sync log entry
  const logResult = await query(
    `INSERT INTO guidebook_sync_log (sync_type, status)
     VALUES ($1, 'in_progress')
     RETURNING *`,
    [syncType]
  );
  const syncLogId = logResult.rows[0].id as string;

  try {
    let recordsPushed = 0;

    // Gather data based on sync type
    if (syncType === "schedule" || syncType === "full") {
      const scheduleResult = await query(
        `SELECT COUNT(*) FROM schedule_events WHERE NOT archived`
      );
      recordsPushed += parseInt(scheduleResult.rows[0].count as string, 10);
    }

    if (syncType === "guest_bios" || syncType === "full") {
      const guestResult = await query(
        `SELECT COUNT(*) FROM guests WHERE NOT archived AND status = 'confirmed'`
      );
      recordsPushed += parseInt(guestResult.rows[0].count as string, 10);
    }

    if (syncType === "venue_info" || syncType === "full") {
      const venueResult = await query(
        `SELECT COUNT(*) FROM venues WHERE NOT archived`
      );
      recordsPushed += parseInt(venueResult.rows[0].count as string, 10);
    }

    // Emit domain event for the external pipeline
    const event = createDomainEvent({
      eventName: "guidebook.publish",
      domain: "guidebook_sync",
      action: "synced",
      recordId: syncLogId,
      newValues: {
        syncType,
        recordsPushed,
      },
      triggeredBy: "system",
    });
    await emit(event);

    // Update sync log
    await query(
      `UPDATE guidebook_sync_log
       SET status = 'completed',
           records_pushed = $1,
           completed_at = now()
       WHERE id = $2`,
      [recordsPushed, syncLogId]
    );

    return {
      syncLogId,
      syncType,
      recordsPushed,
      status: "completed",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Guidebook publish failed", { syncType, error: message });

    await query(
      `UPDATE guidebook_sync_log
       SET status = 'failed',
           error = $1,
           completed_at = now()
       WHERE id = $2`,
      [message, syncLogId]
    );

    return {
      syncLogId,
      syncType,
      recordsPushed: 0,
      status: "failed",
      error: message,
    };
  }
}

// --- Get publish status ---

export async function getPublishStatus(
  limit = 10
): Promise<ReadonlyArray<GuidebookSyncLog>> {
  const result = await query(
    `SELECT * FROM guidebook_sync_log
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(rowToSyncLog);
}

// --- Get latest status by type ---

export async function getLatestPublishByType(
  syncType: GuidebookSyncType
): Promise<GuidebookSyncLog | null> {
  const result = await query(
    `SELECT * FROM guidebook_sync_log
     WHERE sync_type = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [syncType]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToSyncLog(result.rows[0]);
}

// --- Row mapper ---

function rowToSyncLog(row: Record<string, unknown>): GuidebookSyncLog {
  return {
    id: row.id as string,
    sync_type: row.sync_type as GuidebookSyncType,
    records_pushed: (row.records_pushed as number) ?? 0,
    status: row.status as GuidebookSyncLog["status"],
    error: (row.error as string) ?? null,
    started_at: (row.started_at as Date)?.toISOString?.() ?? new Date().toISOString(),
    completed_at: row.completed_at
      ? (row.completed_at as Date).toISOString?.() ?? String(row.completed_at)
      : null,
  };
}
