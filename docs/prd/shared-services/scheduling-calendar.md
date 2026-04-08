# Scheduling & Calendar

> Org-wide schedule_event concept with typed columns + JSONB properties. Venue-aware conflict detection (hard block for concerts, soft warning for meetings). Convention days divided into time blocks; grid view renders venues x blocks. Any department creates events; shared venues use priority-based conflict resolution (concert > panel > workshop > meeting). Recurring events via templates. Postgres is the system of record.

---

## Overview

Every convention department creates scheduled events -- programming runs panels, guest relations books autograph sessions, operations schedules logistics walkthroughs, exhibits assigns demo times. Without a shared scheduling system, departments double-book rooms, miss conflicts, and coordinate via manual back-channels.

This PRD defines the `schedule_event` concept as an org-wide shared service. The concept lives in Postgres as a typed domain table with a JSONB `properties` column for department-specific extensions. Relationships connect events to venues (via `venue_id`), guests (via `guest_ids`), and staff (via `staff_ids`). A conflict detection layer runs before every save to check for overlapping bookings on the same venue. Time block management divides convention days into a grid, and the UI renders a venue-by-time-block matrix for visual scheduling.

Cross-department scheduling works because the schedule_event concept is org-scoped, not department-scoped. RBAC controls who can create, edit, and view events. The event bus fires `schedule_event.created`, `schedule_event.updated`, and `schedule_event.deleted` events that downstream systems consume -- Google Calendar sync, Guidebook publishing, itinerary generation, and cross-department notifications.

Dependencies: `data/postgres-schema.md` (table design), `core/ontology-engine.md` (concept loading), `core/rbac-engine.md` (permission enforcement), `core/event-bus.md` (domain events), `shared-services/venue-management.md` (venue concept), `ui/view-renderer.md` (grid/timeline rendering).

Everything ships.

---

## 1. Schedule Event Concept

### Purpose

Define the canonical `schedule_event` domain table that all departments use to schedule convention activities.

### Detail

#### Domain Table

```sql
CREATE TABLE schedule_events (
  -- Typed core columns
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'panel', 'concert', 'workshop', 'meeting', 'autograph',
    'logistics', 'ceremony', 'screening', 'demo', 'other'
  )),
  venue_id      UUID NOT NULL REFERENCES venues(id),
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'tentative', 'confirmed', 'published', 'canceled'
  )),
  department    TEXT NOT NULL,
  description   TEXT,
  priority      INTEGER NOT NULL DEFAULT 50,

  -- Dynamic properties (ontology-defined)
  properties    JSONB NOT NULL DEFAULT '{}',

  -- Google Calendar sync
  gcal_event_id TEXT,

  -- Guidebook sync
  last_published_at TIMESTAMPTZ,

  -- Metadata
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id),
  archived      BOOLEAN NOT NULL DEFAULT false,

  -- Constraints
  CHECK (end_time > start_time)
);

-- Indexes
CREATE INDEX idx_schedule_events_venue_time
  ON schedule_events (venue_id, start_time, end_time)
  WHERE NOT archived;

CREATE INDEX idx_schedule_events_dept
  ON schedule_events (department, start_time)
  WHERE NOT archived;

CREATE INDEX idx_schedule_events_status
  ON schedule_events (status)
  WHERE NOT archived;

CREATE INDEX idx_schedule_events_properties
  ON schedule_events USING GIN (properties);

CREATE INDEX idx_schedule_events_type_time
  ON schedule_events (event_type, start_time)
  WHERE NOT archived;
```

#### Junction Tables for Many-to-Many Relations

```sql
-- Guest assignments (many guests per event, many events per guest)
CREATE TABLE schedule_event_guests (
  schedule_event_id UUID NOT NULL REFERENCES schedule_events(id),
  guest_id          UUID NOT NULL REFERENCES guests(id),
  role              TEXT DEFAULT 'participant',
  PRIMARY KEY (schedule_event_id, guest_id)
);

-- Staff assignments (many staff per event, many events per staff)
CREATE TABLE schedule_event_staff (
  schedule_event_id UUID NOT NULL REFERENCES schedule_events(id),
  staff_id          UUID NOT NULL REFERENCES staff(id),
  role              TEXT DEFAULT 'assigned',
  PRIMARY KEY (schedule_event_id, staff_id)
);
```

#### Ontology Registration

The `schedule_event` concept is registered in `ontology_concepts` with `owner_scope = 'org'`. Properties defined in `ontology_properties` map to both typed columns and JSONB fields:

| Property | Type | Typed Column | Notes |
|----------|------|-------------|-------|
| `name` | text | `name` | Required. Event title. |
| `event_type` | select | `event_type` | Enum of event categories. |
| `venue_id` | relation | `venue_id` | FK to venues table. |
| `start_time` | datetime | `start_time` | Convention-local timezone. |
| `end_time` | datetime | `end_time` | Must be after start_time. |
| `status` | status | `status` | Draft through published lifecycle. |
| `department` | text | `department` | Owning department key. |
| `priority` | number | `priority` | Used for conflict resolution. Lower = higher priority. |
| `guest_ids` | relation | junction table | Many-to-many via schedule_event_guests. |
| `staff_ids` | relation | junction table | Many-to-many via schedule_event_staff. |
| `setup_minutes` | number | JSONB | Minutes of setup time before event. |
| `teardown_minutes` | number | JSONB | Minutes of teardown after event. |
| `is_public` | checkbox | JSONB | Visible to attendees (Guidebook publishing filter). |
| `track` | select | JSONB | Convention track / category for grouping. |
| `notes` | rich_text | JSONB | Internal notes, not published. |
| `max_capacity` | number | JSONB | Override venue default capacity for this event. |

#### Domain Events

Every mutation emits to the event bus:

| Event | Trigger |
|-------|---------|
| `schedule_event.created` | New event inserted |
| `schedule_event.updated` | Any field changed |
| `schedule_event.deleted` | Event archived |
| `schedule_event.status_changed` | Status field specifically changed |
| `schedule_event.conflict_detected` | Overlapping booking found |

### Acceptance Criteria

- [ ] `schedule_events` table created with all typed columns and JSONB `properties`.
- [ ] `event_type` CHECK constraint enforces valid enum values.
- [ ] `status` CHECK constraint enforces valid lifecycle states.
- [ ] `end_time > start_time` CHECK constraint prevents invalid time ranges.
- [ ] Junction tables for guest and staff assignments exist with composite PKs.
- [ ] Partial indexes on `venue_id + time range` support conflict detection queries.
- [ ] Concept registered in `ontology_concepts` with `owner_scope = 'org'`.
- [ ] All five domain events fire correctly on the event bus.

---

## 2. Room Conflict Detection

### Purpose

Prevent double-booking of venues by detecting overlapping time ranges before saving a schedule event.

### Detail

#### Conflict Query

Before inserting or updating a schedule_event, the system runs an overlap check:

```sql
SELECT id, name, event_type, start_time, end_time, department, status
FROM schedule_events
WHERE venue_id = $1
  AND NOT archived
  AND status != 'canceled'
  AND id != $2  -- exclude self on updates
  AND start_time < $4  -- proposed end_time
  AND end_time > $3    -- proposed start_time
ORDER BY start_time;
```

This detects any existing event whose time range overlaps the proposed time range for the same venue. The query accounts for setup and teardown buffers by extending the effective time window:

```
effective_start = start_time - setup_minutes
effective_end   = end_time + teardown_minutes
```

#### Conflict Response

The conflict check returns a structured result:

```typescript
interface ConflictCheckResult {
  has_conflicts: boolean;
  conflicts: Array<{
    event_id: string;
    event_name: string;
    event_type: string;
    department: string;
    start_time: string;
    end_time: string;
    overlap_minutes: number;
  }>;
  resolution: 'hard_block' | 'soft_warning';
  message: string;
}
```

#### Hard Block vs. Soft Warning

Resolution depends on the event types involved:

| Proposed Event | Existing Event | Resolution |
|---------------|----------------|------------|
| Any | concert | Hard block (concerts own the venue exclusively) |
| concert | Any | Hard block |
| panel | panel | Hard block (one panel per room at a time) |
| workshop | workshop | Hard block |
| meeting | meeting | Soft warning (meetings can share a large room) |
| meeting | panel | Soft warning (can yield to panel) |
| logistics | Any | Soft warning (logistics is flexible) |
| autograph | autograph | Hard block (one autograph session per venue) |

Hard block: the save is rejected with conflict details. The user must resolve the conflict before saving.

Soft warning: the save proceeds, but the response includes a `conflict_warning` payload. The UI displays the warning. An `schedule_event.conflict_detected` event fires on the event bus for downstream notification.

#### Priority Override

Users with the `schedule_override` permission (typically directors) can force-save through hard blocks. The override is recorded in the audit log with a reason field.

### Acceptance Criteria

- [ ] Overlap query correctly identifies all conflicting events for a given venue and time range.
- [ ] Setup and teardown buffers are included in the effective time window.
- [ ] Hard blocks prevent save and return conflict details.
- [ ] Soft warnings allow save and return conflict details in the response.
- [ ] Conflict resolution matrix is applied correctly based on event types.
- [ ] `schedule_override` permission allows force-save through hard blocks.
- [ ] Override saves are recorded in the audit log with actor and reason.
- [ ] Self-exclusion: updating an event does not conflict with itself.
- [ ] Canceled events are excluded from conflict checks.
- [ ] Archived events are excluded from conflict checks.

---

## 3. Time Block Management

### Purpose

Divide convention days into named time blocks to provide a grid-based scheduling experience and standardize event timing.

### Detail

#### Time Block Definition

```sql
CREATE TABLE time_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convention_day DATE NOT NULL,
  name          TEXT NOT NULL,           -- e.g., "Morning Block 1", "Afternoon Panels"
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ NOT NULL,
  block_type    TEXT DEFAULT 'standard', -- standard, setup, teardown, break
  sort_order    INTEGER NOT NULL DEFAULT 0,
  properties    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived      BOOLEAN NOT NULL DEFAULT false,

  CHECK (end_time > start_time)
);

CREATE INDEX idx_time_blocks_day
  ON time_blocks (convention_day, sort_order)
  WHERE NOT archived;
```

Convention days are typically divided into blocks like:

| Day | Block | Time |
|-----|-------|------|
| Friday | Setup | 08:00-10:00 |
| Friday | Morning Panels | 10:00-12:00 |
| Friday | Lunch Break | 12:00-13:00 |
| Friday | Afternoon Panels 1 | 13:00-15:00 |
| Friday | Afternoon Panels 2 | 15:00-17:00 |
| Friday | Evening Events | 17:00-20:00 |
| Friday | Concert/Dance | 20:00-24:00 |

#### Grid View: Venues x Time Blocks

The scheduling grid renders as a matrix:

- **Rows:** Venues (rooms), sorted by floor/building/capacity.
- **Columns:** Time blocks for the selected convention day.
- **Cells:** Events occupying that venue during that block. Events spanning multiple blocks stretch across cells.

The grid view is a `ViewConfig` with `viewType = 'timeline'` configured for the `schedule_event` concept:

```jsonc
{
  "conceptKey": "schedule_event",
  "viewType": "timeline",
  "timelineStart": "start_time",
  "timelineEnd": "end_time",
  "groupBy": "venue_id",
  "columns": ["name", "event_type", "department", "status"],
  "filters": [
    { "field": "start_time", "op": "gte", "value": "{{selected_day_start}}" },
    { "field": "start_time", "op": "lt", "value": "{{selected_day_end}}" }
  ]
}
```

#### Click-to-Create

Clicking an empty cell in the grid opens a pre-filled create form:

1. `venue_id` set to the row's venue.
2. `start_time` set to the block's start.
3. `end_time` set to the block's end.
4. Department defaults to the current user's department.

The form is the standard dynamic form for `schedule_event` (from `ui/dynamic-forms.md`), pre-populated with these defaults.

#### Day Selector

A tab bar or date picker above the grid switches between convention days. The grid re-queries for events on the selected day.

### Acceptance Criteria

- [ ] `time_blocks` table created with day, name, start/end, and sort_order.
- [ ] Grid view renders venues as rows and time blocks as columns.
- [ ] Events spanning multiple blocks visually stretch across columns.
- [ ] Empty cell click opens create form with venue, start, end pre-filled.
- [ ] Day selector switches the grid to the selected convention day.
- [ ] Time blocks are editable by admins (add, modify, delete blocks per day).
- [ ] Grid handles venues with no events (empty row) and blocks with no events (empty cell).

---

## 4. Cross-Department Scheduling

### Purpose

Allow any department to create schedule events while coordinating access to shared venues through RBAC and conflict resolution.

### Detail

#### Department Ownership

Every schedule event has a `department` field indicating the owning department. The creating user's department is set by default. RBAC data scoping can restrict views by department:

- **Own department events:** Full CRUD for coordinators and directors.
- **Other department events:** Read-only for coordinators; read-write for directors with cross-department grants.
- **Org-wide events:** Events with `department = 'org'` are visible to all; only org-level roles can create them.

#### Shared Venue Coordination

Some venues are shared across departments (Main Stage, Panel Rooms). When a department books a shared venue:

1. Conflict detection runs against all departments' events.
2. If a conflict exists, the system shows which department owns the conflicting event.
3. Soft conflicts include a "Request Resolution" action that sends a notification to the conflicting department's coordinator.

#### Priority-Based Conflict Resolution

When two departments want the same venue at the same time, `event_type` determines priority:

| Priority | Event Type | Rationale |
|----------|-----------|-----------|
| 10 | concert | Highest. Concerts require exclusive venue with sound/lighting. |
| 20 | ceremony | Opening/closing ceremonies are org-wide. |
| 30 | autograph | Guest commitments, hard to reschedule. |
| 40 | panel | Core programming content. |
| 50 | workshop | Interactive sessions, moderately flexible. |
| 60 | screening | Can move to alternate rooms. |
| 70 | demo | Exhibits demos, location-flexible. |
| 80 | meeting | Internal meetings, most flexible. |
| 90 | logistics | Setup/teardown, can adjust timing. |

Lower number = higher priority. When a lower-priority event conflicts with a higher-priority event, the conflict is a soft warning for the lower-priority event. When a higher-priority event conflicts with an existing lower-priority event, the system suggests the lower-priority event be moved.

#### Cross-Department Notification

When an event is created or modified in a shared venue, the event bus fires `schedule_event.created` or `schedule_event.updated`. Workflow subscriptions notify affected departments:

```jsonc
{
  "trigger": { "type": "event_name", "pattern": "schedule_event.created" },
  "condition": {
    "and": [
      { "field": "venue_id", "op": "in", "value": "{{shared_venue_ids}}" },
      { "field": "department", "op": "neq", "value": "{{subscriber_dept}}" }
    ]
  },
  "actions": [
    {
      "type": "notify",
      "recipients": ["role:dept_coordinator"],
      "templateName": "shared_venue_booking_alert"
    }
  ]
}
```

### Acceptance Criteria

- [ ] Any department can create schedule events.
- [ ] `department` field is set automatically from the creating user's department.
- [ ] RBAC data scoping restricts cross-department visibility as configured.
- [ ] Conflict detection spans all departments for shared venues.
- [ ] Conflict response includes the owning department of the conflicting event.
- [ ] Priority ordering by event type is enforced in conflict resolution.
- [ ] "Request Resolution" action sends a notification to the conflicting department.
- [ ] Cross-department workflow notifications fire for shared venue bookings.

---

## 5. Recurring Events

### Purpose

Support events that repeat across convention days (e.g., daily panels at the same time, recurring logistics meetings) without requiring manual creation of each instance.

### Detail

#### Recurrence Model

Recurring events use a template-and-instance pattern:

1. **Template event:** A schedule_event with `properties.recurrence` set:

```jsonc
{
  "recurrence": {
    "pattern": "daily",          // daily | specific_days
    "days": ["friday", "saturday", "sunday"],  // for specific_days
    "same_time": true,           // repeat at same start/end time
    "same_venue": true           // repeat in same venue
  }
}
```

2. **Instance generation:** When a template event is saved with a recurrence pattern, the system generates individual schedule_event rows for each occurrence. Each instance has:
   - `properties.recurring_template_id` pointing to the template event's ID.
   - `properties.is_recurring_instance = true`.
   - Its own `start_time`, `end_time`, `venue_id` (copied from template, offset by day).

3. **Cascading updates:** Updating the template event with `apply_to_instances = true` propagates changes to all un-modified instances. Instances that have been individually edited are flagged `properties.instance_modified = true` and are skipped.

#### Create-from-Template

Beyond recurrence, users can create events from saved templates:

```sql
CREATE TABLE schedule_event_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  department  TEXT NOT NULL,
  defaults    JSONB NOT NULL,  -- partial schedule_event fields
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);
```

Templates store partial event data (event_type, duration, default venue, staff roles needed). Creating an event from a template pre-fills the form with template defaults, and the user adjusts date/time/venue as needed.

#### Bulk Operations

- **Generate all instances:** "Create recurring" button generates all instances in a single transaction.
- **Cancel series:** Archiving the template event offers to cancel all future instances.
- **Modify series:** Editing the template with cascade applies changes to all unmodified instances in a single transaction.

### Acceptance Criteria

- [ ] Recurrence pattern stored in JSONB `properties.recurrence` on the template event.
- [ ] Instance generation creates individual schedule_event rows for each occurrence.
- [ ] Each instance links back to the template via `properties.recurring_template_id`.
- [ ] Conflict detection runs for each generated instance independently.
- [ ] Cascading updates propagate to unmodified instances; modified instances are skipped.
- [ ] `schedule_event_templates` table stores reusable event templates.
- [ ] Create-from-template pre-fills the event form with template defaults.
- [ ] Bulk cancel archives all instances in a single transaction.
- [ ] Generating 20+ instances (full convention, multiple days) completes in < 3s.

---

## 6. Test Plan

### Unit Tests -- Schedule Event CRUD

| Test Case | Assertion |
|-----------|-----------|
| Create event with all required fields | Row inserted, domain event fires |
| Create event missing `venue_id` | Validation error, no row inserted |
| Create event with `end_time < start_time` | CHECK constraint rejects |
| Create event with invalid `event_type` | CHECK constraint rejects |
| Update event status draft -> confirmed | Status updated, `schedule_event.status_changed` fires |
| Archive event | `archived = true`, `schedule_event.deleted` fires |
| Assign guest to event | Junction table row created |
| Assign staff to event | Junction table row created |
| Remove guest from event | Junction table row deleted |

### Unit Tests -- Conflict Detection

| Test Case | Assertion |
|-----------|-----------|
| No overlap, same venue | `has_conflicts = false` |
| Full overlap, same venue | `has_conflicts = true`, conflict returned |
| Partial overlap (start inside existing) | `has_conflicts = true` |
| Partial overlap (end inside existing) | `has_conflicts = true` |
| Adjacent events (end == start) | `has_conflicts = false` (touching, not overlapping) |
| Same time, different venue | `has_conflicts = false` |
| Overlap with canceled event | `has_conflicts = false` (canceled excluded) |
| Overlap with archived event | `has_conflicts = false` (archived excluded) |
| Concert vs. panel overlap | `resolution = 'hard_block'` |
| Meeting vs. meeting overlap | `resolution = 'soft_warning'` |
| Self-overlap on update | `has_conflicts = false` (self excluded) |
| Overlap with setup/teardown buffer | `has_conflicts = true` when buffer overlaps |
| Override with `schedule_override` permission | Save succeeds despite hard block |

### Unit Tests -- Recurring Events

| Test Case | Assertion |
|-----------|-----------|
| Create daily recurrence (3-day con) | 3 instance rows created |
| Create specific-days recurrence | Instance per specified day only |
| Cascade update to instances | Unmodified instances updated, modified instances skipped |
| Cancel series | Template + all instances archived |
| Conflict on one instance | That instance flagged, others created |
| Create from template | Form pre-filled with template defaults |

### Integration Tests

| Test Case | Assertion |
|-----------|-----------|
| Create event -> domain event -> Google Calendar sync | gcal_event_id written back |
| Create published event -> Guidebook eligible | Event appears in Guidebook publish query |
| Cross-department conflict -> notification | Conflicting department receives alert |
| Grid view load for full convention day | All events rendered in correct cells, < 500ms |
| Click-to-create in grid -> conflict check -> save | Full flow completes |

### Performance Tests

| Scenario | Target |
|----------|--------|
| Conflict query on 500 events in venue | < 50ms |
| Grid view load: 20 venues x 8 blocks x 100 events | < 500ms |
| Generate 30 recurring instances | < 3s |
| Bulk cancel 30 recurring instances | < 2s |
| 10 concurrent event creates on same venue | Correct conflict detection, no deadlocks |
