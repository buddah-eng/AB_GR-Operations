-- Migration 004: Shared Services + GR Module
-- Phase 5 & 6 — Staff, volunteers, venues, scheduling, GR-specific tables

BEGIN;

-- ============================================================================
-- 1. Volunteer Extensions (extends staff table)
-- ============================================================================

-- Volunteers are staff with additional fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_type TEXT DEFAULT 'staff'
  CHECK (staff_type IN ('staff', 'volunteer'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS skills TEXT[];
ALTER TABLE staff ADD COLUMN IF NOT EXISTS training_status TEXT DEFAULT 'pending'
  CHECK (training_status IN ('pending', 'in_progress', 'completed'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{}';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS languages TEXT[];

-- ============================================================================
-- 2. Venues
-- ============================================================================

CREATE TABLE venues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  venue_type    TEXT NOT NULL CHECK (venue_type IN ('hall', 'panel_room', 'meeting_room', 'outdoor', 'restaurant', 'other')),
  capacity      INTEGER,
  floor         TEXT,
  equipment     TEXT[],
  properties    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_venues_type ON venues (venue_type) WHERE NOT archived;

-- Add FK from schedule_events to venues
ALTER TABLE schedule_events DROP CONSTRAINT IF EXISTS schedule_events_venue_id_fk;
ALTER TABLE schedule_events ADD CONSTRAINT schedule_events_venue_id_fk
  FOREIGN KEY (venue_id) REFERENCES venues(id);

-- ============================================================================
-- 3. Shifts (Volunteer Scheduling)
-- ============================================================================

CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  venue_id        UUID REFERENCES venues(id),
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  required_count  INTEGER NOT NULL DEFAULT 1,
  required_skills TEXT[],
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'partially_filled', 'filled', 'cancelled')),
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_shifts_time ON shifts (start_time, end_time) WHERE NOT archived;
CREATE INDEX idx_shifts_venue ON shifts (venue_id) WHERE NOT archived;

CREATE TABLE shift_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    UUID NOT NULL REFERENCES shifts(id),
  staff_id    UUID NOT NULL REFERENCES staff(id),
  status      TEXT NOT NULL DEFAULT 'assigned'
              CHECK (status IN ('assigned', 'confirmed', 'checked_in', 'completed', 'no_show', 'swapped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, staff_id)
);

CREATE INDEX idx_shift_assignments_staff ON shift_assignments (staff_id);

-- ============================================================================
-- 4. Google Calendar Sync
-- ============================================================================

CREATE TABLE calendar_sync_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT NOT NULL,
  calendar_id     TEXT NOT NULL,
  last_sync_at    TIMESTAMPTZ,
  sync_token      TEXT,
  sync_direction  TEXT NOT NULL DEFAULT 'bidirectional'
                  CHECK (sync_direction IN ('push', 'pull', 'bidirectional')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_calendar_sync_dept ON calendar_sync_state (department);

-- ============================================================================
-- 5. Equipment & Logistics
-- ============================================================================

CREATE TABLE equipment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT,
  venue_id        UUID REFERENCES venues(id),
  status          TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'checked_out', 'in_transit', 'maintenance', 'lost')),
  checked_out_to  UUID REFERENCES staff(id),
  checked_out_at  TIMESTAMPTZ,
  due_back_at     TIMESTAMPTZ,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_equipment_status ON equipment (status) WHERE NOT archived;
CREATE INDEX idx_equipment_venue ON equipment (venue_id) WHERE NOT archived;

-- ============================================================================
-- 6. GR Module — Guest Lifecycle Extensions
-- ============================================================================

-- Guest status values for the GR lifecycle
-- (draft→invited→confirmed→travel_arranged→arrived→attending→departed)
-- Already handled by the status TEXT column on guests table

-- ============================================================================
-- 7. GR Module — Contracts
-- ============================================================================

CREATE TABLE contract_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  base_content    TEXT NOT NULL,      -- Handlebars template
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_clauses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES contract_templates(id),
  name            TEXT NOT NULL,
  content         TEXT NOT NULL,       -- Handlebars template
  condition       JSONB,               -- ConditionExpression (nullable = always included)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  required        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_clauses_template ON contract_clauses (template_id);

CREATE TABLE guest_contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id        UUID NOT NULL REFERENCES guests(id),
  template_id     UUID NOT NULL REFERENCES contract_templates(id),
  rendered_html   TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'signed', 'countersigned', 'void')),
  sent_at         TIMESTAMPTZ,
  signed_at       TIMESTAMPTZ,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_contracts_guest ON guest_contracts (guest_id);

-- ============================================================================
-- 8. GR Module — Itineraries (computed views, no separate table needed)
-- ============================================================================
-- Itineraries are computed from: schedule_events + transport_bookings + pairings
-- per guest. No separate table — it's a query + PDF render.

-- ============================================================================
-- 9. Guidebook Integration
-- ============================================================================

CREATE TABLE guidebook_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental')),
  records_pushed  INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed')),
  error_message   TEXT
);

-- Track what's been published for incremental sync
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

-- ============================================================================
-- 10. Domain audit triggers for new tables
-- ============================================================================

CREATE TRIGGER trg_audit_venues
  AFTER INSERT OR UPDATE OR DELETE ON venues
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_shifts
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_equipment
  AFTER INSERT OR UPDATE OR DELETE ON equipment
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_transport_bookings
  AFTER INSERT OR UPDATE OR DELETE ON transport_bookings
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

CREATE TRIGGER trg_audit_guest_contracts
  AFTER INSERT OR UPDATE OR DELETE ON guest_contracts
  FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

-- updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON transport_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guest_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
