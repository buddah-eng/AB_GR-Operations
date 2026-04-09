-- Migration 001: Foundation Schema
-- Phase 1 — Ontology tables, config tables, RBAC tables, domain tables, audit tables
-- Run with: psql -d gr_ops -f 001-foundation.sql

BEGIN;

-- ============================================================================
-- 1. RBAC Tables (roles first — referenced by users and api_keys)
-- ============================================================================

CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER NOT NULL DEFAULT 100,
  is_operational  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
  relation_path   TEXT,
  field           TEXT,
  value           TEXT,
  UNIQUE (role_key, concept_key)
);

CREATE TABLE screen_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key    TEXT NOT NULL REFERENCES roles(key),
  page_slug   TEXT NOT NULL,
  visible     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (role_key, page_slug)
);

CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash      TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  email         TEXT NOT NULL,
  role_key      TEXT NOT NULL REFERENCES roles(key),
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE scoped_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  scope         JSONB NOT NULL,
  role_key      TEXT NOT NULL REFERENCES roles(key),
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

-- ============================================================================
-- 2. Ontology Tables
-- ============================================================================

CREATE TABLE ontology_concepts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  plural_name         TEXT NOT NULL,
  extends             TEXT,
  icon                TEXT,
  description         TEXT,
  is_registry         BOOLEAN NOT NULL DEFAULT false,
  is_config           BOOLEAN NOT NULL DEFAULT false,
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                      CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_concepts(id),
  UNIQUE (key, version)
);

CREATE INDEX idx_concepts_active ON ontology_concepts (key) WHERE status = 'active';

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
  postgres_column     TEXT,
  options             JSONB,
  validation_rules    JSONB,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  hidden              BOOLEAN NOT NULL DEFAULT false,
  read_only           BOOLEAN NOT NULL DEFAULT false,
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                      CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_properties(id),
  UNIQUE (concept_key, key, version)
);

CREATE INDEX idx_properties_concept ON ontology_properties (concept_key) WHERE status = 'active';

CREATE TABLE ontology_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_concept_key  TEXT NOT NULL,
  target_concept_key  TEXT NOT NULL,
  key                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  cardinality         TEXT NOT NULL CHECK (cardinality IN ('has-one', 'has-many', 'many-to-many')),
  inverse_key         TEXT,
  description         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                      CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_relationships(id),
  UNIQUE (source_concept_key, key, version)
);

CREATE TABLE ontology_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key         TEXT NOT NULL,
  event_key           TEXT NOT NULL,
  full_event_name     TEXT NOT NULL,
  trigger_type        TEXT NOT NULL CHECK (trigger_type IN (
    'on_create', 'on_update', 'on_delete', 'on_field_change', 'scheduled', 'manual'
  )),
  changed_fields      TEXT[],
  schedule            TEXT,
  description         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                      CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_events(id),
  UNIQUE (concept_key, event_key, version)
);

CREATE TABLE ontology_constraints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key         TEXT NOT NULL,
  name                TEXT NOT NULL,
  extends             TEXT,
  condition           JSONB NOT NULL,
  defaults            JSONB,
  required_fields     TEXT[],
  description         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                      CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          UUID,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES ontology_constraints(id),
  UNIQUE (concept_key, name, version)
);

-- ============================================================================
-- 3. Config Tables
-- ============================================================================

CREATE TABLE form_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key     TEXT NOT NULL,
  name            TEXT NOT NULL,
  layout          TEXT NOT NULL DEFAULT 'single' CHECK (layout IN ('single', 'two-column', 'wizard')),
  fields          JSONB NOT NULL DEFAULT '[]',
  steps           JSONB,
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (concept_key, name, version)
);

CREATE TABLE view_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key     TEXT NOT NULL,
  name            TEXT NOT NULL,
  view_type       TEXT NOT NULL CHECK (view_type IN ('table', 'kanban', 'timeline', 'detail', 'dashboard')),
  columns         JSONB,
  filters         JSONB,
  sort            JSONB,
  group_by        TEXT,
  timeline_start  TEXT,
  timeline_end    TEXT,
  row_action      TEXT CHECK (row_action IN ('navigate_to_detail', 'inline_edit', 'none')),
  presets         JSONB,
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (concept_key, name, version)
);

CREATE TABLE page_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  widgets       JSONB NOT NULL DEFAULT '[]',
  breakpoints   JSONB,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  changed_by    UUID,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE TABLE workflow_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  trigger         JSONB NOT NULL,
  condition       JSONB,
  actions         JSONB NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

-- ============================================================================
-- 4. Domain Tables
-- ============================================================================

CREATE TABLE guests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT,
  department  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  company     TEXT,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_guests_properties ON guests USING GIN (properties);
CREATE INDEX idx_guests_active ON guests (status) WHERE NOT archived;
CREATE INDEX idx_guests_department ON guests (department) WHERE NOT archived;

CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT,
  role_key    TEXT,
  department  TEXT,
  phone       TEXT,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_staff_properties ON staff USING GIN (properties);
CREATE INDEX idx_staff_department ON staff (department) WHERE NOT archived;

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

CREATE INDEX idx_schedule_time ON schedule_events (start_time, end_time) WHERE NOT archived;
CREATE INDEX idx_schedule_venue ON schedule_events (venue_id) WHERE NOT archived;

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

CREATE INDEX idx_prep_guest ON prep_items (guest_id) WHERE NOT archived;
CREATE INDEX idx_prep_status ON prep_items (status) WHERE NOT archived;

CREATE TABLE pairings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    UUID NOT NULL REFERENCES guests(id),
  staff_id    UUID NOT NULL REFERENCES staff(id),
  role        TEXT NOT NULL,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_pairings_guest ON pairings (guest_id) WHERE NOT archived;
CREATE INDEX idx_pairings_staff ON pairings (staff_id) WHERE NOT archived;

-- ============================================================================
-- 5. Audit Tables
-- ============================================================================

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
  change_set  UUID,
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

-- ============================================================================
-- 6. Audit Triggers
-- ============================================================================

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

-- Domain audit trigger
CREATE OR REPLACE FUNCTION audit_domain_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO domain_audit_log (
    action, table_name, record_id, old_value, new_value
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON guests FOR EACH ROW EXECUTE FUNCTION audit_domain_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON staff FOR EACH ROW EXECUTE FUNCTION audit_domain_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON schedule_events FOR EACH ROW EXECUTE FUNCTION audit_domain_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON prep_items FOR EACH ROW EXECUTE FUNCTION audit_domain_change();
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE
  ON pairings FOR EACH ROW EXECUTE FUNCTION audit_domain_change();

-- ============================================================================
-- 7. updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON schedule_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON prep_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
