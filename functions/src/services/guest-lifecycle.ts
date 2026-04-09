/**
 * Guest Lifecycle Service
 *
 * Manages guest status transitions through the lifecycle:
 *   draft → invited → confirmed → travel_arranged → arrived → attending → departed
 *
 * Every valid transition fires a domain event and updates the guest record.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";

// --- Types ---

export type GuestStatus =
  | "draft"
  | "invited"
  | "confirmed"
  | "travel_arranged"
  | "arrived"
  | "attending"
  | "departed";

export interface Guest {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly type: string | null;
  readonly department: string | null;
  readonly status: GuestStatus;
  readonly company: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly archived: boolean;
}

export interface GuestSummary extends Guest {
  readonly prep_completion_percent: number;
  readonly pairing_count: number;
  readonly schedule_count: number;
}

// --- Valid transitions map ---

const VALID_TRANSITIONS: Readonly<Record<GuestStatus, ReadonlyArray<GuestStatus>>> = {
  draft: ["invited"],
  invited: ["confirmed"],
  confirmed: ["travel_arranged"],
  travel_arranged: ["arrived"],
  arrived: ["attending"],
  attending: ["departed"],
  departed: [],
};

// --- Public API ---

/**
 * Transition a guest to a new status.
 * Validates the transition, updates the database, and fires a domain event.
 */
export async function transitionGuestStatus(
  guestId: string,
  newStatus: GuestStatus,
  actorEmail: string
): Promise<Guest> {
  const currentResult = await query<Guest>(
    "SELECT * FROM guests WHERE id = $1 AND NOT archived",
    [guestId]
  );

  if (currentResult.rowCount === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const currentGuest = currentResult.rows[0];
  const currentStatus = currentGuest.status as GuestStatus;
  const allowed = VALID_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}`
    );
  }

  const updateResult = await query<Guest>(
    `UPDATE guests SET status = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [newStatus, guestId]
  );

  const updatedGuest = updateResult.rows[0];

  const event = createDomainEvent({
    eventName: `guest.${newStatus}`,
    domain: "guest",
    action: "updated",
    recordId: guestId,
    triggeredBy: actorEmail,
    changedFields: ["status"],
    previousValues: { status: currentStatus },
    newValues: { status: newStatus },
  });

  await emit(event);

  logger.info("Guest status transitioned", {
    guestId,
    from: currentStatus,
    to: newStatus,
    actor: actorEmail,
  });

  return updatedGuest;
}

/**
 * Retrieve all non-archived guests with a given status.
 */
export async function getGuestsByStatus(status: GuestStatus): Promise<ReadonlyArray<Guest>> {
  const result = await query<Guest>(
    "SELECT * FROM guests WHERE status = $1 AND NOT archived ORDER BY name",
    [status]
  );
  return result.rows;
}

/**
 * Build a summary for a single guest including prep completion,
 * pairing count, and schedule event count.
 */
export async function getGuestSummary(guestId: string): Promise<GuestSummary> {
  const guestResult = await query<Guest>(
    "SELECT * FROM guests WHERE id = $1 AND NOT archived",
    [guestId]
  );

  if (guestResult.rowCount === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const guest = guestResult.rows[0];

  const prepResult = await query<{ total: string; completed: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'complete')::text AS completed
     FROM prep_items
     WHERE guest_id = $1 AND NOT archived`,
    [guestId]
  );

  const total = parseInt(prepResult.rows[0].total, 10);
  const completed = parseInt(prepResult.rows[0].completed, 10);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const pairingResult = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM pairings WHERE guest_id = $1 AND NOT archived",
    [guestId]
  );

  const scheduleResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM schedule_events
     WHERE NOT archived
       AND properties->>'guest_id' = $1`,
    [guestId]
  );

  return {
    ...guest,
    prep_completion_percent: percent,
    pairing_count: parseInt(pairingResult.rows[0].count, 10),
    schedule_count: parseInt(scheduleResult.rows[0].count, 10),
  };
}
