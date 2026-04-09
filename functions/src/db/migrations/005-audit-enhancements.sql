-- 005-audit-enhancements.sql
-- Admin alerts table for rogue-actor detection and system alerts.

CREATE TABLE admin_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  resolved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_alerts_unresolved ON admin_alerts (category) WHERE NOT resolved;
