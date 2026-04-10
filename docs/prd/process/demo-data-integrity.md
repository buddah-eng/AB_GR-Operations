# Demo Data Integrity

> Every ID referenced in the demo seed data must resolve. Every guest in a pairing must exist in
> guests.json. Every venue in a schedule event must exist in venues.json. Every staff member assigned
> as a liaison must exist in staff.json. Zero orphan references. Zero missing names. Zero phantom UUIDs.

---

## Overview

Demo seed data spans 8+ JSON files with cross-references (guest IDs in pairings, venue IDs in schedules,
staff IDs in assignments). A single broken reference means a component renders "undefined" or crashes.
This protocol catches every inconsistency before the demo ships.

---

## Verification Steps

### 1. Forward Reference Check

For every ID referenced in a child record, verify the parent record exists:

```
pairings.json → each guest_id exists in guests.json
pairings.json → each staff_id exists in staff.json
prep-items.json → each guest_id exists in guests.json
schedule.json → each venue_id exists in venues.json
schedule.json → each guest reference exists in guests.json
transport.json → each guest_id exists in guests.json
contracts.json → each guest_id exists in guests.json
```

### 2. Backward Completeness Check

Every guest should have at least SOME related data:
- Every confirmed+ guest has at least 1 pairing
- Every confirmed+ guest has at least 1 schedule event
- Every confirmed+ guest has at least 3 prep items
- Every JP guest has an interpreter pairing
- Every guest with status travel_arranged+ has at least 1 transport booking

### 3. Name Consistency

- Guest names in pairings match the name in guests.json
- Staff names in pairings match the name in staff.json
- Venue names in schedule match the name in venues.json
- No placeholder names ("Test Guest", "TBD", "Lorem Ipsum")

### 4. Temporal Consistency

For each demo time state (pre-event, during-event, post-event):
- Guest statuses are appropriate for the time period
- Prep completion percentages are realistic for the time period
- Transport booking statuses match the time period
- Schedule events in during-event have correct "today" dates

### 5. Type Consistency

- All UUIDs are valid format (8-4-4-4-12 hex)
- All dates are valid ISO 8601
- All status values match the allowed enums (draft, invited, confirmed, etc.)
- All department values are consistent across guests and staff

---

## Acceptance Criteria

- [ ] Zero orphan references across all seed data files
- [ ] Every confirmed+ guest has pairings, schedule, and prep data
- [ ] Every JP guest has an interpreter assigned
- [ ] Names are consistent across all files
- [ ] Temporal states are internally consistent
- [ ] No placeholder or test data names
