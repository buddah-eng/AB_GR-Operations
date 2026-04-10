-- Migration 003: External Surfaces
-- Phase 1 — Guest self-service forms, driver sessions, transport bookings
-- Run after 002-core-services.sql

BEGIN;

-- ============================================================================
-- 1. Guest Form Sessions
-- ============================================================================

CREATE TABLE guest_form_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  guest_id        UUID NOT NULL REFERENCES guests(id),
  form_data       JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  submitted_at    TIMESTAMPTZ,
  last_saved_at   TIMESTAMPTZ
);

CREATE INDEX idx_guest_form_sessions_guest ON guest_form_sessions (guest_id);
CREATE INDEX idx_guest_form_sessions_status ON guest_form_sessions (status) WHERE status = 'active';

-- ============================================================================
-- 2. Driver Sessions
-- ============================================================================

CREATE TABLE driver_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  driver_name     TEXT NOT NULL,
  booking_ids     UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_driver_sessions_status ON driver_sessions (status) WHERE status = 'active';

-- ============================================================================
-- 3. Transport Bookings
-- ============================================================================

CREATE TABLE transport_bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id        UUID NOT NULL REFERENCES guests(id),
  booking_type    TEXT NOT NULL CHECK (booking_type IN ('arrival', 'departure', 'inter_venue')),
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'dispatched', 'waiting', 'picked_up', 'dropped_off', 'cancelled')),
  pickup_location TEXT,
  dropoff_location TEXT,
  scheduled_time  TIMESTAMPTZ,
  driver_name     TEXT,
  vehicle_info    TEXT,
  flight_number   TEXT,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_transport_bookings_guest ON transport_bookings (guest_id);
CREATE INDEX idx_transport_bookings_status ON transport_bookings (status) WHERE NOT archived;
CREATE INDEX idx_transport_bookings_scheduled ON transport_bookings (scheduled_time) WHERE NOT archived;

-- ============================================================================
-- 4. Triggers
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON transport_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE
  ON transport_bookings FOR EACH ROW EXECUTE FUNCTION audit_domain_trigger();

COMMIT;
