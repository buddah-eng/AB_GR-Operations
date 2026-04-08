# MCP Surface

> Personal AI agent access via Model Context Protocol. Claude Code connects to the platform API through MCP tools, operating with the operator's exact Firebase-delegated permissions. Every tool call flows through auth middleware, RBAC enforcement, and audit logging --- same as any human request. The AI sees the API, never the storage layer. Postgres is the system of record.

---

## Overview

The MCP surface exposes the convention operations platform to a personal AI agent (Claude Code) through the Model Context Protocol. It is a productivity tool for the platform operator, not a platform feature visible to other staff.

The operator connects Claude Code to the platform's MCP server. The server advertises a set of tools --- each one a thin wrapper around an existing platform API endpoint. When the agent calls a tool, the MCP server injects the operator's Firebase token into the request and forwards it to the API. Auth middleware resolves the token as normal. RBAC scopes the response as normal. The audit system logs the action with `actor_type='ai_agent'`.

No new permissions model is introduced. No new data paths are created. The agent operates inside the same boundary as the human operator sitting at the web UI. The only difference visible to the platform is the actor type tag in the audit log.

**Dependencies:** Auth system (`auth-system.md` -- MCP delegation method), RBAC engine (`rbac-engine.md` -- permission evaluation), Audit system (`audit-system.md` -- `ai_agent` actor type).

**Phase:** 2 --- after auth, RBAC, and audit are stable. See `_orchestration.md`.

---

## 1. Auth Delegation

### Purpose

Let the AI agent authenticate as the operator without exposing raw credentials. Every tool call carries the operator's Firebase token through the existing middleware chain.

### Detail

The operator authenticates to the MCP server using their Firebase OAuth token. The MCP server stores the token for the duration of the session. On every tool call, the server attaches the token as a `Bearer` header to the outbound API request. `authMiddleware()` resolves it to an `AuthenticatedUser` + `UserRole` pair exactly as it would for a browser request. The auth method is `mcp_delegation` (see `auth-system.md` section 1). The resolved actor type is `ai_agent`.

Token refresh is the operator's responsibility --- the MCP client (Claude Code) re-authenticates when the token expires. The MCP server never persists tokens to disk.

| Concern | Behavior |
|---|---|
| Token transport | Passed at MCP session init, attached to every API call |
| Identity resolution | Firebase token -> `AuthenticatedUser` via existing middleware |
| Role resolution | `resolveRole()` returns the operator's `UserRole` from Postgres |
| Actor type | `ai_agent` -- written to `req.actorType`, flows to audit |
| Token expiry | MCP server returns auth error; client re-authenticates |
| Token storage | In-memory only, never persisted |

### Acceptance Criteria

- [ ] MCP server accepts a Firebase token at session init.
- [ ] Every outbound API call includes the token as `Authorization: Bearer <token>`.
- [ ] `authMiddleware()` resolves the token to the correct `AuthenticatedUser`.
- [ ] `resolveRole()` returns the same `UserRole` as the operator's browser session.
- [ ] `req.actorType` is set to `ai_agent` for all MCP-originated requests.
- [ ] Expired token returns a structured auth error to the MCP client.
- [ ] No token is written to disk or logged.

---

## 2. RBAC Enforcement

### Purpose

The AI agent gets the operator's exact permissions --- same CRUD gates, same data scopes, same field visibility. No elevation, no reduction.

### Detail

Because the MCP surface delegates the operator's token, the RBAC engine evaluates the agent's access identically to a browser request. The `RoleEngine` loads the operator's role, checks permissions against the target concept, applies data scoping (WHERE clause), and filters fields by visible/editable lists. The MCP tool response returns only what the operator's role permits.

No MCP-specific permission rows exist. No "agent role" is defined. The agent inherits the operator's role directly.

If the operator's role lacks `read` on a concept, the corresponding `list_records` / `get_record` tool call returns a 403. If the role has field-level restrictions, the tool response omits those fields. The AI never sees data the operator cannot see in the web UI.

### Acceptance Criteria

- [ ] Agent calling `list_records('vendors')` returns the same rows and fields as the operator viewing vendors in the web UI.
- [ ] Agent calling `create_record('vendors', data)` fails with 403 if the operator's role lacks `create` on `vendors`.
- [ ] Data scoping applies: if the operator's role scopes to `assigned_to = self`, the agent sees only those rows.
- [ ] Field filtering applies: if the operator's role hides `budget` on `vendors`, the agent response omits `budget`.
- [ ] No MCP-specific permission rows exist in the `permissions` table.

---

## 3. Tool Definitions

### Purpose

Map each MCP tool to a platform API endpoint. The tool set covers read, write, workflow, and self-referential queries --- nothing more.

### Detail

| MCP Tool | HTTP Method | Endpoint | Description |
|---|---|---|---|
| `get_ontology` | GET | `/api/ontology` | Returns the domain model: concepts, properties, relationships. Lets the agent understand what data exists before querying. |
| `list_records(concept, filters)` | GET | `/api/domains/:concept` | List records for a concept. `filters` map to query parameters. Pagination via `limit`/`offset`. |
| `get_record(concept, id)` | GET | `/api/domains/:concept/:id` | Fetch a single record by ID. |
| `create_record(concept, data)` | POST | `/api/domains/:concept` | Create a new record. `data` is the record payload. |
| `update_record(concept, id, data)` | PUT | `/api/domains/:concept/:id` | Update an existing record. `data` contains only changed fields. |
| `run_workflow(name)` | POST | `/api/workflows/:name/run` | Trigger a named manual workflow. |
| `my_assignments` | GET | `/api/domains?assigned_to=me` | List all records across concepts where the current user is the assignee. Convenience wrapper. |

Each tool implementation:
1. Receives parameters from the MCP client.
2. Validates parameter shape (concept exists in ontology, required fields present).
3. Constructs the HTTP request with the delegated token.
4. Forwards to the platform API.
5. Returns the API response (or structured error) to the MCP client.

No tool exposes raw SQL, direct Postgres access, or internal service endpoints. The tool set is the API and only the API.

### Acceptance Criteria

- [ ] Each tool listed above is registered in the MCP server's tool manifest.
- [ ] `get_ontology` returns the full domain model (concepts, properties, relationships).
- [ ] `list_records` supports `filters`, `limit`, `offset` parameters.
- [ ] `get_record` returns a single record with all role-permitted fields.
- [ ] `create_record` returns the created record with its assigned ID.
- [ ] `update_record` returns the updated record.
- [ ] `run_workflow` returns success/failure status and any output.
- [ ] `my_assignments` returns records across all concepts scoped to the current user.
- [ ] Calling a tool with a nonexistent concept returns a structured error, not a 500.
- [ ] No tool accepts raw SQL or direct table references.

---

## 4. Tool Annotations

### Purpose

Declare each tool's safety characteristics per the MCP spec so the client (Claude Code) can enforce confirmation prompts on dangerous operations.

### Detail

MCP tool annotations are metadata hints that describe a tool's behavior. They do not enforce server-side policy --- they inform the client's UX. Claude Code uses these annotations to decide when to pause and ask the operator for confirmation.

| MCP Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | Client Behavior |
|---|---|---|---|---|
| `get_ontology` | `true` | `false` | `true` | Auto-approve |
| `list_records` | `true` | `false` | `true` | Auto-approve |
| `get_record` | `true` | `false` | `true` | Auto-approve |
| `create_record` | `false` | `false` | `false` | Confirm before executing |
| `update_record` | `false` | `false` | `true` | Confirm before executing |
| `run_workflow` | `false` | `false` | `false` | Confirm before executing |
| `my_assignments` | `true` | `false` | `true` | Auto-approve |

Notes:
- `destructiveHint: true` is reserved for future delete/archive tools. None exist in the initial tool set.
- `idempotentHint: true` on `update_record` because PUTting the same payload twice produces the same state.
- `idempotentHint: false` on `create_record` because POSTing twice creates two records.
- `run_workflow` is not idempotent because workflows may have side effects (emails, state transitions).

### Acceptance Criteria

- [ ] Every tool in the MCP manifest includes `readOnlyHint`, `destructiveHint`, and `idempotentHint` annotations.
- [ ] Claude Code auto-approves tools where `readOnlyHint: true`.
- [ ] Claude Code prompts for confirmation on tools where `readOnlyHint: false`.
- [ ] If a delete/archive tool is added later, it carries `destructiveHint: true` and Claude Code requires explicit confirmation.
- [ ] Annotation values match the table above for all initial tools.

---

## 5. Guardrails

### Purpose

Prevent the AI agent from performing operations that are unsafe, out of scope, or require human judgment at scale.

### Detail

**No raw DB access.** No tool exposes SQL, direct table names, or Postgres connection details. The agent interacts with concepts and records, never with tables and rows.

**No batch mutations without confirmation.** If the agent constructs a loop that would create or update 5+ records in a single conversational turn, the MCP server enforces a bulk limit gate:

| Threshold | Behavior |
|---|---|
| 1-4 records mutated in a turn | Normal per-tool confirmation via annotations |
| 5+ records mutated in a turn | MCP server returns a `bulk_limit_exceeded` error with a confirmation token. Agent must present the count to the operator and relay the confirmation token back to proceed. |

The turn counter resets on each new conversational turn (each new user message in Claude Code).

**No ontology or RBAC modification.** Tools for creating/editing concepts, properties, roles, permissions, data scopes, or screen access are not exposed. These operations are admin-only and performed through the ontology web builder.

**No service-to-service escalation.** The MCP server does not accept API keys or service tokens --- only Firebase user tokens. The agent cannot impersonate a service.

### Acceptance Criteria

- [ ] No tool in the MCP manifest accepts SQL, table names, or connection strings as parameters.
- [ ] Mutating 5+ records in a single conversational turn triggers `bulk_limit_exceeded` error.
- [ ] The `bulk_limit_exceeded` response includes a human-readable count and a one-time confirmation token.
- [ ] Relaying the confirmation token allows the batch to proceed.
- [ ] No tool exists for creating or modifying concepts, properties, roles, or permissions.
- [ ] MCP server rejects API key and service token authentication --- only Firebase user tokens accepted.
- [ ] Turn counter resets on each new user message boundary.

---

## 6. Audit Trail

### Purpose

Make every AI-initiated action distinguishable from human actions in the audit log so a director can review what the agent did independently.

### Detail

Every API request originating from the MCP surface writes to `domain_audit_log` (or `ontology_audit_log` for reads that touch config) with the following fields populated:

| Audit Field | Value | Source |
|---|---|---|
| `actor_type` | `ai_agent` | Set by auth middleware when method is `mcp_delegation` |
| `actor_id` | Operator's user ID | Resolved from Firebase token |
| `session_id` | MCP session UUID | Generated at MCP session init, passed as request header |
| `metadata.model_name` | e.g. `claude-opus-4-6` | Passed by MCP client at session init |
| `change_set` | UUID | Standard audit grouping per `audit-system.md` |

Forensic queries:
- **All AI actions:** `SELECT * FROM domain_audit_log WHERE actor_type = 'ai_agent'`
- **AI actions by user:** `... AND actor_id = '<user_id>'`
- **AI actions in one session:** `... AND session_id = '<mcp_session_id>'`
- **Compare AI vs human for same user:** Join on `actor_id`, partition by `actor_type`

The audit system does not distinguish between "the human asked the AI to do this" and "the AI decided to do this" --- both are tagged `ai_agent`. The conversational context lives in Claude Code's session, not in the platform.

### Acceptance Criteria

- [ ] Every MCP-originated mutation writes an audit row with `actor_type = 'ai_agent'`.
- [ ] `actor_id` matches the operator's Firebase UID.
- [ ] `session_id` is a valid UUID generated at MCP session init.
- [ ] `metadata.model_name` is populated from the MCP client's session init payload.
- [ ] A director-role user can query `domain_audit_log` filtered by `actor_type = 'ai_agent'` and see only AI-initiated actions.
- [ ] Audit rows from MCP surface are structurally identical to human-initiated audit rows (same table, same columns, same `change_set` grouping).

---

## 7. Abstraction Layer Discipline

### Purpose

Ensure the AI agent only interacts with the platform through the API layer, never touching Postgres directly. This prevents the "Google Calendar problem" --- where an AI edits the underlying resource (database row) instead of going through the source of truth (the platform API that enforces validation, RBAC, computed fields, and audit).

### Detail

The architecture enforces this structurally, not by policy:

1. **No DB tools.** The MCP server does not register any tool that accepts SQL or connects to Postgres. The agent cannot formulate a query because no tool exists to execute one.

2. **Concept-level addressing.** Tools accept concept keys and record IDs, not table names and primary keys. The mapping from concept to table is internal to the API.

3. **Validation in the API.** `create_record` and `update_record` pass through the same validation middleware as web UI submissions --- required fields, type checks, relationship integrity. The AI cannot bypass validation by writing directly.

4. **Computed fields.** Fields derived from formulas, rollups, or workflow side effects are computed by the API on read. The AI receives them in responses but cannot set them directly.

5. **Audit coverage.** Because every mutation goes through the API, the application-level audit path fires on every AI action. No Postgres trigger mismatch is possible from MCP-originated changes.

If the platform later exposes a reporting/analytics layer with read-only SQL access, that would be a separate MCP tool with `readOnlyHint: true` and explicit query sandboxing --- not part of this spec.

### Acceptance Criteria

- [ ] No MCP tool accepts SQL strings, table names, or column names as input.
- [ ] Agent-created records pass through the same validation middleware as web-UI-created records.
- [ ] Computed fields are present in `get_record` / `list_records` responses but rejected if included in `create_record` / `update_record` payloads.
- [ ] Every agent mutation produces both an application-level audit row and a matching Postgres-trigger audit row (no trigger-only rows from MCP actions).
- [ ] The MCP server has no Postgres connection string in its configuration --- it only knows the platform API base URL and the delegated token.

---

## 8. Test Plan

### Purpose

Validate that the MCP surface enforces auth delegation, RBAC parity, audit correctness, guardrails, and abstraction discipline.

### Detail

| Test Category | Test | Method | Pass Criteria |
|---|---|---|---|
| **Auth delegation** | MCP session init with valid Firebase token | Integration | `authMiddleware()` resolves to correct `AuthenticatedUser` |
| **Auth delegation** | MCP session init with expired token | Integration | Structured auth error returned, no tool calls succeed |
| **Auth delegation** | MCP session init with API key (not Firebase token) | Integration | Rejected --- MCP accepts only Firebase tokens |
| **RBAC parity** | Agent `list_records('vendors')` vs human GET `/api/domains/vendors` with same user | Integration | Identical response body (same rows, same fields) |
| **RBAC parity** | Agent `create_record` on concept where role lacks `create` | Integration | 403 returned |
| **RBAC parity** | Agent `list_records` with data-scoped role | Integration | Only scoped rows returned, matching human UI |
| **RBAC parity** | Agent `get_record` with field-restricted role | Integration | Restricted fields omitted from response |
| **Audit trail** | Agent creates a record | Integration | `domain_audit_log` row with `actor_type = 'ai_agent'`, correct `actor_id`, `session_id`, `model_name` |
| **Audit trail** | Compare agent audit row to human audit row | Inspection | Same table, same columns, different `actor_type` |
| **Audit trail** | Director queries AI-only actions | Integration | Filter `actor_type = 'ai_agent'` returns only MCP-originated rows |
| **Destructive tool confirmation** | Add a delete tool with `destructiveHint: true` | Unit | Claude Code prompts for confirmation before executing |
| **Bulk limit** | Agent mutates 5 records in one turn | Integration | 5th mutation returns `bulk_limit_exceeded` with confirmation token |
| **Bulk limit** | Agent relays confirmation token | Integration | Batch proceeds after token relay |
| **Bulk limit** | Turn counter resets on new user message | Integration | Mutations in new turn start from 0 |
| **No raw DB access** | Attempt to pass SQL in tool parameters | Unit | No tool accepts the parameter; structured error returned |
| **No raw DB access** | Inspect MCP server config | Inspection | No Postgres connection string present |
| **Abstraction** | Agent `create_record` with computed field in payload | Integration | Computed field ignored or rejected; record created with API-computed value |
| **Abstraction** | Agent `update_record` with invalid data | Integration | Same validation error as web UI submission |

### Acceptance Criteria

- [ ] All integration tests pass against a test environment with seeded roles, permissions, and data scopes.
- [ ] RBAC parity tests compare agent responses byte-for-byte (after JSON normalization) with human API responses for the same user and endpoint.
- [ ] Audit trail tests query `domain_audit_log` directly and assert on `actor_type`, `actor_id`, `session_id`, and `metadata.model_name`.
- [ ] Bulk limit tests verify the turn counter, confirmation token flow, and reset behavior.
- [ ] No test requires direct Postgres access from the MCP server --- all assertions go through the platform API or audit log queries.
