-- ====================================================================
-- Restaurant Cloud - Multi-Tenant RLS & Security Policies
-- ====================================================================

-- 1. Create or Configure Application Runtime Role (Non-Superuser, No BypassRLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
    CREATE ROLE rc_app_user WITH LOGIN PASSWORD 'rc_app_user_ci_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- 2. Grant Schema Usage and DML Privileges to Runtime Role
GRANT USAGE ON SCHEMA public TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rc_app_user;

-- 3. Strict Append-Only Enforcement for Audit Logs
-- A) Revoke UPDATE, DELETE, and TRUNCATE at permission level:
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM rc_app_user;

-- B) Database Trigger Level Protection (Defense-in-Depth):
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: Audit logs are strictly immutable and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON audit_logs;
CREATE TRIGGER trg_prevent_audit_log_modification
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

-- 4. Enable and Force Row Level Security on all Multi-Tenant Tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;

ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entities FORCE ROW LEVEL SECURITY;

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;

ALTER TABLE user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE offline_quota_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_quota_leases FORCE ROW LEVEL SECURITY;

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- 5. Define Permissive Policies with BOTH USING (read/delete) and WITH CHECK (insert/update)

-- Tenants Policy (Isolation by id)
DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
CREATE POLICY tenant_isolation_tenants ON tenants
  FOR ALL
  TO rc_app_user
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Groups Policy
DROP POLICY IF EXISTS tenant_isolation_groups ON groups;
CREATE POLICY tenant_isolation_groups ON groups
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Legal Entities Policy
DROP POLICY IF EXISTS tenant_isolation_legal_entities ON legal_entities;
CREATE POLICY tenant_isolation_legal_entities ON legal_entities
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Branches Policy
DROP POLICY IF EXISTS tenant_isolation_branches ON branches;
CREATE POLICY tenant_isolation_branches ON branches
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Warehouses Policy
DROP POLICY IF EXISTS tenant_isolation_warehouses ON warehouses;
CREATE POLICY tenant_isolation_warehouses ON warehouses
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Devices Policy
DROP POLICY IF EXISTS tenant_isolation_devices ON devices;
CREATE POLICY tenant_isolation_devices ON devices
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- User Memberships Policy
DROP POLICY IF EXISTS tenant_isolation_user_memberships ON user_memberships;
CREATE POLICY tenant_isolation_user_memberships ON user_memberships
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Sales Orders Policy
DROP POLICY IF EXISTS tenant_isolation_sales_orders ON sales_orders;
CREATE POLICY tenant_isolation_sales_orders ON sales_orders
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Payments Policy
DROP POLICY IF EXISTS tenant_isolation_payments ON payments;
CREATE POLICY tenant_isolation_payments ON payments
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- POS Shifts Policy
DROP POLICY IF EXISTS tenant_isolation_pos_shifts ON pos_shifts;
CREATE POLICY tenant_isolation_pos_shifts ON pos_shifts
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Journal Entries Policy
DROP POLICY IF EXISTS tenant_isolation_journal_entries ON journal_entries;
CREATE POLICY tenant_isolation_journal_entries ON journal_entries
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Inventory Balances Policy
DROP POLICY IF EXISTS tenant_isolation_inventory_balances ON inventory_balances;
CREATE POLICY tenant_isolation_inventory_balances ON inventory_balances
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Inventory Movements Policy
DROP POLICY IF EXISTS tenant_isolation_inventory_movements ON inventory_movements;
CREATE POLICY tenant_isolation_inventory_movements ON inventory_movements
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Offline Quota Leases Policy
DROP POLICY IF EXISTS tenant_isolation_offline_quota_leases ON offline_quota_leases;
CREATE POLICY tenant_isolation_offline_quota_leases ON offline_quota_leases
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Idempotency Keys Policy
DROP POLICY IF EXISTS tenant_isolation_idempotency_keys ON idempotency_keys;
CREATE POLICY tenant_isolation_idempotency_keys ON idempotency_keys
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Audit Logs Policy
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Enable and Force RLS on Phase 2 Catalog & Inventory Tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;

ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;

ALTER TABLE uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uom_conversions FORCE ROW LEVEL SECURITY;

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;

ALTER TABLE item_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_variants FORCE ROW LEVEL SECURITY;

ALTER TABLE branch_item_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_item_prices FORCE ROW LEVEL SECURITY;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_locations FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_adjustment_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_lines FORCE ROW LEVEL SECURITY;

-- 7. Define Policies for Catalog & Inventory Tables
DROP POLICY IF EXISTS tenant_isolation_categories ON categories;
CREATE POLICY tenant_isolation_categories ON categories
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_units_of_measure ON units_of_measure;
CREATE POLICY tenant_isolation_units_of_measure ON units_of_measure
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_uom_conversions ON uom_conversions;
CREATE POLICY tenant_isolation_uom_conversions ON uom_conversions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_items ON items;
CREATE POLICY tenant_isolation_items ON items
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_item_variants ON item_variants;
CREATE POLICY tenant_isolation_item_variants ON item_variants
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_branch_item_prices ON branch_item_prices;
CREATE POLICY tenant_isolation_branch_item_prices ON branch_item_prices
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_suppliers ON suppliers;
CREATE POLICY tenant_isolation_suppliers ON suppliers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_storage_locations ON storage_locations;
CREATE POLICY tenant_isolation_storage_locations ON storage_locations
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_stock_transfers ON stock_transfers;
CREATE POLICY tenant_isolation_stock_transfers ON stock_transfers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_stock_transfer_lines ON stock_transfer_lines;
CREATE POLICY tenant_isolation_stock_transfer_lines ON stock_transfer_lines
  FOR ALL TO rc_app_user
  USING (EXISTS (
    SELECT 1 FROM stock_transfers t
    WHERE t.id = stock_transfer_lines.transfer_id
    AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stock_transfers t
    WHERE t.id = stock_transfer_lines.transfer_id
    AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS tenant_isolation_stock_adjustments ON stock_adjustments;
CREATE POLICY tenant_isolation_stock_adjustments ON stock_adjustments
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_stock_adjustment_lines ON stock_adjustment_lines;
CREATE POLICY tenant_isolation_stock_adjustment_lines ON stock_adjustment_lines
  FOR ALL TO rc_app_user
  USING (EXISTS (
    SELECT 1 FROM stock_adjustments a
    WHERE a.id = stock_adjustment_lines.adjustment_id
    AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stock_adjustments a
    WHERE a.id = stock_adjustment_lines.adjustment_id
    AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  ));

-- ====================================================================
-- Phase 2/3 Extension Policies: Inventory Layers, Purchasing, Recipes, Dining
-- ====================================================================

-- Inventory Cost Layers
ALTER TABLE inventory_cost_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cost_layers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_inventory_cost_layers ON inventory_cost_layers;
CREATE POLICY tenant_isolation_inventory_cost_layers ON inventory_cost_layers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Purchasing Policies
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_purchase_requests ON purchase_requests;
CREATE POLICY tenant_isolation_purchase_requests ON purchase_requests
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_purchase_orders ON purchase_orders;
CREATE POLICY tenant_isolation_purchase_orders ON purchase_orders
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_goods_receipts ON goods_receipts;
CREATE POLICY tenant_isolation_goods_receipts ON goods_receipts
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_supplier_invoices ON supplier_invoices;
CREATE POLICY tenant_isolation_supplier_invoices ON supplier_invoices
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_purchase_returns ON purchase_returns;
CREATE POLICY tenant_isolation_purchase_returns ON purchase_returns
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE supplier_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_supplier_balances ON supplier_balances;
CREATE POLICY tenant_isolation_supplier_balances ON supplier_balances
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Recipes & Production Policies
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_recipes ON recipes;
CREATE POLICY tenant_isolation_recipes ON recipes
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE branch_recipe_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_recipe_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_branch_recipe_overrides ON branch_recipe_overrides;
CREATE POLICY tenant_isolation_branch_recipe_overrides ON branch_recipe_overrides
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_production_batches ON production_batches;
CREATE POLICY tenant_isolation_production_batches ON production_batches
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE waste_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_waste_records ON waste_records;
CREATE POLICY tenant_isolation_waste_records ON waste_records
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Dining & POS Operations Policies
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_dining_tables ON dining_tables;
CREATE POLICY tenant_isolation_dining_tables ON dining_tables
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_table_sessions ON table_sessions;
CREATE POLICY tenant_isolation_table_sessions ON table_sessions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE order_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_voids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_order_voids ON order_voids;
CREATE POLICY tenant_isolation_order_voids ON order_voids
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Shift Cash Transactions Policy
ALTER TABLE shift_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_cash_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_shift_cash_transactions ON shift_cash_transactions;
CREATE POLICY tenant_isolation_shift_cash_transactions ON shift_cash_transactions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Supplier Payments Policy
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_supplier_payments ON supplier_payments;
CREATE POLICY tenant_isolation_supplier_payments ON supplier_payments
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Fiscal Periods Policy
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fiscal_periods ON fiscal_periods;
CREATE POLICY tenant_isolation_fiscal_periods ON fiscal_periods
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Multi-Industry SaaS & Subscription Entitlements Policies
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_subscriptions ON tenant_subscriptions;
CREATE POLICY tenant_isolation_tenant_subscriptions ON tenant_subscriptions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE tenant_industry_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_industry_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_industry_packs ON tenant_industry_packs;
CREATE POLICY tenant_isolation_tenant_industry_packs ON tenant_industry_packs
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ====================================================================
-- Phase 3.1: Financial Resources & Accounting Isolation Policies
-- ====================================================================

-- 1. Cash Vaults Policy
ALTER TABLE cash_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_vaults FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cash_vaults ON cash_vaults;
CREATE POLICY tenant_isolation_cash_vaults ON cash_vaults
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 2. Bank Accounts Policy
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_bank_accounts ON bank_accounts;
CREATE POLICY tenant_isolation_bank_accounts ON bank_accounts
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 3. Account Mappings Policy
ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_account_mappings ON account_mappings;
CREATE POLICY tenant_isolation_account_mappings ON account_mappings
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 4. Cost Centers Policy
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cost_centers ON cost_centers;
CREATE POLICY tenant_isolation_cost_centers ON cost_centers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 5. Payment Vouchers Policy
ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_vouchers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payment_vouchers ON payment_vouchers;
CREATE POLICY tenant_isolation_payment_vouchers ON payment_vouchers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Receipt Vouchers Policy
ALTER TABLE receipt_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_vouchers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_receipt_vouchers ON receipt_vouchers;
CREATE POLICY tenant_isolation_receipt_vouchers ON receipt_vouchers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 7. Expenses Policy
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_expenses ON expenses;
CREATE POLICY tenant_isolation_expenses ON expenses
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 8. Vault Transactions Policy
ALTER TABLE vault_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_vault_transactions ON vault_transactions;
CREATE POLICY tenant_isolation_vault_transactions ON vault_transactions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 9. Bank Reconciliations Policy
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_bank_reconciliations ON bank_reconciliations;
CREATE POLICY tenant_isolation_bank_reconciliations ON bank_reconciliations
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 10. Settlements Engine Policies (Phase 3.4C)
ALTER TABLE settlement_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_settlement_providers ON settlement_providers;
CREATE POLICY tenant_isolation_settlement_providers ON settlement_providers
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE settlement_import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_import_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_settlement_import_files ON settlement_import_files;
CREATE POLICY tenant_isolation_settlement_import_files ON settlement_import_files
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_settlement_batches ON settlement_batches;
CREATE POLICY tenant_isolation_settlement_batches ON settlement_batches
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE settlement_batch_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_batch_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_settlement_batch_lines ON settlement_batch_lines;
CREATE POLICY tenant_isolation_settlement_batch_lines ON settlement_batch_lines
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE settlement_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_discrepancies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_settlement_discrepancies ON settlement_discrepancies;
CREATE POLICY tenant_isolation_settlement_discrepancies ON settlement_discrepancies
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE bank_settlement_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_settlement_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_bank_settlement_transactions ON bank_settlement_transactions;
CREATE POLICY tenant_isolation_bank_settlement_transactions ON bank_settlement_transactions
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 11. Inter-Branch Transfer Discrepancies Policy (Phase 3.4D)
ALTER TABLE stock_transfer_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_discrepancies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_stock_transfer_discrepancies ON stock_transfer_discrepancies;
CREATE POLICY tenant_isolation_stock_transfer_discrepancies ON stock_transfer_discrepancies
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 12. Financial Reconciliation Policies (Phase 3.5)
ALTER TABLE financial_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_reconciliation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_financial_reconciliation_runs ON financial_reconciliation_runs;
CREATE POLICY tenant_isolation_financial_reconciliation_runs ON financial_reconciliation_runs
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE financial_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_reconciliation_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_financial_reconciliation_items ON financial_reconciliation_items;
CREATE POLICY tenant_isolation_financial_reconciliation_items ON financial_reconciliation_items
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 13. Financial Period Closing Policies (Phase 3.6)
ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fiscal_years ON fiscal_years;
CREATE POLICY tenant_isolation_fiscal_years ON fiscal_years
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE fiscal_period_closing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_period_closing_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fiscal_period_closing_logs ON fiscal_period_closing_logs;
CREATE POLICY tenant_isolation_fiscal_period_closing_logs ON fiscal_period_closing_logs
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);




