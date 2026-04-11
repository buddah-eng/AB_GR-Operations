-- Migration 010: Contract Tables + RBAC Permissions Completion
-- Creates contract infrastructure and seeds permissions for all operational roles

BEGIN;

-- ============================================================
-- 1. CONTRACT TABLES
-- ============================================================

-- Contract templates
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  header_html TEXT,
  footer_html TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  owner_scope TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_version_id UUID REFERENCES contract_templates(id),
  UNIQUE (name, version)
);

-- Contract clauses (conditional)
CREATE TABLE IF NOT EXISTS contract_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES contract_templates(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  condition JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_version_id UUID REFERENCES contract_clauses(id)
);

-- Generated contracts (per guest)
CREATE TABLE IF NOT EXISTS guest_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL,
  template_id UUID REFERENCES contract_templates(id),
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  signed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_guest_contracts_guest ON guest_contracts (guest_id) WHERE NOT archived;

-- ============================================================
-- 2. RBAC PERMISSIONS — Coordinator
-- ============================================================
-- Coordinator: full view/create/edit on operational concepts, no delete

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('coordinator', 'guest', true, true, true, false,
   ARRAY['name', 'type', 'department', 'status', 'company', 'registry_id', 'convention_year', 'email_hmac', 'interpreter_required', 'bio', 'dietary', 'pronouns', 'research_links']),
  ('coordinator', 'staff', true, true, true, false,
   ARRAY['name', 'email', 'role_key', 'department', 'phone', 'staff_type', 'skills', 'training_status', 'availability', 'emergency_contact', 'languages', 'active']),
  ('coordinator', 'prep_item', true, true, true, false,
   ARRAY['name', 'guest_id', 'status', 'due_date', 'owner']),
  ('coordinator', 'schedule', true, true, true, false,
   ARRAY['name', 'event_type', 'venue_id', 'start_time', 'end_time', 'status', 'venue', 'date']),
  ('coordinator', 'pairing', true, true, true, false,
   ARRAY['guest_id', 'staff_id', 'role', 'guestName', 'staffName', 'staffEmail']),
  ('coordinator', 'transport', true, true, true, false,
   ARRAY['guest_id', 'booking_type', 'status', 'pickup_location', 'dropoff_location', 'scheduled_time', 'driver_name', 'vehicle_info', 'flight_number', 'guestName', 'bookingType', 'pickupLocation', 'dropoffLocation', 'scheduledTime', 'driverName', 'vehicleInfo']),
  ('coordinator', 'venue', true, true, true, false,
   ARRAY['name', 'type', 'capacity', 'floor', 'building', 'equipment', 'notes'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- ============================================================
-- 3. RBAC PERMISSIONS — Liaison
-- ============================================================
-- Liaison: view guest/prep_item/pairing, edit prep_item only

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('liaison', 'guest', true, false, false, false,
   ARRAY['name', 'type', 'status', 'company', 'department']),
  ('liaison', 'prep_item', true, false, true, false,
   ARRAY['name', 'guest_id', 'status', 'due_date', 'owner']),
  ('liaison', 'pairing', true, false, false, false,
   ARRAY['guest_id', 'staff_id', 'role', 'guestName', 'staffName', 'staffEmail'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- ============================================================
-- 4. RBAC PERMISSIONS — Interpreter
-- ============================================================
-- Interpreter: view-only on guest and schedule

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('interpreter', 'guest', true, false, false, false,
   ARRAY['name', 'type', 'status', 'department']),
  ('interpreter', 'schedule', true, false, false, false,
   ARRAY['name', 'event_type', 'venue_id', 'start_time', 'end_time', 'status', 'venue', 'date'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- ============================================================
-- 5. RBAC PERMISSIONS — Volunteer
-- ============================================================
-- Volunteer: view-only on guest, schedule, venue

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('volunteer', 'guest', true, false, false, false,
   ARRAY['name', 'type', 'status']),
  ('volunteer', 'schedule', true, false, false, false,
   ARRAY['name', 'event_type', 'venue_id', 'start_time', 'end_time', 'status']),
  ('volunteer', 'venue', true, false, false, false,
   ARRAY['name', 'type', 'capacity', 'floor', 'building'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- ============================================================
-- 6. UPDATE VIEWER PERMISSIONS — Add visible_properties
-- ============================================================
-- Viewer already has rows but with empty visible_properties. Update them.

UPDATE permissions SET visible_properties = ARRAY['name', 'type', 'status']
WHERE role_key = 'viewer' AND concept_key = 'guest' AND visible_properties = '{}';

UPDATE permissions SET visible_properties = ARRAY['name', 'role_key', 'department']
WHERE role_key = 'viewer' AND concept_key = 'staff' AND visible_properties = '{}';

UPDATE permissions SET visible_properties = ARRAY['name', 'event_type', 'status']
WHERE role_key = 'viewer' AND concept_key = 'schedule' AND visible_properties = '{}';

-- ============================================================
-- 7. WORKFLOW CONFIGS — Status-Triggered Automations
-- ============================================================

INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES
  ('Guest Arrived — Notify Coordinator',
   'When a guest arrives, notify the GR coordinator',
   '{"type": "field_changed", "event": "guest.updated", "field": "status"}'::jsonb,
   '{"type": "field", "field": "status", "operator": "eq", "value": "arrived"}'::jsonb,
   '[{"type": "notify", "recipients": ["coordinator"], "templateName": "guest-arrived"}]'::jsonb,
   true)
ON CONFLICT DO NOTHING;

COMMIT;
