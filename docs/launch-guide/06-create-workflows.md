# Creating Workflows

> Workflows automate actions in response to domain events.
> Trigger -> Condition (optional) -> Action chain.
> 9 action types available. Workflows are stored as config rows, not code.
> Build the critical workflows at launch; add more as operational patterns emerge.

---

## How Workflows Work

A workflow has three parts:

1. **Trigger** -- what domain event fires the workflow (e.g., `guest.status_changed`)
2. **Condition** -- optional filter to narrow when the workflow runs (e.g., "only when status changed to Confirmed")
3. **Actions** -- ordered list of things to do (create records, send notifications, update fields, generate documents)

The workflow engine subscribes to domain events via the event bus. When an event matches a workflow's trigger (and the condition evaluates to true), the engine executes the action chain sequentially.

---

## WorkflowConfig Structure

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'workflow-name',
  'What this workflow does',
  '{ trigger definition }',
  '{ condition expression }',   -- optional, NULL means always
  '[ action1, action2, ... ]',
  true
);
```

---

## Trigger Types

| Trigger Type | Fires When | Example |
|-------------|------------|---------|
| `on_create` | A new record is created | Guest added to the system |
| `on_update` | Any field is updated | Guest record modified |
| `on_delete` | A record is deleted | Guest removed |
| `on_field_change` | A specific field changes value | Guest status changed |
| `scheduled` | Cron schedule fires | Daily overdue prep check |
| `manual` | User manually triggers | Generate itinerary on demand |

### Trigger JSON Format

```json
{
  "eventPattern": "guest.status_changed",
  "conceptKey": "guest",
  "triggerType": "on_field_change",
  "changedFields": ["status"]
}
```

---

## Condition Expressions

Conditions use the universal `ConditionExpression` format. They can be simple field comparisons or complex boolean trees.

### Simple Condition

```json
{
  "type": "field",
  "field": "status",
  "operator": "eq",
  "value": "Confirmed"
}
```

### Compound Conditions

```json
{
  "type": "and",
  "conditions": [
    {"type": "field", "field": "status", "operator": "eq", "value": "Confirmed"},
    {"type": "field", "field": "type", "operator": "eq", "value": "JP"}
  ]
}
```

### Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equal |
| `neq` | Not equal |
| `gt`, `gte` | Greater than, greater than or equal |
| `lt`, `lte` | Less than, less than or equal |
| `contains` | String contains or array includes |
| `in` | Value is in a list |
| `exists` | Field is not null/undefined |

---

## Action Types

The workflow engine supports 9 action types:

| Action Type | Description | Example |
|-------------|-------------|---------|
| `create_record` | Create a new record in a concept | Create prep items for a confirmed guest |
| `update_record` | Update fields on the triggering record or a related record | Set `interpreterRequired` when type is JP |
| `send_notification` | Send email, in-app, or push notification | Notify liaison of confirmed guest |
| `generate_document` | Generate a PDF or document from a template | Generate guest contract |
| `create_task` | Create a task/prep item | Create "Book hotel" prep item |
| `webhook` | Send an HTTP request to an external URL | Notify external ticketing system |
| `log_event` | Write to the event log | Audit trail entry |
| `route_data` | Execute a data route (fan-out) | Push schedule to Guidebook |
| `execute_pipeline` | Trigger a data pipeline | Run the full export pipeline |

### Action JSON Format

```json
{
  "type": "create_record",
  "config": {
    "conceptKey": "prep",
    "records": [
      {"name": "Book Hotel", "guestId": "{{record.id}}", "status": "incomplete", "dueDate": "{{convention.startDate - 30d}}"},
      {"name": "Confirm Dietary", "guestId": "{{record.id}}", "status": "incomplete"},
      {"name": "Generate Contract", "guestId": "{{record.id}}", "status": "incomplete"},
      {"name": "Arrange Transport", "guestId": "{{record.id}}", "status": "incomplete"}
    ]
  }
}
```

Template expressions (`{{...}}`) are evaluated at execution time against the triggering record and the convention config.

---

## Example Workflows

### 1. Guest Confirmed -- Create Prep Items

When a guest's status changes to "Confirmed," automatically create the standard prep checklist.

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Guest Confirmed - Create Prep Items',
  'When a guest is confirmed, create standard prep items',
  '{"eventPattern": "guest.status_changed", "conceptKey": "guest", "triggerType": "on_field_change", "changedFields": ["status"]}',
  '{"type": "field", "field": "status", "operator": "eq", "value": "Confirmed"}',
  '[
    {
      "type": "create_record",
      "config": {
        "conceptKey": "prep",
        "records": [
          {"name": "Book Hotel", "status": "incomplete"},
          {"name": "Confirm Dietary Requirements", "status": "incomplete"},
          {"name": "Generate Contract", "status": "incomplete"},
          {"name": "Arrange Airport Transport", "status": "incomplete"},
          {"name": "Confirm Autograph Session Schedule", "status": "incomplete"},
          {"name": "Brief Liaison on Guest Preferences", "status": "incomplete"}
        ]
      }
    },
    {
      "type": "send_notification",
      "config": {
        "channel": "in_app",
        "recipientRole": "liaison",
        "subject": "Guest Confirmed",
        "body": "{{record.name}} has been confirmed. Prep items have been created."
      }
    }
  ]',
  true
);
```

### 2. JP Guest Created -- Set Interpreter Required

When a JP-type guest is created, automatically set the interpreter requirement.

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'JP Guest - Require Interpreter',
  'Auto-flag interpreter requirement for Japanese-speaking guests',
  '{"eventPattern": "guest.created", "conceptKey": "guest", "triggerType": "on_create"}',
  '{"type": "field", "field": "type", "operator": "eq", "value": "JP"}',
  '[
    {
      "type": "update_record",
      "config": {
        "patch": {"interpreterRequired": true}
      }
    }
  ]',
  true
);
```

### 3. Guest Confirmed -- Generate Contract

When a guest is confirmed, generate a contract document.

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Guest Confirmed - Generate Contract',
  'Auto-generate appearance contract when guest is confirmed',
  '{"eventPattern": "guest.status_changed", "conceptKey": "guest", "triggerType": "on_field_change", "changedFields": ["status"]}',
  '{"type": "field", "field": "status", "operator": "eq", "value": "Confirmed"}',
  '[
    {
      "type": "generate_document",
      "config": {
        "templateName": "appearance_contract",
        "outputFormat": "pdf"
      }
    },
    {
      "type": "send_notification",
      "config": {
        "channel": "email",
        "recipientRole": "liaison",
        "subject": "Contract Generated for {{record.name}}",
        "body": "The appearance contract for {{record.name}} has been generated and is ready for review."
      }
    }
  ]',
  true
);
```

### 4. Prep Item Overdue Check (Scheduled)

Daily check for overdue prep items.

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Daily Overdue Prep Check',
  'Check for overdue prep items every morning at 8 AM',
  '{"eventPattern": "scheduled", "triggerType": "scheduled", "schedule": "0 8 * * *"}',
  NULL,
  '[
    {
      "type": "send_notification",
      "config": {
        "channel": "in_app",
        "recipientRole": "coordinator",
        "subject": "Overdue Prep Items",
        "body": "There are prep items past their due date. Please review the prep tracker."
      }
    }
  ]',
  true
);
```

### 5. Transport Status Update -- Notify Liaison

When a transport booking status changes, notify the assigned liaison.

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Transport Status Update',
  'Notify liaison when transport status changes',
  '{"eventPattern": "transport.status_changed", "conceptKey": "transport", "triggerType": "on_field_change", "changedFields": ["status"]}',
  NULL,
  '[
    {
      "type": "send_notification",
      "config": {
        "channel": "in_app",
        "recipientRole": "liaison",
        "subject": "Transport Update",
        "body": "Transport booking status changed to {{record.status}}."
      }
    }
  ]',
  true
);
```

---

## Data Routes and Fan-Out Patterns

Data routes connect concepts, enabling data to flow from one table to another when events occur. They are configured in the `data_routes` table.

```sql
-- When a guest is confirmed, push schedule data to the Guidebook sync pipeline
INSERT INTO data_routes (name, source_concept, dest_concept, field_mappings, trigger_event, pii_mode, execution_mode)
VALUES (
  'Schedule to Guidebook',
  'schedule',
  'guidebook_sync_log',
  '[
    {"source": "name", "dest": "title"},
    {"source": "startTime", "dest": "start"},
    {"source": "endTime", "dest": "end"},
    {"source": "venue", "dest": "location"}
  ]',
  'schedule.created',
  'strip',
  'async'
);
```

### PII Modes

| Mode | Behavior |
|------|----------|
| `strip` | Remove PII fields before routing |
| `pass` | Pass PII fields through (internal routes only) |
| `hash` | Hash PII fields before routing |

---

## Using the Workflow Builder

Navigate to `/builder/workflow` to create workflows visually:

- `/builder/workflow` -- create a new workflow
- `/builder/workflow/:id` -- edit an existing workflow

The workflow builder provides:
- Visual trigger selection
- Condition builder with boolean logic (AND/OR)
- Action chain builder with drag-and-drop ordering
- Template expression editor with autocomplete

The builder saves via:
- `POST /api/workflow-configs` -- create
- `PUT /api/workflow-configs/:id` -- update

### Workflow Canvas

Navigate to `/canvas/workflow/:id` to visualize a workflow as a flow diagram. The canvas shows:
- Trigger node
- Condition node (with evaluation result)
- Action nodes in execution order
- Edge labels showing data flow

### Dry Run

Test a workflow without executing it by using the dry run endpoint:

```bash
curl -X POST http://localhost:8080/api/workflow-configs/:id/dry-run \
  -H "Content-Type: application/json" \
  -d '{}'
```

The dry run returns:
- `executionPath` -- which nodes would execute
- `conditionResult` -- whether the condition passes

---

## Data Flow Canvas

Navigate to `/canvas/data-flows` to visualize all data routes as a directed graph. The canvas shows:
- Concept nodes
- Data route edges with field mappings
- PII mode indicators
- Trigger event labels

---

## Essential Workflows for Launch

| Workflow | Priority | Why |
|----------|----------|-----|
| Guest Confirmed -- Create Prep Items | Required | Ensures nothing is forgotten when a guest is confirmed |
| JP Guest -- Require Interpreter | Required | Enforces operational constraint automatically |
| Guest Confirmed -- Notify Liaison | Recommended | Keeps liaisons informed |
| Daily Overdue Prep Check | Recommended | Catches missed deadlines |
| Transport Status Update | Optional | Nice-to-have for active con weekend |

---

## Verification

```sql
-- List all workflows
SELECT name, enabled,
  trigger->>'eventPattern' AS trigger_event,
  jsonb_array_length(actions) AS action_count
FROM workflow_configs
WHERE status = 'active'
ORDER BY name;

-- Verify via the API
curl http://localhost:8080/api/workflow-configs | jq '.'
```

---

## Next Step

[07-populate-data.md -- Populating Operational Data](07-populate-data.md)
