-- Migration 008: Staff, Volunteer, and Scheduling Infrastructure
-- Adds volunteer-specific columns to staff table, creates shifts and
-- shift_assignments tables, and adds guest_schedule_events linkage.
-- Run after 007-pipelines-observability.sql

BEGIN;

-- ============================================================================
-- 1. Extend staff table with volunteer-specific columns
-- ============================================================================

ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_type TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS training_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS availability JSONB NOT NULL DEFAULT '{}';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_staff_type ON staff (staff_type) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_staff_training ON staff (training_status) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_staff_skills ON staff USING GIN (skills) WHERE NOT archived;

-- ============================================================================
-- 2. Shifts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  venue_id        UUID,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  required_skills TEXT[] DEFAULT '{}',
  min_volunteers  INTEGER NOT NULL DEFAULT 1,
  max_volunteers  INTEGER NOT NULL DEFAULT 5,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'filled', 'in_progress', 'completed', 'cancelled')),
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  archived        BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT chk_shift_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_shifts_time ON shifts (start_time, end_time) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_shifts_venue ON shifts (venue_id) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status) WHERE NOT archived;

-- ============================================================================
-- 3. Shift assignments table (volunteer-to-shift mapping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shift_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id        UUID NOT NULL REFERENCES shifts(id),
  volunteer_id    UUID NOT NULL REFERENCES staff(id),
  status          TEXT NOT NULL DEFAULT 'assigned'
                    CHECK (status IN ('assigned', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled')),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  checked_in_at   TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false,

  UNIQUE (shift_id, volunteer_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_assign_shift ON shift_assignments (shift_id) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_shift_assign_volunteer ON shift_assignments (volunteer_id) WHERE NOT archived;

-- ============================================================================
-- 4. Guest-to-schedule-event linkage
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_schedule_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id          UUID NOT NULL REFERENCES guests(id),
  schedule_event_id UUID NOT NULL REFERENCES schedule_events(id),
  role              TEXT DEFAULT 'attendee',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived          BOOLEAN NOT NULL DEFAULT false,

  UNIQUE (guest_id, schedule_event_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_sched_guest ON guest_schedule_events (guest_id) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_guest_sched_event ON guest_schedule_events (schedule_event_id) WHERE NOT archived;

-- ============================================================================
-- 5. Audit triggers for new tables
-- ============================================================================

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON shifts FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON shift_assignments FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON guest_schedule_events FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

-- ============================================================================
-- 6. updated_at triggers
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
