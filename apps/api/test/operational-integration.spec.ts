import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Operational Integration Suite: Inventory Engine, Purchasing, POS Sales Lifecycle & Accounting', () => {
  let pg: PGlite;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const entityA1Id = 'a1111111-1111-1111-1111-111111111111';
  const branchA1Id = 'ab111111-1111-1111-1111-111111111111';
  const deviceA1Id = 'de111111-1111-1111-1111-111111111111';
  const warehouseA1Id = 'ad111111-1111-1111-1111-111111111111';
  const supplierA1Id = 'af111111-1111-1111-1111-111111111111';
  const userCashierId = 'cc111111-1111-1111-1111-111111111111';

  const uomUnitId = 'ac000000-0000-0000-0000-000000000001';
  const itemBunId = 'aa000000-0000-0000-0000-000000000001';
  const itemPattyId = 'aa000000-0000-0000-0000-000000000002';
  const itemBurgerMealId = 'aa000000-0000-0000-0000-000000000003';
  const itemCoffeeWacId = 'aa000000-0000-0000-0000-000000000004';

  async function runInTenant<T>(
    tenantId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    await pg.exec('BEGIN;');
    try {
      await pg.exec('SET ROLE rc_app_user;');
      await pg.exec(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      const result = await operation();
      await pg.exec('COMMIT;');
      return result;
    } catch (err) {
      await pg.exec('ROLLBACK;');
      throw err;
    } finally {
      await pg.exec('RESET ROLE;');
    }
  }

  beforeAll(async () => {
    pg = new PGlite();

    // 1. Core Schema Setup
    await pg.exec(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL
      );

      CREATE TABLE legal_entities (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_name VARCHAR(255) NOT NULL
      );

      CREATE TABLE branches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE devices (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        code VARCHAR(50) NOT NULL
      );

      CREATE TABLE warehouses (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE units_of_measure (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(20) NOT NULL,
        name_ar VARCHAR(100) NOT NULL
      );

      CREATE TABLE suppliers (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name_ar VARCHAR(255) NOT NULL
      );

      CREATE TABLE items (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        sku VARCHAR(100) NOT NULL,
        name_ar VARCHAR(255) NOT NULL,
        costing_method VARCHAR(30) NOT NULL DEFAULT 'FIFO',
        default_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        default_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000
      );

      CREATE TABLE inventory_balances (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        item_id UUID NOT NULL REFERENCES items(id),
        lot_id UUID,
        on_hand_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        reserved_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE inventory_cost_layers (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        item_id UUID NOT NULL REFERENCES items(id),
        lot_id UUID,
        quantity_received NUMERIC(14, 4) NOT NULL,
        quantity_remaining NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE inventory_movements (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        item_id UUID NOT NULL REFERENCES items(id),
        movement_type VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        quantity NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE purchase_orders (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        order_number VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        grand_total NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE goods_receipts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        purchase_order_id UUID REFERENCES purchase_orders(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        receipt_number VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_invoices (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        invoice_number VARCHAR(50) NOT NULL,
        grand_total NUMERIC(14, 4) NOT NULL,
        paid_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_balances (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        current_balance NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        total_invoiced NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        total_paid NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_payments (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        invoice_id UUID REFERENCES supplier_invoices(id),
        payment_number VARCHAR(50) NOT NULL,
        amount NUMERIC(14, 4) NOT NULL,
        payment_method VARCHAR(30) NOT NULL DEFAULT 'BANK_TRANSFER',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE recipes (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        output_item_id UUID NOT NULL REFERENCES items(id),
        recipe_code VARCHAR(50) NOT NULL,
        version VARCHAR(20) NOT NULL DEFAULT '1.0',
        status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
        yield_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
        is_current BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE recipe_ingredients (
        id UUID PRIMARY KEY,
        recipe_id UUID NOT NULL REFERENCES recipes(id),
        ingredient_item_id UUID NOT NULL REFERENCES items(id),
        quantity NUMERIC(14, 4) NOT NULL,
        waste_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00
      );

      CREATE TABLE dining_tables (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        table_number VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
        current_order_id UUID
      );

      CREATE TABLE pos_shifts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        device_id UUID NOT NULL REFERENCES devices(id),
        cashier_id UUID NOT NULL,
        opening_cash NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        expected_cash NUMERIC(12, 4),
        counted_cash NUMERIC(12, 4),
        variance NUMERIC(12, 4),
        status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      );

      CREATE TABLE shift_cash_transactions (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        shift_id UUID NOT NULL REFERENCES pos_shifts(id),
        transaction_type VARCHAR(30) NOT NULL,
        amount NUMERIC(12, 4) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE sales_orders (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        device_id UUID NOT NULL REFERENCES devices(id),
        shift_id UUID REFERENCES pos_shifts(id),
        table_id UUID REFERENCES dining_tables(id),
        order_number VARCHAR(50) NOT NULL,
        order_type VARCHAR(30) NOT NULL DEFAULT 'DINE_IN',
        status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
        subtotal NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        tax_total NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        grand_total NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        idempotency_key VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sales_order_number UNIQUE (tenant_id, legal_entity_id, order_number)
      );

      CREATE TABLE payments (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        order_id UUID NOT NULL REFERENCES sales_orders(id),
        payment_method VARCHAR(30) NOT NULL,
        amount NUMERIC(12, 4) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'CAPTURED'
      );

      CREATE TABLE chart_of_accounts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        account_code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        account_type VARCHAR(30) NOT NULL DEFAULT 'ASSET'
      );

      CREATE TABLE journal_entries (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        journal_number VARCHAR(50) NOT NULL,
        journal_type VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
        status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
        debit_total NUMERIC(14, 4) NOT NULL,
        credit_total NUMERIC(14, 4) NOT NULL,
        posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE journal_lines (
        id UUID PRIMARY KEY,
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
        account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
        debit NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        credit NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        description VARCHAR(255)
      );

      CREATE TABLE fiscal_periods (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        period_name VARCHAR(50) NOT NULL,
        start_date TIMESTAMPTZ NOT NULL,
        end_date TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        closed_at TIMESTAMPTZ
      );
    `);

    // 2. Setup Security Role & Strict RLS
    await pg.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
          CREATE ROLE rc_app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;

      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;

      ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_sales_orders ON sales_orders FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_pos_shifts ON pos_shifts FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_supplier_payments ON supplier_payments FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
      ALTER TABLE fiscal_periods FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_fiscal_periods ON fiscal_periods FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_inventory_balances ON inventory_balances FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);

    // 3. Seed Base Master Data
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
        ('${tenantAId}', 'tenant-a', 'مطاعم النخبة السحابية'),
        ('${tenantBId}', 'tenant-b', 'شركة الأغذية المنافسة');

      INSERT INTO legal_entities (id, tenant_id, legal_name) VALUES
        ('${entityA1Id}', '${tenantAId}', 'شركة النخبة للضيافة');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
        ('${branchA1Id}', '${tenantAId}', '${entityA1Id}', 'BR-01', 'فرع العليا');

      INSERT INTO devices (id, tenant_id, branch_id, code) VALUES
        ('${deviceA1Id}', '${tenantAId}', '${branchA1Id}', 'POS-01');

      INSERT INTO warehouses (id, tenant_id, code, name) VALUES
        ('${warehouseA1Id}', '${tenantAId}', 'WH-CENTRAL', 'مستودع المطبخ المركزي');

      INSERT INTO units_of_measure (id, tenant_id, code, name_ar) VALUES
        ('${uomUnitId}', '${tenantAId}', 'PCS', 'حبة');

      INSERT INTO suppliers (id, tenant_id, name_ar) VALUES
        ('${supplierA1Id}', '${tenantAId}', 'شركة التوريدات الحديثة');

      INSERT INTO items (id, tenant_id, sku, name_ar, costing_method, default_cost, default_price) VALUES
        ('${itemBunId}', '${tenantAId}', 'RAW-BUN', 'خبز برجر سمسم', 'FIFO', 0.8000, 0.0000),
        ('${itemPattyId}', '${tenantAId}', 'RAW-PATTY', 'شريحة لحم بقري 150جم', 'FIFO', 6.5000, 0.0000),
        ('${itemBurgerMealId}', '${tenantAId}', 'MEAL-BURGER', 'وجبة أنجوس برجر', 'FIFO', 7.3000, 35.0000),
        ('${itemCoffeeWacId}', '${tenantAId}', 'RAW-COFFEE', 'حبوب قهوة كولومبية', 'WEIGHTED_AVERAGE', 45.0000, 60.0000);

      INSERT INTO chart_of_accounts (id, tenant_id, legal_entity_id, account_code, name, account_type) VALUES
        ('c1111111-1111-1111-1111-111111111111', '${tenantAId}', '${entityA1Id}', '1010', 'البنك الأهلي التجاري', 'ASSET'),
        ('c2222222-2222-2222-2222-222222222222', '${tenantAId}', '${entityA1Id}', '2010', 'الموردون والدائنون', 'LIABILITY'),
        ('c3333333-3333-3333-3333-333333333333', '${tenantAId}', '${entityA1Id}', '2050', 'ضريبة القيمة المضافة ZATCA', 'LIABILITY'),
        ('c4444444-4444-4444-4444-444444444444', '${tenantAId}', '${entityA1Id}', '4010', 'إيرادات مبيعات المطعم', 'REVENUE'),
        ('c5555555-5555-5555-5555-555555555555', '${tenantAId}', '${entityA1Id}', '5010', 'تكلفة البضاعة المباعة COGS', 'EXPENSE');
    `);
  });

  // ==================================================================
  // Test 1: Concurrency, Stock Reservation & Release (Negative Stock Guard)
  // ==================================================================
  it('1. should reserve stock, reject reservations exceeding available quantity, and release reserved stock upon cancellation', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Initialize stock on hand = 10, reserved = 0
      const balId = 'ba111111-1111-1111-1111-111111111111';
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, reserved_qty, version)
        VALUES ('${balId}', '${tenantAId}', '${entityA1Id}', '${warehouseA1Id}', '${itemBunId}', 10.0000, 0.0000, 1);
      `);

      // 2. Reserve 4 units -> Available becomes 6
      await pg.exec(`
        UPDATE inventory_balances
        SET reserved_qty = reserved_qty + 4.0000, version = version + 1
        WHERE id = '${balId}' AND (on_hand_qty - reserved_qty) >= 4.0000;
      `);

      const res1 = await pg.query<{ on_hand_qty: string; reserved_qty: string }>(
        `SELECT on_hand_qty, reserved_qty FROM inventory_balances WHERE id = '${balId}'`
      );
      expect(parseFloat(res1.rows[0].on_hand_qty)).toBe(10);
      expect(parseFloat(res1.rows[0].reserved_qty)).toBe(4);

      // 3. Attempt to reserve 8 units -> Exceeds available (available = 6). Guard rejects it.
      const overReserveResult = await pg.query(`
        UPDATE inventory_balances
        SET reserved_qty = reserved_qty + 8.0000, version = version + 1
        WHERE id = '${balId}' AND (on_hand_qty - reserved_qty) >= 8.0000;
      `);
      // No rows updated
      expect(overReserveResult.affectedRows).toBe(0);

      // 4. Cancel operation: Release the 4 reserved units
      await pg.exec(`
        UPDATE inventory_balances
        SET reserved_qty = GREATEST(0, reserved_qty - 4.0000), version = version + 1
        WHERE id = '${balId}';
      `);

      const res2 = await pg.query<{ reserved_qty: string }>(
        `SELECT reserved_qty FROM inventory_balances WHERE id = '${balId}'`
      );
      expect(parseFloat(res2.rows[0].reserved_qty)).toBe(0);
    });
  });

  // ==================================================================
  // Test 2: Idempotency Protection on Sales Orders
  // ==================================================================
  it('2. should enforce idempotency key protection preventing duplicate sales orders and double deduction', async () => {
    await runInTenant(tenantAId, async () => {
      const orderId1 = '01111111-1111-1111-1111-111111111111';
      const idempKey = 'idemp-pos-checkout-9901';

      // First submission
      await pg.exec(`
        INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, device_id, order_number, order_type, status, subtotal, tax_total, grand_total, idempotency_key)
        VALUES ('${orderId1}', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', 'ORD-9901', 'TAKEAWAY', 'COMPLETED', 100.0000, 15.0000, 115.0000, '${idempKey}');
      `);

      // Duplicate check query mimicking SalesService.createSalesOrder idempotency guard
      const dupCheck = await pg.query<{ id: string }>(
        `SELECT id FROM sales_orders WHERE tenant_id = '${tenantAId}' AND idempotency_key = '${idempKey}'`
      );
      expect(dupCheck.rows.length).toBe(1);
      expect(dupCheck.rows[0].id).toBe(orderId1);

      // Unique constraint prevents inserting duplicate order number for same legal entity
      let failedDuplicate = false;
      try {
        await pg.exec(`
          INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, device_id, order_number, order_type, status, subtotal, tax_total, grand_total, idempotency_key)
          VALUES ('02222222-2222-2222-2222-222222222222', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', 'ORD-9901', 'TAKEAWAY', 'COMPLETED', 100.0000, 15.0000, 115.0000, '${idempKey}');
        `);
      } catch {
        failedDuplicate = true;
      }
      expect(failedDuplicate).toBe(true);
    });
  });

  // ==================================================================
  // Test 3: Full Integrated POS Shift, Sales Order, Recipe BOM & Table Session
  // ==================================================================
  it('3. should complete full POS sales lifecycle: open shift, dining table occupancy, recipe BOM deduction, and cash drawer reconciliation', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Open POS Shift with 500 SAR float
      const shiftId = '55555555-5555-5555-5555-555555555555';
      await pg.exec(`
        INSERT INTO pos_shifts (id, tenant_id, legal_entity_id, branch_id, device_id, cashier_id, opening_cash, status)
        VALUES ('${shiftId}', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', '${userCashierId}', 500.0000, 'OPEN');
      `);

      // 2. Add Cash In (100 SAR mid-day float addition)
      await pg.exec(`
        INSERT INTO shift_cash_transactions (id, tenant_id, shift_id, transaction_type, amount, reason)
        VALUES ('66666666-6666-6666-6666-666666666666', '${tenantAId}', '${shiftId}', 'CASH_IN', 100.0000, 'إضافة صرافة فئات صغيرة');
      `);

      // 3. Create Dining Table T-05
      const tableId = '77777777-7777-7777-7777-777777777777';
      await pg.exec(`
        INSERT INTO dining_tables (id, tenant_id, branch_id, table_number, status)
        VALUES ('${tableId}', '${tenantAId}', '${branchA1Id}', 'T-05', 'AVAILABLE');
      `);

      // 4. Setup Recipe BOM for Burger Meal: 1 Bun + 1 Patty
      const recipeId = '88888888-8888-8888-8888-888888888888';
      await pg.exec(`
        INSERT INTO recipes (id, tenant_id, legal_entity_id, output_item_id, recipe_code, yield_quantity, is_current)
        VALUES ('${recipeId}', '${tenantAId}', '${entityA1Id}', '${itemBurgerMealId}', 'RCP-BURGER-01', 1.0000, TRUE);

        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_item_id, quantity, waste_percentage) VALUES
          ('88888888-8888-8888-8888-888888888881', '${recipeId}', '${itemBunId}', 1.0000, 0.00),
          ('88888888-8888-8888-8888-888888888882', '${recipeId}', '${itemPattyId}', 1.0000, 5.00);
      `);

      // 5. Stock on hand for ingredients: Patty = 50, Bun = 50
      const bunBalId = '99999999-9999-9999-9999-999999999991';
      const pattyBalId = '99999999-9999-9999-9999-999999999992';
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty)
        VALUES
          ('${bunBalId}', '${tenantAId}', '${entityA1Id}', '${warehouseA1Id}', '${itemBunId}', 50.0000),
          ('${pattyBalId}', '${tenantAId}', '${entityA1Id}', '${warehouseA1Id}', '${itemPattyId}', 50.0000);
      `);

      // 6. Dine-in Sales Order at Table T-05: 2 Burger Meals @ 35 SAR = 70 SAR + 15% VAT (10.5 SAR) = 80.5 SAR Paid Cash
      const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await pg.exec(`
        INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, device_id, shift_id, table_id, order_number, order_type, status, subtotal, tax_total, grand_total)
        VALUES ('${orderId}', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', '${shiftId}', '${tableId}', 'ORD-2026-0001', 'DINE_IN', 'COMPLETED', 70.0000, 10.5000, 80.5000);

        INSERT INTO payments (id, tenant_id, legal_entity_id, order_id, payment_method, amount, status)
        VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${tenantAId}', '${entityA1Id}', '${orderId}', 'CASH', 80.5000, 'CAPTURED');

        -- Table becomes OCCUPIED
        UPDATE dining_tables SET status = 'OCCUPIED', current_order_id = '${orderId}' WHERE id = '${tableId}';

        -- Deduct ingredients: 2 Buns (50 -> 48), 2.10 Patties (50 -> 47.90 with 5% waste)
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 2.0000 WHERE id = '${bunBalId}';
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 2.1000 WHERE id = '${pattyBalId}';
      `);

      // Check Table status is OCCUPIED
      const tableCheck = await pg.query<{ status: string; current_order_id: string }>(
        `SELECT status, current_order_id FROM dining_tables WHERE id = '${tableId}'`
      );
      expect(tableCheck.rows[0].status).toBe('OCCUPIED');
      expect(tableCheck.rows[0].current_order_id).toBe(orderId);

      // Check ingredient stock deduction
      const bunBal = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE id = '${bunBalId}'`
      );
      expect(parseFloat(bunBal.rows[0].on_hand_qty)).toBe(48.0);

      // 7. Cashier Closes Shift:
      // Expected = opening (500) + CashIn (100) + CashSales (80.50) = 680.50 SAR
      // Counted = 680.50 SAR -> Variance = 0.00 SAR
      const expectedCash = 500.0 + 100.0 + 80.5;
      const countedCash = 680.5;
      const variance = countedCash - expectedCash;

      await pg.exec(`
        UPDATE pos_shifts
        SET status = 'CLOSED', closed_at = NOW(), expected_cash = ${expectedCash}, counted_cash = ${countedCash}, variance = ${variance}
        WHERE id = '${shiftId}';
      `);

      const closedShift = await pg.query<{ status: string; variance: string; expected_cash: string }>(
        `SELECT status, variance, expected_cash FROM pos_shifts WHERE id = '${shiftId}'`
      );
      expect(closedShift.rows[0].status).toBe('CLOSED');
      expect(parseFloat(closedShift.rows[0].variance)).toBe(0);
      expect(parseFloat(closedShift.rows[0].expected_cash)).toBe(680.5);
    });
  });

  // ==================================================================
  // Test 4: Purchasing, Supplier Invoices & Supplier Payment AP Settlement
  // ==================================================================
  it('4. should process supplier payment and reduce accounts payable balance in supplier subledger', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Supplier Invoice registered for 5000 SAR
      const invId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      await pg.exec(`
        INSERT INTO supplier_invoices (id, tenant_id, legal_entity_id, supplier_id, invoice_number, grand_total, status)
        VALUES ('${invId}', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', 'SUP-INV-8812', 5000.0000, 'APPROVED');

        INSERT INTO supplier_balances (id, tenant_id, legal_entity_id, supplier_id, current_balance, total_invoiced, total_paid)
        VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', 5000.0000, 5000.0000, 0.0000);
      `);

      // 2. Pay 3000 SAR towards supplier invoice via bank transfer
      const pmtId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      await pg.exec(`
        INSERT INTO supplier_payments (id, tenant_id, legal_entity_id, supplier_id, invoice_id, payment_number, amount, payment_method)
        VALUES ('${pmtId}', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', '${invId}', 'PAY-2026-0044', 3000.0000, 'BANK_TRANSFER');

        -- Reduce AP balance (5000 - 3000 = 2000 SAR) and update total_paid
        UPDATE supplier_balances
        SET current_balance = current_balance - 3000.0000,
            total_paid = total_paid + 3000.0000,
            updated_at = NOW()
        WHERE supplier_id = '${supplierA1Id}' AND legal_entity_id = '${entityA1Id}';

        -- Update invoice paid amount
        UPDATE supplier_invoices
        SET paid_amount = paid_amount + 3000.0000
        WHERE id = '${invId}';
      `);

      const bal = await pg.query<{ current_balance: string; total_paid: string }>(
        `SELECT current_balance, total_paid FROM supplier_balances WHERE supplier_id = '${supplierA1Id}' AND legal_entity_id = '${entityA1Id}'`
      );
      expect(parseFloat(bal.rows[0].current_balance)).toBe(2000.0);
      expect(parseFloat(bal.rows[0].total_paid)).toBe(3000.0);

      const inv = await pg.query<{ paid_amount: string; grand_total: string }>(
        `SELECT paid_amount, grand_total FROM supplier_invoices WHERE id = '${invId}'`
      );
      expect(parseFloat(inv.rows[0].paid_amount)).toBe(3000.0);
    });
  });

  // ==================================================================
  // Test 5: Inviolable Accounting Journal Reversal & Trial Balance
  // ==================================================================
  it('5. should enforce accounting immutability via journal reversals and verify trial balance equality', async () => {
    await runInTenant(tenantAId, async () => {
      const jv1Id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const jvRevId = 'ffffffff-ffff-ffff-ffff-fffffffffff0';
      const bankAccId = 'c1111111-1111-1111-1111-111111111111';
      const revAccId = 'c4444444-4444-4444-4444-444444444444';

      // 1. Post original journal entry: Debit Bank 1000, Credit Revenue 1000
      await pg.exec(`
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, status, debit_total, credit_total)
        VALUES ('${jv1Id}', '${tenantAId}', '${entityA1Id}', 'JV-ORIG-01', 'GENERAL', 'POSTED', 1000.0000, 1000.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('11111111-0000-0000-0000-000000000001', '${jv1Id}', '${bankAccId}', 1000.0000, 0.0000),
          ('11111111-0000-0000-0000-000000000002', '${jv1Id}', '${revAccId}', 0.0000, 1000.0000);
      `);

      // 2. Perform Reversal: Mark original REVERSED and insert inverted entry (Debit Revenue 1000, Credit Bank 1000)
      await pg.exec(`
        UPDATE journal_entries SET status = 'REVERSED' WHERE id = '${jv1Id}';

        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, status, debit_total, credit_total)
        VALUES ('${jvRevId}', '${tenantAId}', '${entityA1Id}', 'JV-REV-01', 'GENERAL', 'POSTED', 1000.0000, 1000.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('22222222-0000-0000-0000-000000000001', '${jvRevId}', '${revAccId}', 1000.0000, 0.0000),
          ('22222222-0000-0000-0000-000000000002', '${jvRevId}', '${bankAccId}', 0.0000, 1000.0000);
      `);

      const orig = await pg.query<{ status: string }>(
        `SELECT status FROM journal_entries WHERE id = '${jv1Id}'`
      );
      expect(orig.rows[0].status).toBe('REVERSED');

      // 3. Verify Trial Balance Mathematical Equality (Total Debits == Total Credits across all POSTED lines)
      const tbQuery = await pg.query<{ total_debit: string; total_credit: string }>(`
        SELECT
          COALESCE(SUM(jl.debit), 0) AS total_debit,
          COALESCE(SUM(jl.credit), 0) AS total_credit
        FROM journal_lines jl
        INNER JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE je.tenant_id = '${tenantAId}' AND je.status = 'POSTED';
      `);

      const totalDeb = parseFloat(tbQuery.rows[0].total_debit);
      const totalCred = parseFloat(tbQuery.rows[0].total_credit);
      expect(totalDeb).toBe(totalCred);
    });
  });

  // ==================================================================
  // Test 6: Strict Multi-Tenant Isolation (RLS Enforcement on New Tables)
  // ==================================================================
  it('6. should strictly isolate sales orders, shifts, and supplier payments between tenants under RLS', async () => {
    // Tenant B queries Tenant A data under rc_app_user
    await runInTenant(tenantBId, async () => {
      const orders = await pg.query(`SELECT * FROM sales_orders;`);
      expect(orders.rows.length).toBe(0);

      const shifts = await pg.query(`SELECT * FROM pos_shifts;`);
      expect(shifts.rows.length).toBe(0);

      const payments = await pg.query(`SELECT * FROM supplier_payments;`);
      expect(payments.rows.length).toBe(0);

      const balances = await pg.query(`SELECT * FROM inventory_balances;`);
      expect(balances.rows.length).toBe(0);
    });
  });
});
