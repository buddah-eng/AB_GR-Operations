# Operational Writes

> The app is read-only. ConfigListPage and ConfigDetailPage have zero write operations.
> No edit route, no inline edit, no status change UI, no kanban card-move handler, no form submission feedback.
> This PRD wires every operational write path so users can create, edit, transition, and move records.

---

## Overview

The GR-Ops frontend renders data from Postgres through the config-driven engine, but every page is read-only. The backend has a complete write pipeline (POST, PUT, PATCH endpoints with event emission, audit logging, and workflow triggers), yet the frontend never calls it. This PRD covers every write-path gap identified by the Phase 6 consortium:

- **Edit mode** for ConfigFormPage (create AND edit via the same component)
- **Edit routes** for all concepts (`/guests/:id/edit`, `/staff/:id/edit`, etc.)
- **Status transition UI** on detail pages (dropdown or panel with valid transitions)
- **Kanban card-move** wired to the PATCH API so drag-and-drop persists
- **Status transition validation** enforcing the state machine on the server
- **Form submission feedback** (success toast, error toast, redirect to new record)
- **Concept-aware `navigateToForm`** (not hardcoded to `new-guest`)

Every finding tagged U1, F1, F8, F9, U4, U15, C3, C4, C5, C6, L1, L9 is resolved here.

**Dependencies:** `platform/data-wiring.md` (ontology store must merge properties before forms render correctly), `core/rbac-completion.md` (permissions must be seeded before non-director roles can write)

---

## Full Specification

### 1. Edit Mode for ConfigFormPage

#### Purpose

ConfigFormPage currently handles only creation (POST). It must also handle editing (PUT) via the same component, switching behavior based on whether a record ID is present in the route params.

#### Detail

- When the route contains an `:id` param, ConfigFormPage enters **edit mode**:
  - Fetches the existing record via `GET /api/{conceptKey}s/:id`
  - Populates form fields with existing values
  - Submits via `PUT /api/{conceptKey}s/:id` instead of `POST /api/{conceptKey}s`
- When the route has no `:id`, ConfigFormPage remains in **create mode** (current behavior, POST)
- The form title reflects the mode: "New {Concept}" vs "Edit {Concept}"
- The submit button label reflects the mode: "Create" vs "Save Changes"

#### Acceptance Criteria

- [ ] ConfigFormPage detects `:id` route param and switches to edit mode **(F1, C3)**
- [ ] In edit mode, existing record data is fetched and pre-populates all form fields **(F1)**
- [ ] In edit mode, form submits via PUT to `/api/{conceptKey}s/:id` **(F1)**
- [ ] In create mode, form submits via POST to `/api/{conceptKey}s` (existing behavior preserved) **(U1)**
- [ ] Form title and submit button label change based on mode **(F1)**

---

### 2. Edit Routes for All Concepts

#### Purpose

Only `/guests/:id` has a detail route. No concept has an edit route. Every concept needs both `/:id` (detail) and `/:id/edit` (edit form) routes registered in the Vue router.

#### Detail

- Register routes for every concept that has a form_config seed:
  - `/guests/:id/edit` -> ConfigFormPage (edit mode)
  - `/staff/:id/edit` -> ConfigFormPage (edit mode)
  - `/schedule/:id/edit` -> ConfigFormPage (edit mode)
  - `/prep-tracker/:id/edit` -> ConfigFormPage (edit mode)
  - `/pairings/:id/edit` -> ConfigFormPage (edit mode)
- Each edit route passes the concept key and record ID as props/params to ConfigFormPage
- Detail pages (covered in `ui/operational-ux-gaps.md`) include an "Edit" button that navigates to the edit route
- The edit route is guarded by RBAC: only roles with `canEdit` permission see the button and can access the route

#### Acceptance Criteria

- [ ] Edit routes exist for guest, staff, schedule_event, prep_item, and pairings **(F1, C3)**
- [ ] Each edit route resolves to ConfigFormPage with the correct concept key and record ID **(F1)**
- [ ] Edit button on detail pages navigates to the edit route **(L1)**
- [ ] Edit button is hidden for roles without `canEdit` permission **(L1)**

---

### 3. Status Transition UI on Detail Page

#### Purpose

ConfigDetailPage is fully read-only. Users need a UI affordance to change a record's status -- either a dropdown select or a transition panel showing only valid next states.

#### Detail

- On ConfigDetailPage, if the concept has a `status` property, render a **status transition panel**:
  - Shows the current status as a styled badge
  - Displays buttons for each valid next status (derived from the state machine or workflow config)
  - Clicking a transition button calls `PATCH /api/{conceptKey}s/:id` with `{ status: newStatus }`
  - On success: update the displayed status, show a success toast, emit a domain event
  - On failure: show an error toast with the validation message (e.g., "Cannot transition from draft to arrived")
- The transition panel respects RBAC: only roles with `canEdit` on the concept see the panel
- If no valid transitions exist from the current state (e.g., `departed`), the panel shows the status badge with no action buttons

#### Acceptance Criteria

- [ ] ConfigDetailPage renders a status transition panel when the concept has a status property **(L1, C5)**
- [ ] Only valid next statuses are shown as transition options **(L9)**
- [ ] Clicking a transition button sends PATCH to the API **(L1, C5)**
- [ ] Success updates the UI and shows a toast **(U15)**
- [ ] Failure shows an error toast with the server's validation message **(F8)**
- [ ] The panel is hidden for roles without `canEdit` permission **(L1)**

---

### 4. Kanban Card-Move Wired to PATCH API

#### Purpose

ViewKanban emits a `card-move` event when a user drags a card between columns, but ConfigListPage does not handle it. The move is visual only and resets on refresh.

#### Detail

- ConfigListPage listens for the `card-move` event from ViewKanban
- On `card-move`, extract the record ID, the source column (old status), and the target column (new status)
- Call `PATCH /api/{conceptKey}s/:id` with `{ status: newStatus }`
- On success: the card stays in the new column; show a brief success toast
- On failure: revert the card to its original column; show an error toast with the reason
- The PATCH call goes through the same status transition validation as the detail page (Section 3)

#### Acceptance Criteria

- [ ] ConfigListPage handles the `card-move` event from ViewKanban **(C4, U1)**
- [ ] Card move sends PATCH with the new status to the backend **(C4)**
- [ ] On success, the card persists in the new column across page refresh **(C4)**
- [ ] On failure, the card reverts to its original column and an error toast is shown **(C4, F8)**
- [ ] Kanban card-move respects status transition validation **(L9)**

---

### 5. Status Transition Validation (State Machine Enforcement)

#### Purpose

The PUT/PATCH endpoint currently accepts ANY status value. The state machine defined in the guest lifecycle PRD (draft -> invited -> confirmed -> ...) is not enforced. Invalid transitions must be rejected server-side.

#### Detail

- Add a `validateStatusTransition(conceptKey, currentStatus, newStatus)` function in the CRUD handler
- The valid transitions are loaded from `workflow_configs` (once the table/column mismatch in `platform/data-wiring.md` is fixed) or from a concept-level `status_transitions` metadata field in the ontology
- If the transition is invalid, return `400 Bad Request` with body `{ success: false, error: "Invalid transition from '{current}' to '{new}'. Valid next states: [...]" }`
- If the transition is valid, proceed with the update and emit the domain event
- The validation applies to both direct PUT/PATCH calls and kanban card-moves

#### Acceptance Criteria

- [ ] Server rejects invalid status transitions with 400 and a descriptive error message **(L9)**
- [ ] Valid transitions are loaded from workflow config or ontology metadata, not hardcoded **(L9)**
- [ ] The validation applies to all write paths (PUT, PATCH, kanban card-move) **(L9)**
- [ ] Each valid transition is logged as a domain event with previous and new status **(L9)**

---

### 6. Form Submission Captures Created ID and Redirects to Detail

#### Purpose

After creating a record, ConfigFormPage navigates to the list page and discards the API response containing the new record's ID. The user cannot find their just-created record without searching.

#### Detail

- After a successful `POST /api/{conceptKey}s`, capture the response body which contains `{ success: true, data: { id: "uuid", ... } }`
- Extract `data.id` from the response
- Navigate to the detail page: `/${conceptKey}s/${id}` instead of `/${conceptKey}s`
- This depends on detail routes existing for all concepts (covered in `ui/operational-ux-gaps.md`)

#### Acceptance Criteria

- [ ] Form submission captures the created record ID from the API response **(F9, H8)**
- [ ] After successful creation, the user is redirected to the new record's detail page **(F9, H8)**
- [ ] The API response `data.id` is used for the redirect, not a guessed or constructed ID **(F9, H8)**

---

### 7. Form Submission Error and Success Toasts

#### Purpose

ConfigFormPage shows no feedback on submission success or failure. Users get no confirmation that their action worked, and errors are swallowed by `console.error`.

#### Detail

- On successful form submission (create or edit):
  - Show a PrimeVue toast: "Guest created successfully" / "Guest updated successfully"
  - The toast auto-dismisses after 3 seconds
- On failed form submission:
  - Show a PrimeVue toast with severity `error`: "Failed to create guest: {error message}"
  - The error message comes from the API response `error` field
  - The toast persists until manually dismissed (sticky)
- Remove the bare `console.error` on line 63 of ConfigFormPage; replace with the toast + structured error logging

#### Acceptance Criteria

- [ ] Successful creation shows a success toast with the concept name **(U15, F8)**
- [ ] Successful edit shows a success toast **(U15)**
- [ ] Failed submission shows an error toast with the server's error message **(F8)**
- [ ] The `console.error` on ConfigFormPage line 63 is replaced with toast-based feedback **(F8)**

---

### 8. Concept-Aware navigateToForm

#### Purpose

`navigateToForm` in ConfigListPage is hardcoded to `{ name: 'new-guest' }`. On the staff list page, clicking "New" creates a guest. On the schedule page, "New" creates a guest. This is wrong for every concept except guest.

#### Detail

- Replace the hardcoded `router.push({ name: 'new-guest' })` with concept-aware routing:
  - `router.push({ name: 'new-{conceptKey}', params: {} })` or
  - `router.push('/${conceptKey}s/new')` using the current page's concept key
- The concept key is already available in ConfigListPage via the route meta or ontology context
- Register a generic `new-{concept}` route pattern or individual named routes for each concept

#### Acceptance Criteria

- [ ] `navigateToForm` uses the current page's concept key, not a hardcoded `'new-guest'` **(U4)**
- [ ] Clicking "New" on the staff list navigates to a staff creation form **(U4)**
- [ ] Clicking "New" on the schedule list navigates to a schedule event creation form **(U4)**
- [ ] Clicking "New" on any concept list navigates to the correct creation form for that concept **(U4)**

---

## Finding Coverage Matrix

| Finding ID | Section | Description |
|------------|---------|-------------|
| U1 | 1, 4 | App is fully read-only |
| F1, C3 | 1, 2 | No edit route or edit mode in ConfigFormPage |
| L1, C5 | 3 | No status change UI on detail page |
| C4 | 4 | Kanban card-move not wired to API |
| L9 | 3, 4, 5 | No status transition validation |
| F8 | 3, 4, 7 | ConfigFormPage error handling shows nothing |
| F9, H8 | 6 | ConfigFormPage always navigates to list after creation |
| U4 | 8 | navigateToForm hardcoded to new-guest |
| U15 | 3, 7 | No feedback toast on successful creation |
| C6 | 2 | Fix row-click navigation (edit route registration) |

---

## Test Plan

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | Navigate to `/guests/:id/edit` | ConfigFormPage loads in edit mode with pre-populated fields |
| T-02 | Submit edit form | PUT request sent; success toast shown; detail page updated |
| T-03 | Submit create form | POST request sent; success toast shown; redirect to detail page with new ID |
| T-04 | Submit form with server validation error | Error toast shown with server message; form stays open |
| T-05 | Click status transition button on detail page | PATCH sent; status updates; toast shown |
| T-06 | Attempt invalid status transition | 400 returned; error toast shown; status unchanged |
| T-07 | Drag kanban card to new column | PATCH sent; card stays in new column on refresh |
| T-08 | Drag kanban card to invalid status | Card reverts; error toast shown |
| T-09 | Click "New" on staff list page | Navigates to staff creation form, not guest |
| T-10 | Click "New" on schedule list page | Navigates to schedule event creation form |
| T-11 | Role without canEdit views detail page | No edit button, no status transition panel |
| T-12 | ConfigFormPage in create mode (no :id) | POST behavior unchanged from current |
