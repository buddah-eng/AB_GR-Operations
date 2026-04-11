# Phase 6 Consortium Synthesis

5 Opus agents analyzed 17 open questions + 10 user journey scenarios against the live codebase.

## Three Platform-Level Gaps (from UX Lifecycle Agent)

These account for 80% of all journey failures:

1. **The entire app is read-only.** ConfigListPage and ConfigDetailPage have ZERO write operations. No edit route, no inline edit, no status change UI, no kanban card-move handler. The only write path is the guest creation form.

2. **Six domain routes use the wrong shell.** Travel, accommodations, dietary, autographs, venues, pairings all use DomainListView (hardcoded DataTable fallback) instead of ConfigListPage. They bypass the config-driven engine.

3. **Navigation breaks for most concepts.** ConfigListPage.handleRowClick appends `s` to the concept key (`/${conceptKey}s/${id}`), but detail routes only exist for `guest`. Staff, schedule, prep_item row clicks all 404 silently.

## Prioritized Fix List

### Tier 1: CRITICAL (app is non-functional without these)

| # | Fix | Root Cause | Effort | Agent |
|---|-----|-----------|--------|-------|
| C1 | **Ontology store discards properties** | `ontology.ts` sets `concepts = data.concepts` but never merges `data.properties`. All property resolution (labels, types, validation) fails downstream. | S | Forms |
| C2 | **Workflow table name mismatch** | Engine queries `workflows` but migration creates `workflow_configs` with different column names. All automation silently fails. | S | Lifecycle |
| C3 | **Add edit mode to ConfigFormPage** | No `/guests/:id/edit` route. ConfigFormPage hardcoded for POST only. Backend PUT works. | S | Forms |
| C4 | **Wire kanban card-move to API** | ViewKanban emits `card-move` but ConfigListPage doesn't handle it. Drag-and-drop is visual only. | S | UX |
| C5 | **Add status change UI to detail page** | ConfigDetailPage is fully read-only. No dropdown, no transition button. Backend PUT + events work. | M | Lifecycle |
| C6 | **Fix row-click navigation** | Hardcoded `/${conceptKey}s/${id}` breaks for staff, schedule_event, prep_item. Need concept-aware routing. | S | UX |

### Tier 2: HIGH (core features missing)

| # | Fix | Root Cause | Effort | Agent |
|---|-----|-----------|--------|-------|
| H1 | **Create config-builder.ts** (form/view config write endpoints) | FormBuilder and ViewBuilder can't save — no POST/PUT `/api/form-configs` or `/api/view-configs` endpoints. | M | Builders |
| H2 | **Seed workflow configs** | Zero workflows seeded. Status transitions fire events but nothing catches them. Need guest-confirmed, guest-arrived workflows. | M | Lifecycle |
| H3 | **Seed RBAC permissions for all roles** | Only director has permissions. Liaison gets 403 on everything. Need full permission matrix. | M | Lifecycle |
| H4 | **Create contract tables** | contract_templates, contract_clauses, guest_contracts don't exist. Contract service queries them. | M | Data |
| H5 | **Fix form field labels** | Wizard step fields are strings not objects. adaptFormSteps needs to handle string arrays. Form seed fields lack required flags. | S | Forms |
| H6 | **Add builder links to ConfigListPage** | No link from operational pages to builders. Directors can't discover the customization UI. | S | Builders |
| H7 | **Migrate domain routes to ConfigListPage** | Travel, accommodations, dietary, autographs, venues, pairings should use config-driven shells, not DomainListView fallback. | S | UX |
| H8 | **Form submission redirects to detail** | After guest creation, redirects to list instead of new record's detail page. Created ID is thrown away. | S | UX |

### Tier 3: SHOULD FIX (UX improvements)

| # | Fix | Root Cause | Effort | Agent |
|---|-----|-----------|--------|-------|
| S1 | Add validation rules pipeline | buildValidation ignores validationRules (minLength, maxLength, pattern). Frontend type lacks the field. | M | Forms |
| S2 | Add detail routes for staff, schedule, prep | Only guest has a detail route. Other concepts have no /:id page. | S | UX |
| S3 | Add dashboard click-through | Stat cards show numbers but can't navigate to filtered list views. | S | UX |
| S4 | Remove broken domain routes or redirect | /accommodations, /dietary, /autographs → DomainListView which may not exist. Remove or point to guest properties. | S | Data |
| S5 | Test canvas editing on Vercel | Infrastructure exists (RBAC, config bridge, undo/redo). SSE may degrade but writes should work. | S | Data |
| S6 | Implement activity feed widget | Currently renders literal "Recent activity" text. Should fetch from audit/events API. | M | UX |

### Tier 4: DEFER (Phase 7/8)

| # | Item | Why Defer |
|---|------|-----------|
| D1 | transport_drivers table | Drivers are external actors via sessions, not persistent entities |
| D2 | Server-side aggregation API | Client-side counting works at convention scale (12 guests, 50 prep items) |
| D3 | Dashboard view-embed widgets | Full-page views exist for schedule/kanban. Embedding is UX polish. |
| D4 | Data flow canvas empty | Expected empty state. data_routes table exists, no seed data needed for GR module. |
| D5 | Relation-based data scoping (subquery) | Requires extending RBAC engine for join-through-pairings pattern. Complex. |
| D6 | Guest self-service frontend | API endpoints exist, no Vue component. Phase 7 demo scope. |
| D7 | Contract viewer + PDF export | Needs HTML-to-PDF pipeline. Phase 7 scope. |

## Consensus Across All 5 Agents

All agents independently identified the same root cause pattern: **the infrastructure exists but the wiring is missing.** The Express backend has a full write pipeline, workflow engine, RBAC system, event bus, and audit trail. The frontend has builders, view renderers, and a form engine. But:

- The ontology store doesn't merge properties → labels break
- The workflow engine queries the wrong table → automation breaks
- The shells are read-only → users can't do anything
- The builders can't save → admins can't configure
- No permissions seeded → non-director roles get 403

The fix is NOT more architecture. It's wiring: connecting existing backend to existing frontend, seeding the data that makes the system operational, and adding the 3-4 UI affordances (edit button, status dropdown, kanban card-move handler) that turn a read-only viewer into an operational tool.

## Recommended Execution Order

```
Phase A: Critical wiring (2-3 hours)
  C1: Fix ontology store property merge
  C2: Fix workflow table name  
  C5: Add status change UI to detail page
  C3: Add edit route + mode to ConfigFormPage
  C4: Wire kanban card-move
  C6: Fix row-click navigation

Phase B: Core features (3-4 hours)
  H1: Create config-builder.ts endpoints
  H2: Seed workflow configs
  H3: Seed RBAC permissions for all roles
  H5: Fix form field labels
  H6: Add builder links
  H7: Migrate domain routes
  H8: Fix form submission redirect

Phase C: Data + Polish (2-3 hours)
  H4: Create contract tables
  S1: Validation rules pipeline
  S2: Add detail routes for all concepts
  S3: Dashboard click-through
  S4: Clean up broken routes

→ Run E2E tests after each phase
→ Deploy to Vercel after each phase
→ Verify with Chrome automation after each phase
```

Total estimated effort: 7-10 hours across 3 phases.
