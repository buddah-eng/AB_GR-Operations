# PRD-06: Workflow Engine & Automation

> **Shorthand:** Domain event bus with glob-style pattern matching (`guest.*`, `*.created`) drives DB-defined
> workflow automation. WorkflowConfig records define trigger + condition + action arrays; the executor subscribes
> to the bus, evaluates ConditionExpressions, and runs actions sequentially. Eight seed workflows already defined.

---

## Overview

Workflows are database-defined automations triggered by domain events, schedules, or manual user action. They
replace hardcoded business logic with declarative records: each `WorkflowConfig` specifies *when* to fire
(trigger), *whether* to fire (condition), and *what to do* (ordered action array). The engine integrates with
the in-memory event bus (`functions/src/events/bus.ts`) which already emits domain events on every CRUD
operation through the generic domain router. When an event fires, the workflow executor loads all enabled
`WorkflowConfig` records whose trigger matches the event, evaluates each workflow's `ConditionExpression` against
the event payload, and executes matching workflows' actions in sequence. Scheduled workflows run on cron;
manual workflows are invoked from the UI. All execution is logged to the events log for auditability.

---

## Full Specification

### 1. Workflow Data Model

All types are defined in `functions/src/ontology/types.ts`.

#### WorkflowConfig

```typescript
interface WorkflowConfig {
  readonly id: NotionPageId
  readonly name: string
  readonly description?: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression
  readonly actions: ReadonlyArray<WorkflowAction>
  readonly enabled: boolean
}
```

Each workflow is a single record in the `workflows` database. The `enabled` flag allows workflows to be
deactivated without deletion. The `condition` field is optional -- when omitted, the workflow fires on every
matching trigger.

#### WorkflowTrigger

```typescript
interface WorkflowTrigger {
  readonly type: WorkflowTriggerType  // 'domain_event' | 'scheduled' | 'manual' | 'field_changed'
  readonly event?: string             // e.g. "guest.created" (for domain_event)
  readonly schedule?: string          // cron expression (for scheduled)
  readonly field?: string             // property key (for field_changed)
}
```

#### WorkflowAction

```typescript
interface WorkflowAction {
  readonly type: WorkflowActionType
  readonly target?: string            // concept key
  readonly template?: string          // template name (for create_records)
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly link?: string              // relation field to link back
  readonly source?: string            // concept key (for lookup_registry)
  readonly match?: string             // property key to match on
  readonly copyFields?: ReadonlyArray<string>
  readonly recipients?: ReadonlyArray<string>
  readonly templateName?: string      // for notify, generate_doc
}
```

`WorkflowActionType` is a union of nine action types:

```
'create_record' | 'create_records' | 'update_record' | 'delete_record'
| 'notify' | 'sync_calendar' | 'generate_doc' | 'call_api' | 'lookup_registry'
```

---

### 2. Execution Model

#### Event Flow

1. A CRUD operation hits the generic domain router (`/api/domains/:concept`).
2. The router calls `createDomainEvent()` from `functions/src/events/bus.ts` and populates the `DomainEvent` payload including `domain`, `action`, `recordId`, `changedFields`, `previousValues`, and `newValues`.
3. `emit(event)` is called. The bus iterates all subscriptions sorted by priority (lower = first), executing matching handlers sequentially.
4. Each handler error is caught and logged but does not block subsequent handlers.
5. After all handlers run, the bus logs an `EventLogEntry` to the Notion events log database (fire-and-forget).

#### Workflow Executor (planned)

The workflow executor is a handler that subscribes to `*` (all events) on the bus at a standard priority. On each event it:

1. Loads all enabled `WorkflowConfig` records from the database (cached with TTL).
2. Filters to workflows whose `trigger.event` matches the incoming `event.eventName` using the same glob pattern matching as the bus itself (`matchesPattern` in `bus.ts`).
3. For `field_changed` triggers, additionally checks that `trigger.field` is present in `event.changedFields`.
4. Evaluates the workflow's `condition` (if present) against the event payload using the shared `ConditionExpression` evaluator.
5. For each matching workflow, executes its `actions` array in order.
6. Actions are transactional where possible (Postgres transactions post-migration; in the Notion era, best-effort with compensating cleanup).
7. Errors: log the failure, continue to remaining workflows, alert admin on critical failures (e.g., contract generation failure for a confirmed guest).

#### DomainEvent Payload

Defined in `functions/src/events/types.ts`:

```typescript
interface DomainEvent {
  readonly eventId: string
  readonly eventName: string          // "guest.created", "schedule.updated"
  readonly domain: string             // concept key
  readonly action: EventAction        // 'created' | 'updated' | 'deleted' | ...
  readonly recordId: string
  readonly changedFields?: ReadonlyArray<string>
  readonly previousValues?: Readonly<Record<string, unknown>>
  readonly newValues?: Readonly<Record<string, unknown>>
  readonly triggeredBy: string        // user email or "system"
  readonly timestamp: string          // ISO 8601
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`EventAction` includes operational states beyond basic CRUD: `'synced'`, `'external_created'`, `'external_updated'`, `'intake_received'`, `'completed'`, `'overdue'`, `'staffing_complete'`.

---

### 3. Trigger Types

#### domain_event

Fires when a concept-level domain event is emitted. The `trigger.event` field uses the same `concept.action` naming convention as the event bus: `guest.created`, `schedule.updated`, `pairings.created`, etc.

Pattern matching follows the bus's glob syntax:
- `guest.created` -- exact match
- `guest.*` -- any event on the guest concept
- `*.created` -- any concept's created event

#### field_changed

A specialization of `domain_event` for update events. Fires when a specific field changes value. The executor checks that `trigger.field` appears in `event.changedFields` and optionally evaluates a condition against the old and new values.

Example: `trigger.field = "status"` combined with `condition: { type: "field", field: "status", operator: "eq", value: "Confirmed" }` fires only when a guest's status changes *to* "Confirmed".

#### scheduled

Cron-based triggers. The `trigger.schedule` field holds a cron expression. A Cloud Functions scheduled function (or Cloud Scheduler job post-migration) ticks at the appropriate interval and emits a synthetic event that the workflow executor matches.

Examples from seed data:
- `cron:0 9 * * *` -- daily at 9am (Prep Overdue Check)
- Future: `cron:*/15 * * * *` -- every 15 minutes (FlightAware polling)

#### manual

Triggered by explicit user action in the UI. The frontend calls an API endpoint that emits a synthetic `workflow.manual` event with the workflow ID. Used for batch operations like "Generate all contracts for confirmed guests" or "Recalculate all prep checklists".

---

### 4. Action Types

Each action type maps to an executor function. Actions receive the event payload and the workflow's `defaults`, `template`, `link`, and other fields.

#### create_record

Creates a single record in the target concept's database, linked back to the source record via the `link` relation field.

**Example (from seed: New Guest Pipeline):** Guest created --> create a Travel placeholder record linked to the guest with `{ description: "{{guest.name}} - Travel TBD", travel_type: "Flight", status: "Pending" }`.

#### create_records

Creates multiple records from a named template. The `template` field references a set of predefined records (e.g., a prep checklist template). Each template item becomes a separate record linked to the source.

**Example (from seed: New Guest Pipeline):** Guest created --> create all items from `new_guest_prep_checklist` template in the `prep_tracker` concept, each linked to the new guest.

**Example (from seed: JP Guest Extras):** JP guest created --> create items from `jp_guest_extra_prep` template (interpreter briefing, LINE setup, cultural notes).

#### update_record

Updates an existing record. The `defaults` field specifies which fields to set. A `_lookup` convention in the defaults allows targeting related records rather than the event's source record.

**Example (from seed: Travel Update):** Travel record updated --> find schedule events where `event_type=Transport AND guest=travel.guest`, update their date and time from the travel record's arrival details.

#### delete_record

Archives or deletes related records. Used for cleanup workflows.

**Example:** Guest canceled --> soft-delete (archive) related prep items by setting `status: "Archived"`.

#### notify

Sends a notification to specified recipients using a named template. Recipients can be role-based (`["director"]`), relation-based (`["_owner"]` = the record's assigned staff), or explicit email addresses.

**Example (from seed: Prep Overdue Check):** Daily cron finds overdue prep items --> notify `_owner` (the assigned staff member) using the `prep_overdue_notification` template.

**Example (from seed: New Guest Pipeline):** Guest created --> notify `director` using `new_guest_notification` template.

#### sync_calendar

Pushes schedule events to Google Calendar or updates existing calendar entries. Supports adding attendees when staff pairings change.

**Example (from seed: Schedule to Calendar):** Schedule event created --> sync to Google Calendar.

**Example (from seed: Pairing Created):** Staff member paired with guest --> add staff member's email as attendee to all of that guest's calendar events.

#### generate_doc

Triggers document generation from a template. Used for contracts, itineraries, and checklists. See PRD-08 for the full contract generation specification.

**Example:** Guest status changed to "Confirmed" --> generate contract from clause templates, create `generated_contract` record.

#### call_api

Calls an external API. Used for third-party integrations.

**Examples:**
- Poll FlightAware for flight status updates and cascade delays to transport bookings.
- Create a Blacklane ground transport booking from a transport_booking record.

#### lookup_registry

Queries the year-over-year registry for historical data about a returning guest. Copies specified fields from the registry match into the new record.

**Example (from seed: New Guest Pipeline):** Guest created --> look up `guest_registry` by `name`, copy `dietary`, `interpreter_pref`, and `special_handling` from the last year's record if found.

---

### 5. Condition Evaluation

Workflows use the same `ConditionExpression` type system as ontology constraints, form field `showIf` rules, and contract clause conditions. This is a single expression language shared across the entire platform.

#### ConditionExpression Types

Defined in `functions/src/ontology/types.ts`:

```typescript
type ConditionExpression = FieldCondition | AndCondition | OrCondition | NotCondition

interface FieldCondition {
  readonly type: 'field'
  readonly field: string
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
                   | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
  readonly value?: unknown
}

interface AndCondition {
  readonly type: 'and'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

interface OrCondition {
  readonly type: 'or'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

interface NotCondition {
  readonly type: 'not'
  readonly condition: ConditionExpression
}
```

#### Evaluation Rules

- **Field conditions** evaluate against the event payload's `newValues` (for created/updated events) or the full record (for scheduled/manual triggers).
- **Compound conditions** (`and`, `or`, `not`) compose arbitrarily for complex logic.
- The evaluator is a pure function: `evaluate(condition: ConditionExpression, context: Record<string, unknown>): boolean`.

#### Example

The "JP Guest Extras" seed workflow uses this condition:

```json
{
  "type": "field",
  "field": "type",
  "operator": "eq",
  "value": "JP"
}
```

A more complex example for a hypothetical workflow:

```json
{
  "type": "and",
  "conditions": [
    { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
    { "type": "field", "field": "status", "operator": "eq", "value": "Confirmed" },
    { "type": "field", "field": "interpreterRequired", "operator": "eq", "value": true }
  ]
}
```

---

### 6. Workflow Examples (Anime Boston)

These are concrete workflows relevant to GR operations. The first two are already seeded in `notion-setup/src/seed-workflows.ts`; the rest illustrate the engine's intended use.

#### New Guest Pipeline (seeded)

- **Trigger:** `domain_event: guest.created`
- **Condition:** none (fires for all guests)
- **Actions:**
  1. `create_records` -- generate full prep checklist from `new_guest_prep_checklist` template
  2. `create_record` -- schedule skeleton (tentative staff event)
  3. `create_record` -- travel placeholder (Flight, Pending)
  4. `create_record` -- accommodations placeholder (TBD, Pending)
  5. `lookup_registry` -- check `guest_registry` for returning guest data
  6. `notify` -- alert director via `new_guest_notification`

#### JP Guest Extras (seeded)

- **Trigger:** `domain_event: guest.created`
- **Condition:** `{ type: "field", field: "type", operator: "eq", value: "JP" }`
- **Actions:**
  1. `update_record` -- set `interpreter_required = true` on the guest
  2. `create_record` -- create interpreter pairing slot (Primary Interpreter, Unfilled)
  3. `create_records` -- JP-specific prep items from `jp_guest_extra_prep` template

#### Guest Confirmation (planned)

- **Trigger:** `field_changed: guest.status`
- **Condition:** `{ type: "field", field: "status", operator: "eq", value: "Confirmed" }`
- **Actions:**
  1. `generate_doc` -- generate contract from clause templates (see PRD-08)
  2. `create_record` -- create transport_booking record
  3. `update_record` -- block schedule slots (change from Tentative to Confirmed)
  4. `notify` -- send welcome email to guest contact

#### Concert Prep (planned)

- **Trigger:** `domain_event: schedule.created`
- **Condition:** `{ type: "field", field: "event_type", operator: "eq", value: "Concert" }`
- **Actions:**
  1. `create_record` -- sound check prep item in `prep_tracker`
  2. `create_records` -- equipment checkout items from `concert_equipment` template
  3. `notify` -- notify music department head

#### Exhibit Setup (planned)

- **Trigger:** `field_changed: dealer.status`
- **Condition:** `{ type: "field", field: "status", operator: "eq", value: "Approved" }`
- **Actions:**
  1. `create_record` -- booth assignment record
  2. `generate_doc` -- booth contract from dealer contract template
  3. `update_record` -- add dealer to floor plan layout

---

### 7. Current Implementation Status

#### Built

- **WorkflowConfig types** (`functions/src/ontology/types.ts`): `WorkflowConfig`, `WorkflowTrigger`, `WorkflowAction`, `WorkflowTriggerType`, `WorkflowActionType` -- all fully typed with readonly properties.
- **Event bus** (`functions/src/events/bus.ts`): In-memory pub/sub with glob-style pattern matching, priority-ordered sequential handler execution, error isolation between handlers, fire-and-forget logging to Notion events log.
- **Domain event types** (`functions/src/events/types.ts`): `DomainEvent` with full change tracking (`changedFields`, `previousValues`, `newValues`), ten `EventAction` variants, `EventHandler`, `EventSubscription`, `EventLogEntry`.
- **Domain events emitted on all CRUD operations** via the generic domain router.
- **8 seed workflows** in `notion-setup/src/seed-workflows.ts`: New Guest Pipeline, JP Guest Extras, Schedule to Calendar, Schedule Update Sync, Travel Update, Pairing Created, Prep Overdue Check, Staffing Auto-Create.

#### Stub

- **WorkflowManagerView.vue** (`web/src/views/WorkflowManagerView.vue`): Displays a placeholder card with "This feature is under development" message. Imports only `primevue/card`.

#### Not Built

- **Workflow executor:** The handler that subscribes to the bus, loads WorkflowConfigs, evaluates conditions, and dispatches to action executors.
- **Action executors:** Individual functions for each of the nine `WorkflowActionType` values.
- **Condition evaluator:** The `evaluate(condition, context)` function (shared across workflows, constraints, form showIf, and contract clauses).
- **Scheduled trigger runtime:** Cloud Scheduler integration or Cloud Functions scheduled function for cron-based workflows.
- **Template resolution:** Handlebars-style `{{variable}}` substitution in action defaults.
- **Visual workflow builder:** Node-based editor for creating/editing workflows in the UI (planned Y2).
- **Workflow execution history UI:** Browsing past executions, viewing action results, debugging failures.
