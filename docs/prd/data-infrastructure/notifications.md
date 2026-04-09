# Notification Infrastructure

> The `notify` workflow action fires a `notification.requested` event, but nothing subscribes to it.
> This PRD defines the delivery system: recipient resolution, channel routing (email, in-app, push),
> template rendering, delivery tracking, rate limiting, and digest batching. Subscribes to the event
> bus at priority 900. Postgres is the system of record for all notification state.

---

## Overview

The workflow actions PRD (`automation/workflow-actions.md`, action 5) defines a `notify` action that resolves recipients, renders a template, and queues delivery. But the downstream delivery infrastructure does not exist. This PRD fills that gap.

The notification system is an event bus subscriber. When the workflow engine executes a `notify` action, it emits a `notification.requested` event carrying recipients, template name, channel preference, and context data. The notification service subscribes to that event, resolves recipients to concrete users, renders the template, routes to the appropriate channel(s), and tracks delivery status.

**Dependencies:**
- `core/event-bus.md` -- subscribes to `notification.requested` events
- `core/rbac-engine.md` -- resolves role-based recipients to users
- `platform/template-infrastructure.md` -- templates with `template_type = 'notification'`
- `data/encryption.md` -- email addresses are encrypted PII; decrypt only for delivery

**What this PRD covers:** Notification delivery pipeline, channel adapters, preference management, rate limiting, digest batching, in-app notification UI data model.

**What this PRD does NOT cover:** Template content (that's operator-configured data in the `templates` table). Push notification implementation (deferred to mobile phase). Notification UI components (covered in a future UI PRD).

---

## 1. Event Bus Integration

### Purpose

Subscribe to `notification.requested` events and orchestrate the delivery pipeline.

### Detail

The notification service registers a single event bus subscriber on application startup:

```typescript
subscribe('notification.requested', handleNotificationRequested, 900)
```

**Priority 900** places it after internal domain handlers (default 100), after webhook delivery (integration-patterns), and before the Pub/Sub bridge (999). Notifications are near-last because they are outbound side effects, not domain state changes.

The `notification.requested` event payload (emitted by the `notify` workflow action):

| Field | Type | Description |
|-------|------|-------------|
| `recipients` | `ReadonlyArray<string>` | Role-based (`role:liaison`), user-based (`user:<uuid>`), or department-based (`dept:guest_relations`) |
| `templateName` | `string` | Name of the notification template in the unified `templates` table |
| `channel` | `string` | `email`, `in_app`, or `both`. Default `in_app` |
| `context` | `Record<string, unknown>` | Template variable data from the triggering record |
| `priority` | `string` | `low`, `normal`, `high`, `urgent`. Default `normal` |

The handler pipeline:

1. **Resolve recipients** -- expand role/department references to concrete user records (Section 2).
2. **Check preferences** -- filter by each user's notification preferences (Section 5).
3. **Render template** -- load template from `templates` table, resolve `{{variable}}` placeholders (Section 3).
4. **Rate check** -- verify per-user rate limits are not exceeded (Section 7).
5. **Enqueue** -- insert rows into `notification_queue` for async delivery (Section 4).
6. **Deliver** -- process queue: send email via provider, create in-app notification record.
7. **Track** -- update `notification_log` with delivery status (Section 6).

### Acceptance Criteria

- [ ] Notification service subscribes to `notification.requested` at priority 900.
- [ ] A `notify` workflow action results in delivery to resolved recipients within 30 seconds.
- [ ] The handler does not throw -- delivery failures are logged, not propagated to the event bus.
- [ ] Missing template name produces a logged error and a `notification.failed` event, not a crash.

---

## 2. Recipient Resolution

### Purpose

Translate abstract recipient identifiers (`role:liaison`, `dept:guest_relations`, `user:<uuid>`) into concrete user records with email addresses and in-app IDs.

### Detail

**Resolution strategies:**

| Recipient format | Resolution |
|-----------------|------------|
| `role:<roleKey>` | Query `staff` records where `role = roleKey`. If the triggering event has a `guestId`, further scope to staff assigned to that guest via `pairings` table. |
| `user:<uuid>` | Direct lookup in `staff` table by ID. |
| `dept:<deptKey>` | Query `staff` records where `department = deptKey`. |
| `role:<roleKey>@<conceptKey>:<recordId>` | Scoped role resolution: find users with `roleKey` assigned to the specific record (e.g., `role:liaison@guest:abc-123` finds the liaison for guest abc-123). |

**Resolution rules:**

1. Deduplicate: if a user appears via multiple recipient paths, they receive one notification, not N.
2. Self-exclusion: if the `triggeredBy` user matches a resolved recipient, include them by default. Workflow config can set `excludeTrigger: true` to suppress.
3. Inactive users: skip users where `staff.status = 'inactive'`.
4. Missing recipients: if resolution yields zero users, log a warning and emit `notification.no_recipients` event. Do not fail the workflow.

**Email retrieval:** Email addresses are encrypted PII (`data/encryption.md`). The notification service decrypts email only for users who will actually receive an email-channel notification, and only at the moment of delivery. Decrypted values are never cached externally.

### Acceptance Criteria

- [ ] `role:liaison` resolves to all users with the liaison role; when scoped to a guest, resolves to only the assigned liaison(s).
- [ ] `dept:guest_relations` resolves to all active staff in the Guest Relations department.
- [ ] `user:<uuid>` resolves to exactly one user.
- [ ] Duplicate recipients across multiple resolution paths produce a single notification.
- [ ] Zero resolved recipients logs a warning and emits `notification.no_recipients` but does not fail.
- [ ] Inactive staff are excluded from resolution.

---

## 3. Template Rendering

### Purpose

Load notification templates from the unified template system and render them with context data using Handlebars-style `{{variable}}` interpolation.

### Detail

Notification templates are stored in the `templates` table with `template_type = 'notification'` (see `platform/template-infrastructure.md`, section 2.2).

**Template content schema:**

```json
{
  "subject": "Guest {{guest.name}} confirmed for {{convention.name}}",
  "body": "Hi {{recipient.name}},\n\n{{guest.name}} from {{guest.company}} has been confirmed...",
  "bodyHtml": "<p>Hi {{recipient.name}},</p><p>{{guest.name}} from {{guest.company}}...</p>",
  "channels": ["email", "in_app"],
  "category": "action_required"
}
```

**Variable resolution:**

| Namespace | Source | Example |
|-----------|--------|---------|
| `context.*` | Triggering record fields from the workflow action | `{{context.guest_name}}` |
| `guest.*` | Guest record fields (if event involves a guest) | `{{guest.name}}`, `{{guest.company}}` |
| `convention.*` | Active convention record | `{{convention.name}}`, `{{convention.dates}}` |
| `recipient.*` | The specific recipient receiving this notification | `{{recipient.name}}`, `{{recipient.role}}` |

**Rendering rules:**

1. Use Handlebars-compatible syntax: `{{variable}}`, `{{#if condition}}`, `{{#each list}}`.
2. Missing required variables produce a `[MISSING: variable_name]` placeholder in the rendered output and log a warning. Never silently produce empty strings.
3. HTML in variable values is escaped by default in `body` and `bodyHtml` to prevent XSS. Raw output requires explicit `{{{triple_braces}}}`.
4. Subject line: plain text only, no HTML. Max 200 characters (truncated with ellipsis if exceeded).

### Acceptance Criteria

- [ ] Template loaded from `templates` table by `templateName` and `template_type = 'notification'`.
- [ ] All `{{variable}}` placeholders resolved from context data.
- [ ] Missing variables produce `[MISSING: variable_name]` in output, not empty strings.
- [ ] HTML in variable values is escaped in rendered output.
- [ ] Template not found produces a descriptive error and `notification.template_not_found` event.

---

## 4. Channel Routing and Delivery

### Purpose

Route rendered notifications to the appropriate delivery channel(s): email, in-app, or both.

### Detail

**Channel selection logic:**

1. Start with the channel specified in the `notify` action (`email`, `in_app`, `both`).
2. Override with the recipient's channel preference if the notification priority is `normal` or `low` (Section 5). `high` and `urgent` notifications ignore opt-out preferences.
3. If the template specifies `channels`, intersect with the action's channel selection.

**Email delivery:**

The email service is an abstraction layer over configurable providers.

```typescript
interface EmailProvider {
  readonly send: (message: EmailMessage) => Promise<EmailResult>
  readonly name: string
}

interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly bodyText: string
  readonly bodyHtml?: string
  readonly replyTo?: string
  readonly attachments?: ReadonlyArray<EmailAttachment>
}

interface EmailResult {
  readonly messageId: string
  readonly status: 'sent' | 'failed'
  readonly error?: string
}
```

**Supported providers (config-driven, not hardcoded):**

| Provider | Config key | Use case |
|----------|-----------|----------|
| SendGrid | `email.provider = 'sendgrid'` | Primary recommendation (free tier, good deliverability) |
| Resend | `email.provider = 'resend'` | Developer-friendly alternative |
| Amazon SES | `email.provider = 'ses'` | AWS-native deployments |
| SMTP | `email.provider = 'smtp'` | Self-hosted / generic fallback |

Provider selection is a single environment variable. The `EmailProvider` interface is the same regardless of backend. Provider credentials are stored in GCP Secret Manager, never in source code or Postgres.

**In-app delivery:**

Create a row in the `notification_log` table with `channel = 'in_app'` and `status = 'delivered'`. The frontend polls or receives the notification via SSE (see `data-infrastructure/real-time.md`).

**Retry policy (email only):**

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |

After 3 failed attempts, mark as `failed` in `notification_log`. Emit `notification.delivery_failed` event for monitoring.

### Acceptance Criteria

- [ ] Email channel sends via the configured provider using the `EmailProvider` interface.
- [ ] Switching providers requires only a config change, no code changes.
- [ ] In-app channel creates a `notification_log` row immediately.
- [ ] Channel selection respects user preferences for normal/low priority notifications.
- [ ] High/urgent notifications bypass opt-out preferences.
- [ ] Failed email delivery retries up to 3 times with exponential backoff.
- [ ] Provider credentials are loaded from Secret Manager, never hardcoded.

---

## 5. Notification Preferences

### Purpose

Let users control which notification channels they receive and opt out of non-critical notifications.

### Detail

**`notification_preferences` table:**

```sql
CREATE TABLE notification_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES staff(id),
  channel_email     BOOLEAN NOT NULL DEFAULT true,
  channel_in_app    BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,                -- e.g., 22:00
  quiet_hours_end   TIME,                -- e.g., 08:00
  quiet_hours_tz    TEXT DEFAULT 'UTC',   -- IANA timezone
  digest_mode       TEXT NOT NULL DEFAULT 'none'
                    CHECK (digest_mode IN ('none', 'hourly', 'daily')),
  category_overrides JSONB DEFAULT '{}', -- per-category opt-out: {"info": false}
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
```

**Preference evaluation order:**

1. **Priority override:** `urgent` and `high` priority notifications always deliver. No preference blocks them.
2. **Quiet hours:** If current time (in user's timezone) falls within `quiet_hours_start` - `quiet_hours_end`, email delivery is deferred until quiet hours end. In-app notifications still create the record (user sees them when they next log in).
3. **Channel preference:** If `channel_email = false`, skip email delivery. If `channel_in_app = false`, skip in-app record creation.
4. **Category override:** Template `category` (e.g., `info`, `warning`, `action_required`) checked against `category_overrides`. If the category is set to `false`, skip delivery for normal/low priority.
5. **Digest mode:** If `digest_mode = 'daily'`, normal/low email notifications are batched (Section 8) instead of sent immediately.

**Default preferences:** When no `notification_preferences` row exists for a user, all channels are enabled, no quiet hours, no digest. New rows are created on first preference change, not at user creation.

### Acceptance Criteria

- [ ] Users without a preferences row receive all notifications on all channels.
- [ ] `channel_email = false` suppresses email delivery for normal/low priority.
- [ ] Quiet hours defer email delivery until the quiet period ends.
- [ ] `urgent` notifications bypass all preference checks.
- [ ] Category overrides suppress delivery for opted-out categories.
- [ ] Preferences are per-user, not per-role.

---

## 6. Delivery Tracking and Storage

### Purpose

Track the lifecycle of every notification from creation through delivery, bounce, and read status.

### Detail

**`notification_log` table:**

```sql
CREATE TABLE notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES staff(id),
  template_name     TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'in_app', 'push')),
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'read')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  category          TEXT,                   -- from template: info, warning, action_required
  subject           TEXT NOT NULL,
  body_preview      TEXT,                   -- first 200 chars of rendered body
  source_event_id   UUID,                   -- FK to event_log.event_id
  source_record_id  TEXT,                   -- record that triggered the notification
  source_concept    TEXT,                   -- concept of the triggering record
  provider_message_id TEXT,                 -- external ID from email provider
  error_message     TEXT,                   -- delivery error details
  retry_count       INTEGER NOT NULL DEFAULT 0,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_log_user_status
  ON notification_log (user_id, status) WHERE status != 'read';
CREATE INDEX idx_notification_log_user_created
  ON notification_log (user_id, created_at DESC);
CREATE INDEX idx_notification_log_source
  ON notification_log (source_concept, source_record_id);
```

**Status transitions:**

| From | To | Trigger |
|------|----|---------|
| `queued` | `sent` | Email handed to provider API |
| `sent` | `delivered` | Provider webhook confirms delivery (or immediate for in-app) |
| `sent` | `bounced` | Provider webhook reports bounce |
| `queued` | `failed` | All retry attempts exhausted |
| `delivered` | `read` | User marks notification as read in UI |

**In-app notification queries (for the frontend):**

```sql
-- Unread count badge
SELECT count(*) FROM notification_log
WHERE user_id = $1 AND channel = 'in_app' AND status = 'delivered';

-- Notification list (paginated)
SELECT * FROM notification_log
WHERE user_id = $1 AND channel = 'in_app'
ORDER BY created_at DESC
LIMIT 20 OFFSET $2;
```

### Acceptance Criteria

- [ ] Every notification attempt produces a `notification_log` row.
- [ ] Status transitions follow the defined state machine -- no illegal transitions.
- [ ] Email provider message ID is stored for cross-reference with provider dashboards.
- [ ] Error messages for failed deliveries are stored (not swallowed).
- [ ] Unread count query returns results in < 50ms for users with up to 1,000 notifications.
- [ ] Notification list is paginated with cursor-based or offset pagination.

---

## 7. Rate Limiting

### Purpose

Prevent notification spam from misconfigured workflows or runaway automation.

### Detail

**Per-user rate limits:**

| Window | Max notifications | Applies to |
|--------|-------------------|------------|
| 1 hour | 20 | `normal` and `low` priority |
| 1 hour | 50 | `high` priority |
| 1 hour | unlimited | `urgent` priority |
| 1 day | 100 | All priorities combined (except `urgent`) |

**Implementation:** Sliding window counter in Postgres (or Redis if available). Key = `notification_rate:<user_id>:<window>`. Checked before enqueueing.

**When rate limit is exceeded:**

1. The notification is not delivered.
2. A `notification.rate_limited` event is emitted with the user ID and notification details.
3. The notification is logged in `notification_log` with `status = 'failed'` and `error_message = 'rate_limit_exceeded'`.
4. The workflow action still reports `delivery_status = 'rate_limited'` (not `failed`) so downstream actions can distinguish.

**Per-workflow rate limits:**

Workflows can optionally specify `maxNotificationsPerHour` in the `notify` action config. If a single workflow fires more than this threshold, subsequent notifications from that workflow are suppressed until the window resets.

### Acceptance Criteria

- [ ] More than 20 normal-priority notifications to the same user in 1 hour triggers rate limiting.
- [ ] `urgent` priority notifications are never rate limited.
- [ ] Rate-limited notifications produce a `notification.rate_limited` event.
- [ ] Rate limit state survives application restarts (stored in Postgres or Redis, not in-memory).
- [ ] Rate limit windows are sliding, not fixed calendar windows.

---

## 8. Batch and Digest

### Purpose

Aggregate multiple low-priority notifications into a single email to reduce inbox noise.

### Detail

Users who set `digest_mode = 'daily'` or `digest_mode = 'hourly'` in their preferences receive batched emails instead of individual ones.

**Digest pipeline:**

1. When a notification targets a user with digest mode enabled, skip immediate email delivery.
2. Create the `notification_log` row with `status = 'queued'` and a `digest_batch_id`.
3. A scheduled job runs at the digest interval (hourly at :00, daily at 08:00 in user's timezone).
4. The job queries all `queued` in-app notifications for the digest window, groups by user.
5. For each user with pending notifications, render a digest email template containing all notification summaries.
6. Send the single digest email and update all included `notification_log` rows to `status = 'sent'`.

**Digest email template:**

```
Subject: [Convention Name] — You have N new notifications

Hi {{recipient.name}},

Here's what happened since your last digest:

{{#each notifications}}
  - [{{this.category}}] {{this.subject}} ({{this.time_ago}})
{{/each}}

View all notifications: {{app_url}}/notifications
```

**Exclusions from digest:**

- `high` and `urgent` priority notifications are never batched -- they deliver immediately.
- `action_required` category notifications deliver immediately even with digest mode on.

### Acceptance Criteria

- [ ] Users with `digest_mode = 'daily'` receive one daily email with all pending notifications.
- [ ] Users with `digest_mode = 'hourly'` receive one email per hour.
- [ ] `high`, `urgent`, and `action_required` notifications bypass digest and deliver immediately.
- [ ] Digest email contains all pending notifications in chronological order.
- [ ] Individual `notification_log` rows are updated to `sent` when the digest is delivered.

---

## 9. Notification Queue

### Purpose

Decouple notification creation from delivery to handle bursts and enable retry.

### Detail

**`notification_queue` table:**

```sql
CREATE TABLE notification_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_log_id UUID NOT NULL REFERENCES notification_log(id),
  channel           TEXT NOT NULL,
  payload           JSONB NOT NULL,       -- rendered subject, body, recipient email/user_id
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_retry_at     TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_queue_pending
  ON notification_queue (scheduled_at) WHERE status = 'pending';
```

**Queue processing:**

1. A background worker polls `notification_queue` every 5 seconds for rows where `status = 'pending'` and `scheduled_at <= now()`.
2. For each row, set `status = 'processing'`, attempt delivery.
3. On success: set `status = 'completed'`, update `notification_log.status`.
4. On failure: increment `attempts`, calculate `next_retry_at` using exponential backoff. If `attempts >= 3`, set `status = 'failed'`.

**Concurrency:** The worker uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent multiple workers from processing the same notification.

**Scaling:** At convention scale (50-100 concurrent users), a single worker processing every 5 seconds is sufficient. For higher scale, add additional workers -- `SKIP LOCKED` ensures safe parallelism.

### Acceptance Criteria

- [ ] Notifications are enqueued before delivery, not sent inline with the event handler.
- [ ] Queue processing uses `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrency.
- [ ] Successful delivery updates both `notification_queue` and `notification_log`.
- [ ] Failed delivery after 3 attempts marks both queue and log as `failed`.
- [ ] Queue is drained within 30 seconds under normal load (< 100 pending notifications).

---

## 10. In-App Notification Data Model

### Purpose

Define the data contract for the frontend notification system: unread count, notification list, mark-as-read, and categories.

### Detail

**API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notifications` | Paginated notification list for the authenticated user |
| `GET` | `/api/notifications/unread-count` | Unread count for badge display |
| `POST` | `/api/notifications/:id/read` | Mark a single notification as read |
| `POST` | `/api/notifications/read-all` | Mark all notifications as read |
| `GET` | `/api/notifications/preferences` | Get user's notification preferences |
| `PUT` | `/api/notifications/preferences` | Update user's notification preferences |

**Notification list response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "subject": "Guest Tanaka confirmed",
      "bodyPreview": "Tanaka-san from Sony Music has been confirmed for...",
      "category": "action_required",
      "priority": "high",
      "sourceConcept": "guest",
      "sourceRecordId": "uuid",
      "status": "delivered",
      "createdAt": "2026-04-08T14:30:00Z",
      "readAt": null
    }
  ],
  "meta": {
    "total": 42,
    "unreadCount": 7,
    "page": 1,
    "limit": 20
  }
}
```

**Categories:**

| Category | Icon | Behavior |
|----------|------|----------|
| `info` | Info circle | Informational, opt-outable |
| `warning` | Warning triangle | Important state change |
| `action_required` | Exclamation circle | User must take action; highlighted in UI |
| `system` | Gear | Platform system notifications (admin only) |

**Mark-as-read behavior:**

- `POST /api/notifications/:id/read` sets `read_at = now()` and `status = 'read'`.
- `POST /api/notifications/read-all` bulk-updates all `delivered` notifications for the user.
- Read state is idempotent -- marking an already-read notification as read is a no-op (200, not error).

### Acceptance Criteria

- [ ] `/api/notifications` returns only notifications for the authenticated user (RBAC-enforced).
- [ ] Unread count endpoint returns in < 50ms.
- [ ] Mark-as-read updates `read_at` and `status` atomically.
- [ ] Mark-all-as-read handles up to 500 notifications in a single request without timeout.
- [ ] Notification list supports filtering by `category`, `status`, and date range.
- [ ] All notification endpoints go through the standard auth + RBAC middleware.

---

## 11. Domain Events Emitted

### Purpose

Define the events the notification system emits for observability and downstream automation.

### Detail

| Event | When | Payload |
|-------|------|---------|
| `notification.queued` | Notification enqueued for delivery | `{ notificationId, userId, channel, templateName }` |
| `notification.sent` | Email handed to provider | `{ notificationId, userId, providerMessageId }` |
| `notification.delivered` | In-app created or email delivery confirmed | `{ notificationId, userId, channel }` |
| `notification.failed` | All retry attempts exhausted | `{ notificationId, userId, channel, error }` |
| `notification.read` | User marks notification as read | `{ notificationId, userId }` |
| `notification.rate_limited` | Delivery suppressed by rate limit | `{ notificationId, userId, rateWindow }` |
| `notification.no_recipients` | Recipient resolution yielded zero users | `{ templateName, recipients, sourceEventId }` |
| `notification.template_not_found` | Template name not found in templates table | `{ templateName }` |

### Acceptance Criteria

- [ ] Every status transition in the notification lifecycle emits a corresponding domain event.
- [ ] Events carry enough context for monitoring dashboards to track delivery rates and failure rates.
- [ ] Events are emitted via the standard event bus (`emit()`) and logged to `event_log`.

---

## 12. Test Plan

### 12.1 Unit Tests -- Recipient Resolution

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-01 | Role-based resolution | `role:liaison` | Returns all users with liaison role |
| U-02 | Scoped role resolution | `role:liaison@guest:abc` | Returns liaison(s) assigned to guest abc |
| U-03 | Department resolution | `dept:guest_relations` | Returns all active GR staff |
| U-04 | User resolution | `user:uuid-123` | Returns exactly that user |
| U-05 | Mixed recipients | `[role:liaison, user:uuid-456]` | Deduplicated union of results |
| U-06 | No matching users | `role:nonexistent` | Returns empty array, emits `no_recipients` |
| U-07 | Inactive user filtered | User with `status = 'inactive'` | Not included in results |
| U-08 | Duplicate deduplication | User appears via both role and direct ID | Single notification, not two |

### 12.2 Unit Tests -- Template Rendering

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-09 | Basic variable resolution | `{{guest.name}}` with context | Name rendered in output |
| U-10 | Missing variable | `{{guest.nonexistent}}` | `[MISSING: guest.nonexistent]` in output |
| U-11 | HTML escaping | Variable contains `<script>` | Escaped as `&lt;script&gt;` |
| U-12 | Subject truncation | 300-char subject | Truncated to 200 with ellipsis |
| U-13 | Template not found | `templateName = 'nonexistent'` | Error logged, `template_not_found` event |
| U-14 | Conditional block | `{{#if guest.is_vip}}VIP{{/if}}` | Renders block when condition true |

### 12.3 Unit Tests -- Preference Evaluation

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-15 | No preferences row | User without preferences | All channels enabled |
| U-16 | Email disabled | `channel_email = false`, normal priority | Email skipped |
| U-17 | Urgent bypasses prefs | `channel_email = false`, urgent priority | Email still sent |
| U-18 | Quiet hours active | Current time in quiet window | Email deferred |
| U-19 | Category opt-out | `category_overrides = {"info": false}`, info notification | Delivery skipped |
| U-20 | Digest mode daily | `digest_mode = 'daily'`, normal email | Batched, not sent immediately |

### 12.4 Unit Tests -- Rate Limiting

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-21 | Under limit | 10 notifications in 1 hour | All delivered |
| U-22 | Over limit normal | 21st normal notification in 1 hour | Rate limited, event emitted |
| U-23 | Urgent unlimited | 100 urgent notifications in 1 hour | All delivered |
| U-24 | Daily cap | 101st notification in 1 day | Rate limited |

### 12.5 Integration Tests -- Full Pipeline

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| I-01 | End-to-end email | `notify` action -> email delivered | Email provider receives message, `notification_log` updated |
| I-02 | End-to-end in-app | `notify` action -> in-app notification | `notification_log` row with `channel = 'in_app'`, `status = 'delivered'` |
| I-03 | Both channels | Channel = `both` | One email sent AND one in-app record created |
| I-04 | Email retry success | Provider fails first attempt, succeeds second | `notification_log.retry_count = 1`, `status = 'delivered'` |
| I-05 | Email retry exhausted | Provider fails all 3 attempts | `status = 'failed'`, `notification.failed` event emitted |
| I-06 | Digest delivery | 5 notifications in daily digest window | Single digest email with 5 items |
| I-07 | Queue concurrency | 50 notifications queued simultaneously | All delivered, no duplicates (SKIP LOCKED) |
| I-08 | Mark as read | POST `/api/notifications/:id/read` | `read_at` set, `status = 'read'` |

### 12.6 Performance Tests

| Scenario | Target |
|----------|--------|
| 100 notifications queued in burst | All delivered within 60 seconds |
| Unread count query (1,000 notifications) | < 50ms |
| Notification list query (paginated, 10,000 total) | < 100ms per page |
| Digest email for user with 50 pending notifications | Generated and sent within 5 seconds |

### 12.7 Error Handling Tests

| Scenario | Expected |
|----------|----------|
| Email provider returns 500 | Retried, eventually marked failed |
| Email provider timeout (30s) | Retried with backoff |
| Template has syntax error | Error logged, notification marked failed, workflow continues |
| Database unavailable during queue processing | Worker retries on next poll cycle |
| User deleted between enqueue and delivery | Notification marked failed, no crash |

### Acceptance Criteria (Test Plan)

- [ ] All unit tests pass with >= 80% coverage on notification service code.
- [ ] Integration tests verify the full pipeline from event bus subscription to delivery.
- [ ] Performance tests confirm sub-second response times for notification API endpoints.
- [ ] Error handling tests confirm no unhandled exceptions propagate to the event bus.
- [ ] All tests run against a real Postgres instance (Testcontainers, per `data/integration-testing.md`).
