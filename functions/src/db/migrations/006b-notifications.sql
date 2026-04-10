-- 006-notifications.sql
-- Notification delivery and user preference tables.

CREATE TABLE notification_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'in_app', 'push')),
  template_name   TEXT,
  subject         TEXT,
  body            TEXT,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'read')),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  read_at         TIMESTAMPTZ
);

CREATE TABLE notification_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  channel_email   BOOLEAN NOT NULL DEFAULT true,
  channel_in_app  BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  digest_mode     TEXT DEFAULT 'none' CHECK (digest_mode IN ('none', 'hourly', 'daily')),
  UNIQUE (user_id)
);

CREATE INDEX idx_notification_log_recipient ON notification_log (recipient_id, status);
CREATE INDEX idx_notification_log_unread ON notification_log (recipient_id) WHERE channel = 'in_app' AND status != 'read';
