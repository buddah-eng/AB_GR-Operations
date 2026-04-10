/**
 * Staff Service
 *
 * Business logic for staff management: listing, filtering, lookup,
 * and role assignment. Operates on the `staff` table in Postgres.
 * Volunteers are staff records with staff_type = 'volunteer'.
 */

import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface StaffRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly role_key: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly staff_type: string;
  readonly skills: ReadonlyArray<string>;
  readonly training_status: string;
  readonly availability: Record<string, unknown>;
  readonly emergency_contact: string | null;
  readonly languages: ReadonlyArray<string>;
  readonly active: boolean;
  readonly properties: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived: boolean;
}

export interface StaffFilters {
  readonly department?: string;
  readonly staff_type?: string;
  readonly role_key?: string;
  readonly active?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export interface StaffListResult {
  readonly data: ReadonlyArray<StaffRecord>;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// --- Service functions ---

/**
 * Lists staff records with optional filtering and pagination.
 */
export async function listStaff(filters?: StaffFilters): Promise<StaffListResult> {
  const page = Math.max(1, filters?.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["NOT archived"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.department) {
    whereClauses.push(`department = $${paramIdx}`);
    params.push(filters.department);
    paramIdx++;
  }

  if (filters?.staff_type) {
    whereClauses.push(`staff_type = $${paramIdx}`);
    params.push(filters.staff_type);
    paramIdx++;
  }

  if (filters?.role_key) {
    whereClauses.push(`role_key = $${paramIdx}`);
    params.push(filters.role_key);
    paramIdx++;
  }

  if (filters?.active !== undefined) {
    whereClauses.push(`active = $${paramIdx}`);
    params.push(filters.active);
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
    data: dataResult.rows.map(rowToStaffRecord),
    total,
    page,
    limit,
  };
}

/**
 * Returns a single staff record by ID.
 */
export async function getStaffById(id: string): Promise<StaffRecord | null> {
  const result = await query(
    "SELECT * FROM staff WHERE id = $1 AND NOT archived",
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToStaffRecord(result.rows[0]);
}

/**
 * Returns all staff records for a given department.
 */
export async function getStaffByDepartment(department: string): Promise<ReadonlyArray<StaffRecord>> {
  const result = await query(
    "SELECT * FROM staff WHERE department = $1 AND NOT archived ORDER BY name ASC",
    [department]
  );

  return result.rows.map(rowToStaffRecord);
}

/**
 * Assigns a role to a staff member.
 * Returns the updated staff record or null if not found.
 */
export async function assignRole(
  staffId: string,
  roleKey: string,
  client?: PoolClient
): Promise<StaffRecord | null> {
  const sql = `
    UPDATE staff
    SET role_key = $1, updated_at = now()
    WHERE id = $2 AND NOT archived
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [roleKey, staffId])
    : await query(sql, [roleKey, staffId]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToStaffRecord(result.rows[0]);
}

/**
 * Creates a new staff record.
 * Returns the created record.
 */
export async function createStaff(
  data: {
    readonly name: string;
    readonly email?: string;
    readonly role_key?: string;
    readonly department?: string;
    readonly phone?: string;
    readonly staff_type?: string;
    readonly skills?: ReadonlyArray<string>;
    readonly training_status?: string;
    readonly emergency_contact?: string;
    readonly languages?: ReadonlyArray<string>;
    readonly properties?: Record<string, unknown>;
    readonly created_by?: string;
  },
  client?: PoolClient
): Promise<StaffRecord> {
  const sql = `
    INSERT INTO staff (name, email, role_key, department, phone, staff_type, skills,
                       training_status, emergency_contact, languages, properties, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const params = [
    data.name,
    data.email ?? null,
    data.role_key ?? null,
    data.department ?? null,
    data.phone ?? null,
    data.staff_type ?? "staff",
    data.skills ?? [],
    data.training_status ?? "pending",
    data.emergency_contact ?? null,
    data.languages ?? [],
    JSON.stringify(data.properties ?? {}),
    data.created_by ?? null,
  ];

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  return rowToStaffRecord(result.rows[0]);
}

/**
 * Updates an existing staff record.
 * Returns the updated record or null if not found.
 */
export async function updateStaff(
  id: string,
  data: {
    readonly name?: string;
    readonly email?: string;
    readonly role_key?: string;
    readonly department?: string;
    readonly phone?: string;
    readonly staff_type?: string;
    readonly skills?: ReadonlyArray<string>;
    readonly training_status?: string;
    readonly emergency_contact?: string;
    readonly languages?: ReadonlyArray<string>;
    readonly active?: boolean;
    readonly properties?: Record<string, unknown>;
  },
  client?: PoolClient
): Promise<StaffRecord | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields: ReadonlyArray<{ key: string; value: unknown }> = [
    { key: "name", value: data.name },
    { key: "email", value: data.email },
    { key: "role_key", value: data.role_key },
    { key: "department", value: data.department },
    { key: "phone", value: data.phone },
    { key: "staff_type", value: data.staff_type },
    { key: "skills", value: data.skills },
    { key: "training_status", value: data.training_status },
    { key: "emergency_contact", value: data.emergency_contact },
    { key: "languages", value: data.languages },
    { key: "active", value: data.active },
  ];

  for (const field of fields) {
    if (field.value !== undefined) {
      setClauses.push(`${field.key} = $${paramIdx}`);
      params.push(field.value);
      paramIdx++;
    }
  }

  if (data.properties !== undefined) {
    setClauses.push(`properties = properties || $${paramIdx}`);
    params.push(JSON.stringify(data.properties));
    paramIdx++;
  }

  if (setClauses.length === 0) {
    return getStaffById(id);
  }

  setClauses.push("updated_at = now()");
  params.push(id);

  const sql = `UPDATE staff SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`;

  const result = client
    ? await client.query(sql, params)
    : await query(sql, params);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToStaffRecord(result.rows[0]);
}

/**
 * Archives a staff record (soft delete).
 */
export async function archiveStaff(
  id: string,
  client?: PoolClient
): Promise<boolean> {
  const sql = "UPDATE staff SET archived = true, updated_at = now() WHERE id = $1 AND NOT archived";

  const result = client
    ? await client.query(sql, [id])
    : await query(sql, [id]);

  return (result.rowCount ?? 0) > 0;
}

// --- Helpers ---

function rowToStaffRecord(row: Record<string, unknown>): StaffRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string) ?? null,
    role_key: (row.role_key as string) ?? null,
    department: (row.department as string) ?? null,
    phone: (row.phone as string) ?? null,
    staff_type: (row.staff_type as string) ?? "staff",
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
    archived: (row.archived as boolean) ?? false,
  };
}

// Exported for testing
export { rowToStaffRecord };
