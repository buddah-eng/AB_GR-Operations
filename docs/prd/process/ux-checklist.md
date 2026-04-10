# User-Centric Design Checklist

> Every screen in the platform must answer four questions: What is this? Why am I here?
> What can I do? What happens when I do it? This checklist is verified during the acceptance
> gate for any PRD that defines UI.

---

## Overview

The platform's UI PRDs describe WHAT to render (forms, tables, kanban boards) but not the UX fundamentals that make screens usable: empty states, loading states, error handling, accessibility, and clear purpose. This checklist fills that gap.

This is a process PRD — it doesn't define features, it defines requirements that every UI feature must meet.

---

## 1. The Four Questions

Every screen must answer these for the user, without requiring a manual:

| Question | How to answer it | Example |
|----------|-----------------|---------|
| **What is this?** | Clear page title + brief description | "Guest List — All guests for Anime Boston 2026" |
| **Why am I here?** | Context from navigation or task flow | Breadcrumb: Dashboard > Guests > Guest List |
| **What can I do?** | Visible, labeled actions | "+ Add Guest" button, filter controls, sort headers |
| **What happens when I do it?** | Action feedback + confirmation for destructive actions | "Guest saved" toast, "Are you sure?" for archive |

**Acceptance Criteria:**
- [ ] Every screen has a title and contextual description
- [ ] Navigation shows where the user is (breadcrumbs or active nav highlight)
- [ ] Primary actions are visible without scrolling
- [ ] Destructive actions require confirmation

---

## 1.5 Progressive Disclosure is REJECTED (R22)

> "I disagree on progressive disclosure" — User

Progressive disclosure is **explicitly rejected** for this platform. Do NOT hide complexity behind additional clicks, collapsed sections, expandable panels, "show more" links, or any other mechanism that requires the user to take action to see relevant information.

**Rules:**
- If something is relevant to the current context, it MUST be **visible on the screen** — not collapsed, hidden, or behind a click
- Show everything. Explain clearly with contextual labels, inline help text, and visual hierarchy
- Use whitespace, grouping, headers, and typography to organize dense information — not hiding
- Complexity is managed through clear layout and visual structure, NOT through concealment
- Tabs for navigating between distinct views are acceptable; collapsing content within a view is not

**What this means in practice:**
- Form fields: show all fields, use section headers and inline descriptions to guide the user
- Detail views: show all data, use visual grouping to create scannable structure
- Settings: show all options with clear labels and help text, not nested menus
- Dashboards: show all relevant metrics, use layout hierarchy to direct attention

**Acceptance Criteria:**
- [ ] No UI uses collapsed/expandable sections to hide relevant content
- [ ] No "show more" or "advanced" toggles that gate access to contextually relevant information
- [ ] Dense screens use visual hierarchy (headers, grouping, whitespace) instead of hiding
- [ ] All information relevant to the current context is visible without additional clicks

---

## 2. List View Requirements: No Spreadsheet Views (R3)

> "The organization of the list views on tabs aren't atomic enough and just look like spreadsheets... it doesn't feel like an app at all" — User

List views MUST use atomic card/record layouts. Raw DataTable/spreadsheet grids are **not acceptable** as the primary list view for any entity.

**Rules:**
- Each record must be a visually distinct unit — a card, tile, or structured row with clear visual sections
- Columns alone are insufficient. Records need visual structure that shows relationships between fields
- The UI must feel like an application, not a database query result
- Key information (name, status, primary relationship) should be visually prominent within each record
- Secondary information (dates, counts, metadata) should be visually subordinate but still visible

**Acceptable patterns:**
- Card grid: each record is a card with structured layout (header, body, footer, status badge)
- Structured list: each row has visual sections — an icon/avatar, a primary block (name + description), a status block, and an action block
- Tile layout: compact cards in a grid, showing key fields with visual hierarchy

**Unacceptable patterns:**
- Raw DataTable with flat columns and no visual structure
- Spreadsheet-style grids where every field gets equal visual weight
- Table rows that are just text in columns with no grouping or hierarchy

**Acceptance Criteria:**
- [ ] Every list view uses card, tile, or structured-row layouts — not raw DataTable grids
- [ ] Each record is a visually distinct unit with clear sections (not flat column cells)
- [ ] Primary fields (name, status) are visually prominent; secondary fields are subordinate
- [ ] List views feel like an application, not a spreadsheet or database dump

---

## 3. Empty States

Every data view must define what the user sees when there's no data.

**Requirements:**
- Not just "No records found" — explain WHY and what to do
- Include a call-to-action when the user can create data
- Distinguish between "no data exists" and "no data matches your filters"

**Pattern:**
```
First-time empty:
  "No guests yet. Add your first guest to get started."
  [+ Add Guest] button

Filter empty:
  "No guests match your filters. Try adjusting your search criteria."
  [Clear Filters] link

Permission empty:
  "You don't have access to this data. Contact your department director."
```

**Acceptance Criteria:**
- [ ] Every table, kanban, timeline, and dashboard widget has an empty state
- [ ] Empty states distinguish between "no data" and "no matches"
- [ ] Empty states include actionable next steps when possible

---

## 4. Loading States

Every async operation must show feedback.

**Requirements:**
- Page load: skeleton or spinner within 100ms
- Data fetch: loading indicator on the specific component, not a full-page overlay
- Submit: button shows loading state (disabled + spinner), prevents double-submit
- Long operations (>3s): progress indication or "this may take a moment" message

**Acceptance Criteria:**
- [ ] Every data-fetching component shows a loading state
- [ ] Submit buttons disable during submission
- [ ] No screen appears frozen during data loading

---

## 5. Error Handling

Every error must be communicated clearly per the User Language Standard.

**Requirements:**
- Form validation: inline errors below the field, red border, error text referencing the field label
- API errors: toast notification with plain-language message
- Permission errors: clear message + who to contact
- Network errors: "Unable to connect. Check your connection and try again."
- Never show raw error codes, stack traces, or internal field names

**Acceptance Criteria:**
- [ ] Form validation errors appear inline below the relevant field
- [ ] API errors produce user-readable toast messages
- [ ] No screen shows a raw error object or stack trace
- [ ] All error messages follow the User Language Standard

---

## 6. Accessibility

Every screen must be usable with keyboard and assistive technology.

**Requirements:**
- All interactive elements reachable via Tab key
- Focus visible on all focusable elements
- Form inputs have associated labels (not just placeholder text)
- ARIA labels on icon-only buttons
- Color is not the only indicator of state (add icons or text)
- Sufficient color contrast (WCAG AA minimum)

**Acceptance Criteria:**
- [ ] Tab navigation reaches all interactive elements in logical order
- [ ] Every form input has a `<label>` element or `aria-label`
- [ ] Icon-only buttons have `aria-label` describing the action
- [ ] Status indicators use icon + color (not color alone)

---

## 7. Feedback & Confirmation

Every user action must produce visible feedback.

**Requirements:**
- Success: toast notification ("Guest saved successfully")
- Failure: error message per §4
- Destructive actions: confirmation dialog before proceeding
- Bulk actions: count of affected records + confirmation

**Acceptance Criteria:**
- [ ] Every create/update/delete shows a success or error notification
- [ ] Archive/delete actions require "Are you sure?" confirmation
- [ ] Bulk operations show affected count before proceeding

---

## 8. Verification

**When:** During the acceptance gate for any PRD in the `ui/` directory, or any PRD that defines user-facing screens.

**How:** For each screen defined in the PRD:
1. Check the four questions (§1)
2. Check progressive disclosure rejection (§1.5) — no hidden/collapsed relevant content
3. Check list view requirements (§2) — no spreadsheet-style grids
4. Check empty state definition (§3)
5. Check loading state definition (§4)
6. Check error handling (§5)
7. Check accessibility requirements (§6)
8. Check feedback patterns (§7)

**Gate:** Missing any section for any screen is a FAIL.
