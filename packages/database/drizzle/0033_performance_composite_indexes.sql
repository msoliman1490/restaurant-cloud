-- Performance & Composite Indexes Audit Migration (0033)
-- Preserves all RLS/FORCE RLS, Tenant Isolation, and Ledger Integrity.

-- 1. POS & Catalog Search
CREATE INDEX IF NOT EXISTS "idx_items_tenant_active_name"
  ON "items" ("tenant_id", "is_active", "name_ar");

-- 2. Sales Orders & Payments (Recent & Branch/Status Filtering)
CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant_created_desc"
  ON "sales_orders" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant_branch_status_created"
  ON "sales_orders" ("tenant_id", "branch_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payments_tenant_order"
  ON "payments" ("tenant_id", "order_id");

-- 3. Inventory FIFO Cost Layers & Movements
CREATE INDEX IF NOT EXISTS "idx_inv_cost_layers_fifo_active"
  ON "inventory_cost_layers" ("tenant_id", "warehouse_id", "item_id", "created_at" ASC)
  WHERE "quantity_remaining" > 0;
CREATE INDEX IF NOT EXISTS "idx_inv_movements_tenant_wh_item_occurred"
  ON "inventory_movements" ("tenant_id", "warehouse_id", "item_id", "occurred_at" DESC);

-- 4. Purchasing & Supplier Invoices
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_tenant_sup_status_date"
  ON "supplier_invoices" ("tenant_id", "supplier_id", "status", "invoice_date" DESC);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_tenant_sup_status_date"
  ON "purchase_orders" ("tenant_id", "supplier_id", "status", "order_date" DESC);

-- 5. Accounting & General Ledger
CREATE INDEX IF NOT EXISTS "idx_journal_entries_tenant_entity_date_desc"
  ON "journal_entries" ("tenant_id", "legal_entity_id", "entry_date" DESC);

-- 6. Delivery, Audit Logs & ZATCA Outbox
CREATE INDEX IF NOT EXISTS "idx_delivery_orders_tenant_status_created"
  ON "delivery_orders" ("tenant_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant_occurred_desc"
  ON "audit_logs" ("tenant_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_zatca_outbox_tenant_status_created"
  ON "zatca_outbox_queue" ("tenant_id", "status", "created_at" ASC);

-- 7. Business Partners & AP/AR Subledgers
CREATE INDEX IF NOT EXISTS "idx_bp_tenant_active_created_desc"
  ON "business_partners" ("tenant_id", "is_active", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_ap_invoices_tenant_partner_created"
  ON "ap_invoices" ("tenant_id", "partner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_ar_invoices_tenant_partner_created"
  ON "ar_invoices" ("tenant_id", "partner_id", "created_at" DESC);
