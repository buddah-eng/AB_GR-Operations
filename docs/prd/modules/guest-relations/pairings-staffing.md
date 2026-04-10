# Pairings & Staffing

> Junction table linking guests to staff with role (Main Liaison/Interpreter/Backup). Staffing templates
> auto-suggest assignments based on guest type constraints. Coverage dashboard tracks unassigned guests.
> Liaison data scope: see only your assigned guests.

---

## Overview

Pairings connect guests to the staff who support them during the convention. Each pairing has a role (Main Liaison, Interpreter, Backup Liaison) that determines the staff member's responsibilities. Staffing templates, defined as ontology constraints, specify what assignments each guest type requires — JP guests need a main liaison AND an interpreter, VIPs need a backup.

---

## Full Specification

### 1. Pairing Concept

| Property | Type | Description |
|---|---|---|
| `guest_id` | relation (guest) | Which guest |
| `staff_id` | relation (staff) | Which staff member |
| `role` | select | Main Liaison, Interpreter, Backup Liaison |
| `properties` | JSONB | Additional fields |

Many-to-many junction table. A guest can have multiple staff assigned (one per role). A staff member can be assigned to multiple guests.

### 2. Staffing Templates

Ontology constraints with `StaffingTemplate` interface:

| Guest Condition | Required Role | Designation | Count |
|---|---|---|---|
| type = 'JP' | liaison | primary | 1 |
| type = 'JP' | interpreter | primary | 1 |
| type = 'NA' | liaison | primary | 1 |
| specialHandling contains 'VIP' | liaison | backup | 1 |

When a guest is created, the workflow evaluates staffing templates against the guest record and creates placeholder pairings (staff_id = null, role = required role). These appear in the coverage dashboard as "unassigned."

### 3. Coverage Tracking

Dashboard widgets:
- **Liaison coverage:** guests with/without primary liaison. Target: 100%.
- **Interpreter coverage:** JP guests with/without interpreter. Target: 100%.
- **Backup coverage:** VIP guests with/without backup. Target: 100%.
- **Staff load:** per-staff guest count. Alert if any staff has >5 guests.
- **Unassigned list:** table of guests missing required pairings.

### 4. Assignment UI

Per-guest pairing management panel:
- Staff picker dropdown filtered by: required role, language skills (for interpreters), department, availability
- Conflict detection: staff already assigned to another guest at same time slot
- Quick-assign: click staff name → create pairing
- Remove: unassign staff → pairing archived (not deleted)

### 5. Liaison View

Data-scoped view for liaisons:
- `DataScope: { scopeType: 'relation', relationPath: 'pairings.staff_id' }`
- Liaison sees ONLY guests where they are assigned via a pairing record
- Shows: guest details, schedule, prep status, transport info, itinerary
- Cannot see other liaisons' guests or unassigned guests

### 6. Test Plan

**Acceptance Criteria:**
- [ ] Pairing views render from ViewConfig loaded from Postgres
- [ ] Staffing assignment forms render from FormConfig loaded from Postgres

**Dependencies:** `config-integration.md`

| Test | What | Acceptance |
|------|------|------------|
| Template evaluation | JP guest → liaison + interpreter placeholders created | Correct roles and count |
| Coverage dashboard | 2 of 5 guests unassigned → 60% coverage shown | Accurate percentage |
| Assignment | Assign staff to guest → pairing created | Relation established |
| Conflict detection | Staff assigned to overlapping guest → warning | Warning shown |
| Liaison scope | Liaison queries guests → only assigned guests returned | No data leakage |
