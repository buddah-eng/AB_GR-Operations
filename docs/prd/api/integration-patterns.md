# Integration Patterns

> **One platform, many consumers.** Internal apps authenticate with API keys that
> resolve to the same RBAC roles as human users, subscribe to domain events via
> webhooks, and respect per-key rate limits. The `api_clients` and
> `webhook_subscriptions` concepts live in the ontology --- self-describing,
> CRUD-able through the standard domain router. Postgres is the system of record.
> Everything ships.

---

## Overview

The convention operations platform is a shared service. The admin UI is one
consumer; the warehouse app, calendar sync, badge printer, and future tools are
others. Every consumer authenticates the same way (API key resolving to a role),
hits the same domain CRUD endpoints, and receives the same domain events.

This PRD defines how internal applications integrate:

1. **API Key Authentication** --- registration, storage, resolution to RBAC role.
2. **Integration Examples** --- concrete patterns for warehouse, calendar, and
   badge-printing apps.
3. **Webhook / Event Subscriptions** --- how apps subscribe to domain events and
   how the event bus delivers them.
4. **Rate Limiting** --- per-key and per-endpoint throttling.
5. **API Versioning** --- current unversioned strategy and future versioned path.
6. **SDK / Client Libraries** --- auto-generated clients (future) and current
   OpenAPI approach.
7. **Test Plan** --- acceptance tests covering auth, rate limits, webhooks, and
   event filtering.

The auth system (`auth-system.md`) already defines API key as an auth method.
This document specifies the operational details --- the `api_clients` table
schema, webhook delivery mechanics, rate-limit headers, and versioning policy.

---

## 1. API Key Authentication

### Purpose

Give internal apps a stable, auditable identity that plugs into the existing
RBAC engine without special-casing.

### Detail

#### `api_clients` table

| Column              | Type        | Description                                        |
|---------------------|-------------|----------------------------------------------------|
| `id`                | `uuid`      | Primary key.                                       |
| `name`              | `text`      | Human-readable app name (e.g. "warehouse-app").    |
| `key_hash`          | `text`      | SHA-256 hash of the API key. Raw key never stored. |
| `role_key`          | `text`      | FK to the role definition in the ontology.         |
| `allowed_concepts`  | `text[]`    | Concept allow-list. Empty array = all concepts.    |
| `rate_limit_per_min`| `integer`   | Max requests per rolling 60-second window.         |
| `is_active`         | `boolean`   | Soft-disable without deleting.                     |
| `created_at`        | `timestamptz` | Row creation timestamp.                          |
| `updated_at`        | `timestamptz` | Last modification timestamp.                     |

#### Registration flow

1. Admin opens the admin UI, navigates to **Settings > API Clients**.
2. Admin fills in `name`, selects a `role_key`, optionally restricts
   `allowed_concepts`, and sets `rate_limit_per_min`.
3. Server generates a random 256-bit key, hashes it, stores the hash, and
   returns the raw key **once**. The UI displays it for copy; it is never
   retrievable again.
4. The client app sends `Authorization: Bearer <api-key>` on every request.

#### Resolution to RBAC

`authMiddleware()` detects the bearer token is not a Firebase JWT (no `.`
separators or invalid JWT structure) and falls through to the API-key path:

1. Hash the incoming key with SHA-256.
2. Look up `api_clients` by `key_hash` where `is_active = true`.
3. If not found → 401.
4. Build `AuthenticatedUser` with `actorType: 'api_client'`, `id: api_clients.id`,
   `roleKey: api_clients.role_key`.
5. `resolveRole()` loads the role from the ontology --- same path as human users.
6. If the requested concept is not in `allowed_concepts` (and the array is
   non-empty) → 403.

From this point on, the request is indistinguishable from a human request at the
RBAC layer. Audit logs record `actorType = api_client` and the client `id`.

### Acceptance Criteria

- [ ] `api_clients` table exists in Postgres with all columns above.
- [ ] Admin UI provides create / list / deactivate for API clients.
- [ ] Raw API key is shown exactly once at creation; only the hash is persisted.
- [ ] A valid API key resolves to the correct role and passes RBAC checks.
- [ ] An invalid or deactivated key returns 401.
- [ ] A key requesting a concept outside `allowed_concepts` returns 403.
- [ ] Audit log entries for API-key requests include `actorType: 'api_client'`.

---

## 2. Integration Examples

### Purpose

Demonstrate concrete consumption patterns so developers building internal apps
have a reference for which concepts, permissions, and events they need.

### Detail

#### 2a. Warehouse App

**Function:** Manages physical equipment movement, delivery scheduling, and
prep-completion tracking for convention venues.

| Concern           | Concepts                  | Actions            | Events Consumed              | Events Produced                |
|-------------------|---------------------------|--------------------|------------------------------|--------------------------------|
| Read venue layout | `venue`, `venue_area`     | `view`             | ---                          | ---                            |
| Read equipment    | `equipment`               | `view`             | `equipment.created`, `equipment.updated` | ---               |
| Write deliveries  | `delivery`                | `create`, `edit`   | ---                          | `delivery.created`, `delivery.updated` |
| Mark prep done    | `prep_task`               | `edit`             | `prep_task.created`          | `prep_task.updated`            |

**API client config:**
- `role_key`: `warehouse_operator`
- `allowed_concepts`: `["venue", "venue_area", "equipment", "delivery", "prep_task"]`
- `rate_limit_per_min`: `300`

**Typical flow:**
1. On startup, `GET /api/domains/venue` and `GET /api/domains/equipment` to
   hydrate local cache.
2. Subscribe to `equipment.*` and `prep_task.created` webhooks.
3. When a delivery arrives, `POST /api/domains/delivery` with status
   `delivered`.
4. When prep is complete, `PATCH /api/domains/prep_task/:id` with
   `status: 'complete'`, which emits `prep_task.updated`.

#### 2b. Calendar Sync

**Function:** Keeps an external Google Calendar in sync with the convention
schedule.

| Concern            | Concepts    | Actions | Events Consumed                          |
|--------------------|-------------|---------|------------------------------------------|
| Read schedule      | `schedule`  | `view`  | `schedule.created`, `schedule.updated`, `schedule.archived` |

**API client config:**
- `role_key`: `read_only`
- `allowed_concepts`: `["schedule"]`
- `rate_limit_per_min`: `60`

**Typical flow:**
1. On startup, `GET /api/domains/schedule` to do a full sync.
2. Subscribe to `schedule.*` webhooks.
3. On each event, upsert or delete the corresponding Google Calendar entry.
4. No write-back to the platform; Google Calendar is a read replica.

#### 2c. Badge System

**Function:** Queries guest and staff records to drive on-site badge printing.

| Concern         | Concepts          | Actions | Events Consumed           |
|-----------------|--------------------|---------|---------------------------|
| Print badges    | `guest`, `staff`   | `view`  | `guest.created`, `staff.updated` |

**API client config:**
- `role_key`: `badge_printer`
- `allowed_concepts`: `["guest", "staff"]`
- `rate_limit_per_min`: `120`

**Typical flow:**
1. Poll or subscribe to `guest.created` to trigger badge generation.
2. `GET /api/domains/guest/:id` to fetch full record for badge layout.
3. `GET /api/domains/staff?filter=needs_badge` for batch printing.
4. Badge printer is read-only; it never mutates platform data.

### Acceptance Criteria

- [ ] Each example app can authenticate, hit only its allowed concepts, and
      receives 403 for anything outside `allowed_concepts`.
- [ ] Each example app can subscribe to the listed events and receive webhook
      deliveries.
- [ ] The warehouse app can create and update delivery and prep_task records.
- [ ] The calendar sync and badge system cannot write to any concept.

---

## 3. Webhook / Event Subscriptions

### Purpose

Let internal apps receive domain events in near-real-time without polling.

### Detail

#### `webhook_subscriptions` concept

`webhook_subscriptions` is a concept in the ontology. It is managed through the
standard domain CRUD router (`/api/domains/webhook_subscriptions`) and through
the admin UI. Because it is ontology-defined, it is self-describing --- its
schema, permissions, and audit trail come for free.

| Property          | Type     | Description                                          |
|-------------------|----------|------------------------------------------------------|
| `id`              | `uuid`   | Primary key.                                         |
| `api_client_id`   | `uuid`   | FK to `api_clients`. Scopes ownership.               |
| `event_pattern`   | `text`   | Glob-style pattern: `schedule.*`, `equipment.created`.|
| `target_url`      | `text`   | HTTPS endpoint the event bus POSTs to.               |
| `secret`          | `text`   | Shared secret for HMAC-SHA256 signature.             |
| `is_active`       | `boolean`| Soft-disable.                                        |
| `created_at`      | `timestamptz` | Row creation timestamp.                         |

#### Event delivery

1. A domain write emits a `DomainEvent` via `emit()` (see `domain-crud.md`).
2. The event bus queries `webhook_subscriptions` for active subscriptions whose
   `event_pattern` matches the event type (glob match: `*` matches one segment,
   `**` not supported --- patterns are `concept.action`).
3. For each match, the bus POSTs to `target_url`:
   ```
   POST <target_url>
   Content-Type: application/json
   X-Signature: sha256=<HMAC of body using secret>
   X-Event-Type: schedule.updated
   X-Delivery-Id: <uuid>
   ```
   Body is the full `DomainEvent` JSON.
4. The receiving app validates `X-Signature` before processing.

#### Retry with exponential backoff

| Attempt | Delay     |
|---------|-----------|
| 1       | immediate |
| 2       | 10 s      |
| 3       | 30 s      |
| 4       | 2 min     |
| 5       | 10 min    |

After 5 failed attempts (non-2xx response or timeout after 10 s), the delivery
is marked `failed` and no further retries occur. A `webhook_delivery_failed`
internal event is emitted so monitoring can alert.

#### Registration

- **Admin UI:** Settings > Webhooks. Create, list, test, deactivate.
- **API:** `POST /api/domains/webhook_subscriptions` with a valid API key whose
  role has `create` permission on `webhook_subscriptions`. The `api_client_id`
  is auto-filled from the authenticated caller.

### Acceptance Criteria

- [ ] `webhook_subscriptions` exists as a concept in the ontology and is
      CRUD-able via the domain router.
- [ ] A matching event triggers an HTTP POST to `target_url` within 5 seconds.
- [ ] The POST includes a valid HMAC-SHA256 signature in `X-Signature`.
- [ ] Failed deliveries retry with the backoff schedule above.
- [ ] After 5 failures, delivery stops and `webhook_delivery_failed` is emitted.
- [ ] Admin UI supports create, list, test-fire, and deactivate.
- [ ] An API client can only manage its own subscriptions (scoped by
      `api_client_id`).

---

## 4. Rate Limiting

### Purpose

Protect the platform from runaway clients and ensure fair resource allocation
across consumers.

### Detail

#### Per-API-key limits

Each `api_clients` row defines `rate_limit_per_min`. The rate limiter runs as
Express middleware after auth resolution but before the route handler.

Implementation: sliding-window counter in Postgres (or Redis if available).
Key = `api_client:<id>`, window = 60 seconds.

When the limit is exceeded:
```
HTTP/1.1 429 Too Many Requests
Retry-After: <seconds until window resets>
Content-Type: application/json

{
  "error": "rate_limit_exceeded",
  "message": "Rate limit of 300 requests per minute exceeded.",
  "retryAfter": 12
}
```

#### Per-endpoint limits (public surfaces)

For any future public-facing endpoints (e.g. guest self-service), a separate
per-endpoint rate limit applies regardless of caller identity. Configured in the
ontology or environment variables. Stacks with per-key limits --- the stricter
limit wins.

#### Headers on every response

| Header                  | Value                                   |
|-------------------------|-----------------------------------------|
| `X-RateLimit-Limit`     | The per-key limit (requests per minute). |
| `X-RateLimit-Remaining` | Requests remaining in the current window.|
| `X-RateLimit-Reset`     | UTC epoch seconds when the window resets.|

### Acceptance Criteria

- [ ] A key with `rate_limit_per_min = 10` receives 429 on the 11th request
      within 60 seconds.
- [ ] The 429 response includes a `Retry-After` header with a positive integer.
- [ ] Every authenticated response includes `X-RateLimit-Limit`,
      `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.
- [ ] Rate-limit state survives server restarts (persisted, not in-memory).
- [ ] Per-endpoint limits apply independently of per-key limits.

---

## 5. API Versioning

### Purpose

Allow the API to evolve without breaking existing consumers.

### Detail

#### Current state: unversioned

All endpoints live under `/api/domains/:concept` and `/api/domains/:concept/:id`.
There is no version prefix. This is acceptable while all consumers are internal
and deployed in lockstep.

#### Future state: versioned

When breaking changes become necessary:

1. Mount the current router at `/api/v1/domains/...` in addition to `/api/domains/...`.
2. The unversioned path becomes an alias for the latest version.
3. Breaking changes (field removal, field rename, type change) ship under
   `/api/v2/domains/...`.

#### Compatibility rules

| Change                        | Breaking? | Process                              |
|-------------------------------|-----------|--------------------------------------|
| Add a new field               | No        | Ship immediately.                    |
| Add a new concept             | No        | Ship immediately.                    |
| Add a new query filter        | No        | Ship immediately.                    |
| Remove a field                | Yes       | Deprecation cycle (see below).       |
| Rename a field                | Yes       | Deprecation cycle.                   |
| Change a field's type         | Yes       | Deprecation cycle.                   |
| Remove a concept              | Yes       | Deprecation cycle.                   |

#### Deprecation cycle

1. Add `Sunset: <date>` header to affected endpoints (RFC 8594).
2. Log warnings when deprecated fields are accessed.
3. Minimum 90 days between sunset announcement and removal.
4. Communicate via internal changelog and admin UI banner.

### Acceptance Criteria

- [ ] Adding a new field to a concept does not require a version bump.
- [ ] When a breaking change ships, the previous version remains available at
      its versioned path.
- [ ] Deprecated endpoints return a `Sunset` header with an ISO 8601 date.
- [ ] Internal changelog documents every deprecation with a migration guide.

---

## 6. SDK / Client Libraries

### Purpose

Reduce boilerplate and integration errors for internal app developers.

### Detail

#### Now: OpenAPI spec + documented REST

1. The platform exposes an OpenAPI 3.1 spec at `/api/openapi.json`,
   auto-generated from the ontology (concept schemas, endpoint shapes, auth
   requirements).
2. Internal developers use the spec with standard HTTP clients (fetch, axios).
3. The spec is versioned in the repo under `docs/api/openapi.json` and
   regenerated on ontology changes.

#### Future: auto-generated TypeScript client

1. Run `openapi-typescript-codegen` (or equivalent) against the spec to produce
   a typed client library.
2. Publish as an internal npm package (`@convention/api-client`).
3. The client handles auth header injection, rate-limit retry, and typed
   request/response objects.
4. Regenerated automatically when the ontology changes (CI step).

#### Client responsibilities

Regardless of SDK availability, every client must:

- Store the API key securely (environment variable, secret manager --- never
  source code).
- Validate `X-Signature` on webhook deliveries.
- Respect `Retry-After` on 429 responses.
- Handle 503 (maintenance) gracefully with backoff.

### Acceptance Criteria

- [ ] `/api/openapi.json` returns a valid OpenAPI 3.1 document.
- [ ] The spec includes all concepts currently in the ontology.
- [ ] The spec includes auth requirements (`bearerAuth`).
- [ ] (Future) The generated TypeScript client compiles without errors against
      the spec.

---

## 7. Test Plan

### Purpose

Verify that integration patterns work end-to-end and degrade gracefully under
failure conditions.

### Detail

#### 7a. API Key Auth Flow

| Test                                          | Method                        | Expected                          |
|-----------------------------------------------|-------------------------------|-----------------------------------|
| Valid key, allowed concept                    | `GET /api/domains/schedule`   | 200, correct data.                |
| Valid key, disallowed concept                 | `GET /api/domains/finance`    | 403.                              |
| Invalid key                                   | `GET /api/domains/schedule`   | 401.                              |
| Deactivated key                               | `GET /api/domains/schedule`   | 401.                              |
| Key resolves correct role                     | Check `req.user.roleKey`      | Matches `api_clients.role_key`.   |
| Audit log records actor type                  | Query audit log               | `actorType = 'api_client'`.       |

#### 7b. Rate Limiting Enforcement

| Test                                          | Method                        | Expected                          |
|-----------------------------------------------|-------------------------------|-----------------------------------|
| Under limit                                   | N requests < limit            | All 200, headers present.         |
| At limit                                      | Request N+1                   | 429, `Retry-After` > 0.          |
| After window reset                            | Wait, then request            | 200.                              |
| Rate-limit headers on every response          | Any authenticated request     | `X-RateLimit-*` headers present.  |

#### 7c. Webhook Delivery + Retry

| Test                                          | Setup                          | Expected                          |
|-----------------------------------------------|--------------------------------|-----------------------------------|
| Successful delivery                           | Target returns 200             | Event delivered, signature valid. |
| Target down, then recovers                    | 500 on first 2 attempts, 200 on 3rd | Retries with backoff, delivers.  |
| Target permanently down                       | 500 on all 5 attempts          | Stops after 5, emits `webhook_delivery_failed`. |
| Signature validation                          | Compute HMAC client-side       | Matches `X-Signature` header.    |

#### 7d. Event Subscription Filtering

| Test                                          | Setup                          | Expected                          |
|-----------------------------------------------|--------------------------------|-----------------------------------|
| Exact match                                   | Pattern `schedule.created`     | Fires on `schedule.created` only.|
| Wildcard match                                | Pattern `schedule.*`           | Fires on any `schedule` event.   |
| No match                                      | Pattern `equipment.*`          | Does not fire on `schedule.*`.   |
| Inactive subscription                         | `is_active = false`            | Does not fire.                   |

### Acceptance Criteria

- [ ] All tests in 7a--7d pass in CI.
- [ ] Tests use isolated API client records (created in setup, deactivated in
      teardown).
- [ ] Webhook tests use a local HTTP server as the target (no external
      dependencies).
- [ ] Rate-limit tests account for timing tolerance (allow +/- 1 second on
      window boundaries).
