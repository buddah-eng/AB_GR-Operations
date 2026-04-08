# Equipment & Logistics

> Equipment concept tracks items across checkout/return lifecycle. Warehouse inventory app integrates via
> API key. Status transitions (available→checked_out→returned) driven by workflows. Delivery of equipment
> to venues triggers prep_item completion. Location tracking and overdue alerts.

---

## Overview

Equipment and logistics is an org-wide shared service that tracks physical items (AV equipment, signage, furniture, supplies) across the convention. The platform provides the system of record; the warehouse team's existing inventory app consumes data via API key integration. Equipment records link to venues and schedule events, enabling automated logistics coordination — when a concert is scheduled, the required sound equipment is automatically flagged for delivery.

**Dependencies:** `api/integration-patterns.md` (API key auth for warehouse app), `shared-services/venue-management.md` (equipment links to venues), `automation/workflow-engine.md` (status transition workflows)

---

## Full Specification

### 1. Equipment Concept

**Purpose:** Define the equipment data model.

**Detail:**

| Property | Type | Description |
|---|---|---|
| `name` | text | "Projector A-3", "Banner Stand #12" |
| `type` | select | av_equipment, signage, furniture, supplies, staging, other |
| `quantity` | number | For bulk items (e.g., 50 folding chairs) |
| `location` | text | Current physical location |
| `status` | select | available, reserved, checked_out, in_transit, returned, maintenance, lost |
| `assigned_to_event` | relation | schedule_event (if checked out for an event) |
| `assigned_to_venue` | relation | venue (if semi-permanent placement) |
| `checked_out_by` | relation | staff/volunteer who checked it out |
| `checked_out_at` | datetime | When checked out |
| `due_back_at` | datetime | Expected return time |
| `condition` | select | good, damaged, needs_repair |
| `notes` | rich_text | Damage notes, special instructions |
| `properties` | JSONB | Additional ontology-defined fields |

**Acceptance Criteria:**
- [ ] Equipment records creatable with all fields
- [ ] Status transitions enforced (can't go from available→returned)
- [ ] Relations to events and venues maintained

### 2. Checkout Flow

**Purpose:** Define the equipment lifecycle.

**Detail:**

```
available → reserved → checked_out → in_transit → returned → available
                                   ↘ maintenance
                                   ↘ lost
```

| Transition | Trigger | Who |
|---|---|---|
| available → reserved | Event scheduled that needs this equipment type | Workflow (automatic) |
| reserved → checked_out | Staff picks up from warehouse | Warehouse staff (manual or API) |
| checked_out → in_transit | Equipment moving to venue | Logistics volunteer |
| in_transit → returned | Equipment back in warehouse | Warehouse staff |
| any → maintenance | Item needs repair | Any staff |
| any → lost | Item cannot be located | Manager+ |

Each transition fires a domain event: `equipment.status_changed`

**Acceptance Criteria:**
- [ ] Valid transitions enforced
- [ ] Invalid transitions rejected with error
- [ ] Domain event fires on every transition

### 3. Warehouse Integration

**Purpose:** Define how the warehouse inventory app consumes the platform.

**Detail:**

The warehouse team has an existing inventory app. It integrates via API key:

| Operation | API Call | Permission |
|---|---|---|
| List equipment | `GET /api/domains/equipment?filter[status]=available` | Read equipment |
| Update status | `PUT /api/domains/equipment/:id` `{status: "checked_out"}` | Edit equipment |
| Mark delivered | `PUT /api/domains/equipment/:id` `{status: "in_transit", location: "Main Hall"}` | Edit equipment |
| Report damage | `PUT /api/domains/equipment/:id` `{condition: "damaged", notes: "..."}` | Edit equipment |

**Event-driven coordination:**
- Warehouse marks equipment delivered → `equipment.status_changed` event fires → prep_item "Deliver projector to Panel Hall A" auto-completes
- Concert scheduled → `schedule_event.created` event with type=concert → workflow creates equipment reservation for sound system

**Acceptance Criteria:**
- [ ] Warehouse app authenticates via API key
- [ ] RBAC limits warehouse app to equipment concept only
- [ ] Equipment delivery triggers prep_item completion

### 4. Tracking & Alerts

**Purpose:** Define location tracking and overdue management.

**Detail:**

- **Location tracking:** `location` field updated on each status transition. Historical location via audit log.
- **Overdue alerts:** Workflow runs on schedule (hourly during con): query equipment WHERE status='checked_out' AND due_back_at < now(). Notify assigned staff + logistics manager.
- **Lost item reporting:** Status change to 'lost' triggers notification to logistics director + creates incident record.
- **Inventory dashboard:** Widget showing: total items, checked out count, overdue count, lost count. Filterable by type.

**Acceptance Criteria:**
- [ ] Overdue equipment detected and notifications sent
- [ ] Lost item reporting creates audit trail
- [ ] Dashboard shows real-time equipment status

### 5. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Status transitions | Unit | Valid transitions accepted, invalid rejected | Correct enforcement |
| Warehouse API | Integration | API key auth, CRUD on equipment | Read/write works with correct RBAC |
| Delivery → prep completion | Integration | Equipment delivered → prep item completes | Event chain fires correctly |
| Overdue detection | Integration | Checked-out past due_back_at → alert | Notification sent |
| Lost reporting | Integration | Status → lost → notification + incident | Full chain executes |

**Coverage target:** ≥80% on status transition logic. 100% on RBAC enforcement for warehouse API.
