-- Financial Integrity & Transaction Safety Migration (0034)
-- 1. Optimistic Locking (version) for Draftable Financial & Operational Documents
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "supplier_invoices" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);

-- 2. Partial Unique Indexes for Idempotency Keys (Concurrent Double-Submission Guard)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sales_orders_tenant_idemp"
  ON "sales_orders" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_tenant_idemp"
  ON "payments" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_journal_entries_tenant_idemp"
  ON "journal_entries" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
