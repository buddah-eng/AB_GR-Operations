# Cross-Department Collaboration

> The platform solves department silos through shared ontology concepts (schedule, venue, staff), RBAC-controlled
> cross-department visibility (explicit permission grants, field-level filtering), event-driven coordination
> (GR confirms guest → Programming gets notification), and org-wide dashboards pulling from multiple concepts.

---

## Overview

The core problem this platform solves is department silos. Before the platform, GR, Exhibits, Programming, and Operations each tracked their data independently — guest info didn't connect to scheduling, booth assignments didn't connect to logistics, and cross-department coordination happened via email and Slack.

The platform enables collaboration through four mechanisms: **shared concepts** (org-wide data visible to all departments), **RBAC grants** (explicit cross-department access with field-level filtering), **domain events** (automated notifications when one department's action affects another), and **unified dashboards** (widgets pulling from multiple concepts in one view).

**Dependencies:** `platform/multi-tenancy.md`, `core/ontology-scoping.md`, `core/rbac-engine.md`, `core/event-bus.md`

---

## Full Specification

### 1. The Problem

**Purpose:** Define the collaboration gaps the platform addresses.

**Detail:**

| Scenario | Without Platform | With Platform |
|---|---|---|
| GR confirms a guest who needs a panel | GR emails Programming coordinator | `guest.status_changed` event → workflow notifies Programming + creates panel placeholder |
| Programming schedules a panel and needs guest availability | Checks GR spreadsheet, sends Slack message | Queries `schedule_events` + `guests` via API, sees guest's itinerary in real-time |
| Exhibits approves a dealer who needs booth equipment | Emails logistics, hopes they see it | `dealer.status_changed` → workflow creates equipment reservation → logistics notified |
| Operations needs volunteer coverage for all departments | Collects spreadsheets from each dept head | Queries `volunteer_shifts` across all departments, sees coverage dashboard |
| Director wants convention readiness status | Asks each department for updates | Org-wide dashboard: guest count + panel count + booth count + volunteer coverage |

**Acceptance Criteria:**
- [ ] Each scenario above demonstrated end-to-end in the platform

### 2. Shared Concepts Enable It

**Purpose:** Define how org-wide concepts enable cross-department data sharing.

**Detail:**

Concepts with `owner_scope='org'` are visible and usable by all departments:

| Shared Concept | Used By | Purpose |
|---|---|---|
| `staff` | All | Staff directory, role assignment, contact info |
| `volunteer` | All | Volunteer pool, availability, scheduling |
| `schedule_event` | All | Convention schedule, room booking, time management |
| `venue` | All | Room/hall inventory, capacity, equipment |
| `equipment` | All | Physical items, checkout, logistics |

Department-specific concepts (e.g., `guest` owned by GR, `exhibit_booth` owned by Exhibits) reference shared concepts via relationships:

```
guest (GR) ──has-many──→ schedule_event (org-wide)
guest (GR) ──has-many──→ pairings (GR) ──has-one──→ staff (org-wide)
dealer (Exhibits) ──has-one──→ exhibit_booth (Exhibits) ──has-one──→ venue (org-wide)
```

Cross-department queries work because shared concepts are in the same database:

```sql
-- "Which venues have both GR panels and Exhibits setup at the same time?"
SELECT v.name, se1.name as gr_event, se2.name as exhibits_event
FROM venues v
JOIN schedule_events se1 ON se1.venue_id = v.id AND se1.department = 'gr'
JOIN schedule_events se2 ON se2.venue_id = v.id AND se2.department = 'exhibits'
WHERE se1.start_time < se2.end_time AND se2.start_time < se1.end_time;
```

**Acceptance Criteria:**
- [ ] Shared concepts queryable by all departments
- [ ] Department concepts can reference shared concepts via relationships
- [ ] Cross-department JOINs work in Postgres

### 3. RBAC Controls It

**Purpose:** Define how cross-department access is granted and restricted.

**Detail:**

Cross-department visibility is **explicit and permission-based**. No department sees another's data by default.

**Granting cross-department access:**

| Grant | Permission Record |
|---|---|
| Programming coordinator sees GR guest list (name, type, department only) | `{ role_key: 'prog_coordinator', concept_key: 'guest', canView: true, visibleProperties: ['name', 'type', 'department'] }` |
| Logistics manager sees all equipment across departments | `{ role_key: 'logistics_manager', concept_key: 'equipment', canView: true, canEdit: true }` with data_scope `{ scope_type: 'all' }` |
| GR director sees full schedule | `{ role_key: 'gr_director', concept_key: 'schedule_event', canView: true, visibleProperties: ['*'] }` with data_scope `{ scope_type: 'all' }` |

**Field-level filtering ensures safety:**
- Programming sees guest name/type/department — not contract details, compensation, or special handling notes
- GR sees schedule event times and venues — not Programming's internal notes or speaker fees
- Logistics sees equipment assignments — not the financial data of the department requesting it

**Acceptance Criteria:**
- [ ] Cross-department access requires explicit permission record
- [ ] Field-level filtering limits visible data
- [ ] No implicit cross-department access

### 4. Event Bus Connects It

**Purpose:** Define cross-department automation via domain events.

**Detail:**

Domain events enable automated coordination without direct coupling:

| Event | Source Dept | Triggered Workflow | Target Dept |
|---|---|---|---|
| `guest.status_changed` (→Confirmed) | GR | Create panel placeholder, notify Programming | Programming |
| `guest.status_changed` (→Confirmed, type=JP) | GR | Create interpreter shift, notify Operations | Operations |
| `dealer.status_changed` (→Approved) | Exhibits | Reserve booth equipment, notify Logistics | Logistics |
| `schedule_event.created` (type=concert) | Programming | Create sound check prep, reserve equipment | Operations |
| `volunteer_shift.unassigned` | Any | Alert volunteer coordinator | Operations |
| `equipment.status_changed` (→delivered) | Logistics | Complete delivery prep item | Requesting dept |

**How it works:**
1. Workflows subscribe to event patterns (e.g., `guest.*`, `equipment.status_changed`)
2. Workflow conditions filter by relevant criteria (e.g., `status = 'Confirmed'`)
3. Workflow actions create records, send notifications, or trigger further events in the target department
4. No department needs to know about or call another department's API — the event bus handles coordination

**Acceptance Criteria:**
- [ ] Cross-department workflows trigger correctly
- [ ] Source department doesn't need code changes for downstream automation
- [ ] Event chain: dept A action → event → workflow → dept B notification

### 5. Dashboard Integration

**Purpose:** Define org-wide dashboards pulling from multiple concepts.

**Detail:**

`PageConfig` with widgets from multiple concepts:

```json
{
  "name": "Convention Readiness",
  "slug": "/dashboard/readiness",
  "widgets": [
    { "type": "stat_card", "title": "Guests Confirmed", "conceptKey": "guest",
      "filter": { "status": "Confirmed" } },
    { "type": "stat_card", "title": "Panels Scheduled", "conceptKey": "schedule_event",
      "filter": { "event_type": "panel", "status": "confirmed" } },
    { "type": "stat_card", "title": "Booths Assigned", "conceptKey": "exhibit_booth",
      "filter": { "status": "assigned" } },
    { "type": "prep_progress", "title": "Volunteer Coverage", "conceptKey": "volunteer_shift" },
    { "type": "data_table", "title": "Needs Attention", "conceptKey": "prep_item",
      "filter": { "status": "overdue" } }
  ]
}
```

**Access:** Dashboard visibility controlled by `ScreenAccess`. Admin and directors see the org-wide readiness dashboard. Department managers see their department dashboard. Volunteers see their assignment dashboard.

Each widget respects the viewer's RBAC — a Programming manager sees guest count (from their cross-dept permission) but not guest details.

**Acceptance Criteria:**
- [ ] Org-wide dashboard renders widgets from 3+ concepts
- [ ] Widget data filtered by viewer's RBAC
- [ ] Dashboard accessible to configured roles only

### 6. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Shared concept access | Integration | All departments can query org-wide concepts | Data returned per RBAC |
| Cross-dept grant | Integration | Add permission for Dept B to see Dept A's concept | Filtered data visible |
| Field-level cross-dept | Integration | Cross-dept grant with limited visibleProperties | Only granted fields returned |
| Event-driven coordination | Integration | GR confirms guest → Programming notified | Notification received |
| Workflow chain | Integration | Event → workflow → create record in another dept | Record created with correct ownership |
| Org-wide dashboard | E2E | Dashboard renders widgets from multiple concepts | All widgets show correct data |
| Dashboard RBAC | Integration | Manager sees counts, not details, from other depts | Field filtering on widgets |

**Coverage target:** ≥80% on cross-department data access patterns. 100% on RBAC enforcement across department boundaries.
