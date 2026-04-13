-- Fix pairing default-list view config:
-- 1. Add human-readable labels to columns
-- 2. Replace raw guest_id/staff_id references with labeled columns
UPDATE view_configs
SET columns = '[
  {"propertyKey": "guest_id", "label": "Guest", "sortable": true, "renderer": "relation-link"},
  {"propertyKey": "staff_id", "label": "Staff", "sortable": true, "renderer": "relation-link"},
  {"propertyKey": "role", "label": "Role", "sortable": true},
  {"propertyKey": "status", "label": "Status", "sortable": true, "renderer": "status-badge"}
]'::jsonb
WHERE concept_key = 'pairing' AND name = 'default-list';
