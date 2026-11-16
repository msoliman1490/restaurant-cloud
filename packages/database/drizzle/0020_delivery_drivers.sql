-- Delivery & Drivers Module (Zones, Drivers, Dispatch Lifecycle, COD Settlements)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  code varchar(50) NOT NULL,
  name_ar varchar(150) NOT NULL,
  name_en varchar(150),
  delivery_fee numeric(12,4) NOT NULL DEFAULT 0.0000,
  min_order_amount numeric(12,4) NOT NULL DEFAULT 0.0000,
  estimated_minutes integer NOT NULL DEFAULT 45,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_tenant ON delivery_zones (tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_branch ON delivery_zones (tenant_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_zones_branch_code ON delivery_zones (tenant_id, branch_id, code);

CREATE TABLE IF NOT EXISTS delivery_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  employee_id uuid REFERENCES employees(id),
  driver_code varchar(50) NOT NULL,
  full_name_ar varchar(200) NOT NULL,
  full_name_en varchar(200),
  phone varchar(50) NOT NULL,
  vehicle_type varchar(30) NOT NULL DEFAULT 'MOTORBIKE',
  plate_number varchar(50),
  availability_status varchar(30) NOT NULL DEFAULT 'AVAILABLE',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_drivers_tenant ON delivery_drivers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_drivers_branch_status ON delivery_drivers (tenant_id, branch_id, availability_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_drivers_tenant_code ON delivery_drivers (tenant_id, driver_code);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id),
  zone_id uuid REFERENCES delivery_zones(id),
  driver_id uuid REFERENCES delivery_drivers(id),
  channel varchar(30) NOT NULL DEFAULT 'IN_HOUSE',
  aggregator_name varchar(80),
  external_reference varchar(120),
  customer_name varchar(150) NOT NULL,
  customer_phone varchar(50) NOT NULL,
  delivery_address text NOT NULL,
  delivery_fee numeric(12,4) NOT NULL DEFAULT 0.0000,
  cod_amount numeric(12,4) NOT NULL DEFAULT 0.0000,
  cod_collected boolean NOT NULL DEFAULT false,
  cod_settled boolean NOT NULL DEFAULT false,
  settlement_id uuid,
  status varchar(30) NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_tenant ON delivery_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_branch_status ON delivery_orders (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_driver ON delivery_orders (tenant_id, driver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_orders_sales_order ON delivery_orders (tenant_id, sales_order_id);

CREATE TABLE IF NOT EXISTS delivery_driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  driver_id uuid NOT NULL REFERENCES delivery_drivers(id),
  cash_vault_id uuid NOT NULL REFERENCES cash_vaults(id),
  settlement_number varchar(60) NOT NULL,
  expected_cod_amount numeric(12,4) NOT NULL,
  settled_amount numeric(12,4) NOT NULL,
  variance_amount numeric(12,4) NOT NULL DEFAULT 0.0000,
  journal_entry_id uuid,
  idempotency_key varchar(255),
  settled_by uuid NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_settlements_tenant ON delivery_driver_settlements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_settlements_driver ON delivery_driver_settlements (tenant_id, driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_settlements_idempotency ON delivery_driver_settlements (tenant_id, idempotency_key);

ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_zones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_zones_tenant_isolation ON delivery_zones;
CREATE POLICY delivery_zones_tenant_isolation ON delivery_zones
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE delivery_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_drivers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_drivers_tenant_isolation ON delivery_drivers;
CREATE POLICY delivery_drivers_tenant_isolation ON delivery_drivers
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_orders_tenant_isolation ON delivery_orders;
CREATE POLICY delivery_orders_tenant_isolation ON delivery_orders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE delivery_driver_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_driver_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_driver_settlements_tenant_isolation ON delivery_driver_settlements;
CREATE POLICY delivery_driver_settlements_tenant_isolation ON delivery_driver_settlements
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_zones TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_drivers TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_orders TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_driver_settlements TO rc_app_user;
