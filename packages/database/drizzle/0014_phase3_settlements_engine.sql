ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settlement_status" varchar(30) DEFAULT 'UNSETTLED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settled_amount" numeric(12, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"code" varchar(50) NOT NULL,
	"name_ar" varchar(150) NOT NULL,
	"name_en" varchar(150) NOT NULL,
	"category" varchar(30) NOT NULL,
	"matching_strategy" varchar(50) DEFAULT 'REFERENCE_AND_AMOUNT' NOT NULL,
	"clearing_mapping_key" varchar(60) NOT NULL,
	"fee_mapping_key" varchar(60) NOT NULL,
	"default_fee_rate" numeric(7, 4) DEFAULT '0.0000' NOT NULL,
	"vat_on_fee_applicable" boolean DEFAULT true NOT NULL,
	"default_bank_account_id" uuid REFERENCES "bank_accounts"("id"),
	"is_active" boolean DEFAULT true NOT NULL,
	"config_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_providers_tenant" ON "settlement_providers" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settlement_providers_entity_code" ON "settlement_providers" ("tenant_id","legal_entity_id","code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"provider_id" uuid NOT NULL REFERENCES "settlement_providers"("id"),
	"file_name" varchar(255) NOT NULL,
	"file_hash" varchar(128) NOT NULL,
	"format" varchar(20) DEFAULT 'CSV' NOT NULL,
	"status" varchar(30) DEFAULT 'PROCESSING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"discrepancy_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"errors_json" jsonb,
	"imported_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_import_tenant" ON "settlement_import_files" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settlement_import_unique_hash" ON "settlement_import_files" ("tenant_id","legal_entity_id","provider_id","file_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"provider_id" uuid NOT NULL REFERENCES "settlement_providers"("id"),
	"import_file_id" uuid REFERENCES "settlement_import_files"("id"),
	"batch_number" varchar(80) NOT NULL,
	"settlement_type" varchar(30) NOT NULL,
	"settlement_date" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"bank_account_id" uuid REFERENCES "bank_accounts"("id"),
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"gross_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"cancelled_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"restaurant_discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"platform_discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"delivery_fee_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"fee_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"fee_tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"withheld_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"net_expected_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"bank_received_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"variance_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"has_valid_tax_invoice" boolean DEFAULT false NOT NULL,
	"tax_invoice_number" varchar(100),
	"is_vat_recoverable" boolean DEFAULT false NOT NULL,
	"journal_entry_id" uuid REFERENCES "journal_entries"("id"),
	"bank_reference" varchar(120),
	"idempotency_key" varchar(255),
	"approved_by" uuid REFERENCES "users"("id"),
	"approved_at" timestamp with time zone,
	"posted_by" uuid REFERENCES "users"("id"),
	"posted_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_batches_tenant" ON "settlement_batches" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_batches_entity_status" ON "settlement_batches" ("tenant_id","legal_entity_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_batches_provider_date" ON "settlement_batches" ("provider_id","settlement_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settlement_batches_entity_num" ON "settlement_batches" ("tenant_id","legal_entity_id","batch_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settlement_batches_idempotency" ON "settlement_batches" ("tenant_id","idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_batch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"batch_id" uuid NOT NULL REFERENCES "settlement_batches"("id") ON DELETE cascade,
	"provider_id" uuid NOT NULL REFERENCES "settlement_providers"("id"),
	"line_number" integer NOT NULL,
	"external_ref" varchar(150),
	"order_number" varchar(100),
	"payment_method" varchar(50),
	"transaction_date" timestamp with time zone,
	"gross_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"discount_restaurant" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"discount_platform" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"delivery_fee" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"fee_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"fee_tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"withheld_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"net_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"matched_payment_id" uuid REFERENCES "payments"("id"),
	"matched_order_id" uuid REFERENCES "sales_orders"("id"),
	"system_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"settled_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"match_status" varchar(40) DEFAULT 'MATCHED' NOT NULL,
	"raw_row_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_lines_tenant" ON "settlement_batch_lines" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_lines_batch" ON "settlement_batch_lines" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_lines_ext_ref" ON "settlement_batch_lines" ("tenant_id","external_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_lines_payment" ON "settlement_batch_lines" ("matched_payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_lines_order" ON "settlement_batch_lines" ("matched_order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"batch_id" uuid NOT NULL REFERENCES "settlement_batches"("id") ON DELETE cascade,
	"batch_line_id" uuid REFERENCES "settlement_batch_lines"("id") ON DELETE set null,
	"discrepancy_type" varchar(50) NOT NULL,
	"source_system" varchar(40) NOT NULL,
	"amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"description" text NOT NULL,
	"status" varchar(30) DEFAULT 'OPEN' NOT NULL,
	"resolution_notes" text,
	"resolved_by" uuid REFERENCES "users"("id"),
	"resolved_at" timestamp with time zone,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_disc_tenant_batch" ON "settlement_discrepancies" ("tenant_id","batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_disc_status" ON "settlement_discrepancies" ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_settlement_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"batch_id" uuid NOT NULL REFERENCES "settlement_batches"("id"),
	"bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id"),
	"bank_reference" varchar(120) NOT NULL,
	"received_amount" numeric(14, 4) NOT NULL,
	"received_date" timestamp with time zone DEFAULT now() NOT NULL,
	"journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id"),
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_settlement_tenant" ON "bank_settlement_transactions" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bank_settlement_batch_unique" ON "bank_settlement_transactions" ("batch_id");
--> statement-breakpoint
ALTER TABLE "settlement_providers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlement_providers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_settlement_providers" ON "settlement_providers";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_settlement_providers" ON "settlement_providers" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_settlement_providers" ON "settlement_providers";
--> statement-breakpoint
CREATE POLICY "migrator_settlement_providers" ON "settlement_providers" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "settlement_import_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlement_import_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_settlement_import_files" ON "settlement_import_files";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_settlement_import_files" ON "settlement_import_files" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_settlement_import_files" ON "settlement_import_files";
--> statement-breakpoint
CREATE POLICY "migrator_settlement_import_files" ON "settlement_import_files" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "settlement_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlement_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_settlement_batches" ON "settlement_batches";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_settlement_batches" ON "settlement_batches" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_settlement_batches" ON "settlement_batches";
--> statement-breakpoint
CREATE POLICY "migrator_settlement_batches" ON "settlement_batches" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_settlement_batch_lines" ON "settlement_batch_lines";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_settlement_batch_lines" ON "settlement_batch_lines" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_settlement_batch_lines" ON "settlement_batch_lines";
--> statement-breakpoint
CREATE POLICY "migrator_settlement_batch_lines" ON "settlement_batch_lines" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "settlement_discrepancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlement_discrepancies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_settlement_discrepancies" ON "settlement_discrepancies";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_settlement_discrepancies" ON "settlement_discrepancies" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_settlement_discrepancies" ON "settlement_discrepancies";
--> statement-breakpoint
CREATE POLICY "migrator_settlement_discrepancies" ON "settlement_discrepancies" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "bank_settlement_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_settlement_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_bank_settlement_transactions" ON "bank_settlement_transactions";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_bank_settlement_transactions" ON "bank_settlement_transactions" FOR ALL TO "rc_app_user" USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_bank_settlement_transactions" ON "bank_settlement_transactions";
--> statement-breakpoint
CREATE POLICY "migrator_bank_settlement_transactions" ON "bank_settlement_transactions" FOR ALL TO "rc_migrator" USING (true) WITH CHECK (true);
