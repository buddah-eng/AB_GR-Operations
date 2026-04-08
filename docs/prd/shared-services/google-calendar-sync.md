# Google Calendar Sync

> Bidirectional sync between platform schedule_events and Google Calendar. Platform is SOR -- pushes to gcal on save, pulls gcal changes back with confirmation. One calendar per department + org-wide calendar + personal staff calendars. Sync triggered by `sync_calendar` workflow action, gcal webhook for inbound changes, 15min polling fallback. Google Calendar API via service account. Postgres is the system of record.

---

## Overview

The convention operations platform is the system of record for all scheduled events. Google Calendar is a consumption layer -- staff see their assignments in the calendar apps they already use (Google Calendar on desktop and mobile), and department coordinators get a shared calendar view without logging into the platform.

Sync is bidirectional but asymmetric. Platform-to-Google is authoritative: creating, updating, or canceling a schedule_event pushes the change to Google Calendar immediately. Google-to-Platform is advisory: changes made directly in Google Calendar (dragging an event, editing the title) are detected and presented to the platform user for confirmation before being applied to the Postgres record. This prevents accidental overwrites from casual calendar edits.

Each department gets its own Google Calendar. An org-wide calendar aggregates cross-department events. Staff members who are assigned to events see those events on their personal Google Calendar. The `sync_calendar` workflow action (defined in `automation/workflow-actions.md`) is the primary push mechanism. Inbound changes arrive via Google Calendar API push notifications (webhooks) with a 15-minute polling fallback for reliability.

Dependencies: `shared-services/scheduling-calendar.md` (schedule_event concept), `automation/workflow-actions.md` (sync_calendar action), `core/event-bus.md` (domain events), `api/integration-patterns.md` (API auth patterns), `data/postgres-schema.md` (sync state storage).

Everything ships.

---

## 1. Sync Model

### Purpose

Define the directional sync behavior so that the platform remains the authoritative source while Google Calendar serves as a convenient read/notification layer.

### Detail

#### Platform -> Google Calendar (Outbound)

When a schedule_event is created, updated, or archived in the platform:

1. The `sync_calendar` workflow action fires (triggered by `schedule_event.created`, `schedule_event.updated`, or `schedule_event.deleted` domain events).
2. The action resolves the target Google Calendar ID based on the event's `department` field.
3. If the schedule_event has no `gcal_event_id`: create a new Google Calendar event via the Calendar API. Write the returned `gcal_event_id` back to the schedule_event row.
4. If the schedule_event has a `gcal_event_id`: update the existing Google Calendar event.
5. If the schedule_event is archived or canceled: cancel the Google Calendar event (set status to `cancelled`).

#### Google Calendar -> Platform (Inbound)

When a Google Calendar event is modified externally (by a user editing directly in Google Calendar):

1. The platform detects the change via webhook push notification or polling.
2. The platform looks up the corresponding schedule_event by `gcal_event_id`.
3. The platform compares the gcal event fields to the schedule_event fields.
4. If differences exist, the platform creates a `calendar_sync_pending` record:

```sql
CREATE TABLE calendar_sync_pending (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_event_id UUID NOT NULL REFERENCES schedule_events(id),
  gcal_event_id     TEXT NOT NULL,
  gcal_calendar_id  TEXT NOT NULL,
  field_changes     JSONB NOT NULL,  -- { "name": { "platform": "...", "gcal": "..." }, ... }
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'rejected', 'auto_resolved'
  )),
  resolved_by       UUID REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_pending_status
  ON calendar_sync_pending (status)
  WHERE status = 'pending';
```

5. The platform notifies the event owner (via in-app notification) that a calendar change requires confirmation.
6. The user reviews the diff and either accepts (applies gcal changes to platform) or rejects (re-pushes platform values to gcal).

#### Auto-Resolution Rules

Some inbound changes can be auto-resolved without user intervention:

| Change | Auto-Resolution |
|--------|----------------|
| Description/notes only | Auto-accept (low-risk field) |
| Time change < 15 minutes | Auto-accept with notification |
| Time change >= 15 minutes | Requires confirmation |
| Venue/location change | Requires confirmation (conflict detection needed) |
| Title change | Requires confirmation |
| Event deleted in gcal | Requires confirmation (prevents accidental deletes) |

#### Sync State Tracking

Each schedule_event tracks sync state in its JSONB `properties`:

```jsonc
{
  "gcal_sync": {
    "last_synced_at": "2026-03-15T10:30:00Z",
    "sync_status": "synced",       // synced | pending | error | conflict
    "gcal_event_id": "abc123",
    "gcal_calendar_id": "dept-gr@group.calendar.google.com",
    "last_gcal_updated": "2026-03-15T10:30:00Z",
    "sync_error": null
  }
}
```

### Acceptance Criteria

- [ ] Platform create -> gcal event created; `gcal_event_id` written back to Postgres.
- [ ] Platform update -> gcal event updated (not duplicated).
- [ ] Platform archive -> gcal event canceled.
- [ ] Gcal external change -> `calendar_sync_pending` record created.
- [ ] User accepts pending change -> schedule_event updated in Postgres.
- [ ] User rejects pending change -> gcal event re-pushed with platform values.
- [ ] Auto-resolution rules applied for low-risk changes.
- [ ] Sync state tracked in schedule_event JSONB properties.
- [ ] Conflicting inbound changes (time/venue) require confirmation, never auto-apply.

---

## 2. Event Mapping

### Purpose

Define the field-level mapping between platform schedule_event fields and Google Calendar event fields so that data translates correctly in both directions.

### Detail

#### Outbound Mapping (Platform -> Google Calendar)

| schedule_event field | gcal event field | Notes |
|---------------------|-----------------|-------|
| `name` | `summary` | Event title. |
| `venue.name + venue.room` | `location` | Resolved via venue_id relation; formatted as "Room Name, Building". |
| `start_time` | `start.dateTime` | ISO 8601 with timezone. |
| `end_time` | `end.dateTime` | ISO 8601 with timezone. |
| `description` | `description` | Plain text or stripped HTML. |
| `status = 'confirmed'` | `status = 'confirmed'` | Direct mapping. |
| `status = 'tentative'` | `status = 'tentative'` | Direct mapping. |
| `status = 'canceled'` | `status = 'cancelled'` | Note spelling difference (platform vs. gcal). |
| `department` | `description` (prefix) | Prepended as "[Department] " in description. |
| `event_type` | `extendedProperties.private.event_type` | Stored in gcal extended properties for round-trip. |
| `id` | `extendedProperties.private.platform_id` | Platform record ID for reverse lookup. |

#### Guest Names in Attendees (Optional)

If the department calendar is configured with `include_guests_as_attendees = true`:

- Each guest in `schedule_event_guests` is added to the gcal event's `attendees` list.
- Guest email is used if available; otherwise the guest is listed in the description body.
- Staff in `schedule_event_staff` are added as attendees with `responseStatus = 'accepted'`.

#### Inbound Mapping (Google Calendar -> Platform)

| gcal event field | schedule_event field | Requires Confirmation |
|-----------------|---------------------|----------------------|
| `summary` | `name` | Yes |
| `location` | (reverse venue lookup) | Yes |
| `start.dateTime` | `start_time` | If delta >= 15min |
| `end.dateTime` | `end_time` | If delta >= 15min |
| `description` | `description` | No (auto-accept) |
| `status = 'cancelled'` | `status = 'canceled'` | Yes |

Location reverse lookup: the system attempts to match the gcal `location` string against known venue names. If no match is found, the change is flagged for manual review.

### Acceptance Criteria

- [ ] All outbound field mappings produce valid Google Calendar event payloads.
- [ ] Venue name is resolved from `venue_id` relation, not stored as raw text.
- [ ] `extendedProperties.private.platform_id` is set on every outbound event for reverse lookup.
- [ ] Inbound mapping correctly identifies which schedule_event fields changed.
- [ ] Guest attendees added to gcal when `include_guests_as_attendees` is enabled.
- [ ] Staff attendees added to gcal with `responseStatus = 'accepted'`.
- [ ] Status mapping handles the `canceled` / `cancelled` spelling difference.

---

## 3. Calendar Per Department

### Purpose

Organize Google Calendar events into department-specific calendars plus an org-wide calendar, so that each team has a focused view while leadership sees the complete picture.

### Detail

#### Calendar Structure

```sql
CREATE TABLE calendar_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT NOT NULL,
  calendar_type   TEXT NOT NULL CHECK (calendar_type IN (
    'department', 'org_wide', 'personal'
  )),
  gcal_calendar_id TEXT NOT NULL,  -- Google Calendar ID
  display_name    TEXT NOT NULL,
  color           TEXT,            -- hex color for UI display
  sync_enabled    BOOLEAN NOT NULL DEFAULT true,
  include_guests_as_attendees BOOLEAN NOT NULL DEFAULT false,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false,

  UNIQUE (department, calendar_type) -- one dept calendar per department
);
```

#### Calendar Types

| Type | Scope | Events Included | Who Sees It |
|------|-------|----------------|-------------|
| `department` | Single department | All events where `department` matches | Department staff |
| `org_wide` | Cross-department | Events with `department = 'org'` or `properties.cross_department = true` | All staff |
| `personal` | Single staff member | Events where the staff member is in `schedule_event_staff` | The individual |

#### Department Calendar Routing

When the `sync_calendar` action fires, it determines the target calendar:

1. Look up `calendar_configs` where `department = event.department` and `calendar_type = 'department'`.
2. If the event has `properties.cross_department = true`, also push to the `org_wide` calendar.
3. For each staff member in `schedule_event_staff`, push to their `personal` calendar (if configured).

A single schedule_event can appear on multiple Google Calendars (department + org-wide + personal). Each calendar-event pair is tracked in a mapping table:

```sql
CREATE TABLE calendar_event_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_event_id UUID NOT NULL REFERENCES schedule_events(id),
  calendar_config_id UUID NOT NULL REFERENCES calendar_configs(id),
  gcal_event_id     TEXT NOT NULL,
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT NOT NULL DEFAULT 'synced',

  UNIQUE (schedule_event_id, calendar_config_id)
);
```

#### Personal Calendar Generation

When a staff member is assigned to an event (row inserted in `schedule_event_staff`), a workflow creates or updates the personal calendar event. When unassigned (row deleted), the personal calendar event is canceled. This gives each staff member a "my schedule" view in Google Calendar without requiring them to log into the platform.

### Acceptance Criteria

- [ ] `calendar_configs` table stores one record per department calendar.
- [ ] Org-wide calendar receives cross-department events.
- [ ] Personal calendars reflect staff assignments.
- [ ] Adding staff to event -> personal calendar event created.
- [ ] Removing staff from event -> personal calendar event canceled.
- [ ] `calendar_event_mappings` tracks each schedule_event-to-gcal-event pair per calendar.
- [ ] A single schedule_event can sync to multiple calendars without duplication.
- [ ] Disabling sync on a calendar_config stops outbound pushes for that calendar.

---

## 4. Sync Trigger

### Purpose

Define when and how sync operations fire, ensuring timely propagation without overwhelming the Google Calendar API.

### Detail

#### Primary Trigger: Workflow Action

The `sync_calendar` workflow action (defined in `automation/workflow-actions.md`) is the primary outbound sync mechanism. It fires on domain events:

```jsonc
{
  "trigger": { "type": "event_name", "pattern": "schedule_event.*" },
  "condition": {
    "and": [
      { "field": "status", "op": "in", "value": ["tentative", "confirmed", "published", "canceled"] },
      { "field": "archived", "op": "eq", "value": false }
    ]
  },
  "actions": [
    {
      "type": "sync_calendar",
      "target": "schedule_event"
    }
  ]
}
```

Draft events are not synced. Events transition to gcal when they reach `tentative` or higher.

#### Inbound Trigger: Webhook

Google Calendar API push notifications deliver changes in near-real-time:

1. On startup (or calendar config change), the platform registers a webhook channel with the Google Calendar API for each configured calendar:

```
POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
{
  "id": "platform-channel-{calendar_config_id}",
  "type": "web_hook",
  "address": "https://api.platform.example/webhooks/gcal",
  "token": "{hmac_verification_token}",
  "expiration": {now + 7 days}
}
```

2. When Google Calendar detects a change, it sends a POST to the webhook URL.
3. The webhook handler:
   a. Verifies the HMAC token.
   b. Calls `events.list` with `syncToken` to get incremental changes since last sync.
   c. For each changed event, looks up the corresponding schedule_event via `extendedProperties.private.platform_id`.
   d. Creates `calendar_sync_pending` records for events with differences.

4. Webhook channels expire after 7 days. A scheduled job renews them before expiry.

#### Fallback Trigger: Polling

If webhooks are unreliable (network issues, quota limits), a scheduled job polls every 15 minutes:

1. For each `calendar_config` with `sync_enabled = true`:
   a. Call `events.list` with `updatedMin = last_poll_time`.
   b. Compare each returned event against the platform record.
   c. Create `calendar_sync_pending` records for differences.

2. Polling state tracked per calendar:

```jsonc
// In calendar_configs.properties
{
  "poll_state": {
    "last_poll_at": "2026-03-15T10:30:00Z",
    "sync_token": "CPDAlvb...",
    "next_poll_at": "2026-03-15T10:45:00Z"
  }
}
```

#### Rate Limiting

Google Calendar API has a per-user quota of 1,000,000 queries/day and per-calendar limits. The sync system:

- Batches outbound pushes when multiple events change in quick succession (debounce window: 5 seconds).
- Uses exponential backoff on 429 (rate limit) and 503 (service unavailable) responses.
- Tracks daily API usage in `calendar_configs.properties.api_usage` to alert before hitting limits.

### Acceptance Criteria

- [ ] `sync_calendar` workflow action fires on schedule_event domain events.
- [ ] Draft events are excluded from sync; tentative and above are synced.
- [ ] Webhook registered for each configured calendar with HMAC verification.
- [ ] Webhook handler processes incremental changes via `syncToken`.
- [ ] Webhook channels renewed before 7-day expiry.
- [ ] Polling fallback runs every 15 minutes for each enabled calendar.
- [ ] Polling uses `updatedMin` to fetch only changed events.
- [ ] Outbound pushes debounced within a 5-second window.
- [ ] 429 and 503 responses handled with exponential backoff.
- [ ] Daily API usage tracked and alerting configured.

---

## 5. Auth

### Purpose

Define the authentication and authorization model for Google Calendar API access.

### Detail

#### Service Account

The platform authenticates to the Google Calendar API using a Google Cloud service account with domain-wide delegation:

1. **Service account:** Created in the Google Cloud project. Private key stored as an encrypted secret (never in source code, never in Postgres).
2. **Domain-wide delegation:** The service account is granted `https://www.googleapis.com/auth/calendar` scope in the Google Workspace admin console. This allows it to act on behalf of any user in the organization's domain.
3. **Impersonation:** For personal calendars, the service account impersonates the staff member's Google Workspace email to create events on their personal calendar.

#### Secret Storage

| Secret | Storage | Access |
|--------|---------|--------|
| Service account private key | Google Cloud Secret Manager | Read at startup, cached in memory |
| HMAC webhook verification token | Google Cloud Secret Manager | Read per webhook request |
| OAuth refresh tokens (if needed) | Encrypted column in `calendar_configs` | Per-calendar |

Secrets are never logged, never stored in Postgres unencrypted, and never included in API responses.

#### Per-Calendar Permissions

Each `calendar_config` record specifies the Google Calendar ID. The service account must have writer access to each calendar. Platform admins manage which calendars are connected via the admin UI:

1. Admin enters the Google Calendar ID (or creates a new calendar via the API).
2. Platform verifies write access by inserting and immediately deleting a test event.
3. If verification succeeds, the calendar_config is saved. If not, the admin sees an error.

#### Token Refresh

The service account uses short-lived access tokens (1 hour). The Google Auth library handles automatic refresh. The platform:

- Caches the access token in memory.
- Refreshes 5 minutes before expiry.
- Retries once on 401 (expired token) before failing.

### Acceptance Criteria

- [ ] Service account private key stored in Google Cloud Secret Manager, not in source code or Postgres.
- [ ] Domain-wide delegation configured for `calendar` scope.
- [ ] Personal calendar events created via service account impersonation.
- [ ] HMAC webhook token verified on every inbound webhook request.
- [ ] Calendar config creation verifies write access before saving.
- [ ] Access token cached and refreshed before expiry.
- [ ] 401 responses trigger one token refresh retry before failing.
- [ ] No secrets appear in logs, API responses, or audit entries.

---

## 6. Test Plan

### Unit Tests -- Outbound Sync

| Test Case | Assertion |
|-----------|-----------|
| Create schedule_event (status=confirmed) | Gcal event created, `gcal_event_id` written back |
| Create schedule_event (status=draft) | No gcal event created |
| Update schedule_event name | Gcal event summary updated |
| Update schedule_event time | Gcal event start/end updated |
| Update schedule_event venue | Gcal event location updated with resolved venue name |
| Archive schedule_event | Gcal event status set to `cancelled` |
| Cancel schedule_event | Gcal event status set to `cancelled` |
| Event with cross_department flag | Pushed to department calendar AND org-wide calendar |
| Staff assigned to event | Personal calendar event created |
| Staff unassigned from event | Personal calendar event canceled |

### Unit Tests -- Inbound Sync

| Test Case | Assertion |
|-----------|-----------|
| Gcal title changed | `calendar_sync_pending` created with field diff |
| Gcal time changed (< 15min) | Auto-accepted, schedule_event updated |
| Gcal time changed (>= 15min) | `calendar_sync_pending` created, requires confirmation |
| Gcal description changed | Auto-accepted |
| Gcal event deleted | `calendar_sync_pending` created, requires confirmation |
| Gcal location changed to known venue | `calendar_sync_pending` with resolved venue_id |
| Gcal location changed to unknown string | Flagged for manual review |
| User accepts pending change | Schedule_event updated, sync_pending resolved |
| User rejects pending change | Gcal event re-pushed with platform values |

### Unit Tests -- Event Mapping

| Test Case | Assertion |
|-----------|-----------|
| Outbound: all fields mapped | Gcal event payload matches mapping table |
| Outbound: venue resolved from relation | Location is "Room Name, Building", not a UUID |
| Outbound: platform_id in extendedProperties | Round-trip lookup works |
| Outbound: guests as attendees (enabled) | Attendee list populated with guest emails |
| Outbound: guests as attendees (disabled) | No attendee list |
| Inbound: canceled/cancelled spelling | Correctly mapped in both directions |

### Integration Tests

| Test Case | Assertion |
|-----------|-----------|
| Full round-trip: create event -> gcal -> edit in gcal -> pending -> accept | Schedule_event reflects gcal changes |
| Full round-trip: create event -> gcal -> edit in gcal -> pending -> reject | Gcal re-pushed with original values |
| Multi-calendar sync: event appears on dept + org + personal | Three gcal events created, all tracked in mappings |
| Webhook delivery: gcal change -> webhook -> pending created | End-to-end within 30s |
| Polling fallback: webhook missed -> poll detects change | Pending created within 15min |
| Calendar config disabled -> no sync | Outbound push skipped, no error |

### Performance Tests

| Scenario | Target |
|----------|--------|
| Sync 50 events in batch (convention schedule publish) | < 30s (respecting API rate limits) |
| Webhook processing: 20 concurrent inbound changes | All processed, no duplicates |
| Polling: 500 events across 10 calendars | < 60s per poll cycle |

### Error Handling Tests

| Scenario | Expected Behavior |
|----------|-------------------|
| Google Calendar API returns 429 | Exponential backoff, retry succeeds |
| Google Calendar API returns 503 | Exponential backoff, retry succeeds |
| Service account token expired | Auto-refresh, retry succeeds |
| Service account key revoked | Sync fails with actionable error, admin notified |
| Calendar deleted in Google | Sync fails, calendar_config marked with error |
| Network timeout to Google API | Retry with backoff, fail after 3 attempts |
| Duplicate webhook delivery | Idempotent processing, no duplicate pending records |
