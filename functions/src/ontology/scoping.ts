/**
 * Ontology Scoping Enforcement
 *
 * Enforces org-wide vs department-owned access rules on ontology records.
 * Every ontology record carries `owner_scope` ('org'|'department') and
 * `owner_department`. This module provides:
 *
 * 1. Mutation permission checks (who can write to which records)
 * 2. Query-layer scope filters (who can see which records)
 * 3. Property extension key formatting (dept-scoped properties on org concepts)
 *
 * See docs/prd/core/ontology-scoping.md for the full specification.
 */

// --- Types ---

export type OwnerScope = "org" | "department";

export interface ScopePermissionResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/** Priority threshold: roles with priority <= this value are admin/director level. */
const ADMIN_PRIORITY_THRESHOLD = 10;

/** Separator used for department-scoped property key namespacing. */
const DEPT_KEY_SEPARATOR = "__";

// --- Mutation permission check ---

/**
 * Determines whether a role is allowed to mutate an ontology record
 * based on scope ownership rules.
 *
 * Rules:
 * - Org-wide records (`ownerScope = 'org'`): only roles with priority <= 10 can mutate.
 * - Dept-wide records (`ownerScope = 'department'`): only the owning department's
 *   director or an admin (priority <= 10) can mutate.
 */
export function validateScopePermission(
  roleKey: string,
  rolePriority: number,
  ownerScope: OwnerScope,
  ownerDepartment: string | null,
  userDepartment: string | null
): ScopePermissionResult {
  const isAdmin = rolePriority <= ADMIN_PRIORITY_THRESHOLD;

  if (ownerScope === "org") {
    if (isAdmin) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Role "${roleKey}" (priority ${rolePriority}) cannot mutate org-wide records. Admin-level access (priority <= ${ADMIN_PRIORITY_THRESHOLD}) required.`,
    };
  }

  // ownerScope === "department"
  if (isAdmin) {
    return { allowed: true };
  }

  if (
    userDepartment !== null &&
    ownerDepartment !== null &&
    userDepartment === ownerDepartment
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Role "${roleKey}" in department "${userDepartment ?? "none"}" cannot mutate records owned by department "${ownerDepartment ?? "none"}".`,
  };
}

// --- Query-layer scope filter ---

/**
 * Returns a SQL WHERE clause fragment that filters ontology records
 * by scope visibility for the given role.
 *
 * - Admins (priority <= 10): see everything (returns null, meaning no filter).
 * - Department directors: see org-wide + their department's records.
 * - Others: see org-wide records only.
 */
export function buildScopeFilter(
  roleKey: string,
  rolePriority: number,
  userDepartment: string | null
): string | null {
  const isAdmin = rolePriority <= ADMIN_PRIORITY_THRESHOLD;

  if (isAdmin) {
    return null;
  }

  // Directors (non-admin but with a department) see org-wide + own dept
  if (userDepartment !== null) {
    return `(owner_scope = 'org' OR (owner_scope = 'department' AND owner_department = '${userDepartment}'))`;
  }

  // Everyone else sees org-wide only
  return `(owner_scope = 'org')`;
}

// --- Property extension key formatting ---

/**
 * Formats a property key with a department prefix for internal storage.
 * Department-scoped properties on org-wide concepts use `{dept}__{key}`.
 *
 * Example: formatPropertyKey("skills", "anime") -> "anime__skills"
 */
export function formatPropertyKey(key: string, department: string): string {
  return `${department}${DEPT_KEY_SEPARATOR}${key}`;
}

/**
 * Strips the department prefix from a namespaced property key.
 * Returns the key unchanged when no prefix is present.
 *
 * Example: stripPropertyPrefix("anime__skills") -> "skills"
 * Example: stripPropertyPrefix("skills") -> "skills"
 */
export function stripPropertyPrefix(key: string): string {
  const separatorIndex = key.indexOf(DEPT_KEY_SEPARATOR);
  if (separatorIndex === -1) {
    return key;
  }
  return key.slice(separatorIndex + DEPT_KEY_SEPARATOR.length);
}
