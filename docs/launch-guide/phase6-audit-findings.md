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

## Next Steps
1. Fix Vercel API adapter (pluralization, missing endpoints)
2. Fix title resolution (use ontology labels, not raw keys)
3. Fix form label resolution (resolve propertyKey → Property.label)
4. Map the user lifecycle per page
5. PRD gap analysis for missing features
6. Phase 7 PRDs need builder/canvas integration
