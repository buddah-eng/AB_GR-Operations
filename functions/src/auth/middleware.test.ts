import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import { cache } from "../cache";

// --- Mock boundaries ---

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockVerifyIdToken = vi.fn();

vi.mock("firebase-admin", () => ({
  auth: () => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Import after mocks are set up ---

import {
  authMiddleware,
  requireAuth,
  resolveRole,
  requireRole,
} from "./middleware";

// --- Express mock helpers ---

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function makeNext(): NextFunction & { called: boolean } {
  const fn = vi.fn() as unknown as NextFunction & { called: boolean };
  Object.defineProperty(fn, "called", {
    get() {
      return (fn as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    },
  });
  return fn;
}

// --- Data helpers ---

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeApiKeyRow(
  id: string,
  keyHash: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    key_hash: keyHash,
    label: "Test API Key",
    email: "apikey@example.com",
    role_key: "coordinator",
    revoked_at: null,
    expires_at: null,
    ...overrides,
  };
}

function makeScopedTokenRow(
  id: string,
  tokenHash: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    token_hash: tokenHash,
    label: "Test Scoped Token",
    scope: "events:read",
    role_key: "liaison",
    revoked_at: null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

function makeRoleRow(
  key: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const defaults: Record<string, Record<string, unknown>> = {
    director: { id: "r1", key: "director", name: "Director", priority: 0, is_operational: true },
    coordinator: { id: "r2", key: "coordinator", name: "Coordinator", priority: 10, is_operational: true },
    liaison: { id: "r3", key: "liaison", name: "Liaison", priority: 20, is_operational: true },
    volunteer: { id: "r4", key: "volunteer", name: "Volunteer", priority: 50, is_operational: false },
    viewer: { id: "r5", key: "viewer", name: "Viewer", priority: 100, is_operational: false },
  };
  return { ...(defaults[key] ?? { id: `r-${key}`, key, name: key, priority: 100, is_operational: false }), ...overrides };
}

// --- Query mock setup ---

interface QuerySetupOptions {
  readonly apiKeyRows?: ReadonlyArray<Record<string, unknown>>;
  readonly scopedTokenRows?: ReadonlyArray<Record<string, unknown>>;
  readonly roleRows?: ReadonlyArray<Record<string, unknown>>;
  readonly userRows?: ReadonlyArray<Record<string, unknown>>;
}

function setupQueryMock(options: QuerySetupOptions = {}): void {
  const {
    apiKeyRows = [],
    scopedTokenRows = [],
    roleRows = [makeRoleRow("director"), makeRoleRow("coordinator"), makeRoleRow("liaison"), makeRoleRow("volunteer"), makeRoleRow("viewer")],
    userRows = [],
  } = options;

  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM api_keys") && sql.includes("key_hash")) {
      return Promise.resolve({ rows: [...apiKeyRows], rowCount: apiKeyRows.length });
    }
    if (sql.includes("FROM scoped_tokens") && sql.includes("token_hash")) {
      return Promise.resolve({ rows: [...scopedTokenRows], rowCount: scopedTokenRows.length });
    }
    if (sql.includes("FROM roles")) {
      return Promise.resolve({ rows: [...roleRows], rowCount: roleRows.length });
    }
    if (sql.includes("FROM users")) {
      return Promise.resolve({ rows: [...userRows], rowCount: userRows.length });
    }
    // Fire-and-forget updates (last_used_at)
    if (sql.includes("UPDATE")) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// --- Test suites ---

describe("Auth Middleware", () => {
  beforeEach(() => {
    cache.clear();
    mockQuery.mockReset();
    mockVerifyIdToken.mockReset();
    delete process.env.FUNCTIONS_EMULATOR;
  });

  // =========================================================================
  // 7a. Auth Flow Per Method (10 tests)
  // =========================================================================

  describe("7a. Auth Flow Per Method", () => {
    it("Firebase OAuth happy path: valid token sets req.user with actorType = human", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "firebase-uid-123",
        email: "user@example.com",
        name: "Test User",
      });
      setupQueryMock();

      const req = makeReq({
        headers: { authorization: "Bearer valid-firebase-token" },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toEqual({
        uid: "firebase-uid-123",
        email: "user@example.com",
        name: "Test User",
      });
      expect(req.actorType).toBe("human");
    });

    it("Firebase OAuth expired token: req.user not set", async () => {
      mockVerifyIdToken.mockRejectedValue(new Error("Firebase ID token has expired"));
      setupQueryMock();

      const req = makeReq({
        headers: { authorization: "Bearer expired-firebase-token" },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it("API key happy path: valid X-API-Key sets req.user.uid starting with apikey:, actorType = api_client", async () => {
      const rawKey = "test-api-key-secret";
      const keyHash = sha256(rawKey);

      setupQueryMock({
        apiKeyRows: [makeApiKeyRow("key-001", keyHash)],
      });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("apikey:key-001");
      expect(req.user!.uid.startsWith("apikey:")).toBe(true);
      expect(req.actorType).toBe("api_client");
    });

    it("API key revoked: req.user not set", async () => {
      const rawKey = "revoked-key";
      // Query returns no rows for revoked keys (WHERE revoked_at IS NULL filters them out)
      setupQueryMock({ apiKeyRows: [] });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it("API key expired: req.user not set", async () => {
      const rawKey = "expired-key";
      // Query returns no rows for expired keys (WHERE expires_at > now() filters them out)
      setupQueryMock({ apiKeyRows: [] });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it("Token-scoped happy path: req.user.uid starts with token:, actorType = external_token", async () => {
      const rawToken = "scoped-token-secret";
      const tokenHash = sha256(rawToken);

      mockVerifyIdToken.mockRejectedValue(new Error("Not a Firebase token"));
      setupQueryMock({
        scopedTokenRows: [makeScopedTokenRow("tok-001", tokenHash)],
      });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("token:tok-001");
      expect(req.user!.uid.startsWith("token:")).toBe(true);
      expect(req.actorType).toBe("external_token");
    });

    it("Token-scoped expired: req.user not set", async () => {
      const rawToken = "expired-scoped-token";
      mockVerifyIdToken.mockRejectedValue(new Error("Not a Firebase token"));
      // Query returns no rows for expired tokens
      setupQueryMock({ scopedTokenRows: [] });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it("Token-scoped revoked: req.user not set", async () => {
      const rawToken = "revoked-scoped-token";
      mockVerifyIdToken.mockRejectedValue(new Error("Not a Firebase token"));
      // Query returns no rows for revoked tokens
      setupQueryMock({ scopedTokenRows: [] });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it("MCP delegation happy path: Firebase token + X-MCP-Delegation header sets actorType = ai_agent", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "firebase-uid-mcp",
        email: "agent@example.com",
        name: "MCP Agent",
      });
      setupQueryMock();

      const req = makeReq({
        headers: {
          authorization: "Bearer valid-firebase-token",
          "x-mcp-delegation": "true",
        },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("firebase-uid-mcp");
      expect(req.actorType).toBe("ai_agent");
    });

    it("No credentials: req.user not set", async () => {
      setupQueryMock();

      const req = makeReq({ headers: {} });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
      expect(req.actorType).toBeUndefined();
    });
  });

  // =========================================================================
  // 7b. Token Verification (5 tests)
  // =========================================================================

  describe("7b. Token Verification", () => {
    it("Firebase verifyIdToken maps decoded token fields to AuthenticatedUser", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "uid-abc",
        email: "mapped@test.com",
        name: "Mapped User",
        picture: "https://example.com/photo.jpg",
        email_verified: true,
      });
      setupQueryMock();

      const req = makeReq({
        headers: { authorization: "Bearer firebase-token" },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.user).toEqual({
        uid: "uid-abc",
        email: "mapped@test.com",
        name: "Mapped User",
      });
      // Extra Firebase fields should NOT leak into AuthenticatedUser
      expect(req.user).not.toHaveProperty("picture");
      expect(req.user).not.toHaveProperty("email_verified");
    });

    it("API key SHA-256 hash match succeeds", async () => {
      const rawKey = "my-secret-api-key-12345";
      const keyHash = sha256(rawKey);

      setupQueryMock({
        apiKeyRows: [makeApiKeyRow("key-hash-test", keyHash)],
      });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("apikey:key-hash-test");

      // Verify the query was called with the correct hash
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("FROM api_keys")
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual([keyHash]);
    });

    it("API key hash mismatch: no match (query returns empty)", async () => {
      const rawKey = "wrong-api-key";
      // Set up with a key that has a DIFFERENT hash
      setupQueryMock({ apiKeyRows: [] });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.user).toBeUndefined();
    });

    it("Scoped token hash + future expires_at: auth succeeds", async () => {
      const rawToken = "valid-scoped-token";
      const tokenHash = sha256(rawToken);

      mockVerifyIdToken.mockRejectedValue(new Error("Not Firebase"));
      setupQueryMock({
        scopedTokenRows: [
          makeScopedTokenRow("tok-future", tokenHash, {
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
          }),
        ],
      });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("token:tok-future");
    });

    it("Scoped token hash + past expires_at: auth fails (query filters it out)", async () => {
      const rawToken = "expired-scoped-token";
      mockVerifyIdToken.mockRejectedValue(new Error("Not Firebase"));
      // The SQL query WHERE clause filters out expired tokens, so empty rows returned
      setupQueryMock({ scopedTokenRows: [] });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.user).toBeUndefined();
    });
  });

  // =========================================================================
  // 7c. Role Resolution (6 tests)
  // =========================================================================

  describe("7c. Role Resolution", () => {
    it("Firebase user with known role in Postgres: req.role matches", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "uid-role-test",
        email: "coordinator@example.com",
        name: "Coordinator User",
      });

      setupQueryMock({
        userRows: [{ email: "coordinator@example.com", role_key: "coordinator", active: true }],
      });

      const req = makeReq({
        headers: { authorization: "Bearer firebase-token" },
      });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);
      await resolveRole(req, res, makeNext());

      expect(req.role).toBeDefined();
      expect(req.role!.roleKey).toBe("coordinator");
      expect(req.role!.roleName).toBe("Coordinator");
      expect(req.role!.priority).toBe(10);
    });

    it("Firebase user with unknown email: req.role defaults to viewer (priority 999)", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "uid-unknown",
        email: "nobody@example.com",
        name: "Unknown User",
      });

      setupQueryMock({
        userRows: [],
      });

      const req = makeReq({
        headers: { authorization: "Bearer firebase-token" },
      });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);
      await resolveRole(req, res, makeNext());

      expect(req.role).toEqual({
        roleKey: "viewer",
        roleName: "Viewer",
        priority: 999,
      });
    });

    it("API key role: req.role.roleKey matches key record's role_key", async () => {
      const rawKey = "api-key-with-role";
      const keyHash = sha256(rawKey);

      setupQueryMock({
        apiKeyRows: [makeApiKeyRow("key-role", keyHash, { role_key: "coordinator" })],
      });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(req.role).toBeDefined();
      expect(req.role!.roleKey).toBe("coordinator");
      expect(req.role!.roleName).toBe("Coordinator");
      expect(req.role!.priority).toBe(10);
    });

    it("Token-scoped role: req.role.roleKey matches token record's role_key", async () => {
      const rawToken = "scoped-token-with-role";
      const tokenHash = sha256(rawToken);

      mockVerifyIdToken.mockRejectedValue(new Error("Not Firebase"));
      setupQueryMock({
        scopedTokenRows: [makeScopedTokenRow("tok-role", tokenHash, { role_key: "liaison" })],
      });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      const res = makeRes();
      const next = makeNext();

      await authMiddleware(req, res, next);

      expect(req.role).toBeDefined();
      expect(req.role!.roleKey).toBe("liaison");
      expect(req.role!.roleName).toBe("Liaison");
      expect(req.role!.priority).toBe(20);
    });

    it("requireRole(10) with priority 10: passes", () => {
      const middleware = requireRole(10);

      const req = makeReq();
      req.role = { roleKey: "coordinator", roleName: "Coordinator", priority: 10 };

      const res = makeRes();
      const next = makeNext();

      middleware(req, res, next);

      expect(next.called).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it("requireRole(10) with priority 20: returns 403", () => {
      const middleware = requireRole(10);

      const req = makeReq();
      req.role = { roleKey: "liaison", roleName: "Liaison", priority: 20 };

      const res = makeRes();
      const next = makeNext();

      middleware(req, res, next);

      expect(next.called).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: "Insufficient permissions for this action.",
      });
    });
  });

  // =========================================================================
  // 7d. Dev Bypass Isolation (5 tests)
  // =========================================================================

  describe("7d. Dev Bypass Isolation", () => {
    it("dev-bypass-token + FUNCTIONS_EMULATOR=true: auth succeeds with dev headers", async () => {
      process.env.FUNCTIONS_EMULATOR = "true";

      const req = makeReq({
        headers: {
          authorization: "Bearer dev-bypass-token",
          "x-dev-email": "devuser@test.com",
          "x-dev-role": "coordinator",
        },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user!.uid).toBe("dev-user");
      expect(req.user!.email).toBe("devuser@test.com");
      expect(req.role).toBeDefined();
      expect(req.role!.roleKey).toBe("coordinator");
      expect(req.role!.priority).toBe(10);
    });

    it("dev-bypass-token + no FUNCTIONS_EMULATOR: auth fails, warning logged", async () => {
      // FUNCTIONS_EMULATOR is NOT set (deleted in beforeEach)
      const loggerModule = await import("firebase-functions/logger");

      const req = makeReq({
        headers: { authorization: "Bearer dev-bypass-token" },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(next.called).toBe(true);
      expect(req.user).toBeUndefined();
      expect(loggerModule.warn).toHaveBeenCalledWith(
        "dev-bypass-token rejected — not running in emulator"
      );
    });

    it("X-Dev-Actor-Type: ai_agent in emulator: req.actorType = ai_agent", async () => {
      process.env.FUNCTIONS_EMULATOR = "true";

      const req = makeReq({
        headers: {
          authorization: "Bearer dev-bypass-token",
          "x-dev-actor-type": "ai_agent",
        },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.actorType).toBe("ai_agent");
    });

    it("X-Dev-Actor-Type: hacker in emulator: defaults to human", async () => {
      process.env.FUNCTIONS_EMULATOR = "true";

      const req = makeReq({
        headers: {
          authorization: "Bearer dev-bypass-token",
          "x-dev-actor-type": "hacker",
        },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.actorType).toBe("human");
    });

    it("X-Dev-Role: unknown role in emulator: defaults to viewer", async () => {
      process.env.FUNCTIONS_EMULATOR = "true";

      const req = makeReq({
        headers: {
          authorization: "Bearer dev-bypass-token",
          "x-dev-role": "superadmin",
        },
      });
      const next = makeNext();

      await authMiddleware(req, makeRes(), next);

      expect(req.role).toBeDefined();
      expect(req.role!.roleKey).toBe("viewer");
      expect(req.role!.roleName).toBe("Viewer");
      expect(req.role!.priority).toBe(100);
    });
  });

  // =========================================================================
  // 7e. Actor Type Tagging (4 tests)
  // =========================================================================

  describe("7e. Actor Type Tagging", () => {
    it("Firebase OAuth sets actorType to human", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "uid-human",
        email: "human@example.com",
      });
      setupQueryMock();

      const req = makeReq({
        headers: { authorization: "Bearer firebase-token" },
      });
      await authMiddleware(req, makeRes(), makeNext());

      expect(req.actorType).toBe("human");
    });

    it("API key sets actorType to api_client", async () => {
      const rawKey = "actor-type-api-key";
      setupQueryMock({
        apiKeyRows: [makeApiKeyRow("key-actor", sha256(rawKey))],
      });

      const req = makeReq({
        headers: { "x-api-key": rawKey },
      });
      await authMiddleware(req, makeRes(), makeNext());

      expect(req.actorType).toBe("api_client");
    });

    it("Scoped token sets actorType to external_token", async () => {
      const rawToken = "actor-type-scoped-token";
      mockVerifyIdToken.mockRejectedValue(new Error("Not Firebase"));
      setupQueryMock({
        scopedTokenRows: [makeScopedTokenRow("tok-actor", sha256(rawToken))],
      });

      const req = makeReq({
        headers: { authorization: `Bearer ${rawToken}` },
      });
      await authMiddleware(req, makeRes(), makeNext());

      expect(req.actorType).toBe("external_token");
    });

    it("MCP delegation sets actorType to ai_agent", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "uid-mcp-actor",
        email: "agent@example.com",
      });
      setupQueryMock();

      const req = makeReq({
        headers: {
          authorization: "Bearer firebase-token",
          "x-mcp-delegation": "true",
        },
      });
      await authMiddleware(req, makeRes(), makeNext());

      expect(req.actorType).toBe("ai_agent");
    });
  });

  // =========================================================================
  // Additional: requireAuth middleware
  // =========================================================================

  describe("requireAuth", () => {
    it("returns 401 when req.user is not set", () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(next.called).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: "Authentication required. Provide a valid credential.",
      });
    });

    it("calls next when req.user is set", () => {
      const req = makeReq();
      req.user = { uid: "test-uid", email: "test@example.com" };

      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(next.called).toBe(true);
      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Additional: resolveRole skips lookup when req.role already set
  // =========================================================================

  describe("resolveRole skips lookup when role already set", () => {
    it("does not query Postgres when req.role is already set (API key / token path)", async () => {
      const req = makeReq();
      req.user = { uid: "apikey:key-001", email: "apikey@example.com" };
      req.role = { roleKey: "coordinator", roleName: "Coordinator", priority: 10 };

      const res = makeRes();
      const next = makeNext();

      await resolveRole(req, res, next);

      expect(next.called).toBe(true);
      // No query calls should have been made for user role lookup
      const userQueryCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("FROM users")
      );
      expect(userQueryCalls).toHaveLength(0);
    });

    it("skips role resolution when no user is set", async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await resolveRole(req, res, next);

      expect(next.called).toBe(true);
      expect(req.role).toBeUndefined();
    });
  });

  // =========================================================================
  // Additional: requireRole edge cases
  // =========================================================================

  describe("requireRole edge cases", () => {
    it("returns 403 when req.role is not set", () => {
      const middleware = requireRole(10);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      middleware(req, res, next);

      expect(next.called).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: "Role not resolved. Ensure resolveRole middleware runs first.",
      });
    });

    it("passes when priority equals maxPriority exactly", () => {
      const middleware = requireRole(20);
      const req = makeReq();
      req.role = { roleKey: "liaison", roleName: "Liaison", priority: 20 };

      const res = makeRes();
      const next = makeNext();

      middleware(req, res, next);

      expect(next.called).toBe(true);
    });
  });
});
