/**
 * Ontology Scope Enforcement Service
 *
 * Enforces org-wide vs department-owned scoping rules on every ontology
 * mutation and query. Every ontology table row carries (owner_scope,
 * owner_department). This module validates writes, builds filtered queries,
 * manages property namespacing, and resolves cross-department conflicts.
 *
 * Rules:
 *   - owner_scope='org' + owner_department=NULL => admin-only writes, all-read
 *   - owner_scope='department' + owner_department=X => X's director + admin writes
 *   - A department can extend org-wide concepts with dept-scoped properties
 *   - Two departments can share the same property key via composite uniqueness
 *   - Org-wide property keys block same-key dept properties (409 Conflict)
 */

import { query } from "../db/client";

// --- Constants ---

/** Role priority threshold. Roles with priority <= this value are considered admin. */
export const ADMIN_PRIORITY_THRESHOLD = -1;

/** Role priority for director-level access. */
export const DIRECTOR_PRIORITY = 0;

// --- Types ---

export type OwnerScope = "org" | "department";

export interface ScopePermissionResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface PropertyConflictResult {
  readonly conflict: boolean;
  readonly status?: 409;
  readonly message?: string;
}

export interface VisibleProperty {
  readonly id: string;
  readonly conceptKey: string;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly ownerScope: OwnerScope;
  readonly ownerDepartment: string | null;
  readonly displayLabel?: string;
}

// --- Scope enforcement ---

/**
 * Checks whether a caller with the given role priority and department
 * is allowed to mutate a record with the given owner_scope / owner_department.
 *
 * Rules:
 *   - Org-wide records: only admin (priority <= ADMIN_PRIORITY_THRESHOLD)
 *   - Department records: admin OR the owning department's director (priority <= DIRECTOR_PRIORITY)
 */
export function validateScopePermission(
  rolePriority: number,
  ownerScope: OwnerScope,
  ownerDepartment: string | null,
  callerDepartment: string | null
): ScopePermissionResult {
  const isAdmin = rolePriority <= ADMIN_PRIORITY_THRESHOLD;

  if (ownerScope === "org") {
    if (!isAdmin) {
      return {
        allowed: false,
        reason: "Only administrators can modify org-wide ontology records.",
      };
    }
    return { allowed: true };
  }

  // ownerScope === 'department'
  if (!ownerDepartment) {
    return {
      allowed: false,
      reason: "Department-scoped record is missing owner_department.",
    };
  }

  if (isAdmin) {
    return { allowed: true };
  }

  const isDirectorLevel = rolePriority <= DIRECTOR_PRIORITY;
  if (!isDirectorLevel) {
    return {
      allowed: false,
      reason: "Insufficient permissions for this action.",
    };
  }

  if (callerDepartment !== ownerDepartment) {
    return {
      allowed: false,
      reason: `You can only modify records owned by your department (${callerDepartment ?? "none"}).`,
    };
  }

  return { allowed: true };
}

// --- Query scope filtering ---

/**
 * Builds a SQL WHERE clause fragment that filters ontology records
 * to those visible to the caller. Returns the clause and parameter values.
 *
 * Visibility rules:
 *   - Admin sees everything (no filter)
 *   - Director/other: sees org-wide + own department + granted departments
 */
export function buildScopeFilter(
  rolePriority: number,
  callerDepartment: string | null,
  grantedDepartments?: ReadonlyArray<string>
): { clause: string; params: ReadonlyArray<string> } {
  const isAdmin = rolePriority <= ADMIN_PRIORITY_THRESHOLD;

  if (isAdmin) {
    return { clause: "1=1", params: [] };
  }

  const departments: string[] = [];
  if (callerDepartment) {
    departments.push(callerDepartment);
  }
  if (grantedDepartments) {
    for (const dept of grantedDepartments) {
      if (!departments.includes(dept)) {
        departments.push(dept);
      }
    }
  }

  if (departments.length === 0) {
    return {
      clause: "owner_scope = 'org'",
      params: [],
    };
  }

  const placeholders = departments.map((_, i) => `$${i + 1}`);
  return {
    clause: `(owner_scope = 'org' OR (owner_scope = 'department' AND owner_department IN (${placeholders.join(", ")})))`,
    params: departments,
  };
}

// --- Property key namespacing ---

/**
 * Formats a property key for JSONB storage with department namespace.
 * Convention: "{department}__{key}"
 */
export function formatPropertyKey(key: string, department: string): string {
  return `${department}__${key}`;
}

/**
 * Strips the department namespace prefix from a JSONB property key.
 * Returns the raw key if no prefix is found.
 */
export function stripPropertyPrefix(namespacedKey: string): string {
  const separatorIndex = namespacedKey.indexOf("__");
  if (separatorIndex === -1) {
    return namespacedKey;
  }
  return namespacedKey.slice(separatorIndex + 2);
}

// --- Conflict detection ---

/**
 * Checks whether creating a department-scoped property would conflict
 * with an existing org-wide property on the same concept with the same key.
 *
 * Returns conflict info if an org-wide property with the same key exists.
 */
export async function checkPropertyConflict(
  conceptKey: string,
  propertyKey: string,
  ownerDepartment: string
): Promise<PropertyConflictResult> {
  const result = await query(
    `SELECT id FROM ontology_properties
     WHERE concept_key = $1
       AND key = $2
       AND owner_scope = 'org'
       AND status = 'active'
     LIMIT 1`,
    [conceptKey, propertyKey]
  );

  if (result.rows.length > 0) {
    return {
      conflict: true,
      status: 409,
      message: `Cannot create department property "${propertyKey}" on concept "${conceptKey}": an org-wide property with the same key already exists. Department-scoped properties cannot shadow org-wide definitions.`,
    };
  }

  // No conflict with org-wide — dept-to-dept collisions are allowed
  // via composite uniqueness (concept_key, key, owner_department)
  void ownerDepartment;
  return { conflict: false };
}

// --- Visible properties ---

/**
 * Returns the list of properties visible to a caller on a given concept,
 * filtered by scope rules. Includes:
 *   - All org-wide properties (owner_scope='org')
 *   - Caller's own department properties
 *   - Properties from granted departments (cross-dept RBAC)
 *   - Admin sees all properties with department labels
 */
export async function getVisibleProperties(
  conceptKey: string,
  callerDepartment: string | null,
  rolePriority: number,
  grantedDepartments?: ReadonlyArray<string>
): Promise<ReadonlyArray<VisibleProperty>> {
  const isAdmin = rolePriority <= ADMIN_PRIORITY_THRESHOLD;

  let sql: string;
  let params: unknown[];

  if (isAdmin) {
    sql = `SELECT id, concept_key, key, label, type, owner_scope, owner_department
           FROM ontology_properties
           WHERE concept_key = $1
             AND status = 'active'
           ORDER BY sort_order, key`;
    params = [conceptKey];
  } else {
    const departments: string[] = [];
    if (callerDepartment) {
      departments.push(callerDepartment);
    }
    if (grantedDepartments) {
      for (const dept of grantedDepartments) {
        if (!departments.includes(dept)) {
          departments.push(dept);
        }
      }
    }

    if (departments.length === 0) {
      sql = `SELECT id, concept_key, key, label, type, owner_scope, owner_department
             FROM ontology_properties
             WHERE concept_key = $1
               AND owner_scope = 'org'
               AND status = 'active'
             ORDER BY sort_order, key`;
      params = [conceptKey];
    } else {
      const placeholders = departments.map((_, i) => `$${i + 2}`);
      sql = `SELECT id, concept_key, key, label, type, owner_scope, owner_department
             FROM ontology_properties
             WHERE concept_key = $1
               AND status = 'active'
               AND (owner_scope = 'org' OR (owner_scope = 'department' AND owner_department IN (${placeholders.join(", ")})))
             ORDER BY sort_order, key`;
      params = [conceptKey, ...departments];
    }
  }

  const result = await query(sql, params);

  return result.rows.map((row) => {
    const ownerScope = row.owner_scope as OwnerScope;
    const ownerDept = row.owner_department as string | null;
    const key = row.key as string;
    const label = row.label as string;

    const displayLabel = isAdmin && ownerScope === "department" && ownerDept
      ? `${label} (${ownerDept.toUpperCase()})`
      : label;

    return {
      id: row.id as string,
      conceptKey: row.concept_key as string,
      key,
      label,
      type: row.type as string,
      ownerScope,
      ownerDepartment: ownerDept,
      displayLabel,
    };
  });
}
