-- Tenant Integrations & Notifications (WhatsApp, Webhooks, SMS, Email)

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel varchar(40) NOT NULL,
  provider varchar(60) NOT NULL DEFAULT 'CUSTOM',
  is_enabled boolean NOT NULL DEFAULT false,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_integrations_tenant_channel ON tenant_integrations (tenant_id, channel);

ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_integrations_tenant_isolation ON tenant_integrations;
CREATE POLICY tenant_integrations_tenant_isolation ON tenant_integrations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_integrations TO rc_app_user;

CREATE TABLE IF NOT EXISTS notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid REFERENCES branches(id),
  channel varchar(40) NOT NULL,
  recipient varchar(150) NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'SENT',
  idempotency_key varchar(150),
  error_message text,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_created ON notification_logs (tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_idempotency ON notification_logs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_logs_tenant_isolation ON notification_logs;
CREATE POLICY notification_logs_tenant_isolation ON notification_logs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_logs TO rc_app_user;
