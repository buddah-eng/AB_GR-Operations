-- Migration 003-ci-qa: Config Change Request Pipeline
-- Stores change requests that flow through the CI/QA pipeline:
-- draft -> validating -> review -> staged -> applied -> rolled_back | rejected
-- Run after 002-core-services.sql

BEGIN;

-- ============================================================================
-- 1. Config change requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS config_change_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'validating', 'review', 'staged', 'applied', 'rolled_back', 'rejected')),
  table_name        TEXT NOT NULL,
  record_key        TEXT NOT NULL,
  changes           JSONB NOT NULL,
  owner_scope       TEXT NOT NULL DEFAULT 'org',
  owner_department  TEXT,
  risk_level        TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  validation_errors JSONB DEFAULT '[]',
  impact_report     JSONB,
  created_by        UUID NOT NULL,
  reviewed_by       UUID,
  applied_at        TIMESTAMPTZ,
  change_set        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing open requests by status
CREATE INDEX IF NOT EXISTS idx_ccr_status ON config_change_requests (status);

-- Index for looking up requests by table + key
CREATE INDEX IF NOT EXISTS idx_ccr_table_key ON config_change_requests (table_name, record_key);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_ccr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccr_updated_at ON config_change_requests;
CREATE TRIGGER trg_ccr_updated_at
  BEFORE UPDATE ON config_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_ccr_updated_at();

COMMIT;
