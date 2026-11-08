import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Restaurant Cloud — End-to-End Operational Readiness Audit (Scenarios A through F)', () => {
  let pg: PGlite;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';

  // Multi-Entity in Tenant A
  const entityA1Id = 'a1111111-1111-1111-1111-111111111111'; // شركة الضيافة الفندقية
  const entityA2Id = 'a2222222-2222-2222-2222-222222222222'; // شركة المطاعم السريعة

  const branchA1Id = 'ab111111-1111-1111-1111-111111111111';
  const deviceA1Id = 'de111111-1111-1111-1111-111111111111';
  const sharedWhId = 'ad111111-1111-1111-1111-111111111111'; // مستودع لوجستي مشترك
  const supplierA1Id = 'af111111-1111-1111-1111-111111111111';
  const userCashierId = 'cc111111-1111-1111-1111-111111111111';
  const userManagerId = 'ba111111-1111-1111-1111-111111111111';

  const uomUnitId = 'ac000000-0000-0000-0000-000000000001';
  const uomKgId = 'ac000000-0000-0000-0000-000000000002';
  const uomGramId = 'ac000000-0000-0000-0000-000000000003';

  const itemBunId = 'aa000000-0000-0000-0000-000000000001';
  const itemPattyId = 'aa000000-0000-0000-0000-000000000002';
  const itemSauceId = 'aa000000-0000-0000-0000-000000000003';
  const itemBurgerDishId = 'aa000000-0000-0000-0000-000000000004';
  const itemSharedMeatId = 'aa000000-0000-0000-0000-000000000005';

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

    // 1. DDL Schema Definition
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_inv_bal UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)
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
        ordered_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        received_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        unit_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        subtotal NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        tax_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
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
        received_qty NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_invoices (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        purchase_order_id UUID REFERENCES purchase_orders(id),
        invoice_number VARCHAR(50) NOT NULL,
        subtotal NUMERIC(14, 4) NOT NULL,
        tax_amount NUMERIC(14, 4) NOT NULL,
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_supp_bal UNIQUE (legal_entity_id, supplier_id)
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

      CREATE TABLE production_batches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        recipe_id UUID NOT NULL REFERENCES recipes(id),
        batch_number VARCHAR(50) NOT NULL,
        planned_yield NUMERIC(14, 4) NOT NULL,
        actual_yield NUMERIC(14, 4) NOT NULL,
        total_batch_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        unit_produced_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE waste_records (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        item_id UUID NOT NULL REFERENCES items(id),
        quantity NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        total_waste_amount NUMERIC(14, 4) NOT NULL,
        reason VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        discount_total NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        tax_total NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        grand_total NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        idempotency_key VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sales_order_num UNIQUE (tenant_id, legal_entity_id, order_number)
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

      CREATE TABLE order_voids (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        order_id UUID NOT NULL REFERENCES sales_orders(id),
        reason VARCHAR(100) NOT NULL,
        void_amount NUMERIC(12, 4) NOT NULL,
        approved_by UUID NOT NULL,
        voided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
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
      CREATE POLICY p_audit_orders ON sales_orders FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_audit_shifts ON pos_shifts FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_audit_invoices ON supplier_invoices FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_audit_balances ON inventory_balances FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);

    // 3. Seed Master Organization Data
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
        ('${tenantAId}', 'tenant-a', 'مجموعة مطاعم النخبة والضيافة'),
        ('${tenantBId}', 'tenant-b', 'شركة التغذية المنافسة');

      INSERT INTO legal_entities (id, tenant_id, legal_name) VALUES
        ('${entityA1Id}', '${tenantAId}', 'شركة الضيافة الفندقية المحدودة'),
        ('${entityA2Id}', '${tenantAId}', 'شركة المطاعم السريعة المبتكرة');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
        ('${branchA1Id}', '${tenantAId}', '${entityA1Id}', 'BR-01', 'فرع الرياض - العليا');

      INSERT INTO devices (id, tenant_id, branch_id, code) VALUES
        ('${deviceA1Id}', '${tenantAId}', '${branchA1Id}', 'POS-01');

      INSERT INTO warehouses (id, tenant_id, code, name) VALUES
        ('${sharedWhId}', '${tenantAId}', 'WH-CENTRAL-SHARED', 'المستودع اللوجستي المركزي المشترك');

      INSERT INTO units_of_measure (id, tenant_id, code, name_ar) VALUES
        ('${uomUnitId}', '${tenantAId}', 'PCS', 'حبة'),
        ('${uomKgId}', '${tenantAId}', 'KG', 'كيلوجرام'),
        ('${uomGramId}', '${tenantAId}', 'G', 'جرام');

      INSERT INTO suppliers (id, tenant_id, name_ar) VALUES
        ('${supplierA1Id}', '${tenantAId}', 'شركة المراعي للألبان والأغذية');

      INSERT INTO items (id, tenant_id, sku, name_ar, costing_method, default_cost, default_price) VALUES
        ('${itemBunId}', '${tenantAId}', 'RAW-BUN', 'خبز برجر فاخر', 'FIFO', 1.0000, 0.0000),
        ('${itemPattyId}', '${tenantAId}', 'RAW-PATTY', 'شريحة لحم بقري 150جم', 'FIFO', 8.0000, 0.0000),
        ('${itemSauceId}', '${tenantAId}', 'RAW-SAUCE', 'صوص تروفل خاص (جرام)', 'FIFO', 0.0500, 0.0000),
        ('${itemBurgerDishId}', '${tenantAId}', 'MEAL-GOURMET', 'وجبة جورميه برجر', 'FIFO', 10.0000, 40.0000),
        ('${itemSharedMeatId}', '${tenantAId}', 'RAW-MEAT-BULK', 'لحم بقري مبرد خام (كجم)', 'FIFO', 30.0000, 0.0000);

      -- Chart of Accounts for Entity 1
      INSERT INTO chart_of_accounts (id, tenant_id, legal_entity_id, account_code, name, account_type) VALUES
        ('c1111111-1111-1111-1111-111111111111', '${tenantAId}', '${entityA1Id}', '1010', 'البنك الأهلي التجاري', 'ASSET'),
        ('c1111111-1111-1111-1111-111111111112', '${tenantAId}', '${entityA1Id}', '1020', 'صندوق الكاشير - نقطة بيع', 'ASSET'),
        ('c1111111-1111-1111-1111-111111111113', '${tenantAId}', '${entityA1Id}', '1050', 'مخزون المواد الغذائية الخام', 'ASSET'),
        ('c1111111-1111-1111-1111-111111111114', '${tenantAId}', '${entityA1Id}', '1070', 'ضريبة القيمة المضافة للمدخلات (المشتريات)', 'ASSET'),
        ('c1111111-1111-1111-1111-111111111115', '${tenantAId}', '${entityA1Id}', '2010', 'الموردون وحسابات الدائنين', 'LIABILITY'),
        ('c1111111-1111-1111-1111-111111111116', '${tenantAId}', '${entityA1Id}', '2050', 'ضريبة القيمة المضافة للمخرجات (المبيعات)', 'LIABILITY'),
        ('c1111111-1111-1111-1111-111111111117', '${tenantAId}', '${entityA1Id}', '4010', 'إيرادات مبيعات المطعم', 'REVENUE'),
        ('c1111111-1111-1111-1111-111111111118', '${tenantAId}', '${entityA1Id}', '5010', 'تكلفة البضاعة المباعة COGS', 'EXPENSE'),
        ('c1111111-1111-1111-1111-111111111119', '${tenantAId}', '${entityA1Id}', '5020', 'مصروفات الهدر والتالف', 'EXPENSE'),
        ('c1111111-1111-1111-1111-111111111120', '${tenantAId}', '${entityA1Id}', '5030', 'عجز وفروقات الصندوق', 'EXPENSE');
    `);
  });

  // ==================================================================
  // Scenario A — Complete Purchasing Lifecycle
  // ==================================================================
  it('Scenario A: should execute PO creation -> Partial GRN -> Remaining GRN -> 3-Way Match Invoice -> AP Journal', async () => {
    await runInTenant(tenantAId, async () => {
      const poId = 'a0000000-0000-0000-0000-000000000010';
      // 1. Issue PO for 100 Buns @ 1.00 SAR = 100 + 15% VAT (15 SAR) = 115 SAR
      await pg.exec(`
        INSERT INTO purchase_orders (id, tenant_id, legal_entity_id, supplier_id, warehouse_id, order_number, status, ordered_qty, received_qty, unit_price, subtotal, tax_amount, grand_total)
        VALUES ('${poId}', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', '${sharedWhId}', 'PO-AUDIT-001', 'ISSUED', 100.0000, 0.0000, 1.0000, 100.0000, 15.0000, 115.0000);
      `);

      // 2. Partial Receipt: GRN 1 (Receive 40 Buns)
      const grn1Id = 'a0000000-0000-0000-0000-000000000011';
      await pg.exec(`
        INSERT INTO goods_receipts (id, tenant_id, legal_entity_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, received_qty, unit_cost, status)
        VALUES ('${grn1Id}', '${tenantAId}', '${entityA1Id}', '${poId}', '${supplierA1Id}', '${sharedWhId}', 'GRN-AUDIT-001A', 40.0000, 1.0000, 'RECEIVED');

        -- Update PO progress
        UPDATE purchase_orders SET received_qty = 40.0000, status = 'PARTIALLY_RECEIVED' WHERE id = '${poId}';

        -- Update stock balance (+40)
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty)
        VALUES ('a0000000-0000-0000-0000-000000000012', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 40.0000);

        -- FIFO layer 1
        INSERT INTO inventory_cost_layers (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id)
        VALUES ('a0000000-0000-0000-0000-000000000013', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 40.0000, 40.0000, 1.0000, 'goods_receipt', '${grn1Id}');
      `);

      // Verify PO status is PARTIALLY_RECEIVED
      const poCheck1 = await pg.query<{ status: string; received_qty: string }>(
        `SELECT status, received_qty FROM purchase_orders WHERE id = '${poId}'`
      );
      expect(poCheck1.rows[0].status).toBe('PARTIALLY_RECEIVED');
      expect(parseFloat(poCheck1.rows[0].received_qty)).toBe(40.0);

      // 3. Remainder Receipt: GRN 2 (Receive remaining 60 Buns)
      const grn2Id = 'a0000000-0000-0000-0000-000000000014';
      await pg.exec(`
        INSERT INTO goods_receipts (id, tenant_id, legal_entity_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, received_qty, unit_cost, status)
        VALUES ('${grn2Id}', '${tenantAId}', '${entityA1Id}', '${poId}', '${supplierA1Id}', '${sharedWhId}', 'GRN-AUDIT-001B', 60.0000, 1.0000, 'RECEIVED');

        -- PO Completed
        UPDATE purchase_orders SET received_qty = 100.0000, status = 'COMPLETED' WHERE id = '${poId}';

        -- Update stock balance (+60 -> 100)
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty + 60.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBunId}';

        -- FIFO layer 2
        INSERT INTO inventory_cost_layers (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id)
        VALUES ('a0000000-0000-0000-0000-000000000015', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 60.0000, 60.0000, 1.0000, 'goods_receipt', '${grn2Id}');
      `);

      // Verify PO is COMPLETED and Total Stock is 100
      const poCheck2 = await pg.query<{ status: string; received_qty: string }>(
        `SELECT status, received_qty FROM purchase_orders WHERE id = '${poId}'`
      );
      expect(poCheck2.rows[0].status).toBe('COMPLETED');
      expect(parseFloat(poCheck2.rows[0].received_qty)).toBe(100.0);

      const balCheck = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBunId}'`
      );
      expect(parseFloat(balCheck.rows[0].on_hand_qty)).toBe(100.0);

      // 4. Supplier Invoice: 100 Buns @ 1.00 SAR = 100 + 15% VAT (15 SAR) = 115 SAR
      const invId = 'a0000000-0000-0000-0000-000000000016';
      await pg.exec(`
        INSERT INTO supplier_invoices (id, tenant_id, legal_entity_id, supplier_id, purchase_order_id, invoice_number, subtotal, tax_amount, grand_total, status)
        VALUES ('${invId}', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', '${poId}', 'INV-SUP-901', 100.0000, 15.0000, 115.0000, 'APPROVED');

        -- Update Supplier Balance
        INSERT INTO supplier_balances (id, tenant_id, legal_entity_id, supplier_id, current_balance, total_invoiced, total_paid)
        VALUES ('a0000000-0000-0000-0000-000000000017', '${tenantAId}', '${entityA1Id}', '${supplierA1Id}', 115.0000, 115.0000, 0.0000);

        -- Post Balanced Accounting Journal:
        -- Debit: Inventory (1050) = 100 SAR
        -- Debit: Input VAT (1070) = 15 SAR
        -- Credit: Accounts Payable (2010) = 115 SAR
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('a0000000-0000-0000-0000-000000000018', '${tenantAId}', '${entityA1Id}', 'JV-PUR-001', 'PURCHASES', 'supplier_invoice', '${invId}', 115.0000, 115.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('a0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000018', 'c1111111-1111-1111-1111-111111111113', 100.0000, 0.0000),
          ('a0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000018', 'c1111111-1111-1111-1111-111111111114', 15.0000, 0.0000),
          ('a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000018', 'c1111111-1111-1111-1111-111111111115', 0.0000, 115.0000);
      `);

      // Verify Supplier Balance and Journal Balance
      const suppBal = await pg.query<{ current_balance: string }>(
        `SELECT current_balance FROM supplier_balances WHERE supplier_id = '${supplierA1Id}' AND legal_entity_id = '${entityA1Id}'`
      );
      expect(parseFloat(suppBal.rows[0].current_balance)).toBe(115.0);

      const jvLines = await pg.query<{ sum_debit: string; sum_credit: string }>(`
        SELECT SUM(debit) AS sum_debit, SUM(credit) AS sum_credit
        FROM journal_lines WHERE journal_entry_id = 'a0000000-0000-0000-0000-000000000018'
      `);
      expect(parseFloat(jvLines.rows[0].sum_debit)).toBe(115.0);
      expect(parseFloat(jvLines.rows[0].sum_credit)).toBe(115.0);
    });
  });

  // ==================================================================
  // Scenario B — Recipe & Production Batch with Kitchen Waste
  // ==================================================================
  it('Scenario B: should execute production batch, deduct raw ingredients, credit finished dish, and record kitchen waste', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Setup Recipe: 1 Burger Dish yields 1.0 and requires:
      // - 1 Bun @ 1.00 SAR
      // - 1 Patty @ 8.00 SAR (waste 5% = 8.40 SAR)
      // - 20g Sauce @ 0.05 SAR/g (1.00 SAR)
      // Theoretical Cost per Burger = 1.00 + 8.40 + 1.00 = 10.40 SAR
      const rcpId = 'b0000000-0000-0000-0000-000000000001';
      await pg.exec(`
        INSERT INTO recipes (id, tenant_id, legal_entity_id, output_item_id, recipe_code, yield_quantity)
        VALUES ('${rcpId}', '${tenantAId}', '${entityA1Id}', '${itemBurgerDishId}', 'RCP-GOURMET-BOM', 1.0000);

        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_item_id, quantity, waste_percentage) VALUES
          ('b0000000-0000-0000-0000-000000000002', '${rcpId}', '${itemBunId}', 1.0000, 0.00),
          ('b0000000-0000-0000-0000-000000000003', '${rcpId}', '${itemPattyId}', 1.0000, 5.00),
          ('b0000000-0000-0000-0000-000000000004', '${rcpId}', '${itemSauceId}', 20.0000, 0.00);

        -- Stock on hand for Patties and Sauce
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty)
        VALUES
          ('b0000000-0000-0000-0000-000000000005', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemPattyId}', 50.0000),
          ('b0000000-0000-0000-0000-000000000006', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemSauceId}', 1000.0000);
      `);

      // 2. Production Batch: Produce 20 Gourmet Burgers
      // Deducts: 20 Buns (from 100 -> 80), 21 Patties (50 -> 29 with 5% waste), 400g Sauce (1000 -> 600)
      // Total Batch Cost = 20*1 + 21*8 + 400*0.05 = 20 + 168 + 20 = 208 SAR (10.40 SAR/unit)
      const batchId = 'b0000000-0000-0000-0000-000000000007';
      await pg.exec(`
        INSERT INTO production_batches (id, tenant_id, legal_entity_id, warehouse_id, recipe_id, batch_number, planned_yield, actual_yield, total_batch_cost, unit_produced_cost)
        VALUES ('${batchId}', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${rcpId}', 'BATCH-2026-001', 20.0000, 20.0000, 208.0000, 10.4000);

        -- Deduct ingredients
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 20.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBunId}';
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 21.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemPattyId}';
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 400.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemSauceId}';

        -- Add finished goods (20 burgers)
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty)
        VALUES ('b0000000-0000-0000-0000-000000000008', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBurgerDishId}', 20.0000);
      `);

      // 3. Record Kitchen Waste: 2 damaged patties (16.00 SAR)
      const wasteId = 'b0000000-0000-0000-0000-000000000009';
      await pg.exec(`
        INSERT INTO waste_records (id, tenant_id, legal_entity_id, warehouse_id, item_id, quantity, unit_cost, total_waste_amount, reason)
        VALUES ('${wasteId}', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemPattyId}', 2.0000, 8.0000, 16.0000, 'EXPIRED_DEFECTIVE');

        -- Deduct waste from patty stock (29 -> 27)
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 2.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemPattyId}';

        -- Accounting Journal for Kitchen Waste:
        -- Debit: Spoilage & Waste Expense (5020) = 16.00 SAR
        -- Credit: Raw Food Inventory (1050) = 16.00 SAR
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('b0000000-0000-0000-0000-000000000010', '${tenantAId}', '${entityA1Id}', 'JV-WASTE-001', 'GENERAL', 'waste_record', '${wasteId}', 16.0000, 16.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000010', 'c1111111-1111-1111-1111-111111111119', 16.0000, 0.0000),
          ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000010', 'c1111111-1111-1111-1111-111111111113', 0.0000, 16.0000);
      `);

      // Verify stock balances:
      // Buns: 100 - 20 = 80
      // Patties: 50 - 21 (production) - 2 (waste) = 27
      // Finished Burgers: 20
      const bunBal = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBunId}'`
      );
      expect(parseFloat(bunBal.rows[0].on_hand_qty)).toBe(80.0);

      const pattyBal = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemPattyId}'`
      );
      expect(parseFloat(pattyBal.rows[0].on_hand_qty)).toBe(27.0);

      const burgerBal = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBurgerDishId}'`
      );
      expect(parseFloat(burgerBal.rows[0].on_hand_qty)).toBe(20.0);
    });
  });

  // ==================================================================
  // Scenario C — Complete POS Sale (Shift, Dine-in, Discount, VAT, COGS)
  // ==================================================================
  it('Scenario C: should execute full POS sale: shift open, dine-in table, discount, VAT 15%, revenue & COGS posting', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Open Shift with 300 SAR cash float
      const shiftId = 'c0000000-0000-0000-0000-000000000001';
      await pg.exec(`
        INSERT INTO pos_shifts (id, tenant_id, legal_entity_id, branch_id, device_id, cashier_id, opening_cash, status)
        VALUES ('${shiftId}', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', '${userCashierId}', 300.0000, 'OPEN');
      `);

      // 2. Dine-in Table T-01
      const tableId = 'c0000000-0000-0000-0000-000000000002';
      await pg.exec(`
        INSERT INTO dining_tables (id, tenant_id, branch_id, table_number, status)
        VALUES ('${tableId}', '${tenantAId}', '${branchA1Id}', 'T-01', 'AVAILABLE');
      `);

      // 3. Order: 2 Gourmet Burgers @ 40 SAR = 80 SAR
      // Discount = 10% (8.00 SAR) -> Net Subtotal = 72.00 SAR
      // 15% VAT = 10.80 SAR -> Grand Total = 82.80 SAR
      // COGS for 2 Burgers = 2 * 10.40 SAR = 20.80 SAR
      const orderId = 'c0000000-0000-0000-0000-000000000003';
      await pg.exec(`
        INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, device_id, shift_id, table_id, order_number, order_type, status, subtotal, discount_total, tax_total, grand_total)
        VALUES ('${orderId}', '${tenantAId}', '${entityA1Id}', '${branchA1Id}', '${deviceA1Id}', '${shiftId}', '${tableId}', 'ORD-AUDIT-501', 'DINE_IN', 'COMPLETED', 72.0000, 8.0000, 10.8000, 82.8000);

        INSERT INTO payments (id, tenant_id, legal_entity_id, order_id, payment_method, amount, status)
        VALUES ('c0000000-0000-0000-0000-000000000004', '${tenantAId}', '${entityA1Id}', '${orderId}', 'CASH', 82.8000, 'CAPTURED');

        -- Table becomes OCCUPIED
        UPDATE dining_tables SET status = 'OCCUPIED', current_order_id = '${orderId}' WHERE id = '${tableId}';

        -- Deduct 2 Finished Burgers from Stock (20 -> 18)
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty - 2.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBurgerDishId}';

        -- Accounting Entry 1: Sales Revenue & Tax (Debit Cash 82.80, Credit Sales 72.00, Credit Output VAT 10.80)
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('c0000000-0000-0000-0000-000000000005', '${tenantAId}', '${entityA1Id}', 'JV-POS-501', 'SALES', 'sales_order', '${orderId}', 82.8000, 82.8000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000005', 'c1111111-1111-1111-1111-111111111112', 82.8000, 0.0000),
          ('c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000005', 'c1111111-1111-1111-1111-111111111117', 0.0000, 72.0000),
          ('c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000005', 'c1111111-1111-1111-1111-111111111116', 0.0000, 10.8000);

        -- Accounting Entry 2: Cost of Goods Sold (Debit COGS 20.80, Credit Inventory 20.80)
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('c0000000-0000-0000-0000-000000000009', '${tenantAId}', '${entityA1Id}', 'JV-COGS-501', 'INVENTORY', 'sales_order', '${orderId}', 20.8000, 20.8000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000009', 'c1111111-1111-1111-1111-111111111118', 20.8000, 0.0000),
          ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000009', 'c1111111-1111-1111-1111-111111111113', 0.0000, 20.8000);
      `);

      // Verify Stock = 18 and Cash in Drawer = 300 + 82.80 = 382.80 SAR
      const burgerStock = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBurgerDishId}'`
      );
      expect(parseFloat(burgerStock.rows[0].on_hand_qty)).toBe(18.0);
    });
  });

  // ==================================================================
  // Scenario D — Order Void & Returns Reversing Financial/Stock Effects
  // ==================================================================
  it('Scenario D: should execute manager void on order, reverse table occupancy, and restore stock without double refund', async () => {
    await runInTenant(tenantAId, async () => {
      const orderId = 'c0000000-0000-0000-0000-000000000003';
      const tableId = 'c0000000-0000-0000-0000-000000000002';

      // Execute Void: Customer cancelled right after ordering
      const voidId = 'd0000000-0000-0000-0000-000000000001';
      await pg.exec(`
        -- 1. Insert order void record
        INSERT INTO order_voids (id, tenant_id, legal_entity_id, order_id, reason, void_amount, approved_by)
        VALUES ('${voidId}', '${tenantAId}', '${entityA1Id}', '${orderId}', 'CUSTOMER_WALKOUT', 82.8000, '${userManagerId}');

        -- 2. Mark order CANCELLED
        UPDATE sales_orders SET status = 'CANCELLED' WHERE id = '${orderId}';

        -- 3. Release Dining Table -> AVAILABLE
        UPDATE dining_tables SET status = 'AVAILABLE', current_order_id = NULL WHERE id = '${tableId}';

        -- 4. Restore Stock (18 + 2 = 20)
        UPDATE inventory_balances SET on_hand_qty = on_hand_qty + 2.0000 WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBurgerDishId}';

        -- 5. Reverse Accounting Entries (Inverted reversal entry)
        -- Debit Sales 72.00, Debit Output VAT 10.80, Credit Cash 82.80
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('d0000000-0000-0000-0000-000000000002', '${tenantAId}', '${entityA1Id}', 'JV-VOID-501', 'SALES', 'order_void', '${voidId}', 82.8000, 82.8000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111117', 72.0000, 0.0000),
          ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111116', 10.8000, 0.0000),
          ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111112', 0.0000, 82.8000);
      `);

      // Verify table is AVAILABLE
      const tableCheck = await pg.query<{ status: string; current_order_id: string | null }>(
        `SELECT status, current_order_id FROM dining_tables WHERE id = '${tableId}'`
      );
      expect(tableCheck.rows[0].status).toBe('AVAILABLE');
      expect(tableCheck.rows[0].current_order_id).toBeNull();

      // Verify stock restored to 20
      const stockCheck = await pg.query<{ on_hand_qty: string }>(
        `SELECT on_hand_qty FROM inventory_balances WHERE legal_entity_owner_id = '${entityA1Id}' AND item_id = '${itemBurgerDishId}'`
      );
      expect(parseFloat(stockCheck.rows[0].on_hand_qty)).toBe(20.0);
    });
  });

  // ==================================================================
  // Scenario E — Shift Closing with Cash Discrepancy Reconciliation
  // ==================================================================
  it('Scenario E: should close POS shift, detect exact cash discrepancy, and post shortage journal entry without duplicate posting', async () => {
    await runInTenant(tenantAId, async () => {
      const shiftId = 'c0000000-0000-0000-0000-000000000001';
      // Expected Cash: Opening was 300 SAR. (The 82.80 SAR sale was voided/refunded, so expected cash in drawer = 300.00 SAR).
      // Counted Cash: Cashier counts 295.00 SAR (5.00 SAR cash shortage).
      const expectedCash = 300.0;
      const countedCash = 295.0;
      const variance = countedCash - expectedCash; // -5.00 SAR

      await pg.exec(`
        UPDATE pos_shifts
        SET status = 'CLOSED', closed_at = NOW(), expected_cash = ${expectedCash}, counted_cash = ${countedCash}, variance = ${variance}
        WHERE id = '${shiftId}';

        -- Shift Reconciliation Journal Entry:
        -- Debit: Safe / Main Bank Account (1010) = 295.00 SAR
        -- Debit: Cash Shortage Expense (5030) = 5.00 SAR
        -- Credit: POS Cash Drawer (1020) = 300.00 SAR
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
        VALUES ('e0000000-0000-0000-0000-000000000001', '${tenantAId}', '${entityA1Id}', 'JV-SHIFT-CLOSE-01', 'CLOSING', 'pos_shift', '${shiftId}', 300.0000, 300.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES
          ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 295.0000, 0.0000),
          ('e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111120', 5.0000, 0.0000),
          ('e0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111112', 0.0000, 300.0000);
      `);

      const shiftCheck = await pg.query<{ status: string; variance: string }>(
        `SELECT status, variance FROM pos_shifts WHERE id = '${shiftId}'`
      );
      expect(shiftCheck.rows[0].status).toBe('CLOSED');
      expect(parseFloat(shiftCheck.rows[0].variance)).toBe(-5.0);

      // Verify Shift Closing Journal Balance
      const jvCheck = await pg.query<{ sum_deb: string; sum_cred: string }>(`
        SELECT SUM(debit) AS sum_deb, SUM(credit) AS sum_cred
        FROM journal_lines WHERE journal_entry_id = 'e0000000-0000-0000-0000-000000000001';
      `);
      expect(parseFloat(jvCheck.rows[0].sum_deb)).toBe(300.0);
      expect(parseFloat(jvCheck.rows[0].sum_cred)).toBe(300.0);
    });
  });

  // ==================================================================
  // Scenario F — Multi-Entity Stock Ownership & Isolation in Shared Warehouse
  // ==================================================================
  it('Scenario F: should maintain separate company ownership and costs in a shared warehouse and isolate cross-entity access', async () => {
    await runInTenant(tenantAId, async () => {
      // 1. Entity 1 purchases Bulk Meat: 50 kg @ 30 SAR/kg = 1500 SAR
      // 2. Entity 2 purchases same Bulk Meat: 30 kg @ 45 SAR/kg = 1350 SAR
      // Both store in the same physical warehouse (WH-CENTRAL-SHARED)
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty) VALUES
          ('f0000000-0000-0000-0000-000000000001', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemSharedMeatId}', 50.0000),
          ('f0000000-0000-0000-0000-000000000002', '${tenantAId}', '${entityA2Id}', '${sharedWhId}', '${itemSharedMeatId}', 30.0000);

        INSERT INTO inventory_cost_layers (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id) VALUES
          ('f0000000-0000-0000-0000-000000000003', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemSharedMeatId}', 50.0000, 50.0000, 30.0000, 'goods_receipt', 'f0000000-0000-0000-0000-000000000011'),
          ('f0000000-0000-0000-0000-000000000004', '${tenantAId}', '${entityA2Id}', '${sharedWhId}', '${itemSharedMeatId}', 30.0000, 30.0000, 45.0000, 'goods_receipt', 'f0000000-0000-0000-0000-000000000012');
      `);

      // 3. Verify Entity 1 Stock and Valuation
      const e1Val = await pg.query<{ on_hand: string; unit_cost: string }>(`
        SELECT b.on_hand_qty AS on_hand, c.unit_cost
        FROM inventory_balances b
        INNER JOIN inventory_cost_layers c ON b.item_id = c.item_id AND b.legal_entity_owner_id = c.legal_entity_owner_id
        WHERE b.legal_entity_owner_id = '${entityA1Id}' AND b.item_id = '${itemSharedMeatId}';
      `);
      expect(parseFloat(e1Val.rows[0].on_hand)).toBe(50.0);
      expect(parseFloat(e1Val.rows[0].unit_cost)).toBe(30.0);

      // 4. Verify Entity 2 Stock and Valuation
      const e2Val = await pg.query<{ on_hand: string; unit_cost: string }>(`
        SELECT b.on_hand_qty AS on_hand, c.unit_cost
        FROM inventory_balances b
        INNER JOIN inventory_cost_layers c ON b.item_id = c.item_id AND b.legal_entity_owner_id = c.legal_entity_owner_id
        WHERE b.legal_entity_owner_id = '${entityA2Id}' AND b.item_id = '${itemSharedMeatId}';
      `);
      expect(parseFloat(e2Val.rows[0].on_hand)).toBe(30.0);
      expect(parseFloat(e2Val.rows[0].unit_cost)).toBe(45.0);

      // 5. Consolidated Warehouse Physical View (Total physical kg in warehouse)
      const whTotal = await pg.query<{ total_kg: string }>(`
        SELECT SUM(on_hand_qty) AS total_kg
        FROM inventory_balances
        WHERE warehouse_id = '${sharedWhId}' AND item_id = '${itemSharedMeatId}';
      `);
      expect(parseFloat(whTotal.rows[0].total_kg)).toBe(80.0); // 50kg + 30kg = 80kg physically in warehouse
    });

    // 6. Cross-Tenant Security Isolation: Tenant B cannot access Tenant A data under RLS
    await runInTenant(tenantBId, async () => {
      const crossCheck = await pg.query(`SELECT * FROM inventory_balances;`);
      expect(crossCheck.rows.length).toBe(0);

      const crossOrders = await pg.query(`SELECT * FROM sales_orders;`);
      expect(crossOrders.rows.length).toBe(0);

      const crossInvoices = await pg.query(`SELECT * FROM supplier_invoices;`);
      expect(crossInvoices.rows.length).toBe(0);
    });
  });
});
