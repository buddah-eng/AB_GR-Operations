# Postgres Schema Design

> Typed core columns + JSONB `properties` for ontology-defined dynamic fields. GIN indexes for JSONB queries.
> Ontology tables carry versioning columns for rollback. Audit triggers on every ontology table catch direct DB access.
> Domain tables per concept with FK constraints, soft-delete via `archived` flag.

---

## Overview

Postgres is the system of record for everything: ontology definitions, platform config (forms, views, workflows, permissions), domain data (guests, staff, events), and audit logs. The schema uses a hybrid approach — typed columns for core fields that are frequently queried, and a JSONB `properties` column for ontology-defined dynamic fields that vary per convention.

Tables fall into six families: **Ontology** (5 tables defining the domain model), **Config** (4 tables for UI/automation), **RBAC** (6 tables for permissions), **Domain** (1 table per concept), **Audit** (2 tables), and **Infrastructure** (sessions, API keys, etc.).

---

## Full Specification

### 1. Schema Philosophy

**Purpose:** Define the hybrid typed + JSONB approach.

**Detail:**

Every domain table has both typed columns and a JSONB column:

```sql
CREATE TABLE guests (
  -- Typed core columns (indexed, queryable, schema-enforced)
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  type        TEXT,
  department  TEXT,
  
  -- Dynamic properties (ontology-defined, flexible)
  properties  JSONB NOT NULL DEFAULT '{}',
  
  -- Metadata
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- GIN index for JSONB queries
CREATE INDEX idx_guests_properties ON guests USING GIN (properties);

-- Partial index for active records (most queries exclude archived)
CREATE INDEX idx_guests_active ON guests (status) WHERE NOT archived;
```

**Why hybrid:**
- Typed columns: fast queries, FK constraints, NOT NULL enforcement, efficient indexes
- JSONB: flexibility for ontology-defined properties that change per convention, no schema migrations when admin adds a field

**Which properties go where:**
- Core fields used in queries, filters, and sorts → typed columns
- Everything else → JSONB `properties`
- The ontology-to-schema bridge determines routing (see `core/ontology-engine.md`)

**Acceptance Criteria:**
- [ ] Queries on typed columns use btree indexes
- [ ] Queries on JSONB properties use GIN index
- [ ] Adding a property via ontology web builder requires zero schema migration

---

### 2. Ontology Tables

**Purpose:** Store the domain model definition.

**Detail:**

All ontology tables include versioning columns for the CI/QA pipeline:

```sql
-- Common versioning columns (on every ontology table)
version             INTEGER NOT NULL DEFAULT 1,
status              TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
owner_scope         TEXT NOT NULL DEFAULT 'org'
                    CHECK (owner_scope IN ('org', 'department')),
owner_department    TEXT,
changed_by          UUID,
changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
change_reason       TEXT,
previous_version_id UUID
```

#### 2.1 ontology_concepts

```sql
CREATE TABLE ontology_concepts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  plural_name         TEXT NOT NULL,
  extends             TEXT,  -- parent concept key
  icon                TEXT,
  description         TEXT,
  is_registry         BOOLEAN NOT NULL DEFAULT false,
  is_config           BOOLEAN NOT NULL DEFAULT false,
  
  -- Versioning
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active',
  owner_scope         TEXT NOT NULL DEFAULT 'org',
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_concepts(id),
  
  UNIQUE (key, version)
);

CREATE INDEX idx_concepts_active ON ontology_concepts (key) WHERE status = 'active';
```

#### 2.2 ontology_properties

```sql
CREATE TABLE ontology_properties (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key         TEXT NOT NULL,
  key                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN (
    'text', 'rich_text', 'number', 'select', 'multi_select', 'date', 'datetime',
    'checkbox', 'url', 'email', 'phone', 'relation', 'formula', 'rollup',
    'files', 'people', 'status'
  )),
  required            BOOLEAN NOT NULL DEFAULT false,
  default_value       JSONB,
  placeholder         TEXT,
  description         TEXT,
  postgres_column     TEXT,  -- if this property maps to a typed column
  options             JSONB,  -- for select/multi_select: [{value, label, color}]
  validation_rules    JSONB,  -- {minLength, maxLength, min, max, pattern}
  sort_order          INTEGER NOT NULL DEFAULT 0,
  hidden              BOOLEAN NOT NULL DEFAULT false,
  read_only           BOOLEAN NOT NULL DEFAULT false,
  
  -- Versioning
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active',
  owner_scope         TEXT NOT NULL DEFAULT 'org',
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_properties(id),
  
  UNIQUE (concept_key, key, version)
);

CREATE INDEX idx_properties_concept ON ontology_properties (concept_key) WHERE status = 'active';
```

#### 2.3 ontology_relationships

```sql
CREATE TABLE ontology_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_concept_key  TEXT NOT NULL,
  target_concept_key  TEXT NOT NULL,
  key                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  cardinality         TEXT NOT NULL CHECK (cardinality IN ('has-one', 'has-many', 'many-to-many')),
  inverse_key         TEXT,
  description         TEXT,
  
  -- Versioning
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active',
  owner_scope         TEXT NOT NULL DEFAULT 'org',
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_relationships(id),
  
  UNIQUE (source_concept_key, key, version)
);
```

#### 2.4 ontology_events

```sql
CREATE TABLE ontology_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key         TEXT NOT NULL,
  event_key           TEXT NOT NULL,
  full_event_name     TEXT NOT NULL,  -- e.g., "guest.created"
  trigger_type        TEXT NOT NULL CHECK (trigger_type IN (
    'on_create', 'on_update', 'on_delete', 'on_field_change', 'scheduled', 'manual'
  )),
  changed_fields      TEXT[],  -- for on_field_change
  schedule            TEXT,    -- cron expression for scheduled
  description         TEXT,
  
  -- Versioning (same columns)
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active',
  owner_scope         TEXT NOT NULL DEFAULT 'org',
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_events(id),
  
  UNIQUE (concept_key, event_key, version)
);
```

#### 2.5 ontology_constraints

```sql
CREATE TABLE ontology_constraints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key         TEXT NOT NULL,
  name                TEXT NOT NULL,
  extends             TEXT,  -- parent concept key
  condition           JSONB NOT NULL,  -- ConditionExpression
  defaults            JSONB,           -- default values when condition matches
  required_fields     TEXT[],          -- additional required fields
  description         TEXT,
  
  -- Versioning
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active',
  owner_scope         TEXT NOT NULL DEFAULT 'org',
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_constraints(id),
  
  UNIQUE (concept_key, name, version)
);
```

**Acceptance Criteria:**
- [ ] All ontology tables created with versioning columns
- [ ] Active records queryable via `WHERE status = 'active'`
- [ ] Previous versions accessible via `previous_version_id` chain
- [ ] Unique constraints prevent duplicate active records

---

### 3. Config Tables

**Purpose:** Store UI and automation configuration.

```sql
CREATE TABLE form_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key   TEXT NOT NULL,
  name          TEXT NOT NULL,
  layout        TEXT NOT NULL DEFAULT 'single' CHECK (layout IN ('single', 'two-column', 'wizard')),
  fields        JSONB NOT NULL DEFAULT '[]',   -- FormFieldConfig[]
  steps         JSONB,                          -- FormStep[] (for wizard)
  
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  owner_scope   TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by    UUID,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (concept_key, name, version)
);

CREATE TABLE view_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key   TEXT NOT NULL,
  name          TEXT NOT NULL,
  view_type     TEXT NOT NULL CHECK (view_type IN ('table', 'kanban', 'timeline', 'detail', 'dashboard')),
  columns       JSONB,     -- ViewColumn[]
  filters       JSONB,     -- ViewFilter[]
  sort          JSONB,     -- ViewSort
  group_by      TEXT,      -- property key (kanban)
  timeline_start TEXT,     -- property key (timeline)
  timeline_end  TEXT,
  row_action    TEXT CHECK (row_action IN ('navigate_to_detail', 'inline_edit', 'none')),
  presets       JSONB,     -- ViewPreset[]
  
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  owner_scope   TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by    UUID,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (concept_key, name, version)
);

CREATE TABLE page_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  widgets       JSONB NOT NULL DEFAULT '[]',  -- WidgetConfig[]
  breakpoints   JSONB,                         -- responsive layouts
  
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  changed_by    UUID,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (slug, version)
);

CREATE TABLE workflow_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  trigger       JSONB NOT NULL,    -- WorkflowTrigger
  condition     JSONB,             -- ConditionExpression
  actions       JSONB NOT NULL,    -- WorkflowAction[]
  enabled       BOOLEAN NOT NULL DEFAULT true,
  
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  owner_scope   TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by    UUID,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (name, version)
);
```

**Acceptance Criteria:**
- [ ] Each config type loadable by concept key
- [ ] Version history preserved
- [ ] JSONB fields validated at application layer against TypeScript interfaces

---

### 4. RBAC Tables

**Purpose:** Store roles, permissions, and access control configuration.

```sql
CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER NOT NULL DEFAULT 100,  -- lower = more access
  is_operational  BOOLEAN NOT NULL DEFAULT false,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key            TEXT NOT NULL REFERENCES roles(key),
  concept_key         TEXT NOT NULL,
  can_view            BOOLEAN NOT NULL DEFAULT false,
  can_create          BOOLEAN NOT NULL DEFAULT false,
  can_edit            BOOLEAN NOT NULL DEFAULT false,
  can_delete          BOOLEAN NOT NULL DEFAULT false,
  visible_properties  TEXT[] NOT NULL DEFAULT '{}',
  editable_properties TEXT[],
  
  UNIQUE (role_key, concept_key)
);

CREATE TABLE data_scopes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key        TEXT NOT NULL REFERENCES roles(key),
  concept_key     TEXT NOT NULL,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('all', 'relation', 'field', 'department')),
  relation_path   TEXT,    -- for relation scope: e.g., "pairings.staff"
  field           TEXT,    -- for field/department scope
  value           TEXT,    -- for field scope: match value
  
  UNIQUE (role_key, concept_key)
);

CREATE TABLE screen_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key    TEXT NOT NULL REFERENCES roles(key),
  page_slug   TEXT NOT NULL,
  visible     BOOLEAN NOT NULL DEFAULT false,
  
  UNIQUE (role_key, page_slug)
);

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  role_key    TEXT NOT NULL REFERENCES roles(key),
  department  TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  key_hash          TEXT NOT NULL UNIQUE,  -- bcrypt hash of API key
  role_key          TEXT NOT NULL REFERENCES roles(key),
  allowed_concepts  TEXT[],                -- null = all concepts the role can access
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  created_by        UUID REFERENCES users(id),
  active            BOOLEAN NOT NULL DEFAULT true,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ
);
```

**Acceptance Criteria:**
- [ ] Roles table is the single source of truth for role definitions
- [ ] Permission lookups by role_key + concept_key are O(1) via unique index
- [ ] API key hash comparison prevents plaintext key storage

---

### 5. Domain Data Tables

**Purpose:** Define the pattern for concept-specific tables.

**Detail:**

Each ontology concept maps to a Postgres table. The table has typed core columns + JSONB for dynamic properties.

```sql
-- Example: guests
CREATE TABLE guests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT,          -- 'JP', 'NA', etc.
  department  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  company     TEXT,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- Example: staff
CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT,
  role_key    TEXT,          -- operational role (liaison, interpreter, etc.)
  department  TEXT,
  phone       TEXT,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- Example: schedule_events
CREATE TABLE schedule_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  event_type  TEXT,
  venue_id    UUID,
  start_time  TIMESTAMPTZ,
  end_time    TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'draft',
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- Example: prep_items
CREATE TABLE prep_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  guest_id    UUID REFERENCES guests(id),
  status      TEXT NOT NULL DEFAULT 'incomplete',
  due_date    DATE,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- Many-to-many junction table example: pairings
CREATE TABLE pairings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    UUID NOT NULL REFERENCES guests(id),
  staff_id    UUID NOT NULL REFERENCES staff(id),
  role        TEXT NOT NULL,  -- 'Main Liaison', 'Interpreter', 'Backup'
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived    BOOLEAN NOT NULL DEFAULT false
);

-- Indexes for all domain tables follow the same pattern
CREATE INDEX idx_guests_properties ON guests USING GIN (properties);
CREATE INDEX idx_guests_active ON guests (status) WHERE NOT archived;
CREATE INDEX idx_guests_department ON guests (department) WHERE NOT archived;

CREATE INDEX idx_staff_properties ON staff USING GIN (properties);
CREATE INDEX idx_staff_department ON staff (department) WHERE NOT archived;

CREATE INDEX idx_schedule_time ON schedule_events (start_time, end_time) WHERE NOT archived;
CREATE INDEX idx_schedule_venue ON schedule_events (venue_id) WHERE NOT archived;

CREATE INDEX idx_prep_guest ON prep_items (guest_id) WHERE NOT archived;
CREATE INDEX idx_prep_status ON prep_items (status) WHERE NOT archived;

CREATE INDEX idx_pairings_guest ON pairings (guest_id) WHERE NOT archived;
CREATE INDEX idx_pairings_staff ON pairings (staff_id) WHERE NOT archived;
```

**Acceptance Criteria:**
- [ ] Each concept has a corresponding table with typed core columns + JSONB
- [ ] FK constraints enforced between related tables
- [ ] Partial indexes on `WHERE NOT archived` for all query patterns
- [ ] GIN indexes on all JSONB `properties` columns

---

### 6. Audit Tables

**Purpose:** Store all change history for forensics and rollback.

```sql
CREATE TABLE ontology_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  actor_role  TEXT,
  actor_type  TEXT CHECK (actor_type IN ('human', 'api_client', 'external_token', 'ai_agent', 'system')),
  action      TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  change_set  UUID,        -- groups related changes
  ip_address  TEXT,
  session_id  TEXT
);

CREATE INDEX idx_ontology_audit_time ON ontology_audit_log (timestamp);
CREATE INDEX idx_ontology_audit_table ON ontology_audit_log (table_name, record_id);
CREATE INDEX idx_ontology_audit_actor ON ontology_audit_log (actor_id);
CREATE INDEX idx_ontology_audit_changeset ON ontology_audit_log (change_set);

CREATE TABLE domain_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  actor_role  TEXT,
  actor_type  TEXT CHECK (actor_type IN ('human', 'api_client', 'external_token', 'ai_agent', 'system')),
  action      TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  change_set  UUID,
  ip_address  TEXT,
  session_id  TEXT
);

CREATE INDEX idx_domain_audit_time ON domain_audit_log (timestamp);
CREATE INDEX idx_domain_audit_table ON domain_audit_log (table_name, record_id);
CREATE INDEX idx_domain_audit_actor ON domain_audit_log (actor_id);

-- Event log (from event bus)
CREATE TABLE event_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            TEXT NOT NULL,
  event_name          TEXT NOT NULL,
  record_id           TEXT NOT NULL,
  triggered_by        TEXT NOT NULL,
  timestamp           TIMESTAMPTZ NOT NULL,
  workflows_triggered TEXT[],
  actions_executed    JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_log_name ON event_log (event_name);
CREATE INDEX idx_event_log_time ON event_log (timestamp);
CREATE INDEX idx_event_log_record ON event_log (record_id);
```

**Postgres audit trigger** (fires on ALL changes, even direct SQL):

```sql
CREATE OR REPLACE FUNCTION audit_ontology_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ontology_audit_log (
    action, table_name, record_id, old_value, new_value
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW)
         WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW)
         ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply to every ontology table
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON ontology_concepts FOR EACH ROW EXECUTE FUNCTION audit_ontology_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON ontology_properties FOR EACH ROW EXECUTE FUNCTION audit_ontology_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON ontology_relationships FOR EACH ROW EXECUTE FUNCTION audit_ontology_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON ontology_events FOR EACH ROW EXECUTE FUNCTION audit_ontology_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON ontology_constraints FOR EACH ROW EXECUTE FUNCTION audit_ontology_change();
```

**Acceptance Criteria:**
- [ ] Every ontology table has an audit trigger
- [ ] Direct SQL changes (bypassing the API) are captured
- [ ] Audit log queryable by actor, table, time range, and change set

---

### 7. Indexing Strategy

**Purpose:** Define index patterns for query performance.

| Index Type | Use Case | Tables |
|------------|----------|--------|
| btree on typed columns | Equality/range queries (status, department, dates) | All domain tables |
| GIN on JSONB | Dynamic property queries | All domain tables |
| Partial (`WHERE NOT archived`) | Exclude archived records from most queries | All domain tables |
| Composite (concept_key + status) | Ontology lookups for active records | All ontology tables |
| btree on FK columns | Join performance | All tables with FKs |
| btree on timestamp | Time-range queries in audit logs | Audit tables |
| Unique composite | Prevent duplicate active ontology records | All ontology tables |

**Acceptance Criteria:**
- [ ] EXPLAIN ANALYZE on common queries shows index usage
- [ ] No sequential scans on tables with >1000 rows for indexed queries

---

### 8. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Schema creation | Migration | All CREATE TABLE statements execute without error | All tables exist with correct columns/constraints |
| FK constraints | Integration | Insert record with invalid FK → fails | Constraint violation raised |
| JSONB queries | Integration | Query `properties->>'key' = 'value'` uses GIN index | EXPLAIN shows index scan |
| Audit trigger | Integration | Direct INSERT/UPDATE/DELETE on ontology table → audit row created | Audit log has correct old/new values |
| Versioning | Integration | Update ontology record → version incremented, previous_version_id set | Version chain queryable |
| Soft delete | Integration | Archive record → excluded from `WHERE NOT archived` queries | Archived records invisible to default queries |
| Concurrent access | Load | 50 concurrent reads + 5 concurrent writes | No deadlocks, <50ms query time |
| Backup/restore | Integration | pg_dump single table → pg_restore | Data integrity preserved |

**Coverage target:** All SQL in this document tested via migration + integration tests.
