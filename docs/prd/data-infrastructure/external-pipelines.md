# External Data Pipelines

> **Third-party API integrations as managed, monitored, auditable pipelines.** Inbound (FlightAware -> platform), outbound (platform -> Guidebook), bidirectional (platform <-> Google Calendar). Connection definitions with endpoint, auth, polling interval. Sync state tracking (last_sync_at, cursor, pagination). Retry with exponential backoff and circuit breaker. Rate limiting respects external API limits. Credentials in Secret Manager, never in DB. Webhook receivers for inbound push. Builds on top of internal pipelines and data routing for the actual data movement; this PRD defines the external boundary layer.

---

## Overview

The convention operations platform integrates with multiple external services: FlightAware for flight tracking, Blacklane/Karhoo for ride booking, Google Calendar for schedule sync, Guidebook for attendee-facing schedule publishing. Each integration has different characteristics -- some are inbound (data flows into the platform), some are outbound (data flows out), some are bidirectional (data flows both ways with conflict resolution).

Today these integrations are scattered across individual PRDs (`transport-logistics.md`, `google-calendar-sync.md`, `guidebook-integration.md`) as domain-specific features. This PRD extracts the common infrastructure: connection management, sync state tracking, retry/backoff, rate limiting, credential storage, and webhook reception. The domain-specific behavior (what data is synced, how it maps) remains in the domain PRDs; this PRD provides the plumbing.

External pipelines extend the internal pipeline system (`data-infrastructure/internal-pipelines.md`) with external boundary concerns: authentication, network failures, rate limits, sync cursors, and conflict resolution. An external pipeline wraps a connection definition, a sync direction, a data mapping, and error handling into a managed, monitored unit.

**Dependencies:** `data-infrastructure/internal-pipelines.md`, `data-infrastructure/data-routing.md`, `data-infrastructure/data-transforms.md`, `core/event-bus.md`, `core/audit-system.md`, `api/integration-patterns.md`

---

## 1. Connection Definition

### Purpose

Define the data model for an external service connection -- credentials, endpoint, authentication method, and operational parameters.

### Detail

```sql
CREATE TABLE external_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL UNIQUE,          -- e.g. 'flightaware', 'guidebook', 'google-calendar'
  display_name        TEXT NOT NULL,                  -- e.g. 'FlightAware AeroAPI'
  provider            TEXT NOT NULL,                  -- e.g. 'flightaware', 'guidebook', 'google'
  description         TEXT,

  -- Endpoint
  base_url            TEXT NOT NULL,                  -- e.g. 'https://aeroapi.flightaware.com/aeroapi'
  api_version         TEXT,                           -- e.g. 'v2', 'v3'

  -- Authentication
  auth_method         TEXT NOT NULL CHECK (auth_method IN (
    'api_key',        -- API key in header or query param
    'oauth2',         -- OAuth 2.0 with token refresh
    'service_account',-- Google service account JSON
    'basic',          -- Basic auth (username/password)
    'bearer',         -- Static bearer token
    'webhook_secret'  -- HMAC signature verification for inbound webhooks
  )),
  auth_config         JSONB NOT NULL,                -- method-specific config (key location, scopes, etc.)
  credential_ref      TEXT NOT NULL,                  -- Secret Manager reference (never the actual secret)

  -- Operational
  rate_limit_rpm      INTEGER,                        -- requests per minute allowed
  rate_limit_daily    INTEGER,                        -- requests per day allowed
  default_timeout_ms  INTEGER NOT NULL DEFAULT 30000,
  polling_interval_s  INTEGER,                        -- for poll-based integrations (e.g. 900 = 15 min)

  -- Health
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'degraded', 'disabled', 'auth_expired'
  )),
  last_health_check   TIMESTAMPTZ,
  last_error          TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  owner_department    TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ext_conn_provider ON external_connections (provider);
CREATE INDEX idx_ext_conn_status ON external_connections (status);
```

**Auth configuration examples:**

```json
// api_key
{
  "key_location": "header",
  "header_name": "x-apikey",
  "key_prefix": ""
}

// oauth2
{
  "token_url": "https://accounts.google.com/o/oauth2/token",
  "scopes": ["https://www.googleapis.com/auth/calendar"],
  "grant_type": "authorization_code"
}

// service_account
{
  "project_id": "my-project",
  "scopes": ["https://www.googleapis.com/auth/calendar"]
}

// webhook_secret
{
  "signature_header": "X-Hub-Signature-256",
  "algorithm": "sha256"
}
```

**Credential storage:** The `credential_ref` field contains a GCP Secret Manager resource name (e.g., `projects/my-project/secrets/flightaware-api-key/versions/latest`). The actual credential is never stored in Postgres. The connection service loads credentials from Secret Manager at runtime, caches them in application memory with TTL, and never logs them.

### Acceptance Criteria

- [ ] `external_connections` table exists with all specified columns and constraints
- [ ] All six auth methods are representable and functional
- [ ] `credential_ref` points to Secret Manager, never contains the actual secret
- [ ] Connection status reflects current health (active, degraded, disabled, auth_expired)
- [ ] Rate limit configuration is enforced at the connection level
- [ ] Default timeout is 30 seconds

---

## 2. Inbound Pipelines

### Purpose

Define how data flows from external APIs into the platform -- polling external endpoints, transforming responses, and creating/updating records.

### Detail

An inbound pipeline polls an external API on a schedule, transforms the response, and upserts records into the platform.

**Inbound pipeline flow:**

```
1. Scheduler triggers pipeline (cron or event-based)
2. Load connection credentials from Secret Manager
3. Build request: base_url + path + query params + auth headers
4. Execute HTTP request (with timeout, retry, rate limit)
5. Parse response (JSON, XML, CSV)
6. Transform response records (data-transforms.md)
7. For each record:
   a. Match against existing platform records (by external_id or match field)
   b. If match: UPDATE existing record with new values
   c. If no match: INSERT new record
   d. Emit domain event: {concept}.external_created or {concept}.external_updated
8. Update sync state (cursor, last_sync_at, records_processed)
9. Write audit log entry
```

**Example: FlightAware inbound pipeline.**

```json
{
  "name": "FlightAware Flight Status Poll",
  "direction": "inbound",
  "connection_id": "conn-flightaware",
  "trigger": {
    "type": "scheduled",
    "interval_seconds": 900
  },
  "request": {
    "method": "GET",
    "path": "/flights/{{flight_number}}/position",
    "query_params": {},
    "pagination": null
  },
  "source_query": {
    "concept": "transport_booking",
    "filter": {
      "type": "and",
      "conditions": [
        { "type": "field", "field": "flight_number", "operator": "is_not_empty" },
        { "type": "field", "field": "status", "operator": "not_contains", "value": "dropped_off" },
        { "type": "field", "field": "status", "operator": "neq", "value": "canceled" }
      ]
    }
  },
  "response_mapping": {
    "last_position.fa_flight_id": "external_flight_id",
    "last_position.estimated_on": "flight_eta",
    "last_position.status": "flight_status"
  },
  "transform_id": "transform-flightaware-status",
  "target_concept": "transport_booking",
  "match_field": "flight_number",
  "upsert_mode": "update_only"
}
```

**Upsert modes:**

| Mode | Behavior |
|------|----------|
| `insert_only` | Create new records, never update existing |
| `update_only` | Update existing records, never create new (FlightAware -- updates bookings) |
| `upsert` | Create if not found, update if found (default) |

**Pagination support:** For APIs that return paginated results:

```json
{
  "pagination": {
    "type": "cursor",
    "cursor_field": "next_cursor",
    "cursor_param": "cursor"
  }
}
```

Supported pagination types: `cursor`, `offset`, `page_number`, `link_header`.

### Acceptance Criteria

- [ ] Inbound pipeline polls external API at configured interval
- [ ] HTTP requests include correct authentication from Secret Manager
- [ ] Response records are transformed before upserting
- [ ] Upsert respects the configured mode (insert_only, update_only, upsert)
- [ ] Domain events use `external_created` and `external_updated` actions (not `created`/`updated`)
- [ ] Pagination handles multi-page responses correctly
- [ ] Sync state is updated after each poll cycle

---

## 3. Outbound Pipelines

### Purpose

Define how data flows from the platform to external APIs -- triggered by domain events, transforming records, and pushing to external endpoints.

### Detail

An outbound pipeline reacts to domain events and pushes data to an external API.

**Outbound pipeline flow:**

```
1. Domain event fires (e.g., schedule_event.created)
2. Pipeline trigger matches the event
3. Load connection credentials from Secret Manager
4. Transform the record for external API format (data-transforms.md)
5. Build request: base_url + path + body + auth headers
6. Execute HTTP request (with timeout, retry, rate limit)
7. Parse response: extract external_id, confirmation, etc.
8. Write external_id back to the platform record
9. Update sync state
10. Emit domain event: {concept}.synced
11. Write audit log entry
```

**Example: Guidebook outbound pipeline.**

```json
{
  "name": "Guidebook Session Publish",
  "direction": "outbound",
  "connection_id": "conn-guidebook",
  "trigger": {
    "type": "domain_event",
    "event_pattern": "schedule_event.*",
    "condition": {
      "type": "and",
      "conditions": [
        { "type": "field", "field": "status", "operator": "eq", "value": "published" },
        { "type": "field", "field": "is_public", "operator": "eq", "value": true }
      ]
    }
  },
  "source_concept": "schedule_event",
  "transform_id": "transform-schedule-to-guidebook",
  "request": {
    "create": {
      "method": "POST",
      "path": "/api/v2/sessions/",
      "body_mapping": {
        "name": "{{title}}",
        "start_time": "{{start_time}}",
        "end_time": "{{end_time}}",
        "description_html": "{{description}}",
        "locations": ["{{venue_guidebook_id}}"]
      }
    },
    "update": {
      "method": "PUT",
      "path": "/api/v2/sessions/{{external_id}}/",
      "body_mapping": {
        "name": "{{title}}",
        "start_time": "{{start_time}}",
        "end_time": "{{end_time}}",
        "description_html": "{{description}}"
      }
    },
    "delete": {
      "method": "DELETE",
      "path": "/api/v2/sessions/{{external_id}}/"
    }
  },
  "external_id_field": "guidebook_session_id",
  "external_id_response_path": "id"
}
```

**Create vs. update logic:** If the platform record has an `external_id_field` value, the pipeline uses the `update` request template. If null, it uses `create` and writes the returned ID back. If the record is archived/deleted, it uses `delete`.

**Incremental sync:** Outbound pipelines track `last_published_at` per record. On batch sync (manual or scheduled), only records changed since `last_published_at` are pushed.

### Acceptance Criteria

- [ ] Outbound pipeline triggers on domain events matching the configured pattern
- [ ] Records with no external_id use the `create` request template
- [ ] Records with an existing external_id use the `update` request template
- [ ] Deleted/archived records use the `delete` request template
- [ ] External ID from response is written back to the platform record
- [ ] Incremental sync only pushes records changed since last publish
- [ ] `{concept}.synced` domain event fires after successful push

---

## 4. Bidirectional Pipelines

### Purpose

Define how data flows in both directions between the platform and an external service, with conflict resolution.

### Detail

Bidirectional pipelines combine inbound and outbound flows with a conflict resolution strategy. The platform remains the system of record, but external changes are detected and reconciled.

**Bidirectional pipeline flow:**

```
OUTBOUND (platform -> external):
  Same as section 3, triggered by domain events.

INBOUND (external -> platform):
  1. Detect external changes via webhook or polling
  2. Compare external record to platform record
  3. If no difference: skip
  4. If difference detected: apply conflict resolution strategy
  5. Update platform record (or create pending review item)
```

**Conflict resolution strategies:**

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `platform_wins` | Platform value always takes precedence. External change is overwritten on next outbound push. | Guidebook (platform is SOR, external is read-only) |
| `external_wins` | External value takes precedence. Platform record is updated. | Flight tracking (external is authoritative) |
| `last_write_wins` | Most recent change (by timestamp) takes precedence. | Low-risk fields like notes/descriptions |
| `manual_merge` | Changes are queued for human review. A `sync_pending` record is created. | Schedule changes in Google Calendar (high-risk) |
| `field_level` | Different strategies per field. | Mixed: time changes need review, description changes auto-accept |

**Example: Google Calendar bidirectional pipeline.**

```json
{
  "name": "Google Calendar Bidirectional Sync",
  "direction": "bidirectional",
  "connection_id": "conn-google-calendar",
  "outbound": {
    "trigger": {
      "type": "domain_event",
      "event_pattern": "schedule_event.*"
    },
    "source_concept": "schedule_event",
    "transform_id": "transform-schedule-to-gcal",
    "request": {
      "create": { "method": "POST", "path": "/calendars/{{calendar_id}}/events" },
      "update": { "method": "PUT", "path": "/calendars/{{calendar_id}}/events/{{gcal_event_id}}" },
      "delete": { "method": "DELETE", "path": "/calendars/{{calendar_id}}/events/{{gcal_event_id}}" }
    },
    "external_id_field": "gcal_event_id"
  },
  "inbound": {
    "trigger": {
      "type": "webhook",
      "path": "/webhooks/google-calendar",
      "fallback_polling_interval_s": 900
    },
    "transform_id": "transform-gcal-to-schedule",
    "target_concept": "schedule_event",
    "match_field": "gcal_event_id"
  },
  "conflict_resolution": {
    "default_strategy": "manual_merge",
    "field_overrides": {
      "description": "last_write_wins",
      "notes": "last_write_wins",
      "start_time": "manual_merge",
      "end_time": "manual_merge",
      "title": "manual_merge"
    },
    "auto_accept_threshold_minutes": 15
  }
}
```

**Sync pending records** (for `manual_merge`):

This uses the `calendar_sync_pending` table defined in `shared-services/google-calendar-sync.md`. The external pipelines infrastructure generalizes this into a `sync_pending` table:

```sql
CREATE TABLE sync_pending (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id         UUID NOT NULL REFERENCES external_pipelines(id),
  connection_id       UUID NOT NULL REFERENCES external_connections(id),
  platform_record_id  UUID NOT NULL,
  platform_concept    TEXT NOT NULL,
  external_id         TEXT NOT NULL,

  field_changes       JSONB NOT NULL,    -- { "field": { "platform": "...", "external": "..." }, ... }
  direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'rejected', 'auto_resolved'
  )),
  resolved_by         UUID,
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT,

  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_pending_status ON sync_pending (status) WHERE status = 'pending';
CREATE INDEX idx_sync_pending_pipeline ON sync_pending (pipeline_id, created_at DESC);
CREATE INDEX idx_sync_pending_record ON sync_pending (platform_record_id);
```

### Acceptance Criteria

- [ ] Bidirectional pipelines support outbound push triggered by domain events
- [ ] Bidirectional pipelines support inbound detection via webhook or polling
- [ ] All five conflict resolution strategies are implemented
- [ ] `field_level` strategy allows different strategies per field
- [ ] `manual_merge` creates `sync_pending` records for human review
- [ ] `auto_accept_threshold_minutes` auto-resolves small time changes
- [ ] Resolved sync_pending records record who resolved them and when
- [ ] Conflict resolution is audited

---

## 5. Sync State Tracking

### Purpose

Define how the platform tracks synchronization state per connection and per record to enable incremental sync and failure recovery.

### Detail

```sql
CREATE TABLE sync_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES external_connections(id),
  pipeline_id         UUID NOT NULL,
  concept_key         TEXT NOT NULL,         -- which concept is being synced

  -- Sync cursor
  last_sync_at        TIMESTAMPTZ,           -- when the last sync completed
  sync_token          TEXT,                   -- external API's sync/delta token
  cursor_value        TEXT,                   -- pagination cursor for interrupted syncs
  page_number         INTEGER,               -- for page-based pagination

  -- Counters
  total_synced        INTEGER NOT NULL DEFAULT 0,
  total_created       INTEGER NOT NULL DEFAULT 0,
  total_updated       INTEGER NOT NULL DEFAULT 0,
  total_deleted       INTEGER NOT NULL DEFAULT 0,
  total_errors        INTEGER NOT NULL DEFAULT 0,

  -- Error state
  last_error          TEXT,
  last_error_at       TIMESTAMPTZ,
  consecutive_errors  INTEGER NOT NULL DEFAULT 0,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (connection_id, pipeline_id, concept_key)
);

CREATE INDEX idx_sync_state_connection ON sync_state (connection_id);
CREATE INDEX idx_sync_state_last_sync ON sync_state (last_sync_at);
```

**Per-record sync tracking:**

Each platform record that syncs with an external service tracks its external ID and last sync time:

```sql
-- Added to domain data tables via ontology properties
-- external_id:      TEXT     -- the ID in the external system
-- external_synced_at: TIMESTAMPTZ -- when this record was last synced
-- external_sync_hash: TEXT    -- hash of last synced data (for change detection)
```

**Change detection:** Before pushing a record outbound, compute a hash of the syncable fields. Compare to `external_sync_hash`. If identical, skip the push (no changes since last sync).

**Interrupted sync recovery:** If a sync is interrupted (timeout, crash), the `cursor_value` and `page_number` in `sync_state` allow resuming from where the sync stopped rather than restarting from the beginning.

### Acceptance Criteria

- [ ] `sync_state` table tracks per-connection, per-pipeline sync progress
- [ ] `last_sync_at` is updated after each successful sync cycle
- [ ] `sync_token` is preserved for APIs that support delta/incremental tokens (e.g., Google Calendar)
- [ ] Interrupted syncs resume from the stored cursor, not from the beginning
- [ ] Change detection via hash prevents unnecessary outbound pushes
- [ ] Error counters track consecutive failures for circuit breaker logic

---

## 6. Retry, Backoff, and Circuit Breaker

### Purpose

Define resilient HTTP request handling for external API calls.

### Detail

**Retry with exponential backoff:**

```
Request fails (network error or 5xx response)
  -> Retry 1: wait 1s
  -> Retry 2: wait 2s
  -> Retry 3: wait 4s
  -> Retry 4: wait 8s
  -> Max retries exhausted: record failure, move to dead letter queue
```

Configuration per connection:

```json
{
  "max_retries": 4,
  "initial_delay_ms": 1000,
  "max_delay_ms": 30000,
  "backoff_multiplier": 2,
  "retry_on_status": [408, 429, 500, 502, 503, 504]
}
```

**429 (Too Many Requests) handling:**

When the external API returns 429, the pipeline:
1. Reads the `Retry-After` header (seconds or HTTP date).
2. Waits the specified duration.
3. Retries the request.
4. If `Retry-After` is absent, falls back to the exponential backoff schedule.

**Circuit breaker:**

Prevents cascading failures by temporarily disabling requests to a failing service.

| State | Behavior | Transition |
|-------|----------|------------|
| `closed` | Requests flow normally | -> `open` after N consecutive failures |
| `open` | All requests fail immediately (no network call) | -> `half_open` after cooldown period |
| `half_open` | One probe request allowed | -> `closed` on success, -> `open` on failure |

Configuration:

```json
{
  "failure_threshold": 5,
  "cooldown_period_ms": 60000,
  "success_threshold": 2
}
```

When the circuit breaker opens, the connection status changes to `degraded`. An `integration.circuit_open` domain event fires, triggering admin notification. When the circuit closes, an `integration.circuit_closed` event fires.

**Rate limiting:**

The pipeline enforces the connection's `rate_limit_rpm` and `rate_limit_daily` limits using a token bucket algorithm. Requests exceeding the limit are queued (not rejected) and executed when capacity is available.

```typescript
interface RateLimiter {
  acquire(): Promise<void>  // blocks until a token is available
  remaining(): number       // tokens remaining in current window
}
```

### Acceptance Criteria

- [ ] Retries use exponential backoff with configurable parameters
- [ ] 429 responses respect the `Retry-After` header
- [ ] Circuit breaker opens after N consecutive failures
- [ ] Circuit breaker transitions to half-open after cooldown period
- [ ] Successful probe request in half-open state closes the circuit
- [ ] Connection status reflects circuit breaker state
- [ ] Domain events fire on circuit state transitions
- [ ] Rate limiting queues excess requests rather than rejecting them
- [ ] Rate limits respect both RPM and daily caps

---

## 7. Credential Storage

### Purpose

Define secure credential management for external service authentication.

### Detail

**Principle:** No credential material (API keys, OAuth tokens, service account JSON) is ever stored in Postgres, application logs, error messages, or source code. All credentials are stored in GCP Secret Manager and referenced by name.

**Credential lifecycle:**

1. **Storage:** Admin provides credentials via a secure UI (input field with `type="password"`). The platform writes them directly to Secret Manager and stores only the Secret Manager reference in `external_connections.credential_ref`.

2. **Loading:** At pipeline execution time, the connection service loads the credential from Secret Manager using the IAM-authenticated service account. Credentials are cached in application memory with a 1-hour TTL.

3. **Rotation:** New credentials are stored as a new version in Secret Manager. The `credential_ref` can reference `latest` (auto-rotate) or a specific version (manual rotation).

4. **Revocation:** Disabling a connection does not delete the credential from Secret Manager. Credentials are deleted from Secret Manager only when the connection is permanently removed.

**OAuth token refresh:**

For OAuth2 connections, the pipeline stores the refresh token in Secret Manager. When the access token expires, the pipeline:
1. Reads the refresh token from Secret Manager.
2. Calls the token endpoint to get a new access token.
3. Stores the new access token in application memory (1-hour cache).
4. If the refresh token is also rotated (rotating refresh tokens), stores the new refresh token in Secret Manager.
5. If the refresh token is invalid/expired, sets connection status to `auth_expired` and emits `integration.auth_expired` event.

### Acceptance Criteria

- [ ] No credential material in Postgres (only Secret Manager references)
- [ ] No credential material in application logs (log scrubbing)
- [ ] No credential material in error messages returned to clients
- [ ] Credentials cached in application memory with TTL, not in Redis or external cache
- [ ] OAuth token refresh handles rotating refresh tokens
- [ ] Expired auth sets connection status to `auth_expired` with admin notification
- [ ] Credential deletion only occurs when connection is permanently removed

---

## 8. Webhook Receivers

### Purpose

Define how the platform accepts inbound webhooks from external services for real-time change detection.

### Detail

External services can push changes to the platform via webhooks instead of requiring polling. The platform exposes a webhook receiver endpoint per connection.

**Webhook endpoint:**

```
POST /api/webhooks/:connection_name
```

**Request processing:**

1. **Signature verification:** Validate the request signature using the connection's `webhook_secret` credential and `auth_config.signature_header` / `auth_config.algorithm`. Reject if invalid.

2. **Rate limiting:** Webhook endpoints have their own rate limit (configurable, default 100 RPM) to prevent abuse.

3. **Payload parsing:** Parse the request body per the connection's expected format (JSON, form-encoded, etc.).

4. **Event mapping:** Map the external webhook event type to a platform domain event action:

```json
{
  "webhook_event_mapping": {
    "event.created": "external_created",
    "event.updated": "external_updated",
    "event.deleted": "deleted",
    "booking.status_changed": "external_updated"
  }
}
```

5. **Pipeline trigger:** Fire the mapped domain event, which triggers the inbound pipeline for processing.

6. **Response:** Return 200 immediately to prevent webhook timeout. Processing happens asynchronously via the event bus.

**Webhook registration:** For services that require explicit webhook registration (Google Calendar push notifications), the platform registers webhooks on connection activation and renews them before expiration.

**Google Calendar specific:**

Google Calendar push notifications use a channel model:
1. Platform registers a notification channel via `POST /calendars/{calendarId}/events/watch`.
2. Google sends a POST to the platform's webhook URL when events change.
3. The webhook payload contains a `resourceUri` and `channelId` -- the platform fetches the actual changes via a subsequent API call.
4. Channels expire and must be renewed (default: before the `expiration` timestamp).

### Acceptance Criteria

- [ ] Webhook endpoints validate request signatures before processing
- [ ] Invalid signatures return 401 and do not process the payload
- [ ] Webhook payloads are mapped to domain events using the connection's event mapping
- [ ] Webhook processing is asynchronous -- endpoint returns 200 immediately
- [ ] Webhook rate limiting prevents abuse (configurable per connection)
- [ ] Google Calendar push notification channels are registered and renewed automatically
- [ ] Webhook receiver is idempotent -- duplicate deliveries do not create duplicate records

---

## 9. External Pipeline Storage

### Purpose

Define the data model for external pipeline definitions.

### Detail

```sql
CREATE TABLE external_pipelines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,

  -- Connection
  connection_id       UUID NOT NULL REFERENCES external_connections(id),
  direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),

  -- Pipeline config (direction-specific)
  inbound_config      JSONB,               -- inbound pipeline configuration
  outbound_config     JSONB,               -- outbound pipeline configuration
  conflict_resolution JSONB,               -- for bidirectional only

  -- Sync
  sync_mode           TEXT NOT NULL DEFAULT 'incremental' CHECK (sync_mode IN (
    'incremental',    -- only changed records since last_sync_at
    'full',           -- all records every time
    'delta_token'     -- use external API's delta/sync token
  )),

  -- Lifecycle
  enabled             BOOLEAN NOT NULL DEFAULT true,
  version             INTEGER NOT NULL DEFAULT 1,
  owner_department    TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, version)
);

CREATE INDEX idx_ext_pipeline_connection ON external_pipelines (connection_id) WHERE enabled = true;
CREATE INDEX idx_ext_pipeline_direction ON external_pipelines (direction) WHERE enabled = true;
```

**Validation on creation:**
1. `connection_id` references an active connection
2. `direction = 'inbound'` requires `inbound_config` to be set
3. `direction = 'outbound'` requires `outbound_config` to be set
4. `direction = 'bidirectional'` requires both configs and `conflict_resolution`
5. All referenced concepts exist in the ontology
6. All referenced transforms exist and are active

### Acceptance Criteria

- [ ] `external_pipelines` table exists with all specified columns
- [ ] Direction-specific configuration is validated on creation
- [ ] Bidirectional pipelines require conflict resolution configuration
- [ ] Pipeline references a valid, active connection
- [ ] Pipeline versioning follows the same pattern as internal pipelines

---

## 10. Integration with Existing PRDs

### Purpose

Define how external pipelines relate to domain-specific integration PRDs.

### Detail

| Existing PRD | External Pipeline | Direction | Connection |
|-------------|-------------------|-----------|------------|
| `shared-services/google-calendar-sync.md` | Google Calendar Sync | Bidirectional | `google-calendar` (service_account) |
| `shared-services/guidebook-integration.md` | Guidebook Publisher | Outbound | `guidebook` (api_key) |
| `modules/guest-relations/transport-logistics.md` | FlightAware Poller | Inbound | `flightaware` (api_key) |
| `modules/guest-relations/transport-logistics.md` | Blacklane Booking | Outbound + webhook | `blacklane` (api_key) |

**Relationship to existing PRDs:** The domain PRDs define WHAT data is synced and the business rules. This PRD defines HOW the sync infrastructure works. The domain PRDs become consumers of this infrastructure:

- `google-calendar-sync.md` defines the field mapping, calendar structure, and sync pending UI. This PRD provides the connection, webhook receiver, conflict resolution engine, and sync state tracking.
- `guidebook-integration.md` defines the eligibility filters and data mapping. This PRD provides the connection, rate limiting, retry logic, and incremental sync.
- `transport-logistics.md` defines the FlightAware polling schedule and status mapping. This PRD provides the connection, polling scheduler, and circuit breaker.

### Acceptance Criteria

- [ ] Google Calendar sync uses the bidirectional pipeline infrastructure
- [ ] Guidebook publishing uses the outbound pipeline infrastructure
- [ ] FlightAware polling uses the inbound pipeline infrastructure
- [ ] Existing domain PRDs are not duplicated -- they define business rules, this PRD defines infrastructure
- [ ] All existing integration patterns are expressible using the external pipeline model

---

## 11. Test Plan

### 11.1 Connection Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CN-01 | Unit | Create connection with api_key auth | Connection created, credential stored in Secret Manager |
| CN-02 | Unit | Create connection with oauth2 auth | Connection created with token_url and scopes |
| CN-03 | Unit | Load credential at runtime | Credential fetched from Secret Manager, cached |
| CN-04 | Unit | Credential not in Postgres | Query external_connections, credential_ref is a Secret Manager path |
| CN-05 | Unit | Credential not in logs | Execute pipeline with logging, grep logs for credential | Zero matches |

### 11.2 Inbound Pipeline Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| IN-01 | Integration | Poll FlightAware for flight status | transport_booking updated with new ETA |
| IN-02 | Integration | Poll with pagination (3 pages) | All records from all pages processed |
| IN-03 | Integration | Poll with no changes since last sync | Zero records processed, sync_state updated |
| IN-04 | Integration | Poll returns new record (upsert mode) | New record created with external_created event |
| IN-05 | Integration | Poll returns updated record (upsert mode) | Existing record updated with external_updated event |
| IN-06 | Integration | Poll returns error (500) | Retry with backoff, error logged |
| IN-07 | Integration | Interrupted sync resumes from cursor | Processing starts from stored cursor_value |

### 11.3 Outbound Pipeline Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| OB-01 | Integration | Create schedule_event (no external_id) | POST to Guidebook, external_id written back |
| OB-02 | Integration | Update schedule_event (has external_id) | PUT to Guidebook, record updated |
| OB-03 | Integration | Delete schedule_event | DELETE to Guidebook, record removed |
| OB-04 | Integration | Incremental sync with 10 changed, 90 unchanged | Only 10 records pushed |
| OB-05 | Integration | External API returns 429 | Pipeline respects Retry-After header |
| OB-06 | Integration | External API returns 500 | Retry with exponential backoff |

### 11.4 Bidirectional Pipeline Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| BD-01 | Integration | Platform change pushed to Google Calendar | Gcal event updated |
| BD-02 | Integration | Google Calendar change detected via webhook | sync_pending record created (manual_merge) |
| BD-03 | Integration | User accepts sync_pending | Platform record updated, sync_pending resolved |
| BD-04 | Integration | User rejects sync_pending | Platform value pushed back to Google Calendar |
| BD-05 | Integration | Description change (last_write_wins) | Auto-accepted, no sync_pending |
| BD-06 | Integration | Time change > 15 min (manual_merge) | sync_pending created for review |
| BD-07 | Integration | Time change < 15 min (auto_accept_threshold) | Auto-accepted with notification |

### 11.5 Resilience Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| RS-01 | Integration | 5 consecutive failures | Circuit breaker opens, connection status `degraded` |
| RS-02 | Integration | Circuit open, probe succeeds | Circuit closes, connection status `active` |
| RS-03 | Integration | Rate limit exceeded | Requests queued, not rejected |
| RS-04 | Integration | OAuth token expired | Token refreshed, request retried |
| RS-05 | Integration | Refresh token expired | Connection status `auth_expired`, admin notified |
| RS-06 | Integration | Webhook with invalid signature | 401 returned, payload not processed |
| RS-07 | Integration | Duplicate webhook delivery | Idempotent -- no duplicate records |

### 11.6 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| Inbound poll with 1000 records | Single poll cycle | < 30s including transforms |
| Outbound push of 500 records | Batch sync | < 60s respecting rate limits |
| 100 concurrent webhook deliveries | Burst webhook traffic | All processed, < 5s latency |
| Sync state query for dashboard | 10,000 sync_state rows | < 500ms |

### 11.7 Security Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| SC-01 | Security | Grep all code and logs for credential values | Zero matches |
| SC-02 | Security | Query external_connections for plaintext secrets | credential_ref contains Secret Manager path only |
| SC-03 | Security | Webhook without signature | 401 Unauthorized |
| SC-04 | Security | Webhook with wrong signature | 401 Unauthorized |
| SC-05 | Security | Error response from external API with credentials in URL | Credentials scrubbed from error log |

**Coverage target:** >=80% on pipeline executor, connection service, and sync state manager. 100% on credential handling, webhook signature verification, and circuit breaker logic.

---

## 12. Dependencies

| PRD | Relationship |
|-----|-------------|
| `data-infrastructure/internal-pipelines.md` | External pipelines extend the internal pipeline model |
| `data-infrastructure/data-routing.md` | External pipelines use routes for data movement |
| `data-infrastructure/data-transforms.md` | Response/request transforms use the transform engine |
| `core/event-bus.md` | Pipeline triggers and domain events |
| `core/audit-system.md` | Pipeline executions are audited |
| `core/condition-expression.md` | Trigger conditions use the shared evaluator |
| `api/integration-patterns.md` | API auth patterns and webhook infrastructure |
| `data/encryption.md` | Credential storage references Secret Manager |
| `shared-services/google-calendar-sync.md` | Domain-specific sync rules for Google Calendar |
| `shared-services/guidebook-integration.md` | Domain-specific publishing rules for Guidebook |
| `modules/guest-relations/transport-logistics.md` | Domain-specific FlightAware/Blacklane integration |
