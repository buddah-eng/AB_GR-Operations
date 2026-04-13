-- 014: Data denormalization and view config polish
-- Captures all DB fixes applied directly to Neon during Phase 6 completion

-- ============================================================
-- 1. Denormalize guest_name into prep_items
-- ============================================================
UPDATE prep_items p SET properties = p.properties || jsonb_build_object('guest_name', g.name)
FROM guests g WHERE p.guest_id = g.id AND (p.properties->>'guest_name' IS NULL);

-- ============================================================
-- 2. Denormalize guest_name into transport_bookings
-- ============================================================
UPDATE transport_bookings t SET properties = t.properties || jsonb_build_object('guest_name', g.name)
FROM guests g WHERE t.guest_id = g.id AND (t.properties->>'guest_name' IS NULL);

-- ============================================================
-- 3. Denormalize guest_name/staff_name into pairings
-- ============================================================
UPDATE pairings p SET properties = p.properties || jsonb_build_object('guest_name', g.name, 'staff_name', s.name)
FROM guests g, staff s WHERE p.guest_id = g.id AND p.staff_id = s.id
AND (p.properties->>'guest_name' IS NULL);

-- ============================================================
-- 4. Denormalize venue_name into schedule_events
-- ============================================================
UPDATE schedule_events s SET properties = s.properties || jsonb_build_object('venue_name', v.name)
FROM venues v WHERE s.venue_id = v.id AND (s.properties->>'venue_name' IS NULL);

-- ============================================================
-- 5. Add denormalized field ontology properties
-- ============================================================
-- These are read-only fields that exist for display purposes
DO $$ BEGIN
  -- prep_item.guest_name
  IF NOT EXISTS (SELECT 1 FROM ontology_properties WHERE concept_key = 'prep_item' AND key = 'guest_name' AND status = 'active') THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, required, read_only, sort_order)
    VALUES ('prep_item', 'guest_name', 'Guest', 'text', false, true, 6);
  END IF;

  -- transport.guest_name
  IF NOT EXISTS (SELECT 1 FROM ontology_properties WHERE concept_key = 'transport' AND key = 'guest_name' AND status = 'active') THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, required, read_only, sort_order)
    VALUES ('transport', 'guest_name', 'Guest', 'text', false, true, 0);
  END IF;

  -- schedule.venue_name
  IF NOT EXISTS (SELECT 1 FROM ontology_properties WHERE concept_key = 'schedule' AND key = 'venue_name' AND status = 'active') THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, required, read_only, sort_order)
    VALUES ('schedule', 'venue_name', 'Venue', 'text', false, true, 6);
  END IF;

  -- pairing.status
  IF NOT EXISTS (SELECT 1 FROM ontology_properties WHERE concept_key = 'pairing' AND key = 'status' AND status = 'active') THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
    VALUES ('pairing', 'status', 'Status', 'select', false, 4);
  END IF;
END $$;

-- ============================================================
-- 6. Add denormalized fields to visible_properties for all roles
-- ============================================================
UPDATE permissions SET visible_properties = array_append(visible_properties, 'guest_name')
WHERE concept_key IN ('prep_item', 'transport') AND NOT ('guest_name' = ANY(visible_properties));

UPDATE permissions SET visible_properties = array_append(visible_properties, 'venue_name')
WHERE concept_key = 'schedule' AND NOT ('venue_name' = ANY(visible_properties));

UPDATE permissions SET visible_properties = array_append(visible_properties, 'status')
WHERE concept_key = 'pairing' AND NOT ('status' = ANY(visible_properties));

-- ============================================================
-- 7. View config updates for human-readable columns
-- ============================================================

-- Prep kanban: guest_name instead of guest_id
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","label":"Task"},
  {"propertyKey":"guest_name","label":"Guest"},
  {"propertyKey":"due_date","label":"Due","renderer":"relative-date"},
  {"propertyKey":"owner","label":"Assigned To"}
]'::jsonb WHERE concept_key = 'prep_item' AND name = 'kanban-tracker';

-- Prep detail: guest_name
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","section":"header","label":"Task"},
  {"propertyKey":"status","section":"header","label":"Status","renderer":"status-badge"},
  {"propertyKey":"guest_name","section":"details","label":"Guest"},
  {"propertyKey":"due_date","section":"details","label":"Due Date","renderer":"relative-date"},
  {"propertyKey":"owner","section":"details","label":"Assigned To"}
]'::jsonb WHERE concept_key = 'prep_item' AND name = 'detail-view';

-- Transport list: guest_name as primary
UPDATE view_configs SET columns = '[
  {"propertyKey":"guest_name","label":"Guest","sortable":true},
  {"propertyKey":"booking_type","label":"Type","sortable":true,"renderer":"status-badge"},
  {"propertyKey":"status","label":"Status","sortable":true,"renderer":"status-badge"},
  {"propertyKey":"pickup_location","label":"Pickup"},
  {"propertyKey":"scheduled_time","label":"Time","sortable":true}
]'::jsonb WHERE concept_key = 'transport' AND name = 'default-list';

-- Pairing list: guest_name and staff_name with labels
UPDATE view_configs SET columns = '[
  {"propertyKey":"guestName","label":"Guest","sortable":true},
  {"propertyKey":"staffName","label":"Staff","sortable":true},
  {"propertyKey":"role","label":"Role","sortable":true,"renderer":"role-badge"},
  {"propertyKey":"status","label":"Status","sortable":true,"renderer":"status-badge"}
]'::jsonb WHERE concept_key = 'pairing' AND name = 'default-list';

-- Schedule timeline: venue_name with labels
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","label":"Event"},
  {"propertyKey":"event_type","label":"Type","renderer":"status-badge"},
  {"propertyKey":"venue_name","label":"Venue"},
  {"propertyKey":"start_time","label":"Start"},
  {"propertyKey":"end_time","label":"End"}
]'::jsonb WHERE concept_key = 'schedule' AND name = 'timeline-view';

-- Staff detail: explicit labels
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","section":"header","label":"Name"},
  {"propertyKey":"role_key","section":"header","label":"Role","renderer":"role-badge"},
  {"propertyKey":"department","section":"details","label":"Department"},
  {"propertyKey":"email","section":"details","label":"Email"},
  {"propertyKey":"phone","section":"details","label":"Phone"},
  {"propertyKey":"skills","section":"details","label":"Skills"}
]'::jsonb WHERE concept_key = 'staff' AND name = 'detail-view';

-- Workflow list: enabled as badge
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","label":"Name","sortable":true},
  {"propertyKey":"description","label":"Description"},
  {"propertyKey":"enabled","label":"Active","sortable":true,"renderer":"status-badge"}
]'::jsonb WHERE concept_key = 'workflow' AND name = 'default-list';

-- Guest detail: explicit labels on all columns
UPDATE view_configs SET columns = '[
  {"propertyKey":"name","section":"header","label":"Name"},
  {"propertyKey":"type","section":"header","label":"Type","renderer":"status-badge"},
  {"propertyKey":"status","section":"header","label":"Status","renderer":"status-badge"},
  {"propertyKey":"company","section":"details","label":"Company"},
  {"propertyKey":"department","section":"details","label":"Department"},
  {"propertyKey":"bio","section":"details","label":"Bio","renderer":"rich-text"}
]'::jsonb WHERE concept_key = 'guest' AND name = 'detail-view';
