# Phase 6 Page Audit — Raw Findings

**Date:** 2026-04-10
**URL:** https://web-ecru-seven-33.vercel.app
**Status:** Incomplete — structural wiring works, but many pages broken

## Global Issues (affect ALL pages)

1. **`/api/config` returns 404** — frontend expects a global config endpoint that doesn't exist in the Vercel adapter
2. **Page titles show raw concept keys** — "guest", "staff", "prep_item" instead of "Guests", "Staff", "Prep Tracker". Ontology store not loading concept labels before shell renders.
3. **View config name leaks as subheading** — "default-list", "kanban-tracker", "timeline-view" shown to users
4. **Pluralization bug in Vercel API** — `conceptToTable()` appends `s` to already-plural slugs: `pairings` → `pairingss`, `accommodations` → `accommodationss`

## Page-by-Page Status

### Batch 1: Operations Pages (from crawler 1)

| Page | Status | Data | Issues |
|------|--------|------|--------|
| /dashboard | PARTIAL | Widgets render, action required shows 5 guests, prep 70% | Stat card numbers may not display, activity feed placeholder |
| /guests | WORKS | 12 guest cards (name/status/company/type) | Raw title "guest", view name shown |
| /guests/new | PARTIAL | 3-step wizard renders (Basic Info/Contact/Convention Details) | Fields have no labels, no validation |
| /staff | WORKS | 20 staff cards | Raw title "staff", no secondary field labels |
| /schedule | PARTIAL | Timeline region renders | No data visible (table may be empty) |
| /prep-tracker | WORKS | Kanban with 3 columns (complete:35, in_progress:7, incomplete:8) | Raw title "prep_item", raw status values, cards lack guest association |
| /workflows | BROKEN | Error: `column "archived" does not exist` | workflow_configs table missing archived column |
| /settings | WORKS | 5 settings cards with edit links | "Guest relations" casing, some cards lack edit action |
| /travel | BROKEN | Error: `relation "travels" does not exist` | Table name mismatch |
| /accommodations | BROKEN | Error: `relation "accommodationss" does not exist` | Pluralization bug (double-s) |
| /pairings | BROKEN | Error: `relation "pairingss" does not exist` | Pluralization bug (double-s) |
| /canvas | BROKEN | Toolbar renders but graph empty | `/api/visualization/graph` not in Vercel adapter |

### Batch 2: Builders + Detail + Domain Pages (from crawler 2)

| Page | Status | Data | Issues |
|------|--------|------|--------|
| /dietary | BROKEN | Error: `relation "dietarys" does not exist` | Pluralization bug |
| /autographs | BROKEN | Error: `relation "autographss" does not exist` | Pluralization bug (double-s) |
| /venues | BROKEN | Error: `relation "venuess" does not exist` | Pluralization bug (double-s) |
| /builder/form/guest | PARTIAL | Builder UI renders, 10 ontology properties listed | Can't load saved configs — `/api/form-configs` 404 |
| /builder/view/guest | PARTIAL | Builder UI renders, column/filter/sort editors | Can't load saved configs — `/api/view-configs` 404 |
| /builder/workflow | WORKS | Full workflow builder (triggers, actions, validation) | Works as empty new workflow |
| /canvas/data-flows | BROKEN | Toolbar renders, canvas empty | `/api/data-routes` 404 |
| /guests/:id (detail) | PARTIAL | Back button, "Tanaka Ichiro" heading, 5 fields in grid | Name shown 3x, raw field labels (NAME/TYPE/STATUS), raw "detail-view" subheading, only 5/10 properties, no tabs |

### Full Page Status Summary

| Page | Status | Category |
|------|--------|----------|
| /dashboard | PARTIAL | Config-driven shell |
| /guests | WORKS | Config-driven shell |
| /guests/new | PARTIAL | Config-driven shell |
| /guests/:id | PARTIAL | Config-driven shell |
| /staff | WORKS | Config-driven shell |
| /schedule | PARTIAL | Config-driven shell |
| /prep-tracker | WORKS | Config-driven shell |
| /workflows | BROKEN | Config-driven shell (DB column missing) |
| /settings | WORKS | Config-driven shell |
| /travel | BROKEN | DomainListView (table name mismatch) |
| /accommodations | BROKEN | DomainListView (pluralization bug) |
| /dietary | BROKEN | DomainListView (pluralization bug) |
| /autographs | BROKEN | DomainListView (pluralization bug) |
| /venues | BROKEN | DomainListView (pluralization bug) |
| /pairings | BROKEN | DomainListView (pluralization bug) |
| /canvas | BROKEN | Canvas (missing API endpoint) |
| /canvas/data-flows | BROKEN | Canvas (missing API endpoint) |
| /builder/form/guest | PARTIAL | Builder (can't load saved configs) |
| /builder/view/guest | PARTIAL | Builder (can't load saved configs) |
| /builder/workflow | WORKS | Builder (works as empty state) |

**Score: 5 working, 5 partial, 11 broken out of 21 pages**

## PRD Gap Analysis (from agent 3)

### What the architecture supports vs what users can actually DO

The config-driven pipeline works structurally: route → shell → composable → API → Postgres → render. But the GAP is between "data renders on screen" and "a user can accomplish their job."

### Critical Gaps by Category

**4 missing DB tables** — ViewConfig seeds reference tables that don't exist:
- `contract_templates`, `contract_clauses`, `guest_contracts` (generated_contract), `transport_drivers`

**12+ seed data quality gaps** — configs exist but are incomplete:
- Guest list missing `prep_completion` column, `renderer` fields, `width` values, "Needs Attention" preset
- Guest detail missing ALL tabs (Prep Items, Pairings, Transport, Contracts, Schedule), `section` grouping, `bio` field
- Dashboard missing `view-embed` widgets, widget position grid, Prep Completion stat card
- Form fields missing `required` flags, `input_type` overrides, `default` values
- `view_configs` table has no `tabs` column — nowhere to store detail page tab config

**8+ missing workflows** — no automation fires:
- Status transitions don't create prep items, generate contracts, or notify liaisons
- No overdue detection, no auto-completion, no email triggers, no flight polling

**10+ missing frontend features** — core user flows broken:
- No filter UI visible (filters in config but no controls rendered)
- No sort wiring (sort events emitted but API params not updated)
- Kanban drag-and-drop is visual only — no PATCH to update record status
- No edit mode (POST only, no PUT, no record pre-loading)
- No status transition UI (no dropdown, no confirmation, no state machine enforcement)
- Timeline renders as vertical date list, not horizontal Gantt
- Detail view has no section grouping, no renderer dispatch
- No relation autocomplete (relation fields render as text inputs)
- No guest self-service frontend page
- No contract viewer or PDF export
- No itinerary aggregation

**3 missing integrations** — FlightAware, Blacklane/Karhoo not wired

**RBAC gaps** — No GR role seeds, no liaison data scoping, liaison sees all guests

## Root Causes

### 1. Vercel API adapter is incomplete
The `web/api/index.ts` only implements routes the config-driven composables need. Missing:
- `/api/config` (global platform config)
- `/api/visualization/graph` (system graph canvas)
- `/api/stream` (SSE for real-time updates)
- Proper table name resolution for already-plural concept slugs

### 2. Ontology labels not resolving
The ontology store loads concepts from `/api/ontology` but the shell components display `conceptKey` from route meta as fallback when the concept label hasn't loaded yet. The fallback is the raw key, not a human-readable name.

### 3. Form fields lack labels
The DynamicForm wizard renders fields from FormConfig but the `propertyKey` references in the form config need to be resolved against ontology properties to get labels. This resolution may not be happening.

### 4. UX lifecycle not mapped
No consideration for:
- What does a user DO on each page? (actions, workflows, transitions)
- How does a user navigate between pages? (guest → detail → prep items)
- What status transitions are possible? (draft → invited → confirmed)
- What filters/sorts make sense per page?

## Resolved (fix loop completed)
- Pluralization bug → fixed table name map with all slugs
- Missing API endpoints → added /api/config, /api/form-configs, /api/view-configs, /api/visualization/graph, /api/data-routes, /api/stream
- Title resolution → humanized concept keys as fallback, removed leaked config names
- Graceful table errors → return empty results for nonexistent tables
- Seed data quality → added renderers, tabs column, detail page tabs with 4 sub-views
- E2E tests → 20 Playwright tests, all passing

## Open Questions for Phase 6 PRD Update

These are USER-PERSPECTIVE questions that reveal missing features. They should be added to the Phase 6 PRDs as acceptance criteria before Phase 6 can be declared complete.

### Builder Integration (the frontend can't configure itself)
1. How does a non-developer add a field to the guest form? The form builder exists at /builder/form/guest but can't SAVE changes back to the DB (read-only Vercel adapter). What's the write path?
2. How does a director customize the guest list columns? The view builder exists at /builder/view/guest but same issue — no save endpoint.
3. Where's the link FROM an operational page TO its builder? If I'm looking at the guest list and want to add a column, how do I get to the view builder?
4. How does a saved builder config REPLACE the seed config? If I edit the ViewConfig in the builder, does it create a new version or update in place?

### Status & Lifecycle (users can't move things forward)
5. How does a coordinator change a guest's status from "invited" to "confirmed"? There's no status dropdown, no transition button, no workflow trigger.
6. What happens when a status changes? The PRD says prep items auto-create, contracts generate, liaisons get notified. None of this is wired.
7. How does a liaison see only THEIR assigned guests? Data scoping (relation-based) isn't implemented.

### Forms & Editing (users can't modify data)
8. How does someone EDIT an existing guest? There's only a create form (/guests/new), no edit form.
9. How do form fields get labels? The intake wizard shows unlabeled text inputs because propertyKey→Property.label resolution isn't happening.
10. How does validation work? The PRD says required fields, email format, min/max length. Currently no validation renders.

### Data Completeness (some concepts don't exist)
11. Where are the contract tables? contract_templates, contract_clauses, generated_contracts don't exist in the DB.
12. Where are transport_drivers? The concept is in the ontology but no table exists.
13. Where are accommodations, autographs, dietary tables? These concepts show empty pages because the tables don't exist.

### Dashboard & Widgets (surface-level metrics)
14. How do stat card widgets show actual numbers? Currently they fetch all records and count client-side. There's no aggregation API.
15. Where are the embedded view widgets? The PRD specifies view-embed widgets (schedule timeline, prep kanban in dashboard). Not implemented.

### Canvas & Visualization
16. The system graph renders nodes from the ontology but can users EDIT from the canvas? Canvas-config bridge exists but write-back isn't wired in the Vercel adapter.
17. Data flow canvas is empty because no data_routes table exists yet. This is Phase 4B infrastructure — is it expected to be empty in Phase 6?

These questions should drive the remaining Phase 6 work and inform which PRDs need updates before Phase 6 can pass the completion protocol.
