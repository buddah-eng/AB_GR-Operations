-- Migration 014: Text Formatting & Display Fixes
-- Fixes: workflow enabled column type, guest detail extra fields,
-- guest detail tabs use default-list for prep, prep_item default-list view

BEGIN;

-- ============================================================
-- Bug 10: Workflow list — "enabled" shows raw boolean
-- Add type:"boolean" alongside existing status-badge renderer
-- ============================================================

UPDATE view_configs
SET columns = '[
  {"propertyKey":"name","label":"Name","sortable":true},
  {"propertyKey":"description","label":"Description"},
  {"propertyKey":"enabled","label":"Active","sortable":true,"type":"boolean","renderer":"status-badge"}
]'::jsonb
WHERE concept_key = 'workflow' AND name = 'default-list';

-- ============================================================
-- Bug 12a: Guest detail — add full field set with labels
-- ============================================================

UPDATE view_configs
SET columns = '[
  {"propertyKey":"name","label":"Name","section":"header"},
  {"propertyKey":"type","label":"Type","section":"header","renderer":"status-badge"},
  {"propertyKey":"status","label":"Status","section":"header","renderer":"status-badge"},
  {"propertyKey":"company","label":"Company","section":"details"},
  {"propertyKey":"department","label":"Department","section":"details"},
  {"propertyKey":"email","label":"Email","section":"details"},
  {"propertyKey":"phone","label":"Phone","section":"details"},
  {"propertyKey":"preferred_language","label":"Preferred Language","section":"details"},
  {"propertyKey":"bio","label":"Bio","section":"details","renderer":"rich-text"},
  {"propertyKey":"dietary_restrictions","label":"Dietary Restrictions","section":"details"},
  {"propertyKey":"special_requirements","label":"Special Requirements","section":"details"}
]'::jsonb
WHERE concept_key = 'guest' AND name = 'detail-view';

-- ============================================================
-- Bug 12b: Guest detail tabs — prep uses default-list (not kanban)
-- ============================================================

UPDATE view_configs
SET tabs = '[
  {"label":"Prep Items","conceptKey":"prep_item","viewName":"default-list","filter":{"guest_id":"{{record.id}}"}},
  {"label":"Pairings","conceptKey":"pairing","viewName":"default-list","filter":{"guest_id":"{{record.id}}"}},
  {"label":"Transport","conceptKey":"transport","viewName":"default-list","filter":{"guest_id":"{{record.id}}"}}
]'::jsonb
WHERE concept_key = 'guest' AND name = 'detail-view';

-- ============================================================
-- Bug 12c: Prep item default-list view for embedded tabs
-- ============================================================

INSERT INTO view_configs (concept_key, name, view_type, columns, sort)
SELECT 'prep_item', 'default-list', 'table',
  '[
    {"propertyKey":"name","label":"Task","sortable":true},
    {"propertyKey":"status","label":"Status","sortable":true,"renderer":"status-badge"},
    {"propertyKey":"due_date","label":"Due Date","sortable":true,"type":"date"},
    {"propertyKey":"assigned_to","label":"Assigned To"}
  ]'::jsonb,
  '{"field":"due_date","direction":"asc"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM view_configs WHERE concept_key = 'prep_item' AND name = 'default-list'
);

COMMIT;
