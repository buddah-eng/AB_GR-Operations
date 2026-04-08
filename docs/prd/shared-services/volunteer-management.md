# Volunteer Management

> **Org-wide shared service for volunteer records, onboarding, skills tracking, and availability management.**
> Volunteers extend the staff concept -- every volunteer is also a staff record with `role_keys` containing `'volunteer'`.
> Additional volunteer-specific fields: skills, training status, t-shirt size, emergency contact, years volunteered, and a JSONB `properties` column for convention-specific data.
> Postgres is the system of record. Roles are ontology-defined.
> This is a Phase 5 / Shared Services deliverable (`_orchestration.md` line 94). Depends on `staff-management`.

---

## Overview

Volunteers are the operational workforce of the convention. They outnumber paid staff by an order of magnitude and require structured onboarding, skill tracking, and availability management to be effectively deployed.

The volunteer concept extends staff. Every volunteer has a row in the `staff` table (with `role_keys` containing `'volunteer'`) and a linked row in the `volunteers` table that carries volunteer-specific fields. This inheritance means volunteers automatically get authentication, RBAC, directory presence, and department membership from the staff layer -- no duplication.

The volunteer lifecycle is: **apply** (external form or admin invite) -> **review** (admin evaluates application) -> **approve** (admin accepts) -> **account created** (staff + volunteer rows written, Firebase auth provisioned) -> **role assigned** (admin sets role_keys) -> **training tracked** (admin marks training milestones complete). Each transition emits a domain event and can trigger workflow actions (notification emails, calendar invites, checklist creation).

Skills are multi-select fields stored as a text array on the volunteer record. Skills power assignment matching in volunteer scheduling -- when a shift requires `medical_certified` or `bilingual_japanese`, the scheduler surfaces volunteers who have those skills.

Availability is per-day and per-shift, stored as JSONB. Volunteers declare when they are free; the scheduling system reads availability when suggesting assignments.

**Key relationships:**

| Relationship | Target | Cardinality | Notes |
|-------------|--------|-------------|-------|
| `volunteers.staff_id` | `staff` | has-one | Every volunteer is a staff member |
| `volunteers → shift_assignments` | `shift_assignments` | has-many | Volunteer assigned to shifts |
| `volunteers.skills` | skill definitions | many-to-many (via array) | Skill keys from ontology |
| `volunteers.department` | departments (via staff) | has-one | Inherited from staff record |

---

## 1. Volunteer Concept

### Purpose

Define the data model for volunteer-specific fields that extend the base staff record.

### Detail

#### `volunteers` table

```sql
CREATE TABLE volunteers (
  -- Primary key and staff link
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            UUID NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,

  -- Volunteer-specific typed columns
  skills              TEXT[] NOT NULL DEFAULT '{}',
  training_status     TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (training_status IN (
                        'not_started', 'in_progress', 'completed', 'expired'
                      )),
  t_shirt_size        TEXT CHECK (t_shirt_size IN (
                        'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'
                      )),
  emergency_contact   JSONB NOT NULL DEFAULT '{}',
  years_volunteered   INTEGER NOT NULL DEFAULT 0,
  application_status  TEXT NOT NULL DEFAULT 'pending'
                      CHECK (application_status IN (
                        'pending', 'under_review', 'approved', 'rejected', 'withdrawn'
                      )),
  onboarding_step     TEXT NOT NULL DEFAULT 'applied'
                      CHECK (onboarding_step IN (
                        'applied', 'reviewed', 'approved', 'account_created',
                        'role_assigned', 'training_complete', 'ready'
                      )),

  -- Dynamic properties (ontology-defined)
  properties          JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES staff(id),
  archived            BOOLEAN NOT NULL DEFAULT false
);

-- Indexes
CREATE INDEX idx_volunteers_staff ON volunteers (staff_id);
CREATE INDEX idx_volunteers_skills ON volunteers USING GIN (skills);
CREATE INDEX idx_volunteers_training ON volunteers (training_status) WHERE NOT archived;
CREATE INDEX idx_volunteers_application ON volunteers (application_status) WHERE NOT archived;
CREATE INDEX idx_volunteers_onboarding ON volunteers (onboarding_step) WHERE NOT archived;
CREATE INDEX idx_volunteers_properties ON volunteers USING GIN (properties);
CREATE INDEX idx_volunteers_active ON volunteers (application_status) WHERE NOT archived;
```

**Column rationale:**

| Column | Why typed | Notes |
|--------|-----------|-------|
| `staff_id` | FK to staff table; every volunteer is a staff member | UNIQUE -- one volunteer record per staff record |
| `skills` | Scheduling queries filter by skill | Array of skill keys defined in ontology |
| `training_status` | Dashboard filtering, compliance reporting | Enum lifecycle |
| `t_shirt_size` | Merchandise ordering, bulk queries | Nullable -- optional field |
| `emergency_contact` | JSONB: `{ name, phone, relationship }` | Structured but not individually queried |
| `years_volunteered` | YoY tracking, seniority-based assignment | Incremented by YoY registry on year rollover |
| `application_status` | Onboarding flow gating | Controls whether volunteer can proceed |
| `onboarding_step` | Tracks progress through onboarding | Sequential steps, each unlocked by prior completion |
| `properties` | Convention-specific fields | e.g., `background_check_date`, `parking_pass_needed` |

**Emergency contact structure:**

```json
{
  "name": "Jane Doe",
  "phone": "+1-555-0199",
  "relationship": "spouse"
}
```

**Querying volunteers with staff data:**

Volunteer views join `volunteers` with `staff` to present the full picture:

```sql
SELECT s.name, s.email, s.department, s.languages, s.availability,
       v.skills, v.training_status, v.t_shirt_size, v.years_volunteered
FROM volunteers v
JOIN staff s ON s.id = v.staff_id
WHERE NOT v.archived AND NOT s.archived;
```

### Acceptance Criteria

- [ ] `volunteers` table is created with all typed columns and JSONB `properties`.
- [ ] `staff_id` has a UNIQUE constraint -- one volunteer record per staff member.
- [ ] `staff_id` has ON DELETE CASCADE -- archiving/deleting staff cascades to volunteer.
- [ ] `training_status` and `application_status` enforce CHECK constraints.
- [ ] `skills` is a text array; GIN index supports `@>` (contains) queries.
- [ ] `emergency_contact` is JSONB with no schema enforcement at the DB level (validated in application layer).
- [ ] `years_volunteered` defaults to 0 and accepts only non-negative integers.
- [ ] Join query between `staff` and `volunteers` returns combined data with correct field mapping.

---

## 2. Onboarding Flow

### Purpose

Define the step-by-step process from volunteer application through to readiness, including status transitions, domain events, and workflow triggers.

### Detail

**Onboarding state machine:**

```
applied → reviewed → approved → account_created → role_assigned → training_complete → ready
                  ↘ rejected
         ↘ withdrawn (from any pre-approved state)
```

Each transition is a write to the `onboarding_step` column (and sometimes `application_status`). Every transition emits a domain event.

**Step details:**

| Step | Trigger | Actions | Event |
|------|---------|---------|-------|
| `applied` | Volunteer submits application form | Volunteer row created with `application_status: 'pending'`, `onboarding_step: 'applied'` | `volunteer.created` |
| `reviewed` | Admin opens application and begins evaluation | `application_status` → `under_review`, `onboarding_step` → `reviewed` | `volunteer.updated` |
| `approved` | Admin approves application | `application_status` → `approved`, `onboarding_step` → `approved` | `volunteer.updated` (triggers notification workflow) |
| `rejected` | Admin rejects application | `application_status` → `rejected` | `volunteer.updated` (triggers rejection email workflow) |
| `account_created` | System provisions staff record + Firebase auth | Staff row created, volunteer `onboarding_step` → `account_created` | `staff.created`, `volunteer.updated` |
| `role_assigned` | Admin assigns role(s) to staff record | Staff `role_keys` updated, volunteer `onboarding_step` → `role_assigned` | `staff.updated`, `volunteer.updated` |
| `training_complete` | Admin marks training done or training module auto-completes | `training_status` → `completed`, `onboarding_step` → `training_complete` | `volunteer.updated` |
| `ready` | All steps complete | `onboarding_step` → `ready` | `volunteer.updated` (triggers welcome/assignment workflow) |

**Application form:**

The volunteer application is an external surface (`api/external-surfaces.md`) -- a token-scoped form that collects:

- Name, email, phone
- Languages spoken
- Skills (multi-select from ontology-defined list)
- T-shirt size
- Emergency contact
- Preferred department
- Availability (broad preferences at this stage)
- Free-text motivation / experience

The form writes to a staging area. On submission, a `volunteer.created` event fires. An admin reviews and either approves (creating the staff + volunteer records) or rejects.

**Withdrawal:**

A volunteer can withdraw their application at any point before approval. This sets `application_status: 'withdrawn'` and is a terminal state. The volunteer can re-apply by submitting a new application.

### Acceptance Criteria

- [ ] Each onboarding step transition emits a `volunteer.updated` domain event with `changedFields` including `onboarding_step`.
- [ ] Transitions follow the state machine -- skipping steps is not allowed (e.g., cannot go from `applied` directly to `role_assigned`).
- [ ] Rejection is a terminal state for the application; the volunteer record remains for audit.
- [ ] Withdrawal is allowed from any pre-approved state.
- [ ] Account creation provisions both a staff row and a Firebase auth account.
- [ ] The approval workflow sends a notification (email or in-app) to the volunteer.
- [ ] The rejection workflow sends a notification with the reason.
- [ ] Admin dashboard shows a count of pending applications per onboarding step.
- [ ] Only users with `can_edit` permission on the `volunteer` concept can advance onboarding steps.

---

## 3. Skills & Qualifications

### Purpose

Define how volunteer skills are stored, how training completion is tracked, and how skills enable assignment matching in the scheduling system.

### Detail

**Skill definitions:**

Skills are ontology-defined values stored in the `ontology_properties` table as options for the `skills` multi-select property on the `volunteer` concept. Example skill keys:

| Skill Key | Label | Category |
|-----------|-------|----------|
| `bilingual_japanese` | Bilingual - Japanese | Language |
| `bilingual_spanish` | Bilingual - Spanish | Language |
| `medical_certified` | Medical/First Aid Certified | Medical |
| `av_tech` | A/V Technical | Technical |
| `stage_management` | Stage Management | Technical |
| `crowd_control` | Crowd Control | Operations |
| `registration_ops` | Registration Operations | Operations |
| `vip_hosting` | VIP Hosting | Hospitality |
| `driving_licensed` | Licensed Driver | Logistics |

Admins can add, rename, or retire skills through the ontology web builder at any time.

**Skill storage:**

Skills are stored as a text array on the `volunteers` table:

```sql
skills TEXT[] NOT NULL DEFAULT '{}'
-- Example: ARRAY['bilingual_japanese', 'av_tech', 'vip_hosting']
```

The GIN index on `skills` supports efficient containment queries:

```sql
-- Find all volunteers with medical certification
SELECT * FROM volunteers WHERE skills @> ARRAY['medical_certified'];

-- Find volunteers with any of these skills
SELECT * FROM volunteers WHERE skills && ARRAY['bilingual_japanese', 'bilingual_spanish'];
```

**Training tracking:**

Training is tracked via the `training_status` enum column:

| Status | Meaning |
|--------|---------|
| `not_started` | Volunteer has not begun any training |
| `in_progress` | Volunteer has started but not completed training |
| `completed` | All required training modules finished |
| `expired` | Training was completed but has passed its validity period |

For granular tracking (individual training modules), the `properties` JSONB column stores an array of completed modules:

```json
{
  "training_modules": [
    { "key": "orientation", "completed_at": "2026-03-15T10:00:00Z", "expires_at": null },
    { "key": "safety", "completed_at": "2026-03-16T14:00:00Z", "expires_at": "2027-03-16T14:00:00Z" },
    { "key": "code_of_conduct", "completed_at": "2026-03-15T10:30:00Z", "expires_at": null }
  ]
}
```

When all required modules are completed, `training_status` transitions to `completed`. A scheduled workflow checks for expired modules and transitions `training_status` to `expired` when any required module passes its `expires_at` date.

**Skill-based assignment matching:**

The volunteer scheduling system (`shared-services/volunteer-scheduling.md`) queries skills when suggesting volunteers for shifts:

```sql
-- Shift requires: bilingual_japanese AND vip_hosting
SELECT v.*, s.name, s.availability
FROM volunteers v
JOIN staff s ON s.id = v.staff_id
WHERE v.skills @> ARRAY['bilingual_japanese', 'vip_hosting']
  AND s.availability = 'available'
  AND v.training_status = 'completed'
  AND NOT v.archived AND NOT s.archived;
```

### Acceptance Criteria

- [ ] Skills are stored as a text array; skill keys match ontology-defined values.
- [ ] GIN index supports `@>` (all skills required) and `&&` (any skill matches) queries.
- [ ] Adding a new skill key in the ontology immediately makes it available for assignment (no code change).
- [ ] `training_status` transitions follow: `not_started` → `in_progress` → `completed` → `expired`.
- [ ] Training module completion is stored in `properties` JSONB.
- [ ] A scheduled workflow checks for expired training modules and updates `training_status`.
- [ ] Skill-based assignment queries return only volunteers who have all required skills.
- [ ] Training completion is required before a volunteer reaches the `ready` onboarding step.

---

## 4. Availability Tracking

### Purpose

Define how volunteers declare their availability per day and per shift, how preferences are stored, and how the scheduling system consumes availability data.

### Detail

**Availability data model:**

Volunteer availability is stored in the `properties` JSONB column under the key `availability_schedule`. This is JSONB rather than a typed column because availability structure varies by convention (some have 3-day events, others have 7-day events; some have 2 shifts per day, others have 3).

```json
{
  "availability_schedule": {
    "2026-07-15": {
      "morning":   { "status": "available", "preference": "preferred" },
      "afternoon": { "status": "available", "preference": "neutral" },
      "evening":   { "status": "unavailable", "reason": "prior commitment" }
    },
    "2026-07-16": {
      "morning":   { "status": "available", "preference": "preferred" },
      "afternoon": { "status": "available", "preference": "preferred" },
      "evening":   { "status": "available", "preference": "neutral" }
    },
    "2026-07-17": {
      "morning":   { "status": "unavailable", "reason": "travel day" },
      "afternoon": { "status": "unavailable", "reason": "travel day" },
      "evening":   { "status": "unavailable", "reason": "travel day" }
    }
  }
}
```

**Status values:**

| Status | Meaning |
|--------|---------|
| `available` | Volunteer can work this slot |
| `unavailable` | Volunteer cannot work this slot |
| `tentative` | Volunteer might be available, pending confirmation |

**Preference values (when status is `available`):**

| Preference | Meaning |
|------------|---------|
| `preferred` | Volunteer wants to work this slot |
| `neutral` | Volunteer is willing but has no preference |
| `reluctant` | Volunteer can work but would prefer not to |

**Shift periods:**

Shift period definitions (morning, afternoon, evening) and their time ranges are ontology-defined and convention-specific. Example:

| Period | Default Range |
|--------|--------------|
| `morning` | 08:00 - 13:00 |
| `afternoon` | 13:00 - 18:00 |
| `evening` | 18:00 - 23:00 |

**Availability form:**

Volunteers declare availability via a form (dynamic form, possibly external surface for pre-event collection). The form presents a grid:

- Rows: days of the convention
- Columns: shift periods
- Cells: dropdown (available / unavailable / tentative) + optional preference + optional reason

On save, the form writes the JSONB structure to `properties.availability_schedule`.

**Scheduling consumption:**

The volunteer scheduling system reads availability when building assignment suggestions:

```sql
-- Find volunteers available on July 16, afternoon shift
SELECT v.*, s.name
FROM volunteers v
JOIN staff s ON s.id = v.staff_id
WHERE v.properties->'availability_schedule'->'2026-07-16'->'afternoon'->>'status' = 'available'
  AND s.availability != 'unavailable'
  AND NOT v.archived AND NOT s.archived
ORDER BY
  -- Prefer volunteers who marked this as preferred
  CASE v.properties->'availability_schedule'->'2026-07-16'->'afternoon'->>'preference'
    WHEN 'preferred' THEN 1
    WHEN 'neutral' THEN 2
    WHEN 'reluctant' THEN 3
  END;
```

**Conflict detection:**

When availability changes after shifts have been assigned, the system detects conflicts:

1. Volunteer marks a previously available slot as unavailable.
2. System checks if any shift assignments exist for that slot.
3. If conflicts found, a `volunteer.availability_conflict` event is emitted.
4. Manager is notified and can reassign the shift.

### Acceptance Criteria

- [ ] Availability is stored as JSONB in `properties.availability_schedule`.
- [ ] Each day/shift cell stores `status`, optional `preference`, and optional `reason`.
- [ ] `status` values are validated: `available`, `unavailable`, `tentative`.
- [ ] `preference` values are validated when status is `available`: `preferred`, `neutral`, `reluctant`.
- [ ] Scheduling queries can filter by day + shift period + status using JSONB path queries.
- [ ] Preference ordering works in queries (preferred > neutral > reluctant).
- [ ] Changing availability after assignment triggers conflict detection.
- [ ] Conflicts emit a domain event and notify the relevant manager.
- [ ] The availability form presents a day-by-shift grid matching the convention's schedule.
- [ ] Availability data supports conventions of any length (not hardcoded to a fixed number of days).

---

## 5. Test Plan

### 5.1 Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| Create volunteer with valid fields | `{ staff_id, skills, t_shirt_size, emergency_contact }` | Row inserted, defaults applied (`training_status: 'not_started'`, `application_status: 'pending'`) |
| Create volunteer without staff_id | Missing `staff_id` | FK constraint error |
| Create duplicate volunteer for same staff | Same `staff_id` as existing | UNIQUE constraint error |
| Update skills | `PATCH { skills: ['av_tech', 'bilingual_japanese'] }` | Array updated, event emitted |
| Update training_status with invalid value | `training_status: 'certified'` | CHECK constraint error |
| Update application_status to approved | `application_status: 'approved'` | Column updated, event emitted |
| Set emergency_contact | `{ name: 'Jane', phone: '+1-555-0199', relationship: 'spouse' }` | JSONB stored correctly |
| Cascade delete from staff | Delete staff record | Volunteer record also deleted |

### 5.2 Onboarding Flow Tests

| Test | Starting State | Action | Expected End State |
|------|---------------|--------|--------------------|
| Apply | (no record) | Volunteer submits form | `onboarding_step: 'applied'`, `application_status: 'pending'` |
| Begin review | `applied` | Admin opens application | `onboarding_step: 'reviewed'`, `application_status: 'under_review'` |
| Approve | `reviewed` | Admin approves | `onboarding_step: 'approved'`, `application_status: 'approved'` |
| Reject | `reviewed` | Admin rejects | `application_status: 'rejected'`, rejection email triggered |
| Skip step | `applied` | Attempt to jump to `account_created` | Rejected -- steps cannot be skipped |
| Withdraw | `applied` | Volunteer withdraws | `application_status: 'withdrawn'` |
| Complete onboarding | `training_complete` | All steps done | `onboarding_step: 'ready'` |

### 5.3 Skills & Training Tests

| Test | Input | Expected |
|------|-------|----------|
| Skill containment query | `skills @> ARRAY['medical_certified']` | Returns only volunteers with that skill |
| Skill overlap query | `skills && ARRAY['bilingual_japanese', 'bilingual_spanish']` | Returns volunteers with either skill |
| Training module completion | Mark `orientation` complete | Module added to `properties.training_modules` |
| All modules complete | Mark last required module complete | `training_status` → `completed` |
| Training expiry | Module `expires_at` in the past | Scheduled workflow sets `training_status` → `expired` |
| New skill in ontology | Admin adds `sign_language` skill | Immediately available for volunteer assignment |

### 5.4 Availability Tests

| Test | Input | Expected |
|------|-------|----------|
| Set availability | Grid submission for 3 days | JSONB written to `properties.availability_schedule` |
| Query available volunteers for slot | Day + shift filter | Returns volunteers with `status: 'available'` for that slot |
| Preference ordering | Query with ORDER BY preference | `preferred` before `neutral` before `reluctant` |
| Conflict detection | Mark slot unavailable after assignment | `volunteer.availability_conflict` event emitted |
| Tentative status | Set `tentative` for a slot | Slot not auto-assigned but visible to scheduler |
| Empty availability | Volunteer submits no availability | Empty `availability_schedule` object; volunteer not suggested for any shift |

### 5.5 RBAC Tests

| Test | Role | Action | Expected |
|------|------|--------|----------|
| Director views all volunteers | `director` | `GET /api/volunteers` | All records, all fields |
| Manager views department volunteers | `manager` | `GET /api/volunteers` | Only volunteers in manager's department (data scope) |
| Volunteer views own record | `volunteer` | `GET /api/volunteers/:self` | Own record, limited fields |
| Volunteer edits own availability | `volunteer` | `PATCH /api/volunteers/:self { properties.availability_schedule }` | Allowed |
| Volunteer edits other's record | `volunteer` | `PATCH /api/volunteers/:other` | 403 Forbidden |
| Admin advances onboarding | `manager` | `PATCH { onboarding_step }` | Allowed |
| Volunteer advances own onboarding | `volunteer` | `PATCH { onboarding_step }` | 403 Forbidden |

### 5.6 Integration Tests

| Test | Scenario | Expected |
|------|----------|----------|
| Application → onboarding | Volunteer submits form, admin approves, completes all steps | Volunteer reaches `ready` state with staff record and Firebase auth |
| Skill match → scheduling | Volunteer has `bilingual_japanese`, shift requires it | Volunteer appears in scheduling suggestions |
| Availability → scheduling | Volunteer marks afternoon available | Volunteer appears in afternoon shift suggestions |
| YoY carry-forward | New convention year starts | `years_volunteered` incremented, prior-year data available via YoY registry |
| Staff archival → volunteer | Staff record archived | Volunteer record cascades to archived via FK |

### 5.7 Performance Tests

| Test | Scenario | Threshold |
|------|----------|-----------|
| Volunteer list load | 500 volunteers, no filters | < 500ms |
| Skill-based query | 500 volunteers, 2-skill containment filter | < 300ms |
| Availability query | 500 volunteers, specific day+shift | < 300ms |
| Onboarding dashboard | Aggregation by onboarding_step | < 200ms |
