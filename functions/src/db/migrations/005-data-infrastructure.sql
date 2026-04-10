-- 005-data-infrastructure.sql
-- Data routing and data transforms tables.

CREATE TABLE data_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  source_concept  TEXT NOT NULL,
  dest_concept    TEXT NOT NULL,
  field_mappings  JSONB NOT NULL DEFAULT '[]',
  transform_id    UUID,
  pii_mode        TEXT NOT NULL DEFAULT 'strip' CHECK (pii_mode IN ('strip', 'pass', 'hash')),
  trigger_event   TEXT NOT NULL,
  execution_mode  TEXT NOT NULL DEFAULT 'async' CHECK (execution_mode IN ('sync', 'async')),
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_transforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  transform_chain JSONB NOT NULL DEFAULT '[]',
  reusable        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_routes_active ON data_routes (trigger_event) WHERE active;
CREATE INDEX idx_data_routes_source ON data_routes (source_concept) WHERE active;
