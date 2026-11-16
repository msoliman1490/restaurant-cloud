-- ====================================================================
-- Migration 0008: Phase 3.2 Financial Resources Management
-- Tables: bank_account_branch_access, payment_methods, payment_terminals
-- Alter: devices (name, legal_entity_id, cash_vault_id, ip_address)
-- Security: Full RLS & Force RLS for rc_app_user and rc_migrator
-- ====================================================================

-- 1. Bank Account Branch Access (Multi-Branch Sharing)
CREATE TABLE IF NOT EXISTS "bank_account_branch_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_bank_acc_branch_tenant_id" ON "bank_account_branch_access" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_acc_branch_branch_id" ON "bank_account_branch_access" ("branch_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bank_acc_branch_unique" ON "bank_account_branch_access" ("bank_account_id", "branch_id");
--> statement-breakpoint

-- 2. Payment Methods
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code" varchar(50) NOT NULL,
  "name_ar" varchar(255) NOT NULL,
  "name_en" varchar(255),
  "type" varchar(50) NOT NULL DEFAULT 'CARD',
  "display_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "requires_terminal" boolean NOT NULL DEFAULT false,
  "requires_reference" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_payment_methods_tenant_id" ON "payment_methods" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_methods_tenant_code" ON "payment_methods" ("tenant_id", "code");
--> statement-breakpoint

-- 3. Payment Terminals (Electronic Payment Terminals - EDC/POS Payment)
CREATE TABLE IF NOT EXISTS "payment_terminals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "terminal_code" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "provider" varchar(100) NOT NULL DEFAULT 'GEIDEA',
  "model" varchar(100),
  "serial_number" varchar(100),
  "ip_address" varchar(50),
  "linked_pos_device_id" uuid REFERENCES "devices"("id") ON DELETE SET NULL,
  "clearing_account_id" uuid REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
  "status" varchar(30) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_payment_terminals_tenant_id" ON "payment_terminals" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_terminals_branch_id" ON "payment_terminals" ("branch_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_terminals_entity_code" ON "payment_terminals" ("legal_entity_id", "terminal_code");
--> statement-breakpoint

-- 4. POS Devices Enhancement
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "name" varchar(255);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "legal_entity_id" uuid REFERENCES "legal_entities"("id");
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "cash_vault_id" uuid REFERENCES "cash_vaults"("id");
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ip_address" varchar(50);
--> statement-breakpoint

UPDATE "devices" d
SET "legal_entity_id" = b."legal_entity_id"
FROM "branches" b
WHERE d."branch_id" = b."id" AND d."legal_entity_id" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_devices_legal_entity_id" ON "devices" ("legal_entity_id");
--> statement-breakpoint

-- 5. RLS & Security Enforcement
ALTER TABLE "bank_account_branch_access" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_account_branch_access" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "bank_account_branch_access_policy" ON "bank_account_branch_access";
--> statement-breakpoint
CREATE POLICY "bank_account_branch_access_policy" ON "bank_account_branch_access"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_admin_policy" ON "bank_account_branch_access";
--> statement-breakpoint
CREATE POLICY "migrator_admin_policy" ON "bank_account_branch_access"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "payment_methods_policy" ON "payment_methods";
--> statement-breakpoint
CREATE POLICY "payment_methods_policy" ON "payment_methods"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_admin_policy" ON "payment_methods";
--> statement-breakpoint
CREATE POLICY "migrator_admin_policy" ON "payment_methods"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "payment_terminals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_terminals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "payment_terminals_policy" ON "payment_terminals";
--> statement-breakpoint
CREATE POLICY "payment_terminals_policy" ON "payment_terminals"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "migrator_admin_policy" ON "payment_terminals";
--> statement-breakpoint
CREATE POLICY "migrator_admin_policy" ON "payment_terminals"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- 6. Role Permissions & Table Ownership
ALTER TABLE "bank_account_branch_access" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "payment_methods" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "payment_terminals" OWNER TO rc_migrator;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_account_branch_access" TO rc_app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_methods" TO rc_app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_terminals" TO rc_app_user;
--> statement-breakpoint
GRANT ALL PRIVILEGES ON "bank_account_branch_access" TO rc_migrator;
--> statement-breakpoint
GRANT ALL PRIVILEGES ON "payment_methods" TO rc_migrator;
--> statement-breakpoint
GRANT ALL PRIVILEGES ON "payment_terminals" TO rc_migrator;
