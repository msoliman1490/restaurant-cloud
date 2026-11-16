-- HR Extension: Employee Documents, Advances & Advance Transactions, Employee Custody
CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  document_type varchar(40) NOT NULL,
  document_number varchar(80),
  title varchar(160) NOT NULL,
  media_file_id uuid,
  file_url text NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size integer NOT NULL,
  issue_date date,
  expiry_date date,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE',
  notes text,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_tenant_employee ON employee_documents (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_tenant_expiry ON employee_documents (tenant_id, expiry_date);

CREATE TABLE IF NOT EXISTS employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  advance_number varchar(60) NOT NULL,
  principal_amount numeric(12,4) NOT NULL,
  recovered_amount numeric(12,4) NOT NULL DEFAULT 0.0000,
  remaining_amount numeric(12,4) NOT NULL,
  cash_vault_id uuid NOT NULL,
  advance_account_id uuid,
  disbursement_journal_entry_id uuid,
  reason text,
  status varchar(30) NOT NULL DEFAULT 'DISBURSED',
  disbursed_at timestamptz NOT NULL DEFAULT now(),
  disbursed_by uuid NOT NULL,
  idempotency_key varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_advances_tenant_number ON employee_advances (tenant_id, advance_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_advances_idempotency ON employee_advances (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_emp_advances_employee ON employee_advances (tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS employee_advance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  advance_id uuid NOT NULL REFERENCES employee_advances(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  transaction_type varchar(30) NOT NULL,
  amount numeric(12,4) NOT NULL,
  balance_after numeric(12,4) NOT NULL,
  cash_vault_id uuid,
  journal_entry_id uuid,
  idempotency_key varchar(255),
  notes text,
  performed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_adv_tx_idempotency ON employee_advance_transactions (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_emp_adv_tx_advance ON employee_advance_transactions (tenant_id, advance_id, created_at);

CREATE TABLE IF NOT EXISTS employee_custodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  custody_code varchar(60) NOT NULL,
  item_name varchar(180) NOT NULL,
  category varchar(40) NOT NULL DEFAULT 'DEVICE',
  serial_number varchar(120),
  estimated_value numeric(12,4) NOT NULL DEFAULT 0.0000,
  condition_on_handover varchar(30) NOT NULL DEFAULT 'GOOD',
  condition_on_return varchar(30),
  status varchar(30) NOT NULL DEFAULT 'HANDED_OVER',
  handed_over_at timestamptz NOT NULL DEFAULT now(),
  handed_over_by uuid NOT NULL,
  returned_at timestamptz,
  returned_to uuid,
  responsibility_accepted boolean NOT NULL DEFAULT true,
  idempotency_key varchar(255),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_custody_tenant_code ON employee_custodies (tenant_id, custody_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_custody_idempotency ON employee_custodies (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_emp_custody_employee_status ON employee_custodies (tenant_id, employee_id, status);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_documents_tenant_isolation ON employee_documents;
CREATE POLICY employee_documents_tenant_isolation ON employee_documents
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_advances_tenant_isolation ON employee_advances;
CREATE POLICY employee_advances_tenant_isolation ON employee_advances
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE employee_advance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_advance_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_advance_transactions_tenant_isolation ON employee_advance_transactions;
CREATE POLICY employee_advance_transactions_tenant_isolation ON employee_advance_transactions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE employee_custodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_custodies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_custodies_tenant_isolation ON employee_custodies;
CREATE POLICY employee_custodies_tenant_isolation ON employee_custodies
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_documents TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_advances TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_advance_transactions TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_custodies TO rc_app_user;
