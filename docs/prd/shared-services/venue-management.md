# Venue Management

> **Org-wide shared service for venue records, room scheduling with conflict detection, equipment tracking per venue, and capacity management.**
> Venues are physical spaces: panel rooms, concert halls, exhibit halls, meeting rooms, outdoor areas.
> Each venue has typed core columns plus a JSONB `properties` column for ontology-defined dynamic fields.
> Venues link to `schedule_events` for room scheduling. Conflict detection prevents double-booking the same room.
> Postgres is the system of record. Roles are ontology-defined.
> This is a Phase 5 / Shared Services deliverable (`_orchestration.md` line 96). Depends on `domain-crud` and `dynamic-forms`.

---

## Overview

Every convention event happens somewhere. Panels need panel rooms. Concerts need concert halls. Registration needs a lobby. Volunteer check-in needs a meeting room. Venue management is the spatial layer of the platform -- it knows what spaces exist, what they can hold, what equipment they have, and when they are in use.

The `venues` table stores each physical space with its type, capacity, equipment list, floor, building, and dynamic properties. Room scheduling links venues to `schedule_events` via a `venue_id` FK on the schedule event. When a scheduler assigns a room to a time block, the system checks for conflicts (another event already in that room at that time) and enforces capacity limits.

Equipment tracking records what is permanently installed in each venue (projector, microphone, chairs) and what can be requested as additional equipment per event. This connects to `shared-services/equipment-logistics.md` for checkout and delivery workflows.

Capacity management enforces hard limits: you cannot schedule a 500-person event in a 100-seat room. Overflow alerts fire when an event's expected attendance exceeds the venue's capacity.

**Key relationships:**

| Relationship | Target | Cardinality | Notes |
|-------------|--------|-------------|-------|
| `venues` → `schedule_events` | `schedule_events` | has-many | Events scheduled in this venue |
| `venues` → `equipment` | `equipment` | has-many | Equipment assigned to this venue |
| `venues.building` | buildings | has-one | Physical building grouping |
| `venues.floor` | floors | has-one | Floor within building |

---

## 1. Venue Concept

### Purpose

Define the core data model for venue records -- typed columns, JSONB properties, venue types, and constraints.

### Detail

#### `venues` table

```sql
CREATE TABLE venues (
  -- Typed core columns
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL
                  CHECK (type IN (
                    'panel_room', 'concert_hall', 'exhibit_hall',
                    'meeting_room', 'outdoor', 'lobby', 'ballroom',
                    'workshop_room', 'theater', 'other'
                  )),
  capacity        INTEGER NOT NULL CHECK (capacity > 0),
  equipment       JSONB NOT NULL DEFAULT '[]',
  floor           TEXT,
  building        TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'maintenance', 'closed', 'reserved')),

  -- Dynamic properties (ontology-defined)
  properties      JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES staff(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

-- Indexes
CREATE INDEX idx_venues_type ON venues (type) WHERE NOT archived;
CREATE INDEX idx_venues_building ON venues (building) WHERE NOT archived;
CREATE INDEX idx_venues_capacity ON venues (capacity) WHERE NOT archived;
CREATE INDEX idx_venues_status ON venues (status) WHERE NOT archived;
CREATE INDEX idx_venues_equipment ON venues USING GIN (equipment);
CREATE INDEX idx_venues_properties ON venues USING GIN (properties);
CREATE INDEX idx_venues_active ON venues (name) WHERE NOT archived AND status = 'active';
```

**Column rationale:**

| Column | Why typed | Notes |
|--------|-----------|-------|
| `name` | Primary display, sort, and search field | e.g., "Main Hall A", "Panel Room 3", "Outdoor Stage" |
| `type` | Scheduling filter (only panel rooms for panels, etc.) | Enum validated by CHECK constraint |
| `capacity` | Capacity enforcement on every scheduling operation | Positive integer, no zero-capacity venues |
| `equipment` | Default equipment list for the venue | JSONB array (see Equipment Tracking section) |
| `floor` | Directory grouping, wayfinding | e.g., "1", "2", "B1" (basement) |
| `building` | Multi-building venue complexes | e.g., "Convention Center", "Hotel North Tower" |
| `status` | Availability gating | `maintenance` = temp unavailable; `closed` = permanently unavailable |
| `properties` | Convention-specific fields | e.g., `wifi_available`, `accessible`, `max_noise_level`, `setup_time_minutes` |

**Venue types:**

| Type | Typical Use | Typical Capacity |
|------|-------------|-----------------|
| `panel_room` | Panels, Q&A sessions | 50 - 300 |
| `concert_hall` | Concerts, ceremonies, large presentations | 500 - 5000 |
| `exhibit_hall` | Exhibits, vendor booths, poster sessions | 200 - 2000 |
| `meeting_room` | Staff meetings, planning sessions, interviews | 10 - 50 |
| `outdoor` | Outdoor events, food areas, gathering spaces | Varies |
| `lobby` | Registration, check-in, informal gathering | Varies |
| `ballroom` | Galas, formal dinners, dance events | 200 - 1000 |
| `workshop_room` | Hands-on workshops, tutorials | 20 - 100 |
| `theater` | Screenings, film events | 100 - 500 |
| `other` | Catch-all for unconventional spaces | Varies |

**Equipment JSONB structure:**

The `equipment` column stores the venue's default (permanently installed) equipment:

```json
[
  { "name": "Projector", "type": "av", "quantity": 1, "notes": "Ceiling-mounted, HDMI" },
  { "name": "Wireless Microphone", "type": "av", "quantity": 2 },
  { "name": "Chairs", "type": "furniture", "quantity": 200 },
  { "name": "Tables (6ft)", "type": "furniture", "quantity": 20 },
  { "name": "Whiteboard", "type": "presentation", "quantity": 1 }
]
```

### Acceptance Criteria

- [ ] `venues` table is created with all typed columns and JSONB `properties`.
- [ ] `type` enforces the CHECK constraint; invalid types are rejected.
- [ ] `capacity` enforces `CHECK (capacity > 0)`; zero and negative values rejected.
- [ ] `equipment` defaults to an empty JSON array `'[]'`.
- [ ] `status` defaults to `'active'` and enforces the CHECK constraint.
- [ ] GIN index on `equipment` supports JSONB containment queries.
- [ ] GIN index on `properties` supports dynamic field queries.
- [ ] `archived` soft-delete works with partial indexes.
- [ ] Venues with `status = 'maintenance'` or `'closed'` are excluded from scheduling availability.

---

## 2. Room Scheduling

### Purpose

Define how venues are linked to schedule events, how conflict detection prevents double-booking, and how the visual timeline per venue works.

### Detail

**Venue-event linkage:**

The `schedule_events` table (defined in `shared-services/scheduling-calendar.md`) has a `venue_id` column:

```sql
-- On schedule_events table
venue_id UUID REFERENCES venues(id)
```

When a scheduler assigns a room to an event, the `venue_id` is set on the schedule event. This creates the linkage.

**Conflict detection:**

Before assigning a venue to an event, the system checks for time overlaps:

```sql
-- Check for conflicts: any other event in the same venue with overlapping time
SELECT se.id, se.name, se.start_time, se.end_time
FROM schedule_events se
WHERE se.venue_id = $venue_id
  AND se.id != $current_event_id
  AND se.status NOT IN ('cancelled', 'draft')
  AND NOT se.archived
  AND se.start_time < $new_end_time
  AND se.end_time > $new_start_time;
```

If this query returns rows, the assignment is blocked. The API returns a 409 Conflict response with the details of the conflicting events:

```json
{
  "error": "venue_conflict",
  "message": "Main Hall A is already booked during this time",
  "conflicts": [
    {
      "event_id": "uuid",
      "event_name": "Opening Ceremony",
      "start_time": "2026-07-15T09:00:00Z",
      "end_time": "2026-07-15T11:00:00Z"
    }
  ]
}
```

**Buffer time:**

Some venues need setup/teardown time between events. This is stored in `properties.setup_time_minutes` and `properties.teardown_time_minutes`. When present, the conflict check extends the event's time window:

```sql
-- Effective time range including buffer
effective_start = start_time - (setup_time_minutes * interval '1 minute')
effective_end = end_time + (teardown_time_minutes * interval '1 minute')
```

**Visual timeline:**

The venue timeline is a view-renderer widget showing a per-venue Gantt-style display:

```
Main Hall A    |===Opening Ceremony===|  |===Panel: AI Ethics===|  |===Concert===|
Panel Room 1   |==Panel: Robotics==|     |==Panel: VR==|
Panel Room 2   |==Workshop==|                              |==Panel: Climate==|
Meeting Room A |=Staff Mtg=|  |=Staff Mtg=|  |=Staff Mtg=|  |=Staff Mtg=|
               08:00       10:00       12:00       14:00       16:00       18:00
```

The timeline is interactive:

- Click an empty slot to create a new event in that venue at that time.
- Click an event block to view/edit the event.
- Drag event edges to resize (changes start/end time with conflict re-check).
- Filter by building, floor, or venue type.

**API endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/venues/:id/schedule?date=2026-07-15` | All events in this venue on a given date |
| `GET /api/venues/availability?start=...&end=...&type=panel_room` | Available venues for a time range and type |
| `POST /api/schedule-events/:id/assign-venue` | Assign venue to event (with conflict check) |

### Acceptance Criteria

- [ ] Setting `venue_id` on a `schedule_event` links the event to the venue.
- [ ] Conflict detection query checks for time overlaps within the same venue.
- [ ] Conflicts return HTTP 409 with the list of conflicting events.
- [ ] Buffer time (setup/teardown) is included in conflict calculations when defined.
- [ ] Draft and cancelled events are excluded from conflict checks.
- [ ] The venue timeline displays all non-archived, non-cancelled events for a venue on a given date.
- [ ] Timeline supports click-to-create, click-to-edit, and drag-to-resize interactions.
- [ ] Availability endpoint returns only venues with no conflicts for the requested time range.
- [ ] Venue assignment emits a `schedule_event.updated` domain event with `changedFields: ['venue_id']`.
- [ ] Venues with `status != 'active'` are excluded from availability queries.

---

## 3. Equipment Tracking

### Purpose

Define how venue equipment is managed -- default equipment per venue, additional equipment requests per event, and the link to equipment logistics for checkout and delivery.

### Detail

**Default equipment:**

Each venue has a default equipment list in its `equipment` JSONB column (see Section 1). This represents permanently installed or always-present items. Default equipment does not need to be checked out -- it is assumed available whenever the venue is in use.

**Additional equipment requests:**

When an event needs equipment beyond what the venue provides, the event organizer creates an equipment request. This is stored on the `schedule_events` row in the `properties` JSONB:

```json
{
  "equipment_requests": [
    {
      "equipment_id": "uuid-of-equipment-item",
      "name": "Portable PA System",
      "quantity": 1,
      "status": "requested",
      "requested_by": "uuid-of-staff",
      "requested_at": "2026-06-15T10:00:00Z",
      "notes": "Need for outdoor panel, venue has no built-in audio"
    },
    {
      "equipment_id": "uuid-of-equipment-item",
      "name": "Extra Chairs",
      "quantity": 50,
      "status": "approved",
      "requested_by": "uuid-of-staff",
      "requested_at": "2026-06-15T10:00:00Z",
      "approved_by": "uuid-of-manager",
      "approved_at": "2026-06-16T09:00:00Z"
    }
  ]
}
```

**Equipment request statuses:** `requested`, `approved`, `denied`, `delivered`, `returned`.

**Request flow:**

```
Event organizer opens event detail
  → Sees venue's default equipment
  → Clicks "Request Additional Equipment"
  → Selects from equipment inventory (equipment table)
  → Specifies quantity and notes
  → Submits request
  → Manager approves/denies
  → If approved: equipment-logistics handles checkout + delivery
  → On delivery: status → 'delivered'
  → After event: equipment returned, status → 'returned'
```

**Link to equipment-logistics:**

The equipment management system (`shared-services/equipment-logistics.md`) handles the physical lifecycle of equipment items. Venue management creates the demand (what equipment is needed where and when); equipment logistics fulfills it (checkout, transport, delivery, return).

When an equipment request is approved, the system:

1. Creates a checkout record in the equipment system for the requested item.
2. Sets `assigned_to` on the equipment record to the event ID.
3. The warehouse team sees the pending delivery in their queue.
4. On delivery, the logistics app updates the status, which triggers a `prep_item.completed` event.

### Acceptance Criteria

- [ ] Venue `equipment` column stores default equipment as a JSONB array.
- [ ] Default equipment is displayed on the venue detail view and on event views for events in that venue.
- [ ] Additional equipment requests are stored on the `schedule_events.properties` JSONB.
- [ ] Request status transitions follow: `requested` → `approved`/`denied` → `delivered` → `returned`.
- [ ] Approved requests trigger a checkout record in the equipment logistics system.
- [ ] Equipment request approval requires `can_edit` permission on the `schedule_event` concept (or a dedicated `equipment_request` permission).
- [ ] Equipment delivery status updates flow back to the event's equipment request status.
- [ ] The event detail view shows both venue default equipment and additional requested equipment.
- [ ] Equipment requests emit domain events on creation and status changes.

---

## 4. Capacity Management

### Purpose

Define how venue capacity limits are enforced during scheduling, how overflow is detected, and how alerts are triggered.

### Detail

**Capacity enforcement:**

Every venue has a `capacity` integer (see Section 1). When scheduling an event in a venue, the system compares the event's expected attendance against the venue's capacity.

Expected attendance is stored on the `schedule_events` row in `properties`:

```json
{
  "expected_attendance": 350
}
```

**Enforcement rules:**

| Scenario | Action |
|----------|--------|
| `expected_attendance <= capacity` | Scheduling proceeds normally |
| `expected_attendance > capacity` (soft limit) | Warning displayed to scheduler; scheduling allowed with acknowledgment |
| `expected_attendance > capacity * 1.2` (hard limit, 120%) | Scheduling blocked; must choose a larger venue |

The hard limit multiplier (default 1.2 = 120%) is configurable in the ontology as a convention-level property.

**Overflow detection:**

For events already scheduled, attendance estimates may change (e.g., ticket sales exceed projections). A workflow monitors for overflow:

```
Event attendance estimate updated
  → Event emitted: schedule_event.updated { changedFields: ['expected_attendance'] }
  → Workflow evaluates: new expected_attendance > venue.capacity?
  → If yes: emit schedule_event.capacity_overflow event
  → Notification sent to event organizer and venue manager
  → Dashboard shows event in "capacity alerts" widget
```

**Capacity alerts widget:**

A dashboard widget lists events where expected attendance exceeds venue capacity:

| Event | Venue | Capacity | Expected | Overflow |
|-------|-------|----------|----------|----------|
| Opening Ceremony | Main Hall A | 500 | 650 | +150 (130%) |
| AI Ethics Panel | Panel Room 3 | 100 | 120 | +20 (120%) |

The widget is filtered by department (RBAC data-scoped) and sorted by overflow percentage descending.

**Venue suggestion:**

When an event's expected attendance exceeds its current venue's capacity, the system can suggest alternative venues:

```sql
-- Find venues that can fit the event
SELECT v.id, v.name, v.type, v.capacity, v.building, v.floor
FROM venues v
WHERE v.capacity >= $expected_attendance
  AND v.type = $required_type
  AND v.status = 'active'
  AND NOT v.archived
  -- Exclude venues with time conflicts
  AND NOT EXISTS (
    SELECT 1 FROM schedule_events se
    WHERE se.venue_id = v.id
      AND se.status NOT IN ('cancelled', 'draft')
      AND NOT se.archived
      AND se.start_time < $end_time
      AND se.end_time > $start_time
  )
ORDER BY v.capacity ASC;  -- Smallest adequate venue first
```

### Acceptance Criteria

- [ ] Capacity is enforced when assigning a venue to an event with `expected_attendance` set.
- [ ] Soft limit (attendance > capacity) shows a warning but allows scheduling.
- [ ] Hard limit (attendance > capacity * 1.2) blocks scheduling with an error.
- [ ] The hard limit multiplier is configurable (default 1.2).
- [ ] Overflow detection fires when expected attendance is updated to exceed venue capacity.
- [ ] `schedule_event.capacity_overflow` event is emitted on overflow.
- [ ] Capacity alerts widget shows all events exceeding their venue's capacity.
- [ ] Venue suggestion query returns available venues sorted by smallest adequate capacity.
- [ ] Events without `expected_attendance` skip capacity enforcement (no false positives).
- [ ] Capacity enforcement respects venue status -- `maintenance` and `closed` venues are excluded.

---

## 5. Test Plan

### 5.1 Venue Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| Create venue with valid fields | `{ name, type: 'panel_room', capacity: 100 }` | Row inserted, `status = 'active'`, `equipment = '[]'` |
| Create venue with invalid type | `type: 'garage'` | CHECK constraint error |
| Create venue with zero capacity | `capacity: 0` | CHECK constraint error |
| Create venue with negative capacity | `capacity: -10` | CHECK constraint error |
| Update equipment | `PATCH { equipment: [{ name: 'Projector', ... }] }` | JSONB updated |
| Set status to maintenance | `PATCH { status: 'maintenance' }` | Status updated, excluded from availability |
| Soft delete | `PATCH { archived: true }` | Row remains, excluded from queries |

### 5.2 Conflict Detection Tests

| Test | Scenario | Expected |
|------|----------|----------|
| No conflict | Venue free during requested time | Venue assigned to event |
| Full overlap | Another event occupies the entire requested time | 409 Conflict with event details |
| Partial overlap (start) | Existing event ends after new event starts | 409 Conflict |
| Partial overlap (end) | Existing event starts before new event ends | 409 Conflict |
| Containing overlap | New event fully contains an existing event | 409 Conflict |
| Adjacent events (no gap) | Event A ends 10:00, Event B starts 10:00 | No conflict (end time is exclusive) |
| Buffer time conflict | 15-min setup buffer, events 10 min apart | 409 Conflict (buffer overlap) |
| Cancelled event overlap | Cancelled event in same time slot | No conflict (cancelled excluded) |
| Draft event overlap | Draft event in same time slot | No conflict (draft excluded) |
| Same event update | Changing time on same event | No self-conflict |

### 5.3 Equipment Tests

| Test | Input | Expected |
|------|-------|----------|
| View venue equipment | `GET /api/venues/:id` | Default equipment list in response |
| Request additional equipment | `POST equipment_request on event` | Request created with `status: 'requested'` |
| Approve equipment request | Manager approves | Status → `approved`, checkout created in equipment system |
| Deny equipment request | Manager denies | Status → `denied`, no checkout |
| Mark delivered | Logistics marks delivered | Status → `delivered` |
| Mark returned | Post-event return | Status → `returned` |

### 5.4 Capacity Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Within capacity | 80 attendees, 100-seat room | Scheduling proceeds, no warning |
| Soft over-capacity | 110 attendees, 100-seat room | Warning shown, scheduling allowed with acknowledgment |
| Hard over-capacity | 130 attendees, 100-seat room (120% threshold) | Scheduling blocked |
| No expected attendance | Event has no attendance estimate | Scheduling proceeds, no enforcement |
| Overflow on update | Attendance updated from 80 to 120 | `schedule_event.capacity_overflow` event emitted |
| Venue suggestion | Over-capacity, alternative exists | Suggestion returns appropriate venues |
| All venues full | No venue with sufficient capacity and availability | Empty suggestion list |

### 5.5 RBAC Tests

| Test | Role | Action | Expected |
|------|------|--------|----------|
| Director views all venues | `director` | `GET /api/venues` | All venues returned |
| Manager views venues | `manager` | `GET /api/venues` | Venues scoped by department (if data-scoped) or all |
| Manager creates venue | `manager` | `POST /api/venues` | Allowed (if `can_create` on `venue`) |
| Volunteer views venues | `volunteer` | `GET /api/venues` | Read-only, limited fields |
| Volunteer creates venue | `volunteer` | `POST /api/venues` | 403 Forbidden |
| Manager assigns room | `manager` | `POST /api/schedule-events/:id/assign-venue` | Allowed |
| Volunteer assigns room | `volunteer` | `POST /api/schedule-events/:id/assign-venue` | 403 Forbidden |

### 5.6 Timeline Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Single venue, one day | 3 events in Main Hall | Timeline shows 3 blocks in correct positions |
| Multiple venues | 5 venues, various events | Each venue row shows its events |
| Filter by building | Building = "Convention Center" | Only venues in that building shown |
| Filter by type | Type = "panel_room" | Only panel rooms shown |
| Click empty slot | User clicks gap in timeline | New event form opens with venue and time pre-filled |
| Click event block | User clicks existing event | Event detail view opens |

### 5.7 Integration Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Schedule event with venue | Create event, assign venue | Event linked to venue, appears on timeline |
| Equipment request to delivery | Request → approve → checkout → deliver | Full lifecycle completes, all statuses updated |
| Capacity overflow → notification | Update attendance to exceed capacity | Event emitted, manager notified, alert widget updated |
| Venue maintenance → schedule impact | Set venue to maintenance | Future events in venue flagged for reassignment |

### 5.8 Performance Tests

| Test | Scenario | Threshold |
|------|----------|-----------|
| Venue list | 100 venues | < 200ms |
| Conflict check | Single venue, 50 events that day | < 100ms |
| Availability query | 100 venues, 8-hour time range | < 500ms |
| Timeline render | 20 venues, full day | < 500ms |
| Capacity alerts | 200 events | < 300ms |
