-- Dining & Kitchen Display System (KDS) Tickets
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL REFERENCES sales_orders(id),
  table_id uuid REFERENCES dining_tables(id),
  ticket_number varchar(50) NOT NULL,
  station varchar(40) NOT NULL DEFAULT 'MAIN_KITCHEN',
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  idempotency_key varchar(255),
  sent_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_tenant_branch ON kitchen_tickets (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_order_id ON kitchen_tickets (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_tickets_idempotency ON kitchen_tickets (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitchen_tickets_tenant_isolation ON kitchen_tickets;
CREATE POLICY kitchen_tickets_tenant_isolation ON kitchen_tickets
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON kitchen_tickets TO rc_app_user;
