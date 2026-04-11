-- Migration 011: RBAC Full Seeds
-- Completes permission matrix, data scopes, screen access, and contract templates
-- Fixes: 1.1, 1.6, 1.7, 2.8, 4.2-4.5, 6.1-6.6, 7.4-7.6

BEGIN;

-- ============================================================
-- 1. PERMISSION MATRIX FIXES
-- ============================================================

-- 1a. Volunteer: add prep_item permissions (1.1)
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('volunteer', 'prep_item', true, false, true, false, ARRAY['name', 'status', 'guest_id', 'due_date'])
ON CONFLICT (role_key, concept_key) DO UPDATE SET can_view=true, can_edit=true, visible_properties=ARRAY['name', 'status', 'guest_id', 'due_date'];

-- 1b. Liaison: add can_edit=true for guest (1.6)
UPDATE permissions SET can_edit = true WHERE role_key = 'liaison' AND concept_key = 'guest';

-- 1c. Add 'id' to ALL visible_properties arrays that don't already have it (2.8)
UPDATE permissions SET visible_properties = array_prepend('id', visible_properties) WHERE NOT ('id' = ANY(visible_properties));

-- 1d. Viewer permissions for all concepts (1.7)
INSERT INTO permissions (role_key, concept_key, can_view, visible_properties)
VALUES
  ('viewer', 'prep_item', true, ARRAY['id','name','status','guest_id']),
  ('viewer', 'pairing', true, ARRAY['id','guest_id','staff_id','role']),
  ('viewer', 'transport', true, ARRAY['id','guestName','status','pickupLocation','scheduledTime']),
  ('viewer', 'venue', true, ARRAY['id','name','type','capacity'])
ON CONFLICT (role_key, concept_key) DO UPDATE SET can_view=true, visible_properties=EXCLUDED.visible_properties;


-- ============================================================
-- 2. DATA SCOPE SEEDS (4.2-4.5)
-- ============================================================
-- Department-based scoping: NULL value means "use authenticated user's department"

INSERT INTO data_scopes (role_key, concept_key, scope_type, field, value)
VALUES
  ('coordinator', 'guest', 'department', 'department', NULL),
  ('coordinator', 'staff', 'department', 'department', NULL),
  ('coordinator', 'prep_item', 'department', 'department', NULL)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 3. SCREEN ACCESS SEEDS (6.1-6.6)
-- ============================================================

-- Director: all pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('director', 'dashboard', true), ('director', 'guests', true), ('director', 'staff', true),
  ('director', 'pairings', true), ('director', 'schedule', true), ('director', 'prep-tracker', true),
  ('director', 'travel', true), ('director', 'venues', true), ('director', 'workflows', true),
  ('director', 'settings', true), ('director', 'canvas', true),
  ('director', 'form-builder', true), ('director', 'view-builder', true), ('director', 'workflow-builder', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;

-- Coordinator: operational pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('coordinator', 'dashboard', true), ('coordinator', 'guests', true), ('coordinator', 'staff', true),
  ('coordinator', 'pairings', true), ('coordinator', 'schedule', true), ('coordinator', 'prep-tracker', true),
  ('coordinator', 'travel', true), ('coordinator', 'venues', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;

-- Liaison: limited pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('liaison', 'dashboard', true), ('liaison', 'guests', true), ('liaison', 'schedule', true),
  ('liaison', 'prep-tracker', true), ('liaison', 'travel', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;

-- Volunteer: minimal pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('volunteer', 'dashboard', true), ('volunteer', 'schedule', true), ('volunteer', 'prep-tracker', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;

-- Viewer: read-only overview
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('viewer', 'dashboard', true), ('viewer', 'guests', true), ('viewer', 'schedule', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;


-- ============================================================
-- 4. CONTRACT TEMPLATE SEEDS (7.4-7.6)
-- ============================================================

-- Standard guest contract template
INSERT INTO contract_templates (name, description, header_html, footer_html)
VALUES (
  'Standard Guest Agreement',
  'Default convention guest appearance agreement',
  '<h1>Guest Appearance Agreement</h1><p>Convention: {{convention.name}}</p>',
  '<p>Signed: ___________________  Date: ___________________</p>'
);

-- JP guest template with interpreter clause
INSERT INTO contract_templates (name, description, header_html, footer_html)
VALUES (
  'JP Guest Agreement',
  'Japanese guest agreement with interpreter and cultural provisions',
  '<h1>Guest Appearance Agreement (International)</h1><p>Convention: {{convention.name}}</p>',
  '<p>Signed: ___________________  Date: ___________________</p>'
);

-- Contract-related ontology concepts
INSERT INTO ontology_concepts (key, name, plural_name, icon, is_config, description)
VALUES ('contract_template', 'Contract Template', 'Contract Templates', 'pi pi-file', true, 'Agreement templates for guest contracts')
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO ontology_concepts (key, name, plural_name, icon, is_config, description)
VALUES ('contract_clause', 'Contract Clause', 'Contract Clauses', 'pi pi-file-edit', true, 'Individual clauses within contract templates')
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO ontology_concepts (key, name, plural_name, icon, is_config, description)
VALUES ('guest_contract', 'Guest Contract', 'Guest Contracts', 'pi pi-file-check', false, 'Generated contracts per guest')
ON CONFLICT (key, version) DO NOTHING;

-- Director permissions for contract concepts
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('director', 'contract_template', true, true, true, true, ARRAY['id','name','description','header_html','footer_html']),
  ('director', 'contract_clause', true, true, true, true, ARRAY['id','template_id','title','body_html','sort_order','condition']),
  ('director', 'guest_contract', true, true, true, true, ARRAY['id','guest_id','template_id','html','status','signed_at'])
ON CONFLICT (role_key, concept_key) DO UPDATE SET can_view=true, can_create=true, can_edit=true, visible_properties=EXCLUDED.visible_properties;

COMMIT;
