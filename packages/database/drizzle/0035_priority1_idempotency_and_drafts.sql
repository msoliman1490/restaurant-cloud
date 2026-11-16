-- Priority 1: DB-Level Idempotency Keys & Partial Unique Constraints
-- Covers Purchasing, Returns, Supplier Payments, and Inventory Adjustments.

ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "goods_receipts" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "supplier_invoices" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "stock_adjustments" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchase_requests_tenant_idemp"
  ON "purchase_requests" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchase_orders_tenant_idemp"
  ON "purchase_orders" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_goods_receipts_tenant_idemp"
  ON "goods_receipts" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_supplier_invoices_tenant_idemp"
  ON "supplier_invoices" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchase_returns_tenant_idemp"
  ON "purchase_returns" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_supplier_payments_tenant_idemp"
  ON "supplier_payments" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_adjustments_tenant_idemp"
  ON "stock_adjustments" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
