# Workflow Builder (Visual)

> Visual node/step editor for building workflows without code. Trigger picker → condition builder →
> action chain with drag-drop. Dry-run testing against real records. All changes go through the
> platform config CI/QA pipeline (loop detection, rate estimation, action validation).

---

## Overview

The workflow builder is a web UI that lets directors and admins create and edit WorkflowConfig records visually. It replaces manual JSON editing with a structured builder: pick a trigger, define conditions, drag actions into a sequence, configure each action, test with real data, and save — all validated through the config CI/QA pipeline before going live.

**Dependencies:** `automation/workflow-engine.md`, `automation/workflow-actions.md`, `ui/condition-builder-ui.md`, `core/ontology-ci-qa.md`

---

## Full Specification

### 1. Builder Layout

**Purpose:** Define the visual structure.

**Detail:**

```
┌─────────────────────────────────────────────────────────┐
│ Workflow: "Guest Confirmation Pipeline"     [Test] [Save]│
├───────────┬─────────────────────────┬───────────────────┤
│ TRIGGER   │    ACTION CHAIN         │  ACTION CONFIG    │
│           │                         │                   │
│ ○ Event   │  ┌──────────┐          │  Target: prep_item│
│ ○ Field   │  │ Create   │──────┐   │  Defaults:        │
│ ○ Schedule│  │ Record   │      │   │    name: "..."    │
│ ○ Manual  │  └──────────┘      │   │    status: "..."  │
│           │  ┌──────────┐      │   │  Link: guest      │
│ CONDITION │  │ Notify   │◄─────┘   │                   │
│ [Builder] │  │ Liaison  │          │                   │
│           │  └──────────┘          │                   │
│           │                         │                   │
│           │  [+ Add Action]         │                   │
├───────────┴─────────────────────────┴───────────────────┤
│ Validation: ✓ No loops  ✓ Targets exist  ✓ Rate OK     │
└─────────────────────────────────────────────────────────┘
```

- **Left panel:** Trigger type selector + embedded ConditionBuilder component
- **Center canvas:** Action chain as a vertical sequence of connected step cards
- **Right panel:** Configuration for the selected action step
- **Bottom bar:** Live validation status from CI/QA pipeline

**Acceptance Criteria:**
- [ ] Three-panel layout renders responsively
- [ ] Selecting an action step loads its config in the right panel

---

### 2. Trigger Configuration

**Purpose:** Define how users configure workflow triggers.

**Detail:**

| Trigger Type | UI Controls |
|---|---|
| `domain_event` | Concept picker (dropdown from ontology) → Event picker (created/updated/deleted/status_changed) → auto-generates pattern like `"guest.created"` |
| `field_changed` | Concept picker → Property picker (from concept's properties) → auto-sets trigger field |
| `scheduled` | Cron builder: frequency presets (every 15min, hourly, daily, weekly) + custom cron input with human-readable preview ("Every 15 minutes") |
| `manual` | Button label input, optional description. Shows where the button will appear in the UI. |

**Acceptance Criteria:**
- [ ] Concept/event/property pickers load from ontology
- [ ] Cron builder shows human-readable preview
- [ ] Generated trigger JSON matches WorkflowTrigger interface

---

### 3. Condition Builder (Embedded)

**Purpose:** Integrate the shared ConditionBuilder component.

**Detail:**

The left panel embeds `<ConditionBuilder>` from `ui/condition-builder-ui.md`. The concept context is set by the trigger's concept selection — field picker shows properties for that concept.

Label: "Only run this workflow when..."

If no condition is set, the workflow runs on every matching trigger.

**Acceptance Criteria:**
- [ ] ConditionBuilder loads properties for the trigger's concept
- [ ] Empty condition = no condition (always runs)
- [ ] Condition JSON matches ConditionExpression interface

---

### 4. Action Chain

**Purpose:** Define how users build action sequences.

**Detail:**

- **Action palette:** Button `[+ Add Action]` opens a dropdown of 9 action types
- **Step cards:** Each action renders as a card in a vertical chain. Cards show: action type icon, summary text (e.g., "Create prep_item linked to guest"), status indicator
- **Ordering:** Drag-drop to reorder steps. Connection lines show data flow
- **Delete:** Remove button per card (with confirmation if action has downstream references)
- **Chaining indicators:** If action N's output is used by action N+1, show a data flow arrow with the field name

**Acceptance Criteria:**
- [ ] All 9 action types available in palette
- [ ] Drag-drop reordering works
- [ ] Chain renders correctly with 1-10 actions

---

### 5. Action Configuration

**Purpose:** Define per-action-type configuration UI.

**Detail:**

Right panel changes based on selected action type:

| Action Type | Config Controls |
|---|---|
| `create_record` | Target concept picker, default values form (dynamic from target concept's properties), link field picker |
| `create_records` | Same + template picker (predefined record sets like "JP prep checklist") |
| `update_record` | Target concept picker (or "triggering record"), field-value pairs |
| `delete_record` | Target concept picker (or "triggering record"), confirmation text |
| `notify` | Recipient picker (role-based or specific users), template picker, channel selector (email/in-app) |
| `sync_calendar` | Calendar integration picker, event mapping (which fields → calendar event title/time/description) |
| `generate_doc` | Template picker (from contract_template concept), output format |
| `call_api` | Integration picker (from api_integration concept), endpoint, request mapping |
| `lookup_registry` | Source concept picker, match field, copy fields multi-select |

**Acceptance Criteria:**
- [ ] Each action type has type-specific configuration UI
- [ ] Concept/property/template pickers load from ontology
- [ ] Config saves to WorkflowAction JSON matching the interface

---

### 6. Testing / Preview

**Purpose:** Let users test workflows before deploying.

**Detail:**

**"Test with record" button:**
1. User picks an existing record (e.g., a specific guest)
2. System runs workflow in **dry-run mode**: evaluates conditions, simulates actions, reports what WOULD happen
3. Displays results: "Condition: PASS (type=JP, interpreterRequired=true). Would create 1 pairing record. Would create 10 prep items from template 'jp-checklist'. Would send notification to liaison Hana Ito."
4. No actual writes, notifications, or API calls executed

**Dry-run output format:**
```
Step 1: create_record → pairing
  ✓ Would create record with: { role: "Interpreter", guestId: "g1" }
Step 2: create_records → prep_item (×10 from template "jp-checklist")
  ✓ Would create 10 records linked to guest "g1"
Step 3: notify → liaison
  ✓ Would send "new-jp-guest" to Hana Ito (hana@animeboston.com)
```

**Acceptance Criteria:**
- [ ] Dry-run executes without side effects
- [ ] Results show per-action outcome
- [ ] Condition evaluation result shown (pass/fail with field values)

---

### 7. CI/QA Integration

**Purpose:** Connect builder to the platform config CI/QA pipeline.

**Detail:**

Before a workflow can be saved, the CI/QA pipeline runs validation (see `core/ontology-ci-qa.md`):

- **Loop detection:** Workflow A's actions emit events that trigger Workflow A (or A→B→A cycle)
- **Rate estimation:** For scheduled triggers, estimate frequency. Alert if >100 runs/day
- **Action target validation:** Every `create_record` target concept exists. Every `notify` template exists. Every `call_api` integration exists.
- **Notification flood check:** Would notify >10 recipients per trigger → warning
- **Missing condition warning:** Trigger matches high-frequency events (like `*.updated`) with no condition → warning ("This will run on every update to every concept")

Validation results displayed in the builder's bottom bar in real-time as the user configures.

**Acceptance Criteria:**
- [ ] Loop detection prevents save
- [ ] Rate estimation shown for scheduled triggers
- [ ] Missing targets prevent save
- [ ] Warnings shown but don't block save (user can acknowledge)

---

### 8. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Builder renders | Unit | Three-panel layout with empty workflow | Renders without errors |
| Trigger config | Integration | Each trigger type configurable | JSON matches WorkflowTrigger |
| Condition builder | Integration | Embedded ConditionBuilder works in context | Outputs valid ConditionExpression |
| Action drag-drop | E2E | Add 3 actions, reorder, delete one | Chain state correct |
| Action config | Integration | Each action type's config panel | JSON matches WorkflowAction |
| Dry-run test | Integration | Test with real record in dry-run mode | Correct simulation output, no side effects |
| CI/QA validation | Integration | Create workflow with loop → blocked | Save prevented with error message |
| Save + load | Integration | Save workflow → reload page → config preserved | Round-trip integrity |

**Coverage target:** ≥80% on builder components, 100% on CI/QA validation integration.
