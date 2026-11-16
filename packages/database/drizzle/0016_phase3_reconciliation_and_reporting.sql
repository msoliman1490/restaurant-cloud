-- Phase 3.5: Financial Reconciliation & Reporting Engine
CREATE TABLE IF NOT EXISTS "financial_reconciliation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid REFERENCES "branches"("id"),
  "run_number" varchar(100) NOT NULL,
  "as_of_date" timestamp with time zone DEFAULT now() NOT NULL,
  "status" varchar(30) DEFAULT 'COMPLETED' NOT NULL,
  "total_checks" integer DEFAULT 0 NOT NULL,
  "matched_count" integer DEFAULT 0 NOT NULL,
  "discrepancy_count" integer DEFAULT 0 NOT NULL,
  "not_configured_count" integer DEFAULT 0 NOT NULL,
  "total_variance" numeric(18, 4) DEFAULT '0.0000' NOT NULL,
  "executed_by" uuid REFERENCES "users"("id"),
  "idempotency_key" varchar(150),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "financial_reconciliation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "financial_reconciliation_runs"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid REFERENCES "branches"("id"),
  "category" varchar(60) NOT NULL,
  "mapping_key" varchar(80),
  "account_id" uuid,
  "account_code" varchar(50),
  "account_name" varchar(255),
  "entity_id" uuid,
  "entity_name" varchar(255) NOT NULL,
  "operational_balance" numeric(18, 4) DEFAULT '0.0000' NOT NULL,
  "gl_balance" numeric(18, 4) DEFAULT '0.0000' NOT NULL,
  "variance" numeric(18, 4) DEFAULT '0.0000' NOT NULL,
  "status" varchar(30) DEFAULT 'MATCHED' NOT NULL,
  "variance_source" text,
  "reference_type" varchar(80),
  "reference_id" uuid,
  "last_reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "details_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Reconciliation indexes
CREATE INDEX IF NOT EXISTS "idx_fin_recon_runs_tenant_le" ON "financial_reconciliation_runs" ("tenant_id", "legal_entity_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fin_recon_runs_idempotency" ON "financial_reconciliation_runs" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_fin_recon_items_run_id" ON "financial_reconciliation_items" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_fin_recon_items_tenant_cat_status" ON "financial_reconciliation_items" ("tenant_id", "legal_entity_id", "category", "status");

-- Reporting & Trial Balance performance indexes
CREATE INDEX IF NOT EXISTS "idx_journal_entries_reporting" ON "journal_entries" ("tenant_id", "legal_entity_id", "status", "entry_date");
CREATE INDEX IF NOT EXISTS "idx_journal_lines_reporting" ON "journal_lines" ("journal_entry_id", "account_id", "branch_id");

-- RLS & FORCE RLS
ALTER TABLE "financial_reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_reconciliation_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_financial_reconciliation_runs ON "financial_reconciliation_runs";
CREATE POLICY tenant_isolation_financial_reconciliation_runs ON "financial_reconciliation_runs"
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "financial_reconciliation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_reconciliation_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_financial_reconciliation_items ON "financial_reconciliation_items";
CREATE POLICY tenant_isolation_financial_reconciliation_items ON "financial_reconciliation_items"
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
