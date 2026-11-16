CREATE TABLE IF NOT EXISTS "webhook_replay_nonces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "channel" varchar(40) NOT NULL DEFAULT 'WEBHOOK',
  "nonce" varchar(180) NOT NULL,
  "timestamp_sec" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_replay_nonces_tenant_nonce"
  ON "webhook_replay_nonces" ("tenant_id", "nonce");

CREATE INDEX IF NOT EXISTS "idx_webhook_replay_nonces_expires"
  ON "webhook_replay_nonces" ("expires_at");

ALTER TABLE "webhook_replay_nonces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_replay_nonces" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_webhook_replay_nonces" ON "webhook_replay_nonces";
CREATE POLICY "tenant_isolation_webhook_replay_nonces" ON "webhook_replay_nonces"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_replay_nonces" TO rc_app_user;
