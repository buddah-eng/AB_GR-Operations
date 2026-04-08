# Guidebook Integration

> One-way push from platform to Guidebook (attendee-facing mobile app). Publishes schedule events (public-facing subset), guest bios (approved only), venue/room info. Manual "Publish to Guidebook" trigger or nightly scheduled sync. Filters: only events with status='published', excludes internal/staff-only. Incremental sync via last_published_at tracking. Handle deletions: canceled events removed from Guidebook. Postgres is the system of record.

---

## Overview

Convention attendees use Guidebook -- a third-party mobile app -- to view the convention schedule, find rooms, read guest bios, and plan their day. The platform does not read from Guidebook; it publishes to it. Data flows one direction: Platform -> Guidebook API.

Not everything in the platform schedule is public. Internal meetings, staff-only logistics events, and draft/tentative events are excluded. Only events with `status = 'published'` and `properties.is_public = true` are pushed. Guest bios are published only when the guest record has an approved public profile. Venue and room information is pushed to give attendees location context for each session.

Publishing can be triggered manually (a "Publish to Guidebook" button in the admin UI) or automatically (nightly scheduled sync). Both paths use the same publish pipeline: query eligible records, diff against what was last published, push creates/updates/deletes to the Guidebook API.

The sync is incremental. Each record tracks `last_published_at`. On each publish run, only records changed since the last publish are pushed. Deletions (events canceled or archived in the platform) are propagated as deletes in Guidebook.

Dependencies: `shared-services/scheduling-calendar.md` (schedule_event concept), `shared-services/venue-management.md` (venue concept), `api/integration-patterns.md` (call_api action pattern), `automation/workflow-actions.md` (call_api action), `core/event-bus.md` (domain events).

Everything ships.

---

## 1. What Is Guidebook

### Purpose

Clarify Guidebook's role in the convention ecosystem so that the integration scope is unambiguous.

### Detail

Guidebook is a third-party mobile app platform used by conventions, conferences, and events to provide attendees with a digital program guide. For this convention:

- **Attendees** download the Guidebook app (iOS/Android) and access the convention's guide.
- **The guide contains:** session schedule, guest/speaker profiles, venue maps, announcements.
- **The platform publishes data TO Guidebook** via the Guidebook API (REST). The platform never reads data back from Guidebook.
- **Guidebook is not the system of record** for anything. If there is a discrepancy, the platform is correct and Guidebook is stale until the next sync.

#### What Guidebook Is Not

- Not a scheduling tool. Scheduling happens in the platform.
- Not a data source. The platform does not import from Guidebook.
- Not a feedback channel. Attendee feedback (if collected via Guidebook) is handled separately, outside this integration scope.

#### Guidebook API

Guidebook exposes a REST API for managing guide content programmatically:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/sessions/` | POST/PUT/DELETE | Create, update, delete schedule sessions |
| `/api/v2/custom-list-items/` | POST/PUT/DELETE | Create, update, delete speaker/guest profiles |
| `/api/v2/locations/` | POST/PUT/DELETE | Create, update, delete venue/room locations |
| `/api/v2/maps/` | POST/PUT | Upload venue maps |

Authentication: API key in the `Authorization` header. The key is stored in the platform's `api_integrations` table (see `api/integration-patterns.md`), encrypted at rest, never logged.

### Acceptance Criteria

- [ ] Integration is strictly one-way: platform pushes to Guidebook, never reads back.
- [ ] Guidebook API key stored encrypted in `api_integrations`, never in source code.
- [ ] Integration scope limited to sessions, speakers, locations, and maps.
- [ ] No attendee data flows from Guidebook into the platform.

---

## 2. Data Flow

### Purpose

Define exactly what data moves from the platform to Guidebook and the filtering rules that determine eligibility.

### Detail

#### Eligible Records

| Platform Concept | Guidebook Entity | Eligibility Filter |
|-----------------|-----------------|-------------------|
| `schedule_event` | Session | `status = 'published'` AND `properties.is_public = true` AND `NOT archived` |
| `guest` | Speaker (custom list item) | `status IN ('confirmed', 'attended')` AND `properties.public_profile_approved = true` AND `NOT archived` |
| `venue` | Location | `properties.is_public_venue = true` AND `NOT archived` |
| `venue` (maps) | Map | `properties.map_image_url IS NOT NULL` |

Records that do not meet eligibility criteria are never pushed to Guidebook. If a previously published record becomes ineligible (event moved back to draft, guest profile unapproved), it is deleted from Guidebook on the next sync.

#### Excluded Content

The following are explicitly excluded from Guidebook publishing:

- Events with `status` of `draft`, `tentative`, or `canceled`.
- Events with `properties.is_public = false` (internal/staff-only).
- Events with `event_type = 'logistics'` or `event_type = 'meeting'`.
- Guest records without approved public profiles.
- Venue records marked as staff-only or back-of-house.
- All JSONB properties marked `hidden = true` in the ontology.

#### Data Integrity

Each published record maintains a mapping:

```sql
CREATE TABLE guidebook_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_concept    TEXT NOT NULL,      -- 'schedule_event', 'guest', 'venue'
  platform_record_id  UUID NOT NULL,
  guidebook_entity_type TEXT NOT NULL,    -- 'session', 'custom_list_item', 'location', 'map'
  guidebook_entity_id TEXT NOT NULL,      -- Guidebook's ID for the entity
  last_published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_published_hash TEXT NOT NULL,      -- SHA-256 of published payload for change detection
  sync_status         TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN (
    'synced', 'pending_create', 'pending_update', 'pending_delete', 'error'
  )),
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform_concept, platform_record_id, guidebook_entity_type)
);

CREATE INDEX idx_guidebook_mappings_status
  ON guidebook_mappings (sync_status)
  WHERE sync_status != 'synced';
```

### Acceptance Criteria

- [ ] Only records matching eligibility filters are published.
- [ ] Records that become ineligible are deleted from Guidebook.
- [ ] `guidebook_mappings` table tracks every platform-to-Guidebook entity relationship.
- [ ] Payload hash enables change detection without re-comparing all fields.
- [ ] Logistics and meeting event types are never published.
- [ ] Hidden ontology properties are excluded from published payloads.

---

## 3. Publish Workflow

### Purpose

Define the trigger mechanisms and execution pipeline for publishing data to Guidebook.

### Detail

#### Manual Trigger

The admin UI includes a "Publish to Guidebook" button on the scheduling dashboard. Clicking it:

1. Confirms the action with a summary: "X events, Y guests, Z venues eligible for publish."
2. On confirmation, enqueues a `guidebook_publish` job.
3. The UI shows a progress indicator with real-time status updates.

The button is available to users with the `guidebook_publish` permission (typically directors and senior coordinators).

#### Scheduled Trigger

A nightly scheduled job runs the same publish pipeline:

- Cron: `0 2 * * *` (2:00 AM local time, daily during convention week).
- The schedule is configurable in the admin UI under Settings > Integrations > Guidebook.
- During non-convention periods, the scheduled job is disabled.

#### Publish Pipeline

Both triggers execute the same pipeline:

```
1. QUERY eligible records
   - schedule_events WHERE status='published' AND is_public=true AND NOT archived
   - guests WHERE status IN ('confirmed','attended') AND public_profile_approved=true AND NOT archived
   - venues WHERE is_public_venue=true AND NOT archived

2. DIFF against guidebook_mappings
   - New records (no mapping exists) -> pending_create
   - Changed records (payload hash differs) -> pending_update
   - Removed records (mapping exists, record no longer eligible) -> pending_delete

3. EXECUTE API calls
   - Creates: POST to Guidebook API, store returned entity ID in mapping
   - Updates: PUT to Guidebook API with entity ID
   - Deletes: DELETE to Guidebook API, remove mapping row

4. LOG results
   - Success/failure per record in guidebook_mappings.sync_status
   - Summary in audit log: "Published X creates, Y updates, Z deletes to Guidebook"
   - Errors stored in guidebook_mappings.error_message for retry
```

#### Error Handling

- Individual record failures do not block other records. The pipeline continues.
- Failed records are marked `sync_status = 'error'` with the error message.
- On next publish run, errored records are retried.
- After 3 consecutive failures for the same record, an alert is sent to the admin.

#### Publish Preview

Before executing, the pipeline can run in preview mode (triggered from the UI):

- Shows what would be created, updated, and deleted.
- No API calls are made.
- Admin reviews the diff and decides whether to proceed.

### Acceptance Criteria

- [ ] Manual trigger shows eligibility summary before executing.
- [ ] Manual trigger requires `guidebook_publish` permission.
- [ ] Scheduled trigger runs at configured cron time.
- [ ] Pipeline processes creates, updates, and deletes in a single run.
- [ ] Individual record failures do not block other records.
- [ ] Failed records are retried on subsequent runs.
- [ ] 3 consecutive failures trigger admin alert.
- [ ] Preview mode shows diff without making API calls.
- [ ] Audit log records publish summary.

---

## 4. Field Mapping

### Purpose

Define the field-level translation between platform concepts and Guidebook entities.

### Detail

#### schedule_event -> Guidebook Session

| schedule_event field | Guidebook session field | Notes |
|---------------------|------------------------|-------|
| `name` | `name` | Session title. |
| `description` | `description_html` | Rendered as HTML. |
| `start_time` | `start_time` | ISO 8601. |
| `end_time` | `end_time` | ISO 8601. |
| `venue.name` | `locations` (array) | Resolved from venue_id relation. |
| `properties.track` | `tracks` (array) | Convention track for filtering in Guidebook. |
| `event_type` | `tracks` (appended) | Event type added as a secondary track. |
| Guest names (from junction) | `schedule_tracks` or description | Listed in description if not using Guidebook's speaker linking. |

#### guest -> Guidebook Speaker (Custom List Item)

| guest field | Guidebook field | Notes |
|-------------|----------------|-------|
| `name` | `name` | Display name. |
| `properties.public_bio` | `description_html` | Approved bio text, rendered as HTML. |
| `properties.photo_url` | `image` | Headshot URL. Must be publicly accessible. |
| `properties.social_links` | `description_html` (appended) | Social media links appended to bio. |
| `properties.title` | `subtitle` | Guest title/affiliation. |

#### venue -> Guidebook Location

| venue field | Guidebook field | Notes |
|-------------|----------------|-------|
| `name` | `name` | Room/venue name. |
| `properties.building` | `description` | Building name for wayfinding. |
| `properties.floor` | `description` (appended) | Floor number. |
| `properties.map_image_url` | Associated map | Linked via Guidebook map entity. |
| `properties.capacity` | Not mapped | Internal data, not shown to attendees. |

#### Track Mapping

Convention tracks (panels, workshops, concerts, etc.) map to Guidebook "tracks" which attendees use to filter the schedule:

```jsonc
{
  "track_mapping": {
    "panel": "Panels & Discussions",
    "workshop": "Workshops",
    "concert": "Concerts & Performances",
    "autograph": "Autograph Sessions",
    "ceremony": "Ceremonies",
    "screening": "Screenings",
    "demo": "Demos & Exhibits"
  }
}
```

This mapping is stored in `api_integrations.properties` for the Guidebook integration and is admin-editable.

### Acceptance Criteria

- [ ] All mapped fields produce valid Guidebook API payloads.
- [ ] Venue name resolved from relation, not raw UUID.
- [ ] Guest bio uses the `public_bio` field, not internal notes.
- [ ] Photo URLs are validated as publicly accessible before publishing.
- [ ] Track mapping is configurable by admin.
- [ ] Unmapped event types default to a generic "Events" track.
- [ ] HTML description is sanitized before pushing (no script tags, no platform-internal links).

---

## 5. Incremental Sync

### Purpose

Minimize API calls and publishing time by only pushing records that have changed since the last publish.

### Detail

#### Change Detection

Each `guidebook_mappings` row stores `last_published_hash` -- a SHA-256 hash of the serialized payload that was last sent to Guidebook. On each publish run:

1. Build the Guidebook payload for each eligible record.
2. Hash the payload.
3. Compare against `last_published_hash` in the mapping.
4. If hashes match, skip (no change). If hashes differ, mark as `pending_update`.

This approach is more reliable than timestamp-based change detection because it catches changes to related records (e.g., venue name changed, which affects the session's location field).

#### Deletion Handling

Records that were previously published but are no longer eligible must be removed from Guidebook:

1. Query `guidebook_mappings` for all mappings with `sync_status = 'synced'`.
2. For each mapping, check if the source record still meets eligibility criteria.
3. If the source record is archived, canceled, or no longer eligible, mark the mapping as `pending_delete`.
4. Execute DELETE against Guidebook API.
5. On success, remove the mapping row (hard delete -- no need to keep the mapping for a deleted entity).

Specific deletion scenarios:

| Platform Action | Guidebook Result |
|----------------|-----------------|
| Event status changed from `published` to `draft` | Session deleted from Guidebook |
| Event status changed to `canceled` | Session deleted from Guidebook |
| Event archived | Session deleted from Guidebook |
| Event `is_public` changed to `false` | Session deleted from Guidebook |
| Guest `public_profile_approved` revoked | Speaker deleted from Guidebook |
| Guest archived | Speaker deleted from Guidebook |
| Venue `is_public_venue` changed to `false` | Location deleted from Guidebook |

#### Publish Timestamp

After a successful publish run, the system updates:

- `guidebook_mappings.last_published_at` per record.
- `guidebook_mappings.last_published_hash` per record.
- A global `last_publish_run_at` timestamp in the Guidebook integration config for dashboard display.

#### Full Re-Publish

An admin can trigger a full re-publish that ignores the incremental hash comparison and pushes all eligible records. This is useful after:

- Initial Guidebook setup (first publish).
- Guidebook data corruption or manual edits in Guidebook.
- Major bulk updates in the platform.

Full re-publish resets all `last_published_hash` values, forcing every record to be compared and pushed.

### Acceptance Criteria

- [ ] Incremental sync only pushes records where payload hash has changed.
- [ ] Related record changes (venue rename) are detected via payload hash.
- [ ] Records that become ineligible are deleted from Guidebook.
- [ ] Canceled events are deleted from Guidebook.
- [ ] Archived records are deleted from Guidebook.
- [ ] `is_public = false` toggle removes the session from Guidebook.
- [ ] Full re-publish option available to admins.
- [ ] Mapping rows for deleted entities are hard-deleted after successful API call.
- [ ] `last_publish_run_at` updated after each successful run.

---

## 6. Test Plan

### Unit Tests -- Eligibility Filtering

| Test Case | Assertion |
|-----------|-----------|
| Event status=published, is_public=true | Eligible |
| Event status=draft | Not eligible |
| Event status=tentative | Not eligible |
| Event status=canceled | Not eligible |
| Event is_public=false | Not eligible |
| Event event_type=logistics | Not eligible |
| Event event_type=meeting | Not eligible |
| Event archived=true | Not eligible |
| Guest status=confirmed, profile_approved=true | Eligible |
| Guest status=invited (not yet confirmed) | Not eligible |
| Guest public_profile_approved=false | Not eligible |
| Venue is_public_venue=true | Eligible |
| Venue is_public_venue=false | Not eligible |

### Unit Tests -- Field Mapping

| Test Case | Assertion |
|-----------|-----------|
| schedule_event -> session payload | All fields mapped per mapping table |
| Venue name resolved in session location | Location is venue name, not UUID |
| Guest bio uses public_bio field | Internal notes excluded |
| Track mapping applied | event_type translated to Guidebook track name |
| Unknown event_type | Defaults to "Events" track |
| HTML description sanitized | No script tags in output |
| Photo URL validated | Invalid URL flagged, not published |

### Unit Tests -- Incremental Sync

| Test Case | Assertion |
|-----------|-----------|
| Record unchanged since last publish | Skipped (hash match) |
| Record field changed | Pushed (hash mismatch) |
| Related venue name changed | Session re-pushed (hash mismatch due to location change) |
| New eligible record (no mapping) | Created in Guidebook, mapping stored |
| Record becomes ineligible | Deleted from Guidebook, mapping removed |
| Event canceled | Deleted from Guidebook |
| Event archived | Deleted from Guidebook |
| Full re-publish | All records pushed regardless of hash |

### Integration Tests

| Test Case | Assertion |
|-----------|-----------|
| Manual publish: button -> confirmation -> API calls -> result | Full flow completes, mappings updated |
| Scheduled publish: cron fires -> pipeline runs | Same result as manual |
| Preview mode: shows diff, no API calls | Diff displayed, zero Guidebook API requests |
| Publish 100 events + 20 guests + 15 venues | All pushed, mappings correct |
| Error on 1 record out of 50 | 49 succeed, 1 marked error, pipeline continues |
| Retry errored record on next publish | Record re-attempted |
| 3 consecutive failures | Admin alert sent |

### Performance Tests

| Scenario | Target |
|----------|--------|
| Incremental sync: 500 records, 10 changed | < 15s (including API calls) |
| Full re-publish: 500 records | < 120s (respecting API rate limits) |
| Eligibility query on 1000 schedule_events | < 200ms |
| Hash computation for 500 payloads | < 1s |

### Error Handling Tests

| Scenario | Expected Behavior |
|----------|-------------------|
| Guidebook API returns 401 (bad key) | All records fail, admin notified, no partial state |
| Guidebook API returns 429 (rate limit) | Backoff and retry |
| Guidebook API returns 404 on update (entity deleted in Guidebook) | Re-create entity, update mapping |
| Network timeout to Guidebook API | Retry with backoff, fail after 3 attempts |
| Guidebook API returns 500 | Record marked error, pipeline continues |
| Platform DB connection lost during publish | Transaction rolled back, publish retried on next run |
