/**
 * Seed Helpers
 *
 * Reusable functions for inserting test data into a real Postgres database.
 * Each returns the inserted row's UUID. All use parameterized queries.
 */

import type { Pool } from "pg";

export async function seedRole(
  pool: Pool,
  key: string,
  name: string,
  priority: number,
  isOperational = false
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO roles (key, name, priority, is_operational)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [key, name, priority, isOperational]
  );
  return result.rows[0].id;
}

export async function seedUser(
  pool: Pool,
  email: string,
  roleKey: string,
  name?: string,
  department?: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO users (email, name, role_key, department)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, name ?? email.split("@")[0], roleKey, department]
  );
  return result.rows[0].id;
}

export async function seedPermission(
  pool: Pool,
  roleKey: string,
  conceptKey: string,
  overrides: {
    canView?: boolean;
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    visibleProperties?: string[];
    editableProperties?: string[];
  } = {}
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      roleKey,
      conceptKey,
      overrides.canView ?? false,
      overrides.canCreate ?? false,
      overrides.canEdit ?? false,
      overrides.canDelete ?? false,
      overrides.visibleProperties ?? [],
      overrides.editableProperties ?? null,
    ]
  );
  return result.rows[0].id;
}

export async function seedConcept(
  pool: Pool,
  key: string,
  name: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ontology_concepts (key, name, plural_name, extends, icon, description, is_registry, is_config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      key,
      name,
      overrides.pluralName ?? `${name}s`,
      overrides.extends ?? null,
      overrides.icon ?? null,
      overrides.description ?? null,
      overrides.isRegistry ?? false,
      overrides.isConfig ?? false,
    ]
  );
  return result.rows[0].id;
}

export async function seedProperty(
  pool: Pool,
  conceptKey: string,
  key: string,
  type = "text",
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      conceptKey,
      key,
      overrides.label ?? key,
      type,
      overrides.required ?? false,
      overrides.sortOrder ?? 0,
    ]
  );
  return result.rows[0].id;
}

export async function seedGuest(
  pool: Pool,
  name: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO guests (name, type, department, status, company, properties, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      name,
      overrides.type ?? null,
      overrides.department ?? null,
      overrides.status ?? "draft",
      overrides.company ?? null,
      JSON.stringify(overrides.properties ?? {}),
      overrides.createdBy ?? null,
    ]
  );
  return result.rows[0].id;
}

export async function seedStaff(
  pool: Pool,
  name: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO staff (name, email, role_key, department, properties)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      name,
      overrides.email ?? null,
      overrides.roleKey ?? null,
      overrides.department ?? null,
      JSON.stringify(overrides.properties ?? {}),
    ]
  );
  return result.rows[0].id;
}

export async function seedPairing(
  pool: Pool,
  guestId: string,
  staffId: string,
  role: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO pairings (guest_id, staff_id, role) VALUES ($1, $2, $3) RETURNING id`,
    [guestId, staffId, role]
  );
  return result.rows[0].id;
}
