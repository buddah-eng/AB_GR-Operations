-- Migration 004: Template Infrastructure
-- Unified templates table supporting record_set, form_preset, view_preset,
-- workflow, notification, and document template types.
-- Run with: psql -d gr_ops -f 004-templates.sql

BEGIN;

-- ============================================================================
-- 1. Templates Table
-- ============================================================================

CREATE TABLE templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type       TEXT NOT NULL CHECK (template_type IN (
                        'record_set', 'form_preset', 'view_preset',
                        'workflow', 'notification', 'document'
                      )),
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  content             JSONB NOT NULL DEFAULT '{}',
  concept_key         TEXT,

  -- Ontology standard versioning fields
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'deprecated', 'rolled_back')),
  owner_scope         TEXT NOT NULL DEFAULT 'org'
                        CHECK (owner_scope IN ('org', 'department')),
  owner_department    TEXT,
  changed_by          TEXT,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES templates(id),

  -- Composite uniqueness
  UNIQUE (name, template_type, version)
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- Filter by template_type (active only)
CREATE INDEX idx_templates_type
  ON templates (template_type)
  WHERE status = 'active';

-- Filter by concept_key (active only)
CREATE INDEX idx_templates_concept
  ON templates (concept_key)
  WHERE status = 'active';

-- Filter by category (active only)
CREATE INDEX idx_templates_category
  ON templates (category)
  WHERE status = 'active';

COMMIT;
