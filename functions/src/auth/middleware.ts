/**
 * Firebase Auth Middleware
 *
 * Express middleware that verifies Firebase ID tokens from the Authorization
 * header, attaches the decoded user to the request, and resolves the user's
 * platform role from the Notion Roles/Users database.
 */

import type { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { cache, TTL_ONTOLOGY_MS, TTL_DOMAIN_MS } from "../notion/cache";
import { queryDatabase, pageToFlatObject } from "../notion/client";
import { getOntologyDatabaseId } from "../notion/databases";
import type { Role } from "../ontology/types";

// --- Extend Express Request ---

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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      role?: UserRole;
    }
  }
}

// --- Cache keys ---

const ROLES_CACHE_KEY = "roles:all";
const USER_ROLE_PREFIX = "user_role:";

// --- Middleware ---

/**
 * Extracts and verifies a Firebase ID token from the Authorization header.
 * On success, attaches `req.user` with uid, email, and name.
 * On failure, calls next() without setting req.user (does not reject).
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  // Dev-bypass: accept a synthetic token ONLY in the Firebase emulator.
  // The FUNCTIONS_EMULATOR env var is set automatically by `firebase emulators:start`.
  if (token === "dev-bypass-token") {
    if (!process.env.FUNCTIONS_EMULATOR) {
      logger.warn("dev-bypass-token rejected — not running in emulator");
      next();
      return;
    }

    const ALLOWED_DEV_ROLES: Readonly<Record<string, { name: string; priority: number }>> = {
      director: { name: "Director", priority: 0 },
      coordinator: { name: "Coordinator", priority: 10 },
      liaison: { name: "Liaison", priority: 20 },
      viewer: { name: "Viewer", priority: 100 },
    };

    const devEmail = (req.headers["x-dev-email"] as string) ?? "dev@localhost";
    const devRoleKey = (req.headers["x-dev-role"] as string) ?? "director";
    const resolvedRole = ALLOWED_DEV_ROLES[devRoleKey] ?? ALLOWED_DEV_ROLES.viewer;

    req.user = { uid: "dev-user", email: devEmail, name: "Dev Admin" };
    req.role = {
      roleKey: devRoleKey in ALLOWED_DEV_ROLES ? devRoleKey : "viewer",
      roleName: resolvedRole.name,
      priority: resolvedRole.priority,
    };
    next();
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      name: decoded.name as string | undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Auth token verification failed", { error: message });
    // Don't set req.user — downstream middleware can check
  }

  next();
}

/**
 * Returns 401 if no valid user is attached to the request.
 * Must be used after authMiddleware.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Provide a valid Firebase ID token in the Authorization header.",
    });
    return;
  }
  next();
}

/**
 * Resolves the user's platform role from the Notion Users database.
 * Attaches `req.role` with roleKey, roleName, and priority.
 * Must be used after authMiddleware.
 */
export async function resolveRole(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  try {
    const userRole = await lookupUserRole(req.user.email);
    if (userRole) {
      req.role = userRole;
    } else {
      // Default to a "viewer" role if user isn't in the roles database
      req.role = {
        roleKey: "viewer",
        roleName: "Viewer",
        priority: 999,
      };
      logger.info(`No role found for ${req.user.email}, defaulting to viewer`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to resolve user role", { error: message, email: req.user.email });
    // Default to viewer on error so the request isn't blocked entirely
    req.role = {
      roleKey: "viewer",
      roleName: "Viewer",
      priority: 999,
    };
  }

  next();
}

/**
 * Requires a specific role or higher (lower priority number = higher access).
 * Returns a middleware function.
 */
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

/**
 * Loads all roles from the Notion Roles database (cached).
 */
async function loadAllRoles(): Promise<ReadonlyMap<string, Role>> {
  return cache.getOrLoad(
    ROLES_CACHE_KEY,
    async () => {
      const dbId = getOntologyDatabaseId("roles");
      const rows = await queryDatabase(dbId);
      const roleMap = new Map<string, Role>();

      for (const row of rows) {
        const flat = pageToFlatObject(row as Record<string, unknown>);
        const key = flat["Key"] as string | undefined;
        if (!key) continue;

        const role: Role = {
          id: (row as Record<string, unknown>).id as string,
          key,
          name: (flat["Name"] as string) ?? key,
          description: (flat["Description"] as string) ?? undefined,
          priority: (flat["Priority"] as number) ?? 100,
          isOperational: (flat["Is Operational"] as boolean) ?? false,
        };
        roleMap.set(key, role);
      }

      logger.info(`Loaded ${roleMap.size} roles from Notion`);
      return roleMap;
    },
    TTL_ONTOLOGY_MS
  );
}

/**
 * Looks up the role assigned to a user by email.
 * Queries the Notion Users database, which has an email → role key mapping.
 */
async function lookupUserRole(email: string): Promise<UserRole | null> {
  const cacheKey = `${USER_ROLE_PREFIX}${email}`;

  return cache.getOrLoad(
    cacheKey,
    async () => {
      try {
        const usersDbId = getOntologyDatabaseId("users");
        const rows = await queryDatabase(usersDbId, {
          filter: {
            property: "Email",
            email: { equals: email },
          },
          pageSize: 1,
        });

        if (rows.length === 0) return null;

        const flat = pageToFlatObject(rows[0] as Record<string, unknown>);
        const roleKey = flat["Role Key"] as string | undefined;
        if (!roleKey) return null;

        const allRoles = await loadAllRoles();
        const role = allRoles.get(roleKey);
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
