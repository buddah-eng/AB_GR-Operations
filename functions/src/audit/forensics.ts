/**
 * Audit Forensics Query Service
 *
 * Six forensic query functions for incident investigation, compliance audits,
 * and operational debugging. Each query targets either ontology_audit_log or
 * domain_audit_log. All queries use parameterized SQL to prevent injection.
 */

import { query } from "../db/client";

// --- Types ---

export type AuditLogTable = "ontology_audit_log" | "domain_audit_log";

export interface AuditRow {
  readonly id: string;
  readonly change_set: string;
  readonly actor_id: string;
  readonly actor_type: string;
  readonly action: string;
  readonly table_name: string;
  readonly record_id: string;
  readonly old_data: Record<string, unknown> | null;
  readonly new_data: Record<string, unknown> | null;
  readonly ip_address: string | null;
  readonly session_id: string | null;
  readonly created_at: string;
}

export interface ActorActivity {
  readonly actor_id: string;
  readonly actor_type: string;
  readonly mutations: number;
}

export interface PaginationOptions {
  readonly page?: number;
  readonly limit?: number;
}

// --- Helpers ---

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function resolvePagination(options?: PaginationOptions): {
  readonly limit: number;
  readonly offset: number;
} {
  const page = Math.max(1, options?.page ?? DEFAULT_PAGE);
  const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;
  return { limit, offset };
}

function validateLogTable(table: AuditLogTable): string {
  const allowed: ReadonlySet<string> = new Set([
    "ontology_audit_log",
    "domain_audit_log",
  ]);
  if (!allowed.has(table)) {
    throw new Error(`Invalid audit log table: ${table}`);
  }
  return table;
}

// --- Query 1: What did user X change between time A and B? ---

export async function queryByActorAndTimeRange(
  actorId: string,
  startTime: string,
  endTime: string,
  options?: PaginationOptions & { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<AuditRow>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const { limit, offset } = resolvePagination(options);

  const result = await query(
    `SELECT id, change_set, actor_id, actor_type, action,
            table_name, record_id, old_data, new_data,
            ip_address, session_id, created_at
     FROM ${table}
     WHERE actor_id = $1
       AND created_at >= $2
       AND created_at <= $3
     ORDER BY created_at
     LIMIT $4 OFFSET $5`,
    [actorId, startTime, endTime, limit, offset]
  );

  return result.rows as unknown as ReadonlyArray<AuditRow>;
}

// --- Query 2: All changes to table X in last N days ---

export async function queryByTableRecent(
  tableName: string,
  days: number,
  options?: PaginationOptions & { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<AuditRow>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const { limit, offset } = resolvePagination(options);

  const result = await query(
    `SELECT id, change_set, actor_id, actor_type, action,
            table_name, record_id, old_data, new_data,
            ip_address, session_id, created_at
     FROM ${table}
     WHERE table_name = $1
       AND created_at > now() - make_interval(days => $2)
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [tableName, days, limit, offset]
  );

  return result.rows as unknown as ReadonlyArray<AuditRow>;
}

// --- Query 3: Detect direct DB access (pg_trigger_fallback rows) ---

export async function queryDirectDbAccess(
  hours: number,
  options?: PaginationOptions & { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<AuditRow>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const { limit, offset } = resolvePagination(options);

  const result = await query(
    `SELECT id, change_set, actor_id, actor_type, action,
            table_name, record_id, old_data, new_data,
            ip_address, session_id, created_at
     FROM ${table}
     WHERE actor_id = 'pg_trigger_fallback'
       AND created_at > now() - make_interval(hours => $1)
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [hours, limit, offset]
  );

  return result.rows as unknown as ReadonlyArray<AuditRow>;
}

// --- Query 4: Expand a change set ---

export async function queryChangeSet(
  changeSetId: string,
  options?: PaginationOptions & { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<AuditRow>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const { limit, offset } = resolvePagination(options);

  const result = await query(
    `SELECT id, change_set, actor_id, actor_type, action,
            table_name, record_id, old_data, new_data,
            ip_address, session_id, created_at
     FROM ${table}
     WHERE change_set = $1
     ORDER BY created_at
     LIMIT $2 OFFSET $3`,
    [changeSetId, limit, offset]
  );

  return result.rows as unknown as ReadonlyArray<AuditRow>;
}

// --- Query 5: Most active actors in last N hours ---

export async function queryMostActiveActors(
  hours: number,
  limit: number = 20,
  options?: { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<ActorActivity>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const result = await query(
    `SELECT actor_id, actor_type, count(*)::int AS mutations
     FROM ${table}
     WHERE created_at > now() - make_interval(hours => $1)
     GROUP BY actor_id, actor_type
     ORDER BY mutations DESC
     LIMIT $2`,
    [hours, clampedLimit]
  );

  return result.rows as unknown as ReadonlyArray<ActorActivity>;
}

// --- Query 6: Deleted records recovery ---

export async function queryDeletedRecords(
  tableName: string,
  days: number,
  options?: PaginationOptions & { readonly logTable?: AuditLogTable }
): Promise<ReadonlyArray<AuditRow>> {
  const table = validateLogTable(options?.logTable ?? "ontology_audit_log");
  const { limit, offset } = resolvePagination(options);

  const result = await query(
    `SELECT id, change_set, actor_id, actor_type, action,
            table_name, record_id, old_data, new_data,
            ip_address, session_id, created_at
     FROM ${table}
     WHERE action = 'DELETE'
       AND table_name = $1
       AND created_at > now() - make_interval(days => $2)
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [tableName, days, limit, offset]
  );

  return result.rows as unknown as ReadonlyArray<AuditRow>;
}
