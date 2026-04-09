# Canvas RBAC & Verification

> What you see and do on the canvas depends on your role. Admins see everything. Directors see their department
> plus org-wide. Coordinators see what they have permission for. Volunteers and viewers get a read-only informational
> canvas with no edit controls. Canvas edits go through the same CI/QA verification pipeline as builder edits.
> Canvas-specific permissions (`canvas:view`, `canvas:edit`, `canvas:admin`) layer on top of the existing RBAC
> engine -- they do not replace it.

---

## Overview

The canvas is a visual interface for viewing and editing the platform's ontology, workflows, and data routes. Like the builder, it operates within the platform's RBAC framework (`core/rbac-engine.md`). Unlike the builder, which uses form-based UI that naturally hides unauthorized controls, the canvas renders a spatial graph where unauthorized elements could be visible but uneditable, collapsed but present, or hidden entirely. This PRD defines the rules.

The canvas RBAC layer answers three questions for every element on the canvas:
1. **Can the user see this element?** (visibility)
2. **Can the user interact with this element?** (edit capability)
3. **Does the user's edit pass verification?** (CI/QA pipeline)

Canvas permissions are additive to existing RBAC permissions. A user who cannot view a concept via `roleEngine.canPerformAction(roleKey, conceptKey, 'view')` will not see that concept on the canvas regardless of canvas-specific permissions. Canvas permissions provide additional granularity for the canvas interface specifically.

**Dependencies:**
- `canvas/canvas-engine.md` -- rendering engine, element visibility control
- `canvas/canvas-config-bridge.md` -- edit actions that require RBAC checks
- `core/rbac-engine.md` -- role engine, permissions, data scoping, field filtering
- `core/ontology-scoping.md` -- department scoping for concepts
- `core/ontology-ci-qa.md` -- CI/QA pipeline for change verification
- `core/audit-system.md` -- audit trail for all canvas actions
- `data-infrastructure/real-time.md` -- SSE filtered by RBAC

---

## 1. Visibility RBAC

### Purpose

Define what each role can see on the canvas. Visibility is controlled at the concept, relationship, field, and data flow levels.

### Detail

**1.1 Role-Based Visibility Matrix**

| Role | Concepts | Relationships | Data Routes | Workflows | Fields |
|------|----------|--------------|-------------|-----------|--------|
| Admin | All departments, all scopes | All | All routes across all departments | All | All, including PII |
| Director | Org-wide + own department. Other departments hidden unless cross-dept RBAC grants access. | All involving visible concepts | Routes owned by own department + routes targeting own department | Workflows scoped to own department + org-wide | All on visible concepts, PII if role permits |
| Coordinator | Concepts where `canPerformAction(roleKey, conceptKey, 'view') = true` | Relationships where both endpoints are visible | Routes where both source and destination concepts are visible | Workflows where the user has view permission | Visible properties per `getVisibleProperties()` |
| Volunteer | Same as Coordinator (view permission-based) | Same as Coordinator | Same as Coordinator | Same as Coordinator | Same as Coordinator |
| Viewer | Same as Coordinator (view permission-based) | Same as Coordinator | Same as Coordinator | Same as Coordinator | Same as Coordinator |

**1.2 Visibility Evaluation Flow**

When the canvas loads:

```
[1] Authenticate user (auth-system.md)
    - Resolve userId and roleKey
    |
    v
[2] Load all concepts the user can view
    - For each concept in the ontology:
      if (roleEngine.canPerformAction(roleKey, conceptKey, 'view'))
        include in visible set
    |
    v
[3] Filter relationships
    - Include only relationships where both source and target concepts are in the visible set
    |
    v
[4] Filter data routes
    - Include only routes where both source_concept_key and dest_concept_key are in the visible set
    - Apply department filter: routes owned by departments the user can access
    |
    v
[5] Filter workflows
    - Include only workflows where the associated concept is in the visible set
    |
    v
[6] Filter fields
    - For each visible concept, get visibleProperties via roleEngine.getVisibleProperties(roleKey, conceptKey)
    - Only show fields in the visible properties list when concept nodes are expanded
    |
    v
[7] Render canvas with filtered element set
```

**1.3 Hidden Elements**

Elements the user cannot see are completely absent from the canvas -- they are not rendered as placeholder shapes. However, when a visible element has connections to hidden elements, the canvas shows a **collapsed boundary indicator**:

```
+-------------------+
| Guest Relations   |       +---------------------+
|   Guest           |------>| Other Department    |
|   Contract        |       | (3 concepts hidden) |
|   Transport       |       | No access           |
+-------------------+       +---------------------+
```

The collapsed boundary indicator shows:
- Department name (if known)
- Count of hidden concepts
- "No access" label
- No detail about the hidden concepts (no names, no fields)
- Greyed out, non-interactive

This prevents a Director from thinking there are no downstream consumers of their data when in fact there are -- they just cannot see the details.

**1.4 PII Field Visibility**

PII fields (where `ontology_properties.encrypted = true`) follow additional visibility rules:

| Role | PII Visibility |
|------|---------------|
| Admin | All PII fields visible with lock icon |
| Director | PII fields visible on own department's concepts if `pii_filter_mode = 'pass'` is allowed by their RBAC role |
| Coordinator | PII fields hidden unless role's `visibleProperties` explicitly includes the encrypted field |
| Volunteer/Viewer | PII fields always hidden |

When a PII field is hidden from the user, it does not appear in the expanded concept node. If the user lacks PII access but a route handles PII, the route's security badge still appears (green shield for "PII stripped") but the specific PII field names are not shown.

### Acceptance Criteria

- [ ] Admin sees all concepts, relationships, routes, and workflows across all departments
- [ ] Director sees org-wide + own department concepts; other departments shown as collapsed boundaries
- [ ] Coordinator sees only concepts where `canPerformAction` returns `true` for `view`
- [ ] Volunteer and Viewer see the same visibility as Coordinator (permission-based)
- [ ] Relationships are visible only when both endpoints are visible
- [ ] Data routes are visible only when both source and destination concepts are visible
- [ ] Hidden elements are completely absent, not rendered as placeholders
- [ ] Collapsed boundary indicators show department name and hidden count without detail
- [ ] PII fields are hidden from users whose role does not include them in `visibleProperties`
- [ ] Security badges on routes are visible even when PII field names are hidden
- [ ] Visibility evaluation uses existing `RoleEngine` methods, no new permission system

---

## 2. Edit RBAC

### Purpose

Define what each role can edit on the canvas. Edit controls (drag handles, drop targets, context menus) are hidden for elements the user cannot modify.

### Detail

**2.1 Edit Permission Matrix**

| Canvas Action | Required Permission | Minimum Role |
|--------------|-------------------|--------------|
| Create concept (department-scoped) | `canPerformAction(roleKey, 'ontology_concept', 'create')` + user belongs to the department | Director |
| Create concept (org-wide) | `canPerformAction(roleKey, 'ontology_concept', 'create')` + admin scope | Admin |
| Rename concept | `canPerformAction(roleKey, conceptKey, 'edit')` | Director (own dept), Admin (org-wide) |
| Deprecate concept | `canPerformAction(roleKey, conceptKey, 'delete')` + CI/QA review | Admin |
| Draw relationship | `canPerformAction(roleKey, sourceConceptKey, 'edit')` AND `canPerformAction(roleKey, targetConceptKey, 'edit')` | Director (both concepts in own dept) |
| Create data route | `canPerformAction(roleKey, 'data_route', 'create')` + `canPerformAction(roleKey, sourceConceptKey, 'view')` + `canPerformAction(roleKey, destConceptKey, 'view')` | Coordinator |
| Map fields on route | `canPerformAction(roleKey, 'data_route', 'edit')` + `canPerformAction(roleKey, sourceConceptKey, 'view')` + `canPerformAction(roleKey, destConceptKey, 'view')` | Coordinator |
| Add transform to route | `canPerformAction(roleKey, 'data_route', 'edit')` | Coordinator |
| Configure workflow | `canPerformAction(roleKey, 'workflow_config', 'edit')` | Director |
| Set PII classification | `canPerformAction(roleKey, propertyConceptKey, 'edit')` + admin scope for PII changes | Admin |
| Modify RBAC permissions | `canPerformAction(roleKey, 'permission', 'edit')` | Admin |

**2.2 Visual Edit Indicators**

The canvas visually distinguishes editable from read-only elements:

| Element State | Visual Treatment |
|--------------|-----------------|
| Editable | Full color, edit handles visible on hover, drag handles visible, context menu on right-click |
| Read-only | Slightly dimmed (opacity: 0.8), no edit handles, no drag handles, "View only" tooltip on hover, context menu shows only "View details" and "View lineage" |
| Restricted (other department) | Greyed out (opacity: 0.4), collapsed, "No access" label, no interaction beyond hover tooltip showing department name |

**2.3 Edit Handle Suppression**

Edit handles are suppressed at the rendering level, not hidden after rendering. The canvas engine checks edit permissions before rendering any interactive handle:

```ts
function shouldShowEditHandles(
  element: CanvasElement,
  userRole: string,
  userId: string
): boolean {
  // Check canvas-specific edit permission
  if (!hasCanvasPermission(userRole, 'canvas:edit')) return false

  // Check RBAC edit permission for this specific element
  const conceptKey = element.configType === 'concept'
    ? element.configKey
    : element.parentConceptKey

  return roleEngine.canPerformAction(userRole, conceptKey, 'edit')
}
```

This prevents UI flicker (showing handles then hiding them) and avoids exposing edit affordances to unauthorized users.

**2.4 Cross-Department Edits**

When a user attempts an edit that spans departments (e.g., drawing a relationship from their department's concept to another department's concept):

1. The bridge checks edit permission on both concepts.
2. If the user has edit permission on their concept but only view permission on the other:
   - The edge can be drawn (initiating user has intent).
   - The config mutation creates a cross-department change request requiring admin approval.
   - The edge appears as "pending" on the canvas.
3. If the user lacks view permission on the other concept:
   - The drop target is not available (the other department's concepts are hidden or collapsed).

### Acceptance Criteria

- [ ] Admin can edit all elements across all departments
- [ ] Director can edit elements within their department and org-wide elements
- [ ] Coordinator can create and edit data routes and field mappings within their visible concepts
- [ ] Volunteer and Viewer see no edit controls whatsoever
- [ ] Edit handles are suppressed at render time, not hidden after rendering
- [ ] Read-only elements show "View only" tooltip on hover
- [ ] Restricted elements show "No access" label with greyed-out appearance
- [ ] Drawing relationships requires edit permission on both source and target concepts
- [ ] Cross-department edits create change requests requiring admin approval
- [ ] PII classification changes require admin scope

---

## 3. Canvas-Specific Permissions

### Purpose

Define three canvas-specific permission keys that control canvas access independently of concept-level RBAC.

### Detail

Canvas-specific permissions are stored in the same `permissions` table as all other permissions, using a virtual concept key `canvas`:

| Permission Key | Description | Default Grant |
|---------------|-------------|---------------|
| `canvas:view` | Can open and explore the canvas in read-only mode | All authenticated users |
| `canvas:edit` | Can make changes on the canvas (add nodes, draw edges, map fields) | Coordinator and above |
| `canvas:admin` | Can see all departments and edit org-wide elements on the canvas | Admin only |

**Permission evaluation order:**

```
[1] Does the user have canvas:view?
    - No: redirect to "Canvas not available for your role" page
    - Yes: proceed
    |
    v
[2] Does the user have canvas:edit?
    - No: render canvas in read-only mode (no edit handles, no drag targets)
    - Yes: render canvas with edit handles, subject to per-element RBAC (section 2)
    |
    v
[3] Does the user have canvas:admin?
    - No: apply department-scoped visibility (section 1)
    - Yes: show all departments, all elements
```

**Interaction between canvas permissions and RBAC:**

Canvas permissions are a coarse gate. RBAC permissions are the fine-grained enforcement. Both must pass for an action to succeed:

| Scenario | canvas:edit | RBAC canEdit | Result |
|----------|------------|--------------|--------|
| Coordinator edits a concept they have RBAC edit on | Yes | Yes | Allowed |
| Coordinator edits a concept they have RBAC view-only on | Yes | No | Blocked (RBAC denial) |
| Volunteer edits a concept they have RBAC edit on (hypothetical) | No | Yes | Blocked (canvas permission denial) |
| Admin edits any concept | Yes (via canvas:admin) | Yes (admin role) | Allowed |

**Storage:** Canvas permissions are stored as standard permission rows:

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_edit, can_create, can_delete)
VALUES
  ('volunteer', 'canvas', true, false, false, false),   -- canvas:view only
  ('coordinator', 'canvas', true, true, false, false),   -- canvas:view + canvas:edit
  ('director', 'canvas', true, true, false, false),      -- canvas:view + canvas:edit
  ('admin', 'canvas', true, true, true, true);           -- canvas:admin (full access)
```

The `canvas:admin` permission is encoded as `can_create = true` on the `canvas` virtual concept. The bridge checks for this when determining whether to show all-department visibility.

### Acceptance Criteria

- [ ] `canvas:view` is granted to all authenticated users by default
- [ ] `canvas:edit` is granted to coordinator and above by default
- [ ] `canvas:admin` is granted to admin only by default
- [ ] Users without `canvas:view` are redirected to a "not available" page
- [ ] Users with `canvas:view` but not `canvas:edit` see a read-only canvas
- [ ] `canvas:edit` is necessary but not sufficient -- per-element RBAC still applies
- [ ] `canvas:admin` enables all-department visibility
- [ ] Canvas permissions are stored in the standard `permissions` table using `concept_key = 'canvas'`
- [ ] Canvas permissions are admin-editable through the ontology builder (not hardcoded)

---

## 4. CI/QA Verification for Canvas Edits

### Purpose

Define how canvas edits flow through the CI/QA pipeline with visual feedback specific to the canvas interface.

### Detail

**4.1 Verification Flow**

Every canvas edit goes through the same CI/QA pipeline defined in `core/ontology-ci-qa.md`. The canvas-config bridge (`canvas/canvas-config-bridge.md`) submits the edit via the API layer. The API layer triggers CI/QA validation. The result flows back to the canvas via SSE.

```
Canvas Edit
  |
  v
[1] Canvas-Config Bridge submits API call
  |
  v
[2] API layer runs CI/QA validation
    - Structural checks (unique keys, valid references)
    - Cross-system checks (property used by forms? concept used by workflows?)
    - Risk assessment (low/medium/high)
  |
  v
[3a] Validation passes, low risk
    - Change auto-applied
    - Canvas element shows green checkmark (fades after 3s)
    |
[3b] Validation passes, high risk
    - Change request created
    - Canvas element shows yellow warning icon
    - Element rendered as "pending" (dashed border, reduced opacity)
    - Tooltip: "Pending review. Requires admin approval."
    |
[3c] Validation fails
    - Change rejected
    - Canvas element shows red X icon
    - Optimistic update rolled back
    - Click red X to see error details
```

**4.2 Canvas-Specific CI/QA Indicators**

| Indicator | Icon | Color | Location | Duration |
|-----------|------|-------|----------|----------|
| Validating | Spinning circle | Blue | On affected element | Until validation completes |
| Auto-applied | Checkmark | Green | On affected element | 3 seconds, then fades |
| Review required | Warning triangle | Yellow | On affected element | Until review completes |
| Validation failed | X mark | Red | On affected element | Until user clicks to dismiss |
| Review pending | Clock | Orange | On affected element | Until admin acts |
| Review approved | Checkmark | Green | On affected element | 3 seconds, then fades |
| Review rejected | X mark with "Rejected" text | Red | On affected element | Until user clicks to dismiss |

**4.3 Impact Preview on Canvas**

Before a high-risk edit is submitted, the canvas shows an impact preview overlay:

1. User initiates a high-risk action (e.g., deprecating a concept).
2. The bridge calls the impact analysis endpoint before submitting:
   ```
   GET /api/ci-qa/impact?configType=concept&recordId={id}&action=deprecate
   ```
3. The canvas highlights all affected elements:
   - Related forms: orange highlight
   - Related views: orange highlight
   - Related workflows: orange highlight
   - Related data routes: orange highlight
   - Connected relationships: orange dashed border
4. An impact summary panel opens:
   ```
   Impact of deprecating "Guest":
   - 2 forms reference this concept
   - 3 views display this concept
   - 1 workflow triggers on this concept
   - 4 data routes source from this concept
   Risk level: HIGH
   Requires: Admin approval
   [Proceed] [Cancel]
   ```
5. If the user clicks "Proceed," the change request is created.
6. If the user clicks "Cancel," the impact overlay clears and no mutation is submitted.

**4.4 Review Queue Access from Canvas**

Directors and admins can access the review queue directly from the canvas:
- A badge on the canvas toolbar shows the count of pending reviews: "3 pending reviews."
- Clicking the badge opens a side panel listing pending change requests.
- Each change request shows: who submitted it, what they changed, the impact report, and approve/reject buttons.
- Approving a change request from the canvas applies the change immediately (same as approving from the builder's review queue).

### Acceptance Criteria

- [ ] All canvas edits go through the CI/QA pipeline before becoming permanent
- [ ] Low-risk changes auto-apply with a green checkmark indicator
- [ ] High-risk changes create change requests with a yellow warning indicator
- [ ] Validation failures show a red X with clickable error detail
- [ ] Impact preview highlights all affected elements before high-risk edits
- [ ] Impact summary panel shows counts and names of affected configs
- [ ] Review queue is accessible from the canvas toolbar
- [ ] Approving a review from the canvas applies the change immediately
- [ ] Rejecting a review from the canvas removes the pending element
- [ ] CI/QA indicators use icon + color + text (never color alone, per accessibility requirements)

---

## 5. Offline and Disconnected Behavior

### Purpose

Define canvas behavior when the SSE connection is lost or the network is unavailable.

### Detail

**5.1 Connection Loss Detection**

The SSE endpoint sends a heartbeat event every 30 seconds:
```
event: heartbeat
data: {"timestamp":"2026-04-08T14:30:00Z"}
```

If the canvas client does not receive a heartbeat for 60 seconds (2 missed heartbeats), it enters disconnected mode.

**5.2 Disconnected Mode**

When the canvas enters disconnected mode:

| Behavior | Detail |
|----------|--------|
| Banner | "Connection lost. Changes by other users may not be visible. Editing disabled." -- full-width banner at the top of the canvas, yellow background. |
| Edit controls | All edit handles, drag targets, and context menu edit options hidden. Canvas is read-only. |
| Last-known state | Canvas continues to display the last-known graph state. No placeholder or blank screen. |
| Undo/redo | Disabled (cannot reach versioning service). |
| Data flow animation | "Show Live Data" toggle disabled, animation stops. |
| Retry indicator | Banner includes a spinning retry icon and text: "Reconnecting..." |

**5.3 Reconnection**

When the SSE connection is re-established:

1. The canvas sends `lastEventId` to the SSE endpoint to receive missed events.
2. Missed events are applied in order to catch up to the current state.
3. If the gap is too large (server has discarded old events), the canvas performs a full reload of the graph data.
4. The "Connection lost" banner is replaced with a brief "Reconnected" success banner (fades after 3 seconds).
5. Edit controls are re-enabled.

**5.4 Network Failure During Edit**

If the network fails while a canvas edit is in-flight (optimistic update applied, API call pending):

1. The API call times out after 10 seconds.
2. The optimistic update is rolled back.
3. Error toast: "Unable to save change. Connection lost."
4. The action is not added to the undo stack.
5. The canvas enters disconnected mode.

### Acceptance Criteria

- [ ] SSE heartbeat sent every 30 seconds
- [ ] Disconnected mode activates after 60 seconds without heartbeat
- [ ] "Connection lost" banner is visible and clearly communicates the state
- [ ] All edit controls are hidden in disconnected mode
- [ ] Canvas displays last-known state, never a blank screen
- [ ] Reconnection uses `lastEventId` to catch up on missed events
- [ ] Full reload occurs when the event gap is too large
- [ ] "Reconnected" banner appears on successful reconnection
- [ ] In-flight edits are rolled back on network timeout
- [ ] Undo/redo is disabled in disconnected mode

---

## 6. UX Checklist Compliance

### Purpose

Verify canvas RBAC behaviors meet all UX requirements from `process/ux-checklist.md`.

### Detail

**The Four Questions:**

| Question | Answer |
|----------|--------|
| What is this? | RBAC is invisible infrastructure -- users see the canvas with appropriate controls for their role. |
| Why am I here? | Role determines the experience. A Director sees their department's graph with edit controls. A Volunteer sees an informational read-only graph. |
| What can I do? | Edit handles, drag targets, and context menus appear only for elements the user can modify. Read-only elements clearly indicate "View only." |
| What happens when I do it? | Permission denial shows a clear message ("Insufficient permissions to edit this element"). CI/QA indicators show verification status. |

**Empty States:**

| Scenario | Message |
|----------|---------|
| User has `canvas:view` but no concepts are viewable | "No elements are available for your role. Contact your department director for access." |
| User lacks `canvas:view` | Redirected to: "Canvas is not available for your role. Contact your administrator." |
| All visible concepts are in another department (collapsed boundaries only) | "Your department has no concepts configured. Contact your director to set up your department's ontology." |

**Loading States:**
- RBAC evaluation during canvas load: skeleton layout with generic node shapes.
- Permission check during edit action: brief loading spinner on the element (< 200ms typical, imperceptible in most cases).

**Error Handling:**
- Permission denial on edit attempt: toast with "You don't have permission to edit {element type}. Contact your department director."
- CI/QA rejection: red X on element with clickable detail panel showing the validation error and suggested resolution.
- Role change during active session: SSE pushes permission update, canvas re-evaluates visibility and hides newly restricted elements with a notification: "Your permissions were updated. Some elements are no longer visible."

**Accessibility:**
- Read-only elements have `aria-readonly="true"` and a screen-reader-accessible "View only" label.
- Restricted/hidden elements are not in the DOM (not just visually hidden), so screen readers do not encounter them.
- Collapsed boundary indicators have ARIA labels: "{department name}: {count} elements, no access."
- CI/QA status indicators have screen-reader-accessible text descriptions.
- "Connection lost" banner is announced via ARIA live region.

### Acceptance Criteria

- [ ] Users without `canvas:view` are redirected with a clear message
- [ ] Users with no viewable concepts see an informational empty state
- [ ] RBAC evaluation shows a skeleton layout during loading
- [ ] Permission denial produces a toast with actionable message (who to contact)
- [ ] Role changes during an active session update visibility in real-time
- [ ] Read-only elements have `aria-readonly="true"`
- [ ] Hidden elements are removed from the DOM, not just visually hidden
- [ ] Collapsed boundary indicators have ARIA labels
- [ ] CI/QA status indicators are screen-reader-accessible

---

## 7. Test Plan

### 7.1 Visibility Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-01 | Integration | Admin opens canvas | All concepts, relationships, routes, workflows visible across all departments |
| CRBAC-02 | Integration | Director opens canvas | Own department + org-wide concepts visible. Other departments shown as collapsed boundaries. |
| CRBAC-03 | Integration | Coordinator opens canvas | Only concepts with `canPerformAction('view') = true` visible |
| CRBAC-04 | Integration | Volunteer opens canvas | Same visibility as Coordinator, all in read-only mode |
| CRBAC-05 | Integration | Viewer opens canvas | Same visibility as Coordinator, all in read-only mode |
| CRBAC-06 | Integration | Director with cross-dept RBAC grant | Granted department's concepts also visible |
| CRBAC-07 | Unit | Relationship where one endpoint is hidden | Relationship edge not rendered |
| CRBAC-08 | Unit | Data route where destination concept is hidden | Route edge not rendered |
| CRBAC-09 | Integration | Collapsed boundary indicator | Shows department name and hidden concept count, no detail |
| CRBAC-10 | Unit | PII field visibility for Coordinator without PII access | PII fields not shown in expanded concept node |
| CRBAC-11 | Unit | PII field visibility for Admin | PII fields shown with lock icon |

### 7.2 Edit Permission Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-12 | Integration | Director hovers editable concept | Edit handles and drag handles visible |
| CRBAC-13 | Integration | Coordinator hovers concept they can view but not edit | No edit handles, "View only" tooltip |
| CRBAC-14 | Integration | Volunteer hovers any element | No edit handles, no drag handles, "View only" tooltip |
| CRBAC-15 | Integration | Director drags concept within own department | Edit accepted, API call succeeds |
| CRBAC-16 | Integration | Coordinator attempts to draw relationship | Blocked if lacking edit permission on either concept |
| CRBAC-17 | Integration | Director draws relationship spanning departments | Cross-department change request created |
| CRBAC-18 | Integration | Coordinator creates data route between viewable concepts | Route created successfully |
| CRBAC-19 | Integration | Coordinator attempts to modify RBAC permission | Action blocked, "Admin required" message |
| CRBAC-20 | Integration | Coordinator attempts to set PII classification | Action blocked, "Admin required" message |

### 7.3 Canvas Permission Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-21 | Integration | User without `canvas:view` navigates to canvas URL | Redirected to "not available" page |
| CRBAC-22 | Integration | User with `canvas:view` but not `canvas:edit` | Canvas loads in read-only mode, no edit controls |
| CRBAC-23 | Integration | User with `canvas:edit` | Canvas loads with edit controls for permitted elements |
| CRBAC-24 | Integration | User with `canvas:admin` | All departments visible, all elements editable |
| CRBAC-25 | Integration | Admin modifies canvas permissions in builder | Canvas behavior changes after permission reload |

### 7.4 CI/QA Verification Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-26 | Integration | Low-risk canvas edit (add dept concept) | Green checkmark appears after auto-apply |
| CRBAC-27 | Integration | High-risk canvas edit (deprecate concept) | Impact preview overlay shown, change request created on proceed |
| CRBAC-28 | Integration | Validation failure (duplicate concept key) | Red X on element, error detail panel accessible |
| CRBAC-29 | Integration | Admin approves pending change from canvas review panel | Change applied, pending element becomes solid |
| CRBAC-30 | Integration | Admin rejects pending change from canvas review panel | Pending element removed, rejection reason shown |
| CRBAC-31 | Integration | Impact preview highlights affected elements | Forms, views, workflows, routes highlighted in orange |

### 7.5 Disconnected Mode Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-32 | Integration | SSE connection drops (no heartbeat for 60s) | "Connection lost" banner appears, edit controls hidden |
| CRBAC-33 | Integration | SSE reconnects after disconnection | Banner shows "Reconnected," edit controls re-enabled |
| CRBAC-34 | Integration | Edit in-flight when network fails | Optimistic update rolled back, error toast shown |
| CRBAC-35 | Integration | Canvas in disconnected mode | Last-known state displayed, not blank |
| CRBAC-36 | Unit | Undo/redo in disconnected mode | Both disabled |

### 7.6 Real-Time Permission Update Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-37 | Integration | Admin changes user's role while user is on canvas | Canvas re-evaluates visibility, elements hidden/shown accordingly |
| CRBAC-38 | Integration | Admin removes `canvas:edit` from coordinator role | Edit controls disappear from coordinator's active canvas session |
| CRBAC-39 | Integration | Admin adds cross-dept grant for director | Newly visible department's concepts appear on canvas |

### 7.7 Accessibility Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| CRBAC-40 | Unit | Read-only element | Has `aria-readonly="true"` attribute |
| CRBAC-41 | Unit | Hidden element | Not present in DOM |
| CRBAC-42 | Unit | Collapsed boundary indicator | Has ARIA label with department name and count |
| CRBAC-43 | Unit | CI/QA status indicator | Has screen-reader-accessible text |
| CRBAC-44 | Unit | "Connection lost" banner | Announced via ARIA live region |
| CRBAC-45 | Unit | Permission denial toast | Announced via ARIA live region |

### 7.8 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| RBAC evaluation on canvas load (50 concepts) | Director role with department filter | < 500ms to resolve visible set |
| RBAC evaluation on canvas load (200 concepts) | Admin role, all visible | < 1 second to resolve visible set |
| Edit permission check on hover | Single element | < 50ms (imperceptible) |
| Permission update via SSE | Admin changes role | Canvas re-renders within 2 seconds |

**Coverage target:** >=80% on visibility evaluation, edit permission checks, and CI/QA indicator rendering. 100% on permission denial paths (every denied action must produce a user-visible message). 100% on disconnected mode transitions.

---

## 8. Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/canvas-engine.md` | Rendering engine, element visibility control |
| `canvas/canvas-config-bridge.md` | Edit actions that require RBAC pre-checks |
| `canvas/data-flow-canvas.md` | Data flow canvas uses RBAC for route/field visibility and edit controls |
| `core/rbac-engine.md` | `canPerformAction()`, `getVisibleProperties()`, `filterRecord()` |
| `core/ontology-scoping.md` | Department scoping for concept visibility |
| `core/ontology-ci-qa.md` | CI/QA pipeline for change verification |
| `core/audit-system.md` | Audit trail for all canvas actions |
| `data-infrastructure/real-time.md` | SSE for permission updates and heartbeat |
| `process/ux-checklist.md` | UX requirements for all canvas screens |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Canvas permissions layer on top of RBAC, not replace it | Avoids a parallel permission system. Canvas permissions are a coarse gate; RBAC is fine-grained. Both must pass. |
| Hidden elements absent from DOM, not visually hidden | Prevents information leakage. A user who cannot view a concept should not be able to inspect the DOM to find its name or properties. |
| Collapsed boundary indicators for cross-department edges | Prevents a Director from incorrectly believing their data has no downstream consumers. Shows that something exists without revealing what. |
| Edit handles suppressed at render time, not hidden after | Prevents UI flicker and avoids exposing edit affordances in the DOM for unauthorized users. |
| `canvas:view` granted to all authenticated users | The canvas is informational for most users. Restricting view access would reduce platform transparency. |
| Disconnected mode shows last-known state, not blank | Users may be referencing the canvas during a convention. A blank screen during a brief network interruption is worse than stale data with a warning banner. |
| CI/QA indicators on elements, not in a separate panel | Contextual feedback is more useful than requiring the user to switch to a review queue page. The review queue is still accessible from the toolbar for bulk review. |
| Record-level conflict detection (from config-bridge) | Consistent with the config bridge's conflict resolution strategy. Canvas RBAC does not add its own conflict model. |
