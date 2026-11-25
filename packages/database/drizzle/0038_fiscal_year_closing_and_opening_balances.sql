-- Priority 3: Fiscal Year Closing, Reopening & Continuous-GL Opening Balances / Snapshots
-- Safe, idempotent migration (Staging first — zero mutation of historical journal entries).

-- 1. Extend fiscal_years with closing/reopening/rollover metadata
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "previous_fiscal_year_id" uuid REFERENCES "fiscal_years"("id");
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "closing_journal_entry_id" uuid REFERENCES "journal_entries"("id");
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "reopen_reversal_journal_entry_id" uuid REFERENCES "journal_entries"("id");
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "reopened_by" uuid;
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "reopen_reason" text;
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "closing_idempotency_key" varchar(255);
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "closing_trial_balance_snapshot_json" jsonb;
ALTER TABLE "fiscal_years" ADD COLUMN IF NOT EXISTS "opening_carry_forward_completed_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_years_prev_year"
  ON "fiscal_years" ("legal_entity_id", "previous_fiscal_year_id")
  WHERE "previous_fiscal_year_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_years_closing_idemp"
  ON "fiscal_years" ("tenant_id", "closing_idempotency_key")
  WHERE "closing_idempotency_key" IS NOT NULL;

-- 2. Allow year-level closing/reopening/next-year logs in fiscal_period_closing_logs without a dummy period_id
ALTER TABLE "fiscal_period_closing_logs" ALTER COLUMN "period_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fp_closing_logs_year"
  ON "fiscal_period_closing_logs" ("fiscal_year_id", "created_at");

-- 3. Create fiscal_year_opening_balances (immutable carry-forward ledger for permanent accounts)
CREATE TABLE IF NOT EXISTS "fiscal_year_opening_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "fiscal_year_id" uuid NOT NULL REFERENCES "fiscal_years"("id"),
  "source_fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "branch_id" uuid REFERENCES "branches"("id"),
  "currency" varchar(3) NOT NULL DEFAULT 'SAR',
  "opening_debit" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "opening_credit" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "net_balance" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "opening_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fy_opening_bal_tenant_year"
  ON "fiscal_year_opening_balances" ("tenant_id", "legal_entity_id", "fiscal_year_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_fy_opening_bal_active"
  ON "fiscal_year_opening_balances" (
    "legal_entity_id",
    "fiscal_year_id",
    "account_id",
    COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "currency"
  )
  WHERE "status" = 'ACTIVE';

ALTER TABLE "fiscal_year_opening_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_year_opening_balances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fy_opening_balances_tenant_isolation" ON "fiscal_year_opening_balances";
CREATE POLICY "fy_opening_balances_tenant_isolation" ON "fiscal_year_opening_balances"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fiscal_year_opening_balances" TO rc_app_user;

-- 4. Create fiscal_year_opening_snapshots (AR/AP/Inventory/TB opening verification snapshots)
CREATE TABLE IF NOT EXISTS "fiscal_year_opening_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "fiscal_year_id" uuid NOT NULL REFERENCES "fiscal_years"("id"),
  "source_fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "snapshot_type" varchar(40) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "total_debit" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "total_credit" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "is_balanced" boolean NOT NULL DEFAULT true,
  "payload_json" jsonb NOT NULL,
  "idempotency_key" varchar(255),
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fy_opening_snap_tenant_year"
  ON "fiscal_year_opening_snapshots" ("tenant_id", "legal_entity_id", "fiscal_year_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_fy_opening_snap_active"
  ON "fiscal_year_opening_snapshots" ("legal_entity_id", "fiscal_year_id", "snapshot_type")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "fiscal_year_opening_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_year_opening_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fy_opening_snapshots_tenant_isolation" ON "fiscal_year_opening_snapshots";
CREATE POLICY "fy_opening_snapshots_tenant_isolation" ON "fiscal_year_opening_snapshots"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fiscal_year_opening_snapshots" TO rc_app_user;
