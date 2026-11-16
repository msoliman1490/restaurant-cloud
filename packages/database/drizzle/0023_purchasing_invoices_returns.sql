-- Purchasing: Supplier Invoices & Purchase Returns (with RLS + rc_app_user grants)

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  goods_receipt_id uuid REFERENCES goods_receipts(id),
  invoice_number varchar(100) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  invoice_date timestamptz NOT NULL,
  due_date timestamptz NOT NULL,
  subtotal numeric(14, 4) NOT NULL,
  tax_amount numeric(14, 4) NOT NULL,
  grand_total numeric(14, 4) NOT NULL,
  paid_amount numeric(14, 4) NOT NULL DEFAULT '0.0000',
  currency varchar(3) NOT NULL DEFAULT 'SAR',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_tenant_id ON supplier_invoices (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_number ON supplier_invoices (tenant_id, supplier_id, invoice_number);

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invoices_tenant_isolation ON supplier_invoices;
CREATE POLICY supplier_invoices_tenant_isolation ON supplier_invoices
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_invoices TO rc_app_user;

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity numeric(14, 4) NOT NULL,
  unit_price numeric(14, 4) NOT NULL,
  tax_rate numeric(5, 4) NOT NULL DEFAULT '0.1500',
  line_total numeric(14, 4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_inv_lines_invoice_id ON supplier_invoice_lines (invoice_id);

ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invoice_lines_tenant_isolation ON supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_tenant_isolation ON supplier_invoice_lines
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_invoice_lines TO rc_app_user;

CREATE TABLE IF NOT EXISTS purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  goods_receipt_id uuid REFERENCES goods_receipts(id),
  return_number varchar(50) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  reason varchar(255) NOT NULL,
  returned_at timestamptz NOT NULL DEFAULT now(),
  returned_by uuid,
  total_amount numeric(14, 4) NOT NULL DEFAULT '0.0000'
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant_id ON purchase_returns (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_returns_entity_number ON purchase_returns (legal_entity_id, return_number);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_returns_tenant_isolation ON purchase_returns;
CREATE POLICY purchase_returns_tenant_isolation ON purchase_returns
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_returns TO rc_app_user;

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  return_id uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity numeric(14, 4) NOT NULL,
  unit_cost numeric(14, 4) NOT NULL,
  line_total numeric(14, 4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return_id ON purchase_return_lines (return_id);

ALTER TABLE purchase_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_return_lines_tenant_isolation ON purchase_return_lines;
CREATE POLICY purchase_return_lines_tenant_isolation ON purchase_return_lines
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_return_lines TO rc_app_user;

CREATE TABLE IF NOT EXISTS supplier_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  current_balance numeric(14, 4) NOT NULL DEFAULT '0.0000',
  total_invoiced numeric(14, 4) NOT NULL DEFAULT '0.0000',
  total_paid numeric(14, 4) NOT NULL DEFAULT '0.0000',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_balances_tenant_id ON supplier_balances (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_balances_entity_supplier ON supplier_balances (legal_entity_id, supplier_id);

ALTER TABLE supplier_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_balances_tenant_isolation ON supplier_balances;
CREATE POLICY supplier_balances_tenant_isolation ON supplier_balances
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_balances TO rc_app_user;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  invoice_id uuid REFERENCES supplier_invoices(id),
  payment_number varchar(50) NOT NULL,
  payment_date timestamptz NOT NULL DEFAULT now(),
  amount numeric(14, 4) NOT NULL,
  payment_method varchar(30) NOT NULL DEFAULT 'BANK_TRANSFER',
  reference_number varchar(100),
  notes text,
  journal_entry_id uuid,
  paid_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_id ON supplier_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON supplier_payments (supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_entity_number ON supplier_payments (legal_entity_id, payment_number);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payments_tenant_isolation ON supplier_payments;
CREATE POLICY supplier_payments_tenant_isolation ON supplier_payments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_payments TO rc_app_user;
