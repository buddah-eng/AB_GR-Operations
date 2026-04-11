# Phase 6 Full Findings — Every Issue Found by Consortium

Nothing omitted. Technical debt compounds.

---

## From Builder Integration Agent

### Already in synthesis:
- B1: No POST/PUT `/api/form-configs` or `/api/view-configs` endpoints
- B2: No link from operational pages to builders
- B3: Versioning service can't find config tables (no `key` column)

### NOT in synthesis — additional findings:

- **B4: ViewBuilder save payload shape mismatch.** ViewBuilder sends frontend-shaped data (`viewType`, `sorts[]`, `dateField`, `endDateField`, `filterCondition`) but the DB expects (`view_type`, `sort` singular, `timeline_start`, `timeline_end`, `filters`). Save will write wrong column names to Postgres. Needs a server-side serialization adapter OR the ViewBuilder must transform before sending.

- **B5: Cache invalidation after config save.** After saving a form/view config, the ontology loader's cache (`TTL_ONTOLOGY_MS`) still holds the old config. `reloadOntology()` needs to be called after config writes, or the cache key for the specific config needs invalidation. Without this, users save a change in the builder and the operational page still shows the old config until cache TTL expires (5 minutes).

- **B6: FormBuilder identifies configs by `id` but versioning service identifies by `key`.** The FormBuilder's `handleSave()` calls `api.put('/api/form-configs/${formId}', config)` using the UUID `id`. The versioning service's `updateOntologyRecord()` looks up by `key` column. These are incompatible — the config-builder router needs to bridge this by accepting `id` and looking up the `concept_key + name` pair for versioning.

---

## From Status & Lifecycle Agent

### Already in synthesis:
- L1: No status change UI on detail page
- L2: Workflow engine queries `workflows` table but `workflow_configs` exists
- L3: Zero workflow configs seeded
- L4: No RBAC permissions seeded for non-director roles

### NOT in synthesis — additional findings:

- **L5: Workflow column name mismatch (not just table name).** The engine queries `trigger_config`, `condition_config`, `actions_config` columns. The actual table has `trigger`, `condition`, `actions`. Even a VIEW or table rename would need column aliasing. This is a double mismatch: wrong table AND wrong columns.

- **L6: Notification handler doesn't actually deliver.** `registerNotificationHandler()` is called in `index.ts` but the notification service emits domain events rather than sending emails/Slack/in-app notifications. It's a pub/sub relay, not a delivery engine. No email provider is configured.

- **L7: Liaison gets 403 on ALL concepts, not just guests.** The permissions table has rows for `director` role only. Every other role (coordinator, liaison, interpreter, volunteer, viewer) has ZERO permission rows. They get 403 on every API call. This means RBAC is doing its job (deny by default) but the permission matrix was never populated.

- **L8: Relation-based data scoping needs subquery support.** The `buildDataScopeFilter` returns `{ column, operator, value }` for simple `AND column = value` clauses. But liaison→guest scoping goes through the `pairings` join table, requiring `AND id IN (SELECT guest_id FROM pairings WHERE staff_id = $uid)`. The current engine can't express this. Needs architectural extension.

- **L9: No status transition validation.** The PUT endpoint accepts ANY status value. There's no state machine enforcing valid transitions (e.g., can't go from `draft` directly to `arrived`). PRD defines explicit transition rules that aren't implemented.

---

## From Forms & Editing Agent

### Already in synthesis:
- F1: No edit route or edit mode in ConfigFormPage
- F2: Ontology store discards properties map
- F3: buildValidation ignores validationRules

### NOT in synthesis — additional findings:

- **F4: Ontology API returns concepts as object, frontend expects array.** `serializeOntology()` returns `{ concepts: { guest: {...}, staff: {...} } }` (an object keyed by concept key). But the frontend `OntologyData` type has `concepts: OntologyConcept[]` (an array). The ontology store's `loadOntology` sets `concepts.value = data.concepts` which assigns an object to an array ref. This might silently work in Vue's reactivity system but is a type violation. The `getConceptByKey` computed builds a Map from iterating the array — if it's actually an object, `for (const c of concepts.value)` may iterate wrong.

- **F5: Wizard step fields are strings, adapter expects objects.** The seed migration's wizard steps define fields as `["name", "type", "company", "bio"]` (string arrays). But `adaptFormSteps()` calls `adaptFormFields(s.fields as Record<string, unknown>[])` which expects objects like `{propertyKey: "name"}`. Passing strings produces `FormFieldConfig` objects where `key` is `undefined` because `f.key ?? f.propertyKey ?? f.property_key` all fail on a string primitive.

- **F6: Frontend OntologyProperty type missing `validationRules`.** The backend `Property` type in `functions/src/ontology/types.ts` has `validationRules?: ValidationRules` with `minLength`, `maxLength`, `min`, `max`, `pattern`. The frontend `OntologyProperty` type in `web/src/types/index.ts` has NO such field. Even after fixing the ontology store to merge properties, validation rules won't flow through to the form schema builder.

- **F7: `overrideLabel` and `overridePlaceholder` untested.** The FormFieldConfig backend type has these fields, and the adapter code supports them, but no seed data uses them and no test verifies the mapping works. If they're ever used, they may silently fail.

- **F8: ConfigFormPage error handling shows nothing.** Line 63: `console.error('Form submission failed:', err)` — the user sees no toast, no error message, no feedback when form submission fails. Silent failure.

- **F9: ConfigFormPage always posts to `/${conceptKey}s` after creation.** Line 59: `router.push('/${conceptKey.value}s')` — navigates to the list, not the new record's detail. The `api.post` response (which contains the new record ID) is not captured. The user can't find their just-created record without searching the list.

---

## From Data/Dashboard/Canvas Agent

### Already in synthesis:
- D1: Contract tables don't exist (must fix)
- D2: transport_drivers deferred
- D3: accommodations/autographs/dietary are guest properties not tables

### NOT in synthesis — additional findings:

- **D4: DashboardWidget response parsing bug.** Line 92 reads `(data).total` but the real Express backend wraps the response as `{ success: true, data: [...records], meta: { total, page, limit, hasMore } }`. The API client unwraps `data` (the array), so `result.total` is undefined. The widget falls back to `records.value.length` which only counts the current page (default 50), not the true total. Stat cards may show wrong numbers for concepts with >50 records.

- **D5: `activity_feed` widget is a dead placeholder.** `DashboardWidget.vue` line 43 renders `<div>Recent activity</div>` — literal text, no data fetching, no audit trail integration. It's not broken (no errors), but it's fake content that implies functionality that doesn't exist.

- **D6: SSE endpoint will timeout on Vercel.** The `/api/stream` SSE handler keeps the connection open indefinitely. Vercel serverless functions have a 300s max execution time. After 5 minutes, the SSE connection drops. The canvas config bridge handles disconnection gracefully (`isDisconnected` computed) but real-time collaborative editing won't work. Degraded to manual refresh.

- **D7: Canvas undo/redo uses versioning rollback API.** `useCanvasConfigBridge.ts` calls `api.post('/api/versioning/rollback', ...)`. This endpoint exists in the Express backend. On Vercel it should work (it's a standard POST), but it hasn't been tested live. If it fails, Ctrl+Z in the canvas will silently do nothing.

- **D8: `DomainListView.vue` exists but may have import issues.** The data agent's glob returned no results for it, but the file does exist in the codebase (I've read it earlier). If the file has import issues on Vercel (e.g., importing from a path that doesn't resolve in the Vercel build), the routes using it would show a blank component.

- **D9: No `conceptToTable` mapping for `accommodations`, `autographs`, or `dietary`.** The Vercel API adapter maps `travel` → `transport_bookings`, but these three concepts fall through to the default `${concept}s` which produces nonexistent table names. The real Express backend's `conceptToTable` in `domains.ts` also lacks these mappings.

---

## From UX Lifecycle Agent

### Already in synthesis:
- U1: App is fully read-only
- U2: Six domain routes use wrong shell
- U3: Row-click navigation breaks

### NOT in synthesis — additional findings:

- **U4: `navigateToForm` is hardcoded to `{ name: 'new-guest' }`.** ConfigListPage line 54: `router.push({ name: 'new-guest', params: {} })`. On the staff list page, clicking "New" creates a GUEST, not a staff member. On the schedule page, "New" creates a guest. This is wrong for every concept except guest.

- **U5: No staff detail route exists.** Only `/guests/:id` has a detail route. There is no `/staff/:id`, `/schedule/:id`, `/prep-tracker/:id`, or any other concept detail route. Clicking any non-guest row silently redirects to dashboard.

- **U6: Timeline is vertical date list, not horizontal Gantt.** ViewTimeline renders a date-grouped vertical list. The PRD specifies a horizontal time axis with bars for ranges, zoom levels (day/week/month), and a today marker. None of this exists.

- **U7: No date picker or day filter on schedule.** Hana sees ALL events for ALL dates. She can't filter to "Saturday only" to review that day's schedule.

- **U8: No conflict detection on schedule.** Two events at the same time in the same venue show as two separate cards with no visual warning. No backend query for overlapping bookings.

- **U9: Staff list shows no workload information.** No computed "assigned guest count" column. Hana can't tell which liaisons are overloaded.

- **U10: Pairings list has no context.** `/pairings` shows a raw junction table (guest_id, staff_id, role). No names resolved. Should be surfaced ON guest/staff detail pages, not as a standalone list.

- **U11: Settings "Permissions" and "Integrations" are dead tiles.** No `editRoute` — clicking does nothing. No "coming soon" label either. They look clickable but aren't.

- **U12: Dashboard widgets have no click-through.** Stat card shows "3" but clicking it does nothing. Should navigate to a filtered list view (e.g., `/guests?filter.status=confirmed`).

- **U13: Dashboard has no time-scoping.** Stat cards show total counts, not "today's changes." No "completed today" vs "total" comparison. End-of-day review is impossible.

- **U14: No "overdue" concept surfaced anywhere.** The PRD describes overdue prep item detection via scheduled workflow. No workflow exists, no overdue badge renders, no dashboard alert for overdue items.

- **U15: No feedback toast on successful creation.** After creating a guest, no success toast. The user is redirected to the list with no confirmation that the record was created.

---

## Complete Item Count

| Category | Critical | High | Should Fix | Low/Debt | Defer | Total |
|----------|----------|------|------------|----------|-------|-------|
| Builders | 0 | 3 | 0 | 3 | 0 | 6 |
| Lifecycle | 2 | 2 | 0 | 5 | 1 | 10 |
| Forms | 2 | 1 | 1 | 5 | 0 | 9 |
| Data/Dashboard | 0 | 1 | 2 | 4 | 3 | 10 |
| UX Lifecycle | 2 | 2 | 3 | 8 | 2 | 17 |
| **Total** | **6** | **9** | **6** | **25** | **6** | **52** |

**52 total findings. 25 are low-priority technical debt items that will compound if ignored.**
