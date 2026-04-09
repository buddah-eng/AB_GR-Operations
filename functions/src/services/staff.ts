/**
 * Staff Service
 *
 * CRUD and query operations for the staff table.
 * Supports filtering by department, role, and staff_type.
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface Staff {
  readonly [key: string]: unknown;
  id: string;
  name: string;
  email: string | null;
  role_key: string | null;
  department: string | null;
  phone: string | null;
  staff_type: string;
  skills: string[] | null;
  training_status: string;
  availability: Record<string, unknown>;
  emergency_contact: string | null;
  languages: string[] | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  archived: boolean;
}

export interface StaffFilters {
  readonly [key: string]: unknown;
  department?: string;
  role_key?: string;
  staff_type?: string;
  archived?: boolean;
}

// --- Service functions ---

/**
 * List staff with optional filters for department, role, and type.
 */
export async function listStaff(filters: StaffFilters = {}): Promise<Staff[]> {
  const conditions: string[] = [];
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

  if (filters.staff_type !== undefined) {
    conditions.push(`staff_type = $${paramIndex++}`);
    params.push(filters.staff_type);
  }

  const showArchived = filters.archived ?? false;
  if (!showArchived) {
    conditions.push("archived = false");
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const sql = `SELECT * FROM staff ${whereClause} ORDER BY name ASC`;

  logger.info("Listing staff", { filters });
  const result = await query<Staff>(sql, params);
  return result.rows;
}

/**
 * Get a single staff member by ID.
 */
export async function getStaffById(id: string): Promise<Staff | null> {
  const result = await query<Staff>(
    "SELECT * FROM staff WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Get all staff in a specific department (non-archived).
 */
export async function getStaffByDepartment(department: string): Promise<Staff[]> {
  const result = await query<Staff>(
    "SELECT * FROM staff WHERE department = $1 AND archived = false ORDER BY name ASC",
    [department]
  );
  return result.rows;
}

/**
 * Assign a role to a staff member by updating role_key.
 */
export async function assignRole(staffId: string, roleKey: string): Promise<Staff | null> {
  const result = await query<Staff>(
    "UPDATE staff SET role_key = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [roleKey, staffId]
  );

  if (result.rows.length === 0) {
    logger.warn("assignRole: staff not found", { staffId, roleKey });
    return null;
  }

  logger.info("Role assigned", { staffId, roleKey });
  return result.rows[0];
}
