# Operational UX Gaps

> 10 user journey scenarios tested. Every one failed. Detail routes don't exist, domain routes use the wrong shell, dashboard widgets are non-interactive, and the timeline is a vertical date list instead of a horizontal Gantt.
> This PRD closes every UX lifecycle gap so that the 10 journeys complete end-to-end.

---

## Overview

The Phase 6 consortium ran 10 user journey scenarios against the live codebase. Every journey failed at multiple points due to missing routes, broken navigation, non-functional widgets, and placeholder content. The infrastructure (API endpoints, view renderers, form engine) exists but the UX layer has holes: no detail pages for most concepts, domain routes that bypass the config-driven engine, dashboard widgets that show numbers you can't click, and settings tiles that do nothing.

This PRD covers every UX lifecycle gap identified by the consortium: U2, U3, U5, U6, U7, U8, U9, U10, U11, U12, U13, D2, D3, D4, D5, D6, D7, D8, D9.

**Dependencies:** `modules/guest-relations/operational-writes.md` (edit routes and write paths), `platform/data-wiring.md` (ontology store and workflow fixes), `core/rbac-completion.md` (screen access seeds)

---

## Full Specification

### 1. Detail Routes for All Concepts

#### Purpose

Only `/guests/:id` has a detail route. Staff, schedule_event, prep_item, and all other concepts have no `/:id` page. Clicking a row in any non-guest list silently redirects to the dashboard.

#### Detail

Register detail routes for every concept that has records:
- `/guests/:id` -> ConfigDetailPage (already exists)
- `/staff/:id` -> ConfigDetailPage
- `/schedule/:id` -> ConfigDetailPage
- `/prep-tracker/:id` -> ConfigDetailPage
- `/pairings/:id` -> ConfigDetailPage
- `/venues/:id` -> ConfigDetailPage
- `/travel/:id` -> ConfigDetailPage
- `/contracts/:id` -> ConfigDetailPage (once contract tables exist per `core/rbac-completion.md`)

Each detail route passes the concept key as a prop/meta to ConfigDetailPage, which loads the record via `GET /api/{conceptKey}s/:id` and renders it using the concept's view config.

#### Acceptance Criteria

- [ ] Detail routes exist for staff, schedule_event, prep_item, pairings, venue, transport_booking, and contract **(U5, S2)**
- [ ] Each detail route renders ConfigDetailPage with the correct concept key **(U5)**
- [ ] Navigating to `/staff/:id` loads the staff record and renders it **(U5)**
- [ ] Navigating to a nonexistent ID shows a 404 message, not a blank page **(U5)**

---

### 2. Row-Click Navigation Uses Concept-Aware Routing

#### Purpose

ConfigListPage's `handleRowClick` appends `s` to the concept key (`/${conceptKey}s/${id}`), but this produces invalid paths for concepts like `schedule_event` (produces `/schedule_events/123` instead of `/schedule/123`). Navigation must use concept-aware route mapping.

#### Detail

- Create a `conceptToRoute` mapping that translates concept keys to route prefixes:
  - `guest` -> `/guests`
  - `staff` -> `/staff`
  - `schedule_event` -> `/schedule`
  - `prep_item` -> `/prep-tracker`
  - `transport_booking` -> `/travel`
  - `venue` -> `/venues`
  - `pairing` -> `/pairings`
  - `contract` -> `/contracts`
- `handleRowClick` uses this mapping instead of naive `/${conceptKey}s/${id}`
- The mapping is a shared utility used by both row-click and any other navigation that targets a detail page

#### Acceptance Criteria

- [ ] Row-click on a staff record navigates to `/staff/:id` **(U3, C6)**
- [ ] Row-click on a schedule_event navigates to `/schedule/:id` **(U3, C6)**
- [ ] Row-click on a prep_item navigates to `/prep-tracker/:id` **(U3, C6)**
- [ ] Row-click on a transport_booking navigates to `/travel/:id` **(U3, C6)**
- [ ] The `conceptToRoute` mapping is a shared utility, not duplicated across components **(U3)**

---

### 3. Domain Routes Migrated to ConfigListPage

#### Purpose

Six domain routes (travel, accommodations, dietary, autographs, venues, pairings) use `DomainListView` -- a hardcoded DataTable fallback that bypasses the config-driven engine. They should use ConfigListPage so they benefit from view configs, kanban rendering, and the ontology-driven UI.

#### Detail

- **Migrate these routes to ConfigListPage:**
  - `/travel` -> ConfigListPage with `conceptKey: 'transport_booking'`
  - `/venues` -> ConfigListPage with `conceptKey: 'venue'`
  - `/pairings` -> ConfigListPage with `conceptKey: 'pairing'`
- **Remove or redirect these routes** (they are guest properties, not standalone concepts):
  - `/accommodations` -> redirect to `/guests` with a filter or remove entirely (accommodation is a guest property)
  - `/dietary` -> redirect to `/guests` with a filter or remove entirely (dietary is a guest property)
  - `/autographs` -> redirect to `/guests` with a filter or remove entirely (autographs is a guest property)
- For removed routes, ensure any navigation links (sidebar, dashboard) that point to them are updated or removed
- `DomainListView` can remain in the codebase as a fallback but should not be the primary route target

#### Acceptance Criteria

- [ ] `/travel` route uses ConfigListPage with concept key `transport_booking` **(U2, H7)**
- [ ] `/venues` route uses ConfigListPage with concept key `venue` **(U2, H7)**
- [ ] `/pairings` route uses ConfigListPage with concept key `pairing` **(U2, H7)**
- [ ] `/accommodations` is redirected to `/guests` or removed **(D3, D9, S4)**
- [ ] `/dietary` is redirected to `/guests` or removed **(D3, D9, S4)**
- [ ] `/autographs` is redirected to `/guests` or removed **(D3, D9, S4)**
- [ ] No `conceptToTable` mapping error for accommodations, autographs, or dietary **(D9)**
- [ ] Sidebar navigation links updated to reflect route changes **(U2)**

---

### 4. Dashboard Widget Click-Through Navigation

#### Purpose

Dashboard stat cards show numbers (e.g., "12 Guests") but clicking them does nothing. Users expect to click a stat card and navigate to the corresponding filtered list view.

#### Detail

- Each `DashboardWidget` with type `stat` receives a `clickRoute` prop:
  - Guest count widget -> `/guests`
  - Staff count widget -> `/staff`
  - Schedule count widget -> `/schedule`
  - Prep items count widget -> `/prep-tracker`
- Clicking the stat card navigates to the specified route
- If the widget shows a filtered count (e.g., "3 Confirmed Guests"), the click-through includes the filter as a query parameter: `/guests?status=confirmed`
- The stat card renders with `cursor: pointer` and a subtle hover effect to indicate clickability

#### Acceptance Criteria

- [ ] Clicking a dashboard stat card navigates to the corresponding list page **(U12, S3)**
- [ ] Filtered stat cards include the filter as a query parameter in the navigation URL **(U12)**
- [ ] Stat cards show `cursor: pointer` and a hover effect **(U12)**
- [ ] All concept stat cards have click-through routes configured **(U12)**

---

### 5. Dashboard Time-Scoping

#### Purpose

Dashboard stat cards show total counts ("12 Guests total") with no time context. The director doing an end-of-day review can't distinguish "what happened today" from "what exists in total."

#### Detail

- Add a time-scope toggle to the dashboard header: "All Time" | "Today" | "This Week"
- When a time scope is selected, stat card queries include a date filter:
  - "Today": `WHERE updated_at >= CURRENT_DATE`
  - "This Week": `WHERE updated_at >= date_trunc('week', CURRENT_DATE)`
  - "All Time": no date filter (current behavior)
- Each stat card shows the scoped count as the primary number and optionally the total as a secondary label: "3 today / 12 total"
- The time scope preference is stored in localStorage so it persists across sessions

#### Acceptance Criteria

- [ ] Dashboard header has a time-scope toggle with "All Time", "Today", "This Week" options **(U13)**
- [ ] Selecting "Today" filters stat card counts to records updated today **(U13)**
- [ ] Selecting "This Week" filters to records updated this week **(U13)**
- [ ] "All Time" shows total counts (current behavior, no regression) **(U13)**
- [ ] Time scope preference persists in localStorage **(U13)**

---

### 6. Activity Feed Widget Implementation

#### Purpose

The `activity_feed` widget renders literal text "Recent activity" -- it's a placeholder with no data fetching. Users expect to see recent actions (guest created, status changed, prep item completed).

#### Detail

- Replace the placeholder with a real data-fetching widget:
  - Fetch recent events from `GET /api/events?limit=10&sort=created_at:desc` (or equivalent audit trail endpoint)
  - Each event renders as a line item: `[timestamp] [actor] [action] [concept] [record name]`
  - Example: "2 hours ago -- Hana confirmed Guest Tanaka"
  - The widget auto-refreshes every 60 seconds or via SSE if available
- If no events API exists, create a minimal endpoint that queries the `audit_events` or `domain_events` table
- The widget shows a "No recent activity" message when the event list is empty

#### Acceptance Criteria

- [ ] Activity feed widget fetches real data from an events or audit API **(D5, S6)**
- [ ] Each event shows timestamp, actor, action, and affected record **(D5)**
- [ ] The widget auto-refreshes periodically **(D5)**
- [ ] Empty state shows "No recent activity" instead of placeholder text **(D5)**

---

### 7. Settings Dead Tiles

#### Purpose

The Settings page has "Permissions" and "Integrations" tiles that look clickable but do nothing. No `editRoute` is configured, no route exists, and there's no indication that the feature isn't available yet.

#### Detail

Two options (choose based on implementation timeline):

**Option A (preferred for now):** Add "Coming Soon" labels to the tiles
- Overlay a "Coming Soon" badge on the Permissions and Integrations tiles
- Remove the click handler / cursor pointer
- Tiles are visually distinct from functional tiles (muted opacity or grayscale)

**Option B (implement if time allows):** Add routes
- `/settings/permissions` -> a page that renders the permission matrix from Section 1 of `core/rbac-completion.md` in a read-only table
- `/settings/integrations` -> a page that lists available integrations (email, calendar, Slack) with status indicators

#### Acceptance Criteria

- [ ] Settings "Permissions" tile either navigates to a real page or shows "Coming Soon" **(U11)**
- [ ] Settings "Integrations" tile either navigates to a real page or shows "Coming Soon" **(U11)**
- [ ] Dead tiles are visually distinguishable from functional tiles **(U11)**
- [ ] No tile looks clickable without actually being clickable **(U11)**

---

### 8. Timeline and Schedule UX

#### Purpose

ViewTimeline renders a vertical date-grouped list instead of the horizontal Gantt-style timeline specified in the PRD. The schedule page has no date picker or day filter. These are significant UX gaps but may require substantial effort.

#### Detail

**Timeline horizontal rendering:**
- The PRD specifies a horizontal time axis with bars for date ranges, zoom levels (day/week/month), and a today marker
- If implementing in this phase: use a library like PrimeVue's Timeline component (horizontal mode) or a lightweight Gantt library
- If deferring: document as Phase 7 scope with a clear note in the codebase and a "Timeline view coming soon" placeholder that falls back to the current vertical list

**Date picker / day filter:**
- Add a date picker to the schedule page header
- Filtering by date sends `?filter.start_time=2026-04-10` to the API
- Default to "today" when the schedule page loads

**Conflict detection:**
- Two events at the same time in the same venue should show a visual warning (red border, conflict icon)
- If implementing: query for overlapping bookings on the backend: `WHERE venue_id = $1 AND start_time < $endTime AND end_time > $startTime AND id != $excludeId`
- If deferring: document as Phase 7 scope

#### Acceptance Criteria

- [ ] Timeline renders horizontally with date-range bars, OR is documented as Phase 7 with a fallback placeholder **(U6)**
- [ ] Schedule page has a date picker that filters events by date **(U7)**
- [ ] Schedule defaults to showing today's events when loaded **(U7)**
- [ ] Schedule conflict detection shows visual warnings for overlapping events, OR is documented as Phase 7 **(U8)**

---

### 9. Staff Workload Display

#### Purpose

The staff list shows no workload information. The director can't tell which liaisons are overloaded. An "assigned guest count" column is needed.

#### Detail

- Add a computed column to the staff list: "Assigned Guests" showing the count of guests paired with each staff member
- The count is computed via: `SELECT staff_id, COUNT(*) FROM pairings GROUP BY staff_id`
- The column is sortable so the director can identify overloaded and underutilized staff
- Optionally, show a color indicator: green (0-2 guests), yellow (3-4), red (5+) -- thresholds configurable

#### Acceptance Criteria

- [ ] Staff list includes an "Assigned Guests" column with the paired guest count **(U9)**
- [ ] The column is sortable **(U9)**
- [ ] The count is accurate (matches actual pairings data) **(U9)**

---

### 10. Pairings Surfaced on Detail Pages

#### Purpose

`/pairings` shows a raw junction table with UUIDs (guest_id, staff_id, role). No names are resolved. Pairings should be surfaced ON guest and staff detail pages, not as a standalone list of opaque IDs.

#### Detail

- On the guest detail page, add a "Assigned Staff" section:
  - Lists all staff members paired with this guest (resolved names, not UUIDs)
  - Shows each pairing's role (liaison, interpreter, volunteer)
  - Includes an "Add Pairing" button for roles with `canCreate` on pairings
- On the staff detail page, add an "Assigned Guests" section:
  - Lists all guests paired with this staff member (resolved names)
  - Shows each pairing's role
- The standalone `/pairings` route can remain but should display resolved names instead of UUIDs
- Name resolution uses a JOIN or a secondary lookup: `SELECT s.name FROM staff s JOIN pairings p ON p.staff_id = s.id WHERE p.guest_id = $guestId`

#### Acceptance Criteria

- [ ] Guest detail page shows a "Assigned Staff" section with resolved names and roles **(U10)**
- [ ] Staff detail page shows an "Assigned Guests" section with resolved names and roles **(U10)**
- [ ] Standalone pairings list shows resolved names, not raw UUIDs **(U10)**
- [ ] Pairings sections include add/remove actions for roles with appropriate permissions **(U10)**

---

### 11. DashboardWidget Response Parsing Fix

#### Purpose

`DashboardWidget` reads `(data).total` but the API wraps responses as `{ success: true, data: [...records], meta: { total, page, limit, hasMore } }`. The API client unwraps `data` (the array), so `result.total` is undefined. Stat cards fall back to `records.value.length` which only counts the current page (default 50).

#### Detail

- Fix the DashboardWidget to extract the total from the correct location:
  - The API client returns the unwrapped response; the widget receives the array of records
  - To get the true total, either:
    - **Option A:** Access `meta.total` from the raw response (before the API client unwraps it)
    - **Option B:** Have the API client preserve `meta` alongside `data` in its return value
    - **Option C:** Make a separate count endpoint: `GET /api/{concept}s/count`
- Option B is preferred: the API client returns `{ data: [...], meta: { total, ... } }` and the widget reads `response.meta.total`
- For concepts with fewer than 50 records (most at convention scale), the fallback is accurate. But it's wrong for any concept that exceeds the page size.

#### Acceptance Criteria

- [ ] DashboardWidget reads total from `meta.total`, not from array length **(D4)**
- [ ] Stat cards show the correct total count even for concepts with more than 50 records **(D4)**
- [ ] The API client preserves `meta` in its response for widgets that need it **(D4)**

---

### 12. Overdue Concept Implementation

#### Purpose

The PRD describes overdue prep item detection via a scheduled workflow, overdue badges on list items, and dashboard alerts. None of this exists. There is no "overdue" status, no workflow to detect it, and no visual indicator.

#### Detail

- The overdue workflow is seeded in `platform/data-wiring.md` (Section 7: prep-overdue workflow)
- This PRD handles the frontend rendering:
  - Prep items with `status: 'overdue'` render with a red "Overdue" badge in the list view
  - The dashboard shows an "Overdue Items" stat card with a count of overdue prep items
  - The overdue stat card has a red/warning color scheme
  - Clicking the overdue stat card navigates to `/prep-tracker?status=overdue`
- The overdue status is set by the workflow (not manually by users), but is visible to all roles with `canView` on prep_item

#### Acceptance Criteria

- [ ] Prep items with `overdue` status render with a red "Overdue" badge **(U14)**
- [ ] Dashboard includes an "Overdue Items" stat card **(U14)**
- [ ] Overdue stat card navigates to `/prep-tracker?status=overdue` on click **(U14)**
- [ ] Overdue status is visually distinct from other statuses (red/warning color) **(U14)**

---

### 13. Vercel Platform Considerations

#### Purpose

Two findings relate to Vercel deployment constraints that cannot be "fixed" but must be documented and handled gracefully.

#### Detail

**SSE timeout on Vercel (D6):**
- Vercel serverless functions have a 300-second max execution time
- The `/api/stream` SSE endpoint will drop after 5 minutes
- The canvas config bridge already handles disconnection gracefully (`isDisconnected` computed)
- Document this as a known limitation in the codebase (inline comment at the SSE endpoint)
- Add a user-facing message when SSE disconnects: "Real-time updates paused. Changes will sync on next refresh."

**Canvas undo/redo on Vercel (D7):**
- `useCanvasConfigBridge.ts` calls `POST /api/versioning/rollback` for undo/redo
- This should work on Vercel (standard POST endpoint) but has not been tested live
- Add error handling: if the rollback call fails, show a toast "Undo unavailable" instead of silently doing nothing
- Include canvas undo/redo in the Vercel deployment smoke test checklist

**DomainListView import issues (D8):**
- If DomainListView has import issues on Vercel (paths that don't resolve), routes using it show blank
- After migrating domain routes to ConfigListPage (Section 3), DomainListView becomes non-critical
- If DomainListView is still referenced anywhere, verify its imports resolve in the Vercel build

**transport_drivers deferral (D2):**
- Transport drivers are external actors managed via sessions, not persistent entities
- No table or route needed in this phase
- Document as a Phase 7 item

#### Acceptance Criteria

- [ ] SSE endpoint has an inline comment documenting the 300-second Vercel timeout **(D6)**
- [ ] SSE disconnection shows a user-facing message, not silent failure **(D6)**
- [ ] Canvas undo/redo has error handling with a toast on failure **(D7, S5)**
- [ ] Canvas undo/redo is included in the Vercel deployment smoke test **(D7, S5)**
- [ ] DomainListView imports are verified or routes are migrated away from it **(D8)**
- [ ] transport_drivers is documented as Phase 7 scope **(D2)**

---

## Finding Coverage Matrix

| Finding ID | Section | Description |
|------------|---------|-------------|
| U5, S2 | 1 | No detail routes for staff, schedule, prep, etc. |
| U3, C6 | 2 | Row-click navigation breaks for non-guest concepts |
| U2, H7 | 3 | Domain routes use DomainListView instead of ConfigListPage |
| D3, D9, S4 | 3 | Accommodations/dietary/autographs are guest properties, not tables |
| U12, S3 | 4 | Dashboard widget click-through navigation |
| U13 | 5 | Dashboard has no time-scoping |
| D5, S6 | 6 | Activity feed widget is placeholder |
| U11 | 7 | Settings dead tiles (Permissions/Integrations) |
| U6 | 8 | Timeline is vertical list, not horizontal Gantt |
| U7 | 8 | No date picker on schedule |
| U8 | 8 | No conflict detection on schedule |
| U9 | 9 | Staff list shows no workload info |
| U10 | 10 | Pairings surfaced as raw junction table |
| D4 | 11 | DashboardWidget response parsing (meta.total) |
| U14 | 12 | No overdue concept surfaced |
| D6 | 13 | SSE timeout on Vercel |
| D7, S5 | 13 | Canvas undo/redo testing on Vercel |
| D8 | 13 | DomainListView import issues |
| D2 | 13 | transport_drivers deferred |

---

## Test Plan

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | Navigate to `/staff/:id` | Staff detail page loads with correct record data |
| T-02 | Click row in staff list | Navigates to `/staff/:id`, not `/staffs/:id` |
| T-03 | Click row in schedule list | Navigates to `/schedule/:id` |
| T-04 | Navigate to `/travel` | ConfigListPage renders with transport_booking concept |
| T-05 | Navigate to `/accommodations` | Redirects to `/guests` or shows appropriate message |
| T-06 | Click dashboard "Guests" stat card | Navigates to `/guests` |
| T-07 | Select "Today" time scope on dashboard | Stat cards update to show today's counts |
| T-08 | Activity feed widget loads | Shows recent events with timestamps and actor names |
| T-09 | Click Settings "Permissions" tile | Navigates to permissions page or shows "Coming Soon" |
| T-10 | Schedule page loads | Date picker defaults to today; only today's events shown |
| T-11 | Staff list renders | "Assigned Guests" column shows correct counts |
| T-12 | Guest detail page | "Assigned Staff" section shows paired staff with names |
| T-13 | Dashboard stat card for concept with 100 records | Shows "100", not "50" |
| T-14 | Prep item with overdue status | Red "Overdue" badge visible |
| T-15 | SSE connection drops after 5 minutes on Vercel | User sees "Real-time updates paused" message |
| T-16 | Canvas Ctrl+Z when rollback API fails | Toast shows "Undo unavailable" |
