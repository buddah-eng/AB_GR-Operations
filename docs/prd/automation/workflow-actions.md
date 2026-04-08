# Workflow Actions

> `WorkflowActionType` | `WorkflowAction` — `functions/src/ontology/types.ts:268-306`

## Shorthand

| Action | What it does | Key fields |
|---|---|---|
| `create_record` | Create one record in target concept | `target`, `defaults`, `link` |
| `create_records` | Batch-create from template | `target`, `template`, `defaults`, `link` |
| `update_record` | Patch fields on existing record | `target`, `defaults` |
| `delete_record` | Archive target record | `target` |
| `notify` | Send notification | `recipients`, `templateName`, channel |
| `sync_calendar` | Push/update Google Calendar event | `target`, `defaults` |
| `generate_doc` | Produce contract/itinerary | `templateName`, output format |
| `call_api` | External API request | `target` (api_integration), request/response map |
| `lookup_registry` | YoY registry check | `source`, `match`, `copyFields` |

## Overview

Workflow actions are the execution units inside a `WorkflowConfig`. When a workflow's trigger fires and its optional `condition` passes, the `actions` array executes **sequentially**. Each action reads from the triggering record context and can produce outputs consumed by subsequent actions in the chain.

Postgres is the system of record for all data created, updated, or archived by actions. Every mutation is wrapped in a transaction with an audit trail row.

---

## 1. create_record

**Purpose.** Insert a single new record into a target concept table, optionally linking it back to the triggering record.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Concept key of the table to insert into (e.g., `prep_item`). |
| `defaults` | `Record<string, unknown>` | No | Field values to set on the new record. Supports `{{context.*}}` interpolation from the triggering record. |
| `link` | `string` | No | Relation field on the new record that points back to the triggering record's ID. |

### Outputs

- `created_record_id` — UUID of the newly inserted row. Available to subsequent actions via `{{prev.created_record_id}}`.

### Example

> Guest confirmed --> create prep items.

```jsonc
{
  "type": "create_record",
  "target": "prep_item",
  "defaults": {
    "title": "Confirm dietary requirements",
    "status": "todo",
    "due_offset_days": -3
  },
  "link": "guest_id"
}
```

Trigger: `guest.status` changes to `confirmed`. Action creates a `prep_item` row with `guest_id` linking back to the guest.

### Acceptance Criteria

- [ ] New row appears in target concept table within the same transaction.
- [ ] `link` field is populated with the triggering record's ID.
- [ ] `defaults` values are applied; `{{context.*}}` tokens are resolved.
- [ ] If `target` concept does not exist, action fails with a descriptive error and the workflow halts.
- [ ] Audit log entry records the action, actor (system/workflow), and timestamp.
- [ ] `created_record_id` is available to subsequent chained actions.

---

## 2. create_records

**Purpose.** Batch-create multiple records from a named template. The template defines an array of record shapes; each is inserted into the target concept.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Concept key for all created records. |
| `template` | `string` | Yes | Name of the record template (stored in `workflow_templates` table). Resolves to an array of partial record objects. |
| `defaults` | `Record<string, unknown>` | No | Override or supplement values on every record in the batch. |
| `link` | `string` | No | Relation field linking each new record back to the trigger record. |

### Outputs

- `created_record_ids` — array of UUIDs for all inserted rows.

### Example

> JP guest --> create full JP prep checklist (10 items).

```jsonc
{
  "type": "create_records",
  "target": "prep_item",
  "template": "jp_guest_checklist",
  "defaults": {
    "priority": "high"
  },
  "link": "guest_id"
}
```

The `jp_guest_checklist` template contains 10 prep items (interpreter confirmation, cultural briefing, dietary notes, etc.). All 10 rows are inserted in a single transaction.

### Acceptance Criteria

- [ ] All records from the template are created atomically (all-or-nothing).
- [ ] Each record gets the `link` field populated and `defaults` merged.
- [ ] Template not found --> action fails with error naming the missing template.
- [ ] `created_record_ids` array is available to subsequent actions.
- [ ] Works correctly with templates of 1 to 100 items.

---

## 3. update_record

**Purpose.** Patch one or more fields on an existing record identified by the triggering context.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Concept key of the record to update. If the trigger record is the same concept, updates it directly. If different, resolves via relation. |
| `defaults` | `Record<string, unknown>` | Yes | Key-value pairs to set. Supports `{{context.*}}` interpolation. |

### Outputs

- `updated_record_id` — UUID of the patched row.

### Example

> Flight delayed --> update transport_booking.flightEta.

```jsonc
{
  "type": "update_record",
  "target": "transport_booking",
  "defaults": {
    "flight_eta": "{{context.new_eta}}",
    "eta_status": "delayed"
  }
}
```

Trigger: `flight_status` domain event with payload containing `new_eta`. The action patches the related `transport_booking` row.

### Acceptance Criteria

- [ ] Only specified fields are updated; all other fields remain unchanged.
- [ ] Update is atomic and respects row-level locking.
- [ ] If target record does not exist, action fails with descriptive error.
- [ ] `{{context.*}}` tokens resolve correctly from trigger payload.
- [ ] Previous field values are captured in the audit log for rollback capability.

---

## 4. delete_record

**Purpose.** Soft-delete (archive) a target record. No hard deletes in production workflows.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Concept key of the record(s) to archive. Resolves related records via the trigger context. |

### Outputs

- `archived_record_ids` — array of UUIDs for archived rows.

### Example

> Guest canceled --> archive prep items.

```jsonc
{
  "type": "delete_record",
  "target": "prep_item"
}
```

Trigger: `guest.status` changes to `canceled`. Action sets `archived_at` on all `prep_item` rows linked to that guest.

### Acceptance Criteria

- [ ] Records are soft-deleted (`archived_at` timestamp set, `is_archived = true`).
- [ ] No hard deletes occur.
- [ ] Cascading archive: all child records linked via the target's relation fields are also archived.
- [ ] Archived records are excluded from default queries but remain accessible via admin/audit views.
- [ ] `archived_record_ids` is available to subsequent actions.

---

## 5. notify

**Purpose.** Send a notification to one or more recipients via a specified channel.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `recipients` | `ReadonlyArray<string>` | Yes | Role-based (e.g., `role:liaison`, `role:ops_lead`) or specific user IDs. |
| `templateName` | `string` | Yes | Name of the notification template (stored in `notification_templates` table). Template supports `{{context.*}}` placeholders. |
| `defaults` | `Record<string, unknown>` | No | Channel selection and overrides: `{ "channel": "email" | "in_app" | "both" }`. Defaults to `in_app`. |

### Outputs

- `notification_ids` — array of notification record UUIDs (one per recipient).
- `delivery_status` — `queued` | `sent` | `failed` per recipient.

### Example

> Guest confirmed --> email liaison.

```jsonc
{
  "type": "notify",
  "recipients": ["role:liaison"],
  "templateName": "guest_confirmed_alert",
  "defaults": {
    "channel": "email"
  }
}
```

Resolves `role:liaison` to the user(s) assigned that role for the event/guest context. Renders the `guest_confirmed_alert` template with guest data and sends via email.

### Acceptance Criteria

- [ ] Role-based recipients resolve to actual user records at execution time.
- [ ] Template renders with all `{{context.*}}` values filled; missing values produce a clear warning, not silent empty strings.
- [ ] Email channel: message is queued via the email service; delivery receipt is stored.
- [ ] In-app channel: notification row is created and pushed via websocket.
- [ ] Failed delivery is retried up to 3 times with exponential backoff.
- [ ] `notification_ids` are available to subsequent actions.

---

## 6. sync_calendar

**Purpose.** Create or update a Google Calendar event corresponding to a schedule record.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Concept key of the schedule/event record to sync. |
| `defaults` | `Record<string, unknown>` | No | Field mapping overrides: `{ "summary_field": "title", "start_field": "start_time", "end_field": "end_time", "location_field": "venue" }`. |

### Event Mapping

| Calendar field | Default source field | Override key |
|---|---|---|
| `summary` | `title` | `summary_field` |
| `start` | `start_time` | `start_field` |
| `end` | `end_time` | `end_field` |
| `location` | `venue` | `location_field` |
| `description` | `notes` | `description_field` |

### Conflict Handling

- If a gcal event already exists for the record (`gcal_event_id` is set), the action **updates** it.
- If the target time slot conflicts with an existing gcal event, the action proceeds but tags the record with `calendar_conflict: true`.
- Deleted/archived records trigger gcal event cancellation.

### Outputs

- `gcal_event_id` — Google Calendar event ID, written back to the source record.

### Example

> Schedule event --> gcal event.

```jsonc
{
  "type": "sync_calendar",
  "target": "schedule_event",
  "defaults": {
    "summary_field": "event_name",
    "calendar_id": "ops-team@group.calendar.google.com"
  }
}
```

### Acceptance Criteria

- [ ] New gcal event is created when `gcal_event_id` is null on the source record.
- [ ] Existing gcal event is updated (not duplicated) when `gcal_event_id` is present.
- [ ] `gcal_event_id` is persisted back to the source record in Postgres.
- [ ] Conflict detection flags the record but does not block creation.
- [ ] Archive/delete of source record cancels the gcal event.
- [ ] Auth failures (expired token, revoked access) surface as actionable errors.

---

## 7. generate_doc

**Purpose.** Trigger document generation from a template (contracts, itineraries, briefing sheets).

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `templateName` | `string` | Yes | Name of the document template (stored in `doc_templates` table). |
| `target` | `string` | No | Concept key for the primary data source. Defaults to the trigger record's concept. |
| `defaults` | `Record<string, unknown>` | No | Overrides and config: `{ "output_format": "pdf" | "docx", "storage_path": "..." }`. Defaults to `pdf`. |

### Outputs

- `document_id` — UUID of the generated document record.
- `document_url` — Signed URL for the generated file.

### Example

> Guest confirmed --> generate contract.

```jsonc
{
  "type": "generate_doc",
  "templateName": "guest_contract_v2",
  "defaults": {
    "output_format": "pdf"
  }
}
```

Trigger: `guest.status` changes to `confirmed`. Pulls guest data, event data, and terms from related records. Renders `guest_contract_v2` template to PDF. Stores in document storage and links back to the guest record.

### Acceptance Criteria

- [ ] Template is rendered with all context data; missing required fields halt generation with error.
- [ ] Output file is stored in configured storage (GCS bucket) and linked to the source record.
- [ ] `document_url` is a time-limited signed URL (default 7-day expiry).
- [ ] PDF output is valid and renders correctly.
- [ ] `document_id` and `document_url` are available to subsequent actions (e.g., attach to a `notify` email).

---

## 8. call_api

**Purpose.** Make an HTTP request to an external API. The integration configuration is stored as an `api_integration` concept record in Postgres.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | Record key/ID of the `api_integration` concept that defines base URL, auth method, headers. |
| `defaults` | `Record<string, unknown>` | No | Request config: `{ "method": "GET"|"POST"|"PUT", "path": "/endpoint", "body": {...}, "response_mapping": {...} }`. Supports `{{context.*}}` in all string values. |

### Request/Response Mapping

**Request** — `defaults.body` is a JSON object with `{{context.*}}` interpolation. Example: `{ "flight": "{{context.flight_number}}" }`.

**Response** — `defaults.response_mapping` maps API response fields to record fields for a subsequent `update_record` or `create_record` action:

```jsonc
{
  "response_mapping": {
    "estimated_arrival": "flight_eta",
    "status": "flight_status"
  }
}
```

Mapped values are injected into the action chain context as `{{prev.<mapped_key>}}`.

### Example

> Poll FlightAware for flight status.

```jsonc
{
  "type": "call_api",
  "target": "flightaware_integration",
  "defaults": {
    "method": "GET",
    "path": "/flights/{{context.flight_number}}/status",
    "response_mapping": {
      "estimatedArrival": "flight_eta",
      "status": "flight_status"
    }
  }
}
```

> Create Blacklane booking.

```jsonc
{
  "type": "call_api",
  "target": "blacklane_integration",
  "defaults": {
    "method": "POST",
    "path": "/bookings",
    "body": {
      "pickup_time": "{{context.arrival_time}}",
      "pickup_location": "{{context.airport_code}}",
      "dropoff_location": "{{context.hotel_address}}",
      "passenger_name": "{{context.guest_name}}"
    },
    "response_mapping": {
      "booking_id": "blacklane_booking_id",
      "confirmation_url": "blacklane_confirmation_url"
    }
  }
}
```

### Acceptance Criteria

- [ ] API credentials are read from the `api_integration` record, never hardcoded in the action config.
- [ ] `{{context.*}}` tokens in path, body, and headers are resolved before the request is sent.
- [ ] HTTP errors (4xx, 5xx) are captured; the action fails with status code and response body in the error.
- [ ] Timeout: 30s default, configurable per integration.
- [ ] Response mapping injects values into chain context for downstream actions.
- [ ] Rate limiting: respects `rate_limit` config on the integration record; queues if limit reached.
- [ ] Secrets (API keys, tokens) are stored encrypted and never logged.

---

## 9. lookup_registry

**Purpose.** Check the year-over-year (YoY) registry for a returning entity (guest, vendor, venue) and pre-fill data from previous engagements.

### Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | Concept key of the registry to search (e.g., `guest_registry`, `vendor_registry`). |
| `match` | `string` | Yes | Property key to match on (e.g., `email`, `phone`, `tax_id`). Compared against the trigger record's same-named field. |
| `copyFields` | `ReadonlyArray<string>` | Yes | Fields to copy from the registry match to the trigger record. |

### Outputs

- `registry_match_found` — boolean.
- `registry_record_id` — UUID of the matched registry row (null if no match).
- Copied field values are written directly to the trigger record.

### Example

> New guest --> check registry --> pre-fill data.

```jsonc
{
  "type": "lookup_registry",
  "source": "guest_registry",
  "match": "email",
  "copyFields": [
    "dietary_restrictions",
    "room_preference",
    "language",
    "emergency_contact",
    "previous_events"
  ]
}
```

Trigger: `guest.created`. Action queries `guest_registry` for a row where `email` matches the new guest's email. If found, copies the listed fields onto the guest record.

### Acceptance Criteria

- [ ] Match is case-insensitive for string fields (email, name).
- [ ] If no match found, action succeeds silently with `registry_match_found = false`; workflow continues.
- [ ] If match found, `copyFields` are written to the trigger record without overwriting fields that already have non-null values (merge, not replace).
- [ ] Multiple matches: use the most recent registry entry (by `last_event_date` or `updated_at`).
- [ ] `registry_match_found` and `registry_record_id` are available to subsequent actions for conditional logic.
- [ ] Audit log records which fields were copied and from which registry entry.

---

## 10. Action Chaining

**Purpose.** Actions within a workflow execute sequentially in array order. Each action can consume outputs from previous actions, enabling multi-step automations.

### Execution Model

1. Actions run in the order defined in `WorkflowConfig.actions`.
2. Each action receives a **context object** containing:
   - `context.*` — fields from the triggering record/event.
   - `prev.*` — outputs from the immediately preceding action.
   - `actions[n].*` — outputs from any earlier action by index.
3. If any action fails, the chain **halts** and all preceding mutations are **rolled back** (single transaction).

### Token Resolution

| Token | Resolves to |
|---|---|
| `{{context.field_name}}` | Trigger record field value |
| `{{prev.created_record_id}}` | Output of the previous action |
| `{{actions[0].created_record_id}}` | Output of the first action by index |
| `{{prev.registry_match_found}}` | Boolean output from a lookup action |

### Example — Full Chain

> Guest confirmed: create prep items, look up registry, notify liaison, generate contract.

```jsonc
{
  "trigger": { "type": "field_changed", "field": "status" },
  "condition": { "field": "status", "op": "eq", "value": "confirmed" },
  "actions": [
    {
      "type": "lookup_registry",
      "source": "guest_registry",
      "match": "email",
      "copyFields": ["dietary_restrictions", "room_preference"]
    },
    {
      "type": "create_records",
      "target": "prep_item",
      "template": "standard_guest_checklist",
      "link": "guest_id"
    },
    {
      "type": "generate_doc",
      "templateName": "guest_contract_v2",
      "defaults": { "output_format": "pdf" }
    },
    {
      "type": "notify",
      "recipients": ["role:liaison"],
      "templateName": "guest_confirmed_with_contract",
      "defaults": {
        "channel": "email",
        "attachment_url": "{{prev.document_url}}"
      }
    }
  ]
}
```

Step 1 checks the registry and pre-fills returning guest data. Step 2 creates the prep checklist. Step 3 generates the contract PDF. Step 4 emails the liaison with the contract attached (`{{prev.document_url}}` resolves to the output of step 3).

### Acceptance Criteria

- [ ] Actions execute in strict array order; no parallel execution within a single workflow.
- [ ] `prev.*` tokens resolve to the output of the immediately preceding action.
- [ ] `actions[n].*` tokens resolve to the output of action at index `n`.
- [ ] Failure at any step rolls back all preceding mutations in the chain.
- [ ] Chain of 10+ actions executes correctly without context loss.
- [ ] Circular references in token resolution are detected and rejected at config validation time.

---

## 11. Test Plan

### Unit Tests — Individual Action Types

| Action | Test case | Assertion |
|---|---|---|
| `create_record` | Valid target and defaults | Row inserted, `created_record_id` returned |
| `create_record` | Invalid target concept | Error thrown, no row inserted |
| `create_record` | With `link` field | Relation field populated with trigger record ID |
| `create_records` | Valid template (N items) | N rows inserted atomically |
| `create_records` | Missing template | Error with template name in message |
| `create_records` | Template with 0 items | No rows created, no error |
| `update_record` | Valid target and defaults | Fields patched, others unchanged |
| `update_record` | Non-existent record | Error thrown |
| `update_record` | `{{context.*}}` interpolation | Values resolved from trigger payload |
| `delete_record` | Active record | `archived_at` set, `is_archived = true` |
| `delete_record` | Already archived record | Idempotent, no error |
| `notify` | Role-based recipients | Resolves to user(s), notification created |
| `notify` | Specific user ID | Notification delivered to that user |
| `notify` | Email channel | Email queued via email service |
| `notify` | Invalid template | Error with template name in message |
| `sync_calendar` | New event (no `gcal_event_id`) | Gcal event created, ID written back |
| `sync_calendar` | Existing event (has `gcal_event_id`) | Gcal event updated, not duplicated |
| `sync_calendar` | Archived source record | Gcal event canceled |
| `generate_doc` | Valid template | PDF generated, stored, URL returned |
| `generate_doc` | Missing required context field | Error halts generation |
| `call_api` | Successful GET | Response mapped to context |
| `call_api` | Successful POST | Resource created, response mapped |
| `call_api` | API returns 500 | Action fails with status code and body |
| `call_api` | API timeout | Action fails after configured timeout |
| `lookup_registry` | Match found | Fields copied, `registry_match_found = true` |
| `lookup_registry` | No match | Action succeeds, `registry_match_found = false` |
| `lookup_registry` | Multiple matches | Most recent entry used |
| `lookup_registry` | Existing non-null fields | Not overwritten by copy |

### Integration Tests — Action Chains

| Chain | Steps | Assertion |
|---|---|---|
| Create then link | `create_record` --> `create_record` with `{{prev.created_record_id}}` in `defaults` | Second record references first |
| Lookup then create | `lookup_registry` --> `create_records` with template conditional on `{{prev.registry_match_found}}` | Correct template selected |
| Full guest confirm | `lookup_registry` --> `create_records` --> `generate_doc` --> `notify` | All 4 actions complete; liaison receives email with contract |
| API then update | `call_api` (FlightAware) --> `update_record` with `{{prev.flight_eta}}` | Record patched with API response data |
| Failure rollback | `create_record` --> `create_record` --> (force fail) | Both created records rolled back |
| 10-action chain | 10 sequential `create_record` actions | All 10 rows created; context passed through entire chain |

### Performance Tests

| Scenario | Target |
|---|---|
| `create_records` with 100-item template | Completes in < 2s |
| 10-action chain with API call | Completes in < 10s (excluding external API latency) |
| 50 concurrent workflow executions | No deadlocks, all complete within 30s |

### Error Handling Tests

| Scenario | Expected behavior |
|---|---|
| Invalid `{{context.*}}` token | Action fails with descriptive error naming the unresolved token |
| Database connection lost mid-chain | Transaction rolled back, workflow marked failed, retry queued |
| External API unreachable | Action fails after timeout, chain halts, partial mutations rolled back |
| Duplicate workflow trigger (idempotency) | Second execution is deduplicated within a 60s window |
