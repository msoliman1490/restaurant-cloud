-- 0028_performance_indexes.sql
-- Verified performance indexes from EXPLAIN ANALYZE on high-volume tables
-- plus stock_transfers dispatch/receive idempotency unique indexes.

-- 1. sales_orders
CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant_shift"
  ON "sales_orders" ("tenant_id", "shift_id")
  WHERE "shift_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant_status_created"
  ON "sales_orders" ("tenant_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant_idempotency"
  ON "sales_orders" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 2. payments
CREATE INDEX IF NOT EXISTS "idx_payments_tenant_settlement"
  ON "payments" ("tenant_id", "settlement_status", "payment_method");

CREATE INDEX IF NOT EXISTS "idx_payments_tenant_status_confirmed"
  ON "payments" ("tenant_id", "status", "confirmed_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_payments_tenant_idempotency"
  ON "payments" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 3. journal_entries
CREATE INDEX IF NOT EXISTS "idx_journal_entries_tenant_source"
  ON "journal_entries" ("tenant_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_journal_entries_tenant_branch_date"
  ON "journal_entries" ("tenant_id", "branch_id", "entry_date" DESC)
  WHERE "branch_id" IS NOT NULL;

-- 4. journal_lines
CREATE INDEX IF NOT EXISTS "idx_journal_lines_account_branch"
  ON "journal_lines" ("account_id", "branch_id");

CREATE INDEX IF NOT EXISTS "idx_journal_lines_subledger"
  ON "journal_lines" ("subledger_document_type", "subledger_document_id")
  WHERE "subledger_document_id" IS NOT NULL;

-- 5. inventory_movements
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_tenant_source"
  ON "inventory_movements" ("tenant_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_inventory_movements_tenant_item_time"
  ON "inventory_movements" ("tenant_id", "item_id", "occurred_at" DESC);

-- 6. ar_invoices
CREATE INDEX IF NOT EXISTS "idx_ar_invoices_tenant_status_due"
  ON "ar_invoices" ("tenant_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "idx_ar_invoices_tenant_partner_status"
  ON "ar_invoices" ("tenant_id", "partner_id", "status");

-- 7. ap_invoices
CREATE INDEX IF NOT EXISTS "idx_ap_invoices_tenant_status_due"
  ON "ap_invoices" ("tenant_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "idx_ap_invoices_tenant_po"
  ON "ap_invoices" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;

-- 8. goods_receipts
CREATE INDEX IF NOT EXISTS "idx_goods_receipts_tenant_po"
  ON "goods_receipts" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_goods_receipts_tenant_status_received"
  ON "goods_receipts" ("tenant_id", "status", "received_at" DESC);

-- 9. supplier_invoices
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_tenant_status_due"
  ON "supplier_invoices" ("tenant_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_tenant_po"
  ON "supplier_invoices" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;

-- 10. membership_scopes
CREATE INDEX IF NOT EXISTS "idx_membership_scopes_scope_lookup"
  ON "membership_scopes" ("scope_type", "scope_id", "membership_id");

-- 11. notification_logs
CREATE INDEX IF NOT EXISTS "idx_notification_logs_tenant_status_created"
  ON "notification_logs" ("tenant_id", "status", "created_at" DESC);

-- 12. stock_transfers dispatch/receive idempotency
CREATE UNIQUE INDEX IF NOT EXISTS "idx_transfers_dispatch_idempotency"
  ON "stock_transfers" ("tenant_id", "dispatch_idempotency_key")
  WHERE "dispatch_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_transfers_receive_idempotency"
  ON "stock_transfers" ("tenant_id", "receive_idempotency_key")
  WHERE "receive_idempotency_key" IS NOT NULL;
