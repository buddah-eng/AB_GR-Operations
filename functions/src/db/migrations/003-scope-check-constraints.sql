-- Migration 003: Ontology Scope Cross-Field CHECK Constraints
-- Enforces invariants from ontology-scoping.md:
--   owner_scope='org'        => owner_department IS NULL
--   owner_scope='department' => owner_department IS NOT NULL
-- Run after 002-core-services.sql

BEGIN;

-- Ontology tables
ALTER TABLE ontology_concepts
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE ontology_properties
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE ontology_relationships
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE ontology_events
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE ontology_constraints
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

-- Config tables
ALTER TABLE form_configs
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE view_configs
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

ALTER TABLE workflow_configs
  ADD CONSTRAINT chk_scope_department
  CHECK (
    (owner_scope = 'org' AND owner_department IS NULL) OR
    (owner_scope = 'department' AND owner_department IS NOT NULL)
  );

COMMIT;
