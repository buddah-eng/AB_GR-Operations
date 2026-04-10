/**
 * Audit Context
 *
 * Wraps database operations with actor context for the Postgres audit triggers.
 * Sets session-level variables (SET LOCAL) so triggers can read who made the change.
 * Every API write uses withAuditContext() to ensure full traceability.
 */

import * as crypto from "crypto";
import type { PoolClient } from "pg";
import type { Request } from "express";
import { query, withTransaction } from "../db/client";
import type { ActorType } from "../auth/middleware";

export interface AuditContext {
  readonly actorId: string;
  readonly actorType: ActorType | "system";
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly changeSet: string;
}

/**
 * Creates an AuditContext from request data.
 */
export function createAuditContext(
  actorId: string,
  actorType: ActorType | "system",
  ipAddress?: string,
  sessionId?: string
): AuditContext {
  return {
    actorId,
    actorType,
    sessionId,
    ipAddress,
    changeSet: crypto.randomUUID(),
  };
}

/**
 * Sets Postgres session-level variables for audit triggers.
 * Must be called within a transaction (SET LOCAL scopes to the transaction).
 */
export async function setAuditSessionVars(
  client: PoolClient,
  ctx: AuditContext
): Promise<void> {
  await client.query(`SET LOCAL app.actor_id = '${escapeSingleQuote(ctx.actorId)}'`);
  await client.query(`SET LOCAL app.actor_type = '${escapeSingleQuote(ctx.actorType)}'`);
  await client.query(`SET LOCAL app.change_set = '${escapeSingleQuote(ctx.changeSet)}'`);
  if (ctx.sessionId) {
    await client.query(`SET LOCAL app.session_id = '${escapeSingleQuote(ctx.sessionId)}'`);
  }
  if (ctx.ipAddress) {
    await client.query(`SET LOCAL app.ip_address = '${escapeSingleQuote(ctx.ipAddress)}'`);
  }
}

/**
 * Logs an API audit claim for rogue-actor detection.
 * Each API write records its change_set UUID so we can detect
 * direct DB access that bypassed the API.
 */
export async function logAuditClaim(
  ctx: AuditContext,
  endpoint: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO api_audit_claims (change_set, actor_id, actor_type, endpoint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (change_set) DO NOTHING`,
      [ctx.changeSet, ctx.actorId, ctx.actorType, endpoint]
    );
  } catch {
    // Non-critical — don't block the request if claim logging fails
  }
}

/**
 * Creates an AuditContext from an Express request.
 */
export function auditContextFromRequest(req: Request): AuditContext {
  return createAuditContext(
    req.user?.uid ?? "anonymous",
    req.actorType ?? "human",
    req.ip ?? undefined,
    undefined
  );
}

/**
 * Executes a callback within a Postgres transaction with audit session variables set.
 * The audit triggers will read these variables to populate actor context in audit logs.
 */
export async function withAuditContext<T>(
  ctx: AuditContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withTransaction(async (client) => {
    await setAuditSessionVars(client, ctx);
    return fn(client);
  });
}

function escapeSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}
