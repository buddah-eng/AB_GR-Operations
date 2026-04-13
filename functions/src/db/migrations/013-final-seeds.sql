-- Migration 013: Final Seeds
-- Fixes: editable_properties, interpreter screen_access, contract clauses,
-- prep-overdue workflow, dashboard overdue widget, department_head role
-- Audit items: 1-5 (seed data) + 7 (manager/department_head role)

BEGIN;

-- ============================================================
-- 1. EDITABLE PROPERTIES — liaison + volunteer
-- ============================================================

UPDATE permissions SET editable_properties = ARRAY['status']
WHERE role_key = 'liaison' AND concept_key = 'guest' AND editable_properties IS NULL;

UPDATE permissions SET editable_properties = ARRAY['status']
WHERE role_key = 'volunteer' AND concept_key = 'prep_item' AND editable_properties IS NULL;

-- ============================================================
-- 2. INTERPRETER SCREEN ACCESS
-- ============================================================

INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('interpreter', 'dashboard', true),
  ('interpreter', 'guests', true),
  ('interpreter', 'schedule', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;

-- ============================================================
-- 3. CONTRACT CLAUSES — Standard Guest Agreement
-- ============================================================

INSERT INTO contract_clauses (template_id, sort_order, title, body_html)
SELECT id, 1, 'Appearance Agreement', '<p>The Guest agrees to appear at the convention for all scheduled events.</p>'
FROM contract_templates WHERE name = 'Standard Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'Appearance Agreement');

INSERT INTO contract_clauses (template_id, sort_order, title, body_html)
SELECT id, 2, 'Travel & Accommodation', '<p>Convention provides roundtrip travel and hotel accommodations.</p>'
FROM contract_templates WHERE name = 'Standard Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'Travel & Accommodation');

INSERT INTO contract_clauses (template_id, sort_order, title, body_html)
SELECT id, 3, 'Cancellation Policy', '<p>Either party may cancel with 30 days written notice.</p>'
FROM contract_templates WHERE name = 'Standard Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'Cancellation Policy');

INSERT INTO contract_clauses (template_id, sort_order, title, body_html)
SELECT id, 4, 'NDA', '<p>Guest agrees not to disclose confidential convention planning details.</p>'
FROM contract_templates WHERE name = 'Standard Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'NDA');

-- ============================================================
-- 3b. CONTRACT CLAUSES — JP Guest Agreement
-- ============================================================

INSERT INTO contract_clauses (template_id, sort_order, title, body_html, condition)
SELECT id, 1, 'Interpreter Provision', '<p>Convention provides a qualified interpreter for all events and transit.</p>',
  '{"type":"field","field":"type","operator":"eq","value":"JP"}'::jsonb
FROM contract_templates WHERE name = 'JP Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'Interpreter Provision');

INSERT INTO contract_clauses (template_id, sort_order, title, body_html)
SELECT id, 2, 'Cultural Accommodations', '<p>Convention provides culturally appropriate meals and quiet spaces.</p>'
FROM contract_templates WHERE name = 'JP Guest Agreement'
  AND NOT EXISTS (SELECT 1 FROM contract_clauses cc WHERE cc.template_id = contract_templates.id AND cc.title = 'Cultural Accommodations');

-- ============================================================
-- 4. PREP-OVERDUE WORKFLOW
-- ============================================================

INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES ('Overdue Prep Detection', 'Daily check: flag incomplete prep items past due date',
  '{"type":"scheduled","schedule":"0 6 * * *"}'::jsonb,
  '{"type":"and","conditions":[{"type":"field","field":"status","operator":"neq","value":"complete"},{"type":"field","field":"due_date","operator":"lt","value":"{{now}}"}]}'::jsonb,
  '[{"type":"update_record","target":"prep_item","defaults":{"status":"overdue"}}]'::jsonb,
  true)
ON CONFLICT (name, version) DO NOTHING;

-- ============================================================
-- 5. DASHBOARD OVERDUE STAT CARD
-- ============================================================

UPDATE page_configs SET widgets = widgets || '[{"widgetId":"overdue-items","type":"stat_card","title":"Overdue Items","conceptKey":"prep_item","filter":{"status":"overdue"}}]'::jsonb
WHERE slug = 'gr-dashboard' AND NOT (widgets::text LIKE '%overdue-items%');

-- ============================================================
-- 6. DEPARTMENT_HEAD ROLE — permissions + screen access
-- ============================================================
-- PRD4 specifies 7 roles; "manager" maps to "department_head" (priority 80) in roles table.
-- Clone coordinator permissions/screen_access for department_head.

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
SELECT 'department_head', concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties
FROM permissions WHERE role_key = 'coordinator'
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO screen_access (role_key, page_slug, visible)
SELECT 'department_head', page_slug, visible
FROM screen_access WHERE role_key = 'coordinator'
ON CONFLICT (role_key, page_slug) DO NOTHING;

COMMIT;
