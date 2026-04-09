/**
 * Volunteer Service
 *
 * Manages volunteers (staff with staff_type='volunteer'),
 * shift matching, and shift assignment operations.
 */

import { query, withTransaction } from "../db/client";
import * as logger from "firebase-functions/logger";
import type { Staff } from "./staff";

// --- Types ---

export interface Shift {
  readonly [key: string]: unknown;
  id: string;
  name: string;
  venue_id: string | null;
  start_time: string;
  end_time: string;
  required_count: number;
  required_skills: string[] | null;
  status: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface ShiftAssignment {
  readonly [key: string]: unknown;
  id: string;
  shift_id: string;
  staff_id: string;
  status: string;
  created_at: string;
}

export interface ShiftCoverage {
  readonly [key: string]: unknown;
  assigned: number;
  required: number;
  coverage_pct: number;
}

export interface VolunteerFilters {
  readonly [key: string]: unknown;
  department?: string;
  role_key?: string;
  training_status?: string;
}

// --- Service functions ---

/**
 * List all volunteers (staff_type='volunteer') with optional filters.
 */
export async function listVolunteers(filters: VolunteerFilters = {}): Promise<Staff[]> {
  const conditions: string[] = ["staff_type = 'volunteer'", "archived = false"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.department !== undefined) {
    conditions.push(`department = $${paramIndex++}`);
    params.push(filters.department);
  }

  if (filters.role_key !== undefined) {
    conditions.push(`role_key = $${paramIndex++}`);
    params.push(filters.role_key);
  }

  if (filters.training_status !== undefined) {
    conditions.push(`training_status = $${paramIndex++}`);
    params.push(filters.training_status);
  }

  const sql = `SELECT * FROM staff WHERE ${conditions.join(" AND ")} ORDER BY name ASC`;

  logger.info("Listing volunteers", { filters });
  const result = await query<Staff>(sql, params);
  return result.rows;
}

/**
 * Get the skills array for a specific volunteer.
 * Returns null if the volunteer is not found.
 */
export async function getVolunteerSkills(volunteerId: string): Promise<string[] | null> {
  const result = await query<Pick<Staff, "skills" | "staff_type">>(
    "SELECT skills, staff_type FROM staff WHERE id = $1 AND staff_type = 'volunteer'",
    [volunteerId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].skills ?? [];
}

/**
 * Update the training_status of a volunteer.
 */
export async function updateTrainingStatus(
  volunteerId: string,
  status: "pending" | "in_progress" | "completed"
): Promise<Staff | null> {
  const result = await query<Staff>(
    `UPDATE staff
     SET training_status = $1, updated_at = now()
     WHERE id = $2 AND staff_type = 'volunteer'
     RETURNING *`,
    [status, volunteerId]
  );

  if (result.rows.length === 0) {
    logger.warn("updateTrainingStatus: volunteer not found", { volunteerId, status });
    return null;
  }

  logger.info("Training status updated", { volunteerId, status });
  return result.rows[0];
}

/**
 * Find volunteers whose skills match a shift's required_skills
 * and who are not already assigned to an overlapping shift.
 */
export async function matchVolunteersToShift(shiftId: string): Promise<Staff[]> {
  const shiftResult = await query<Shift>(
    "SELECT * FROM shifts WHERE id = $1",
    [shiftId]
  );

  if (shiftResult.rows.length === 0) {
    logger.warn("matchVolunteersToShift: shift not found", { shiftId });
    return [];
  }

  const shift = shiftResult.rows[0];
  const requiredSkills = shift.required_skills ?? [];

  // Find volunteers with matching skills who are not assigned to overlapping shifts
  const sql = `
    SELECT s.* FROM staff s
    WHERE s.staff_type = 'volunteer'
      AND s.archived = false
      AND s.training_status = 'completed'
      ${requiredSkills.length > 0 ? "AND s.skills @> $2::text[]" : ""}
      AND s.id NOT IN (
        SELECT sa.staff_id FROM shift_assignments sa
        JOIN shifts sh ON sh.id = sa.shift_id
        WHERE sa.status NOT IN ('no_show', 'swapped')
          AND sh.start_time < $${requiredSkills.length > 0 ? 3 : 2}
          AND sh.end_time > $${requiredSkills.length > 0 ? 4 : 3}
      )
    ORDER BY s.name ASC
  `;

  const params: unknown[] = [shiftId];
  if (requiredSkills.length > 0) {
    params.push(requiredSkills);
  }
  params.push(shift.end_time, shift.start_time);

  const result = await query<Staff>(sql, params);
  return result.rows;
}

/**
 * Assign a volunteer to a shift. Updates shift status to
 * 'partially_filled' or 'filled' based on coverage.
 */
export async function assignToShift(
  volunteerId: string,
  shiftId: string
): Promise<ShiftAssignment> {
  return withTransaction(async (client) => {
    // Insert the assignment
    const assignResult = await client.query<ShiftAssignment>(
      `INSERT INTO shift_assignments (shift_id, staff_id, status)
       VALUES ($1, $2, 'assigned')
       RETURNING *`,
      [shiftId, volunteerId]
    );

    const assignment = assignResult.rows[0];

    // Count current assignments for this shift
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM shift_assignments
       WHERE shift_id = $1 AND status NOT IN ('no_show', 'swapped')`,
      [shiftId]
    );

    const assignedCount = parseInt(countResult.rows[0].count, 10);

    // Get the required count
    const shiftResult = await client.query<Pick<Shift, "required_count">>(
      "SELECT required_count FROM shifts WHERE id = $1",
      [shiftId]
    );

    const requiredCount = shiftResult.rows[0].required_count;

    // Update shift status based on coverage
    const newStatus = assignedCount >= requiredCount ? "filled" : "partially_filled";
    await client.query(
      "UPDATE shifts SET status = $1, updated_at = now() WHERE id = $2",
      [newStatus, shiftId]
    );

    logger.info("Volunteer assigned to shift", {
      volunteerId,
      shiftId,
      assignedCount,
      requiredCount,
      newStatus,
    });

    return assignment;
  });
}

/**
 * Get coverage information for a shift.
 */
export async function getShiftCoverage(shiftId: string): Promise<ShiftCoverage> {
  const shiftResult = await query<Pick<Shift, "required_count">>(
    "SELECT required_count FROM shifts WHERE id = $1",
    [shiftId]
  );

  if (shiftResult.rows.length === 0) {
    throw new Error(`Shift not found: ${shiftId}`);
  }

  const required = shiftResult.rows[0].required_count;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM shift_assignments
     WHERE shift_id = $1 AND status NOT IN ('no_show', 'swapped')`,
    [shiftId]
  );

  const assigned = parseInt(countResult.rows[0].count, 10);
  const coverage_pct = required > 0 ? Math.round((assigned / required) * 100) : 100;

  return { assigned, required, coverage_pct };
}
