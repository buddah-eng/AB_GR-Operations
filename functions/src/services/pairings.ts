/**
 * Pairings Service
 *
 * Business logic for guest-staff pairings:
 * - Assign staff to guests with a role (Main Liaison, Interpreter, Backup Liaison)
 * - Remove (archive) pairings
 * - Query pairings by guest or by staff
 * - Coverage checking against required roles
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface PairingRecord {
  readonly id: string;
  readonly guest_id: string;
  readonly staff_id: string;
  readonly role: string;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly archived: boolean;
}

export interface PairingWithDetails {
  readonly id: string;
  readonly guest_id: string;
  readonly staff_id: string;
  readonly role: string;
  readonly staff_name: string;
  readonly staff_email: string | null;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
}

export interface StaffAssignment {
  readonly id: string;
  readonly guest_id: string;
  readonly staff_id: string;
  readonly role: string;
  readonly guest_name: string;
  readonly guest_status: string;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
}

export interface CoverageResult {
  readonly guestId: string;
  readonly requiredRoles: ReadonlyArray<string>;
  readonly filledRoles: ReadonlyArray<string>;
  readonly missingRoles: ReadonlyArray<string>;
  readonly isFullyCovered: boolean;
}

// --- Service functions ---

/**
 * Assigns a staff member to a guest with a given role.
 * Returns the created pairing record.
 */
export async function assignStaff(
  guestId: string,
  staffId: string,
  role: string,
  client?: PoolClient
): Promise<PairingRecord> {
  const sql = `
    INSERT INTO pairings (guest_id, staff_id, role)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [guestId, staffId, role])
    : await query(sql, [guestId, staffId, role]);

  return rowToPairingRecord(result.rows[0]);
}

/**
 * Archives a pairing (soft delete).
 * Returns true if a pairing was archived, false if not found.
 */
export async function removeStaff(
  pairingId: string,
  client?: PoolClient
): Promise<boolean> {
  const sql = "UPDATE pairings SET archived = true WHERE id = $1 AND NOT archived";

  const result = client
    ? await client.query(sql, [pairingId])
    : await query(sql, [pairingId]);

  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns all active pairings for a guest, with staff details.
 */
export async function getGuestPairings(guestId: string): Promise<ReadonlyArray<PairingWithDetails>> {
  const result = await query(
    `SELECT
       p.id, p.guest_id, p.staff_id, p.role, p.properties, p.created_at,
       s.name AS staff_name, s.email AS staff_email
     FROM pairings p
     JOIN staff s ON s.id = p.staff_id
     WHERE p.guest_id = $1 AND NOT p.archived
     ORDER BY p.role ASC, s.name ASC`,
    [guestId]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    guest_id: row.guest_id as string,
    staff_id: row.staff_id as string,
    role: row.role as string,
    staff_name: row.staff_name as string,
    staff_email: (row.staff_email as string) ?? null,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
  }));
}

/**
 * Returns all active assignments for a staff member, with guest details.
 */
export async function getStaffAssignments(staffId: string): Promise<ReadonlyArray<StaffAssignment>> {
  const result = await query(
    `SELECT
       p.id, p.guest_id, p.staff_id, p.role, p.properties, p.created_at,
       g.name AS guest_name, g.status AS guest_status
     FROM pairings p
     JOIN guests g ON g.id = p.guest_id
     WHERE p.staff_id = $1 AND NOT p.archived AND NOT g.archived
     ORDER BY g.name ASC`,
    [staffId]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    guest_id: row.guest_id as string,
    staff_id: row.staff_id as string,
    role: row.role as string,
    guest_name: row.guest_name as string,
    guest_status: row.guest_status as string,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
  }));
}

/**
 * Checks coverage for a guest against a list of required roles.
 * Returns which roles are filled and which are missing.
 */
export async function checkCoverage(
  guestId: string,
  requiredRoles: ReadonlyArray<string>
): Promise<CoverageResult> {
  const result = await query(
    "SELECT DISTINCT role FROM pairings WHERE guest_id = $1 AND NOT archived",
    [guestId]
  );

  const filledRoles = result.rows.map((row) => row.role as string);
  const missingRoles = requiredRoles.filter((role) => !filledRoles.includes(role));

  return {
    guestId,
    requiredRoles,
    filledRoles,
    missingRoles,
    isFullyCovered: missingRoles.length === 0,
  };
}

/**
 * Returns a single pairing by ID.
 */
export async function getPairingById(pairingId: string): Promise<PairingRecord | null> {
  const result = await query(
    "SELECT * FROM pairings WHERE id = $1 AND NOT archived",
    [pairingId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToPairingRecord(result.rows[0]);
}

// --- Helpers ---

export function rowToPairingRecord(row: Record<string, unknown>): PairingRecord {
  return {
    id: row.id as string,
    guest_id: row.guest_id as string,
    staff_id: row.staff_id as string,
    role: row.role as string,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    archived: (row.archived as boolean) ?? false,
  };
}
