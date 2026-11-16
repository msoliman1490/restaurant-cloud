-- Integration Security & Notification Retry Queue
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS signature_header text;
CREATE INDEX IF NOT EXISTS idx_notification_logs_retry ON notification_logs (tenant_id, status, next_retry_at) WHERE status = 'RETRY_PENDING';
