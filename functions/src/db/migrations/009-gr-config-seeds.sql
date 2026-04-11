-- 009: GR Module Config Seeds
-- Seed ViewConfig, FormConfig, and PageConfig records for config-driven GR pages

-- ============================================================
-- VIEW CONFIGS
-- ============================================================

-- Guest list (table view with card-row rendering)
INSERT INTO view_configs (concept_key, name, view_type, columns, filters, sort, row_action, presets)
VALUES (
  'guest',
  'default-list',
  'table',
  '[
    {"propertyKey": "name", "sortable": true},
    {"propertyKey": "type", "sortable": true},
    {"propertyKey": "status", "sortable": true},
    {"propertyKey": "company", "sortable": true},
    {"propertyKey": "department", "sortable": true}
  ]'::jsonb,
  '[
    {"field": "status", "operator": "eq", "options": ["draft", "invited", "confirmed", "travel_arranged", "arrived", "attending", "departed"]},
    {"field": "type", "operator": "eq", "options": ["JP", "NA", "industry", "special"]},
    {"field": "department", "operator": "eq"}
  ]'::jsonb,
  '{"field": "name", "direction": "asc"}'::jsonb,
  'navigate_to_detail',
  '[
    {"name": "Confirmed Only", "filter": {"status": "confirmed"}},
    {"name": "JP Guests", "filter": {"type": "JP"}}
  ]'::jsonb
);

-- Staff list
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, row_action)
VALUES (
  'staff',
  'default-list',
  'table',
  '[
    {"propertyKey": "name", "sortable": true},
    {"propertyKey": "role_key", "sortable": true},
    {"propertyKey": "department", "sortable": true},
    {"propertyKey": "email", "sortable": true}
  ]'::jsonb,
  '{"field": "name", "direction": "asc"}'::jsonb,
  'navigate_to_detail'
);

-- Prep tracker (kanban)
INSERT INTO view_configs (concept_key, name, view_type, columns, group_by)
VALUES (
  'prep_item',
  'kanban-tracker',
  'kanban',
  '[
    {"propertyKey": "name"},
    {"propertyKey": "guest_id"},
    {"propertyKey": "due_date"},
    {"propertyKey": "assigned_to"}
  ]'::jsonb,
  'status'
);

-- Schedule (timeline)
INSERT INTO view_configs (concept_key, name, view_type, columns, timeline_start, timeline_end)
VALUES (
  'schedule_event',
  'timeline-view',
  'timeline',
  '[
    {"propertyKey": "name"},
    {"propertyKey": "event_type"},
    {"propertyKey": "venue_id"}
  ]'::jsonb,
  'start_time',
  'end_time'
);

-- Guest detail view
INSERT INTO view_configs (concept_key, name, view_type, columns)
VALUES (
  'guest',
  'detail-view',
  'detail',
  '[
    {"propertyKey": "name"},
    {"propertyKey": "type"},
    {"propertyKey": "status"},
    {"propertyKey": "company"},
    {"propertyKey": "department"}
  ]'::jsonb
);

-- Sub-concept default lists (for detail page tabs)
INSERT INTO view_configs (concept_key, name, view_type, columns, sort)
VALUES
  ('pairing', 'default-list', 'table',
   '[{"propertyKey": "staff_id", "sortable": true}, {"propertyKey": "role", "sortable": true}, {"propertyKey": "status", "sortable": true}]'::jsonb,
   '{"field": "role", "direction": "asc"}'::jsonb),
  ('transport_booking', 'default-list', 'table',
   '[{"propertyKey": "pickup_time", "sortable": true}, {"propertyKey": "pickup_location"}, {"propertyKey": "status", "sortable": true}, {"propertyKey": "provider"}]'::jsonb,
   '{"field": "pickup_time", "direction": "asc"}'::jsonb),
  ('generated_contract', 'default-list', 'table',
   '[{"propertyKey": "name", "sortable": true}, {"propertyKey": "status", "sortable": true}, {"propertyKey": "generated_at", "sortable": true}]'::jsonb,
   '{"field": "generated_at", "direction": "desc"}'::jsonb),
  ('workflow_config', 'default-list', 'table',
   '[{"propertyKey": "name", "sortable": true}, {"propertyKey": "description"}, {"propertyKey": "enabled", "sortable": true}]'::jsonb,
   '{"field": "name", "direction": "asc"}'::jsonb);

-- ============================================================
-- FORM CONFIGS
-- ============================================================

-- Guest intake wizard
INSERT INTO form_configs (concept_key, name, layout, steps, fields)
VALUES (
  'guest',
  'intake-wizard',
  'wizard',
  '[
    {"name": "basic", "label": "Basic Info", "fields": ["name", "type", "company", "bio"]},
    {"name": "contact", "label": "Contact", "fields": ["email", "phone", "preferred_language"]},
    {"name": "convention", "label": "Convention Details", "fields": ["department", "status", "special_requirements", "dietary_restrictions"]}
  ]'::jsonb,
  '[
    {"propertyKey": "name"},
    {"propertyKey": "type"},
    {"propertyKey": "company"},
    {"propertyKey": "bio"},
    {"propertyKey": "email"},
    {"propertyKey": "phone"},
    {"propertyKey": "preferred_language"},
    {"propertyKey": "department"},
    {"propertyKey": "status"},
    {"propertyKey": "special_requirements"},
    {"propertyKey": "dietary_restrictions"}
  ]'::jsonb
);

-- Guest quick edit
INSERT INTO form_configs (concept_key, name, layout, fields)
VALUES (
  'guest',
  'quick-edit',
  'two-column',
  '[
    {"propertyKey": "name"},
    {"propertyKey": "type"},
    {"propertyKey": "status"},
    {"propertyKey": "company"},
    {"propertyKey": "department"},
    {"propertyKey": "bio", "colSpan": 2}
  ]'::jsonb
);

-- ============================================================
-- PAGE CONFIGS
-- ============================================================

-- GR Dashboard
INSERT INTO page_configs (name, slug, widgets)
VALUES (
  'GR Dashboard',
  'gr-dashboard',
  '[
    {"widgetId": "total-guests", "type": "stat_card", "title": "Total Guests", "conceptKey": "guest"},
    {"widgetId": "confirmed", "type": "stat_card", "title": "Confirmed", "conceptKey": "guest", "filter": {"status": "confirmed"}},
    {"widgetId": "active-bookings", "type": "stat_card", "title": "Active Bookings", "conceptKey": "transport_booking", "filter": {"status": ["booked", "driver_en_route", "waiting"]}},
    {"widgetId": "action-required", "type": "action_banner", "title": "Action Required", "conceptKey": "guest", "filter": {"needs_attention": true}},
    {"widgetId": "prep-progress", "type": "prep_progress", "title": "Prep Completion", "conceptKey": "prep_item"},
    {"widgetId": "activity", "type": "activity_feed", "title": "Recent Activity"}
  ]'::jsonb
);

-- ============================================================
-- ONTOLOGY PROPERTY VALIDATION RULES
-- ============================================================

-- Guest name: min 1, max 200
UPDATE ontology_properties SET validation_rules = '{"minLength": 1, "maxLength": 200}'::jsonb
WHERE concept_key = 'guest' AND key = 'name';

-- Guest bio: max 2000
UPDATE ontology_properties SET validation_rules = '{"maxLength": 2000}'::jsonb
WHERE concept_key = 'guest' AND key = 'bio';

-- Guest pronouns: max 50
UPDATE ontology_properties SET validation_rules = '{"maxLength": 50}'::jsonb
WHERE concept_key = 'guest' AND key = 'pronouns';

-- Guest company: max 200
UPDATE ontology_properties SET validation_rules = '{"maxLength": 200}'::jsonb
WHERE concept_key = 'guest' AND key = 'company';

-- Staff email: email pattern
UPDATE ontology_properties SET validation_rules = '{"maxLength": 254, "pattern": "^[^@]+@[^@]+\\.[^@]+$"}'::jsonb
WHERE concept_key = 'staff' AND key = 'email';

-- Staff name: min 1, max 200
UPDATE ontology_properties SET validation_rules = '{"minLength": 1, "maxLength": 200}'::jsonb
WHERE concept_key = 'staff' AND key = 'name';

-- Prep item name: min 1, max 200
UPDATE ontology_properties SET validation_rules = '{"minLength": 1, "maxLength": 200}'::jsonb
WHERE concept_key = 'prep_item' AND key = 'name';

-- Venue name: min 1, max 200
UPDATE ontology_properties SET validation_rules = '{"minLength": 1, "maxLength": 200}'::jsonb
WHERE concept_key = 'venue' AND key = 'name';

-- Venue capacity: min 1, max 50000
UPDATE ontology_properties SET validation_rules = '{"min": 1, "max": 50000}'::jsonb
WHERE concept_key = 'venue' AND key = 'capacity';

-- Schedule event name: min 1, max 200
UPDATE ontology_properties SET validation_rules = '{"minLength": 1, "maxLength": 200}'::jsonb
WHERE concept_key = 'schedule' AND key = 'name';
