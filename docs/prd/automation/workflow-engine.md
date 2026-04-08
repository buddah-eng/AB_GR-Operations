# Workflow Engine

> DB-defined automation: WorkflowConfig records specify trigger (domain_event/scheduled/manual/field_changed),
> condition (ConditionExpression), and action chain. Executor subscribes to event bus, evaluates matching
> workflows, runs actions sequentially with Postgres transactions. No workflow logic in code.

---

## Overview

The workflow engine is the automation layer of the platform. Workflows are defined entirely in the database as `WorkflowConfig` records — the engine reads them at runtime, subscribes to the event bus, and executes matching workflows when domain events fire. Adding automation is a config change, not a code change.

The engine uses the shared ConditionExpression system for condition evaluation (see `core/condition-expression.md`) and the event bus for trigger matching (see `core/event-bus.md`). Each workflow action type is spec'd in `automation/workflow-actions.md`.

**Dependencies:** `core/event-bus.md`, `core/condition-expression.md`, `api/domain-crud.md`

---

## Full Specification

### 1. Workflow Data Model

**Purpose:** Define the structure of a workflow.

**Detail:**

Reference `WorkflowConfig` from `functions/src/ontology/types.ts:278-286`:

```typescript
interface WorkflowConfig {
  id: string
  name: string
  description?: string
  trigger: WorkflowTrigger
  condition?: ConditionExpression   // optional — if absent, always matches
  actions: WorkflowAction[]         // executed sequentially
  enabled: boolean
}
```

**WorkflowTrigger** (`types.ts:288-293`):

| `type` | `event` | `schedule` | `field` | When it fires |
|--------|---------|------------|---------|---------------|
| `domain_event` | `"guest.created"` | — | — | When matching domain event emitted |
| `field_changed` | — | — | `"status"` | When specific field changes value |
| `scheduled` | — | `"0 */15 * * *"` | — | On cron schedule (Cloud Scheduler) |
| `manual` | — | — | — | User clicks button or API call |

**WorkflowAction** (`types.ts:295-306`): 9 action types — see `automation/workflow-actions.md` for individual specs.

**Storage:** `workflow_configs` table in Postgres with JSONB columns for trigger, condition, and actions.

**Acceptance Criteria:**
- [ ] WorkflowConfig loadable from Postgres
- [ ] All four trigger types representable
- [ ] Action chains of 1-10 actions storable

---

### 2. Execution Model

**Purpose:** Define how workflows are matched, evaluated, and executed.

**Detail:**

```
Domain event emitted (e.g., "guest.created")
  │
  ▼
Workflow executor (subscribed to event bus via "*" pattern)
  │
  ├─ Load all enabled WorkflowConfigs from cache
  │
  ├─ Filter by trigger match:
  │   ├─ domain_event: workflow.trigger.event matches event.eventName
  │   │   (exact match or glob pattern: "guest.*" matches "guest.created")
  │   ├─ field_changed: event.changedFields includes workflow.trigger.field
  │   └─ scheduled/manual: not matched by event bus (separate paths)
  │
  ├─ For each matching workflow:
  │   │
  │   ├─ Evaluate condition (if present):
  │   │   evaluateCondition(workflow.condition, event.newValues) → boolean
  │   │   If false → skip this workflow
  │   │
  │   ├─ Execute actions sequentially:
  │   │   for (const action of workflow.actions) {
  │   │     const result = await executeAction(action, context)
  │   │     context.previousResults.push(result)  // available to next action
  │   │   }
  │   │
  │   └─ Log execution result (success/failure per action)
  │
  └─ Return execution summary to event bus for event log
```

**Error handling:**
- One action failing does NOT stop the chain by default
- Configurable per workflow: `stopOnError: true` halts on first failure
- Failed actions logged with error details
- Admin alerted on critical workflow failures (via platform notification)

**Acceptance Criteria:**
- [ ] Matching workflows found for a given event in <10ms
- [ ] Condition evaluation uses shared ConditionExpression engine
- [ ] Action chain executes sequentially with result passing
- [ ] Failed action doesn't crash the event bus

---

### 3. Trigger Types

**Purpose:** Define each trigger type in detail.

#### 3.1 domain_event

Fires when a matching domain event is emitted by the CRUD API.

- **Pattern matching:** Same glob syntax as event bus — `"guest.created"` (exact), `"guest.*"` (any guest event), `"*.created"` (any create)
- **Context available:** Full DomainEvent (eventName, recordId, newValues, previousValues, changedFields, triggeredBy)
- **Example:** `{ type: 'domain_event', event: 'guest.created' }` → fires when any guest is created

#### 3.2 field_changed

Fires when a specific field changes value during an update.

- **Trigger field:** `workflow.trigger.field` (e.g., `"status"`)
- **Matched when:** `event.changedFields.includes(trigger.field)`
- **Context available:** Previous value (`event.previousValues[field]`) and new value (`event.newValues[field]`)
- **Example:** `{ type: 'field_changed', field: 'status' }` with condition `{ type: 'field', field: 'status', operator: 'eq', value: 'Confirmed' }` → fires when status changes TO "Confirmed"

#### 3.3 scheduled

Fires on a cron schedule via Cloud Scheduler.

- **Cron expression:** Standard 5-field cron (minute, hour, day, month, weekday)
- **Implementation:** Cloud Scheduler job hits a `/api/workflows/scheduled` endpoint. Endpoint loads all enabled workflows with `type: 'scheduled'`, executes each.
- **Context available:** Current timestamp, no specific record context (workflow must query for relevant records)
- **Example:** `{ type: 'scheduled', schedule: '0 */15 * * *' }` → every 15 minutes (flight status polling)

#### 3.4 manual

Triggered explicitly by user action.

- **Implementation:** UI button or `POST /api/workflows/:id/run` API call
- **Context available:** Optionally, a record ID passed by the caller
- **RBAC:** Only roles with workflow execution permission can trigger
- **Example:** "Generate all pending contracts" button in admin dashboard

**Acceptance Criteria:**
- [ ] Each trigger type fires correctly in its specific scenario
- [ ] field_changed correctly identifies changed fields from event payload
- [ ] Scheduled triggers execute within 1 minute of cron time
- [ ] Manual triggers respect RBAC

---

### 4. Condition Evaluation

**Purpose:** Define how workflow conditions filter execution.

**Detail:**

Uses the shared `evaluateCondition()` from `core/condition-expression.md`.

**Context object:** Built from the domain event payload:

```typescript
const context = {
  ...event.newValues,              // current field values
  _previousValues: event.previousValues,  // for field_changed comparisons
  _changedFields: event.changedFields,
  _triggeredBy: event.triggeredBy,
  _eventName: event.eventName,
}
```

**Examples:**

```json
// Simple: only for JP guests
{ "type": "field", "field": "type", "operator": "eq", "value": "JP" }

// Compound: JP guests who are confirmed and need interpreter
{ "type": "and", "conditions": [
  { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
  { "type": "field", "field": "status", "operator": "eq", "value": "Confirmed" },
  { "type": "field", "field": "interpreterRequired", "operator": "eq", "value": true }
]}

// Status transition: only when changing TO confirmed (not already confirmed)
{ "type": "and", "conditions": [
  { "type": "field", "field": "status", "operator": "eq", "value": "Confirmed" },
  { "type": "field", "field": "_previousValues.status", "operator": "neq", "value": "Confirmed" }
]}
```

**Acceptance Criteria:**
- [ ] Conditions correctly filter workflow execution
- [ ] Absent condition = always execute
- [ ] Nested compound conditions evaluate correctly
- [ ] Previous values accessible for transition logic

---

### 5. Concrete Examples

**Purpose:** Show real workflows for Anime Boston.

#### JP Guest Onboarding
```json
{
  "name": "JP Guest Onboarding",
  "trigger": { "type": "domain_event", "event": "guest.created" },
  "condition": { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
  "actions": [
    { "type": "create_record", "target": "pairing", "defaults": { "role": "Interpreter" }, "link": "guest" },
    { "type": "create_records", "target": "prep_item", "template": "jp-guest-checklist", "link": "guest" },
    { "type": "notify", "recipients": ["liaison"], "templateName": "new-jp-guest" }
  ]
}
```

#### Guest Confirmation
```json
{
  "name": "Guest Confirmation Pipeline",
  "trigger": { "type": "field_changed", "field": "status" },
  "condition": { "type": "field", "field": "status", "operator": "eq", "value": "Confirmed" },
  "actions": [
    { "type": "generate_doc", "templateName": "guest-contract" },
    { "type": "create_record", "target": "transport_booking", "defaults": { "status": "requested" }, "link": "guest" },
    { "type": "notify", "recipients": ["liaison", "director"], "templateName": "guest-confirmed" }
  ]
}
```

#### Flight Delay Cascade
```json
{
  "name": "Flight Delay Update",
  "trigger": { "type": "scheduled", "schedule": "0 */15 * * *" },
  "actions": [
    { "type": "call_api", "target": "flightaware", "templateName": "poll-active-flights" },
    { "type": "notify", "recipients": ["liaison"], "templateName": "flight-delay-alert" }
  ]
}
```

#### Concert Prep
```json
{
  "name": "Concert Event Prep",
  "trigger": { "type": "domain_event", "event": "schedule_event.created" },
  "condition": { "type": "field", "field": "event_type", "operator": "eq", "value": "concert" },
  "actions": [
    { "type": "create_record", "target": "prep_item", "defaults": { "name": "Sound check", "status": "incomplete" }, "link": "schedule_event" },
    { "type": "create_record", "target": "prep_item", "defaults": { "name": "Equipment checkout", "status": "incomplete" }, "link": "schedule_event" },
    { "type": "notify", "recipients": ["music_dept"], "templateName": "concert-prep-created" }
  ]
}
```

---

### 6. Transaction Boundaries

**Purpose:** Define which action sequences are transactional.

| Action Type | Transactional? | Why |
|---|---|---|
| create_record / create_records | Yes (within chain) | Multiple creates should all succeed or all roll back |
| update_record | Yes (within chain) | Same — partial updates leave inconsistent state |
| delete_record | Yes (within chain) | Same |
| notify | No (fire-and-forget) | Notification failure shouldn't roll back data changes |
| call_api | No (fire-and-forget) | External API failure shouldn't roll back data changes |
| sync_calendar | No (fire-and-forget) | Calendar sync failure shouldn't block |
| generate_doc | No (fire-and-forget) | Doc generation failure logged, retryable |
| lookup_registry | Yes (if followed by create/update) | Registry data feeds into subsequent actions |

**Implementation:** Data mutations (create/update/delete) within a single workflow execute in one Postgres transaction. Non-transactional actions execute after the transaction commits. If the transaction rolls back, non-transactional actions are skipped.

**Acceptance Criteria:**
- [ ] Data mutations in a chain are atomic (all or nothing)
- [ ] Notification/API failures don't roll back data changes
- [ ] Transaction rollback skips subsequent fire-and-forget actions

---

### 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Trigger matching | Unit | domain_event pattern matching, field_changed detection | Correct workflows found for each event |
| Condition evaluation | Unit | Simple, compound, nested, absent conditions | Correct pass/fail per case |
| Action execution | Integration | Each action type executes correctly | Record created/updated/deleted/notified |
| Action chaining | Integration | Output of action N available to action N+1 | Chain completes with correct data flow |
| Error isolation | Integration | Action fails → workflow continues (default) | Subsequent actions execute |
| Stop on error | Integration | stopOnError=true → chain halts | Subsequent actions skipped |
| Transaction rollback | Integration | Data mutation fails mid-chain | All mutations rolled back |
| Scheduled trigger | Integration | Cron fires → workflows execute | Correct workflows run at scheduled time |
| Manual trigger | Integration | API call → workflow executes | Workflow runs with provided context |
| RBAC on manual | Integration | Unauthorized user triggers manual workflow | 403 returned |
| Concurrent workflows | Load | Multiple workflows fire on same event | All execute without interference |

**Coverage target:** ≥80% on workflow executor, 100% on trigger matching and condition evaluation.
