-- 0. Fiscal Periods
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"period_name" varchar(50) NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fiscal_periods_tenant_id" ON "fiscal_periods" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fiscal_periods_entity_name" ON "fiscal_periods" ("legal_entity_id", "period_name");
--> statement-breakpoint

-- 1. Cost Centers
CREATE TABLE IF NOT EXISTS "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"code" varchar(50) NOT NULL,
	"name_ar" varchar(255) NOT NULL,
	"name_en" varchar(255),
	"parent_id" uuid,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cost_centers_tenant_id" ON "cost_centers" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cost_centers_entity_code" ON "cost_centers" ("legal_entity_id", "code");
--> statement-breakpoint

-- 2. Account Mappings
CREATE TABLE IF NOT EXISTS "account_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"mapping_key" varchar(50) NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"description" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_mappings_tenant_id" ON "account_mappings" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_mappings_entity_key" ON "account_mappings" ("legal_entity_id", "mapping_key");
--> statement-breakpoint

-- 3. Cash Vaults
CREATE TABLE IF NOT EXISTS "cash_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"code" varchar(50) NOT NULL,
	"name_ar" varchar(255) NOT NULL,
	"name_en" varchar(255),
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"custodian_id" uuid,
	"balance" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cash_vaults_tenant_id" ON "cash_vaults" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cash_vaults_entity_code" ON "cash_vaults" ("legal_entity_id", "code");
--> statement-breakpoint

-- 4. Bank Accounts
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"bank_name" varchar(255) NOT NULL,
	"account_number" varchar(100) NOT NULL,
	"iban" varchar(50),
	"swift_code" varchar(50),
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"balance" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_accounts_tenant_id" ON "bank_accounts" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bank_accounts_entity_acc_num" ON "bank_accounts" ("legal_entity_id", "account_number");
--> statement-breakpoint

-- 5. Payment Vouchers
CREATE TABLE IF NOT EXISTS "payment_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"voucher_number" varchar(50) NOT NULL,
	"voucher_date" timestamp with time zone DEFAULT now() NOT NULL,
	"voucher_type" varchar(50) DEFAULT 'VENDOR_PAYMENT' NOT NULL,
	"beneficiary_type" varchar(50) DEFAULT 'VENDOR',
	"beneficiary_id" uuid,
	"beneficiary_name" varchar(255) NOT NULL,
	"source_type" varchar(20) DEFAULT 'VAULT' NOT NULL,
	"source_id" uuid NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"cost_center_id" uuid REFERENCES "cost_centers"("id"),
	"payment_method" varchar(30) DEFAULT 'CASH' NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
	"status" varchar(30) DEFAULT 'POSTED' NOT NULL,
	"journal_entry_id" uuid REFERENCES "journal_entries"("id"),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_vouchers_tenant_id" ON "payment_vouchers" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_vouchers_entity_number" ON "payment_vouchers" ("legal_entity_id", "voucher_number");
--> statement-breakpoint

-- 6. Receipt Vouchers
CREATE TABLE IF NOT EXISTS "receipt_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"voucher_number" varchar(50) NOT NULL,
	"voucher_date" timestamp with time zone DEFAULT now() NOT NULL,
	"voucher_type" varchar(50) DEFAULT 'CUSTOMER_PAYMENT' NOT NULL,
	"payer_type" varchar(50) DEFAULT 'CUSTOMER',
	"payer_id" uuid,
	"payer_name" varchar(255) NOT NULL,
	"destination_type" varchar(20) DEFAULT 'VAULT' NOT NULL,
	"destination_id" uuid NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"payment_method" varchar(30) DEFAULT 'CASH' NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
	"status" varchar(30) DEFAULT 'POSTED' NOT NULL,
	"journal_entry_id" uuid REFERENCES "journal_entries"("id"),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receipt_vouchers_tenant_id" ON "receipt_vouchers" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receipt_vouchers_entity_number" ON "receipt_vouchers" ("legal_entity_id", "voucher_number");
--> statement-breakpoint

-- 7. Expenses
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"branch_id" uuid REFERENCES "branches"("id"),
	"cost_center_id" uuid REFERENCES "cost_centers"("id"),
	"expense_number" varchar(50) NOT NULL,
	"expense_date" timestamp with time zone DEFAULT now() NOT NULL,
	"category" varchar(100) NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
	"vendor_name" varchar(255),
	"subtotal" numeric(14, 4) NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"vat_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"total_amount" numeric(14, 4) NOT NULL,
	"payment_voucher_id" uuid REFERENCES "payment_vouchers"("id"),
	"status" varchar(30) DEFAULT 'APPROVED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_tenant_id" ON "expenses" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_expenses_entity_number" ON "expenses" ("legal_entity_id", "expense_number");
--> statement-breakpoint

-- 8. Vault Transactions
CREATE TABLE IF NOT EXISTS "vault_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"vault_id" uuid NOT NULL REFERENCES "cash_vaults"("id"),
	"transaction_type" varchar(50) NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"balance_after" numeric(14, 4) NOT NULL,
	"source_document_type" varchar(50),
	"source_document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"performed_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vault_tx_tenant_id" ON "vault_transactions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vault_tx_vault_id" ON "vault_transactions" ("vault_id");
--> statement-breakpoint

-- 9. Bank Reconciliations
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
	"bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id"),
	"statement_date" timestamp with time zone NOT NULL,
	"statement_ending_balance" numeric(14, 4) NOT NULL,
	"book_ending_balance" numeric(14, 4) NOT NULL,
	"reconciled_balance" numeric(14, 4) NOT NULL,
	"discrepancy" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"status" varchar(30) DEFAULT 'COMPLETED' NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_rec_tenant_id" ON "bank_reconciliations" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_rec_acc_id" ON "bank_reconciliations" ("bank_account_id");
--> statement-breakpoint

-- 10. Alter existing tables
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "name_ar" varchar(255);
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "name_en" varchar(255);
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "is_system" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'SAR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id");
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approval_status" varchar(30) DEFAULT 'APPROVED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "document_date" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "entry_date" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "fiscal_period_id" uuid REFERENCES "fiscal_periods"("id");
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversal_of_id" uuid;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journal_entries_period" ON "journal_entries" ("fiscal_period_id");
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id");
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid REFERENCES "cost_centers"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journal_lines_cost_center" ON "journal_lines" ("cost_center_id");
--> statement-breakpoint

-- Grant rc_app_user privileges on all newly created tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
