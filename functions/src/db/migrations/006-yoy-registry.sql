-- Migration 006: YoY Registry — guests table linkage
-- Adds registry_id FK and convention_year to guests for cross-year identity.
-- Run after 005-audit-enhancements.sql

BEGIN;

ALTER TABLE guests ADD COLUMN IF NOT EXISTS registry_id UUID REFERENCES guest_registry(id);
ALTER TABLE guests ADD COLUMN IF NOT EXISTS convention_year INTEGER NOT NULL DEFAULT 2026;

CREATE INDEX IF NOT EXISTS idx_guests_registry ON guests (registry_id);
CREATE INDEX IF NOT EXISTS idx_guests_year ON guests (convention_year);

COMMIT;
