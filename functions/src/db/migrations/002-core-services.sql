-- Migration 002: Core Platform Services
-- Phase 2 — Rogue-actor detection, YoY registry, guest registry linkage
-- Run after 001-foundation.sql

BEGIN;

-- ============================================================================
-- 1. Rogue-actor detection table
-- ============================================================================

CREATE TABLE api_audit_claims (
  change_set    UUID PRIMARY KEY,
  actor_id      TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. YoY Registry tables
-- ============================================================================

CREATE TABLE guest_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  email           TEXT,
  company         TEXT,
  type            TEXT,
  department      TEXT,
  dietary         TEXT,
  travel_prefs    JSONB DEFAULT '{}',
  notes           JSONB DEFAULT '{}',
  first_attended  INTEGER NOT NULL,
  last_attended   INTEGER,
  attendance_count INTEGER NOT NULL DEFAULT 0,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_guest_registry_email ON guest_registry (email) WHERE email IS NOT NULL;
CREATE INDEX idx_guest_registry_name ON guest_registry (canonical_name);
CREATE INDEX idx_guest_registry_company ON guest_registry (company);
CREATE INDEX idx_guest_registry_properties ON guest_registry USING GIN (properties);
CREATE INDEX idx_guest_registry_notes ON guest_registry USING GIN (notes);
CREATE INDEX idx_guest_registry_travel_prefs ON guest_registry USING GIN (travel_prefs);

CREATE TABLE vendor_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  category        TEXT,
  region          TEXT,
  payment_terms   TEXT,
  notes           JSONB DEFAULT '{}',
  first_attended  INTEGER,
  last_attended   INTEGER,
  attendance_count INTEGER NOT NULL DEFAULT 0,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_vendor_registry_email ON vendor_registry (contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX idx_vendor_registry_company ON vendor_registry (company_name);
CREATE INDEX idx_vendor_registry_category ON vendor_registry (category);

-- ============================================================================
-- 3. Guest table registry linkage
-- ============================================================================

ALTER TABLE guests ADD COLUMN registry_id UUID REFERENCES guest_registry(id);
ALTER TABLE guests ADD COLUMN convention_year INTEGER NOT NULL DEFAULT 2026;

CREATE INDEX idx_guests_registry ON guests (registry_id);
CREATE INDEX idx_guests_year ON guests (convention_year);

-- ============================================================================
-- 4. Email blind index for encrypted search
-- ============================================================================

ALTER TABLE guests ADD COLUMN email_hmac TEXT;
CREATE INDEX idx_guests_email_hmac ON guests (email_hmac);

COMMIT;
