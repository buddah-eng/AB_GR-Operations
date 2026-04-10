/**
 * Volunteer Service
 *
 * Business logic for volunteer management: skill tracking, training status,
 * shift matching, assignment, and coverage analysis.
 * Volunteers are staff records with staff_type = 'volunteer'.
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface VolunteerRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly skills: ReadonlyArray<string>;
  readonly training_status: string;
  readonly availability: Record<string, unknown>;
  readonly emergency_contact: string | null;
  readonly languages: ReadonlyArray<string>;
  readonly active: boolean;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface VolunteerFilters {
  readonly skills?: ReadonlyArray<string>;
  readonly training_status?: string;
  readonly active?: boolean;
  readonly department?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface ShiftCoverage {
  readonly shift_id: string;
  readonly shift_name: string;
  readonly min_volunteers: number;
  readonly max_volunteers: number;
  readonly assigned_count: number;
  readonly confirmed_count: number;
  readonly is_covered: boolean;
  readonly coverage_percentage: number;
}

export interface ShiftAssignment {
  readonly id: string;
  readonly shift_id: string;
  readonly volunteer_id: string;
  readonly status: string;
  readonly assigned_at: string;
  readonly confirmed_at: string | null;
  readonly checked_in_at: string | null;
  readonly notes: string | null;
}

export type TrainingStatus = "pending" | "in_progress" | "completed" | "expired";

const VALID_TRAINING_STATUSES = new Set<string>(["pending", "in_progress", "completed", "expired"]);

// --- Service functions ---

/**
 * Lists volunteers (staff with staff_type = 'volunteer') with optional filters.
 */
export async function listVolunteers(filters?: VolunteerFilters): Promise<{
  readonly data: ReadonlyArray<VolunteerRecord>;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}> {
  const page = Math.max(1, filters?.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["NOT archived", "staff_type = 'volunteer'"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.training_status) {
    whereClauses.push(`training_status = $${paramIdx}`);
    params.push(filters.training_status);
    paramIdx++;
  }

  if (filters?.active !== undefined) {
    whereClauses.push(`active = $${paramIdx}`);
    params.push(filters.active);
    paramIdx++;
  }

  if (filters?.department) {
    whereClauses.push(`department = $${paramIdx}`);
    params.push(filters.department);
    paramIdx++;
  }

  if (filters?.skills && filters.skills.length > 0) {
    whereClauses.push(`skills && $${paramIdx}`);
    params.push(filters.skills);
    paramIdx++;
  }

  const whereStr = whereClauses.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*) FROM staff WHERE ${whereStr}`,
    params
  );
  const total = parseInt(countResult.rows[0].count as string, 10);

  const dataResult = await query(
    `SELECT * FROM staff WHERE ${whereStr} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  return {
    data: dataResult.rows.map(rowToVolunteerRecord),
    total,
    page,
    limit,
  };
}

/**
 * Returns the skills for a specific volunteer.
 */
export async function getVolunteerSkills(volunteerId: string): Promise<ReadonlyArray<string> | null> {
  const result = await query(
    "SELECT skills FROM staff WHERE id = $1 AND staff_type = 'volunteer' AND NOT archived",
    [volunteerId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return (result.rows[0].skills as string[]) ?? [];
}

/**
 * Updates the training status for a volunteer.
 * Returns the updated record or null if not found or invalid status.
 */
export async function updateTrainingStatus(
  volunteerId: string,
  status: string,
  client?: PoolClient
): Promise<VolunteerRecord | null> {
  if (!VALID_TRAINING_STATUSES.has(status)) {
    throw new Error(`Invalid training status: "${status}". Must be one of: ${[...VALID_TRAINING_STATUSES].join(", ")}`);
  }

  const sql = `
    UPDATE staff
    SET training_status = $1, updated_at = now()
    WHERE id = $2 AND staff_type = 'volunteer' AND NOT archived
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [status, volunteerId])
    : await query(sql, [status, volunteerId]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToVolunteerRecord(result.rows[0]);
}

/**
 * Finds volunteers whose skills match a shift's required_skills.
 * Returns volunteers sorted by number of matching skills (descending).
 */
export async function matchVolunteersToShift(shiftId: string): Promise<ReadonlyArray<VolunteerRecord & { readonly matching_skills: ReadonlyArray<string> }>> {
  // First, get the shift's required skills
  const shiftResult = await query(
    "SELECT required_skills FROM shifts WHERE id = $1 AND NOT archived",
    [shiftId]
  );

  if (shiftResult.rows.length === 0) {
    throw new Error(`Shift not found: ${shiftId}`);
  }

  const requiredSkills = (shiftResult.rows[0].required_skills as string[]) ?? [];

  if (requiredSkills.length === 0) {
    // No skills required; return all available active volunteers
    const result = await query(
      `SELECT * FROM staff
       WHERE staff_type = 'volunteer'
         AND NOT archived
         AND active = true
         AND training_status = 'completed'
       ORDER BY name ASC`
    );

    return result.rows.map((row) => ({
      ...rowToVolunteerRecord(row),
      matching_skills: [],
    }));
  }

  // Find volunteers with overlapping skills, sorted by match count
  const result = await query(
    `SELECT *,
            array(SELECT unnest(skills) INTERSECT SELECT unnest($1::text[])) AS matched_skills
     FROM staff
     WHERE staff_type = 'volunteer'
       AND NOT archived
       AND active = true
       AND training_status = 'completed'
       AND skills && $1
     ORDER BY array_length(array(SELECT unnest(skills) INTERSECT SELECT unnest($1::text[])), 1) DESC NULLS LAST`,
    [requiredSkills]
  );

  return result.rows.map((row) => ({
    ...rowToVolunteerRecord(row),
    matching_skills: (row.matched_skills as string[]) ?? [],
  }));
}

/**
 * Assigns a volunteer to a shift.
 * Returns the new assignment or throws if conflict/capacity exceeded.
 */
export async function assignToShift(
  volunteerId: string,
  shiftId: string,
  client?: PoolClient
): Promise<ShiftAssignment> {
  // Verify volunteer exists and is active
  const volSql = "SELECT id FROM staff WHERE id = $1 AND staff_type = 'volunteer' AND NOT archived AND active = true";
  const volResult = client
    ? await client.query(volSql, [volunteerId])
    : await query(volSql, [volunteerId]);

  if (volResult.rows.length === 0) {
    throw new Error(`Active volunteer not found: ${volunteerId}`);
  }

  // Verify shift exists and check capacity
  const shiftSql = "SELECT id, max_volunteers FROM shifts WHERE id = $1 AND NOT archived";
  const shiftResult = client
    ? await client.query(shiftSql, [shiftId])
    : await query(shiftSql, [shiftId]);

  if (shiftResult.rows.length === 0) {
    throw new Error(`Shift not found: ${shiftId}`);
  }

  const maxVolunteers = shiftResult.rows[0].max_volunteers as number;

  // Count current assignments
  const countSql = "SELECT COUNT(*) FROM shift_assignments WHERE shift_id = $1 AND NOT archived AND status != 'cancelled'";
  const countResult = client
    ? await client.query(countSql, [shiftId])
    : await query(countSql, [shiftId]);

  const currentCount = parseInt(countResult.rows[0].count as string, 10);

  if (currentCount >= maxVolunteers) {
    throw new Error(`Shift ${shiftId} is at maximum capacity (${maxVolunteers})`);
  }

  // Create assignment
  const insertSql = `
    INSERT INTO shift_assignments (shift_id, volunteer_id, status)
    VALUES ($1, $2, 'assigned')
    ON CONFLICT (shift_id, volunteer_id) DO UPDATE SET
      status = 'assigned',
      archived = false,
      updated_at = now()
    RETURNING *
  `;

  const result = client
    ? await client.query(insertSql, [shiftId, volunteerId])
    : await query(insertSql, [shiftId, volunteerId]);

  return rowToShiftAssignment(result.rows[0]);
}

/**
 * Returns the coverage analysis for a shift.
 */
export async function getShiftCoverage(shiftId: string): Promise<ShiftCoverage | null> {
  const shiftResult = await query(
    "SELECT id, name, min_volunteers, max_volunteers FROM shifts WHERE id = $1 AND NOT archived",
    [shiftId]
  );

  if (shiftResult.rows.length === 0) {
    return null;
  }

  const shift = shiftResult.rows[0];
  const minVolunteers = shift.min_volunteers as number;
  const maxVolunteers = shift.max_volunteers as number;

  const assignedResult = await query(
    "SELECT COUNT(*) FROM shift_assignments WHERE shift_id = $1 AND NOT archived AND status != 'cancelled'",
    [shiftId]
  );
  const assignedCount = parseInt(assignedResult.rows[0].count as string, 10);

  const confirmedResult = await query(
    "SELECT COUNT(*) FROM shift_assignments WHERE shift_id = $1 AND NOT archived AND status IN ('confirmed', 'checked_in', 'completed')",
    [shiftId]
  );
  const confirmedCount = parseInt(confirmedResult.rows[0].count as string, 10);

  const coveragePercentage = minVolunteers > 0
    ? Math.min(100, Math.round((assignedCount / minVolunteers) * 100))
    : 100;

  return {
    shift_id: shift.id as string,
    shift_name: shift.name as string,
    min_volunteers: minVolunteers,
    max_volunteers: maxVolunteers,
    assigned_count: assignedCount,
    confirmed_count: confirmedCount,
    is_covered: assignedCount >= minVolunteers,
    coverage_percentage: coveragePercentage,
  };
}

// --- Helpers ---

function rowToVolunteerRecord(row: Record<string, unknown>): VolunteerRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string) ?? null,
    department: (row.department as string) ?? null,
    phone: (row.phone as string) ?? null,
    skills: (row.skills as string[]) ?? [],
    training_status: (row.training_status as string) ?? "pending",
    availability: (row.availability as Record<string, unknown>) ?? {},
    emergency_contact: (row.emergency_contact as string) ?? null,
    languages: (row.languages as string[]) ?? [],
    active: (row.active as boolean) ?? true,
    properties: (row.properties as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function rowToShiftAssignment(row: Record<string, unknown>): ShiftAssignment {
  return {
    id: row.id as string,
    shift_id: row.shift_id as string,
    volunteer_id: row.volunteer_id as string,
    status: row.status as string,
    assigned_at: row.assigned_at instanceof Date
      ? row.assigned_at.toISOString()
      : (row.assigned_at as string) ?? new Date().toISOString(),
    confirmed_at: row.confirmed_at instanceof Date
      ? row.confirmed_at.toISOString()
      : (row.confirmed_at as string) ?? null,
    checked_in_at: row.checked_in_at instanceof Date
      ? row.checked_in_at.toISOString()
      : (row.checked_in_at as string) ?? null,
    notes: (row.notes as string) ?? null,
  };
}

// Exported for testing
export { rowToVolunteerRecord, rowToShiftAssignment, VALID_TRAINING_STATUSES };
