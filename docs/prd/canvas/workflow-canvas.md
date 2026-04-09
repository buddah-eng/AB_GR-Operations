# Workflow Canvas

> Auto-generated flow diagrams from WorkflowConfig records. Renders trigger -> condition -> action chains
> as left-to-right flows with typed, color-coded nodes. Editable: drag actions, reorder steps, configure
> via click. Cross-workflow cascade visualization shows chain reactions. Dry-run mode highlights the path
> taken for a real record. Built on the canvas engine.

---

## Overview

The workflow canvas renders workflow configurations as visual flow diagrams. Each WorkflowConfig from Postgres becomes a left-to-right flow: a trigger node, an optional condition diamond, a sequence of action rectangles, and an end marker. The diagram auto-generates from the workflow's JSON configuration — no manual diagram construction is required.

The workflow canvas serves two purposes: understanding existing workflows (visual documentation) and editing workflows (visual programming). Users who prefer the traditional 3-panel workflow builder (`automation/workflow-builder.md`) can use that instead — both interfaces read and write the same `workflow_configs` table in Postgres. Changes made on the canvas appear in the builder, and changes in the builder appear on the canvas.

Beyond single-workflow visualization, the canvas supports cross-workflow cascade views (showing how one workflow's actions trigger another workflow) and dry-run visualization (testing a workflow against a real record and highlighting the path taken).

**Dependencies:** `canvas/canvas-engine.md`, `automation/workflow-engine.md`, `core/ontology-engine.md`, `core/rbac-engine.md`, `ui/builder-to-operator.md`

---

## Full Specification

### 1. Auto-Generation from WorkflowConfig

#### Purpose

Define how a WorkflowConfig record is transformed into a renderable flow diagram.

#### Detail

The workflow canvas reads a WorkflowConfig from Postgres (via `getWorkflowConfig(id)`) and transforms it into Vue Flow nodes and edges:

**Transformation pipeline:**

```
1. Load WorkflowConfig from cache/DB
2. Create TriggerNode from workflow.trigger
3. If workflow.condition exists: create ConditionNode
4. For each workflow.actions[i]: create ActionNode
5. Create EndNode (terminal marker)
6. Create edges connecting the chain:
   - TriggerNode → ConditionNode (or first ActionNode if no condition)
   - ConditionNode → first ActionNode (true branch)
   - ConditionNode → EndNode (false branch, workflow skipped)
   - ActionNode[i] → ActionNode[i+1]
   - Last ActionNode → EndNode
7. Apply hierarchical layout (left-to-right)
8. Load saved positions from canvas_layouts (if any)
```

**WorkflowConfig to node mapping:**

```typescript
// Input: WorkflowConfig from automation/workflow-engine.md
interface WorkflowConfig {
  readonly id: string
  readonly name: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression
  readonly actions: ReadonlyArray<WorkflowAction>
  readonly enabled: boolean
}

// Output: Vue Flow nodes and edges
interface WorkflowCanvasData {
  readonly workflowId: string
  readonly workflowName: string
  readonly nodes: ReadonlyArray<TriggerNode | ConditionNode | ActionNode | ErrorNode | EndNode>
  readonly edges: ReadonlyArray<SequentialEdge | ConditionalEdge | ErrorEdge>
}
```

**Layout:** The hierarchical layout algorithm from `canvas/canvas-engine.md` section 5.2 is used with `rankdir: 'LR'` (left to right). The trigger is at rank 0, condition at rank 1 (if present), actions at sequential ranks, and the end marker at the final rank.

#### Acceptance Criteria

- [ ] WorkflowConfig with 1 trigger + 3 actions renders as a 5-node flow (trigger, 3 actions, end)
- [ ] WorkflowConfig with a condition renders the condition as a diamond between trigger and first action
- [ ] WorkflowConfig with zero actions renders as trigger → end
- [ ] Layout produces a clean left-to-right flow with no overlapping nodes
- [ ] Disabled workflows render with reduced opacity (0.5) and a "Disabled" badge

---

### 2. Node Types

#### Purpose

Define the visual representation of each workflow element type.

#### Detail

##### 2.1 TriggerNode

Represents the workflow trigger — the event or condition that starts the workflow.

```typescript
interface TriggerNodeProps {
  readonly triggerId: string
  readonly triggerType: 'domain_event' | 'field_changed' | 'scheduled' | 'manual'
  readonly eventName: string | null         // e.g., "guest.created"
  readonly fieldName: string | null         // for field_changed: e.g., "status"
  readonly schedule: string | null          // for scheduled: cron expression
  readonly label: string                    // human-readable trigger description
}
```

**Visual:**

| Property | Value |
|----------|-------|
| Shape | Rounded rectangle with a play icon (right-pointing triangle) |
| Size | 180x70px |
| Background color | Varies by trigger type (see color table) |
| Border | 2px solid, darker shade of background |
| Icon | Play triangle, white, left-aligned |
| Label | Trigger description, white text, centered |

**Trigger type colors:**

| Trigger Type | Background | Icon | Description Example |
|-------------|------------|------|---------------------|
| `domain_event` | `--blue-500` | Play | "When guest is created" |
| `scheduled` | `--orange-500` | Clock | "Every 15 minutes" |
| `manual` | `--green-500` | Hand/pointer | "Manual trigger" |
| `field_changed` | `--purple-500` | Edit pencil | "When status changes" |

##### 2.2 ConditionNode

Represents the optional condition that gates workflow execution.

```typescript
interface ConditionNodeProps {
  readonly conditionId: string
  readonly condition: ConditionExpression
  readonly summary: string                  // human-readable, e.g., "Guest type = JP"
}
```

**Visual:**

| Property | Value |
|----------|-------|
| Shape | Diamond (45-degree rotated square) |
| Size | 120x120px (diagonal) |
| Background | `--surface-card` (white/dark) |
| Border | 2px solid `--yellow-500` |
| Icon | Question mark, centered |
| Label | Condition summary, below the diamond |

**Outgoing edges:** Two edges leave the condition node:
- **True branch (right):** Solid arrow labeled "Yes" leading to the first action
- **False branch (down):** Dashed arrow labeled "No" leading to the end node or a "Skip" label

##### 2.3 ActionNode

Represents a single action in the workflow chain.

```typescript
interface ActionNodeProps {
  readonly actionId: string
  readonly actionType: ActionType
  readonly config: Record<string, unknown>
  readonly label: string                    // human-readable action description
  readonly position: number                 // 0-indexed position in the action chain
  readonly hasError: boolean                // known error pattern detected
  readonly lastResult: 'success' | 'failure' | 'never_run' | null
}
```

**Visual:**

| Property | Value |
|----------|-------|
| Shape | Rectangle with rounded corners (8px radius) |
| Size | 200x80px |
| Background | `--surface-card` |
| Border | 2px solid, color varies by action type |
| Icon | Action type icon, left-aligned (see icon table) |
| Label | Action description, centered |
| Position badge | Small number badge in top-left corner (1, 2, 3...) |

**Action type icons and border colors:**

| Action Type | Icon | Border Color |
|-------------|------|-------------|
| `create_record` | Plus circle | `--green-500` |
| `create_records` | Plus circle (double) | `--green-500` |
| `update_record` | Edit pencil | `--blue-500` |
| `delete_record` | Trash | `--red-500` |
| `notify` | Bell | `--cyan-500` |
| `call_api` | Cloud/globe | `--indigo-500` |
| `sync_calendar` | Calendar | `--teal-500` |
| `generate_doc` | Document | `--orange-500` |
| `lookup_registry` | Search/book | `--purple-500` |

**Last result indicator:** A small status dot in the top-right corner of the action node:
- Green dot: last execution succeeded
- Red dot: last execution failed
- Grey dot: never executed
- No dot: result unknown

##### 2.4 ErrorNode

Renders when an action has a known error pattern or repeated failures.

```typescript
interface ErrorNodeProps {
  readonly actionId: string
  readonly errorMessage: string
  readonly failureCount: number
  readonly lastFailureAt: string
}
```

**Visual:**

| Property | Value |
|----------|-------|
| Shape | Rectangle with rounded corners |
| Size | 180x60px |
| Background | `--red-50` (light red) |
| Border | 2px solid `--red-500` |
| Icon | Warning triangle, red |
| Label | Error message summary, red text |

**Placement:** ErrorNodes are positioned below the ActionNode they are attached to, connected by a red dashed ErrorEdge. They appear only when the action has failed in recent executions.

##### 2.5 EndNode

Terminal marker for the workflow flow.

```typescript
interface EndNodeProps {
  readonly type: 'success' | 'skipped'  // skipped = condition was false
}
```

**Visual:** Circle, 40px diameter. Green fill for success path, grey fill for skipped path. No label inside, but a tooltip on hover: "Workflow complete" or "Workflow skipped (condition not met)."

#### Acceptance Criteria

- [ ] All five node types render with distinct, identifiable shapes
- [ ] TriggerNode color matches trigger type
- [ ] ConditionNode renders as a diamond with true/false branches
- [ ] ActionNode shows correct icon and border color per action type
- [ ] ErrorNode appears only for actions with known failures
- [ ] EndNode distinguishes between success and skipped paths
- [ ] Position badges on ActionNodes show correct sequential numbers

---

### 3. Edge Types

#### Purpose

Define the three edge types used in workflow flow diagrams.

#### Detail

##### 3.1 SequentialEdge

Connects workflow elements in sequence: trigger to condition/action, action to action, action to end.

| Property | Value |
|----------|-------|
| Stroke | Solid, 2px |
| Color | `--text-color` (dark grey/white) |
| Arrow | Filled arrowhead at target end |
| Label | None (sequence implied by position) |
| Animated | Optional pulse during dry-run (section 7) |

##### 3.2 ConditionalEdge

Connects a ConditionNode to its true or false branch.

| Property | Value |
|----------|-------|
| Stroke | Dashed, 2px, dash pattern `6 4` |
| Color | `--green-500` for true branch, `--red-400` for false branch |
| Arrow | Filled arrowhead at target end |
| Label | "Yes" on true branch, "No" on false branch |
| Animated | No |

##### 3.3 ErrorEdge

Connects an ActionNode to its ErrorNode.

| Property | Value |
|----------|-------|
| Stroke | Dashed, 1px, dash pattern `4 4` |
| Color | `--red-500` |
| Arrow | No arrowhead |
| Label | None |
| Animated | No |

#### Acceptance Criteria

- [ ] SequentialEdge renders as a solid arrow
- [ ] ConditionalEdge renders as dashed with Yes/No labels
- [ ] ErrorEdge renders as a red dashed line connecting action to error
- [ ] Edge labels do not overlap with nodes
- [ ] All edges use proper arrowheads (or none, for ErrorEdge)

---

### 4. Editing Workflows on Canvas

#### Purpose

Define how users modify workflow configurations through the visual canvas interface.

#### Detail

All editing requires edit mode and `canvas:edit` RBAC permission. Every edit writes to the `workflow_configs` table via the domain CRUD API.

##### 4.1 Add Action

**Trigger:** Drag from the action palette onto the flow.

**Action palette:** A collapsible panel on the left side of the canvas listing all available action types. Each action type is represented as a draggable card with its icon and name.

**Flow:**

1. User drags an action type from the palette
2. As the user drags over the flow, insertion points appear between existing nodes (blue vertical lines)
3. User drops the action at the desired insertion point
4. An action configuration panel opens on the right (480px wide) with fields specific to the action type
5. User configures the action (target concept, field mappings, notification recipients, etc.)
6. User clicks "Add" to confirm
7. Canvas calls `PUT /api/workflow-configs/:id` with the updated action chain
8. On success: new ActionNode appears at the insertion point, subsequent nodes shift right
9. The undo stack records the action addition

**Action configuration fields per type:**

| Action Type | Config Fields |
|-------------|---------------|
| `create_record` | Target concept (dropdown), default values (key-value pairs), link field |
| `notify` | Recipients (role selector), template name (dropdown) |
| `call_api` | Target integration (dropdown), template name |
| `update_record` | Target concept, field updates (key-value pairs) |
| `generate_doc` | Template name (dropdown) |

##### 4.2 Reorder Actions

**Trigger:** Drag an ActionNode to a different position in the chain.

**Flow:**

1. User clicks and holds an ActionNode in edit mode
2. Node lifts (scale up 1.05, shadow added)
3. As the user drags, insertion points appear between other nodes
4. User drops the node at the new position
5. Canvas re-indexes the action chain (updates position numbers)
6. Canvas calls `PUT /api/workflow-configs/:id` with the reordered action array
7. Nodes animate to their new positions over 300ms
8. Undo stack records the reorder

**Constraints:** The trigger node and condition node cannot be reordered. Only ActionNodes can be reordered within the action chain.

##### 4.3 Edit Action Configuration

**Trigger:** Click an ActionNode in edit mode.

**Flow:**

1. Action configuration panel slides out from the right
2. Panel shows the current configuration for the action (same fields as the add flow)
3. User modifies fields
4. User clicks "Save"
5. Canvas calls `PUT /api/workflow-configs/:id` with the updated action configuration
6. ActionNode label updates to reflect the change (e.g., "Create pairing" → "Create VIP pairing")
7. Undo stack records the edit

**Read-only in view mode:** Clicking an ActionNode in view mode opens the configuration panel in read-only mode (all fields disabled).

##### 4.4 Add Condition

**Trigger:** Click the "Add Condition" button that appears between the trigger and first action when no condition exists.

**Flow:**

1. A condition builder UI opens in a modal
2. The condition builder provides a visual interface for constructing ConditionExpressions: field selectors, operator dropdowns, value inputs, and AND/OR logic
3. User builds the condition (e.g., "Guest type equals JP AND status equals Confirmed")
4. User clicks "Apply"
5. Canvas calls `PUT /api/workflow-configs/:id` with the condition added
6. ConditionNode appears between trigger and first action
7. ConditionalEdges (true/false) are created
8. Undo stack records the condition addition

**Edit existing condition:** Click the ConditionNode to reopen the condition builder with the current condition pre-loaded.

**Remove condition:** Right-click ConditionNode → "Remove Condition." The condition is removed from the workflow config, and the ConditionNode and its ConditionalEdges are replaced with a direct SequentialEdge from trigger to first action.

##### 4.5 Delete Action

**Trigger:** Select an ActionNode, then press Delete or right-click → "Remove Action."

**Flow:**

1. Confirmation dialog: "Remove action '{action label}' from this workflow?"
2. On confirm: Canvas calls `PUT /api/workflow-configs/:id` with the action removed from the array
3. ActionNode fades out, remaining nodes shift left to close the gap
4. Undo stack records the deletion

#### Acceptance Criteria

- [ ] Actions can be added from a draggable palette
- [ ] Actions can be reordered by dragging within the chain
- [ ] Clicking an action opens its configuration panel
- [ ] Conditions can be added, edited, and removed
- [ ] Deleting an action removes it from the WorkflowConfig and updates the canvas
- [ ] All edits write to `workflow_configs` via the domain CRUD API
- [ ] All edits are recorded in the undo stack
- [ ] Trigger and condition nodes cannot be reordered by drag

---

### 5. Cross-Workflow Visualization

#### Purpose

Define how related workflows are discovered and rendered as connected flows.

#### Detail

Convention workflows often form chains: workflow A's action creates a record, which emits a domain event, which triggers workflow B. Understanding these chains is critical for debugging cascade behavior and preventing unintended side effects.

**Trigger:** "Show Related Workflows" toggle button in the canvas toolbar. Available when viewing a single workflow.

**Discovery algorithm:**

```
1. For each action in the current workflow:
   a. Determine the domain event that the action would emit:
      - create_record on concept X → emits "X.created"
      - update_record on concept X → emits "X.updated"
      - delete_record on concept X → emits "X.deleted"
   b. Find all enabled workflows whose trigger matches that event:
      - domain_event trigger with matching event pattern
      - field_changed trigger if the action updates the matching field
2. For each discovered downstream workflow:
   a. Render its flow diagram below/to the right of the current workflow
   b. Connect with a CascadeEdge from the originating action to the downstream trigger
   c. Recursively discover further downstream workflows (max depth: 3)
3. For upstream discovery:
   a. Find the domain event pattern in the current workflow's trigger
   b. Find all workflows whose actions could emit that event
   c. Render upstream workflows above/to the left, connected with CascadeEdge
```

**CascadeEdge rendering:**

| Property | Value |
|----------|-------|
| Stroke | Dashed, 3px, dash pattern `10 5` |
| Color | `--orange-500` |
| Arrow | Large filled arrowhead |
| Label | "triggers: {event name}" |
| Animated | Yes (slow pulse, 4 seconds per traversal) |

**Layout:** Related workflows are arranged vertically. The primary workflow is centered. Downstream workflows are positioned to the right and below, indented by one rank. Upstream workflows are positioned to the left and above. CascadeEdges route between the workflows.

**Cascade chain numbering:** Each step in the cascade is numbered. The primary workflow is step 1, its downstream workflows are step 2, their downstream workflows are step 3, and so on. Numbers are shown as badges on the CascadeEdges.

**Depth limit:** Maximum cascade depth is 3 to prevent visual overload. A "More workflows beyond this depth" indicator appears at the boundary. Clicking it opens a list of additional workflows.

#### Acceptance Criteria

- [ ] "Show Related Workflows" discovers workflows triggered by the current workflow's actions
- [ ] Upstream workflows (those that trigger the current workflow) are also discovered
- [ ] CascadeEdges connect originating actions to downstream triggers
- [ ] Cascade chains are numbered sequentially
- [ ] Maximum depth of 3 prevents unbounded expansion
- [ ] Each related workflow renders as a complete flow diagram
- [ ] Clicking a related workflow navigates to its own workflow canvas view

---

### 6. Dry-Run Visualization

#### Purpose

Define how users can test a workflow against a real record and see which path was taken.

#### Detail

Dry-run mode allows users to select a real record from the workflow's trigger concept and simulate the workflow execution, visually highlighting which path was followed — which edges were traversed, which actions would execute, and which conditions passed or failed.

**Trigger:** "Dry Run" button in the canvas toolbar.

**Flow:**

1. User clicks "Dry Run"
2. A record picker dialog opens, pre-filtered to the trigger concept (e.g., if the workflow triggers on `guest.created`, the picker shows guest records)
3. User selects a record
4. Canvas calls `POST /api/workflow-configs/:id/dry-run` with the record ID
5. Server evaluates the workflow against the record data WITHOUT executing any actions:
   - Evaluates the condition against the record's field values
   - Determines which actions would execute
   - Returns the execution path (which elements are active/inactive)
6. Canvas receives the dry-run result and applies visual highlighting

**Dry-run API response:**

```typescript
interface DryRunResult {
  readonly workflowId: string
  readonly recordId: string
  readonly conditionResult: boolean | null     // null if no condition
  readonly conditionEvalDetail: string         // human-readable, e.g., "type = 'JP' → true"
  readonly actionResults: ReadonlyArray<{
    readonly actionIndex: number
    readonly wouldExecute: boolean
    readonly reason: string                   // e.g., "Would create pairing record"
    readonly previewData: Record<string, unknown> | null  // what the action would produce
  }>
  readonly executionPath: ReadonlyArray<string>  // ordered list of node IDs that would fire
}
```

**Visual highlighting:**

| Element | Active Path (would execute) | Inactive Path (would not execute) |
|---------|---------------------------|----------------------------------|
| SequentialEdge | Green, 3px, animated pulse | Grey, 1px, no animation |
| ConditionalEdge (true) | Green if condition passed | Grey if condition failed |
| ConditionalEdge (false) | Grey if condition passed | Red if condition failed |
| TriggerNode | Green glow border | Normal (always active) |
| ConditionNode | Green border if passed, red if failed | N/A |
| ActionNode | Green border + checkmark overlay | Grey border + skip overlay |
| EndNode | Green if reached via action chain | Grey if reached via false branch |

**Action preview:** Hovering over an active ActionNode during dry-run shows a tooltip with the `previewData` — what the action would create/update/notify. For example, hovering a `create_record` action shows the default values that would be set.

**Exiting dry-run:** Click "Exit Dry Run" in the toolbar, or press Escape. The canvas returns to normal rendering.

#### Acceptance Criteria

- [ ] Dry-run evaluates the workflow against a real record without executing actions
- [ ] Active path is highlighted in green with animated edges
- [ ] Inactive path is dimmed in grey
- [ ] Condition result (true/false) is visually indicated on the ConditionNode
- [ ] Action preview data is available on hover for active actions
- [ ] Dry-run can be exited cleanly, restoring normal canvas rendering
- [ ] Dry-run requires read permission on the trigger concept's records

---

### 7. Integration with System Graph

#### Purpose

Define how workflows appear in the system graph and how users navigate between the system graph and workflow canvas.

#### Detail

Workflows are surfaced in the system graph at two levels:

**Level 2 (Department View) — Workflow indicators:**

When the workflow overlay is active on the system graph (`canvas/system-graph.md` section 6), concepts with attached workflows show:
- A pulsing animation on the concept node border (color matches trigger type)
- Small workflow count badge: "3 workflows" if multiple workflows attach to the concept
- Animated flow indicators on relationship edges where a workflow action crosses concept boundaries (e.g., a workflow on `guest` that creates a `pairing` record shows an animated arrow from guest to pairing)

**Level 3 (Concept View) — Workflow list:**

When a concept is expanded to Level 3 (focused mode), the property panel includes a "Workflows" tab listing all workflows that trigger on events from this concept. Each entry shows: workflow name, trigger type icon, enabled/disabled status, and a "View" button.

**Navigation:**

| Action | Result |
|--------|--------|
| Click workflow indicator on system graph | Popover with workflow summary + "Open in Workflow Canvas" button |
| Click "Open in Workflow Canvas" | Navigate to `/canvas/workflows/{workflowId}` |
| Click "View" in concept Level 3 workflow list | Navigate to `/canvas/workflows/{workflowId}` |
| "Back to System Graph" button in workflow canvas toolbar | Navigate to `/canvas/system-graph?focus={triggerConceptKey}` |

**Deep linking:**

```
/canvas/workflows/{workflowId}                     → view this workflow
/canvas/workflows/{workflowId}?mode=edit            → view in edit mode
/canvas/workflows/{workflowId}?dry-run={recordId}   → open with dry-run pre-loaded
/canvas/workflows/{workflowId}?show-related=true    → open with related workflows visible
```

#### Acceptance Criteria

- [ ] System graph workflow overlay shows correct indicators per concept
- [ ] Clicking an indicator opens a popover with workflow summary
- [ ] "Open in Workflow Canvas" navigates to the correct workflow
- [ ] "Back to System Graph" returns to the system graph focused on the trigger concept
- [ ] Deep link parameters restore the correct state (mode, dry-run, related)

---

### 8. Integration with Builder

#### Purpose

Define navigation between the workflow canvas and the traditional 3-panel workflow builder.

#### Detail

The workflow canvas and the workflow builder (`automation/workflow-builder.md`) are parallel interfaces for the same `workflow_configs` data. Users should be able to switch between them based on their preference.

**Canvas to Builder:**

| Trigger | Target |
|---------|--------|
| "Open in Workflow Builder" button in canvas toolbar | Builder workflow edit page: `/builder/workflows/{workflowId}` |
| Right-click ActionNode → "Edit in Builder" | Builder workflow edit page, scrolled to the action panel |
| Right-click TriggerNode → "Edit Trigger in Builder" | Builder workflow edit page, trigger panel focused |

**Builder to Canvas:**

| Trigger | Target |
|---------|--------|
| "View on Canvas" button in builder workflow list | Workflow canvas: `/canvas/workflows/{workflowId}` |
| "Visual Preview" button in builder workflow edit | Workflow canvas for that workflow |

**Synchronization:** When the workflow canvas is open and the same workflow is edited in the builder (different tab/user), the canvas receives the change via SSE and re-renders. A notification shows: "This workflow was updated. Canvas refreshed."

#### Acceptance Criteria

- [ ] "Open in Workflow Builder" navigates to the builder with the correct workflow loaded
- [ ] "View on Canvas" from builder opens the workflow canvas
- [ ] Changes made in builder are reflected on the canvas via SSE within 2 seconds
- [ ] Both interfaces read from and write to the same `workflow_configs` table

---

### 9. RBAC for Workflow Canvas

#### Purpose

Define permission requirements for viewing and editing workflows on the canvas.

#### Detail

| Action | Required Permission |
|--------|-------------------|
| View workflow canvas | `canvas:view` screen access + `canView` on `workflow_config` concept |
| View workflow details (action configs) | `canView` on `workflow_config` concept |
| Edit workflow (add/reorder/delete actions) | `canvas:edit` screen access + `canEdit` on `workflow_config` concept |
| Run dry-run | `canView` on `workflow_config` + `canView` on the trigger concept's records |
| View related workflows | `canView` on all related `workflow_config` records (non-viewable workflows are hidden from cascade) |
| Trigger manual workflow | `workflow:execute` permission |

**Cross-department workflows:** Workflows that span multiple departments (e.g., GR trigger creates a scheduling record) are visible only to users who have `canView` on both the source and destination concepts. If a user can see the GR concept but not the scheduling concept, the workflow is shown but the scheduling action node displays as "Action in restricted department" without revealing details.

#### Acceptance Criteria

- [ ] Users without `canView` on `workflow_config` cannot access the workflow canvas
- [ ] Edit operations require `canEdit` on `workflow_config`
- [ ] Dry-run requires read access to the trigger concept's records
- [ ] Cross-department action nodes show restricted placeholders for unauthorized concepts
- [ ] Cascade discovery hides workflows the user cannot view

---

### 10. Test Plan

#### 10.1 Auto-Generation Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| AG-01 | Unit | WorkflowConfig with trigger + 3 actions | 5 nodes (trigger, 3 actions, end), 4 sequential edges |
| AG-02 | Unit | WorkflowConfig with condition | 6 nodes (trigger, condition, 3 actions, end), conditional edges present |
| AG-03 | Unit | WorkflowConfig with zero actions | 2 nodes (trigger, end), 1 edge |
| AG-04 | Unit | Disabled workflow | All nodes at 0.5 opacity, "Disabled" badge on trigger |
| AG-05 | Unit | Trigger type color mapping | Blue for domain_event, orange for scheduled, green for manual, purple for field_changed |

#### 10.2 Node Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| NR-01 | Unit | TriggerNode renders with correct icon per trigger type | Play/clock/hand/pencil icon matches type |
| NR-02 | Unit | ConditionNode renders as diamond | Diamond shape, "?" icon, condition summary label |
| NR-03 | Unit | ActionNode renders with correct icon per action type | 9 action types have correct icons |
| NR-04 | Unit | ActionNode position badge | Sequential numbers (1, 2, 3) correct |
| NR-05 | Unit | ErrorNode renders below failed action | Red box positioned below ActionNode, connected by ErrorEdge |
| NR-06 | Unit | EndNode success vs. skipped | Green circle for success, grey for skipped |
| NR-07 | Unit | Action last-result indicator | Green/red/grey dot matches execution history |

#### 10.3 Edge Rendering Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| ER-01 | Unit | SequentialEdge renders solid arrow | 2px solid with arrowhead |
| ER-02 | Unit | ConditionalEdge true branch | Green dashed with "Yes" label |
| ER-03 | Unit | ConditionalEdge false branch | Red dashed with "No" label |
| ER-04 | Unit | ErrorEdge renders red dashed | 1px red dashed, no arrowhead |

#### 10.4 Editing Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| ED-01 | Integration | Drag action from palette to flow | Action added to WorkflowConfig, node appears on canvas |
| ED-02 | Integration | Reorder actions by dragging | WorkflowConfig action array reordered, nodes animate |
| ED-03 | Integration | Click action → edit config → save | WorkflowConfig updated, action label refreshed |
| ED-04 | Integration | Add condition via "Add Condition" button | Condition added, ConditionNode and ConditionalEdges appear |
| ED-05 | Integration | Remove condition | Condition removed, direct edge from trigger to first action |
| ED-06 | Integration | Delete action | Action removed from config, node fades out |
| ED-07 | Integration | Undo action addition | Action removed from config, node removed |
| ED-08 | Integration | Redo after undo | Action restored |
| ED-09 | Integration | Edit without `canEdit` permission | Edit mode disabled |

#### 10.5 Cross-Workflow Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| CW-01 | Integration | Workflow A creates guest → discover workflows triggered by guest.created | Related workflows rendered below |
| CW-02 | Integration | Upstream discovery: find workflows that create the trigger event | Upstream workflow rendered above |
| CW-03 | Integration | Cascade depth 3 | Three levels of related workflows, "more beyond" indicator at boundary |
| CW-04 | Integration | Cascade numbering | Step 1, 2, 3 badges on CascadeEdges |
| CW-05 | Integration | Click related workflow | Navigate to that workflow's canvas view |
| CW-06 | Integration | Related workflow user cannot view | Excluded from cascade display |

#### 10.6 Dry-Run Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| DR-01 | Integration | Dry-run with condition = true | Active path highlighted green, true branch green |
| DR-02 | Integration | Dry-run with condition = false | False branch red, actions grey, skipped end node |
| DR-03 | Integration | Dry-run action preview on hover | Tooltip shows what the action would produce |
| DR-04 | Integration | Exit dry-run | Canvas returns to normal rendering |
| DR-05 | Integration | Dry-run without read permission on trigger concept records | 403 error, user informed |
| DR-06 | Unit | Dry-run API evaluates without executing | No records created/updated, no notifications sent |

#### 10.7 Integration Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| IN-01 | Integration | "Open in Workflow Builder" navigation | Builder opens with correct workflow loaded |
| IN-02 | Integration | "View on Canvas" from builder | Canvas opens with correct workflow rendered |
| IN-03 | Integration | Workflow edited in builder while canvas is open | Canvas refreshes via SSE within 2 seconds |
| IN-04 | Integration | System graph workflow indicator → "Open in Workflow Canvas" | Canvas opens for correct workflow |
| IN-05 | Integration | Deep link with dry-run record ID | Canvas opens with dry-run pre-loaded |

#### 10.8 Performance Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| PF-01 | Performance | Render workflow with 10 actions | Under 500ms |
| PF-02 | Performance | Render cascade with 3 levels, 5 workflows total | Under 1 second |
| PF-03 | Performance | Dry-run evaluation on server | Under 200ms response time |
| PF-04 | Performance | Layout animation for reorder | Smooth 60fps, under 300ms |

**Coverage target:** >=80% on auto-generation, editing flows, and dry-run logic. 100% on node type rendering and edge type rendering.

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/canvas-engine.md` | Workflow canvas is built on the canvas engine |
| `automation/workflow-engine.md` | Workflow canvas reads and writes WorkflowConfig data |
| `automation/workflow-actions.md` | Action type definitions used for node rendering and config panels |
| `core/ontology-engine.md` | Action target concepts referenced from the ontology |
| `core/rbac-engine.md` | Canvas visibility and editing gated by permissions |
| `core/condition-expression.md` | Condition builder UI constructs ConditionExpressions |
| `core/event-bus.md` | Real-time sync via SSE, cascade discovery via event patterns |
| `canvas/system-graph.md` | Workflow overlay on the system graph links to workflow canvas |
| `ui/builder-to-operator.md` | Config panel reuses builder form rendering |
| `api/domain-crud.md` | All edits write through the domain CRUD API |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Left-to-right flow layout, not top-to-bottom | Workflows are sequential processes. Left-to-right matches how users read (Western languages) and how flowcharts are typically drawn in process documentation. It also uses horizontal screen space more efficiently than vertical. |
| Diamond shape for conditions | Industry-standard flowchart convention. Users immediately recognize diamonds as decision points without needing a legend. |
| Dry-run evaluates without executing | Executing workflows against production data for testing is dangerous. Dry-run provides the same diagnostic value (which path would be taken) without side effects. Server-side evaluation ensures the result is accurate. |
| Cross-workflow cascade depth limited to 3 | Unlimited cascade rendering would produce unreadable diagrams for deeply chained workflows. Three levels covers the vast majority of real cascade scenarios (trigger → first action → second action). Deeper chains indicate a design issue that should be addressed by simplifying the workflow architecture. |
| Action palette as a draggable panel | Drag-and-drop is the natural interaction for visual flow building. The palette provides discoverability (users can see all available action types) and the insertion-point UI makes it clear where the action will land in the chain. |
| Canvas and builder are parallel, not exclusive | Some users prefer visual editing (canvas). Others prefer form-based editing (builder). Forcing all users into one paradigm reduces productivity. Both interfaces write to the same `workflow_configs` table, so there is no sync risk. |
| ErrorNodes rendered only for recent failures | Showing error history for every action that has ever failed would clutter the canvas. Recent failures (within the current convention cycle) are the most actionable and relevant. Historical failures are accessible via the audit log. |
