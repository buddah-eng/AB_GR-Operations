# Data Routing & Fan-Out

> **Configurable field-level routing from one concept to multiple consumers.** A guest record write fans out to GR (full record), PR (non-PII for social media), transport (pickup details only), scheduling (availability only). Routes define source concept + field list + destination concept + field mapping + transform reference + PII filtering. Route execution is triggered by domain events, respects RBAC field-level permissions, and maintains projections when source records update. Postgres is the system of record.

---

## Overview

When a guest is confirmed, their data needs to reach multiple departments -- but not all of it. Guest Relations keeps the full record including PII. Programming/PR receives only the public-facing fields (name, bio, photo -- no email, phone, or passport). Transport receives pickup details and flight information. Scheduling receives availability windows and panel preferences.

Today this fan-out is either manual (someone copies data between spreadsheets) or implicit (workflows create records in other concepts). Neither approach is configurable, auditable, or maintainable. Data routing makes this fan-out explicit: an admin defines a route from source concept to destination concept with a field mapping, optional transforms, and PII filtering rules. When the source record changes, all downstream projections update automatically.

Routes are first-class data in Postgres. They integrate with the event bus for trigger detection, the RBAC engine for permission enforcement, the encryption system for PII filtering, and the audit system for traceability. Routes are department-scoped: GR can route data to PR, but PR cannot route data back to GR's PII fields.

**Dependencies:** `core/event-bus.md`, `core/rbac-engine.md`, `data/encryption.md`, `core/audit-system.md`, `core/ontology-engine.md`, `api/domain-crud.md`

---

## 1. Route Definition Model

### Purpose

Define the data model for a route -- the declarative specification of how data flows from one concept to another.

### Detail

A route describes a unidirectional data flow: source concept fields are mapped to destination concept fields, optionally transformed, and written as a projection record.

```sql
CREATE TABLE data_routes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,

  -- Source
  source_concept_key  TEXT NOT NULL,         -- e.g. 'guest'
  source_fields       TEXT[] NOT NULL,       -- fields to read from source

  -- Destination
  dest_concept_key    TEXT NOT NULL,          -- e.g. 'pr_guest_profile'
  field_mappings      JSONB NOT NULL,         -- { "source_field": "dest_field", ... }

  -- Transform
  transform_id        UUID REFERENCES data_transforms(id),  -- optional transform chain
  pii_filter_mode     TEXT NOT NULL DEFAULT 'strip' CHECK (pii_filter_mode IN (
    'strip',          -- remove all PII fields (default)
    'pass',           -- pass PII through (requires explicit permission)
    'hash'            -- replace PII with HMAC hash
  )),

  -- Trigger
  trigger_on          TEXT[] NOT NULL DEFAULT '{on_create,on_update}',
  trigger_fields      TEXT[],                -- if set, only trigger on changes to these fields
  execution_mode      TEXT NOT NULL DEFAULT 'async' CHECK (execution_mode IN (
    'sync',           -- within the same transaction as the source write
    'async'           -- via event bus (default, recommended)
  )),

  -- Scoping
  owner_department    TEXT,                   -- which department owns this route
  source_department   TEXT,                   -- department that owns the source concept
  dest_department     TEXT,                   -- department that owns the destination concept
  rbac_role_key       TEXT,                   -- route executes with this role's permissions

  -- Lifecycle
  enabled             BOOLEAN NOT NULL DEFAULT true,
  version             INTEGER NOT NULL DEFAULT 1,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, version)
);

CREATE INDEX idx_data_routes_source ON data_routes (source_concept_key) WHERE enabled = true;
CREATE INDEX idx_data_routes_dest ON data_routes (dest_concept_key) WHERE enabled = true;
CREATE INDEX idx_data_routes_dept ON data_routes (owner_department) WHERE enabled = true;
```

**Field mappings JSONB structure:**

```json
{
  "name": "display_name",
  "bio": "public_bio",
  "photo_url": "profile_image",
  "panel_topics": "session_topics"
}
```

Keys are source field names, values are destination field names. Fields not listed are excluded from the projection.

**Route link field:** Every projection record includes a `_source_record_id` and `_source_concept_key` field so the system can trace projections back to their source and update them when the source changes.

### Acceptance Criteria

- [ ] `data_routes` table exists with all specified columns and constraints
- [ ] Field mappings JSONB validates that source fields exist on the source concept (via ontology engine)
- [ ] Field mappings JSONB validates that destination fields exist on the destination concept
- [ ] Route name + version is unique
- [ ] PII filter mode defaults to `strip` -- safe by default
- [ ] Execution mode defaults to `async` -- non-blocking by default

---

## 2. Route Triggers

### Purpose

Define when routes execute -- on record creation, update, or specific field changes -- using the platform's event bus.

### Detail

Routes subscribe to domain events based on their `trigger_on` and `trigger_fields` configuration:

| trigger_on | Event Pattern | When |
|------------|---------------|------|
| `on_create` | `{source_concept}.created` | Source record inserted |
| `on_update` | `{source_concept}.updated` | Source record updated |
| `on_delete` | `{source_concept}.deleted` | Source record soft-deleted |
| `on_field_change` | `{source_concept}.updated` + changedFields check | Specific field changes |

**Event bus integration:** The route executor subscribes to `*.*` on the event bus at priority 200 (after core handlers like audit at priority 50, but before low-priority handlers). On each event:

1. Load all enabled routes where `source_concept_key` matches `event.domain`.
2. Filter by `trigger_on`: does the event action match any trigger in the route's `trigger_on` array?
3. If `trigger_fields` is set, check `event.changedFields` for intersection. Skip if no overlap.
4. Execute the route (section 5).

**Field-change detection** uses the event bus's `changedFields` array from the `DomainEvent` payload. For example, a route with `trigger_fields: ['status', 'flight_number']` only fires when one of those fields is in `event.changedFields`.

### Acceptance Criteria

- [ ] Routes with `on_create` fire on `{concept}.created` events
- [ ] Routes with `on_update` fire on `{concept}.updated` events
- [ ] Routes with `on_delete` propagate soft-delete to projection records
- [ ] Routes with `trigger_fields` only fire when at least one listed field is in `changedFields`
- [ ] Routes without `trigger_fields` fire on every update to the source concept
- [ ] Route executor subscribes at priority 200 on the event bus
- [ ] Disabled routes are not evaluated

---

## 3. PII Filtering

### Purpose

Make PII stripping a first-class routing concern so that departments receiving projections never see data they should not have.

### Detail

PII filtering integrates with the encryption system (`data/encryption.md`). The ontology engine marks properties with `encrypted: true` on the `ontology_properties` table. The route executor uses this flag to identify PII fields.

**Filter modes:**

| Mode | Behavior | Use Case |
|------|----------|----------|
| `strip` | PII fields are removed from the projection entirely. If a PII field appears in `source_fields`, it is excluded before mapping. | PR department: no guest email/phone |
| `pass` | PII fields are included in the projection. Requires explicit RBAC permission check: the route's `rbac_role_key` must have the PII field in its `visibleProperties` for the destination concept. | GR internal: full guest record duplication |
| `hash` | PII fields are replaced with `HMAC-SHA256(value, hmac_key)`. Useful for deduplication without exposing values. | Analytics: count unique guests without seeing emails |

**Enforcement order:**

```
Source record
  -> RBAC field filter (route's rbac_role_key, source concept)
  -> PII filter (strip/pass/hash based on route config)
  -> Transform (data-transforms.md)
  -> Field mapping (source field -> dest field name)
  -> Write to destination
```

PII filtering happens BEFORE transforms and mapping. This ensures transforms never receive PII data in `strip` mode.

### Acceptance Criteria

- [ ] `strip` mode removes all fields where `ontology_properties.encrypted = true`
- [ ] `pass` mode requires the route's RBAC role to have PII fields in `visibleProperties`
- [ ] `pass` mode with insufficient permissions falls back to `strip` for those fields (fail-safe)
- [ ] `hash` mode produces consistent HMAC values for the same input (deterministic for deduplication)
- [ ] PII filtering occurs before transforms -- transforms never see stripped PII
- [ ] Audit log records which PII filter mode was applied per route execution

---

## 4. Department-Scoped Routes

### Purpose

Enforce that departments can only route data they own, and can only route to departments they have access to.

### Detail

Route scoping uses the ontology scoping model (`core/ontology-scoping.md`):

- `owner_department`: the department that created and manages this route.
- `source_department`: must match the department that owns the source concept. GR owns `guest`, so only GR can create routes sourced from `guest`.
- `dest_department`: the department receiving the projection.

**Access rules:**

| Source Dept | Dest Dept | Allowed | Example |
|-------------|-----------|---------|---------|
| GR | PR | Yes (with PII strip) | Guest public profile for social media |
| GR | Transport | Yes (with PII strip) | Pickup details for drivers |
| GR | Scheduling | Yes (with PII strip) | Guest availability for panel planning |
| PR | GR | No | PR cannot push data into GR's domain |
| GR | GR | Yes (with PII pass) | Internal GR projections (full data) |

**Cross-department routes require admin approval.** Routes where `source_department != dest_department` are created in `pending` status and require an admin with `routes:approve` permission to activate them. Same-department routes activate immediately.

**RBAC enforcement:** The route's `rbac_role_key` determines what fields are accessible. The route executor calls `roleEngine.getVisibleProperties(rbac_role_key, source_concept_key)` to determine which source fields the route can read. Fields not in the role's visible list are excluded even if listed in `source_fields`.

### Acceptance Criteria

- [ ] Routes can only be created by users in the source concept's owning department
- [ ] Cross-department routes require admin approval before activation
- [ ] Route execution respects RBAC field-level permissions via `rbac_role_key`
- [ ] A route cannot access source fields that the `rbac_role_key` does not have in `visibleProperties`
- [ ] PR cannot create routes sourced from GR concepts without GR admin approval

---

## 5. Route Execution

### Purpose

Define the runtime behavior of route execution -- how source data is read, filtered, transformed, mapped, and written to the destination.

### Detail

**Synchronous execution** (`execution_mode = 'sync'`):

The route executes within the same Postgres transaction as the source write. The projection write is atomic with the source write -- if either fails, both roll back. Use for critical projections where consistency matters more than latency.

**Asynchronous execution** (`execution_mode = 'async'`):

The route executes via the event bus after the source transaction commits. The projection write is a separate transaction. Use for non-critical projections where eventual consistency is acceptable and latency should not affect the source write.

**Execution steps (both modes):**

```
1. Read source record (from event.newValues for async, or current row for sync)
2. Apply RBAC field filter: roleEngine.getVisibleProperties(route.rbac_role_key, source_concept_key)
3. Apply PII filter: strip/pass/hash per route.pii_filter_mode
4. Apply transform: if route.transform_id is set, run the transform chain (data-transforms.md)
5. Apply field mapping: rename fields per route.field_mappings
6. Check for existing projection: SELECT * FROM {dest_concept} WHERE _source_record_id = $1
7. If exists: UPDATE the projection record with new values
8. If not exists: INSERT a new projection record with _source_record_id and _source_concept_key
9. Emit domain event: {dest_concept}.synced
10. Write audit log entry: route execution, fields routed, PII filter applied
```

**Projection maintenance:** When a source record updates, the route re-executes and updates the existing projection (step 7). The projection is not deleted and re-created -- it is patched with changed fields only.

**Delete propagation:** When a source record is soft-deleted (`on_delete` trigger), the projection is also soft-deleted (sets `archived_at`, `is_archived = true`).

**Batch execution:** On route creation or re-enablement, a backfill job runs the route against all existing source records to create initial projections.

### Acceptance Criteria

- [ ] Sync routes execute within the source write transaction
- [ ] Async routes execute after the source transaction commits via event bus
- [ ] Existing projections are updated (not duplicated) when source records change
- [ ] New projections include `_source_record_id` and `_source_concept_key` for traceability
- [ ] Delete propagation soft-deletes projection records
- [ ] Backfill job creates projections for all existing source records when a route is enabled
- [ ] Route execution emits `{dest_concept}.synced` domain event
- [ ] Route execution is recorded in the audit log

---

## 6. Route CRUD API

### Purpose

Define the API for managing data routes.

### Detail

```
GET    /api/data-routes?source=...&dest=...&dept=...   -- list routes (filtered)
GET    /api/data-routes/:id                             -- get single route
POST   /api/data-routes                                 -- create route
PUT    /api/data-routes/:id                             -- update (creates new version)
DELETE /api/data-routes/:id                             -- disable route
POST   /api/data-routes/:id/execute                     -- manual route execution (backfill)
POST   /api/data-routes/:id/approve                     -- approve cross-dept route
GET    /api/data-routes/:id/projections                 -- list projection records for this route
```

**Validation on create/update:**

1. `source_concept_key` exists in ontology
2. `dest_concept_key` exists in ontology
3. All `source_fields` exist as properties on the source concept
4. All destination fields in `field_mappings` exist as properties on the destination concept
5. If `transform_id` is set, the transform exists and is compatible
6. `rbac_role_key` exists in the roles table
7. Department scoping rules are satisfied (section 4)

**RBAC:** Route management requires `routes:manage` permission. Cross-department approval requires `routes:approve` permission.

### Acceptance Criteria

- [ ] All CRUD operations go through the full write pipeline (auth, RBAC, audit, events)
- [ ] Route updates create new versions (versioning service)
- [ ] Route deletion disables the route (soft-delete, does not delete projections)
- [ ] Manual execution triggers a backfill job and returns a job status
- [ ] Validation rejects routes with nonexistent concepts, fields, or roles
- [ ] API requires `routes:manage` permission

---

## 7. Projection Storage

### Purpose

Define how projection records are stored and linked to their source.

### Detail

Projection records are stored in the destination concept's table (the same table used by the domain CRUD API). They are distinguished from manually-created records by the presence of `_source_record_id` and `_source_concept_key` metadata fields.

Every concept table includes these optional metadata columns:

```sql
ALTER TABLE {concept_table} ADD COLUMN IF NOT EXISTS _source_record_id UUID;
ALTER TABLE {concept_table} ADD COLUMN IF NOT EXISTS _source_concept_key TEXT;
ALTER TABLE {concept_table} ADD COLUMN IF NOT EXISTS _source_route_id UUID REFERENCES data_routes(id);

CREATE INDEX idx_{concept}_source ON {concept_table} (_source_record_id)
  WHERE _source_record_id IS NOT NULL;
```

**Projection vs. manual records:** Records with `_source_record_id IS NOT NULL` are projections and are read-only through the standard CRUD API (updates come only through route re-execution). Records with `_source_record_id IS NULL` are manually created and editable normally.

**Querying projections:** The domain CRUD API filters projections out of default queries (only manually-created records appear). A query parameter `?include_projections=true` includes them. The route API's `/projections` endpoint returns only projection records for a specific route.

### Acceptance Criteria

- [ ] Projection records include `_source_record_id`, `_source_concept_key`, `_source_route_id`
- [ ] Projection records are read-only through the standard CRUD API
- [ ] Default CRUD queries exclude projections unless `include_projections=true`
- [ ] Projection index supports fast lookups by `_source_record_id`
- [ ] Deleting a route does not delete its projection records (they become orphaned but queryable)

---

## 8. Test Plan

### 8.1 Route Definition Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| R-01 | Unit | Create route with valid source/dest concepts | Route created, version 1 |
| R-02 | Unit | Create route with nonexistent source concept | Validation error |
| R-03 | Unit | Create route with field not on source concept | Validation error |
| R-04 | Unit | Create route with mismatched field mapping types | Validation warning |
| R-05 | Unit | Update route | New version created, previous version preserved |

### 8.2 Trigger Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| T-01 | Integration | Route with `on_create`, create source record | Projection created in destination |
| T-02 | Integration | Route with `on_update`, update source record | Projection updated in destination |
| T-03 | Integration | Route with `on_delete`, delete source record | Projection soft-deleted |
| T-04 | Integration | Route with `trigger_fields: ['status']`, update `name` field | Route does not fire |
| T-05 | Integration | Route with `trigger_fields: ['status']`, update `status` field | Route fires, projection updated |
| T-06 | Integration | Disabled route, create source record | Route does not fire |

### 8.3 PII Filtering Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| P-01 | Unit | Route with `pii_filter_mode: 'strip'`, source has email (encrypted) | Projection does not contain email |
| P-02 | Unit | Route with `pii_filter_mode: 'pass'`, role has email in visibleProperties | Projection contains email |
| P-03 | Unit | Route with `pii_filter_mode: 'pass'`, role lacks email in visibleProperties | Projection does not contain email (fail-safe) |
| P-04 | Unit | Route with `pii_filter_mode: 'hash'`, source has email | Projection contains HMAC of email |
| P-05 | Unit | PII filter runs before transform | Transform input does not contain stripped PII fields |

### 8.4 Department Scoping Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| D-01 | Integration | GR user creates route from guest to pr_profile | Route created in `pending` status |
| D-02 | Integration | Admin approves cross-dept route | Route activated |
| D-03 | Integration | PR user creates route from guest to pr_profile | 403 Forbidden (PR doesn't own guest) |
| D-04 | Integration | GR user creates route from guest to guest_archive (same dept) | Route activated immediately |

### 8.5 Execution Tests

| Test | Type | Setup | Expected |
|------|------|-------|----------|
| E-01 | Integration | Sync route, create source record | Projection created in same transaction |
| E-02 | Integration | Sync route, source write fails | No projection created (rolled back) |
| E-03 | Integration | Async route, create source record | Projection created after event bus delivery |
| E-04 | Integration | Update source record with existing projection | Projection updated (not duplicated) |
| E-05 | Integration | Backfill on route enable with 100 existing source records | 100 projections created |
| E-06 | Integration | RBAC role lacks access to a source field listed in route | Field excluded from projection |

### 8.6 Performance Tests

| Test | Setup | Target |
|------|-------|--------|
| 50 routes on same source concept | Create source record | All 50 projections created in < 5s (async) |
| Backfill 10,000 records | Enable route with 10k source records | Backfill completes in < 60s |
| Concurrent source updates | 100 concurrent updates to same source | All projections consistent, no deadlocks |

**Coverage target:** >=80% on route executor, PII filtering, and field mapping logic. 100% on PII filter mode enforcement.

---

## 9. Dependencies

| PRD | Relationship |
|-----|-------------|
| `core/event-bus.md` | Route triggers subscribe to domain events |
| `core/rbac-engine.md` | Route execution uses `getVisibleProperties()` for field-level filtering |
| `data/encryption.md` | PII field identification via `ontology_properties.encrypted` flag |
| `core/audit-system.md` | Route executions are recorded in `domain_audit_log` |
| `core/ontology-engine.md` | Route validation checks concepts and properties exist |
| `api/domain-crud.md` | Projection records are stored via the domain CRUD layer |
| `data-infrastructure/data-transforms.md` | Routes reference transforms by ID |
| `platform/template-infrastructure.md` | Route configs can be stored as reusable templates |
