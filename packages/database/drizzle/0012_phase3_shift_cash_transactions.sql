-- ====================================================================
-- Migration 0012: POS Shift Cash In / Out Transactions
-- Table: shift_cash_transactions
-- ====================================================================

CREATE TABLE IF NOT EXISTS "shift_cash_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "shift_id" uuid NOT NULL REFERENCES "pos_shifts"("id") ON DELETE CASCADE,
  "transaction_type" varchar(30) DEFAULT 'CASH_IN' NOT NULL,
  "amount" numeric(12, 4) NOT NULL,
  "reason" varchar(255) NOT NULL,
  "performed_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_shift_cash_tenant_id" ON "shift_cash_transactions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shift_cash_shift_id" ON "shift_cash_transactions" ("shift_id");
--> statement-breakpoint

-- RLS Policies
ALTER TABLE "shift_cash_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_cash_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "shift_cash_tenant_policy" ON "shift_cash_transactions";
--> statement-breakpoint
CREATE POLICY "shift_cash_tenant_policy" ON "shift_cash_transactions"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "shift_cash_migrator" ON "shift_cash_transactions";
--> statement-breakpoint
CREATE POLICY "shift_cash_migrator" ON "shift_cash_transactions"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- Ownership & Grants
ALTER TABLE "shift_cash_transactions" OWNER TO rc_migrator;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_cash_transactions" TO rc_app_user;
--> statement-breakpoint
