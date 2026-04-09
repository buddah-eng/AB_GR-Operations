-- Migration 003: API Surface + External Access
-- Phase 3 — Webhook subscriptions, guest/driver sessions, rate limiting

BEGIN;

-- ============================================================================
-- 1. Webhook Subscriptions
-- ============================================================================

CREATE TABLE webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id   UUID NOT NULL REFERENCES api_keys(id),
  event_pattern   TEXT NOT NULL,        -- glob: "guest.*", "*.created", etc.
  target_url      TEXT NOT NULL,
  secret          TEXT NOT NULL,        -- HMAC-SHA256 signing secret
  active          BOOLEAN NOT NULL DEFAULT true,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_delivery   TIMESTAMPTZ,
  last_status     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_active ON webhook_subscriptions (event_pattern) WHERE active;

CREATE TABLE webhook_delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  event_id        TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 1,
  status_code     INTEGER,
  response_body   TEXT,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_delivery_sub ON webhook_delivery_log (subscription_id, delivered_at);

-- ============================================================================
-- 2. Guest Form Sessions (token-scoped external access)
-- ============================================================================

CREATE TABLE guest_form_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  guest_id        UUID NOT NULL REFERENCES guests(id),
  form_data       JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'submitted', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  submitted_at    TIMESTAMPTZ,
  last_saved_at   TIMESTAMPTZ
);

CREATE INDEX idx_guest_form_token ON guest_form_sessions (token_hash) WHERE status = 'active';

-- ============================================================================
-- 3. Driver Sessions
-- ============================================================================

CREATE TABLE driver_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  driver_name     TEXT NOT NULL,
  booking_ids     UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_driver_session_token ON driver_sessions (token_hash) WHERE status = 'active';

-- ============================================================================
-- 4. Rate Limiting
-- ============================================================================

CREATE TABLE rate_limit_counters (
  key             TEXT NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  count           INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- Auto-cleanup old windows (pg_cron or application-level)
CREATE INDEX idx_rate_limit_window ON rate_limit_counters (window_start);

-- ============================================================================
-- 5. Transport Bookings (for driver sessions)
-- ============================================================================

CREATE TABLE transport_bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id        UUID NOT NULL REFERENCES guests(id),
  booking_type    TEXT NOT NULL CHECK (booking_type IN ('arrival', 'departure', 'inter_venue')),
  status          TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'confirmed', 'dispatched', 'waiting', 'picked_up', 'dropped_off', 'cancelled')),
  pickup_location TEXT,
  dropoff_location TEXT,
  scheduled_time  TIMESTAMPTZ,
  driver_name     TEXT,
  driver_phone    TEXT,
  vehicle_info    TEXT,
  flight_number   TEXT,
  flight_status   TEXT,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  archived        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_transport_guest ON transport_bookings (guest_id) WHERE NOT archived;
CREATE INDEX idx_transport_status ON transport_bookings (status) WHERE NOT archived;

COMMIT;
