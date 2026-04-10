/**
 * Guest Lifecycle Service
 *
 * Business logic for guest status management:
 *   draft -> invited -> confirmed -> travel_arranged -> arrived -> attending -> departed
 * Side branches: invited -> declined, any -> canceled
 *
 * Each transition is validated, persisted, and fires a domain event.
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export type GuestStatus =
  | "draft"
  | "invited"
  | "confirmed"
  | "travel_arranged"
  | "arrived"
  | "attending"
  | "departed"
  | "declined"
  | "canceled";

export interface GuestRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string | null;
  readonly department: string | null;
  readonly status: GuestStatus;
  readonly company: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export interface GuestSummary {
  readonly guest: GuestRecord;
  readonly prepCompletionPercent: number;
  readonly prepTotal: number;
  readonly prepComplete: number;
  readonly pairingCount: number;
  readonly scheduleCount: number;
}

// --- Valid transitions ---

const VALID_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  draft: ["invited", "canceled"],
  invited: ["confirmed", "declined", "canceled"],
  confirmed: ["travel_arranged", "canceled"],
  travel_arranged: ["arrived", "canceled"],
  arrived: ["attending", "canceled"],
  attending: ["departed", "canceled"],
  departed: [],
  declined: [],
  canceled: [],
};

// --- Service functions ---

/**
 * Returns all valid statuses a guest can transition to from the current status.
 */
export function getValidTransitions(currentStatus: string): ReadonlyArray<string> {
  return VALID_TRANSITIONS[currentStatus] ?? [];
}

/**
 * Checks whether a transition from one status to another is valid.
 */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Transitions a guest to a new status after validation.
 * Returns the updated guest record or throws if the transition is invalid.
 */
export async function transitionGuestStatus(
  guestId: string,
  newStatus: GuestStatus,
  _actorEmail: string,
  client?: PoolClient
): Promise<GuestRecord> {
  const selectSql = "SELECT * FROM guests WHERE id = $1 AND NOT archived";
  const selectResult = client
    ? await client.query(selectSql, [guestId])
    : await query(selectSql, [guestId]);

  if (selectResult.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const currentRow = selectResult.rows[0];
  const currentStatus = currentRow.status as string;

  if (!isValidTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Valid transitions from "${currentStatus}": ${(VALID_TRANSITIONS[currentStatus] ?? []).join(", ") || "none"}`
    );
  }

  const updateSql = `
    UPDATE guests
    SET status = $1, updated_at = now()
    WHERE id = $2 AND NOT archived
    RETURNING *
  `;

  const updateResult = client
    ? await client.query(updateSql, [newStatus, guestId])
    : await query(updateSql, [newStatus, guestId]);

  return rowToGuestRecord(updateResult.rows[0]);
}

/**
 * Returns all non-archived guests matching the given status.
 */
export async function getGuestsByStatus(status: GuestStatus): Promise<ReadonlyArray<GuestRecord>> {
  const result = await query(
    "SELECT * FROM guests WHERE status = $1 AND NOT archived ORDER BY name ASC",
    [status]
  );

  return result.rows.map(rowToGuestRecord);
}

/**
 * Returns a single guest by ID.
 */
export async function getGuestById(guestId: string): Promise<GuestRecord | null> {
  const result = await query(
    "SELECT * FROM guests WHERE id = $1 AND NOT archived",
    [guestId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToGuestRecord(result.rows[0]);
}

/**
 * Returns a guest summary including prep completion %, pairing count, and schedule count.
 */
export async function getGuestSummary(guestId: string): Promise<GuestSummary | null> {
  const guest = await getGuestById(guestId);
  if (!guest) return null;

  const prepResult = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'complete') AS complete
     FROM prep_items
     WHERE guest_id = $1 AND NOT archived`,
    [guestId]
  );

  const prepTotal = parseInt(prepResult.rows[0].total as string, 10);
  const prepComplete = parseInt(prepResult.rows[0].complete as string, 10);
  const prepCompletionPercent = prepTotal > 0
    ? Math.round((prepComplete / prepTotal) * 100)
    : 0;

  const pairingResult = await query(
    "SELECT COUNT(*) AS cnt FROM pairings WHERE guest_id = $1 AND NOT archived",
    [guestId]
  );
  const pairingCount = parseInt(pairingResult.rows[0].cnt as string, 10);

  const scheduleResult = await query(
    "SELECT COUNT(*) AS cnt FROM guest_schedule_events WHERE guest_id = $1 AND NOT archived",
    [guestId]
  );
  const scheduleCount = parseInt(scheduleResult.rows[0].cnt as string, 10);

  return {
    guest,
    prepCompletionPercent,
    prepTotal,
    prepComplete,
    pairingCount,
    scheduleCount,
  };
}

/**
 * Creates a new guest record.
 */
export async function createGuest(
  data: {
    readonly name: string;
    readonly type?: string;
    readonly department?: string;
    readonly company?: string;
    readonly properties?: Record<string, unknown>;
    readonly created_by?: string;
  },
  client?: PoolClient
): Promise<GuestRecord> {
  const sql = `
    INSERT INTO guests (name, type, department, company, properties, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const params = [
    data.name,
    data.type ?? null,
    data.department ?? null,
    data.company ?? null,
    JSON.stringify(data.properties ?? {}),
    data.created_by ?? null,
  ];

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  return rowToGuestRecord(result.rows[0]);
}

// --- Helpers ---

export function rowToGuestRecord(row: Record<string, unknown>): GuestRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    type: (row.type as string) ?? null,
    department: (row.department as string) ?? null,
    status: (row.status as GuestStatus) ?? "draft",
    company: (row.company as string) ?? null,
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
