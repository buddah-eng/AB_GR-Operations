-- Migration 003: Integration Patterns
-- Webhook subscriptions, delivery log, rate-limit counters,
-- and rate_limit_per_min column on api_keys.
-- Run after 002-core-services.sql

BEGIN;

-- ============================================================================
-- 1. Add rate_limit_per_min to api_keys
-- ============================================================================

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER NOT NULL DEFAULT 300;

-- ============================================================================
-- 2. Webhook subscriptions
-- ============================================================================

CREATE TABLE webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id   UUID NOT NULL REFERENCES api_keys(id),
  event_pattern   TEXT NOT NULL,
  target_url      TEXT NOT NULL,
  secret          TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_delivery   TIMESTAMPTZ,
  last_status     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_subs_client ON webhook_subscriptions (api_client_id);
CREATE INDEX idx_webhook_subs_active ON webhook_subscriptions (active) WHERE active = true;

-- ============================================================================
-- 3. Webhook delivery log
-- ============================================================================

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

CREATE INDEX idx_webhook_delivery_sub ON webhook_delivery_log (subscription_id);
CREATE INDEX idx_webhook_delivery_event ON webhook_delivery_log (event_id);

-- ============================================================================
-- 4. Rate-limit counters (sliding window)
-- ============================================================================

CREATE TABLE rate_limit_counters (
  key             TEXT NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  count           INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

COMMIT;
