/**
 * Role-Based Access Control Engine
 *
 * Reads Permission and DataScope records from Postgres and evaluates
 * access checks at runtime. All data is cached with a 5-minute TTL.
 * Deny by default: missing permission row = no access.
 */

import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS } from "../cache";
import { query } from "../db/client";
import type { Permission, DataScope, ScreenAccess } from "../ontology/types";
import type { EventAction } from "../events/types";

// --- Cache keys ---

const PERMISSIONS_CACHE_KEY = "rbac:permissions";
const DATA_SCOPES_CACHE_KEY = "rbac:data_scopes";
const SCREEN_ACCESS_CACHE_KEY = "rbac:screen_access";

// --- Action mapping ---

type CrudAction = "view" | "create" | "edit" | "delete";

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
      const result = await query("SELECT * FROM permissions");
      return result.rows
        .map(parsePermission)
        .filter((p): p is Permission => p !== null);
    },
    TTL_ONTOLOGY_MS
  );
}

async function loadDataScopes(): Promise<ReadonlyArray<DataScope>> {
  return cache.getOrLoad(
    DATA_SCOPES_CACHE_KEY,
    async () => {
      const result = await query("SELECT * FROM data_scopes");
      return result.rows
        .map(parseDataScope)
        .filter((d): d is DataScope => d !== null);
    },
    TTL_ONTOLOGY_MS
  );
}

async function loadScreenAccess(): Promise<ReadonlyArray<ScreenAccess>> {
  return cache.getOrLoad(
    SCREEN_ACCESS_CACHE_KEY,
    async () => {
      const result = await query("SELECT * FROM screen_access");
      return result.rows
        .map(parseScreenAccess)
        .filter((s): s is ScreenAccess => s !== null);
    },
    TTL_ONTOLOGY_MS
  );
}

// --- RoleEngine ---

export class RoleEngine {
  private permissionsPromise: Promise<ReadonlyArray<Permission>> | null = null;
  private dataScopesPromise: Promise<ReadonlyArray<DataScope>> | null = null;
  private screenAccessPromise: Promise<ReadonlyArray<ScreenAccess>> | null = null;

  private async getPermissions(): Promise<ReadonlyArray<Permission>> {
    if (!this.permissionsPromise) {
      this.permissionsPromise = loadPermissions();
    }
    return this.permissionsPromise;
  }

  private async getDataScopes(): Promise<ReadonlyArray<DataScope>> {
    if (!this.dataScopesPromise) {
      this.dataScopesPromise = loadDataScopes();
    }
    return this.dataScopesPromise;
  }

  private async findPermission(
    roleKey: string,
    conceptKey: string
  ): Promise<Permission | undefined> {
    const permissions = await this.getPermissions();
    return permissions.find(
      (p) => p.roleKey === roleKey && p.conceptKey === conceptKey
    );
  }

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

  async getVisibleProperties(
    roleKey: string,
    conceptKey: string
  ): Promise<ReadonlyArray<string>> {
    const perm = await this.findPermission(roleKey, conceptKey);
    if (!perm) return [];
    return perm.visibleProperties;
  }

  async getEditableProperties(
    roleKey: string,
    conceptKey: string
  ): Promise<ReadonlyArray<string>> {
    const perm = await this.findPermission(roleKey, conceptKey);
    if (!perm) return [];
    const editable = perm.editableProperties;
    return (editable && editable.length > 0) ? editable : perm.visibleProperties;
  }

  async buildDataScopeFilter(
    roleKey: string,
    conceptKey: string,
    userId: string
  ): Promise<{ column: string; operator: string; value: string } | undefined> {
    const scopes = await this.getDataScopes();
    const scope = scopes.find(
      (s) => s.roleKey === roleKey && s.conceptKey === conceptKey
    );

    if (!scope || scope.scopeType === "all") {
      return undefined;
    }

    switch (scope.scopeType) {
      case "field":
        if (scope.field && scope.value) {
          return { column: scope.field, operator: "=", value: scope.value };
        }
        return undefined;

      case "relation":
        if (scope.relationPath) {
          return { column: scope.relationPath, operator: "=", value: userId };
        }
        return undefined;

      case "department":
        if (scope.field && scope.value) {
          return { column: scope.field, operator: "=", value: scope.value };
        }
        return undefined;

      default:
        return undefined;
    }
  }

  async filterRecord(
    roleKey: string,
    conceptKey: string,
    record: Readonly<Record<string, unknown>>
  ): Promise<Readonly<Record<string, unknown>>> {
    const visibleProps = await this.getVisibleProperties(roleKey, conceptKey);
    if (visibleProps.length === 0) return {};

    return Object.fromEntries(
      Object.entries(record).filter(([key]) => visibleProps.includes(key))
    );
  }

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

  async getScreenAccess(roleKey: string): Promise<ReadonlyArray<ScreenAccess>> {
    if (!this.screenAccessPromise) {
      this.screenAccessPromise = loadScreenAccess();
    }
    const allAccess = await this.screenAccessPromise;
    return allAccess.filter((s) => s.roleKey === roleKey);
  }

  async checkScreenAccess(roleKey: string, pageSlug: string): Promise<boolean> {
    if (!this.screenAccessPromise) {
      this.screenAccessPromise = loadScreenAccess();
    }
    const allAccess = await this.screenAccessPromise;
    const record = allAccess.find(
      (s) => s.roleKey === roleKey && s.pageSlug === pageSlug
    );
    if (!record) return false;
    return record.visible;
  }

  reload(): void {
    this.permissionsPromise = null;
    this.dataScopesPromise = null;
    this.screenAccessPromise = null;
    cache.invalidate(PERMISSIONS_CACHE_KEY);
    cache.invalidate(DATA_SCOPES_CACHE_KEY);
    cache.invalidate(SCREEN_ACCESS_CACHE_KEY);
  }
}

// --- Singleton ---

export const roleEngine = new RoleEngine();

// --- Parsers ---

function parsePermission(row: Record<string, unknown>): Permission | null {
  const roleKey = row.role_key as string | undefined;
  const conceptKey = row.concept_key as string | undefined;
  if (!roleKey || !conceptKey) {
    logger.warn("Skipping permission row with missing role_key or concept_key", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    roleKey,
    conceptKey,
    canView: (row.can_view as boolean) ?? false,
    canEdit: (row.can_edit as boolean) ?? false,
    canCreate: (row.can_create as boolean) ?? false,
    canDelete: (row.can_delete as boolean) ?? false,
    visibleProperties: (row.visible_properties as string[]) ?? [],
    editableProperties: (row.editable_properties as string[]) ?? undefined,
  };
}

function parseDataScope(row: Record<string, unknown>): DataScope | null {
  const roleKey = row.role_key as string | undefined;
  const conceptKey = row.concept_key as string | undefined;
  if (!roleKey || !conceptKey) {
    logger.warn("Skipping data scope row with missing role_key or concept_key", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    roleKey,
    conceptKey,
    scopeType: (row.scope_type as DataScope["scopeType"]) ?? "all",
    relationPath: (row.relation_path as string) ?? undefined,
    field: (row.field as string) ?? undefined,
    value: (row.value as string) ?? undefined,
  };
}

function parseScreenAccess(row: Record<string, unknown>): ScreenAccess | null {
  const roleKey = row.role_key as string | undefined;
  const pageSlug = row.page_slug as string | undefined;
  if (!roleKey || !pageSlug) {
    logger.warn("Skipping screen_access row with missing role_key or page_slug", { id: row.id });
    return null;
  }

  return {
    id: row.id as string,
    roleKey,
    pageSlug,
    visible: (row.visible as boolean) ?? false,
  };
}
