/**
 * Pairings Service
 *
 * Manages staff-to-guest pairings (assignments).
 * Supports assigning, archiving, listing, and coverage checks.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";

// --- Types ---

export interface Pairing {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly guest_id: string;
  readonly staff_id: string;
  readonly role: string;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly archived: boolean;
}

export interface PairingWithStaff extends Pairing {
  readonly staff_name: string;
  readonly staff_email: string | null;
  readonly staff_department: string | null;
}

export interface PairingWithGuest extends Pairing {
  readonly guest_name: string;
  readonly guest_status: string;
  readonly guest_department: string | null;
}

export interface CoverageResult {
  readonly [key: string]: unknown;
  readonly filled: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

// --- Public API ---

/**
 * Assign a staff member to a guest with a specific role.
 */
export async function assignStaff(
  guestId: string,
  staffId: string,
  role: string
): Promise<Pairing> {
  const result = await query<Pairing>(
    `INSERT INTO pairings (guest_id, staff_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [guestId, staffId, role]
  );

  logger.info("Staff assigned to guest", { guestId, staffId, role });

  return result.rows[0];
}

/**
 * Archive a pairing (soft delete).
 */
export async function removeStaff(pairingId: string): Promise<Pairing> {
  const result = await query<Pairing>(
    `UPDATE pairings SET archived = true
     WHERE id = $1 AND NOT archived
     RETURNING *`,
    [pairingId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Pairing not found: ${pairingId}`);
  }

  logger.info("Pairing archived", { pairingId });

  return result.rows[0];
}

/**
 * List all active pairings for a guest, including staff details.
 */
export async function getGuestPairings(
  guestId: string
): Promise<ReadonlyArray<PairingWithStaff>> {
  const result = await query<PairingWithStaff>(
    `SELECT
       p.*,
       s.name AS staff_name,
       s.email AS staff_email,
       s.department AS staff_department
     FROM pairings p
     JOIN staff s ON p.staff_id = s.id
     WHERE p.guest_id = $1 AND NOT p.archived
     ORDER BY p.role`,
    [guestId]
  );

  return result.rows;
}

/**
 * List all active pairings for a staff member, including guest details.
 */
export async function getStaffAssignments(
  staffId: string
): Promise<ReadonlyArray<PairingWithGuest>> {
  const result = await query<PairingWithGuest>(
    `SELECT
       p.*,
       g.name AS guest_name,
       g.status AS guest_status,
       g.department AS guest_department
     FROM pairings p
     JOIN guests g ON p.guest_id = g.id
     WHERE p.staff_id = $1 AND NOT p.archived
     ORDER BY g.name`,
    [staffId]
  );

  return result.rows;
}

/**
 * Check which required roles are filled vs missing for a guest.
 */
export async function checkCoverage(
  guestId: string,
  requiredRoles: ReadonlyArray<string>
): Promise<CoverageResult> {
  const result = await query<{ role: string }>(
    `SELECT DISTINCT role FROM pairings
     WHERE guest_id = $1 AND NOT archived`,
    [guestId]
  );

  const filledRoles = new Set(result.rows.map((r) => r.role));

  const filled = requiredRoles.filter((role) => filledRoles.has(role));
  const missing = requiredRoles.filter((role) => !filledRoles.has(role));

  return { filled, missing };
}
