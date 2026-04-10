-- 008-shared-services.sql
-- Venues, equipment, calendar sync state, guidebook sync log.
-- Run after 007-pipelines-observability.sql

BEGIN;

-- ============================================================================
-- 1. Venues
-- ============================================================================

CREATE TABLE venues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('ballroom', 'meeting_room', 'outdoor', 'theater', 'breakout', 'lobby', 'other')),
  capacity        INTEGER NOT NULL DEFAULT 0,
  floor           TEXT,
  building        TEXT,
  equipment       JSONB NOT NULL DEFAULT '[]',
  notes           TEXT,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_venues_type ON venues (type) WHERE NOT archived;
CREATE INDEX idx_venues_capacity ON venues (capacity) WHERE NOT archived;
CREATE INDEX idx_venues_floor ON venues (floor) WHERE NOT archived;

-- ============================================================================
-- 2. Equipment
-- ============================================================================

CREATE TABLE equipment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('av', 'signage', 'furniture', 'tech', 'safety', 'catering', 'other')),
  venue_id        UUID REFERENCES venues(id),
  status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'checked_out', 'maintenance', 'retired')),
  checked_out_to  UUID REFERENCES staff(id),
  checked_out_at  TIMESTAMPTZ,
  due_back_at     TIMESTAMPTZ,
  serial_number   TEXT,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_equipment_venue ON equipment (venue_id) WHERE NOT archived;
CREATE INDEX idx_equipment_status ON equipment (status) WHERE NOT archived;
CREATE INDEX idx_equipment_category ON equipment (category) WHERE NOT archived;
CREATE INDEX idx_equipment_checked_out ON equipment (checked_out_to) WHERE status = 'checked_out';
CREATE INDEX idx_equipment_overdue ON equipment (due_back_at) WHERE status = 'checked_out' AND due_back_at IS NOT NULL;

-- ============================================================================
-- 3. Calendar sync state
-- ============================================================================

CREATE TABLE calendar_sync_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT NOT NULL UNIQUE,
  calendar_id     TEXT NOT NULL,
  last_sync_at    TIMESTAMPTZ,
  sync_token      TEXT,
  status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
  last_error      TEXT,
  records_synced  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. Guidebook sync log
-- ============================================================================

CREATE TABLE guidebook_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       TEXT NOT NULL CHECK (sync_type IN ('schedule', 'guest_bios', 'venue_info', 'full')),
  records_pushed  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_guidebook_sync_log_type ON guidebook_sync_log (sync_type, started_at);

-- ============================================================================
-- 5. Triggers
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON venues FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON equipment FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

-- ============================================================================
-- 6. Link schedule_events to venues (add FK if not present)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'schedule_events_venue_id_fkey'
      AND table_name = 'schedule_events'
  ) THEN
    ALTER TABLE schedule_events
      ADD CONSTRAINT schedule_events_venue_id_fkey
      FOREIGN KEY (venue_id) REFERENCES venues(id);
  END IF;
END $$;

COMMIT;
