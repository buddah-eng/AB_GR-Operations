-- 006-data-quality-security.sql
-- Data quality rules, violations, and data access logging.

CREATE TABLE quality_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  concept_key     TEXT NOT NULL,
  rule_type       TEXT NOT NULL CHECK (rule_type IN ('completeness', 'consistency', 'referential', 'staleness', 'uniqueness')),
  condition       JSONB NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('error', 'warning', 'info')),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quality_violations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID NOT NULL REFERENCES quality_rules(id),
  record_id       UUID NOT NULL,
  concept_key     TEXT NOT NULL,
  severity        TEXT NOT NULL,
  message         TEXT NOT NULL,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE data_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        TEXT NOT NULL,
  actor_type      TEXT NOT NULL,
  concept_key     TEXT NOT NULL,
  record_id       UUID NOT NULL,
  fields_accessed TEXT[],
  classification  TEXT NOT NULL CHECK (classification IN ('pii', 'sensitive', 'internal', 'public')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_violations_open ON quality_violations (concept_key) WHERE NOT resolved;
CREATE INDEX idx_data_access_log_actor ON data_access_log (actor_id, created_at);
