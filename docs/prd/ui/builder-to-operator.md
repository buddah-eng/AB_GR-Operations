# Builder-to-Operator Translation

> When an admin creates a "concept" with "properties" in the ontology builder, an operator
> sees a form with labeled fields and a table with sortable columns. This PRD defines every
> step of that translation — from ontology data to rendered UI — so that builder output is
> always understandable to someone who never touches the builder.

---

## Overview

The platform has two audiences: **builders** (admins/directors who configure the ontology, forms, views, and workflows) and **operators** (coordinators, liaisons, volunteers who use the configured system to manage convention operations). The builder creates abstract structures (concepts, properties, relationships). The operator sees concrete UI (forms, tables, kanban boards, dashboards).

The gap between these two is the most critical UX challenge in the platform. If the builder makes a mistake — names a field poorly, orders columns badly, creates a confusing form layout — the operator inherits that confusion without context.

This PRD defines:
1. How every ontology element translates to UI
2. What defaults apply when the builder doesn't customize
3. How builder mistakes are prevented or surfaced
4. How operators experience ontology changes

---

## 1. Property-to-Input Mapping

**Purpose:** Define exactly which form input renders for each of the 17 property types.

**Dependencies:** `core/ontology-engine.md` (property types), `ui/dynamic-forms.md` (FormKit bridge)

| Property Type | Form Input | Validation | Placeholder |
|---------------|-----------|------------|-------------|
| `text` | Single-line text input | minLength, maxLength, pattern | Property.placeholder or Property.label |
| `rich_text` | Multi-line textarea | maxLength | "Enter details..." |
| `number` | Number input with step controls | min, max | Property.placeholder |
| `select` | Dropdown with options | required → must select | "Select {label}..." |
| `multi_select` | Multi-select checkboxes or tag input | — | "Select one or more..." |
| `date` | Date picker | — | "YYYY-MM-DD" |
| `datetime` | Date + time picker | — | "YYYY-MM-DD HH:MM" |
| `checkbox` | Toggle switch | — | — |
| `url` | URL input with format hint | URL pattern | "https://..." |
| `email` | Email input with format hint | Email pattern | "name@example.com" |
| `phone` | Phone input | — | "+1-555-..." |
| `relation` | Autocomplete dropdown (searches related concept) | — | "Search {related concept plural}..." |
| `formula` | Read-only computed display | — | — |
| `rollup` | Read-only aggregation display | — | — |
| `files` | File upload zone | — | "Drop files or click to upload" |
| `people` | User/staff autocomplete | — | "Search staff..." |
| `status` | Status badge dropdown | — | Current status shown |

**When no FormConfig exists (default rendering):**
- All properties rendered in `sortOrder` sequence
- Single-column layout
- No wizard steps
- Required fields marked with asterisk
- Property.description shown as help text below the input

**Acceptance Criteria:**
- [ ] Every property type maps to exactly one input type
- [ ] Default form rendering produces a usable form without any FormConfig
- [ ] Placeholder text is human-readable per the User Language Standard
- [ ] Required fields are visually distinct

---

## 2. Property-to-Column Mapping

**Purpose:** Define how properties render in table/list views.

| Property Type | Column Rendering | Sortable | Filterable |
|---------------|-----------------|----------|------------|
| `text` | Plain text, truncated at 50 chars with tooltip | Yes | Text search |
| `rich_text` | Plain text preview (stripped HTML), truncated | No | Text search |
| `number` | Right-aligned number | Yes | Range filter |
| `select` | Badge with option color | Yes | Dropdown filter |
| `multi_select` | Comma-separated badges | No | Contains filter |
| `date` | Formatted date (locale-aware) | Yes | Date range |
| `datetime` | Formatted date + time | Yes | Date range |
| `checkbox` | Check icon or dash | Yes | Yes/No filter |
| `url` | Clickable link (truncated) | No | — |
| `email` | Clickable mailto link | Yes | Text search |
| `phone` | Clickable tel link | No | — |
| `relation` | Related record name (resolved) | Yes | Autocomplete |
| `status` | Colored status badge | Yes | Dropdown filter |
| `formula` / `rollup` | Computed value | Yes | — |
| `files` | File count badge | No | — |
| `people` | Staff name(s) | Yes | Autocomplete |

**When no ViewConfig exists (default rendering):**
- Table view with first 6 non-hidden properties as columns
- Sorted by `created_at` descending
- Row click navigates to detail view
- Pagination at 50 rows per page

**Acceptance Criteria:**
- [ ] Every property type has a defined column rendering
- [ ] Default view rendering produces a usable table without any ViewConfig
- [ ] Related records show names, not IDs
- [ ] Status fields render as colored badges, not raw strings

---

## 3. Default Generation

**Purpose:** Define what the system auto-generates when a builder creates a concept without configuring forms or views.

**When a new concept is created in the ontology builder:**

1. **Default form** auto-generated:
   - All non-hidden properties in `sortOrder`
   - Single-column layout
   - Required fields marked
   - Relation fields get autocomplete
   - The admin sees: "A default form has been created. Customize it in the form builder."

2. **Default table view** auto-generated:
   - First 6 non-hidden properties as columns
   - `name` or first text property as the primary column
   - Status column included if concept has a status property
   - Default sort: `created_at DESC`
   - The admin sees: "A default table view has been created. Customize it in the view builder."

3. **Default page** auto-generated:
   - List view (the default table) as the main content
   - "+ Add {Concept Name}" button
   - Basic filter bar
   - The admin sees: "A default page has been created for {Concept Plural Name}."

**Acceptance Criteria:**
- [ ] Creating a concept auto-generates a usable form, view, and page
- [ ] Auto-generated UI is immediately usable by operators without further configuration
- [ ] Admin is informed about auto-generation and directed to customization
- [ ] Auto-generated defaults follow the User Language Standard

---

## 4. Ontology Change Impact on Operators

**Purpose:** Define what operators experience when the ontology changes under them.

| Change | Operator Experience |
|--------|-------------------|
| Property added | New field appears in form (at end). New column available in view (not auto-added to existing views). |
| Property renamed (label) | Form field and column header update immediately after cache refresh. |
| Property deleted | Form field disappears. View column shows "Field removed" placeholder. No data loss (JSONB preserved). |
| Property type changed | Form input changes to new type. Existing data displayed as-is (may look odd — admin warned during type change). |
| Concept deleted | Page becomes "This section is no longer available. Contact your administrator." |
| Form layout changed | Operators see new layout on next page load. No disruption to in-progress form submissions (save-and-resume preserves data). |
| View columns changed | Table/kanban updates on next load. Active filters on removed columns are silently cleared. |

**Acceptance Criteria:**
- [ ] Property additions don't break existing forms or views
- [ ] Property deletions show graceful degradation, not errors
- [ ] Concept deletion shows a clear message, not a 404
- [ ] In-progress work (unsaved forms) is not lost during ontology changes

---

## 5. Builder Guardrails

**Purpose:** Prevent builders from creating configurations that confuse operators.

| Guardrail | What it prevents | How |
|-----------|-----------------|-----|
| Empty label warning | Property with no label → operators see blank field | Builder shows warning: "This field has no label. Operators won't know what to enter." |
| Duplicate label warning | Two properties with the same label on one concept | Builder shows warning: "Another field is already labeled '{label}'. Consider renaming." |
| Hidden-but-required conflict | Property marked hidden AND required | Builder shows error: "A hidden field cannot be required — operators can't fill it in." |
| Too many fields warning | Form with 20+ fields in a single section | Builder suggests: "Consider splitting this into sections or a wizard layout." |
| No status field warning | Concept with no `status` property | Builder suggests: "Most categories benefit from a status field (e.g., Draft → Active → Complete)." |

**Acceptance Criteria:**
- [ ] Each guardrail produces a clear, actionable message
- [ ] Warnings don't block (builder can proceed), errors do block
- [ ] Messages use the User Language Standard (no jargon)

---

## 6. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Default form generation | Integration | Create concept with 5 properties → form auto-generated | Form renders with all 5 fields in order |
| Default view generation | Integration | Create concept → table auto-generated | Table shows first 6 columns with correct types |
| Property type rendering | Unit | Each of 17 types renders correct input/column | All 17 types verified |
| Property deletion | Integration | Delete property → form/view degrade gracefully | No errors, placeholder shown in view |
| Guardrail: empty label | Unit | Create property with no label → warning shown | Warning message correct |
| Guardrail: hidden+required | Unit | Set property hidden+required → error shown | Error blocks save |
| Default rendering without config | Integration | Concept with no FormConfig/ViewConfig → usable UI | Form submittable, table sortable |

**Coverage target:** ≥80% on translation logic (property-to-input, property-to-column mapping functions).
