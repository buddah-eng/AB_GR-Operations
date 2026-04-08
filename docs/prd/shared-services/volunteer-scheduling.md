# Volunteer Scheduling

> **Org-wide shared service for shift definition, volunteer-to-shift assignment, coverage tracking, and swap/cancellation management.**
> Shifts are `schedule_events` tagged with `type: 'volunteer_shift'`. Assignments link volunteers to shifts based on availability, skills, and department.
> Conflict detection prevents double-booking. Coverage dashboards surface understaffed shifts.
> Postgres is the system of record. Roles are ontology-defined.
> This is a Phase 5 / Shared Services deliverable (`_orchestration.md` line 95). Depends on `volunteer-management` and `scheduling-calendar`.

---

## Overview

Volunteer scheduling turns availability and skills into concrete shift assignments. Every convention has dozens to hundreds of shifts spread across venues, departments, and time blocks. Each shift has a required headcount and optional skill requirements. The scheduling system matches volunteers to shifts, detects conflicts, tracks coverage, and handles the inevitable changes (swaps, cancellations, no-shows).

Shifts are not a separate table -- they are `schedule_events` rows (from `shared-services/scheduling-calendar.md`) with `type: 'volunteer_shift'`. This means shifts appear on the convention calendar alongside panels, concerts, and meetings. They share the same venue and time-conflict infrastructure.

Assignments are a join between volunteers and shifts, stored in a dedicated `shift_assignments` table. Each assignment records the volunteer, the shift, the assignment status, and who made the assignment (manual vs. auto-suggest accepted).

Coverage tracking aggregates assignments per shift and per department, surfacing gaps before they become crises. A dashboard widget shows shifts sorted by urgency: red (< 50% filled), yellow (50-80%), green (80%+).

Swap and cancellation flows let volunteers request changes after assignment. Managers approve swaps; cancellations trigger a notification to find replacements.

**Key relationships:**

| Relationship | Target | Cardinality | Notes |
|-------------|--------|-------------|-------|
| `shift (schedule_events)` → `shift_assignments` | `shift_assignments` | has-many | Each shift has multiple volunteer slots |
| `shift_assignments.volunteer_id` | `volunteers` | has-one | Each assignment is for one volunteer |
| `shift (schedule_events).venue_id` | `venues` | has-one | Shift happens at a venue |
| `shift (schedule_events).department` | departments | has-one | Shift belongs to a department |

---

## 1. Shift Concept

### Purpose

Define the shift data model -- how shifts are represented as `schedule_events`, what additional fields they carry, and how they relate to venues and departments.

### Detail

Shifts are `schedule_events` rows with `type = 'volunteer_shift'`. The `schedule_events` table is defined in `shared-services/scheduling-calendar.md`. Shift-specific fields live in the `properties` JSONB column.

**Schedule event columns used by shifts:**

| Column | Type | Shift Usage |
|--------|------|-------------|
| `id` | uuid | Shift identifier |
| `name` | text | Shift name (e.g., "Registration Desk - Morning") |
| `type` | text | `'volunteer_shift'` |
| `department` | text | Owning department key |
| `venue_id` | uuid, FK | Where the shift takes place |
| `start_time` | timestamptz | Shift start |
| `end_time` | timestamptz | Shift end |
| `status` | text | `draft`, `published`, `in_progress`, `completed`, `cancelled` |
| `properties` | jsonb | Shift-specific fields (below) |

**Shift-specific properties (JSONB):**

```json
{
  "required_count": 5,
  "required_skills": ["bilingual_japanese", "vip_hosting"],
  "min_experience_years": 1,
  "notes": "Check-in desk near main entrance. Bilingual volunteers preferred.",
  "contact_person_id": "uuid-of-shift-lead",
  "priority": "high"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `required_count` | integer | How many volunteers are needed |
| `required_skills` | text[] | Skill keys required (all must match) |
| `min_experience_years` | integer | Minimum `years_volunteered` (optional) |
| `notes` | text | Instructions for assigned volunteers |
| `contact_person_id` | uuid | Shift lead or point of contact |
| `priority` | text | `low`, `medium`, `high`, `critical` -- affects coverage dashboard sort |

**Shift status lifecycle:**

```
draft → published → in_progress → completed
                 ↘ cancelled
```

- `draft`: Shift is being planned. Not visible to volunteers.
- `published`: Shift is open for assignment. Visible in scheduling UI.
- `in_progress`: Shift time has arrived. Check-in tracking active.
- `completed`: Shift has ended. Hours logged.
- `cancelled`: Shift removed from schedule. Assigned volunteers notified.

**Querying shifts:**

```sql
-- All published volunteer shifts for a department
SELECT se.*
FROM schedule_events se
WHERE se.type = 'volunteer_shift'
  AND se.department = 'guest_relations'
  AND se.status = 'published'
  AND NOT se.archived
ORDER BY se.start_time;
```

### Acceptance Criteria

- [ ] Shifts are rows in `schedule_events` with `type = 'volunteer_shift'`.
- [ ] `required_count` is stored in `properties` JSONB and is required for shift creation.
- [ ] `required_skills` is an array of skill keys validated against ontology-defined skills.
- [ ] Shift status transitions follow the lifecycle: `draft` → `published` → `in_progress` → `completed` (or `cancelled` from `published`).
- [ ] Shifts inherit venue conflict detection from the scheduling calendar (same room, overlapping times).
- [ ] Each status transition emits a `schedule_event.updated` domain event.
- [ ] Cancelling a published shift emits an event that triggers notification to all assigned volunteers.

---

## 2. Assignment

### Purpose

Define how volunteers are matched to shifts, the assignment data model, manual vs. auto-suggest assignment, and conflict detection.

### Detail

#### `shift_assignments` table

```sql
CREATE TABLE shift_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id        UUID NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
  volunteer_id    UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'assigned'
                  CHECK (status IN (
                    'assigned', 'confirmed', 'checked_in', 'completed',
                    'no_show', 'cancelled', 'swapped'
                  )),
  assigned_by     UUID REFERENCES staff(id),
  assignment_type TEXT NOT NULL DEFAULT 'manual'
                  CHECK (assignment_type IN ('manual', 'auto_accepted', 'swap')),
  notes           TEXT,

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false,

  -- Prevent double-assignment of same volunteer to same shift
  UNIQUE (shift_id, volunteer_id)
);

-- Indexes
CREATE INDEX idx_assignments_shift ON shift_assignments (shift_id) WHERE NOT archived;
CREATE INDEX idx_assignments_volunteer ON shift_assignments (volunteer_id) WHERE NOT archived;
CREATE INDEX idx_assignments_status ON shift_assignments (status) WHERE NOT archived;
```

**Assignment status lifecycle:**

```
assigned → confirmed → checked_in → completed
                                  ↘ no_show
        ↘ cancelled
        ↘ swapped
```

**Manual assignment flow:**

```
Manager opens shift detail
  → Sees required skills + required count
  → Clicks "Assign Volunteers"
  → System shows eligible volunteer list (filtered by availability + skills + not already assigned)
  → Manager selects volunteers
  → POST /api/shift-assignments { shift_id, volunteer_ids: [...] }
  → For each volunteer:
      - Check: volunteer available for shift time slot
      - Check: volunteer has required skills
      - Check: volunteer not already assigned to overlapping shift
      - If all pass: create assignment row
      - If conflict: return error for that volunteer, continue others
  → Events emitted: shift_assignment.created (one per assignment)
  → Notification sent to each assigned volunteer
```

**Auto-suggest flow:**

```
Manager opens shift detail
  → Clicks "Auto-Suggest"
  → System queries volunteers matching:
      - availability_schedule includes the shift's day + shift period with status = 'available'
      - skills @> required_skills
      - training_status = 'completed'
      - no overlapping shift_assignments
      - department matches (or cross-department access)
  → Results sorted by:
      1. Preference (preferred > neutral > reluctant)
      2. Experience (years_volunteered DESC)
      3. Current assignment count (fewer = prioritized, for fairness)
  → Top N suggestions shown (N = required_count - current_assigned_count)
  → Manager reviews, accepts some/all
  → Accepted suggestions become assignments
```

**Conflict detection (double-booking):**

A volunteer cannot be assigned to two shifts that overlap in time. The check:

```sql
-- Does this volunteer have any overlapping assignment?
SELECT sa.id
FROM shift_assignments sa
JOIN schedule_events se ON se.id = sa.shift_id
WHERE sa.volunteer_id = $volunteer_id
  AND sa.status NOT IN ('cancelled', 'swapped')
  AND NOT sa.archived
  AND se.start_time < $new_shift_end_time
  AND se.end_time > $new_shift_start_time
LIMIT 1;
```

If a row is returned, the assignment is blocked with a conflict error that names the conflicting shift.

### Acceptance Criteria

- [ ] `shift_assignments` table is created with FK references to `schedule_events` and `volunteers`.
- [ ] UNIQUE constraint on `(shift_id, volunteer_id)` prevents duplicate assignments.
- [ ] Manual assignment validates availability, skills, and time conflicts before inserting.
- [ ] Auto-suggest returns volunteers ranked by preference, experience, and fairness.
- [ ] Conflict detection prevents assigning a volunteer to two overlapping shifts.
- [ ] Conflict errors include the name and time of the conflicting shift.
- [ ] Each assignment emits a `shift_assignment.created` domain event.
- [ ] Notification is sent to the volunteer on assignment (via workflow).
- [ ] Assignment requires `can_create` permission on the `shift_assignment` concept.
- [ ] Bulk assignment (multiple volunteers at once) is atomic per volunteer -- one failure does not roll back others.

---

## 3. Coverage Tracking

### Purpose

Define how shift coverage is calculated, how department-level aggregation works, and how the dashboard widget surfaces understaffed shifts.

### Detail

**Per-shift coverage:**

Coverage for a single shift is the ratio of active assignments to required count:

```sql
SELECT
  se.id AS shift_id,
  se.name AS shift_name,
  se.department,
  se.start_time,
  (se.properties->>'required_count')::int AS required_count,
  COUNT(sa.id) FILTER (
    WHERE sa.status NOT IN ('cancelled', 'swapped', 'no_show') AND NOT sa.archived
  ) AS assigned_count
FROM schedule_events se
LEFT JOIN shift_assignments sa ON sa.shift_id = se.id
WHERE se.type = 'volunteer_shift'
  AND se.status IN ('published', 'in_progress')
  AND NOT se.archived
GROUP BY se.id;
```

**Coverage percentage:** `assigned_count / required_count * 100`

**Coverage status thresholds:**

| Status | Condition | Color | Icon |
|--------|-----------|-------|------|
| `critical` | coverage < 50% | Red | Warning |
| `understaffed` | 50% <= coverage < 80% | Yellow/Amber | Alert |
| `adequate` | 80% <= coverage < 100% | Green | Check |
| `full` | coverage = 100% | Green (bold) | Check-circle |
| `overstaffed` | coverage > 100% | Blue | Info |

**Per-department coverage:**

```sql
SELECT
  se.department,
  COUNT(DISTINCT se.id) AS total_shifts,
  SUM((se.properties->>'required_count')::int) AS total_required,
  COUNT(sa.id) FILTER (
    WHERE sa.status NOT IN ('cancelled', 'swapped', 'no_show') AND NOT sa.archived
  ) AS total_assigned,
  ROUND(
    COUNT(sa.id) FILTER (WHERE sa.status NOT IN ('cancelled', 'swapped', 'no_show') AND NOT sa.archived)::numeric /
    NULLIF(SUM((se.properties->>'required_count')::int), 0) * 100,
    1
  ) AS coverage_percent
FROM schedule_events se
LEFT JOIN shift_assignments sa ON sa.shift_id = se.id
WHERE se.type = 'volunteer_shift'
  AND se.status IN ('published', 'in_progress')
  AND NOT se.archived
GROUP BY se.department;
```

**Dashboard widget:**

The coverage dashboard is a view-renderer widget (`ui/view-renderer.md`) that shows:

1. **Summary bar:** Total shifts, total volunteers needed, total assigned, overall coverage %.
2. **Department breakdown:** Table with one row per department, columns: department name, shifts count, required, assigned, coverage %, status indicator.
3. **Understaffed shifts list:** Shifts sorted by urgency (critical first, then understaffed), showing: shift name, time, venue, required, assigned, gap, required skills.

The widget auto-refreshes on `shift_assignment.created`, `shift_assignment.updated`, and `schedule_event.updated` events via the event bus.

**Alerts:**

When a shift's coverage drops below 50% (e.g., due to cancellation), the system emits a `shift.coverage_critical` event. A workflow can subscribe to this event and notify the department manager.

### Acceptance Criteria

- [ ] Per-shift coverage query returns `assigned_count` and `required_count` for every published/in-progress volunteer shift.
- [ ] Coverage percentage is calculated correctly, handling zero `required_count` (no division by zero).
- [ ] Status thresholds map to the correct color/icon at 50%, 80%, and 100% boundaries.
- [ ] Per-department aggregation sums required and assigned counts across all shifts in the department.
- [ ] Dashboard widget displays summary bar, department breakdown, and understaffed shifts list.
- [ ] Widget refreshes when relevant events fire (assignment created/updated, shift updated).
- [ ] `shift.coverage_critical` event is emitted when coverage drops below 50%.
- [ ] Cancelled and swapped assignments are excluded from assigned count.
- [ ] No-show assignments are excluded from assigned count.
- [ ] Coverage data is accessible via API: `GET /api/shifts/coverage?department=guest_relations`.

---

## 4. Swap & Cancellation

### Purpose

Define how volunteers request swaps with other volunteers, how managers approve swaps, and how cancellations trigger replacement workflows.

### Detail

**Swap flow:**

```
Volunteer A is assigned to Shift X
  → Volunteer A opens their schedule
  → Clicks "Request Swap" on Shift X assignment
  → Optionally selects Volunteer B as swap target (or leaves open for any taker)
  → POST /api/shift-assignments/:id/swap-request { target_volunteer_id?: uuid, reason: text }
  → Swap request created (stored in shift_assignment properties or separate table)
  → If target specified: notification sent to Volunteer B
  → If open swap: notification sent to all eligible volunteers for Shift X
  → Volunteer B (or another) accepts the swap
  → Manager approves the swap
  → Original assignment: status → 'swapped'
  → New assignment created for Volunteer B: status → 'assigned', assignment_type → 'swap'
  → Events emitted: shift_assignment.updated (original), shift_assignment.created (new)
  → Both volunteers notified of confirmed swap
```

**Swap request data:**

Swap requests are stored in the `properties` JSONB of the original `shift_assignments` row:

```json
{
  "swap_request": {
    "requested_at": "2026-07-10T14:00:00Z",
    "reason": "Doctor appointment",
    "target_volunteer_id": "uuid-or-null",
    "status": "pending",
    "approved_by": null,
    "approved_at": null
  }
}
```

**Swap request statuses:** `pending`, `accepted_by_target`, `approved`, `rejected`, `expired`.

**Swap approval rules:**

1. If a target volunteer is specified, they must accept before the manager approves.
2. If an open swap, the first eligible volunteer to accept becomes the target.
3. The manager reviews and approves or rejects the swap.
4. Approval is required -- volunteers cannot swap without manager sign-off.
5. Only users with `can_edit` permission on `shift_assignment` can approve swaps.

**Cancellation flow:**

```
Volunteer is assigned to Shift X
  → Volunteer opens their schedule
  → Clicks "Cancel Assignment" on Shift X
  → POST /api/shift-assignments/:id/cancel { reason: text }
  → Assignment status → 'cancelled'
  → Event emitted: shift_assignment.updated { status: 'cancelled' }
  → Coverage recalculated for Shift X
  → If coverage < 80%: notification sent to department manager
  → If coverage < 50%: shift.coverage_critical event emitted
  → Manager can manually reassign or run auto-suggest to fill the gap
```

**Cancellation rules:**

1. Volunteers can cancel their own assignments (RBAC: `can_edit` on own record via relation scope).
2. Managers can cancel any assignment in their department.
3. Cancellations within 24 hours of shift start trigger an urgent notification.
4. The `reason` field is required for cancellations.
5. Cancelled assignments remain in the database for audit (status = 'cancelled', not deleted).

**No-show handling:**

After a shift ends, managers can mark unconfirmed assignments as `no_show`:

```
Shift X ends
  → Manager reviews check-in status
  → Assignments still in 'assigned' or 'confirmed' (not 'checked_in') are flagged
  → Manager marks as 'no_show'
  → Event emitted: shift_assignment.updated { status: 'no_show' }
  → No-show count tracked on volunteer record (in properties JSONB)
```

### Acceptance Criteria

- [ ] Swap request creates a pending request on the original assignment.
- [ ] Targeted swap requires acceptance from the target volunteer before manager approval.
- [ ] Open swap notifies all eligible volunteers; first acceptance locks the swap.
- [ ] Manager approval is required for all swaps.
- [ ] Approved swap sets original assignment to `swapped` and creates new assignment with `assignment_type: 'swap'`.
- [ ] Cancellation sets assignment status to `cancelled` with a required reason.
- [ ] Cancellation triggers coverage recalculation and manager notification if coverage drops below threshold.
- [ ] Cancellations within 24 hours of shift start trigger an urgent notification.
- [ ] No-show marking is available after shift `end_time` has passed.
- [ ] All swap and cancellation actions emit domain events and are recorded in the audit log.
- [ ] Cancelled and swapped assignments are excluded from coverage counts.
- [ ] Swap requests expire if not acted upon within a configurable time window (default: 48 hours).

---

## 5. Test Plan

### 5.1 Shift Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| Create shift | `{ type: 'volunteer_shift', required_count: 5, venue_id, start_time, end_time }` | `schedule_events` row created with correct properties |
| Create shift without required_count | Missing `required_count` in properties | Validation error |
| Publish shift | `status: 'draft'` → `'published'` | Status updated, event emitted |
| Cancel shift | `status: 'published'` → `'cancelled'` | Status updated, assigned volunteers notified |
| Invalid status transition | `status: 'completed'` → `'draft'` | Rejected -- backward transition not allowed |

### 5.2 Assignment Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| Assign volunteer to shift | `{ shift_id, volunteer_id }` | Row inserted, status = `assigned` |
| Assign duplicate | Same `(shift_id, volunteer_id)` | UNIQUE constraint error |
| Assign with time conflict | Volunteer has overlapping shift | Conflict error with details of conflicting shift |
| Assign without required skills | Volunteer missing a required skill | Validation error listing missing skills |
| Assign unavailable volunteer | Volunteer's availability_schedule says `unavailable` | Validation error |
| Bulk assign | 3 volunteers, 1 has conflict | 2 assigned, 1 error returned; partial success |

### 5.3 Auto-Suggest Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Basic match | Shift needs 3 volunteers, 10 available | Top 3 returned, sorted by preference + experience |
| Skill filter | Shift requires `bilingual_japanese` | Only volunteers with that skill suggested |
| Conflict exclusion | Volunteer has overlapping assignment | Excluded from suggestions |
| Fairness ordering | Two equally qualified volunteers, one has 5 assignments, one has 2 | Volunteer with 2 ranked higher |
| No matches | No volunteers meet criteria | Empty list returned |
| Preference ranking | 3 available: preferred, neutral, reluctant | Ordered: preferred, neutral, reluctant |

### 5.4 Coverage Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Full coverage | 5 required, 5 assigned | 100%, status: `full` |
| Understaffed | 5 required, 3 assigned | 60%, status: `understaffed` |
| Critical | 5 required, 2 assigned | 40%, status: `critical`, event emitted |
| Zero required | required_count = 0 | No division by zero; coverage shown as N/A |
| Department aggregation | 3 shifts in dept, varying coverage | Correct sum of required and assigned |
| Cancellation impact | 1 volunteer cancels, coverage drops from 80% to 60% | Status changes from `adequate` to `understaffed` |

### 5.5 Swap & Cancellation Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Request targeted swap | Volunteer A requests swap with Volunteer B | Swap request created, Volunteer B notified |
| Request open swap | No target specified | All eligible volunteers notified |
| Accept swap | Target volunteer accepts | Swap status → `accepted_by_target` |
| Approve swap | Manager approves | Original → `swapped`, new assignment created |
| Reject swap | Manager rejects | Swap status → `rejected`, original unchanged |
| Swap expired | 48 hours pass without action | Swap status → `expired` |
| Cancel assignment | Volunteer cancels with reason | Status → `cancelled`, coverage recalculated |
| Urgent cancellation | Cancel within 24 hours of shift | Urgent notification sent |
| Mark no-show | Manager marks after shift ends | Status → `no_show` |
| Mark no-show before shift ends | Manager attempts during shift | Rejected -- shift must be past end_time |

### 5.6 RBAC Tests

| Test | Role | Action | Expected |
|------|------|--------|----------|
| Manager creates shift | `manager` | `POST /api/schedule-events { type: 'volunteer_shift' }` | Allowed |
| Volunteer creates shift | `volunteer` | `POST /api/schedule-events` | 403 Forbidden |
| Manager assigns volunteer | `manager` | `POST /api/shift-assignments` | Allowed |
| Volunteer views own assignments | `volunteer` | `GET /api/shift-assignments?volunteer_id=:self` | Allowed, returns own assignments |
| Volunteer views all assignments | `volunteer` | `GET /api/shift-assignments` | Data-scoped to own assignments only |
| Manager approves swap | `manager` | `POST /api/shift-assignments/:id/approve-swap` | Allowed |
| Volunteer approves swap | `volunteer` | `POST /api/shift-assignments/:id/approve-swap` | 403 Forbidden |
| Manager views coverage | `manager` | `GET /api/shifts/coverage` | Department-scoped coverage data |
| Director views coverage | `director` | `GET /api/shifts/coverage` | All departments |

### 5.7 Integration Tests

| Test | Scenario | Expected |
|------|----------|----------|
| End-to-end shift lifecycle | Create → publish → assign → check-in → complete | All status transitions emit events, coverage updates at each step |
| Availability change → conflict | Volunteer changes availability after assignment | Conflict detected, manager notified |
| Shift cancellation cascade | Shift cancelled | All assignments notified, coverage widget updated |
| Swap → coverage stable | Swap approved | Coverage count unchanged (old volunteer removed, new added) |
| Auto-suggest → assign → coverage | Auto-suggest for understaffed shift, accept all | Coverage reaches target |

### 5.8 Performance Tests

| Test | Scenario | Threshold |
|------|----------|-----------|
| Assignment creation | Single assignment with conflict check | < 200ms |
| Auto-suggest | 500 volunteers, 3-skill filter | < 500ms |
| Coverage dashboard | 200 shifts across 10 departments | < 500ms |
| Department coverage aggregation | 50 shifts in one department | < 200ms |
