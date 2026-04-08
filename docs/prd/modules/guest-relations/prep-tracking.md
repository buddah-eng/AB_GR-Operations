# Prep Tracking

> Per-guest checklist items with completion tracking. Template-based creation (JP checklist, NA checklist).
> Auto-completion via domain events (travel form submitted → "Confirm travel" completes). Overdue alerts
> via scheduled workflow. Dashboard shows per-guest and per-department completion %.

---

## Overview

Prep tracking ensures nothing falls through the cracks in guest preparation. Each guest gets a checklist of prep items created from a template based on their type. Items can be completed manually, or automatically when related actions occur (guest self-service form submitted, equipment delivered, contract signed). Overdue items trigger alerts.

---

## Full Specification

### 1. Prep Item Concept

| Property | Type | Description |
|---|---|---|
| `name` | text | "Confirm travel details", "Review contract" |
| `guest_id` | relation (guest) | Which guest |
| `status` | select | incomplete, complete, overdue, na |
| `due_date` | date | When it should be done |
| `assigned_to` | relation (staff) | Who's responsible |
| `category` | select | travel, legal, logistics, scheduling, hospitality |
| `notes` | rich_text | Additional context |
| `auto_complete_event` | text | Domain event that auto-completes this item (e.g., "guest_form.submitted") |
| `properties` | JSONB | Additional fields |

### 2. Template-Based Creation

Workflow on `guest.created` loads prep template by guest type:

**JP Guest Template (10 items):**
visa_verification, flight_booking, interpreter_assignment, hotel_reservation, contract_review, contract_send, travel_details_confirmation, dietary_confirmation, schedule_confirmation, welcome_packet

**NA Guest Template (7 items):**
travel_booking, hotel_reservation, contract_review, contract_send, travel_details_confirmation, dietary_confirmation, schedule_confirmation

Templates stored as workflow action configs with `type: 'create_records'` and template name reference.

### 3. Completion Tracking

- **Per-guest:** completion % = complete items / total items. Shown on guest detail view as progress bar.
- **Per-department:** overall % = all complete items / all items across all guests. Dashboard stat card.
- **By category:** completion breakdown by travel/legal/logistics/etc. Bar chart widget.
- **Needs attention:** guests below 50% completion within 7 days of convention. Flagged in dashboard.

### 4. Overdue Alerts

Scheduled workflow (daily at 9am):
1. Query prep_items WHERE status='incomplete' AND due_date < today
2. Update status to 'overdue'
3. Notify assigned staff + coordinator
4. Dashboard widget shows overdue count with drill-down

### 5. Auto-Completion

Prep items with `auto_complete_event` set are completed automatically:

| Event | Prep Item |
|---|---|
| `guest_form.submitted` | "Confirm travel details", "Confirm dietary" |
| `equipment.status_changed` (→delivered) | "Deliver [equipment] to [venue]" |
| `generated_contract.status_changed` (→signed) | "Contract signed" |
| `transport_booking.status_changed` (→booked) | "Confirm airport pickup" |

Workflow subscribes to these events, matches by guest_id + auto_complete_event, updates status to 'complete'.

### 6. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| Template creation | JP guest → 10 prep items | Correct items with due dates |
| Completion % | 3 of 10 complete → 30% shown | Accurate calculation |
| Overdue detection | Item past due_date → status=overdue + notification | Alert sent |
| Auto-complete | Guest form submitted → travel prep item completes | Status updated automatically |
| Dashboard | 5 guests with varying completion → correct department % | Accurate aggregation |
