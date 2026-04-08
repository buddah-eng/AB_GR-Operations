# Auth System

> Four authentication methods --- Firebase OAuth, API keys, token-scoped, MCP delegation --- all resolving to the same `AuthenticatedUser` + `UserRole` pair. The RBAC engine never knows or cares which method authenticated the request. Every request is tagged with an actor type for audit. Dev bypass exists for emulator only.

---

## Overview

The auth system is the identity boundary for the convention operations platform. It sits in front of every authenticated endpoint and answers two questions: **who is this?** and **what can they do?**

Today the platform handles one auth method (Firebase OAuth via `authMiddleware()` in `functions/src/auth/middleware.ts`). This PRD extends the middleware chain to support three additional methods --- API keys, token-scoped access, and MCP delegation --- without changing the downstream contract. Every method produces the same `AuthenticatedUser` and `UserRole` objects. Every method tags the request with an actor type that flows into the audit system.

The middleware chain order does not change: `authMiddleware()` -> `resolveRole()` -> `requireAuth()` -> route handler. What changes is what `authMiddleware()` can accept and how `resolveRole()` sources its data.

Postgres is the system of record for API keys, tokens, and user-role mappings. Firebase remains the identity provider for OAuth. Role definitions live in Postgres (ontology tables). The role lookup currently hits cached external queries; it will be migrated to Postgres queries behind the same cache layer.

**Phase:** 1 --- Foundation (see `_orchestration.md`). Parallel track with RBAC engine. Blocks all authenticated access.

---

## 1. Four Auth Methods

### Purpose

Support every actor that touches the platform --- human operators in the UI, internal services like the warehouse app, external participants via guest links, and personal AI agents acting on behalf of a user --- through a single middleware chain.

### Detail

| Method | Transport | Identity Source | Role Source | Actor Type |
|---|---|---|---|---|
| **Firebase OAuth** | `Authorization: Bearer <firebase_id_token>` | Firebase `verifyIdToken()` decodes uid, email, name | Postgres user-role mapping (by email) | `human` |
| **API Key** | `X-API-Key: <key>` header | Postgres `api_keys` table (hashed lookup) | Role assigned to the key at creation time | `api_client` |
| **Token-Scoped** | `Authorization: Bearer <platform_token>` | Postgres `scoped_tokens` table (hashed lookup, expiration check) | Role embedded in token record (typically `viewer` or a custom scoped role) | `external_token` |
| **MCP Delegation** | `Authorization: Bearer <firebase_id_token>` + `X-MCP-Delegation: true` header | Firebase `verifyIdToken()` (same as OAuth) | Same as the delegating user | `ai_agent` |

All four methods resolve to the existing interfaces already defined in the codebase:

```typescript
// functions/src/auth/middleware.ts (existing, unchanged)
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
```

API keys and scoped tokens generate synthetic `uid` values (`apikey:<key_id>`, `token:<token_id>`) so downstream code that references `req.user.uid` works without branching.

### Acceptance Criteria

- [ ] A request with a valid Firebase ID token authenticates and resolves role from Postgres.
- [ ] A request with a valid `X-API-Key` header authenticates and resolves the key's assigned role.
- [ ] A request with a valid scoped token authenticates, checks expiration, and resolves the token's role.
- [ ] A request with a valid Firebase token and `X-MCP-Delegation: true` authenticates with actor type `ai_agent`.
- [ ] All four methods attach `AuthenticatedUser` and `UserRole` to `req`.
- [ ] An invalid or expired credential for any method results in `req.user` not being set (no crash, no 500).

---

## 2. Auth Middleware Chain

### Purpose

Extend the existing middleware chain to detect and dispatch all four auth methods while preserving the current call signature and downstream expectations.

### Detail

The current chain in `functions/src/auth/middleware.ts`:

```
authMiddleware() -> resolveRole() -> requireAuth() -> handler
```

`authMiddleware()` currently handles Firebase tokens and the dev bypass. It will be extended with a detection sequence:

```
1. Check X-API-Key header       -> if present, validate via Postgres, set req.user + req.role, set req.actorType = "api_client", return
2. Check Authorization: Bearer  -> extract token
   a. If "dev-bypass-token"     -> existing dev bypass logic (emulator only)
   b. Try Firebase verifyIdToken()
      - If succeeds + X-MCP-Delegation header -> set req.actorType = "ai_agent"
      - If succeeds (no delegation header)    -> set req.actorType = "human"
   c. If Firebase fails, try scoped token lookup in Postgres
      - If valid + not expired  -> set req.user + req.role, set req.actorType = "external_token"
3. If nothing matched           -> next() with no req.user (requireAuth will reject)
```

`resolveRole()` changes:

- If `req.role` is already set (API key and token-scoped paths set it during auth), skip lookup.
- If `req.role` is not set (Firebase OAuth, MCP delegation), look up from Postgres by email (current behavior, migrated from external query to Postgres).

New: `req.actorType` is added to the Express Request interface:

```typescript
type ActorType = "human" | "api_client" | "external_token" | "ai_agent";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      role?: UserRole;
      actorType?: ActorType;
    }
  }
}
```

### Acceptance Criteria

- [ ] `authMiddleware()` correctly dispatches based on header presence and token type.
- [ ] API key and token-scoped paths short-circuit `resolveRole()` (role already attached).
- [ ] Firebase OAuth and MCP delegation paths go through `resolveRole()` as before.
- [ ] `req.actorType` is set on every authenticated request.
- [ ] Existing `requireAuth()` and `requireRole()` functions work without modification.
- [ ] Detection order prevents ambiguity (API key header takes priority; Bearer tokens fall through Firebase -> scoped token).

---

## 3. Dev Bypass

### Purpose

Allow local development without real Firebase credentials or Postgres lookups. Emulator only. Never in production.

### Detail

The dev bypass already exists in the codebase (`functions/src/auth/middleware.ts`, lines 69-95). It activates when:

1. The Bearer token is literally `"dev-bypass-token"`.
2. `process.env.FUNCTIONS_EMULATOR` is truthy (set automatically by `firebase emulators:start`).

If both conditions are met, the middleware reads:

- `X-Dev-Email` header (default: `dev@localhost`)
- `X-Dev-Role` header (default: `director`)

And maps to an allowed role set:

```typescript
// functions/src/auth/middleware.ts lines 76-81 (existing)
const ALLOWED_DEV_ROLES: Readonly<Record<string, { name: string; priority: number }>> = {
  director:    { name: "Director",    priority: 0 },
  coordinator: { name: "Coordinator", priority: 10 },
  liaison:     { name: "Liaison",     priority: 20 },
  viewer:      { name: "Viewer",      priority: 100 },
};
```

Extension for new auth methods:

- `X-Dev-Actor-Type` header (default: `human`). Must be one of the four valid `ActorType` values. Invalid values default to `human`.
- To simulate API key auth in dev: use `X-Dev-Email` + `X-Dev-Role` + `X-Dev-Actor-Type: api_client`.
- To simulate token-scoped auth in dev: same pattern with `X-Dev-Actor-Type: external_token`.
- To simulate MCP delegation in dev: same pattern with `X-Dev-Actor-Type: ai_agent`.

The bypass is rejected with a warning log if `FUNCTIONS_EMULATOR` is not set (existing behavior, line 71).

### Acceptance Criteria

- [ ] Dev bypass only activates when `FUNCTIONS_EMULATOR` is truthy.
- [ ] `X-Dev-Actor-Type` header sets `req.actorType` (defaulting to `human`).
- [ ] All four actor types can be simulated via dev headers.
- [ ] Bypass is rejected in production with a logger warning (existing behavior preserved).
- [ ] No dev bypass code paths are reachable without the `dev-bypass-token` literal.

---

## 4. Identity Resolution

### Purpose

Guarantee that downstream code --- RBAC engine, API handlers, audit logging --- receives a uniform identity regardless of how the request was authenticated.

### Detail

Every authenticated request, regardless of method, produces:

```
req.user: AuthenticatedUser  { uid, email, name? }
req.role: UserRole           { roleKey, roleName, priority }
req.actorType: ActorType     "human" | "api_client" | "external_token" | "ai_agent"
```

Identity construction per method:

| Method | `uid` | `email` | `name` | `roleKey` | `priority` |
|---|---|---|---|---|---|
| Firebase OAuth | Firebase UID | From token | From token | Looked up by email in Postgres | From role definition |
| API Key | `apikey:<key_id>` | Service email on key record | Key display name | Assigned at key creation | From role definition |
| Token-Scoped | `token:<token_id>` | Scope context (e.g., `guest:<guest_id>@tokens.internal`) | Token label | Embedded in token record | From role definition |
| MCP Delegation | Firebase UID (delegating user) | From token | From token | Same as delegating user | Same as delegating user |

The RBAC engine (`core/rbac-engine.md`) consumes `req.role` and never inspects `req.actorType` or how identity was established. This separation is intentional: auth resolves identity, RBAC evaluates permissions.

`requireRole(maxPriority)` (existing, lines 178-198) continues to work unchanged --- it checks `req.role.priority` against the threshold, nothing else.

### Acceptance Criteria

- [ ] `req.user` and `req.role` are populated for all four auth methods before any route handler executes.
- [ ] RBAC engine functions accept `UserRole` and do not branch on auth method.
- [ ] API key and token-scoped `uid` values use the `apikey:` / `token:` prefix convention.
- [ ] `requireRole()` works identically regardless of auth method.
- [ ] No downstream code needs to import auth-method-specific types.

---

## 5. Actor Types for Audit

### Purpose

Every mutation, access, and system event must record **what kind of actor** performed it. This is distinct from role (what they can do) --- it answers **how they authenticated**.

### Detail

The `ActorType` enum:

| Actor Type | Meaning | Example |
|---|---|---|
| `human` | Person authenticated via Firebase OAuth in the platform UI | Coordinator updating a booth assignment |
| `api_client` | Internal service authenticated via API key | Warehouse app syncing inventory counts |
| `external_token` | External participant via a scoped token link | Guest filling out a dietary form, driver viewing a load sheet |
| `ai_agent` | Personal AI agent operating with MCP delegation on behalf of a user | User's Claude agent querying their schedule |

`req.actorType` is set by `authMiddleware()` and flows into:

1. **Audit log entries** --- every domain event includes `actorType` alongside `userId` and `roleKey`.
2. **Request context** --- available to any middleware or handler via `req.actorType`.
3. **Rate limiting** (future) --- different limits per actor type.

Audit log schema (column in the audit events table):

```sql
actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'api_client', 'external_token', 'ai_agent'))
```

For the dev bypass, `actorType` is set via `X-Dev-Actor-Type` header (see section 3).

### Acceptance Criteria

- [ ] `req.actorType` is set on every authenticated request (never null/undefined after `authMiddleware` succeeds).
- [ ] Audit log entries include `actor_type` for every recorded event.
- [ ] The four actor type values are the only valid values (enforced at type level and in Postgres CHECK constraint).
- [ ] Dev bypass correctly sets actor type from header.

---

## 6. Session Management

### Purpose

Define lifecycle, expiration, and revocation for each credential type.

### Detail

| Method | Session Lifecycle | Expiration | Revocation | Storage |
|---|---|---|---|---|
| **Firebase OAuth** | Firebase manages token issuance and refresh. Client SDK handles refresh automatically. | Firebase ID tokens expire after 1 hour; refresh tokens are long-lived. | Revoke via Firebase Admin SDK `revokeRefreshTokens(uid)`. | Firebase (not in Postgres). |
| **API Key** | Created by a director via the platform UI or CLI. Long-lived. | No automatic expiration. Optional `expires_at` column for time-boxed keys. | Soft-delete in Postgres (`revoked_at` timestamp). Middleware checks `revoked_at IS NULL`. | Postgres `api_keys` table. Key stored as SHA-256 hash. |
| **Token-Scoped** | Created programmatically when generating a guest link or external view. Short-lived by design. | Required `expires_at` timestamp. Default: 72 hours. Max: 30 days. | Soft-delete (`revoked_at`). Also expires naturally. | Postgres `scoped_tokens` table. Token stored as SHA-256 hash. |
| **MCP Delegation** | Inherits the delegating user's Firebase session. No separate session. | Same as Firebase OAuth (1-hour ID token, auto-refresh). | Revoking the user's Firebase session revokes MCP access. Optionally, a platform-level MCP allowlist per user. | Firebase (identity) + optional Postgres `mcp_delegations` table (allowlist, audit). |

API key table schema:

```sql
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  email       TEXT NOT NULL,
  role_key    TEXT NOT NULL REFERENCES roles(key),
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
```

Scoped token table schema:

```sql
CREATE TABLE scoped_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  scope       JSONB NOT NULL,        -- e.g., {"type": "guest_form", "guest_id": "..."}
  role_key    TEXT NOT NULL REFERENCES roles(key),
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
```

Key rotation for API keys: create new key, distribute, revoke old key. No automatic rotation --- operational decision.

### Acceptance Criteria

- [ ] API keys are stored as SHA-256 hashes; raw key is only returned once at creation.
- [ ] Scoped tokens enforce `expires_at` --- expired tokens are rejected by middleware.
- [ ] Revoked keys/tokens (`revoked_at IS NOT NULL`) are rejected by middleware.
- [ ] `last_used_at` is updated on each successful authentication (async, non-blocking).
- [ ] MCP delegation uses the existing Firebase session; no separate token issuance.
- [ ] API key creation requires `director` role.
- [ ] Scoped token creation requires `coordinator` role or higher.

---

## 7. Test Plan

### Purpose

Verify that every auth path works in isolation and in combination, that role resolution is auth-method-agnostic, and that the dev bypass cannot leak into production.

### Detail

#### 7a. Auth Flow Per Method

| Test | Input | Expected |
|---|---|---|
| Firebase OAuth happy path | Valid Firebase ID token | `req.user` set with Firebase uid/email, `req.actorType = "human"` |
| Firebase OAuth expired token | Expired Firebase ID token | `req.user` not set, `requireAuth` returns 401 |
| API key happy path | Valid `X-API-Key` header | `req.user.uid` starts with `apikey:`, `req.role` matches key record, `req.actorType = "api_client"` |
| API key revoked | Revoked API key | `req.user` not set, 401 |
| API key expired | Expired API key | `req.user` not set, 401 |
| Token-scoped happy path | Valid Bearer scoped token | `req.user.uid` starts with `token:`, `req.actorType = "external_token"` |
| Token-scoped expired | Expired scoped token | `req.user` not set, 401 |
| Token-scoped revoked | Revoked scoped token | `req.user` not set, 401 |
| MCP delegation happy path | Valid Firebase token + `X-MCP-Delegation: true` | `req.user` matches Firebase user, `req.actorType = "ai_agent"` |
| MCP delegation without valid token | Invalid Firebase token + `X-MCP-Delegation: true` | `req.user` not set, 401 |
| No credentials | No auth headers | `req.user` not set, `requireAuth` returns 401 |

#### 7b. Token Verification

| Test | Input | Expected |
|---|---|---|
| Firebase token verification calls `admin.auth().verifyIdToken()` | Mock | Decoded token fields map to `AuthenticatedUser` |
| API key hash comparison | Known key + hash | SHA-256 match succeeds |
| API key hash mismatch | Wrong key | Lookup returns no match |
| Scoped token hash + expiration | Valid hash, future `expires_at` | Auth succeeds |
| Scoped token hash + past expiration | Valid hash, past `expires_at` | Auth fails |

#### 7c. Role Resolution

| Test | Input | Expected |
|---|---|---|
| Firebase user with known role | Email in Postgres users table | `req.role` matches Postgres record |
| Firebase user with unknown email | Email not in Postgres | `req.role` defaults to viewer (priority 999) |
| API key role | Key record has `role_key = "coordinator"` | `req.role.roleKey = "coordinator"` |
| Token-scoped role | Token record has `role_key = "viewer"` | `req.role.roleKey = "viewer"` |
| `requireRole(10)` with coordinator (10) | `req.role.priority = 10` | Passes |
| `requireRole(10)` with liaison (20) | `req.role.priority = 20` | 403 |

#### 7d. Dev Bypass Isolation

| Test | Input | Expected |
|---|---|---|
| Dev bypass in emulator | `dev-bypass-token` + `FUNCTIONS_EMULATOR=true` | Auth succeeds with dev headers |
| Dev bypass in production | `dev-bypass-token` + no `FUNCTIONS_EMULATOR` | Auth fails, warning logged |
| Dev bypass with actor type | `X-Dev-Actor-Type: ai_agent` in emulator | `req.actorType = "ai_agent"` |
| Dev bypass with invalid actor type | `X-Dev-Actor-Type: hacker` in emulator | `req.actorType = "human"` (default) |

#### 7e. Actor Type Tagging

| Test | Input | Expected |
|---|---|---|
| Firebase OAuth sets human | Valid Firebase token, no delegation header | `req.actorType = "human"` |
| API key sets api_client | Valid API key | `req.actorType = "api_client"` |
| Scoped token sets external_token | Valid scoped token | `req.actorType = "external_token"` |
| MCP sets ai_agent | Valid Firebase token + delegation header | `req.actorType = "ai_agent"` |
| Actor type present in audit log | Any authenticated mutation | Audit log entry includes correct `actor_type` value |

### Acceptance Criteria

- [ ] All tests in sections 7a-7e pass.
- [ ] Auth tests run against both emulator (with dev bypass) and mock-production (without).
- [ ] No test relies on external services --- Firebase is mocked, Postgres uses test database.
- [ ] Test coverage includes every branch in `authMiddleware()` detection sequence.
- [ ] Dev bypass tests verify the `FUNCTIONS_EMULATOR` guard cannot be circumvented.
