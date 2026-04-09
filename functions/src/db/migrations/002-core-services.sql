-- Migration 002: Core Platform Services
-- Phase 2 — Enhanced audit triggers, rogue-actor detection, append-only protection
-- Run after 001-foundation.sql

BEGIN;

-- ============================================================================
-- 1. Append-only protection for audit tables
-- ============================================================================

CREATE RULE no_update_ontology_audit AS ON UPDATE TO ontology_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_ontology_audit AS ON DELETE TO ontology_audit_log DO INSTEAD NOTHING;
CREATE RULE no_update_domain_audit AS ON UPDATE TO domain_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_domain_audit AS ON DELETE TO domain_audit_log DO INSTEAD NOTHING;

-- ============================================================================
-- 2. Enhanced audit triggers (session-variable aware)
-- ============================================================================

-- Drop the simpler triggers from migration 001
DROP TRIGGER IF EXISTS audit_trigger ON ontology_concepts;
DROP TRIGGER IF EXISTS audit_trigger ON ontology_properties;
DROP TRIGGER IF EXISTS audit_trigger ON ontology_relationships;
DROP TRIGGER IF EXISTS audit_trigger ON ontology_events;
DROP TRIGGER IF EXISTS audit_trigger ON ontology_constraints;
DROP TRIGGER IF EXISTS audit_trigger ON guests;
DROP TRIGGER IF EXISTS audit_trigger ON staff;
DROP TRIGGER IF EXISTS audit_trigger ON schedule_events;
DROP TRIGGER IF EXISTS audit_trigger ON prep_items;
DROP TRIGGER IF EXISTS audit_trigger ON pairings;
DROP FUNCTION IF EXISTS audit_ontology_change();
DROP FUNCTION IF EXISTS audit_domain_change();

-- Enhanced ontology audit trigger with session-variable support
CREATE OR REPLACE FUNCTION audit_ontology_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id    TEXT;
  v_actor_type  TEXT;
  v_change_set  UUID;
  v_session_id  TEXT;
  v_ip          TEXT;
  v_old_data    JSONB := NULL;
  v_new_data    JSONB := NULL;
BEGIN
  v_actor_id   := coalesce(current_setting('app.actor_id',   true), 'pg_trigger_fallback');
  v_actor_type := coalesce(current_setting('app.actor_type', true), 'system');
  v_change_set := coalesce(current_setting('app.change_set', true)::UUID, gen_random_uuid());
  v_session_id := current_setting('app.session_id', true);
  v_ip         := current_setting('app.ip_address', true);

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO ontology_audit_log (
    change_set, actor_id, actor_role, actor_type, action,
    table_name, record_id, old_value, new_value,
    ip_address, session_id
  ) VALUES (
    v_change_set, v_actor_id, '', v_actor_type, TG_OP,
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    v_old_data, v_new_data,
    v_ip, v_session_id
  );

  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Enhanced domain audit trigger
CREATE OR REPLACE FUNCTION audit_domain_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id    TEXT;
  v_actor_type  TEXT;
  v_change_set  UUID;
  v_session_id  TEXT;
  v_ip          TEXT;
  v_old_data    JSONB := NULL;
  v_new_data    JSONB := NULL;
BEGIN
  v_actor_id   := coalesce(current_setting('app.actor_id',   true), 'pg_trigger_fallback');
  v_actor_type := coalesce(current_setting('app.actor_type', true), 'system');
  v_change_set := coalesce(current_setting('app.change_set', true)::UUID, gen_random_uuid());
  v_session_id := current_setting('app.session_id', true);
  v_ip         := current_setting('app.ip_address', true);

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO domain_audit_log (
    change_set, actor_id, actor_role, actor_type, action,
    table_name, record_id, old_value, new_value,
    ip_address, session_id
  ) VALUES (
    v_change_set, v_actor_id, '', v_actor_type, TG_OP,
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    v_old_data, v_new_data,
    v_ip, v_session_id
  );

  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Ontology table triggers
CREATE TRIGGER trg_audit_ontology_concepts
  AFTER INSERT OR UPDATE OR DELETE ON ontology_concepts
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_properties
  AFTER INSERT OR UPDATE OR DELETE ON ontology_properties
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_relationships
  AFTER INSERT OR UPDATE OR DELETE ON ontology_relationships
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_events
  AFTER INSERT OR UPDATE OR DELETE ON ontology_events
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_constraints
  AFTER INSERT OR UPDATE OR DELETE ON ontology_constraints
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

-- Config table triggers
CREATE TRIGGER trg_audit_form_configs
  AFTER INSERT OR UPDATE OR DELETE ON form_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_view_configs
  AFTER INSERT OR UPDATE OR DELETE ON view_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_page_configs
  AFTER INSERT OR UPDATE OR DELETE ON page_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_workflow_configs
  AFTER INSERT OR UPDATE OR DELETE ON workflow_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

-- RBAC table triggers
CREATE TRIGGER trg_audit_roles
  AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_permissions
  AFTER INSERT OR UPDATE OR DELETE ON permissions
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

-- Domain table triggers
CREATE TRIGGER trg_audit_guests
  AFTER INSERT OR UPDATE OR DELETE ON guests
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_staff
  AFTER INSERT OR UPDATE OR DELETE ON staff
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_schedule_events
  AFTER INSERT OR UPDATE OR DELETE ON schedule_events
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_prep_items
  AFTER INSERT OR UPDATE OR DELETE ON prep_items
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_pairings
  AFTER INSERT OR UPDATE OR DELETE ON pairings
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

-- ============================================================================
-- 3. Rogue-actor detection table
-- ============================================================================

CREATE TABLE api_audit_claims (
  change_set    UUID PRIMARY KEY,
  actor_id      TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. YoY Registry tables
-- ============================================================================

CREATE TABLE guest_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  email           TEXT,
  external_ids    JSONB NOT NULL DEFAULT '{}',
  first_year      INTEGER NOT NULL,
  last_year       INTEGER,
  total_visits    INTEGER NOT NULL DEFAULT 1,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_guest_registry_email ON guest_registry (email) WHERE email IS NOT NULL;
CREATE INDEX idx_guest_registry_name ON guest_registry (canonical_name);

CREATE TABLE vendor_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL,
  contact_email   TEXT,
  external_ids    JSONB NOT NULL DEFAULT '{}',
  first_year      INTEGER NOT NULL,
  last_year       INTEGER,
  total_years     INTEGER NOT NULL DEFAULT 1,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_vendor_registry_email ON vendor_registry (contact_email) WHERE contact_email IS NOT NULL;

COMMIT;
