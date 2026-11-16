-- ====================================================================
-- Migration 0013: POS Shifts Closing Metadata & Cash Breakdown
-- Table: pos_shifts
-- ====================================================================

ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "cash_vault_id" uuid;
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "total_cash_receipts" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "total_cash_refunds" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "total_cash_change" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "total_cash_in" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "total_cash_out" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pos_shifts_idempotency" ON "pos_shifts" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
