-- Phase 3.6: Financial Period Closing Engine

CREATE TABLE IF NOT EXISTS "fiscal_years" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "year_code" varchar(30) NOT NULL,
  "year_name" varchar(100) NOT NULL,
  "start_date" timestamp with time zone NOT NULL,
  "end_date" timestamp with time zone NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "closed_at" timestamp with time zone,
  "closed_by" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fiscal_years_tenant_entity" ON "fiscal_years" ("tenant_id", "legal_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fiscal_years_entity_code" ON "fiscal_years" ("legal_entity_id", "year_code");

ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "fiscal_year_id" uuid REFERENCES "fiscal_years"("id");
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "period_number" integer;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "reopened_by" uuid;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "reopen_reason" text;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "closing_notes" text;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "last_precheck_at" timestamp with time zone;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "last_precheck_status" varchar(20);
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);

CREATE INDEX IF NOT EXISTS "idx_fiscal_periods_entity_dates" ON "fiscal_periods" ("tenant_id", "legal_entity_id", "start_date", "end_date");

CREATE TABLE IF NOT EXISTS "fiscal_period_closing_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "period_id" uuid NOT NULL REFERENCES "fiscal_periods"("id"),
  "fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "action" varchar(30) NOT NULL,
  "previous_status" varchar(20) NOT NULL,
  "new_status" varchar(20) NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" text,
  "blockers_count" integer NOT NULL DEFAULT 0,
  "warnings_count" integer NOT NULL DEFAULT 0,
  "checks_snapshot_json" jsonb,
  "trial_balance_snapshot_json" jsonb,
  "idempotency_key" varchar(255),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fp_closing_logs_tenant_entity" ON "fiscal_period_closing_logs" ("tenant_id", "legal_entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_fp_closing_logs_period" ON "fiscal_period_closing_logs" ("period_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fp_closing_logs_idemp" ON "fiscal_period_closing_logs" ("tenant_id", "idempotency_key");

-- Enable & Force RLS on new Phase 3.6 tables
ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_years" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_fiscal_years" ON "fiscal_years";
CREATE POLICY "tenant_isolation_fiscal_years" ON "fiscal_years"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "fiscal_period_closing_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_period_closing_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_fiscal_period_closing_logs" ON "fiscal_period_closing_logs";
CREATE POLICY "tenant_isolation_fiscal_period_closing_logs" ON "fiscal_period_closing_logs"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fiscal_years" TO "rc_app_user";
REVOKE ALL ON TABLE "fiscal_period_closing_logs" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "fiscal_period_closing_logs" FROM "rc_app_user";
GRANT SELECT, INSERT ON TABLE "fiscal_period_closing_logs" TO "rc_app_user";
