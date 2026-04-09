# Canvas-to-Config Bridge

> Bidirectional binding between canvas state and ontology/workflow/routing configs. Config changes re-render
> the canvas. Canvas edits mutate configs through the same APIs, CI/QA pipeline, and audit trail as the builder.
> Optimistic updates with server-wins conflict resolution. Undo/redo backed by the versioning service. The bridge
> is the critical piece that makes canvas edits real -- without it, the canvas is a read-only diagram.

---

## Overview

The canvas and the builder are parallel interfaces that read and write the same underlying data: ontology concepts, relationships, workflow configs, data routes, and RBAC permissions. The canvas-to-config bridge is the translation layer between spatial canvas operations (add node, draw edge, move node, delete element) and structured config mutations (INSERT, UPDATE, DELETE on Postgres tables via the platform's API layer).

The bridge has two directions:

1. **Config -> Canvas:** When configs change (via builder, API, import, or another canvas user), the canvas re-renders to reflect the new state. Changes arrive via SSE (`data-infrastructure/real-time.md`) and are merged into the canvas's local state.

2. **Canvas -> Config:** When a user performs a spatial action on the canvas (drag a concept, draw an edge, drop a transform), the bridge translates that action into one or more API calls that create or update config records. These calls go through the full write pipeline: auth, RBAC, validation, CI/QA, audit, and event emission.

The bridge never writes directly to Postgres. All mutations flow through the existing API layer (`api/domain-crud.md`), ensuring that canvas edits are indistinguishable from builder edits in the audit log, event stream, and CI/QA pipeline.

**Dependencies:**
- `canvas/canvas-engine.md` -- canvas interaction model, action dispatch
- `canvas/canvas-rbac.md` -- permission checks before config mutations
- `core/ontology-ci-qa.md` -- CI/QA pipeline for change validation
- `core/audit-system.md` -- audit trail via `withAuditContext`, `logAuditClaim`
- `core/event-bus.md` -- domain events emitted by config mutations
- `core/rbac-engine.md` -- permission enforcement on API calls
- `data-infrastructure/real-time.md` -- SSE for incoming config changes
- `data/versioning-backups.md` -- versioning service for undo/rollback
- `api/domain-crud.md` -- API layer for all config mutations
- `data-infrastructure/data-routing.md` -- route config mutations
- `data-infrastructure/data-transforms.md` -- transform config mutations

---

## 1. Config to Canvas Direction

### Purpose

Define how config changes from any source (builder, API, import, other canvas users) propagate to connected canvas clients for re-rendering.

### Detail

**1.1 Event Bus Subscriber**

The bridge registers an event bus subscriber at **priority 960** (after the real-time SSE subscriber at 950, after core handlers like audit at 50 and route executor at 200, but before low-priority handlers). This subscriber watches for config mutation events:

| Event Pattern | Config Change |
|--------------|---------------|
| `ontology_concept.created` | New concept added |
| `ontology_concept.updated` | Concept modified (renamed, scope changed) |
| `ontology_concept.deleted` | Concept deprecated/archived |
| `ontology_relationship.created` | New relationship between concepts |
| `ontology_relationship.updated` | Relationship modified |
| `ontology_relationship.deleted` | Relationship removed |
| `ontology_property.created` | New property added to a concept |
| `ontology_property.updated` | Property modified (type, label, encrypted flag) |
| `ontology_property.deleted` | Property deprecated |
| `workflow_config.created` | New workflow config |
| `workflow_config.updated` | Workflow config modified |
| `workflow_config.deleted` | Workflow config disabled |
| `data_route.created` | New data route |
| `data_route.updated` | Route modified (field mappings, transform, PII mode) |
| `data_route.deleted` | Route disabled |
| `data_transform.created` | New transform definition |
| `data_transform.updated` | Transform modified |
| `permission.updated` | RBAC permission changed (affects canvas visibility) |

**1.2 SSE Push to Canvas Clients**

When the subscriber receives a config mutation event, it pushes an update to connected canvas clients via the SSE endpoint (`GET /api/stream`). The SSE payload includes:

```ts
interface CanvasConfigUpdate {
  readonly type: 'config_change'
  readonly configType: 'concept' | 'relationship' | 'property' | 'workflow' | 'route' | 'transform' | 'permission'
  readonly action: 'created' | 'updated' | 'deleted'
  readonly recordId: string
  readonly recordKey: string          // concept_key, route name, etc.
  readonly changedFields: ReadonlyArray<string>
  readonly newValues: Record<string, unknown>
  readonly changeSetId: string        // links to audit trail
  readonly actorId: string            // who made the change
  readonly timestamp: string
}
```

Canvas clients subscribe to `concepts=ontology_concept,ontology_relationship,ontology_property,workflow_config,data_route,data_transform,permission` on the SSE endpoint. RBAC filtering on the SSE endpoint ensures users only receive updates for configs they have permission to view.

**1.3 Canvas-Side Merge**

When the canvas client receives a `CanvasConfigUpdate` via SSE:

1. **Check for local conflict:** Does the update affect an element the user is currently editing? (See section 4.)
2. **If no conflict:** Apply the update to the canvas state:
   - `created`: Add a new node or edge to the canvas graph. Run layout algorithm for positioning.
   - `updated`: Update the affected node or edge properties (label, fields, connections). Re-render the element.
   - `deleted`: Remove the node or edge from the canvas. Re-run layout to close gaps.
3. **If conflict:** Apply conflict resolution (section 4).
4. **Re-render:** The canvas engine re-renders only the affected elements, not the entire canvas.

### Acceptance Criteria

- [ ] Event bus subscriber at priority 960 receives all config mutation events
- [ ] SSE pushes `CanvasConfigUpdate` payloads to connected canvas clients
- [ ] Canvas client receives updates for all config types (concepts, relationships, properties, routes, transforms)
- [ ] Created elements appear on the canvas without page refresh
- [ ] Updated elements re-render with new values without page refresh
- [ ] Deleted elements are removed from the canvas without page refresh
- [ ] RBAC filtering on SSE prevents users from receiving updates they cannot view
- [ ] Only affected elements re-render, not the entire canvas

---

## 2. Canvas to Config Direction

### Purpose

Define how canvas actions (spatial interactions) translate into config mutations via the platform's API layer.

### Detail

Every canvas edit action maps to one or more API calls. The bridge translates the spatial action into the correct API request, sends it through the standard write pipeline, and handles the response.

**2.1 Action-to-Mutation Mapping**

| Canvas Action | API Call | Config Table | Notes |
|--------------|----------|--------------|-------|
| Add concept node | `POST /api/ontology/concepts` | `ontology_concepts` | Opens concept creation form in side panel |
| Rename concept node | `PUT /api/ontology/concepts/:id` | `ontology_concepts` | Inline rename on double-click |
| Delete concept node | `POST /api/ci-qa/change-request` | `ontology_concepts` | Deprecate via CI/QA pipeline, never physical delete |
| Draw relationship edge | `POST /api/ontology/relationships` | `ontology_relationships` | Creates relationship between source and target concepts |
| Delete relationship edge | `POST /api/ci-qa/change-request` | `ontology_relationships` | Deprecate via CI/QA pipeline |
| Add workflow action | `PUT /api/workflow-configs/:id` | `workflow_configs` | Appends to `actions` array in workflow config |
| Draw data route | `POST /api/data-routes` | `data_routes` | Opens route creation wizard (see data-flow-canvas.md) |
| Map fields | `PUT /api/data-routes/:id` | `data_routes` | Updates `field_mappings` JSONB |
| Add transform to route | `PUT /api/data-routes/:id` | `data_routes` | Sets `transform_id` or updates `inline_transforms` |
| Delete route | `PUT /api/data-routes/:id` | `data_routes` | Sets `enabled = false` (soft-disable) |
| Add property to concept | `POST /api/ontology/properties` | `ontology_properties` | Opens property creation form in side panel |
| Set PII classification | `PUT /api/ontology/properties/:id` | `ontology_properties` | Updates `encrypted` flag |

**2.2 Bridge Execution Flow**

For every canvas action:

```
Canvas Action (user interaction)
  |
  v
[1] RBAC Pre-check (canvas-rbac.md)
    - Does the user have permission for this action?
    - If no: show "Insufficient permissions" message, cancel action
  |
  v
[2] Optimistic Update (local)
    - Apply the change to the local canvas state immediately
    - Show the new node/edge/modification to the user
    - Mark the element as "pending" (subtle indicator)
  |
  v
[3] API Call (via bridge)
    - Translate canvas action to API request
    - Include AuditContext: { actor_id, actor_type: 'human', session_id, change_set }
    - Send request through the standard write pipeline
  |
  v
[4a] Success Response
    - Remove "pending" indicator from element
    - Update element with server-assigned values (ID, version, timestamps)
    - Push action onto undo stack
  |
  v
[4b] Failure Response
    - Roll back the optimistic update
    - Remove the element from canvas state
    - Show error toast with validation message
    - If CI/QA review required: show "Review Required" indicator instead of rollback
```

**2.3 API Request Construction**

The bridge constructs API requests using the same payload format as the builder. Example for creating a concept:

```ts
interface BridgeCreateConceptRequest {
  readonly key: string                 // auto-generated from user-provided name
  readonly name: string                // user-provided via inline edit or side panel
  readonly description: string         // optional, from side panel
  readonly department: string          // from user's current department context
  readonly scope: 'department' | 'org' // determined by user's role
}

// Bridge translates to:
// POST /api/ontology/concepts
// Authorization: Bearer <user-token>
// Body: { key, name, description, department, scope }
```

The bridge never constructs raw SQL. All mutations go through the API layer, which handles validation, RBAC enforcement, audit logging, and event emission.

### Acceptance Criteria

- [ ] Every canvas action maps to a documented API call
- [ ] Canvas actions never write directly to Postgres (always through API layer)
- [ ] RBAC pre-check runs before the optimistic update
- [ ] Optimistic updates apply immediately for responsive UX
- [ ] Failed API calls roll back the optimistic update
- [ ] Successful API calls update elements with server-assigned values
- [ ] Bridge includes `AuditContext` in every API request
- [ ] Delete actions create deprecation change requests, never physical deletes
- [ ] API payloads match the same format used by the builder

---

## 3. CI/QA Integration

### Purpose

Ensure canvas edits go through the same CI/QA pipeline as builder edits, with visual feedback on the canvas for validation results and review status.

### Detail

**3.1 Risk Assessment for Canvas Edits**

The CI/QA pipeline (`core/ontology-ci-qa.md`) classifies changes by risk level. Canvas edits receive the same classification:

| Canvas Action | Risk Level | Pipeline Behavior |
|--------------|------------|-------------------|
| Add concept (department-scoped) | Low | Auto-apply after validation |
| Add property (non-required, department-scoped) | Low | Auto-apply after validation |
| Draw relationship (within department) | Low | Auto-apply after validation |
| Create data route (same department) | Low | Auto-apply after validation |
| Map fields on existing route | Low | Auto-apply after validation |
| Rename concept | Medium | Director self-approve with impact report |
| Modify property type | High | Admin required, existing records checked |
| Delete/deprecate concept | High | Admin required, cross-system validation |
| Create cross-department route | High | Admin approval required (route goes to `pending` status) |
| Modify RBAC permissions | High | Admin required |
| Delete/deprecate property used by forms/views/workflows | High | Admin required, impact report shown |

**3.2 Canvas Visual Feedback for CI/QA Status**

After a canvas edit enters the CI/QA pipeline, the affected element shows a status indicator:

| CI/QA Status | Visual Indicator | User Action |
|-------------|-----------------|-------------|
| Validating | Spinning loader on element | Wait |
| Validation passed, auto-applied | Green checkmark (fades after 3 seconds) | None needed |
| Validation passed, review required | Yellow warning icon | Click to view change request details |
| Validation failed | Red X icon | Click to see validation errors |
| Review pending | Orange clock icon | Waiting for admin approval |
| Review approved | Green checkmark (fades after 3 seconds) | Change applied |
| Review rejected | Red X with "Rejected" label | Click to see rejection reason |

**3.3 Pending Review Elements**

When a canvas edit requires review (high-risk change), the element remains on the canvas in a "pending" state:
- The element is rendered with a dashed border and reduced opacity.
- A tooltip shows: "Pending review. Submitted by {user} at {time}."
- The element is not yet applied to the config -- it exists only as a change request.
- Other users see the pending element if they have access to the review queue.
- If the review is rejected, the pending element is removed from the canvas.

**3.4 Validation Error Detail**

When validation fails, clicking the red X icon on the affected element opens a panel showing:
- The specific validation check that failed (from CI/QA section 2)
- The conflicting config records (e.g., "Property 'status' is referenced by form 'Guest Wizard' field 3")
- Suggested resolution (e.g., "Remove the property reference from the form before deprecating it")

### Acceptance Criteria

- [ ] Canvas edits go through the same CI/QA pipeline as builder edits
- [ ] Low-risk additive changes auto-apply with a green checkmark
- [ ] High-risk changes show a review-required indicator and create a change request
- [ ] Validation failures show a red X with clickable error details
- [ ] Pending review elements render with dashed border and reduced opacity
- [ ] Review approval applies the change and removes the pending state
- [ ] Review rejection removes the pending element from the canvas
- [ ] CI/QA status indicators appear within 2 seconds of the canvas action

---

## 4. Conflict Resolution

### Purpose

Define how the bridge handles simultaneous edits from multiple users or interfaces (canvas + builder) modifying the same config.

### Detail

**4.1 Optimistic Concurrency**

The bridge uses optimistic concurrency control. When a user performs a canvas edit:
1. The edit applies locally immediately (optimistic update).
2. The API request includes the element's current `version` number.
3. If the server accepts the request (version matches), the edit is confirmed.
4. If the server rejects the request (version conflict), the edit is rolled back.

**4.2 Server-Wins Resolution**

When two users edit the same config simultaneously:

```
User A (canvas):   Edit concept "guest" name to "Guest Profile"
User B (builder):  Edit concept "guest" name to "Convention Guest"

Timeline:
  T1: User A starts editing (version 3)
  T2: User B saves (version 3 -> version 4, name = "Convention Guest")
  T3: User A saves (version 3 -> rejected, conflict)
```

The server rejects User A's edit because the version has changed. The bridge:
1. Rolls back the optimistic update on User A's canvas.
2. Shows a notification: "This element was changed by {User B's name}. Your change has been reverted."
3. Updates the canvas element with the server's current state (User B's change).

**4.3 Undo on Conflict**

When a conflict is detected:
1. The conflicting action is removed from the undo stack (it was never successfully applied).
2. The canvas state is updated to match the server state.
3. The user's cursor position and viewport are preserved (the conflict resolution does not disrupt navigation).

**4.4 Conflict Detection Scope**

Conflicts are detected at the record level, not the field level. If User A edits a concept's name and User B edits the same concept's description, this is still a conflict (same record version). The server-wins policy applies. This is simpler than field-level merging and avoids subtle data corruption.

**4.5 Real-Time Awareness**

To reduce conflicts, the canvas shows live presence indicators:
- When another user is viewing the same canvas scope, their avatar appears in a "viewers" bar at the top.
- When another user selects an element, the element shows a colored border with the other user's name. This is a "soft lock" -- it does not prevent editing, but it signals potential conflict.

### Acceptance Criteria

- [ ] Optimistic updates apply immediately for responsive UX
- [ ] Version conflicts trigger rollback of the local optimistic update
- [ ] Conflict notification shows the other user's name and the nature of the change
- [ ] The conflicting action is removed from the undo stack
- [ ] Canvas state after conflict resolution matches the server state
- [ ] User viewport and cursor position are preserved during conflict resolution
- [ ] Live presence indicators show when other users are viewing the same scope
- [ ] Element selection by another user shows a colored border with their name
- [ ] Record-level conflict detection is used (not field-level)

---

## 5. Audit Trail

### Purpose

Ensure every canvas edit produces the same audit trail as a builder edit, making the two interfaces forensically indistinguishable.

### Detail

**5.1 Audit Context**

Every API call from the bridge includes an `AuditContext`:

```ts
interface CanvasAuditContext {
  readonly actor_id: string          // authenticated user's UUID
  readonly actor_type: 'human'       // canvas is always a human interface
  readonly session_id: string        // browser session ID
  readonly ip_address: string        // client IP
  readonly change_set: string        // UUID, generated per logical canvas action
  readonly metadata: {
    readonly source: 'canvas'        // distinguishes canvas edits from builder edits in audit log
    readonly canvas_view: string     // 'system-graph' | 'data-flow' | 'workflow'
    readonly canvas_action: string   // 'add_concept' | 'draw_edge' | 'map_fields' | etc.
  }
}
```

The `metadata.source = 'canvas'` field allows audit queries to filter for canvas-originated changes. The audit trail itself is identical in structure to builder edits -- same tables, same columns, same `change_set` linkage.

**5.2 Domain Events**

Config mutations from canvas edits emit the same domain events as builder edits. The event bus does not distinguish between sources. Downstream handlers (workflows, route executor, real-time SSE, audit logger) process canvas-originated events identically.

**5.3 Change Set Grouping**

A single canvas action may involve multiple API calls (e.g., creating a concept + adding 3 properties + creating a relationship). All calls within a single canvas action share the same `change_set` UUID. This groups related mutations in the audit log for atomic rollback.

### Acceptance Criteria

- [ ] Every canvas edit writes to `domain_audit_log` or `ontology_audit_log`
- [ ] Audit entries from canvas edits include `metadata.source = 'canvas'`
- [ ] Audit entries include the specific `canvas_action` for traceability
- [ ] Canvas edits emit the same domain events as builder edits
- [ ] Multi-step canvas actions share a single `change_set` UUID
- [ ] Audit trail is queryable by `metadata.source` to distinguish canvas from builder edits
- [ ] Canvas audit entries include all standard fields: actor_id, actor_type, session_id, ip_address

---

## 6. Undo / Redo

### Purpose

Define the undo/redo mechanism for canvas edits, backed by the platform's versioning service for persistent rollback.

### Detail

**6.1 Local Action Stack**

The canvas maintains an in-memory action stack for undo/redo:

```ts
interface CanvasActionStack {
  readonly undoStack: ReadonlyArray<CanvasAction>    // actions that can be undone
  readonly redoStack: ReadonlyArray<CanvasAction>    // actions that were undone and can be redone
}

interface CanvasAction {
  readonly id: string                  // unique action ID
  readonly type: string                // 'add_concept' | 'draw_edge' | 'map_fields' | etc.
  readonly changeSetId: string         // links to the config mutation's change_set
  readonly configType: string          // 'concept' | 'relationship' | 'route' | etc.
  readonly configRecordId: string      // ID of the affected config record
  readonly previousVersion: number     // version before the action
  readonly timestamp: string
}
```

**6.2 Undo Operation**

When the user presses Ctrl+Z (or clicks the undo button):

1. Pop the most recent action from the undo stack.
2. Call the versioning service to roll back the config record to `previousVersion`:
   ```
   POST /api/versioning/rollback
   Body: { table: configType, recordId: configRecordId, targetVersion: previousVersion }
   ```
3. The versioning service reverts the record and emits a `config.rolled_back` event.
4. The canvas receives the rollback event via SSE and re-renders.
5. Push the action onto the redo stack.

**6.3 Redo Operation**

When the user presses Ctrl+Shift+Z (or clicks the redo button):

1. Pop the most recent action from the redo stack.
2. Re-apply the original mutation by calling the same API endpoint with the same payload.
3. The API creates a new version (not restoring the old version -- forward-only versioning).
4. Push the action onto the undo stack with the new version number.

**6.4 Stack Limits**

- Maximum undo stack depth: 50 actions.
- Redo stack clears when the user performs a new action (standard redo behavior).
- Actions that failed CI/QA validation are not added to the undo stack (nothing to undo).
- Actions that are pending review are not undoable until they are applied.
- The undo stack is session-local and clears on page reload.

**6.5 Multi-Record Undo**

When a single canvas action involved multiple API calls (same `change_set`), undo rolls back all records in the change set atomically. The versioning service supports change-set-level rollback.

### Acceptance Criteria

- [ ] Ctrl+Z undoes the most recent canvas action
- [ ] Ctrl+Shift+Z redoes the most recently undone action
- [ ] Undo calls the versioning service to roll back the config record
- [ ] Redo re-applies the original mutation via the API (forward-only versioning)
- [ ] Redo stack clears on new action
- [ ] Maximum undo depth is 50 actions
- [ ] Failed validations and pending reviews are not added to the undo stack
- [ ] Multi-record actions undo atomically via change-set rollback
- [ ] Undo stack is session-local and clears on page reload
- [ ] Undo/redo keyboard shortcuts are discoverable via tooltip on the undo/redo buttons

---

## 7. UX Checklist Compliance

### Purpose

Verify the bridge's user-facing behaviors meet all UX requirements from `process/ux-checklist.md`.

### Detail

**The Four Questions:**

| Question | Answer |
|----------|--------|
| What is this? | Bridge behavior is invisible -- users see canvas actions producing real config changes. No separate "bridge" UI. |
| Why am I here? | N/A -- the bridge is infrastructure, not a screen. |
| What can I do? | Users interact with the canvas; the bridge translates. Undo/redo buttons are visible in the canvas toolbar. |
| What happens when I do it? | Optimistic update (immediate visual feedback) + CI/QA status indicators + success/error toasts + conflict notifications. |

**Loading States:**
- During API calls: affected element shows a subtle loading spinner overlay.
- During undo/rollback: affected element shows a "reverting" animation.

**Error Handling:**
- API failure: toast with "Unable to save change: {error message}". Optimistic update reverted.
- Conflict: notification banner: "This element was changed by {user}. Your change has been reverted."
- Network disconnection: "Connection lost" banner. All edit actions disabled. Canvas shows last-known state.
- Validation failure: red X on affected element with clickable detail panel.

**Feedback & Confirmation:**
- Every successful edit: brief green checkmark on the element (fades after 3 seconds).
- Destructive edits (delete/deprecate): confirmation dialog before the API call, before the optimistic update.
- Bulk edits (if supported in future): count of affected elements + confirmation.

**Accessibility:**
- Undo/redo buttons have ARIA labels: "Undo last action" / "Redo last undone action".
- Conflict notifications are announced via ARIA live region.
- CI/QA status indicators have screen-reader-accessible text (not just color/icon).

### Acceptance Criteria

- [ ] Optimistic updates provide immediate visual feedback for all canvas actions
- [ ] Error toasts display plain-language messages
- [ ] Conflict notifications include the other user's name
- [ ] Destructive actions require confirmation before proceeding
- [ ] Undo/redo buttons have ARIA labels
- [ ] CI/QA status indicators are accessible to screen readers
- [ ] Network disconnection disables editing and shows a banner

---

## 8. Test Plan

### 8.1 Config-to-Canvas Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-01 | Integration | Create concept via builder API | Canvas receives SSE update, new node appears |
| CCB-02 | Integration | Update concept name via builder API | Canvas node label updates in real-time |
| CCB-03 | Integration | Delete concept via builder API | Canvas node removed in real-time |
| CCB-04 | Integration | Create data route via builder API | Canvas renders new route edge |
| CCB-05 | Integration | Update route field mappings via builder API | Canvas field-level edges update |
| CCB-06 | Integration | Create property on a concept visible on canvas | Expanded concept node shows new field row |
| CCB-07 | Integration | Update RBAC permission (reduce visibility) | Canvas elements user can no longer view disappear |
| CCB-08 | Integration | SSE disconnects and reconnects | Canvas catches up with missed changes on reconnect |

### 8.2 Canvas-to-Config Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-09 | Integration | Add concept node on canvas | `POST /api/ontology/concepts` called, concept created in DB |
| CCB-10 | Integration | Draw relationship edge on canvas | `POST /api/ontology/relationships` called, relationship created |
| CCB-11 | Integration | Create data route via canvas drag | `POST /api/data-routes` called, route created |
| CCB-12 | Integration | Map fields via canvas drag | `PUT /api/data-routes/:id` called, field_mappings updated |
| CCB-13 | Integration | Add transform to route via palette drag | `PUT /api/data-routes/:id` called, transform_id set |
| CCB-14 | Integration | Delete concept via canvas (deprecate) | Change request created via CI/QA pipeline |
| CCB-15 | Unit | Canvas action with insufficient RBAC | Action blocked before optimistic update, error message shown |

### 8.3 CI/QA Integration Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-16 | Integration | Low-risk additive change (add dept concept) | Green checkmark appears, change auto-applied |
| CCB-17 | Integration | High-risk change (delete concept used by forms) | Yellow warning icon, change request created |
| CCB-18 | Integration | Validation failure (property type change with existing data) | Red X with error detail panel |
| CCB-19 | Integration | Admin approves pending change request | Pending element becomes solid, green checkmark |
| CCB-20 | Integration | Admin rejects pending change request | Pending element removed from canvas, rejection toast |

### 8.4 Conflict Resolution Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-21 | Integration | Two users edit same concept simultaneously | Second user's save rejected, optimistic update rolled back, notification shown |
| CCB-22 | Integration | Builder edit conflicts with canvas edit | Canvas receives SSE update, local edit rolled back if conflicting |
| CCB-23 | Unit | Conflict removes action from undo stack | Undo stack does not contain the conflicted action |
| CCB-24 | Unit | Conflict preserves viewport and cursor | User's canvas position unchanged after conflict resolution |

### 8.5 Audit Trail Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-25 | Integration | Canvas edit produces audit log entry | `domain_audit_log` or `ontology_audit_log` row with `metadata.source = 'canvas'` |
| CCB-26 | Integration | Canvas edit emits domain event | Event bus receives event identical to builder-originated event |
| CCB-27 | Integration | Multi-step canvas action (concept + properties) | All audit entries share the same `change_set` UUID |
| CCB-28 | Integration | Canvas edit and builder edit on same record | Both produce audit entries, version history is correct |

### 8.6 Undo/Redo Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-29 | Integration | Undo after adding a concept | Concept rolled back via versioning service, removed from canvas |
| CCB-30 | Integration | Redo after undoing a concept addition | Concept re-created via API, appears on canvas |
| CCB-31 | Unit | Redo stack clears on new action | Redo stack empty after performing a new canvas action |
| CCB-32 | Unit | Undo stack at max depth (50) | Oldest action dropped when 51st action is pushed |
| CCB-33 | Integration | Undo a multi-record action | All records in the change set rolled back atomically |
| CCB-34 | Unit | Failed validation not added to undo stack | Undo stack unchanged after failed edit |
| CCB-35 | Unit | Pending review action not undoable | Undo skips pending actions |

### 8.7 Presence and Real-Time Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CCB-36 | Integration | Two users viewing same canvas scope | Both users' avatars visible in viewers bar |
| CCB-37 | Integration | User A selects an element | User B sees colored border on that element with User A's name |
| CCB-38 | Integration | SSE disconnection during editing | "Connection lost" banner shown, editing disabled |
| CCB-39 | Integration | SSE reconnection after disconnection | Canvas catches up with missed changes, editing re-enabled |

### 8.8 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| Optimistic update latency | Canvas action to visual update | < 50ms |
| API round-trip for simple edit | Canvas action to confirmed state | < 500ms |
| SSE update to canvas re-render | Config change to visual update | < 200ms |
| Undo operation | Ctrl+Z to visual rollback | < 300ms |
| Conflict resolution rollback | Conflict detected to canvas state restored | < 200ms |

**Coverage target:** >=80% on bridge translation logic, action-to-mutation mapping, and conflict resolution. 100% on audit trail generation (every canvas action must produce an audit entry).

---

## 9. Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/canvas-engine.md` | Provides interaction primitives, action dispatch, rendering |
| `canvas/canvas-rbac.md` | RBAC pre-check before bridge sends API calls |
| `canvas/data-flow-canvas.md` | Data flow canvas uses bridge for route/transform/field edits |
| `core/ontology-ci-qa.md` | CI/QA pipeline for change validation and review gates |
| `core/audit-system.md` | Audit trail via `AuditContext` on every API call |
| `core/event-bus.md` | Domain events emitted by config mutations |
| `core/rbac-engine.md` | Permission enforcement on API endpoints |
| `data-infrastructure/real-time.md` | SSE for pushing config changes to canvas clients |
| `data/versioning-backups.md` | Versioning service for undo/rollback operations |
| `api/domain-crud.md` | API layer for all config mutations |
| `data-infrastructure/data-routing.md` | Route config mutations |
| `data-infrastructure/data-transforms.md` | Transform config mutations |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| All mutations go through the API layer, never direct Postgres | Canvas and builder must be indistinguishable in the audit trail. API layer enforces validation, RBAC, audit, and events uniformly. |
| Optimistic updates with server-wins conflict resolution | Optimistic updates provide responsive UX (no loading spinner for every edit). Server-wins is simpler than three-way merge and avoids subtle data corruption. |
| Event bus subscriber at priority 960 | After real-time SSE subscriber (950) and core handlers (audit at 50, routes at 200), but early enough to update canvas clients promptly. |
| Record-level conflict detection, not field-level | Simpler implementation, avoids edge cases where two users edit different fields but create an inconsistent record. Acceptable for convention-scale usage (50-100 concurrent users). |
| Undo backed by versioning service, not local state | Local undo would only affect the canvas view. Versioning-backed undo actually reverses the config change in Postgres, ensuring builder and canvas stay synchronized. |
| `metadata.source = 'canvas'` in audit entries | Allows forensic distinction between canvas and builder edits without changing the audit schema. Both are first-class edit paths. |
| CI/QA status indicators on canvas elements | Canvas users need the same change governance feedback as builder users. Visual indicators on the affected element are more contextual than a separate review queue page. |
| Session-local undo stack, max 50 actions | Undo history is ephemeral -- it would be complex and low-value to persist it across sessions. 50 actions covers typical editing sessions without unbounded memory growth. |
