# Canvas as Onboarding

> The system graph canvas as the primary onboarding tool for department leaders. First-time experience
> introduces the department's data model visually. Interactive tour highlights concepts, relationships,
> and workflows. Quick actions from canvas nodes. Department-scoped view. Relationship drawing.
> "What if" mode for risk-free exploration.

---

## Overview

The system graph canvas (`canvas/system-graph.md`) is an interactive visualization of the ontology. For a department director logging in for the first time, it is also the most powerful onboarding tool: a visual map of "this is everything your department manages and how it connects."

Most department leaders are domain experts, not data modelers. They think in terms of "guests," "events," and "prep checklists" -- not "concepts," "properties," and "relationships." The canvas bridges this gap by presenting the data model in the language the director already speaks: a map of things and connections.

This PRD defines the first-time experience, interactive tour, quick actions, department-scoped view, and "what if" mode that transform the system graph from a power-user tool into an onboarding experience.

**What this PRD covers:** First-time canvas experience for department leaders, interactive tour, quick actions from canvas nodes, department-scoped view as default, relationship drawing as onboarding, workflow overlay as explanation, and "what if" mode for exploration.

**What this PRD does NOT cover:** The system graph itself (that's `canvas/system-graph.md`). The canvas engine (that's `canvas/canvas-engine.md`). The canvas-config bridge (that's `canvas/canvas-config-bridge.md`). Canvas RBAC (that's `canvas/canvas-rbac.md`).

**Dependencies:**
- `canvas/system-graph.md` -- the system graph this PRD extends with onboarding
- `canvas/canvas-engine.md` -- rendering infrastructure
- `canvas/canvas-config-bridge.md` -- bidirectional binding for edits
- `canvas/canvas-rbac.md` -- permission-aware rendering
- `core/ontology-engine.md` -- ontology data displayed on canvas
- `core/ontology-scoping.md` -- department-scoped filtering
- `core/rbac-engine.md` -- user role detection for tutorial triggers
- `ui/builder-guided-experience.md` -- complementary guided UX for builders
- `platform/branding.md` -- canvas styling follows branding

---

## Full Specification

### 1. First-Time Experience

**Purpose:** Define what a department director sees the first time they open the canvas.

**Detail:**

When a user with the `director` or `assistant_director` role opens the system graph canvas for the first time (tracked via `staff.properties.canvas_onboarding_completed`), the canvas loads with a tailored first-time experience.

**Entry conditions:**
- User role is `director` or `assistant_director`
- `staff.properties.canvas_onboarding_completed` is `false` or undefined
- Department has at least one concept (from template application or manual creation)

**First-time sequence:**

1. **Welcome overlay:** A semi-transparent overlay with centered text:
   ```
   Welcome to your department's data model.

   This map shows everything [Department Name] manages
   and how it all connects.

   Each node is a type of thing you track.
   Lines show how they relate to each other.

   [Take the Tour]     [Explore on My Own]
   ```

2. **Auto-zoom:** If "Explore on My Own" is clicked, the canvas auto-zooms to department level (Level 2 from `canvas/system-graph.md` section 2) centered on the user's department, with a smooth 1-second animation.

3. **Tour start:** If "Take the Tour" is clicked, the interactive tour begins (section 2).

**Empty state:** If the department has zero concepts (blank department, no template applied):
```
Your department doesn't have any data types yet.

You can:
• Browse templates to get started  [Browse Templates]
• Create your first concept here   [+ New Concept]
```

**Acceptance Criteria:**
- [ ] Welcome overlay appears on first canvas visit for directors
- [ ] Canvas auto-zooms to department level on "Explore"
- [ ] Tour begins on "Take the Tour"
- [ ] Empty state shows actionable options (templates or create)
- [ ] First-time detection uses staff.properties flag (not cookies or localStorage)
- [ ] Overlay does not appear on subsequent visits

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| FTE-01 | Integration | Director opens canvas for first time | Welcome overlay shown |
| FTE-02 | Integration | Click "Explore on My Own" | Canvas zooms to department level |
| FTE-03 | Integration | Click "Take the Tour" | Tour begins at step 1 |
| FTE-04 | Integration | Director opens canvas for second time | No overlay, canvas loads normally |
| FTE-05 | Integration | Department with zero concepts | Empty state with template/create options |
| FTE-06 | Integration | Non-director role opens canvas | No onboarding overlay |

---

### 2. Interactive Tour

**Purpose:** Walk directors through their department's data model with contextual explanations.

**Detail:**

The interactive tour is a guided sequence of spotlights and explanations that teaches the director what they are looking at and what they can do.

**Tour steps (dynamically generated from department ontology):**

| Step | Element | Explanation | Action |
|------|---------|-------------|--------|
| 1 | Department region | "This is {Department Name}'s area. Everything inside this boundary belongs to your department." | None (read) |
| 2 | First concept node (e.g., "Guest") | "This is a '{Concept Name}'. It represents a type of thing you manage. You currently have {count} {concept plural} in the system." | Click node to see detail |
| 3 | Properties inside expanded node | "Each item in this list is a piece of information you track about a {concept name}. For example, '{property label}' is a {property type description}." | None (read) |
| 4 | A relationship edge | "This line means '{source} {relationship label} {target}'. For example, 'Guest has many Pairings' means each guest can be assigned multiple staff members." | None (read) |
| 5 | Workflow indicator (if any) | "This pulsing glow means something happens automatically when a {concept name} changes. For example, when a guest is confirmed, the system creates a prep checklist." | Click to see workflow details |
| 6 | Quick action menu | "Right-click any node to do things: add a field, edit the form, view records, or open the builder." | Right-click the node |
| 7 | Relationship drawing | "You can connect concepts by dragging from one to another. This creates a relationship between them." | Draw a relationship (if in edit mode) |
| 8 | Toolbar overlays | "These toggles show additional layers: data flows between concepts and automated workflows." | Toggle workflow overlay |
| 9 | Canvas navigation | "Zoom in to see more detail. Zoom out to see the big picture. Double-click a node to expand it." | Zoom in/out |
| 10 | Completion | "You now understand your department's data model. You can customize it anytime using the builder or directly on this canvas. Click 'Help' in the toolbar to restart this tour." | None (celebration) |

**Dynamic generation:** Steps 2-5 are generated from the department's actual ontology data. If the department has 8 concepts, the tour highlights the first 2-3 most important ones (determined by relationship count -- more relationships = more central = highlighted first). The tour does not cover every concept -- it teaches the pattern so the director can explore the rest.

**Tour UX:**
- Same spotlight overlay pattern as the builder tutorial (`ui/builder-guided-experience.md` section 6)
- "Next", "Previous", and "End Tour" buttons on each tooltip
- Progress indicator (step X of 10)
- Tour pauses if the user interacts with the canvas outside the tour flow (e.g., clicks a different node) and offers "Resume Tour" or "End Tour"

**Tour completion:** On completion, `staff.properties.canvas_onboarding_completed` is set to `true`. The tour can be restarted from the canvas toolbar help menu.

**Acceptance Criteria:**
- [ ] Tour dynamically generates steps from department ontology
- [ ] Tour highlights 2-3 most connected concepts
- [ ] Each step has a clear, jargon-free explanation
- [ ] Tour can be paused and resumed if the user explores
- [ ] Tour can be restarted from the help menu
- [ ] Tour completion is persisted per user

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| TOUR-01 | E2E | Start tour on GR department (8 concepts) | Tour shows 10 steps, highlights guest/pairing/prep |
| TOUR-02 | Integration | Tour step 2 highlights most-connected concept | Concept with most relationships highlighted first |
| TOUR-03 | Integration | User clicks a different node mid-tour | Tour pauses with "Resume" / "End" options |
| TOUR-04 | Integration | Complete tour | canvas_onboarding_completed set to true |
| TOUR-05 | Integration | Restart tour from help menu | Tour starts at step 1 |
| TOUR-06 | Integration | Tour on empty department | Tour skips concept steps, shows template/create options |

---

### 3. Quick Actions from Canvas

**Purpose:** Enable directors to perform common tasks directly from canvas nodes without navigating to the builder.

**Detail:**

Right-clicking a concept node on the canvas opens a context menu with quick actions. These actions are a subset of what the builder provides, surfaced where the director is already looking.

**Context menu items (concept node):**

| Action | Description | Navigates To |
|--------|-------------|-------------|
| View Records | Open the concept's list page in a new tab | `/departments/:key/:concept/list` |
| Add a Field | Open the property creation dialog inline | Inline dialog on canvas |
| Edit the Form | Open the form builder for this concept | `/builder/forms/:conceptKey` |
| Edit the View | Open the view builder for this concept | `/builder/views/:conceptKey` |
| Open in Builder | Open the ontology builder for this concept | `/builder/concepts/:conceptKey` |
| View Workflows | Show workflows attached to this concept | Popover (same as workflow overlay click) |
| Add a Relationship | Start relationship drawing mode from this node | Canvas enters edge-drawing mode |

**Context menu items (relationship edge):**

| Action | Description | Navigates To |
|--------|-------------|-------------|
| Edit Relationship | Open relationship editor | Inline dialog |
| View Related Records | Show records connected via this relationship | List page with filter |
| Remove Relationship | Deprecate the relationship | Confirmation dialog → CI/QA pipeline |

**Context menu items (empty canvas space):**

| Action | Description | Navigates To |
|--------|-------------|-------------|
| New Concept | Create a new concept at this position | Inline creation dialog |
| Browse Templates | Open template library for this department | Template library modal |
| Reset Layout | Re-run the layout algorithm | Canvas re-layout |

**Inline dialogs:** "Add a Field" and "New Concept" open lightweight dialogs directly on the canvas (not full-page navigation). The dialog collects minimal information (name, type) and creates the element immediately. The director can add more detail later in the builder.

**RBAC enforcement:** Context menu items are filtered by the user's permissions. A coordinator without edit access will not see "Add a Field" or "New Concept." Items the user cannot perform are omitted entirely (not disabled), consistent with `canvas/system-graph.md` section 8.

**Acceptance Criteria:**
- [ ] Right-click on concept node shows context menu with quick actions
- [ ] "View Records" opens the concept's list page
- [ ] "Add a Field" opens an inline dialog and creates the property
- [ ] "Edit the Form" navigates to the form builder
- [ ] RBAC-filtered: users without edit permission do not see edit actions
- [ ] Right-click on empty space shows "New Concept" and "Browse Templates"
- [ ] Inline dialogs create elements without full-page navigation

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| QA-01 | Integration | Right-click concept node | Context menu with 7 items shown |
| QA-02 | Integration | Click "View Records" | List page opens in new tab |
| QA-03 | Integration | Click "Add a Field" → enter name + type | Property created, node updates |
| QA-04 | Integration | Right-click as coordinator without edit access | Only "View Records" and "View Workflows" shown |
| QA-05 | Integration | Right-click empty space | "New Concept" and "Browse Templates" shown |
| QA-06 | Integration | "Add a Relationship" → drag to another node | Relationship created via canvas-config bridge |

---

### 4. Department-Scoped View

**Purpose:** Define the default canvas view for department leaders -- showing only their department's concepts.

**Detail:**

When a director opens the system graph, the canvas defaults to a department-scoped view that shows only:
1. Concepts owned by their department (`owner_department = user's department`)
2. Org-wide concepts that the department uses (i.e., org-wide concepts that have relationships with department concepts)
3. Cross-department concepts explicitly shared via RBAC

This is different from the admin view, which shows all departments at Level 1 zoom.

**Scope toggle:** The canvas toolbar includes a scope toggle:

| Scope | What's Visible | Default For |
|-------|---------------|-------------|
| My Department | Department concepts + used org-wide concepts | Directors, coordinators |
| All Departments | Full system graph (Level 1 view) | Admins |

The scope toggle is only visible to users who have cross-department view permissions. A director who can only see their own department does not see the toggle.

**Org-wide concept rendering:** Org-wide concepts that appear in the department view (because they have relationships with department concepts) are rendered with a distinct style:
- Lighter fill color (20% opacity of the org-wide concept's color)
- "Shared" badge in the corner
- Non-editable (lock icon in edit mode)
- Tooltip: "This is a shared concept managed by the admin team. Your department uses it but cannot modify it."

**Focused navigation:** Double-clicking a department-owned concept zooms to Level 3 (concept detail). Double-clicking an org-wide concept in the department view shows the concept's properties but marks them as read-only.

**Acceptance Criteria:**
- [ ] Directors see department-scoped view by default
- [ ] Department-scoped view includes department concepts + used org-wide concepts
- [ ] Org-wide concepts are visually distinct (lighter, "Shared" badge)
- [ ] Scope toggle switches between department and all-departments view
- [ ] Scope toggle is hidden for users without cross-department access
- [ ] Org-wide concepts are non-editable by directors

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| SCOPE-01 | Integration | GR director opens canvas | Only GR concepts + shared concepts visible |
| SCOPE-02 | Integration | Admin opens canvas | All departments visible at Level 1 |
| SCOPE-03 | Integration | Director toggles to "All Departments" | Full system graph shown |
| SCOPE-04 | Integration | Org-wide concept in department view | Lighter fill, "Shared" badge, lock icon in edit mode |
| SCOPE-05 | Integration | Director double-clicks org-wide concept | Properties shown as read-only |
| SCOPE-06 | Integration | Coordinator without cross-dept access | No scope toggle visible |

---

### 5. Relationship Drawing as Onboarding

**Purpose:** Make relationship creation intuitive for directors who think in terms of "this connects to that."

**Detail:**

The canvas-config bridge (`canvas/canvas-config-bridge.md`) already supports relationship drawing. This section defines the onboarding layer that makes it accessible to non-technical users.

**Enhanced relationship creation dialog:**

When a director draws an edge between two concepts, instead of the raw relationship configuration dialog from `canvas/system-graph.md` section 3.2, the onboarding layer shows a guided version:

```
┌─────────────────────────────────────────────┐
│  How are these connected?                   │
│                                             │
│  [Guest icon] Guest  →  [Staff icon] Staff  │
│                                             │
│  Each guest...                              │
│  ○ has one Staff member        (has-one)    │
│  ● has many Staff members      (has-many)   │
│  ○ is shared with Staff        (many-many)  │
│                                             │
│  We call this connection:                   │
│  [ pairings_______ ]  (auto-suggested)      │
│                                             │
│  What does the Staff member do?             │
│  [ liaison________ ]  (role label)          │
│                                             │
│  [Cancel]                     [Connect]     │
└─────────────────────────────────────────────┘
```

**Auto-suggestions:** The system suggests relationship labels based on:
- Common convention operations patterns (e.g., guest → staff = "pairings")
- The concepts involved (e.g., if both have schedule_event connections, suggest "assignments")
- Existing relationship patterns in the department

**Plain language cardinality:** Instead of "has-one / has-many / many-to-many," the dialog uses:
- "has one [target]" -- each guest has one primary liaison
- "has many [targets]" -- each guest can have multiple staff assigned
- "is shared with [targets]" -- guests and staff can be connected in both directions

**Acceptance Criteria:**
- [ ] Relationship creation shows guided dialog (not raw config form)
- [ ] Cardinality options use plain language
- [ ] Relationship label is auto-suggested
- [ ] Dialog shows concept icons and names for visual context
- [ ] Created relationship is valid and writes through the canvas-config bridge

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| REL-01 | Integration | Draw edge guest → staff | Guided dialog shown with auto-suggestion "pairings" |
| REL-02 | Integration | Select "has many" and confirm | has_many relationship created |
| REL-03 | Integration | Auto-suggestion for common patterns | Relevant label suggested |
| REL-04 | Integration | Draw edge between uncommon concepts | Generic suggestion offered, editable |

---

### 6. Workflow Overlay as Explanation

**Purpose:** Use the workflow overlay to explain automation to directors in plain language.

**Detail:**

The workflow overlay from `canvas/system-graph.md` section 6 shows workflow indicators on concepts. For onboarding, this PRD adds a plain-language explanation layer.

**When the director activates the workflow overlay:**
- Each workflow indicator shows a tooltip on hover with a human-readable sentence:
  - Instead of: `"trigger: domain_event, event: guest.confirmed, action: create_records, template: jp_prep_checklist"`
  - Shows: `"When a guest is confirmed, the system automatically creates a prep checklist for them."`
- The sentence is generated by the `WorkflowDescriber` utility, which reads the workflow config and produces natural language.

**Workflow overlay introduction (first time):**
When a director first toggles the workflow overlay, a brief tooltip appears:
```
"Workflows are things that happen automatically.
The pulsing glow shows which concepts have automations.
Hover over the glow to see what happens."
```

**"What does this do?" button:**
Each workflow indicator has a "What does this do?" button in its popover that shows:
1. **Trigger:** "When {event} happens..."
2. **Condition:** "...and {condition}..."
3. **Actions:** "...the system will: {action list}"
4. **Example:** "For example, when Guest 'Tanaka Yuki' is confirmed (JP type), the system creates 14 prep items from the JP Guest Checklist template."

**Acceptance Criteria:**
- [ ] Workflow overlay tooltips show human-readable descriptions
- [ ] Descriptions are generated from workflow config (not hardcoded)
- [ ] First-time overlay activation shows an introduction tooltip
- [ ] "What does this do?" popover shows trigger, condition, actions, and example
- [ ] Descriptions use the user language standard

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| WF-01 | Integration | Hover over workflow indicator | Human-readable description shown |
| WF-02 | Integration | Click "What does this do?" | Full trigger/condition/action breakdown shown |
| WF-03 | Unit | WorkflowDescriber for guest.confirmed → create_records | Correct natural language sentence |
| WF-04 | Integration | First toggle of workflow overlay | Introduction tooltip shown |

---

### 7. "What If" Mode

**Purpose:** Let directors explore changes to their data model without saving, reducing the fear of "breaking something."

**Detail:**

"What if" mode is a sandboxed canvas state where the director can add concepts, draw relationships, and see the impact -- without any writes to the database.

**Activation:** A toggle in the canvas toolbar: "What If Mode" (or "Explore Mode"). When active:
- The canvas border changes to a dashed blue line
- A banner appears: "What If Mode: Changes are not saved. Explore freely."
- The canvas enters edit mode visually but all API calls are intercepted and simulated locally

**What the director can do in "What If" mode:**
- Add a concept node (appears locally, not written to DB)
- Draw a relationship (appears locally)
- Remove a concept or relationship (removed locally)
- See the impact of changes on the graph layout
- See which workflows would be affected by concept changes

**What the director CANNOT do in "What If" mode:**
- Save changes directly (no writes to the API)
- Trigger workflows (no domain events)
- Affect other users' views (changes are local only)

**Committing "What If" changes:**
When the director is satisfied with their exploration, they can:
1. Click "Apply Changes" to commit all "what if" changes to the database
2. The system batches all changes into a single change set and sends them through the normal write pipeline (auth, RBAC, CI/QA, audit)
3. If any change fails validation, the entire batch is rejected with per-change error details
4. If all changes pass, they are applied and the "what if" mode exits

**Discarding "What If" changes:**
Clicking "Discard" (or toggling off "What If" mode) removes all local changes and restores the canvas to the last saved state.

**Acceptance Criteria:**
- [ ] "What If" toggle activates sandboxed mode with visual indicator
- [ ] Changes in "What If" mode are local only (no database writes)
- [ ] "Apply Changes" commits all changes through the normal write pipeline
- [ ] "Discard" removes all local changes and restores saved state
- [ ] Other users are not affected by "What If" changes
- [ ] Validation errors on "Apply" show per-change error details
- [ ] Canvas border and banner clearly indicate "What If" mode is active

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| WIF-01 | Integration | Enter "What If" mode, add concept | Concept appears locally, not in DB |
| WIF-02 | Integration | "What If" mode, draw relationship | Relationship appears locally, not in DB |
| WIF-03 | Integration | "What If" mode, click "Discard" | All local changes removed |
| WIF-04 | Integration | "What If" mode, click "Apply Changes" | All changes committed through write pipeline |
| WIF-05 | Integration | "Apply Changes" with validation error | Batch rejected, per-change errors shown |
| WIF-06 | Integration | Another user viewing canvas during "What If" | Other user sees no changes |
| WIF-07 | Integration | "What If" mode visual indicators | Dashed border, banner, all visible |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `canvas/system-graph.md` | The system graph this PRD extends with onboarding UX |
| `canvas/canvas-engine.md` | Rendering infrastructure, interaction modes |
| `canvas/canvas-config-bridge.md` | Bidirectional binding used by quick actions and "Apply Changes" |
| `canvas/canvas-rbac.md` | Permission-aware context menus and editing |
| `core/ontology-engine.md` | Ontology data displayed and explained in tour |
| `core/ontology-scoping.md` | Department-scoped view filtering |
| `core/rbac-engine.md` | Role detection for tutorial triggers |
| `automation/workflow-engine.md` | Workflow data for overlay explanations |
| `ui/builder-guided-experience.md` | Complementary guided UX (builder tutorial pairs with canvas tour) |
| `platform/template-library.md` | "Browse Templates" quick action links to template library |
| `process/user-language-standard.md` | All onboarding text follows user language standard |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Canvas as the first thing directors see (not the builder) | The canvas provides a visual overview that matches how people naturally think about their domain. The builder is for detailed configuration after the director understands the structure. Canvas first, builder second. |
| Dynamic tour from ontology data | A static tutorial would not match each department's unique data model. Generating tour steps from the actual ontology ensures the explanations are always relevant and accurate. |
| Department-scoped by default | Directors care about their department. Showing the entire organization on first load would be overwhelming. Department scoping provides focus. The toggle to "All Departments" exists for the curious. |
| "What If" mode as sandbox | Fear of breaking things is the biggest barrier to configuration. "What If" mode removes that fear entirely by guaranteeing no side effects until explicit commitment. The batch-apply mechanism ensures atomicity. |
| Quick actions replace navigation | Right-click context menus put the action where the context is. Navigating to a separate builder page to add a field loses the visual context of where that field fits in the data model. |
| Plain language workflow descriptions | Workflow configs are JSON -- directors will not read them. Natural language generation (WorkflowDescriber) makes automation understandable without requiring technical knowledge. |
| Org-wide concepts visually distinguished | Directors must understand that some concepts are shared and cannot be modified by them. Visual distinction (lighter color, badge, lock icon) prevents confusion and support requests. |
