# External Surfaces

> Token-scoped external access for non-staff users. `X-Guest-Token` / `X-Driver-Token` headers resolve through the same middleware chain (`authMiddleware()` -> `resolveRole()` -> `requireAuth()`) but branch into a token-lookup auth path that produces a scoped `AuthenticatedUser` + `UserRole` pair limited to the exact records the token was issued for. Guest self-service forms support save-and-resume via JSONB partial saves. Driver view exposes minimal PII and a single status-transition action. Tokens are `crypto.randomUUID()`, time-limited, and designed to leak nothing on failure. Postgres is the system of record for every token, session, and form state row.

---

## Overview

The convention operations platform needs to expose narrow slices of functionality to people who are not staff: guests filling out pre-convention forms, drivers tracking pickups, and (future) public applicants submitting panel or artist-alley proposals. These users never sign in with Firebase OAuth. They arrive via a tokenized link, and the platform must authenticate them, scope their access to exactly the records they own, and prevent any lateral movement.

This PRD defines the token-scoped auth path referenced in `auth-system.md` (Method 3), the session and form-state tables that back it, the API endpoints each surface requires, the security posture, and the test plan.

**Guiding constraints:**

- Same middleware chain, different auth path. No special-case `if` blocks in route handlers.
- RBAC engine evaluates permissions identically for token-scoped roles. Roles like `guest_self_service` and `driver` are ontology-defined, admin-editable rows in Postgres -- not hardcoded enums.
- Deny by default. A token-scoped role that lacks a permission row for a concept gets "no."
- Postgres is the system of record for tokens, sessions, form data, and driver sessions.

**Phase:** 1 -- Foundation (parallel track with auth system and RBAC engine). Guest forms and driver view are the first two external surfaces shipped.

---

## 1. Token-Scoped Auth

### Purpose

Authenticate non-staff users via opaque bearer tokens carried in custom headers, resolving each token to a scoped role and a record-specific data scope without touching Firebase.

### Detail

**Headers:**

| Header | Used By | Resolves To |
|---|---|---|
| `X-Guest-Token` | Guest self-service form links | `guest_form_session` row -> `guest_self_service` role, data scope = `guestId` |
| `X-Driver-Token` | Driver pickup view links | `driver_session` row -> `driver` role, data scope = `bookingId` |

**Token lifecycle:**

1. Platform generates token via `crypto.randomUUID()` when a staff user (or automated job) issues a guest form link or driver assignment.
2. Token is stored in the relevant session table with `expiresAt` timestamp.
3. Non-staff user arrives with the token in the appropriate header.
4. `authMiddleware()` detects the custom header before attempting Firebase verification. It queries Postgres for the matching session row.
5. If the row exists and `expiresAt > NOW()`, middleware constructs an `AuthenticatedUser` with actor type `token_scoped` and attaches the resolved role key.
6. `resolveRole()` loads the role and its permissions from the RBAC engine cache, scoped to the record IDs on the session row.
7. Request proceeds through the normal chain. Route handler never knows the auth method.

**Token format:** 128-bit UUIDv4, stored as `TEXT` in Postgres. No JWT, no embedded claims. All state is server-side.

**Expiration:** Configurable per surface. Default 72 hours for guest forms, 12 hours for driver sessions.

### Acceptance Criteria

- `X-Guest-Token` with a valid, unexpired token returns 200 and populates `req.authenticatedUser` with role `guest_self_service` and data scope limited to the token's `guestId`.
- `X-Driver-Token` with a valid, unexpired token returns 200 and populates `req.authenticatedUser` with role `driver` and data scope limited to the token's `bookingId`.
- Expired token returns 401 with a generic error body identical to the invalid-token response.
- Missing or malformed token header falls through to the next auth method in the chain; if no method succeeds, 401.
- Actor type `token_scoped` is written to the audit log for every request authenticated this way.

---

## 2. Guest Self-Service Forms

### Purpose

Allow guests to fill out pre-convention forms (dietary needs, accessibility requirements, travel details, merch sizes) via a tokenized link, with save-and-resume support so they can return later without losing progress.

### Detail

**Table: `guest_form_session`**

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `guestId` | `UUID` | FK to `guests`. The guest this form belongs to. |
| `token` | `TEXT` | Unique, indexed. The opaque bearer token. |
| `expiresAt` | `TIMESTAMPTZ` | Token expiration. Default `NOW() + INTERVAL '72 hours'`. |
| `status` | `TEXT` | One of `draft`, `submitted`, `expired`. Default `draft`. |
| `formData` | `JSONB` | Partial or complete form payload. |
| `createdAt` | `TIMESTAMPTZ` | Row creation time. |
| `updatedAt` | `TIMESTAMPTZ` | Last modification time. |

**Flow:**

1. Staff user (or automated YoY prep job) triggers "send guest form" for a guest. System creates a `guest_form_session` row and sends the guest an email containing the tokenized link.
2. Guest clicks link. Frontend sends `X-Guest-Token` header on every request.
3. `GET /api/guest-form` -- returns current `formData` merged with pre-fill data sourced from the YoY registry and company records. Pre-fill fields are read-only markers in the response so the frontend can render them as locked.
4. `PUT /api/guest-form` -- accepts a partial `formData` object. Server merges it into the existing JSONB column (shallow merge at the top-level key). Updates `updatedAt`. Returns the merged result.
5. Guest can close the browser and return later. The same token, same `GET`, same merged state.
6. `POST /api/guest-form/submit` -- validates the full payload against the ontology property constraints for the guest-form concept. If valid: sets `status = 'submitted'`, writes the final data through the standard domain API (creating/updating guest detail records), and fires domain events (`guest_form.submitted`). Prep items that depend on submitted answers auto-complete via event handlers.
7. If the token expires before submission, a background job sets `status = 'expired'`. The guest sees a "link expired" page and must request a new link from their liaison.

**Pre-fill sources:**

- YoY registry: previous year's answers for the same guest (matched by `guestId`).
- Company data: company-level defaults (e.g., standard dietary policy) attached to the guest's company record.

Pre-fill is best-effort. Missing data is simply absent from the response; the form renders those fields as blank.

**Domain events fired:**

| Event | Trigger |
|---|---|
| `guest_form.saved` | Every `PUT /api/guest-form` that changes data. |
| `guest_form.submitted` | Successful `POST /api/guest-form/submit`. |
| `guest_form.expired` | Background job sets status to `expired`. |

### Acceptance Criteria

- `GET /api/guest-form` returns pre-filled data merged with any saved `formData` for the token's guest.
- `PUT /api/guest-form` with a partial payload merges into `formData` without overwriting unrelated keys. Returns merged result.
- Multiple sequential `PUT` calls accumulate state correctly (save-and-resume).
- `POST /api/guest-form/submit` with a complete, valid payload sets status to `submitted`, persists to domain tables, and fires `guest_form.submitted`.
- `POST /api/guest-form/submit` with an incomplete or invalid payload returns 422 with field-level errors derived from ontology property constraints.
- A `PUT` or `POST` against a session with status `submitted` returns 409 Conflict.
- A `PUT` or `POST` against a session with status `expired` returns 410 Gone.
- Pre-fill data from YoY registry appears in `GET` response when prior-year data exists for the guest.

---

## 3. Driver View

### Purpose

Give drivers a minimal, read-only view of their next pickup with a single action: transition the pickup status through the `waiting -> picked_up -> dropped_off` sequence.

### Detail

**Table: `driver_session`**

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `bookingId` | `UUID` | FK to `bookings`. The booking this session is scoped to. |
| `token` | `TEXT` | Unique, indexed. The opaque bearer token. |
| `expiresAt` | `TIMESTAMPTZ` | Token expiration. Default `NOW() + INTERVAL '12 hours'`. |
| `createdAt` | `TIMESTAMPTZ` | Row creation time. |

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/driver/pickup` | Returns the pickup payload for the token's booking. |
| `POST` | `/api/driver/pickup/transition` | Advances the pickup status to the next state. |

**Pickup payload (GET response):**

```json
{
  "bookingId": "uuid",
  "guestName": "First Last",
  "flightStatus": "on_time | delayed | landed | unknown",
  "pickupLocation": "Terminal 2, Door 4",
  "instructions": "Guest has two large bags. Wheelchair accessible vehicle required.",
  "currentStatus": "waiting"
}
```

**Intentionally excluded from payload:** guest phone number, guest email, full itinerary, financial data. The driver role's RBAC permission row has a `visibleProperties` list that enforces this at the engine level.

**Status transitions:**

| Current | Next | Domain Event |
|---|---|---|
| `waiting` | `picked_up` | `driver.pickup.picked_up` |
| `picked_up` | `dropped_off` | `driver.pickup.dropped_off` |

`POST /api/driver/pickup/transition` reads `currentStatus` from the booking, advances it to the next valid state, writes the update, and fires the domain event. No request body is needed -- the next state is deterministic. If the current status is `dropped_off`, the endpoint returns 409 (no further transitions).

**Flight status:** Read from a cached external feed (or manual staff update). The driver view does not write flight status; it only reads it.

### Acceptance Criteria

- `GET /api/driver/pickup` returns only the fields listed above. No phone, email, or financial data present in response regardless of what the booking record contains.
- `POST /api/driver/pickup/transition` from `waiting` sets status to `picked_up` and fires `driver.pickup.picked_up`.
- `POST /api/driver/pickup/transition` from `picked_up` sets status to `dropped_off` and fires `driver.pickup.dropped_off`.
- `POST /api/driver/pickup/transition` from `dropped_off` returns 409 Conflict.
- RBAC engine's `visibleProperties` for the `driver` role enforces the field allowlist independently of the endpoint serializer (defense in depth).
- Expired driver token returns 401, identical to invalid token.

---

## 4. Public Forms (Future)

### Purpose

Accept submissions from the general public (panel proposals, artist alley applications) without requiring any pre-existing guest or driver record.

### Detail

This surface is a future phase. The design is documented here to ensure the token-scoped auth path and form infrastructure are built with extensibility in mind.

**Variants:**

| Form Type | Auth | Record Created |
|---|---|---|
| Panel submission | Fully public (no token, CAPTCHA-gated) | `panel_submission` row enters review workflow |
| Artist alley application | Email-verified (submit email, receive link with token) | `artist_alley_application` row enters review workflow |

**Shared pattern with guest forms:**

- JSONB `formData` column for partial saves.
- Ontology property constraints for validation.
- Domain event on submit (`panel_submission.submitted`, `artist_alley_application.submitted`).
- Status lifecycle: `draft -> submitted -> under_review -> accepted | rejected`.

**Differences from guest forms:**

- No `guestId` FK. The submitter is anonymous or identified only by email.
- No pre-fill from YoY data.
- Public forms require CAPTCHA or email verification instead of a pre-issued token.
- Rate limiting is significantly stricter (see Section 5).

**Design constraint for Phase 1:** The `guest_form_session` table schema and the `PUT`/`POST` endpoint pattern must not assume a `guestId` is always present. Use a nullable FK or a polymorphic session table so public forms can reuse the same infrastructure.

### Acceptance Criteria

- Phase 1 guest form tables and endpoints are structured so that public forms can be added without schema migration of existing tables.
- The token-scoped auth path supports a "no token required" bypass for fully public endpoints, gated by an explicit route-level annotation (not a global flag).
- No public form endpoints ship in Phase 1. This section is a design constraint only.

---

## 5. Security

### Purpose

Ensure token-scoped surfaces cannot be exploited for enumeration, lateral access, data leakage, or abuse, while maintaining the same security posture as authenticated staff endpoints.

### Detail

**Token opacity and error uniformity:**

- Tokens are opaque UUIDv4 values. No embedded claims, no decodable structure.
- Invalid token, expired token, and nonexistent token all return the same HTTP 401 response body: `{ "error": "unauthorized" }`. No field distinguishes the three cases. This prevents token enumeration.
- Response timing must be constant regardless of whether the token exists. Use a constant-time comparison or always perform the DB lookup (even for malformed tokens that are valid UUIDs).

**Rate limiting:**

| Surface | Limit | Window | Scope |
|---|---|---|---|
| Guest form endpoints | 30 requests | 1 minute | Per IP |
| Driver view endpoints | 30 requests | 1 minute | Per IP |
| Public form endpoints (future) | 10 requests | 1 minute | Per IP |
| Token auth failures | 5 failures | 5 minutes | Per IP |

Rate limits for token-scoped surfaces are stricter than for Firebase-authenticated staff endpoints. After the failure threshold, the IP receives 429 for the remainder of the window.

**CORS:**

- Token-scoped endpoints set `Access-Control-Allow-Origin` to the convention domain only (e.g., `https://ops.animeboston.com`). No wildcard.
- Preflight (`OPTIONS`) responses include `Access-Control-Allow-Headers: X-Guest-Token, X-Driver-Token`.
- Credentials mode is `same-origin`. Tokens are not cookies; they travel in custom headers.

**Input validation:**

- All form data submitted via `PUT /api/guest-form` and `POST /api/guest-form/submit` is validated against ontology property constraints for the relevant concept.
- Property constraints define type, format, min/max length, enum values, and required-ness. The same constraints used by staff CRUD endpoints apply here.
- JSONB payloads are validated at the API layer before any write to Postgres. Malformed JSON returns 400.

**Data scope enforcement:**

- Token-scoped roles carry a data scope (e.g., `guestId = X` or `bookingId = Y`). The RBAC engine appends this as a WHERE clause on every query, identical to how staff data scopes work.
- Even if a token-scoped request somehow references a different guest or booking ID in the request body, the data scope prevents any read or write outside the token's scope.

**Token revocation:**

- Deleting or expiring a session row immediately invalidates the token. No cache TTL delay -- token lookups hit Postgres directly (not the RBAC cache).
- Staff can revoke a guest form link or driver session from the admin UI at any time.

### Acceptance Criteria

- Invalid, expired, and nonexistent tokens return byte-identical 401 response bodies.
- Rate limiting returns 429 after threshold is exceeded. Verified by test.
- CORS preflight for token-scoped endpoints returns the convention domain, not `*`.
- A request with a valid guest token that references a different guest's ID in the body receives 0 rows / 403, not the other guest's data.
- Token revocation (row deletion) takes effect on the next request, not after a cache TTL.
- Form data that violates ontology property constraints is rejected with 422 and field-level errors.

---

## 6. Test Plan

### Purpose

Verify that every external surface authenticates correctly, enforces scoping, handles edge cases, and meets the security requirements defined above.

### Detail

**6.1 Token Auth Flow**

| # | Test | Method | Expected |
|---|---|---|---|
| T1 | Valid `X-Guest-Token`, unexpired | `GET /api/guest-form` | 200, `req.authenticatedUser.role` = `guest_self_service`, data scoped to `guestId` |
| T2 | Valid `X-Driver-Token`, unexpired | `GET /api/driver/pickup` | 200, `req.authenticatedUser.role` = `driver`, data scoped to `bookingId` |
| T3 | Expired token | `GET /api/guest-form` | 401, generic error body |
| T4 | Nonexistent token (valid UUID format) | `GET /api/guest-form` | 401, generic error body identical to T3 |
| T5 | Malformed token (not a UUID) | `GET /api/guest-form` | 401, generic error body identical to T3 |
| T6 | No token header, no Firebase auth | `GET /api/guest-form` | 401 |
| T7 | Guest token used on driver endpoint | `GET /api/driver/pickup` | 401 (wrong header) |

**6.2 Guest Form Save-and-Resume**

| # | Test | Method | Expected |
|---|---|---|---|
| T8 | `PUT` partial payload | `PUT /api/guest-form` | 200, `formData` contains submitted keys, other keys unchanged |
| T9 | Sequential `PUT` calls with different keys | Two `PUT` calls | 200, `formData` contains keys from both calls |
| T10 | `PUT` overwrites previously saved key | `PUT` with existing key, new value | 200, key updated to new value |
| T11 | `GET` after partial save | `GET /api/guest-form` | 200, returns merged pre-fill + saved `formData` |
| T12 | Submit complete form | `POST /api/guest-form/submit` | 200, status = `submitted`, domain event fired |
| T13 | Submit incomplete form | `POST /api/guest-form/submit` | 422, field-level validation errors |
| T14 | `PUT` after submit | `PUT /api/guest-form` | 409 Conflict |
| T15 | `PUT` after expiration | `PUT /api/guest-form` | 410 Gone |

**6.3 Driver View Status Transitions**

| # | Test | Method | Expected |
|---|---|---|---|
| T16 | `GET` pickup data | `GET /api/driver/pickup` | 200, response contains only allowed fields (no phone/email) |
| T17 | Transition `waiting` -> `picked_up` | `POST /api/driver/pickup/transition` | 200, status = `picked_up`, `driver.pickup.picked_up` event fired |
| T18 | Transition `picked_up` -> `dropped_off` | `POST /api/driver/pickup/transition` | 200, status = `dropped_off`, `driver.pickup.dropped_off` event fired |
| T19 | Transition from `dropped_off` | `POST /api/driver/pickup/transition` | 409 Conflict |
| T20 | Skip state (`waiting` -> `dropped_off`) | Direct DB manipulation + `POST` | 409 or deterministic next-state only; no skip allowed |

**6.4 Expired Token Rejection**

| # | Test | Method | Expected |
|---|---|---|---|
| T21 | Guest token 1 second past `expiresAt` | `GET /api/guest-form` | 401 |
| T22 | Driver token 1 second past `expiresAt` | `GET /api/driver/pickup` | 401 |
| T23 | Revoked token (row deleted) | `GET /api/guest-form` | 401, immediate, no cache delay |

**6.5 Rate Limiting**

| # | Test | Method | Expected |
|---|---|---|---|
| T24 | 31st request in 1 minute to guest form | `GET /api/guest-form` | 429 |
| T25 | 6th auth failure in 5 minutes | `GET /api/guest-form` with bad token | 429 |
| T26 | Rate limit resets after window | Wait, then retry | 200 |

**6.6 CORS Enforcement**

| # | Test | Method | Expected |
|---|---|---|---|
| T27 | Preflight from convention domain | `OPTIONS /api/guest-form` with `Origin: https://ops.animeboston.com` | 204, `Access-Control-Allow-Origin` = convention domain |
| T28 | Preflight from unknown origin | `OPTIONS /api/guest-form` with `Origin: https://evil.com` | No `Access-Control-Allow-Origin` header or request rejected |
| T29 | Actual request from unknown origin | `GET /api/guest-form` with `Origin: https://evil.com` | Response lacks CORS headers; browser blocks it |

### Acceptance Criteria

- All tests T1--T29 pass in the integration test suite.
- Token auth tests (T1--T7) run against the real middleware chain, not mocked auth.
- Guest form tests (T8--T15) verify JSONB state in Postgres after each operation.
- Driver view tests (T16--T20) verify domain events are emitted (captured by test event listener).
- Rate limiting tests (T24--T26) run against the real rate limiter middleware.
- CORS tests (T27--T29) verify actual response headers, not middleware configuration.
