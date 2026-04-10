-- 007-pipelines-observability.sql
-- Internal pipelines, external connections, sync state, and observability metrics.

CREATE TABLE data_pipelines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('domain_event', 'scheduled', 'manual', 'pipeline')),
  trigger_config  JSONB NOT NULL,
  stages          JSONB NOT NULL DEFAULT '[]',
  error_strategy  TEXT NOT NULL DEFAULT 'continue' CHECK (error_strategy IN ('fail_fast', 'continue', 'retry_then_skip')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'deprecated')),
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pipeline_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID NOT NULL REFERENCES data_pipelines(id),
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  stages_completed INTEGER NOT NULL DEFAULT 0,
  stages_total    INTEGER NOT NULL,
  records_processed INTEGER NOT NULL DEFAULT 0,
  errors          JSONB DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE external_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL,
  endpoint_url    TEXT NOT NULL,
  auth_method     TEXT NOT NULL CHECK (auth_method IN ('api_key', 'oauth2', 'service_account', 'basic', 'bearer', 'webhook_secret')),
  auth_config     JSONB NOT NULL DEFAULT '{}',
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  concept_key     TEXT NOT NULL,
  field_mappings  JSONB NOT NULL DEFAULT '[]',
  poll_interval_ms INTEGER,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES external_connections(id),
  last_sync_at    TIMESTAMPTZ,
  sync_token      TEXT,
  status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
  last_error      TEXT,
  records_synced  INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE observability_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type     TEXT NOT NULL CHECK (metric_type IN ('pipeline_health', 'data_freshness', 'flow_throughput', 'error_count')),
  source_type     TEXT NOT NULL,
  source_id       UUID,
  value           JSONB NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_executions_pipeline ON pipeline_executions (pipeline_id, started_at);
CREATE INDEX idx_sync_state_connection ON sync_state (connection_id);
CREATE INDEX idx_observability_metrics_type ON observability_metrics (metric_type, recorded_at);
