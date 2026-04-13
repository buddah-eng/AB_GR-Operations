# Builder Guided Experience

> Making builders usable by non-technical department leaders. Preview mode shows the operator's view
> while editing. Contextual help explains every field type. Default templates replace blank canvases.
> Undo history with visual timeline. Validation warnings prevent operator-confusing configurations.
> First-time tutorial walks through building a simple form step-by-step.

---

## Overview

The builder-to-operator translation (`ui/builder-to-operator.md`) defines how ontology concepts translate to operator-facing UI. The form and view builder (`ui/form-view-builder.md`) provides the drag-and-drop configuration interface. This PRD extends both with guided UX features that make builders accessible to non-technical department leaders -- people who understand their department's workflows but have never configured a data model.

The core insight: department directors at a volunteer-run convention are typically not software developers. They know their domain (guest relations, programming, operations) but they may never have designed a form schema, configured a workflow, or defined a data relationship. The builder must guide them through these tasks with previews, explanations, defaults, undo safety, and validation feedback.

This PRD does not replace the builder interface -- it layers guidance on top of it. An experienced admin can disable the guidance and use the raw builder. A first-time director gets a tutorial, contextual help, template starting points, and a live preview of what their operators will see.

**What this PRD covers:** Preview mode, contextual help system, template starting points for new forms/views, undo history with visual timeline, validation warnings, and first-time builder tutorial.

**What this PRD does NOT cover:** The builder interface itself (that's `ui/form-view-builder.md`). The translation rules (that's `ui/builder-to-operator.md`). Ontology web builder (that's `core/ontology-web-builder.md`).

**Dependencies:**
- `ui/builder-to-operator.md` -- translation rules this PRD's preview mode renders
- `ui/form-view-builder.md` -- the builder interface this PRD extends
- `ui/dynamic-forms.md` -- form rendering used in preview mode
- `ui/view-renderer.md` -- view rendering used in preview mode
- `core/ontology-engine.md` -- property types, concept structure
- `core/ontology-ci-qa.md` -- change validation pipeline
- `data/versioning-backups.md` -- undo backed by version history
- `process/user-language-standard.md` -- all guidance text follows user language

---

## Full Specification

### 1. Preview Mode

**Purpose:** Let builders see what operators will experience while they are editing, eliminating the gap between configuration and outcome.

**Detail:**

The builder gains a split-pane preview mode activated by a toggle button in the builder toolbar: "Preview."

**Layout when preview is active:**

```
┌───────────────────────────┬───────────────────────────┐
│       Builder Panel       │      Preview Panel        │
│                           │                           │
│  [Drag-drop form canvas]  │  [Live rendered form]     │
│                           │                           │
│  ← Builder controls →     │  ← What operators see →   │
│                           │                           │
│  [Field config panel]     │  [With sample data]       │
└───────────────────────────┴───────────────────────────┘
```

**Form builder preview:**
- The right panel renders the form using the `DynamicForm` component from `ui/dynamic-forms.md`
- Sample data is auto-generated per property type (e.g., text = "Sample text", date = today's date, select = first option)
- The preview updates in real-time as the builder makes changes (debounced 200ms)
- The preview shows validation states: required field indicators, conditional visibility (showIf), placeholder text
- The preview is interactive: the admin can fill in fields to see how conditional visibility works

**View builder preview:**
- For table views: the right panel renders a `DynamicView` table with 5 sample rows
- For kanban views: shows columns with 2-3 sample cards each
- For timeline views: shows sample events on a timeline
- For dashboard views: shows widget layout with placeholder data

**Responsive preview:** A device selector (desktop / tablet / mobile) resizes the preview panel to show how the form or view will look on different screen sizes.

**Preview persistence:** Preview mode state (on/off, device size) is stored in `localStorage` and persists across browser sessions.

**Acceptance Criteria:**
- [ ] Preview toggle shows/hides the split-pane preview panel
- [ ] Form preview renders the current form config with sample data in real-time
- [ ] View preview renders the current view config with sample rows in real-time
- [ ] Changes in the builder are reflected in the preview within 200ms
- [ ] Conditional visibility (showIf) is interactive in the preview
- [ ] Device selector shows responsive preview at desktop/tablet/mobile widths
- [ ] Preview mode state persists in localStorage

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| PRV-01 | Integration | Toggle preview on in form builder | Split pane appears with rendered form |
| PRV-02 | Integration | Add a field in builder | Preview updates to include new field |
| PRV-03 | Integration | Set showIf condition on a field | Field visible/hidden in preview based on other field values |
| PRV-04 | Integration | Switch to mobile preview | Form renders at mobile width |
| PRV-05 | Integration | Preview a kanban view | 3 columns with sample cards shown |
| PRV-06 | Unit | Sample data generation for each of 17 types | Appropriate sample data for each type |

---

### 2. Contextual Help System

**Purpose:** Provide in-context explanations for every builder concept so directors understand what they are configuring.

**Detail:**

Every configurable element in the builder has a help icon (?) that opens a contextual help popover. Help text is written in the user language standard (`process/user-language-standard.md`) -- no jargon.

**Property type help (shown when selecting a field type):**

| Type | Help Text |
|------|-----------|
| `text` | "A single line of text. Good for names, titles, and short answers." |
| `rich_text` | "A larger text area with formatting. Good for descriptions, notes, and detailed content." |
| `number` | "A number field with optional min/max limits. Good for quantities, counts, and scores." |
| `select` | "A dropdown menu where the operator picks one option. Good for status, type, and category fields." |
| `multi_select` | "A field where the operator can pick multiple options. Good for tags, skills, and requirements." |
| `date` | "A date picker. Good for deadlines, arrival dates, and milestones." |
| `datetime` | "A date and time picker. Good for event start/end times and scheduled appointments." |
| `checkbox` | "A yes/no toggle. Good for flags like 'confirmed', 'paid', or 'VIP'." |
| `url` | "A web address field. Good for websites, social media links, and document URLs." |
| `email` | "An email address field with format validation." |
| `phone` | "A phone number field." |
| `relation` | "A link to another type of record. For example, linking a guest to their liaison." |
| `formula` | "A calculated value that operators cannot edit. Computed from other fields." |
| `rollup` | "An aggregated value from related records. For example, 'number of prep items completed'." |
| `files` | "A file upload area. Operators can attach documents, images, or other files." |
| `people` | "A person selector. Links to staff members in the system." |
| `status` | "A status field with stages. Operators pick from defined stages like 'Draft', 'Active', 'Complete'." |

**Builder concept help (shown on hover over builder section headers):**

| Concept | Help Text |
|---------|-----------|
| Form sections | "Sections group related fields together. Use sections to organize long forms into logical chunks." |
| Column span | "Controls how wide a field is in a two-column layout. 'Full width' makes it span both columns." |
| Conditional visibility (showIf) | "This field will only appear when a condition is met. For example, show 'Interpreter needed' only when the guest type is 'Japanese'." |
| Required field | "Operators must fill in this field before saving. Use for essential information only -- too many required fields slows down data entry." |
| Default value | "The value that appears automatically when a new record is created. Operators can change it." |
| Layout type | "How the form is arranged. 'Single column' is simple. 'Two columns' saves space. 'Wizard' splits the form into steps -- good for long forms." |
| View type | "How records are displayed. 'Table' is a spreadsheet-like list. 'Kanban' is a board with columns. 'Timeline' shows records on a calendar." |
| Grouping | "Organize the view by a field. For example, group guests by status to see all 'Confirmed' guests together." |

**Help popover behavior:**
- Click the (?) icon to open the popover
- Popover shows: title, explanation, example, and a "Learn more" link (future: links to docs)
- Popover closes on click outside or Escape
- Help text is loaded from a JSONB config table (not hardcoded strings) so it can be updated without deployment

**Acceptance Criteria:**
- [ ] Every property type has a contextual help popover
- [ ] Every builder section has a contextual help popover
- [ ] Help text uses plain language (no technical jargon)
- [ ] Help text is loaded from database (not hardcoded)
- [ ] Help popovers include examples
- [ ] Help popovers are accessible (keyboard navigable, ARIA labels)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| HELP-01 | Integration | Click help icon on "select" type | Popover shows correct help text |
| HELP-02 | Integration | Click help icon on "showIf" section | Popover explains conditional visibility |
| HELP-03 | Unit | All 17 property types have help entries | No missing help text |
| HELP-04 | Integration | Update help text in database | UI reflects new text without deployment |
| HELP-05 | Integration | Navigate help popover with keyboard | Tab, Enter, Escape work correctly |

---

### 3. Default Templates for New Forms and Views

**Purpose:** Offer template starting points instead of blank canvases when creating new forms or views.

**Detail:**

When a director clicks "New Form" or "New View" in the builder, instead of an empty canvas, they see a template picker:

**Form templates:**

| Template | Layout | Fields | Best For |
|----------|--------|--------|----------|
| Simple Form | Single column | Name, status, description, notes | Quick data entry forms |
| Intake Wizard | Wizard (3 steps) | Step 1: basics, Step 2: details, Step 3: review | Onboarding forms, applications |
| Quick Edit | Two column | Most-edited fields only | Inline editing, status updates |
| Detail Form | Two column | All fields grouped by section | Comprehensive data entry |
| Blank | Single column | No fields | Custom from scratch |

**View templates:**

| Template | Type | Configuration | Best For |
|----------|------|---------------|----------|
| Master List | Table | All visible fields, sortable, filterable | Default record browsing |
| Status Board | Kanban | Grouped by status field, drag-drop | Workflow tracking |
| Schedule View | Timeline | Date/datetime fields on timeline | Event scheduling |
| Dashboard | Dashboard | Stat cards + recent activity | Overview pages |
| Blank | Table | No columns | Custom from scratch |

**Template selection flow:**
1. Director clicks "New Form" (or "New View")
2. A modal shows the available templates as visual cards with preview thumbnails
3. Director clicks a template to select it
4. The builder opens with the template pre-applied
5. Director customizes from there

**Template adaptation:** When a template is selected, the system maps the template's placeholder fields to the actual concept's properties:
- Template field "name" → maps to the concept's first `text` property labeled "name" or similar
- Template field "status" → maps to the concept's `status` property (if one exists)
- Unmapped template fields are removed
- Concept properties not in the template are available in the left panel for manual addition

**"Use this template" vs "Start blank":** Both options are always visible. The blank option is never hidden -- experienced builders can skip templates.

**Acceptance Criteria:**
- [ ] "New Form" shows template picker instead of blank canvas
- [ ] "New View" shows template picker instead of blank type selector
- [ ] At least 5 form templates and 5 view templates are available
- [ ] Templates auto-map to the current concept's properties
- [ ] "Start Blank" option is always available
- [ ] Template preview thumbnails show the layout visually

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| TPL-01 | Integration | Create new form → select "Intake Wizard" | 3-step wizard layout with mapped fields |
| TPL-02 | Integration | Create new view → select "Status Board" | Kanban view with status grouping |
| TPL-03 | Integration | Template auto-mapping with no "status" field | Status column/group omitted from template |
| TPL-04 | Integration | Select "Blank" template | Empty builder canvas |
| TPL-05 | Integration | Template preview thumbnail accuracy | Thumbnail matches actual template layout |

---

### 4. Undo History with Visual Timeline

**Purpose:** Provide a visual, navigable undo history so directors can see and restore any previous state of their form or view configuration.

**Detail:**

The builder toolbar includes a "History" button that opens a timeline panel:

```
┌─ History ─────────────────────────────────┐
│                                           │
│  ● Now                                    │
│  │  Added "Phone" field                   │
│  │                                        │
│  ○ 2 minutes ago                          │
│  │  Changed layout to "Two Column"        │
│  │                                        │
│  ○ 5 minutes ago                          │
│  │  Set "Status" field as required        │
│  │                                        │
│  ○ 8 minutes ago                          │
│  │  Added "Email" field                   │
│  │                                        │
│  ○ 12 minutes ago                         │
│  │  Created from "Intake Wizard" template │
│  │                                        │
│  [Restore]                                │
└───────────────────────────────────────────┘
```

**Timeline features:**
- Each entry shows: timestamp (relative), action description (human-readable), and the user who made the change
- Clicking an entry highlights it and shows a preview of what the form/view looked like at that point (using the preview panel from section 1)
- The "Restore" button (at the bottom when a historical entry is selected) reverts the form/view config to that point
- Restore creates a new version (forward-only, per `data/versioning-backups.md`) -- it does not delete history
- The timeline shows the last 50 changes

**Keyboard shortcuts:**
- `Ctrl+Z` (Cmd+Z on Mac): undo last change
- `Ctrl+Shift+Z` (Cmd+Shift+Z): redo
- These are the same shortcuts as the canvas undo/redo from `canvas/canvas-config-bridge.md` section 6

**History persistence:** The history timeline reads from the versioning service (`data/versioning-backups.md`). It is not session-local -- history persists across sessions and is visible to all users with edit access.

**Acceptance Criteria:**
- [ ] History panel shows a chronological list of changes with timestamps and descriptions
- [ ] Clicking a history entry previews that version in the preview panel
- [ ] "Restore" reverts to the selected version without deleting subsequent history
- [ ] Ctrl+Z/Ctrl+Shift+Z work for undo/redo
- [ ] History persists across sessions (backed by versioning service)
- [ ] Last 50 changes are shown in the timeline

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| UNDO-01 | Integration | Make 3 changes, click history | 3 entries shown with descriptions |
| UNDO-02 | Integration | Click a historical entry | Preview shows the form at that point |
| UNDO-03 | Integration | Restore to a historical version | Form reverted, new version created |
| UNDO-04 | Integration | Ctrl+Z after adding a field | Field removed, history entry updated |
| UNDO-05 | Integration | Close browser, reopen → check history | Previous changes still shown |
| UNDO-06 | Integration | Two users editing → both see history | Shared history visible to both |

---

### 5. Validation Warnings

**Purpose:** Proactively warn builders about configurations that will confuse operators, extending the guardrails from `ui/builder-to-operator.md` section 5.

**Detail:**

The builder continuously validates the current configuration and displays warnings in a non-blocking notification area at the bottom of the builder panel.

**Validation rules (extending `builder-to-operator.md` section 5):**

| Rule | Severity | Message |
|------|----------|---------|
| Required field with no default value | Warning | "'{field}' is required but has no default value. Operators will see an error if they leave it blank." |
| Form with 20+ fields in one section | Warning | "This section has {count} fields. Consider splitting into multiple sections or using a wizard layout." |
| Select field with no options defined | Error | "'{field}' is a dropdown with no options. Operators won't be able to select anything." |
| Relation field with no target concept | Error | "'{field}' links to another record type, but no target type is set. Configure the target in field settings." |
| ShowIf condition references non-existent field | Error | "The visibility condition for '{field}' references '{missing_field}' which doesn't exist on this form." |
| Duplicate field labels | Warning | "Two fields are labeled '{label}'. This may confuse operators. Consider renaming one." |
| Hidden field marked as required | Error | "'{field}' is hidden but required. Operators cannot fill in a hidden field." |
| Wizard with only 1 step | Warning | "This wizard has only 1 step. Consider using a single-column layout instead." |
| View with no columns configured | Error | "This view has no columns. Operators will see an empty table." |
| Kanban view with no groupBy field | Error | "A kanban board requires a field to group by. Select a status or category field." |
| Status field with fewer than 2 options | Warning | "'{field}' has only {count} status option. Add at least 2 options (e.g., 'Draft' and 'Active')." |
| Form references deprecated property | Error | "'{field}' references a property that has been deprecated. Remove it or replace with an active property." |

**Validation display:**
- Warnings show as yellow badges in the notification area
- Errors show as red badges
- Clicking a validation message highlights the affected field/section in the builder
- Errors block saving (the form/view config cannot be saved in an invalid state)
- Warnings allow saving but are shown to the builder for awareness

**Real-time validation:** Validation runs on every change (debounced 300ms). The notification area updates without page reload.

**Acceptance Criteria:**
- [ ] All validation rules produce appropriate severity messages
- [ ] Errors block saving; warnings do not
- [ ] Clicking a validation message highlights the affected element
- [ ] Validation runs in real-time as the builder makes changes
- [ ] Messages use plain language (user language standard)
- [ ] Deprecated property references are detected

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| VAL-01 | Unit | Required field with no default | Warning shown |
| VAL-02 | Unit | Select field with no options | Error shown, save blocked |
| VAL-03 | Unit | Hidden + required field | Error shown, save blocked |
| VAL-04 | Integration | Click validation message | Affected field highlighted in builder |
| VAL-05 | Integration | Fix validation error → re-validate | Error disappears, save unblocked |
| VAL-06 | Unit | All 12+ validation rules have tests | Each rule produces correct severity and message |

---

### 6. Builder Tutorial (First-Time Walkthrough)

**Purpose:** Walk first-time builders through creating a simple form step-by-step, teaching the builder's concepts by doing.

**Detail:**

When a user with the `director` role opens the form builder or view builder for the first time (tracked via `staff.properties.builder_tutorial_completed`), a tutorial overlay activates.

**Tutorial flow (form builder):**

| Step | Highlight | Instruction | Action Required |
|------|-----------|-------------|----------------|
| 1 | Left panel (property list) | "These are the fields available in your department. Each one represents a piece of information you track." | None (read) |
| 2 | A specific property | "Let's add the 'Name' field to your form. Drag it from here to the form canvas." | Drag 'name' to canvas |
| 3 | Center panel (form canvas) | "This is where you arrange fields. The order here is the order operators will see." | None (read) |
| 4 | Right panel (field config) | "Click a field to configure it. You can change the label, add help text, or make it required." | Click the placed field |
| 5 | Required toggle | "Toggle this to make the field required. Operators must fill it in before saving." | Toggle required |
| 6 | Preview toggle | "Click Preview to see what this form looks like to your team." | Click preview |
| 7 | Preview panel | "This is exactly what your operators will see. Every change you make on the left appears here in real-time." | None (read) |
| 8 | Layout picker | "Try changing the layout. 'Two Column' makes forms wider. 'Wizard' splits them into steps." | Select a layout |
| 9 | Save button | "Click Save to publish this form. Your team can use it immediately." | Click save |
| 10 | Completion | "You just built your first form. You can always come back to edit it, and the History button lets you undo any change." | None (celebration) |

**Tutorial UX:**
- Spotlight overlay: the current element is highlighted while the rest of the screen is dimmed
- Tooltip with instruction text appears near the highlighted element
- "Next" and "Skip Tutorial" buttons on each tooltip
- Progress indicator shows step X of 10
- Tutorial can be restarted from the builder's help menu

**Tutorial for view builder:** A similar 8-step tutorial covering: column selection, sort configuration, filter setup, groupBy for kanban, and preview.

**Tutorial completion:** On completion, `staff.properties.builder_tutorial_completed` is set to `true`. The tutorial does not appear again unless the user clicks "Restart Tutorial" from the help menu.

**Acceptance Criteria:**
- [ ] Tutorial activates on first builder visit for directors
- [ ] Tutorial walks through 10 steps with spotlight highlights
- [ ] Tutorial can be skipped at any step
- [ ] Tutorial can be restarted from the help menu
- [ ] Tutorial completion is persisted per user
- [ ] Tutorial produces a working form at the end (not just a walkthrough)

**Test Plan:**

| Test | Type | What | Expected |
|------|------|------|----------|
| TUT-01 | E2E | First-time director opens form builder | Tutorial starts at step 1 |
| TUT-02 | E2E | Complete all 10 steps | Form created, tutorial marked complete |
| TUT-03 | Integration | Skip tutorial at step 3 | Tutorial dismissed, builder_tutorial_completed not set |
| TUT-04 | Integration | Restart tutorial from help menu | Tutorial restarts at step 1 |
| TUT-05 | Integration | Second visit after completing tutorial | Tutorial does not appear |
| TUT-06 | Integration | Admin opens builder (not first time) | No tutorial (admin role skips tutorial) |

---

## Dependencies

| PRD | Relationship |
|-----|-------------|
| `ui/builder-to-operator.md` | Translation rules and guardrails (section 5) extended by this PRD |
| `ui/form-view-builder.md` | The builder interface this PRD adds guidance to |
| `ui/dynamic-forms.md` | Form rendering engine used in preview mode |
| `ui/view-renderer.md` | View rendering engine used in preview mode |
| `core/ontology-engine.md` | Property types referenced by contextual help |
| `core/ontology-ci-qa.md` | Validation pipeline for saved configs |
| `data/versioning-backups.md` | Version history backing the undo timeline |
| `process/user-language-standard.md` | All guidance text follows user language standard |
| `platform/branding.md` | Tutorial and help UI follows platform branding |

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Split-pane preview instead of separate preview page | Context switching between "edit" and "preview" pages would slow down the iteration cycle. Split-pane keeps both visible simultaneously, enabling real-time feedback. |
| Help text in database, not hardcoded | Help text will evolve based on user feedback. Storing it in the database allows updates without code deployment, and potentially community-contributed translations. |
| Template starting points instead of blank canvas | Blank canvases are intimidating for non-technical users. Templates provide structure and teach by example. The "Start Blank" option ensures power users are not constrained. |
| Visual timeline backed by versioning service | Session-local undo stacks lose history on browser close. Backing undo with the versioning service provides persistent history that survives sessions and is shared across collaborators. |
| Tutorial by doing, not by reading | Interactive tutorials (drag this, click that) teach muscle memory. Documentation-style tutorials (read this paragraph) are skipped. The tutorial produces a real artifact (a working form) so the user sees immediate value. |
| Errors block, warnings advise | Saving an invalid configuration (e.g., select with no options) would produce a broken operator experience. Warnings for suboptimal configurations (e.g., 20+ fields) are advisory because the builder may have a valid reason. |
