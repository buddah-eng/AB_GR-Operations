# Data Wiring

> Infrastructure exists but isn't connected. The ontology store discards properties. The workflow engine queries the wrong table with the wrong column names. Validation rules exist in the backend but never reach the frontend.
> This PRD fixes every data-wiring gap: ontology merge, type alignment, field adaptation, validation pipeline, workflow table/column fix, notification delivery, and seed data completion.

---

## Overview

Every agent in the Phase 6 consortium independently identified the same root cause: **the infrastructure exists but the wiring is missing.** The Express backend has a full write pipeline, workflow engine, RBAC system, event bus, and audit trail. The frontend has builders, view renderers, and a form engine. But the ontology store discards the properties map, the workflow engine queries a nonexistent table, validation rules are defined but never flow to forms, and form field seeds are strings where the adapter expects objects.

This PRD connects every data-wiring gap so that data flows correctly from Postgres through the API to the frontend and back. It covers findings C1, C2, F2, F3, F4, F5, F6, L2, L5, L6, H2, H5, S1.

**Dependencies:** None. This PRD has no upstream dependencies -- it IS the upstream dependency for `modules/guest-relations/operational-writes.md` and `core/rbac-completion.md`.

---

## Full Specification

### 1. Ontology Store Must Merge Properties Map into Concepts

#### Purpose

The backend `serializeOntology()` returns both `concepts` and `properties` as separate maps. The frontend ontology store sets `concepts.value = data.concepts` but never merges `data.properties`. All downstream property resolution (labels, types, validation) returns `undefined`.

#### Detail

- In `web/src/stores/ontology.ts`, the `loadOntology` action must:
  1. Receive `data.concepts` (the concept map)
  2. Receive `data.properties` (the properties map, keyed by concept key)
  3. Merge each concept's properties: `concept.properties = data.properties[concept.key]`
  4. Store the merged result in the reactive `concepts` ref
- The merge must be immutable: create new concept objects with properties attached, do not mutate the API response
- After merge, `getPropertyByKey(conceptKey, propertyKey)` must return the full property object including label, type, and validationRules

#### Acceptance Criteria

- [ ] Ontology store merges `data.properties` into each concept's properties map **(F2, C1)**
- [ ] After loading, `getPropertyByKey('guest', 'name')` returns a property object with `label`, `type`, and `validationRules` **(F2, C1)**
- [ ] The merge creates new objects (immutable pattern), does not mutate the API response **(F2)**
- [ ] Property resolution no longer returns `undefined` for seeded properties **(F2, C1)**

---

### 2. Ontology API Type Alignment (Object vs Array)

#### Purpose

`serializeOntology()` returns `concepts` as an object keyed by concept key (`{ guest: {...}, staff: {...} }`). The frontend `OntologyData` type declares `concepts: OntologyConcept[]` (an array). This type violation causes `getConceptByKey` to iterate incorrectly when the value is actually an object.

#### Detail

- **Option A (preferred):** Change the frontend `OntologyData` type to match the backend:
  - `concepts: Record<string, OntologyConcept>` instead of `OntologyConcept[]`
  - Update `getConceptByKey` to use direct key lookup (`concepts[key]`) instead of array iteration
  - Update any other code that iterates `concepts` as an array (use `Object.values(concepts)`)
- **Option B:** Change the backend serializer to return an array:
  - `serializeOntology()` returns `concepts: Object.values(conceptMap)`
  - Frontend types stay as-is
- Option A is preferred because key-based lookup is O(1) vs O(n) array search

#### Acceptance Criteria

- [ ] Frontend `OntologyData` type matches the actual shape returned by the backend **(F4)**
- [ ] `getConceptByKey` performs correct lookup regardless of whether concepts is an object or array **(F4)**
- [ ] No TypeScript type errors in the ontology store after the fix **(F4)**
- [ ] Iterating all concepts works correctly (e.g., for navigation menu rendering) **(F4)**

---

### 3. Wizard Step Fields String-to-Object Adaptation

#### Purpose

Seed migration wizard steps define fields as string arrays (`["name", "type", "company"]`). The `adaptFormSteps()` function calls `adaptFormFields()` which expects objects (`[{propertyKey: "name"}]`). Passing strings produces `FormFieldConfig` objects where `key` is `undefined`.

#### Detail

- In the form adapter (`adaptFormFields` or `adaptFormSteps`), detect when a field entry is a string:
  ```typescript
  const normalizedFields = fields.map(f =>
    typeof f === 'string' ? { propertyKey: f } : f
  )
  ```
- After normalization, the existing adapter logic works correctly: `f.key ?? f.propertyKey ?? f.property_key` resolves to the string value
- Update the TypeScript types to accept `(string | Record<string, unknown>)[]` for the fields parameter
- Also update seed data to include `required: true` flags where appropriate (see Section 6)

#### Acceptance Criteria

- [ ] `adaptFormFields` handles string field entries by converting them to `{ propertyKey: string }` objects **(F5, H5)**
- [ ] After adaptation, every `FormFieldConfig` has a defined `key` property **(F5)**
- [ ] Mixed arrays (some strings, some objects) are handled correctly **(F5)**
- [ ] TypeScript types accept both string and object entries **(F5)**

---

### 4. Frontend OntologyProperty Type Needs validationRules Field

#### Purpose

The backend `Property` type has `validationRules?: ValidationRules` with `minLength`, `maxLength`, `min`, `max`, `pattern`. The frontend `OntologyProperty` type has no such field. Even after fixing the ontology store to merge properties (Section 1), validation rules won't flow through to the form schema builder.

#### Detail

- Add `validationRules` to the frontend `OntologyProperty` type in `web/src/types/index.ts`:
  ```typescript
  interface OntologyProperty {
    // ...existing fields...
    validationRules?: {
      minLength?: number
      maxLength?: number
      min?: number
      max?: number
      pattern?: string
    }
  }
  ```
- This type must match the backend `ValidationRules` interface in `functions/src/ontology/types.ts`

#### Acceptance Criteria

- [ ] Frontend `OntologyProperty` type includes `validationRules` field **(F6)**
- [ ] The `validationRules` type matches the backend `ValidationRules` interface **(F6)**
- [ ] TypeScript compiles without errors after the type addition **(F6)**
- [ ] Property objects loaded from the API include `validationRules` when present **(F6)**

---

### 5. buildValidation Must Use validationRules

#### Purpose

The `buildValidation` function in the form schema builder ignores `validationRules` from the ontology property. It only checks the `required` flag. Validation rules like `minLength`, `maxLength`, and `pattern` are defined in the ontology but never applied to form fields.

#### Detail

- In the form schema builder (likely `web/src/utils/formSchemaBuilder.ts` or similar):
  - After checking `required`, also check `property.validationRules`
  - If `validationRules.minLength` is defined, add a min-length validator
  - If `validationRules.maxLength` is defined, add a max-length validator
  - If `validationRules.min` is defined (for numeric fields), add a min-value validator
  - If `validationRules.max` is defined, add a max-value validator
  - If `validationRules.pattern` is defined, add a regex pattern validator
- The validation output format depends on the form library (FormKit uses `validation` prop strings like `"required|length:2,100"`)
- If using FormKit: build the validation string by appending rules
- If using a schema-based approach: build a Zod schema from the validation rules

#### Acceptance Criteria

- [ ] `buildValidation` reads `validationRules` from the ontology property **(F3, S1)**
- [ ] `minLength` rule produces a min-length form validator **(F3, S1)**
- [ ] `maxLength` rule produces a max-length form validator **(F3, S1)**
- [ ] `pattern` rule produces a regex pattern form validator **(F3, S1)**
- [ ] `min`/`max` rules produce numeric range validators **(F3, S1)**
- [ ] Fields without `validationRules` continue to work (no regression) **(F3)**

---

### 6. Form Config Seed Fields Need Required Flags

#### Purpose

Seed form configs define fields but do not include `required: true` for mandatory fields. The form renders all fields as optional, even ones like `name` and `type` that are NOT NULL in the Postgres schema.

#### Detail

- Update the seed migration that creates form_configs to include `required: true` on fields that map to NOT NULL columns:
  - Guest: `name` (required), `type` (required), `department` (required)
  - Staff: `name` (required), `role_key` (required)
  - Schedule event: `title` (required), `start_time` (required)
  - Prep item: `title` (required), `guest_id` (required)
- The `required` flag is read by `buildValidation` (Section 5) and by `adaptFormFields` to produce `FormFieldConfig.required = true`

#### Acceptance Criteria

- [ ] Seed form configs include `required: true` on fields that map to NOT NULL database columns **(H5)**
- [ ] Guest form has `name`, `type`, and `department` marked as required **(H5)**
- [ ] The `required` flag flows through `adaptFormFields` into the form renderer **(H5)**
- [ ] Required fields show validation errors when submitted empty **(H5)**

---

### 7. Workflow Table Name AND Column Name Mismatch Fix

#### Purpose

The workflow engine queries the `workflows` table with columns `trigger_config`, `condition_config`, `actions_config`. The actual migration creates the `workflow_configs` table with columns `trigger`, `condition`, `actions`. This is a double mismatch: wrong table AND wrong column names.

#### Detail

Two fix strategies (choose one):

**Option A (rename in engine):** Update the workflow engine's SQL queries to use `workflow_configs` table name and `trigger`, `condition`, `actions` column names.

**Option B (create a view):** Create a Postgres VIEW named `workflows` that selects from `workflow_configs` and aliases the columns:
```sql
CREATE VIEW workflows AS
SELECT id, concept_key, name, description,
       trigger AS trigger_config,
       condition AS condition_config,
       actions AS actions_config,
       enabled, version, created_at, updated_at
FROM workflow_configs;
```

Option A is preferred (less indirection). Also seed the initial workflow configs:
- `guest-confirmed`: trigger on `guest.status_changed` where `newStatus = 'confirmed'`; actions: generate contract, create transport booking, notify liaison
- `guest-arrived`: trigger on `guest.status_changed` where `newStatus = 'arrived'`; actions: notify liaison, activate itinerary
- `prep-overdue`: trigger on schedule (daily check); condition: `prep_item.due_date < NOW() AND status != 'completed'`; action: set `overdue` flag, notify coordinator

#### Acceptance Criteria

- [ ] Workflow engine queries the correct table name (`workflow_configs`) **(L2, C2)**
- [ ] Workflow engine queries the correct column names (`trigger`, `condition`, `actions`) **(L5)**
- [ ] At least two workflow configs are seeded: guest-confirmed and guest-arrived **(L3, H2)**
- [ ] A prep-overdue workflow is seeded for overdue detection **(L3, H2, U14)**
- [ ] Workflow engine successfully loads and executes seeded workflows **(L2, L5)**
- [ ] Domain events fired by status transitions are caught by the workflow engine **(L2)**

---

### 8. Notification Handler Delivery

#### Purpose

`registerNotificationHandler()` is registered but the notification service only emits domain events -- it doesn't actually deliver notifications. No email provider is configured, no in-app notification rendering exists.

#### Detail

**Note:** This section defines a minimal Phase 6.5 notification implementation (in-app only, simple `notifications` table). The full notification system -- including multi-channel delivery, notification preferences, digest batching, and escalation rules -- is defined in `data-infrastructure/notifications.md`. That PRD is the authoritative source for the complete notification architecture. This section provides just enough wiring to unblock workflow actions that fire notifications.

- Implement at minimum **in-app notification delivery**:
  - When a notification action fires (from a workflow), write a row to a `notifications` table: `{ id, user_id, title, body, read, created_at }`
  - The frontend can poll `GET /api/notifications?read=false` or receive via SSE
  - Notifications render in a bell icon dropdown in the app header
- **Defer email/Slack delivery** to Phase 7:
  - Document the extension points for future email provider integration (SendGrid, Resend, etc.)
  - The notification service architecture should support multiple delivery channels but only in-app is implemented now

#### Acceptance Criteria

- [ ] Notification actions from workflows write to a `notifications` table **(L6)**
- [ ] `GET /api/notifications` endpoint returns notifications for the authenticated user **(L6)**
- [ ] In-app notification UI renders unread notifications in a bell icon dropdown **(L6)**
- [ ] Email/Slack delivery is documented as a Phase 7 extension point, not implemented now **(L6)**

---

### 9. Seed ontology_properties with Labels, Types, and Validation

#### Purpose

The ontology properties table must be seeded with complete property definitions for all concepts. Without this seed data, property resolution returns empty results even after the ontology store merge fix (Section 1).

#### Detail

Seed `ontology_properties` for every concept with at minimum:
- **Guest:** name (string, required, maxLength:200), type (enum: JP/NA/other, required), department (string, required), company (string), bio (text, maxLength:2000), status (enum, required), email (string, pattern: email), arrival_date (date), departure_date (date)
- **Staff:** name (string, required), role_key (string, required), email (string, pattern: email), department (string), phone (string)
- **Schedule event:** title (string, required), start_time (datetime, required), end_time (datetime), venue_id (uuid), description (text)
- **Prep item:** title (string, required), guest_id (uuid, required), status (enum: pending/in_progress/completed/overdue), due_date (date), assigned_to (uuid)
- **Pairings:** guest_id (uuid, required), staff_id (uuid, required), role (string, required)

Each property includes: `key`, `label`, `type`, `required`, `validationRules` (where applicable).

#### Acceptance Criteria

- [ ] ontology_properties are seeded for guest, staff, schedule_event, prep_item, and pairings concepts **(C1, F2)**
- [ ] Each seeded property includes `label` and `type` at minimum **(C1)**
- [ ] Properties that map to NOT NULL columns have `required: true` **(H5)**
- [ ] String properties with length constraints have `validationRules.minLength`/`maxLength` **(F3, F6)**
- [ ] Email properties have `validationRules.pattern` set to an email regex **(F3)**
- [ ] The seeded properties are loadable via the ontology API and mergeable by the ontology store **(F2, C1)**

---

## Finding Coverage Matrix

| Finding ID | Section | Description |
|------------|---------|-------------|
| F2, C1 | 1, 9 | Ontology store discards properties map |
| F4 | 2 | Ontology API returns object, frontend expects array |
| F5, H5 | 3, 6 | Wizard step fields are strings, adapter expects objects |
| F6 | 4 | Frontend OntologyProperty type missing validationRules |
| F3, S1 | 5 | buildValidation ignores validationRules |
| H5 | 6 | Form seed fields need required flags |
| L2, C2 | 7 | Workflow table name mismatch |
| L5 | 7 | Workflow column name mismatch (double mismatch) |
| L3, H2 | 7 | Zero workflow configs seeded |
| L6 | 8 | Notification handler doesn't actually deliver |
| U14 | 7 | No overdue concept (needs workflow seed + badge) |

---

## Test Plan

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | Load ontology, check property merge | `getPropertyByKey('guest', 'name')` returns `{ label: 'Name', type: 'string', ... }` |
| T-02 | Frontend OntologyData type check | TypeScript compiles with `Record<string, OntologyConcept>` concepts type |
| T-03 | adaptFormFields with string array `["name", "type"]` | Returns `[{ key: 'name', ... }, { key: 'type', ... }]` with defined keys |
| T-04 | adaptFormFields with mixed array | Both string and object entries produce valid FormFieldConfig objects |
| T-05 | buildValidation with maxLength:200 | Form field has max-length validator |
| T-06 | buildValidation with pattern (email) | Form field has regex pattern validator |
| T-07 | Workflow engine loads guest-confirmed workflow | Workflow loads without error; trigger matches status_changed events |
| T-08 | Fire guest.status_changed to 'confirmed' | Workflow catches event; notification written to notifications table |
| T-09 | GET /api/notifications for authenticated user | Returns unread notifications |
| T-10 | Seed check: all concepts have properties | Query ontology_properties; all 5 concepts have entries |
| T-11 | Submit guest form with empty required field | Validation error shown (not a silent 500) |
| T-12 | Workflow engine query uses correct table and columns | No SQL error; workflows load from workflow_configs |
