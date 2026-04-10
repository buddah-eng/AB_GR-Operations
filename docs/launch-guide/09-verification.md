# Launch Verification

> Run this checklist after completing all launch steps to verify the platform is operational.
> Every check has an expected result. If a check fails, the referenced section explains how to fix it.
> Do not skip this step -- catching issues before inviting your team saves hours of debugging later.

---

## Pre-Flight Checks

### Infrastructure

| # | Check | Command / Action | Expected Result | Fix |
|---|-------|-----------------|-----------------|-----|
| 1 | Database is accessible | `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;"` | Returns `1` | Check connection string, firewall rules, SSL settings |
| 2 | Schema is complete | `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';` | 40+ tables | Re-run migrations ([02-database-schema.md](02-database-schema.md)) |
| 3 | Backend is running | `curl http://localhost:8080/api/health` | `200 OK` or health response | Check `DB_HOST`, `DB_PASSWORD` env vars, Node.js version |
| 4 | Frontend is accessible | Open `http://localhost:5173` in a browser | Login page or dashboard loads | Check `VITE_API_BASE_URL` env var, npm run dev output |
| 5 | Frontend connects to backend | Open browser dev tools > Network tab, load the app | API requests to `/api/ontology` and `/api/config` succeed | Check CORS configuration, API base URL |

---

## Ontology Checks

| # | Check | Command / Action | Expected Result | Fix |
|---|-------|-----------------|-----------------|-----|
| 6 | Concepts loaded | `curl http://localhost:8080/api/ontology \| jq '.data.concepts \| length'` | Number matches your concept count (e.g., 8-10) | Verify `ontology_concepts` table has `status = 'active'` rows ([03-seed-ontology.md](03-seed-ontology.md)) |
| 7 | Properties loaded | Check API response: each concept has a `properties` array | Non-empty arrays for Guest, Staff, Schedule | Verify `ontology_properties` rows reference correct `concept_key` |
| 8 | Relationships loaded | Check API response: concepts with relationships have them | Guest shows pairings, schedule, prepItems relationships | Verify `ontology_relationships` rows |
| 9 | Sidebar navigation | Log in and check the sidebar | Shows Guests, Staff, Schedule, Prep Tracker, etc. | Ontology concepts drive sidebar items |

---

## RBAC Checks

| # | Check | Command / Action | Expected Result | Fix |
|---|-------|-----------------|-----------------|-----|
| 10 | Roles exist | `SELECT key, name FROM roles ORDER BY priority;` | At least director, liaison, volunteer, viewer | Insert role rows ([04-configure-rbac.md](04-configure-rbac.md)) |
| 11 | Permissions exist | `SELECT role_key, concept_key, can_view FROM permissions ORDER BY role_key;` | Rows for each role+concept pair | Insert permission rows |
| 12 | Director sees all guests | Log in as director, navigate to Guests | All guests visible with all fields | Check `permissions` row for `(director, guest)` |
| 13 | Volunteer sees limited fields | Log in as volunteer (or test via API with volunteer role) | Only name, type, department, status visible | Check `visible_properties` array |
| 14 | Unauthorized access blocked | `curl -H "Authorization: Bearer invalid" http://localhost:8080/api/domains/guest` | `401 Unauthorized` | Auth middleware is working correctly |

---

## Data Checks

| # | Check | Command / Action | Expected Result | Fix |
|---|-------|-----------------|-----------------|-----|
| 15 | Guests loaded | Navigate to Guests page | Guest list shows your seeded guests | Verify `guests` table has rows ([07-populate-data.md](07-populate-data.md)) |
| 16 | Staff loaded | Navigate to Staff page | Staff list shows your seeded staff | Verify `staff` table |
| 17 | Schedule loaded | Navigate to Schedule page | Events display with dates and venues | Verify `schedule_events` table |
| 18 | Prep tracker loaded | Navigate to Prep Tracker page | Prep items with status indicators | Verify `prep_items` table |
| 19 | Pairings loaded | Navigate to a guest detail page | Staff pairings section shows assigned liaison/interpreter | Verify `pairings` table with valid guest_id and staff_id |
| 20 | Cross-references intact | Run integrity queries from [07-populate-data.md](07-populate-data.md) | All queries return 0 rows (no orphaned references) | Fix dangling foreign keys |

---

## CRUD Operations

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 21 | Create a guest | Click "Add Guest," fill out the form, save | New guest appears in the list | Check form config, API write endpoint, permissions |
| 22 | Edit a guest | Click a guest, edit a field, save | Field updates, toast confirms save | Check `can_edit` permission, `editable_properties` |
| 23 | Delete a guest | (As director) delete a test guest | Guest removed from list | Check `can_delete` permission |
| 24 | Create a schedule event | Navigate to guest detail, add an event | Event appears in schedule | Check schedule form config |
| 25 | Update prep item status | Click a prep item, change status to complete | Status badge updates | Check prep permissions |
| 26 | Create a pairing | From guest detail, assign a staff member | Pairing appears in the pairings section | Check pairing permissions |

---

## Visual and Canvas Checks

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 27 | Canvas loads | Navigate to Canvas (`/canvas`) | Ontology graph renders with concept nodes and relationship edges | Check `api.get('/api/visualization/graph')` endpoint |
| 28 | Workflow canvas | Navigate to a workflow canvas (`/canvas/workflow/:id`) | Flow diagram shows trigger, condition, action nodes | Verify workflow config exists |
| 29 | Data flow canvas | Navigate to `/canvas/data-flows` | Data route visualization renders | Check `data_routes` table |

---

## Builder Checks

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 30 | Form builder opens | Navigate to `/builder/form/guest` | Builder UI loads with guest properties available | Ontology must have guest concept with properties |
| 31 | View builder opens | Navigate to `/builder/view/guest` | Builder UI loads with view type options | Ontology must have guest concept |
| 32 | Workflow builder opens | Navigate to `/builder/workflow` | Builder UI loads with trigger selection | Ontology events must be defined |
| 33 | Builder saves | Create a test view config, save, refresh | Config persists after page reload | Check API write endpoints for configs |

---

## Responsive and Performance Checks

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 34 | Mobile layout | Resize browser to 375px width or use mobile emulation | Sidebar collapses, tables scroll horizontally, forms stack vertically | Check TailwindCSS responsive classes |
| 35 | Tablet layout | Resize browser to 768px width | Two-column layout, sidebar toggleable | Check responsive breakpoints |
| 36 | Initial load time | Open browser dev tools > Performance tab, hard refresh | First meaningful paint < 3 seconds | Check bundle size, lazy loading, API response time |
| 37 | Navigation speed | Click between sidebar items | Page transitions < 500ms | Check Vue Router lazy loading |

---

## Error Checks

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 38 | No console errors | Open browser dev tools > Console, navigate through all pages | Zero errors (warnings are acceptable) | Fix JavaScript errors, missing imports, failed API calls |
| 39 | API error handling | Temporarily stop the backend, then load a page | Graceful error message, not a blank page | Check error boundaries in Vue components |
| 40 | Invalid route handling | Navigate to `/nonexistent-page` | Redirects to dashboard (catch-all route) | Check Vue Router catch-all in `web/src/router/index.ts` |

---

## Demo Mode Checks (If Applicable)

| # | Check | Action | Expected Result | Fix |
|---|-------|--------|-----------------|-----|
| 41 | Demo mode active | Check `isDemoMode` in browser console or look for demo indicator | Demo mode indicator visible | Verify `VITE_DEMO_MODE=true` in build |
| 42 | Reads from database | Load the guest list | Seeded guests appear | Verify database is seeded and API is reachable |
| 43 | Writes to localStorage | Create a guest, then check `localStorage` | Guest data stored locally | Demo adapter must be initialized |
| 44 | Isolation works | Open in incognito, verify no local changes visible | Only seeded data shows | This is expected behavior |
| 45 | Reset works | Clear localStorage and reload | Returns to seeded baseline | Expected behavior |

---

## Summary Checklist

Copy this checklist and mark off each item:

```
Infrastructure:
  [ ] Database accessible
  [ ] Schema complete (40+ tables)
  [ ] Backend running
  [ ] Frontend accessible
  [ ] Frontend-backend connection working

Ontology:
  [ ] Concepts loaded
  [ ] Properties loaded
  [ ] Relationships loaded
  [ ] Sidebar shows correct navigation

RBAC:
  [ ] Roles configured
  [ ] Permissions configured
  [ ] Director has full access
  [ ] Restricted roles see limited data

Data:
  [ ] Guests populated
  [ ] Staff populated
  [ ] Schedule populated
  [ ] Prep tracker populated
  [ ] Cross-references intact

CRUD:
  [ ] Create works
  [ ] Edit works
  [ ] Delete works (as director)

Visual:
  [ ] Canvas loads
  [ ] Builders open

Performance:
  [ ] < 3 second load
  [ ] No console errors
  [ ] Mobile responsive
```

---

## Troubleshooting

### Common Issues

**"VITE_API_BASE_URL is not configured" error:**
The frontend cannot find the backend. Set `VITE_API_BASE_URL` in `web/.env.local` or as a build-time environment variable.

**Blank page after login:**
Check browser console for errors. Common causes: Firebase config missing, CORS blocking API requests, ontology API returning an error.

**Guest list is empty but database has rows:**
Check RBAC permissions. If the logged-in user's role has no `permissions` row for the `guest` concept, the API returns an empty list (deny by default).

**"No authenticated user" error:**
The Firebase auth token is missing or expired. If developing locally, set `VITE_DEV_BYPASS_AUTH=true` to bypass authentication.

**Fields missing from forms:**
Check the form config's `fields` array. Each `propertyKey` must match an existing ontology property key. Also check the role's `visible_properties` -- RBAC filters fields after the form config.

**Sidebar items missing:**
Check `screen_access` rows for the user's role. Pages without a `visible = true` row are hidden.

---

## Post-Launch

After verification passes:

1. **Invite your team.** Create user accounts with appropriate roles and share login credentials.
2. **Iterate on forms and views.** Use the builders to refine layouts as your team gives feedback.
3. **Add workflows.** Start with the essential ones and add more as operational patterns emerge.
4. **Monitor the audit log.** Check `domain_audit_log` periodically to verify the system is being used as expected.
5. **Back up the database.** Set up automated backups with your Postgres provider.

---

## Document Index

| Doc | Title |
|-----|-------|
| [00-overview.md](00-overview.md) | Launch Overview |
| [01-infrastructure.md](01-infrastructure.md) | Infrastructure Setup |
| [02-database-schema.md](02-database-schema.md) | Database Schema Setup |
| [03-seed-ontology.md](03-seed-ontology.md) | Seeding the Ontology |
| [04-configure-rbac.md](04-configure-rbac.md) | Configuring Roles and Permissions |
| [05-build-forms-views.md](05-build-forms-views.md) | Building Forms and Views |
| [06-create-workflows.md](06-create-workflows.md) | Creating Workflows |
| [07-populate-data.md](07-populate-data.md) | Populating Operational Data |
| [08-demo-mode.md](08-demo-mode.md) | Demo Mode |
| [09-verification.md](09-verification.md) | Launch Verification (this file) |
