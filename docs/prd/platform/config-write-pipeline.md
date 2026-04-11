# Config Write Pipeline

> Builders can render configs but cannot save them. No POST/PUT endpoints exist for form_configs or view_configs.
> ViewBuilder sends frontend-shaped payloads that don't match DB column names. Versioning looks up by `key` but configs use `concept_key + name`.
> This PRD creates the full config write pipeline: endpoints, payload adapters, versioning, cache invalidation, and builder discoverability.

---

## Overview

The FormBuilder and ViewBuilder are fully functional UI tools for designing forms and views. They load existing configs, let the user drag/drop fields, adjust layout, preview results -- and then the "Save" button fails silently because no backend endpoint exists to receive the payload.

This PRD covers every builder integration finding from the Phase 6 consortium (B1-B6, H1, H6):

- **New `config-builder.ts` router** with POST/PUT for `form_configs` and `view_configs`
- **ViewBuilder save payload shape adapter** translating frontend field names to DB column names
- **Versioning alignment** using `concept_key + name` composite instead of a nonexistent `key` column
- **Cache invalidation** after config saves so operational pages reflect changes immediately
- **Builder links from operational pages** so directors can discover the customization UI
- **FormBuilder/ViewBuilder loading saved configs** from the correct endpoints

**Dependencies:** `platform/data-wiring.md` (ontology store must work correctly for builders to load concept metadata)

---

## Full Specification

### 1. Config Builder Router (POST/PUT Endpoints)

#### Purpose

FormBuilder and ViewBuilder need backend endpoints to persist configuration changes. Currently no route handles writes to `form_configs` or `view_configs` tables.

#### Detail

Create `functions/src/routes/config-builder.ts` with these endpoints:

**Form Configs:**
- `POST /api/form-configs` -- create a new form config
  - Body: `{ concept_key, name, description?, config }` where `config` contains steps, fields, layout
  - Returns: `{ success: true, data: { id, concept_key, name, version, ... } }`
  - Emits: `form_config.created` domain event
- `PUT /api/form-configs/:id` -- update an existing form config
  - Body: same shape as POST
  - Returns: `{ success: true, data: { id, concept_key, name, version, ... } }`
  - Emits: `form_config.updated` domain event
  - Increments version via the versioning service

**View Configs:**
- `POST /api/view-configs` -- create a new view config
  - Body: `{ concept_key, name, description?, config }` where `config` contains view type, columns, sorts, filters
  - Returns: `{ success: true, data: { id, concept_key, name, version, ... } }`
  - Emits: `view_config.created` domain event
- `PUT /api/view-configs/:id` -- update an existing view config
  - Body: same shape as POST (after adapter transformation -- see Section 2)
  - Returns: `{ success: true, data: { id, concept_key, name, version, ... } }`
  - Emits: `view_config.updated` domain event

All endpoints require authentication and `director` or `admin` role (via RBAC middleware).

#### Acceptance Criteria

- [ ] `POST /api/form-configs` creates a new form config row in Postgres and returns the created record **(B1, H1)**
- [ ] `PUT /api/form-configs/:id` updates an existing form config row and increments its version **(B1, H1)**
- [ ] `POST /api/view-configs` creates a new view config row in Postgres and returns the created record **(B1, H1)**
- [ ] `PUT /api/view-configs/:id` updates an existing view config row and increments its version **(B1, H1)**
- [ ] All config write endpoints require `director` or `admin` role **(B1)**
- [ ] Domain events are emitted on create and update **(B1)**

---

### 2. ViewBuilder Save Payload Shape Adapter

#### Purpose

The ViewBuilder sends frontend-shaped data using camelCase field names and frontend-specific structures. The Postgres `view_configs` table uses snake_case column names and different field semantics. A server-side adapter must transform the payload before writing.

#### Detail

The ViewBuilder sends:
```
{
  viewType: "table",
  sorts: [{ field: "name", direction: "asc" }],
  dateField: "arrival_date",
  endDateField: "departure_date",
  filterCondition: { field: "status", op: "eq", value: "confirmed" }
}
```

The DB expects:
```
{
  view_type: "table",
  sort: { field: "name", direction: "asc" },
  timeline_start: "arrival_date",
  timeline_end: "departure_date",
  filters: { field: "status", op: "eq", value: "confirmed" }
}
```

Create a `transformViewPayload(frontendPayload)` function in the config-builder router that:
- Maps `viewType` -> `view_type`
- Maps `sorts` (array) -> `sort` (first element, or structured object)
- Maps `dateField` -> `timeline_start`
- Maps `endDateField` -> `timeline_end`
- Maps `filterCondition` -> `filters`
- Passes through all other fields unchanged

This function is called in the PUT/POST handler before writing to Postgres.

#### Acceptance Criteria

- [ ] `viewType` is transformed to `view_type` before DB write **(B4)**
- [ ] `sorts` array is transformed to `sort` singular before DB write **(B4)**
- [ ] `dateField` is transformed to `timeline_start` before DB write **(B4)**
- [ ] `endDateField` is transformed to `timeline_end` before DB write **(B4)**
- [ ] `filterCondition` is transformed to `filters` before DB write **(B4)**
- [ ] The adapter is a pure function that does not mutate the input payload **(B4)**
- [ ] Unrecognized fields pass through without error **(B4)**

---

### 3. Versioning Alignment (concept_key + name, not key)

#### Purpose

The versioning service's `updateOntologyRecord()` looks up records by a `key` column that does not exist in the `form_configs` or `view_configs` tables. The FormBuilder's `handleSave()` uses the UUID `id` to identify configs. These are incompatible.

#### Detail

- The config-builder router's PUT handler accepts the UUID `id` from the URL path
- It looks up the existing config by `id` to retrieve the `concept_key` and `name`
- It calls the versioning service using the `concept_key + name` composite as the unique identifier (this pair is unique per config type)
- The versioning service increments the version number and stores a snapshot of the previous config for rollback
- If the versioning service's `updateOntologyRecord` requires a `key` parameter, the router passes `${concept_key}::${name}` as a synthetic key

This bridges the gap between the FormBuilder (which knows the `id`) and the versioning service (which identifies by key).

#### Acceptance Criteria

- [ ] PUT endpoints accept UUID `id` from the URL and resolve `concept_key + name` for versioning **(B6, B3)**
- [ ] The versioning service receives a valid identifier (not a nonexistent `key` column value) **(B3)**
- [ ] Version number increments on each successful update **(B3, B6)**
- [ ] Previous config snapshot is stored for rollback capability **(B6)**
- [ ] Config tables do not require a `key` column to be added; the router bridges the identifier gap **(B3)**

---

### 4. Cache Invalidation After Config Saves

#### Purpose

The ontology loader caches configs with a 5-minute TTL (`TTL_ONTOLOGY_MS`). After saving a config change in the builder, the operational page still shows the old config until the cache expires. Users expect immediate feedback.

#### Detail

- After a successful POST or PUT to form_configs or view_configs:
  1. Call `reloadOntology()` to invalidate the entire ontology cache, OR
  2. Invalidate only the specific cache key for the modified config type (`form_configs:${concept_key}` or `view_configs:${concept_key}`)
- Option 2 is preferred for performance (avoids reloading all ontology data), but Option 1 is acceptable as a first implementation
- The invalidation must happen on the server side (the backend cache), not just the client
- The response from the PUT/POST endpoint includes a `cacheInvalidated: true` flag so the client knows to refetch

#### Acceptance Criteria

- [ ] After saving a form config, the operational page reflects the change without waiting for TTL expiry **(B5)**
- [ ] After saving a view config, the operational page reflects the change without waiting for TTL expiry **(B5)**
- [ ] `reloadOntology()` or equivalent cache invalidation is called after every config write **(B5)**
- [ ] Cache invalidation does not cause errors for concurrent requests reading the old cache **(B5)**

---

### 5. Builder Links from Operational Pages

#### Purpose

Directors and admins have no way to discover or access the FormBuilder or ViewBuilder from within the operational pages. There is no link, button, or menu item that leads to the builder UI.

#### Detail

- Add a gear icon (settings/customize) to ConfigListPage and ConfigDetailPage headers
- The gear icon is visible only to roles with `director` or `admin` permission
- Clicking the gear icon opens a dropdown with:
  - "Customize View" -> navigates to ViewBuilder with the current view config pre-loaded
  - "Customize Form" -> navigates to FormBuilder with the current form config pre-loaded
- The navigation passes the config ID so the builder opens in edit mode for the existing config
- If no config exists for the current concept (unlikely given seeds), the link navigates to the builder in create mode

#### Acceptance Criteria

- [ ] ConfigListPage header shows a gear icon for director/admin roles **(B2, H6)**
- [ ] ConfigDetailPage header shows a gear icon for director/admin roles **(B2, H6)**
- [ ] Gear icon is hidden for non-director/non-admin roles **(B2)**
- [ ] "Customize View" navigates to ViewBuilder with the current config pre-loaded **(B2, H6)**
- [ ] "Customize Form" navigates to FormBuilder with the current form config pre-loaded **(B2, H6)**
- [ ] Builder opens in edit mode when a config exists, create mode when it does not **(B2)**

---

### 6. FormBuilder/ViewBuilder Loading Saved Configs

#### Purpose

The builders need to load existing configs from the correct GET endpoints so that editing an existing config shows its current state, not a blank canvas.

#### Detail

- FormBuilder loads config via `GET /api/form-configs?concept_key={key}` or `GET /api/form-configs/:id`
- ViewBuilder loads config via `GET /api/view-configs?concept_key={key}` or `GET /api/view-configs/:id`
- These GET endpoints already exist in the ontology loader; the builders must use them
- The FormBuilder's internal state (`formConfig`) is populated from the loaded config
- The ViewBuilder's internal state (`viewConfig`) is populated after inverse-transforming DB column names back to frontend names (reverse of the adapter in Section 2)
- If loading fails (404, network error), the builder shows an empty canvas with an error banner

#### Acceptance Criteria

- [ ] FormBuilder loads saved config from the correct GET endpoint when opened in edit mode **(B1)**
- [ ] ViewBuilder loads saved config from the correct GET endpoint when opened in edit mode **(B1)**
- [ ] ViewBuilder inverse-transforms DB column names to frontend field names for display **(B4)**
- [ ] Loading failure shows an error banner, not a silent blank canvas **(B1)**
- [ ] F7: `overrideLabel` and `overridePlaceholder` fields are preserved through save/load round-trip **(F7)**

---

## Finding Coverage Matrix

| Finding ID | Section | Description |
|------------|---------|-------------|
| B1, H1 | 1, 6 | No POST/PUT form-configs or view-configs endpoints |
| B2, H6 | 5 | No link from operational pages to builders |
| B3 | 3 | Versioning service can't find config tables (no key column) |
| B4 | 2, 6 | ViewBuilder save payload shape mismatch |
| B5 | 4 | Cache invalidation after config save |
| B6 | 3 | FormBuilder uses id, versioning uses key -- incompatible |
| F7 | 6 | overrideLabel/overridePlaceholder untested through save/load |

---

## Test Plan

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | POST /api/form-configs with valid payload | 201, config row created, domain event emitted |
| T-02 | PUT /api/form-configs/:id with valid payload | 200, config row updated, version incremented |
| T-03 | POST /api/view-configs with ViewBuilder-shaped payload | 201, payload transformed to DB column names, row created |
| T-04 | PUT /api/view-configs/:id | 200, version incremented, cache invalidated |
| T-05 | Non-director role calls POST /api/form-configs | 403 Forbidden |
| T-06 | Save config, immediately load operational page | Page reflects the new config (no 5-minute wait) |
| T-07 | Click gear icon on ConfigListPage as director | Dropdown shows "Customize View" and "Customize Form" |
| T-08 | Click gear icon as liaison | Icon is not rendered |
| T-09 | Open ViewBuilder for existing config | Config loads with correct field mappings (viewType, sorts, etc.) |
| T-10 | Save config with overrideLabel set, reload builder | overrideLabel is present in loaded config |
| T-11 | PUT with id, versioning resolves concept_key+name | Version increments correctly |
| T-12 | Save config when ontology cache is warm | Cache invalidated; next GET returns new config |
