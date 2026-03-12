/**
 * Role-Based Access Control Engine
 *
 * Reads Permission and DataScope records from Notion and evaluates
 * access checks at runtime. All data is cached with a 5-minute TTL.
 */

import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS } from "../notion/cache";
import { queryDatabase, pageToFlatObject } from "../notion/client";
import { getOntologyDatabaseId } from "../notion/databases";
import type { Permission, DataScope } from "../ontology/types";
import type { EventAction } from "../events/types";

// --- Cache keys ---

const PERMISSIONS_CACHE_KEY = "rbac:permissions";
const DATA_SCOPES_CACHE_KEY = "rbac:data_scopes";

// --- Action mapping ---

type CrudAction = "view" | "create" | "edit" | "delete";

/**
 * Maps an EventAction (or generic string) to a CRUD action.
 */
function toCrudAction(action: EventAction | string): CrudAction {
  switch (action) {
    case "created":
    case "create":
      return "create";
    case "updated":
    case "update":
    case "edit":
      return "edit";
    case "deleted":
    case "delete":
      return "delete";
    default:
      return "view";
  }
}

// --- Permission loading ---

async function loadPermissions(): Promise<ReadonlyArray<Permission>> {
  return cache.getOrLoad(
    PERMISSIONS_CACHE_KEY,
    async () => {
      const dbId = getOntologyDatabaseId("permissions");
      const rows = await queryDatabase(dbId);
      return rows
        .map((row) => {
          const flat = pageToFlatObject(row as Record<string, unknown>);
          const meta = (row as Record<string, unknown>);
          return parsePermission(meta.id as string, flat);
        })
        .filter((p): p is Permission => p !== null);
    },
    TTL_ONTOLOGY_MS
  );
}

async function loadDataScopes(): Promise<ReadonlyArray<DataScope>> {
  return cache.getOrLoad(
    DATA_SCOPES_CACHE_KEY,
    async () => {
      const dbId = getOntologyDatabaseId("data_scopes");
      const rows = await queryDatabase(dbId);
      return rows
        .map((row) => {
          const flat = pageToFlatObject(row as Record<string, unknown>);
          const meta = (row as Record<string, unknown>);
          return parseDataScope(meta.id as string, flat);
        })
        .filter((d): d is DataScope => d !== null);
    },
    TTL_ONTOLOGY_MS
  );
}

// --- RoleEngine ---

export class RoleEngine {
  private permissionsPromise: Promise<ReadonlyArray<Permission>> | null = null;
  private dataScopesPromise: Promise<ReadonlyArray<DataScope>> | null = null;

  /**
   * Returns all permissions (cached after first load within the request lifecycle).
   */
  private async getPermissions(): Promise<ReadonlyArray<Permission>> {
    if (!this.permissionsPromise) {
      this.permissionsPromise = loadPermissions();
    }
    return this.permissionsPromise;
  }

  /**
   * Returns all data scopes (cached after first load within the request lifecycle).
   */
  private async getDataScopes(): Promise<ReadonlyArray<DataScope>> {
    if (!this.dataScopesPromise) {
      this.dataScopesPromise = loadDataScopes();
    }
    return this.dataScopesPromise;
  }

  /**
   * Finds the permission record for a role + concept combination.
   */
  private async findPermission(
    roleKey: string,
    conceptKey: string
  ): Promise<Permission | undefined> {
    const permissions = await this.getPermissions();
    return permissions.find(
      (p) => p.roleKey === roleKey && p.conceptKey === conceptKey
    );
  }

  /**
   * Checks whether a role can perform a given action on a concept.
   */
  async canPerformAction(
    roleKey: string,
    conceptKey: string,
    action: EventAction | string
  ): Promise<boolean> {
    const perm = await this.findPermission(roleKey, conceptKey);
    if (!perm) {
      logger.debug(`No permission found for role="${roleKey}" concept="${conceptKey}"`);
      return false;
    }

    const crud = toCrudAction(action);
    switch (crud) {
      case "view":
        return perm.canView;
      case "create":
        return perm.canCreate;
      case "edit":
        return perm.canEdit;
      case "delete":
        return perm.canDelete;
      default:
        return false;
    }
  }

  /**
   * Returns the property keys that a role is allowed to see for a concept.
   * Returns an empty array if no permission record exists (deny by default).
   */
  async getVisibleProperties(
    roleKey: string,
    conceptKey: string
  ): Promise<ReadonlyArray<string>> {
    const perm = await this.findPermission(roleKey, conceptKey);
    if (!perm) return [];
    return perm.visibleProperties;
  }

  /**
   * Returns the property keys that a role is allowed to edit for a concept.
   * Falls back to visibleProperties if editableProperties is not defined.
   */
  async getEditableProperties(
    roleKey: string,
    conceptKey: string
  ): Promise<ReadonlyArray<string>> {
    const perm = await this.findPermission(roleKey, conceptKey);
    if (!perm) return [];
    const editable = perm.editableProperties;
    return (editable && editable.length > 0) ? editable : perm.visibleProperties;
  }

  /**
   * Builds a Notion database filter that restricts query results
   * based on the user's data scope for a concept.
   *
   * Returns undefined if the scope type is "all" (no restriction).
   */
  async buildDataScopeFilter(
    roleKey: string,
    conceptKey: string,
    userId: string
  ): Promise<Record<string, unknown> | undefined> {
    const scopes = await this.getDataScopes();
    const scope = scopes.find(
      (s) => s.roleKey === roleKey && s.conceptKey === conceptKey
    );

    if (!scope || scope.scopeType === "all") {
      return undefined; // No restriction
    }

    switch (scope.scopeType) {
      case "field":
        // Filter to records where a specific field matches a specific value
        if (scope.field && scope.value) {
          return {
            property: scope.field,
            rich_text: { equals: scope.value },
          };
        }
        return undefined;

      case "relation":
        // Filter to records where a relation path points to the current user
        if (scope.relationPath) {
          return {
            property: scope.relationPath,
            relation: { contains: userId },
          };
        }
        return undefined;

      case "department":
        // Filter by the user's department
        if (scope.field) {
          return {
            property: scope.field,
            select: { equals: scope.value ?? "" },
          };
        }
        return undefined;

      default:
        return undefined;
    }
  }

  /**
   * Strips properties from a record that the role is not allowed to see.
   * Returns a new object with only the visible properties.
   */
  async filterRecord(
    roleKey: string,
    conceptKey: string,
    record: Readonly<Record<string, unknown>>
  ): Promise<Readonly<Record<string, unknown>>> {
    const visibleProps = await this.getVisibleProperties(roleKey, conceptKey);

    // If no permissions defined, return empty object (deny by default)
    if (visibleProps.length === 0) return {};

    const filtered = Object.fromEntries(
      Object.entries(record).filter(([key]) => visibleProps.includes(key))
    );

    return filtered;
  }

  /**
   * Filters a write payload to only include properties the role can edit.
   */
  async filterWritePayload(
    roleKey: string,
    conceptKey: string,
    payload: Readonly<Record<string, unknown>>
  ): Promise<Readonly<Record<string, unknown>>> {
    const editableProps = await this.getEditableProperties(roleKey, conceptKey);

    if (editableProps.length === 0) return {};

    return Object.fromEntries(
      Object.entries(payload).filter(([key]) => editableProps.includes(key))
    );
  }

  /**
   * Forces a reload of permission and data scope caches.
   */
  reload(): void {
    this.permissionsPromise = null;
    this.dataScopesPromise = null;
    cache.invalidate(PERMISSIONS_CACHE_KEY);
    cache.invalidate(DATA_SCOPES_CACHE_KEY);
  }
}

// --- Singleton ---

export const roleEngine = new RoleEngine();

// --- Parsers ---

function parsePermission(
  id: string,
  flat: Readonly<Record<string, unknown>>
): Permission | null {
  const roleKey = flat["Role Key"] as string | undefined;
  const conceptKey = flat["Concept Key"] as string | undefined;
  if (!roleKey || !conceptKey) {
    logger.warn("Skipping permission row with missing Role Key or Concept Key", { id });
    return null;
  }

  return {
    id,
    roleKey,
    conceptKey,
    canView: (flat["Can View"] as boolean) ?? false,
    canEdit: (flat["Can Edit"] as boolean) ?? false,
    canCreate: (flat["Can Create"] as boolean) ?? false,
    canDelete: (flat["Can Delete"] as boolean) ?? false,
    visibleProperties: parseStringArray(flat["Visible Properties"]),
    editableProperties: parseStringArray(flat["Editable Properties"]) ?? undefined,
  };
}

function parseDataScope(
  id: string,
  flat: Readonly<Record<string, unknown>>
): DataScope | null {
  const roleKey = flat["Role Key"] as string | undefined;
  const conceptKey = flat["Concept Key"] as string | undefined;
  if (!roleKey || !conceptKey) {
    logger.warn("Skipping data scope row with missing Role Key or Concept Key", { id });
    return null;
  }

  return {
    id,
    roleKey,
    conceptKey,
    scopeType: (flat["Scope Type"] as DataScope["scopeType"]) ?? "all",
    relationPath: (flat["Relation Path"] as string) ?? undefined,
    field: (flat["Field"] as string) ?? undefined,
    value: (flat["Value"] as string) ?? undefined,
  };
}

function parseStringArray(val: unknown): ReadonlyArray<string> {
  if (Array.isArray(val)) {
    return val.filter((v): v is string => typeof v === "string");
  }
  if (typeof val === "string" && val.length > 0) {
    return val.split(",").map((s) => s.trim());
  }
  return [];
}
