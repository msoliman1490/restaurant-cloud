-- ====================================================================
-- Migration 0009: Phase 3.3 Account Mapping & Branch Overrides
-- Tables: account_mappings
-- Alter: branch_id (UUID references branches(id)), is_active, created_at
-- Indexes: Drop old single-entity unique index, create dual conditional unique indexes
-- Security: Existing Forced RLS maintained
-- ====================================================================

-- 1. Add branch_id, is_active, and created_at to account_mappings
ALTER TABLE "account_mappings" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint

-- 2. Index updates: Drop old unique index on (legal_entity_id, mapping_key)
DROP INDEX IF EXISTS "idx_account_mappings_entity_key";
--> statement-breakpoint

-- 3. Branch index for efficient lookup of overrides
CREATE INDEX IF NOT EXISTS "idx_account_mappings_branch_id" ON "account_mappings" ("branch_id");
--> statement-breakpoint

-- 4. Unique conditional index for Company-level defaults (branch_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_mappings_company_key" 
  ON "account_mappings" ("legal_entity_id", "mapping_key") 
  WHERE "branch_id" IS NULL;
--> statement-breakpoint

-- 5. Unique conditional index for Branch-level overrides (branch_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_mappings_branch_key" 
  ON "account_mappings" ("legal_entity_id", "branch_id", "mapping_key") 
  WHERE "branch_id" IS NOT NULL;
--> statement-breakpoint
