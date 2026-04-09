/**
 * Auth Middleware
 *
 * Four authentication methods — Firebase OAuth, API keys, token-scoped,
 * MCP delegation — all resolving to the same AuthenticatedUser + UserRole pair.
 * Every request is tagged with an ActorType for audit.
 */

import type { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS, TTL_DOMAIN_MS } from "../cache";
import { query } from "../db/client";
import type { Role } from "../ontology/types";

// --- Types ---

export interface AuthenticatedUser {
  readonly uid: string;
  readonly email: string;
  readonly name?: string;
}

export interface UserRole {
  readonly roleKey: string;
  readonly roleName: string;
  readonly priority: number;
}

export type ActorType = "human" | "api_client" | "external_token" | "ai_agent";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      role?: UserRole;
      actorType?: ActorType;
    }
  }
}

// --- Cache keys ---

const ROLES_CACHE_KEY = "roles:all";
const USER_ROLE_PREFIX = "user_role:";

// --- Dev bypass role set ---

const ALLOWED_DEV_ROLES: Readonly<Record<string, { name: string; priority: number }>> = {
  director: { name: "Director", priority: 0 },
  coordinator: { name: "Coordinator", priority: 10 },
  liaison: { name: "Liaison", priority: 20 },
  volunteer: { name: "Volunteer", priority: 50 },
  viewer: { name: "Viewer", priority: 100 },
};

const VALID_ACTOR_TYPES = new Set<ActorType>(["human", "api_client", "external_token", "ai_agent"]);

// --- Main auth middleware ---

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Check X-API-Key header
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (apiKey) {
      await authenticateApiKey(req, apiKey);
      next();
      return;
    }

    // 2. Check Authorization: Bearer
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next();
      return;
    }

    const token = authHeader.slice(7);

    // 2a. Dev bypass (emulator only)
    if (token === "dev-bypass-token") {
      authenticateDevBypass(req);
      next();
      return;
    }

    // 2b. Try Firebase token
    const firebaseSuccess = await tryFirebaseAuth(req, token);
    if (firebaseSuccess) {
      next();
      return;
    }

    // 2c. Try scoped token
    await tryScopedTokenAuth(req, token);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Auth middleware error", { error: message });
  }

  next();
}

// --- Auth method implementations ---

async function authenticateApiKey(req: Request, rawKey: string): Promise<void> {
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const result = await query(
    `SELECT id, label, email, role_key FROM api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [keyHash]
  );

  if (result.rows.length === 0) return;

  const row = result.rows[0];
  const keyId = row.id as string;

  req.user = {
    uid: `apikey:${keyId}`,
    email: row.email as string,
    name: row.label as string,
  };
  req.actorType = "api_client";

  // Resolve role from the key's role_key
  const roleKey = row.role_key as string;
  const role = await lookupRoleByKey(roleKey);
  if (role) {
    req.role = { roleKey: role.key, roleName: role.name, priority: role.priority };
  }

  // Update last_used_at (fire-and-forget)
  query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [keyId]).catch(() => {});
}

async function tryFirebaseAuth(req: Request, token: string): Promise<boolean> {
  try {
    const decoded = await admin.auth().verifyIdToken(token);

    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      name: decoded.name as string | undefined,
    };

    // Check for MCP delegation
    const mcpHeader = req.headers["x-mcp-delegation"] as string | undefined;
    req.actorType = mcpHeader === "true" ? "ai_agent" : "human";

    return true;
  } catch {
    return false;
  }
}

async function tryScopedTokenAuth(req: Request, token: string): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const result = await query(
    `SELECT id, label, scope, role_key FROM scoped_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );

  if (result.rows.length === 0) return;

  const row = result.rows[0];
  const tokenId = row.id as string;

  req.user = {
    uid: `token:${tokenId}`,
    email: `token:${tokenId}@tokens.internal`,
    name: row.label as string,
  };
  req.actorType = "external_token";

  const roleKey = row.role_key as string;
  const role = await lookupRoleByKey(roleKey);
  if (role) {
    req.role = { roleKey: role.key, roleName: role.name, priority: role.priority };
  }

  // Update last_used_at (fire-and-forget)
  query("UPDATE scoped_tokens SET last_used_at = now() WHERE id = $1", [tokenId]).catch(() => {});
}

function authenticateDevBypass(req: Request): void {
  if (!process.env.FUNCTIONS_EMULATOR) {
    logger.warn("dev-bypass-token rejected — not running in emulator");
    return;
  }

  const devEmail = (req.headers["x-dev-email"] as string) ?? "dev@localhost";
  const devRoleKey = (req.headers["x-dev-role"] as string) ?? "director";
  const devActorType = (req.headers["x-dev-actor-type"] as string) ?? "human";
  const resolvedRole = ALLOWED_DEV_ROLES[devRoleKey] ?? ALLOWED_DEV_ROLES.viewer;

  req.user = { uid: "dev-user", email: devEmail, name: "Dev Admin" };
  req.role = {
    roleKey: devRoleKey in ALLOWED_DEV_ROLES ? devRoleKey : "viewer",
    roleName: resolvedRole.name,
    priority: resolvedRole.priority,
  };
  req.actorType = VALID_ACTOR_TYPES.has(devActorType as ActorType)
    ? (devActorType as ActorType)
    : "human";
}

// --- requireAuth middleware ---

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Provide a valid credential.",
    });
    return;
  }
  next();
}

// --- resolveRole middleware ---

export async function resolveRole(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  // API key and scoped token paths already set req.role
  if (req.role) {
    next();
    return;
  }

  try {
    const userRole = await lookupUserRole(req.user.email);
    if (userRole) {
      req.role = userRole;
    } else {
      req.role = { roleKey: "viewer", roleName: "Viewer", priority: 999 };
      logger.info(`No role found for ${req.user.email}, defaulting to viewer`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to resolve user role", { error: message, email: req.user.email });
    req.role = { roleKey: "viewer", roleName: "Viewer", priority: 999 };
  }

  next();
}

// --- requireRole middleware ---

export function requireRole(maxPriority: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.role) {
      res.status(403).json({
        success: false,
        error: "Role not resolved. Ensure resolveRole middleware runs first.",
      });
      return;
    }

    if (req.role.priority > maxPriority) {
      res.status(403).json({
        success: false,
        error: "Insufficient permissions for this action.",
      });
      return;
    }

    next();
  };
}

// --- Role lookup ---

async function loadAllRoles(): Promise<ReadonlyMap<string, Role>> {
  return cache.getOrLoad(
    ROLES_CACHE_KEY,
    async () => {
      const result = await query("SELECT * FROM roles");
      const roleMap = new Map<string, Role>();

      for (const row of result.rows) {
        const key = row.key as string | undefined;
        if (!key) continue;

        roleMap.set(key, {
          id: row.id as string,
          key,
          name: (row.name as string) ?? key,
          description: (row.description as string) ?? undefined,
          priority: (row.priority as number) ?? 100,
          isOperational: (row.is_operational as boolean) ?? false,
        });
      }

      logger.info(`Loaded ${roleMap.size} roles from Postgres`);
      return roleMap;
    },
    TTL_ONTOLOGY_MS
  );
}

async function lookupRoleByKey(roleKey: string): Promise<Role | undefined> {
  const allRoles = await loadAllRoles();
  return allRoles.get(roleKey);
}

async function lookupUserRole(email: string): Promise<UserRole | null> {
  const cacheKey = `${USER_ROLE_PREFIX}${email}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const result = await query(
          "SELECT role_key FROM users WHERE email = $1 AND active = true LIMIT 1",
          [email]
        );

        if (result.rows.length === 0) return null;

        const roleKey = result.rows[0].role_key as string;
        const role = await lookupRoleByKey(roleKey);
        if (!role) {
          logger.warn(`User ${email} has role key "${roleKey}" but no matching role definition`);
          return null;
        }

        return {
          roleKey: role.key,
          roleName: role.name,
          priority: role.priority,
        };
      } catch (err) {
        logger.error("Failed to look up user role", { error: err, email });
        return null;
      }
    },
    TTL_DOMAIN_MS
  );
}
