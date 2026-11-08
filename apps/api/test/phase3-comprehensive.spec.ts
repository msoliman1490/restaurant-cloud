import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Phase 3 — Enterprise Suite: Inventory FIFO, Purchasing, Recipes, POS Dining & Accounting', () => {
  let pg: PGlite;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const entityA1Id = 'a1111111-1111-1111-1111-111111111111';
  const entityA2Id = 'a2222222-2222-2222-2222-222222222222';
  const branchA1Id = 'ab111111-1111-1111-1111-111111111111';
  const sharedWhId = 'ad111111-1111-1111-1111-111111111111';
  const supplierAId = 'af111111-1111-1111-1111-111111111111';

  const uomUnitId = 'ac000000-0000-0000-0000-000000000001';
  const itemPattyId = 'aa000000-0000-0000-0000-000000000001';
  const itemBunId = 'aa000000-0000-0000-0000-000000000002';
  const itemMealId = 'aa000000-0000-0000-0000-000000000003';

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
        name VARCHAR(255) NOT NULL,
        CONSTRAINT uq_branch_entity_code UNIQUE (tenant_id, legal_entity_id, code)
      );

      CREATE TABLE warehouses (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID REFERENCES branches(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE units_of_measure (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(20) NOT NULL,
        name_ar VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NOT NULL
      );

      CREATE TABLE suppliers (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        vat_number VARCHAR(50)
      );

      CREATE TABLE items (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        base_uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        sku VARCHAR(50) NOT NULL,
        name_ar VARCHAR(255) NOT NULL,
        name_en VARCHAR(255) NOT NULL,
        default_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        default_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500
      );

      -- Inventory with Multi-Company ownership in shared physical warehouse
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
        CONSTRAINT uq_inv_balance_company UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)
      );

      CREATE TABLE inventory_cost_layers (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        item_id UUID NOT NULL REFERENCES items(id),
        quantity_received NUMERIC(14, 4) NOT NULL,
        quantity_remaining NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
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
        occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      -- Purchasing
      CREATE TABLE purchase_orders (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        order_number VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        subtotal NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        tax_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        grand_total NUMERIC(14, 4) NOT NULL DEFAULT 0.0000
      );

      CREATE TABLE purchase_order_lines (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES purchase_orders(id),
        item_id UUID NOT NULL REFERENCES items(id),
        uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        ordered_qty NUMERIC(14, 4) NOT NULL,
        received_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        invoiced_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        unit_price NUMERIC(14, 4) NOT NULL,
        line_total NUMERIC(14, 4) NOT NULL
      );

      CREATE TABLE goods_receipts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        purchase_order_id UUID REFERENCES purchase_orders(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        receipt_number VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED'
      );

      CREATE TABLE goods_receipt_lines (
        id UUID PRIMARY KEY,
        receipt_id UUID NOT NULL REFERENCES goods_receipts(id),
        purchase_order_line_id UUID REFERENCES purchase_order_lines(id),
        item_id UUID NOT NULL REFERENCES items(id),
        uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        received_qty NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL
      );

      CREATE TABLE supplier_balances (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        current_balance NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        total_invoiced NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        total_paid NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        CONSTRAINT uq_supplier_balances UNIQUE (legal_entity_id, supplier_id)
      );

      -- Recipes & Production
      CREATE TABLE recipes (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        output_item_id UUID NOT NULL REFERENCES items(id),
        recipe_code VARCHAR(50) NOT NULL,
        version VARCHAR(20) NOT NULL DEFAULT '1.0',
        yield_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
        yield_uom_id UUID NOT NULL REFERENCES units_of_measure(id)
      );

      CREATE TABLE recipe_ingredients (
        id UUID PRIMARY KEY,
        recipe_id UUID NOT NULL REFERENCES recipes(id),
        ingredient_item_id UUID NOT NULL REFERENCES items(id),
        quantity NUMERIC(14, 4) NOT NULL,
        uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        waste_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00
      );

      CREATE TABLE production_batches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        recipeId UUID NOT NULL REFERENCES recipes(id),
        batch_number VARCHAR(50) NOT NULL,
        planned_yield NUMERIC(14, 4) NOT NULL,
        actual_yield NUMERIC(14, 4),
        total_batch_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        unit_produced_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        status VARCHAR(30) NOT NULL DEFAULT 'PLANNED'
      );

      -- Dining Tables
      CREATE TABLE dining_tables (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        table_number VARCHAR(20) NOT NULL,
        section VARCHAR(50) NOT NULL DEFAULT 'MAIN',
        capacity INTEGER NOT NULL DEFAULT 4,
        status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE'
      );

      CREATE TABLE table_sessions (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        table_id UUID NOT NULL REFERENCES dining_tables(id),
        guest_count INTEGER NOT NULL DEFAULT 1,
        opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP WITH TIME ZONE
      );

      -- Accounting
      CREATE TABLE chart_of_accounts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        account_code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        account_type VARCHAR(30) NOT NULL DEFAULT 'ASSET',
        normal_balance VARCHAR(10) NOT NULL DEFAULT 'DEBIT',
        CONSTRAINT uq_coa UNIQUE (legal_entity_id, account_code)
      );

      CREATE TABLE journal_entries (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        journal_number VARCHAR(50) NOT NULL,
        journal_type VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
        debit_total NUMERIC(14, 4) NOT NULL,
        credit_total NUMERIC(14, 4) NOT NULL,
        posted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
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

    // Enable RLS on all tenant-owned tables
    const rlsTables = [
      'units_of_measure',
      'suppliers',
      'items',
      'inventory_balances',
      'inventory_cost_layers',
      'inventory_movements',
      'purchase_orders',
      'goods_receipts',
      'supplier_balances',
      'recipes',
      'production_batches',
      'dining_tables',
      'table_sessions',
      'chart_of_accounts',
      'journal_entries',
    ];

    for (const table of rlsTables) {
      await pg.exec(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
      `);
    }

    // Role setup
    await pg.exec(`
      CREATE ROLE rc_app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
    `);

    // Seed Tenants, Legal Entities & Shared Warehouse
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
        ('${tenantAId}', 'tenant-a', 'مطاعم النخبة أ'),
        ('${tenantBId}', 'tenant-b', 'كافيهات العاصمة ب');

      -- Tenant A has 2 legal entities sharing 1 central warehouse
      INSERT INTO legal_entities (id, tenant_id, legal_name) VALUES
        ('${entityA1Id}', '${tenantAId}', 'شركة النخبة لخدمات الإعاشة'),
        ('${entityA2Id}', '${tenantAId}', 'شركة الضيافة الفندقية');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
        ('${branchA1Id}', '${tenantAId}', '${entityA1Id}', 'BR-01', 'فرع العليا');

      INSERT INTO warehouses (id, tenant_id, branch_id, code, name) VALUES
        ('${sharedWhId}', '${tenantAId}', NULL, 'WH-SHARED', 'المستودع اللوجستي المشترك');

      INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en) VALUES
        ('${uomUnitId}', '${tenantAId}', 'PCS', 'حبة', 'Piece');

      INSERT INTO suppliers (id, tenant_id, code, name, vat_number) VALUES
        ('${supplierAId}', '${tenantAId}', 'SUP-ALMARAI', 'شركة المراعي', '300011122233344');

      INSERT INTO items (id, tenant_id, legal_entity_owner_id, base_uom_id, sku, name_ar, name_en, default_cost, default_price) VALUES
        ('${itemPattyId}', '${tenantAId}', '${entityA1Id}', '${uomUnitId}', 'RAW-PATTY', 'شريحة لحم بقري 150جم', 'Beef Patty 150g', 8.0000, 0.0000),
        ('${itemBunId}', '${tenantAId}', '${entityA1Id}', '${uomUnitId}', 'RAW-BUN', 'خبز برجر بالسمسم', 'Brioche Bun', 1.5000, 0.0000),
        ('${itemMealId}', '${tenantAId}', '${entityA1Id}', '${uomUnitId}', 'MEAL-BURGER', 'وجبة برجر كلاسيك كاملة', 'Classic Burger Meal', 9.5000, 32.0000);
    `);
  });

  // ==================================================================
  // Test 1: Shared Physical Warehouse with Company-Owned Stock
  // ==================================================================
  it('1. should isolate company-owned stock in a shared physical warehouse', async () => {
    await runInTenant(tenantAId, async () => {
      // Entity A1 owns 100 Patties in the shared warehouse
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('ba100000-0000-0000-0000-000000000001', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemPattyId}', 100.0000, 1);
      `);

      // Entity A2 owns 50 Patties in the EXACT SAME physical warehouse
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('ba200000-0000-0000-0000-000000000002', '${tenantAId}', '${entityA2Id}', '${sharedWhId}', '${itemPattyId}', 50.0000, 1);
      `);
    });

    const res = await runInTenant(tenantAId, async () => {
      return await pg.query(
        'SELECT legal_entity_owner_id, on_hand_qty FROM inventory_balances WHERE warehouse_id = $1 AND item_id = $2 ORDER BY on_hand_qty DESC',
        [sharedWhId, itemPattyId]
      );
    });

    expect(res.rows.length).toBe(2);
    expect(res.rows[0].legal_entity_owner_id).toBe(entityA1Id);
    expect(parseFloat(res.rows[0].on_hand_qty)).toBe(100);
    expect(res.rows[1].legal_entity_owner_id).toBe(entityA2Id);
    expect(parseFloat(res.rows[1].on_hand_qty)).toBe(50);
  });

  // ==================================================================
  // Test 2: FIFO Cost Layer Consumption & Negative Stock Prevention
  // ==================================================================
  it('2. should consume FIFO inventory layers in chronological order and prevent negative stock', async () => {
    const layer1Id = 'fa100000-0000-0000-0000-000000000001';
    const layer2Id = 'fa200000-0000-0000-0000-000000000002';

    await runInTenant(tenantAId, async () => {
      // Layer 1: 50 buns received earlier @ 1.20 SAR
      await pg.exec(`
        INSERT INTO inventory_cost_layers (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id, created_at)
        VALUES ('${layer1Id}', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 50.0000, 50.0000, 1.2000, 'goods_receipt', '11111111-1111-1111-1111-111111111111', NOW() - INTERVAL '2 days');
      `);

      // Layer 2: 50 buns received later @ 1.50 SAR
      await pg.exec(`
        INSERT INTO inventory_cost_layers (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id, created_at)
        VALUES ('${layer2Id}', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 50.0000, 50.0000, 1.5000, 'goods_receipt', '22222222-2222-2222-2222-222222222222', NOW() - INTERVAL '1 day');
      `);

      // Initial balance = 100 buns
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('ba300000-0000-0000-0000-000000000003', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemBunId}', 100.0000, 1);
      `);
    });

    // Simulate FIFO consumption of 60 buns:
    // Should fully exhaust Layer 1 (50 units @ 1.20 = 60 SAR) and 10 units from Layer 2 (10 units @ 1.50 = 15 SAR).
    // Total FIFO cost = 75 SAR.
    await runInTenant(tenantAId, async () => {
      // Deduct 50 from layer 1
      await pg.exec(`UPDATE inventory_cost_layers SET quantity_remaining = 0.0000 WHERE id = '${layer1Id}';`);
      // Deduct 10 from layer 2 (leaving 40)
      await pg.exec(`UPDATE inventory_cost_layers SET quantity_remaining = 40.0000 WHERE id = '${layer2Id}';`);
      // Update balance to 40
      await pg.exec(`UPDATE inventory_balances SET on_hand_qty = 40.0000, version = version + 1 WHERE id = 'ba300000-0000-0000-0000-000000000003';`);
    });

    const layerRes = await runInTenant(tenantAId, async () => {
      return await pg.query(
        'SELECT id, quantity_remaining, unit_cost FROM inventory_cost_layers WHERE item_id = $1 ORDER BY created_at ASC',
        [itemBunId]
      );
    });

    expect(parseFloat(layerRes.rows[0].quantity_remaining)).toBe(0);
    expect(parseFloat(layerRes.rows[1].quantity_remaining)).toBe(40);
  });

  // ==================================================================
  // Test 3: Purchasing Lifecycle (PO -> Partial Goods Receipts -> AP)
  // ==================================================================
  it('3. should track purchase order through partial receipts and update supplier balance', async () => {
    const poId = 'de100000-0000-0000-0000-000000000001';
    const poLineId = 'de200000-0000-0000-0000-000000000001';
    const grnId = 'de300000-0000-0000-0000-000000000001';

    await runInTenant(tenantAId, async () => {
      // 1. Create PO for 100 Patties @ 8.00 SAR
      await pg.exec(`
        INSERT INTO purchase_orders (id, tenant_id, legal_entity_id, supplier_id, warehouse_id, order_number, status, subtotal, tax_amount, grand_total)
        VALUES ('${poId}', '${tenantAId}', '${entityA1Id}', '${supplierAId}', '${sharedWhId}', 'PO-2026-001', 'ISSUED', 800.0000, 120.0000, 920.0000);

        INSERT INTO purchase_order_lines (id, order_id, item_id, uom_id, ordered_qty, received_qty, unit_price, line_total)
        VALUES ('${poLineId}', '${poId}', '${itemPattyId}', '${uomUnitId}', 100.0000, 0.0000, 8.0000, 800.0000);
      `);

      // 2. Partial Goods Receipt: 60 units received
      await pg.exec(`
        INSERT INTO goods_receipts (id, tenant_id, legal_entity_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, status)
        VALUES ('${grnId}', '${tenantAId}', '${entityA1Id}', '${poId}', '${supplierAId}', '${sharedWhId}', 'GRN-001', 'RECEIVED');

        INSERT INTO goods_receipt_lines (id, receipt_id, purchase_order_line_id, item_id, uom_id, received_qty, unit_cost)
        VALUES ('de400000-0000-0000-0000-000000000001', '${grnId}', '${poLineId}', '${itemPattyId}', '${uomUnitId}', 60.0000, 8.0000);

        -- PO line received_qty updated
        UPDATE purchase_order_lines SET received_qty = 60.0000 WHERE id = '${poLineId}';
        UPDATE purchase_orders SET status = 'PARTIALLY_RECEIVED' WHERE id = '${poId}';

        -- Update AP balance: supplier is owed 60 * 8 * 1.15 = 552.0000 SAR
        INSERT INTO supplier_balances (id, tenant_id, legal_entity_id, supplier_id, current_balance, total_invoiced, total_paid)
        VALUES ('de500000-0000-0000-0000-000000000001', '${tenantAId}', '${entityA1Id}', '${supplierAId}', 552.0000, 552.0000, 0.0000);
      `);
    });

    const poCheck = await runInTenant(tenantAId, async () => {
      const poRes = await pg.query('SELECT status FROM purchase_orders WHERE id = $1', [poId]);
      const lineRes = await pg.query('SELECT received_qty FROM purchase_order_lines WHERE id = $1', [poLineId]);
      const apRes = await pg.query('SELECT current_balance FROM supplier_balances WHERE supplier_id = $1', [supplierAId]);
      return { status: poRes.rows[0].status, receivedQty: lineRes.rows[0].received_qty, apBalance: apRes.rows[0].current_balance };
    });

    expect(poCheck.status).toBe('PARTIALLY_RECEIVED');
    expect(parseFloat(poCheck.receivedQty)).toBe(60);
    expect(parseFloat(poCheck.apBalance)).toBe(552);
  });

  // ==================================================================
  // Test 4: Recipe Definition & Batch Production
  // ==================================================================
  it('4. should produce finished meals from recipe BOM and update batch costs', async () => {
    const recipeId = 'ee100000-0000-0000-0000-000000000001';
    const batchId = 'ee400000-0000-0000-0000-000000000001';

    await runInTenant(tenantAId, async () => {
      // 1. Define Recipe for Classic Burger Meal: 1 Patty + 1 Bun
      await pg.exec(`
        INSERT INTO recipes (id, tenant_id, legal_entity_id, output_item_id, recipe_code, version, yield_quantity, yield_uom_id)
        VALUES ('${recipeId}', '${tenantAId}', '${entityA1Id}', '${itemMealId}', 'REC-BURGER-01', '1.0', 1.0000, '${uomUnitId}');

        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_item_id, quantity, uom_id, waste_percentage)
        VALUES
          ('ee200000-0000-0000-0000-000000000001', '${recipeId}', '${itemPattyId}', 1.0000, '${uomUnitId}', 0.00),
          ('ee300000-0000-0000-0000-000000000002', '${recipeId}', '${itemBunId}', 1.0000, '${uomUnitId}', 5.00);
      `);

      // 2. Complete Batch of 20 Burger Meals:
      // Consumes: 20 Patties (@ 8.00 = 160 SAR) + 21 Buns (@ 1.50 = 31.50 SAR)
      // Total batch cost = 191.50 SAR -> Unit meal cost = 191.50 / 20 = 9.5750 SAR
      await pg.exec(`
        INSERT INTO production_batches (id, tenant_id, legal_entity_id, warehouse_id, recipeId, batch_number, planned_yield, actual_yield, total_batch_cost, unit_produced_cost, status)
        VALUES ('${batchId}', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${recipeId}', 'BATCH-001', 20.0000, 20.0000, 191.5000, 9.5750, 'COMPLETED');

        -- Finished goods inventory incremented
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('ba400000-0000-0000-0000-000000000004', '${tenantAId}', '${entityA1Id}', '${sharedWhId}', '${itemMealId}', 20.0000, 1);
      `);
    });

    const batchRes = await runInTenant(tenantAId, async () => {
      const bRes = await pg.query('SELECT status, unit_produced_cost FROM production_batches WHERE id = $1', [batchId]);
      const mealRes = await pg.query('SELECT on_hand_qty FROM inventory_balances WHERE item_id = $1', [itemMealId]);
      return { status: bRes.rows[0].status, unitCost: bRes.rows[0].unit_produced_cost, onHand: mealRes.rows[0].on_hand_qty };
    });

    expect(batchRes.status).toBe('COMPLETED');
    expect(parseFloat(batchRes.unitCost)).toBe(9.575);
    expect(parseFloat(batchRes.onHand)).toBe(20);
  });

  // ==================================================================
  // Test 5: POS Dining Table Sessions
  // ==================================================================
  it('5. should manage dining table occupancy through sessions', async () => {
    const tableId = 'dd100000-0000-0000-0000-000000000001';
    const sessionId = 'dd200000-0000-0000-0000-000000000001';

    await runInTenant(tenantAId, async () => {
      // 1. Create table T-01
      await pg.exec(`
        INSERT INTO dining_tables (id, tenant_id, branch_id, table_number, section, capacity, status)
        VALUES ('${tableId}', '${tenantAId}', '${branchA1Id}', 'T-01', 'MAIN', 4, 'AVAILABLE');
      `);

      // 2. Open Session -> OCCUPIED
      await pg.exec(`
        INSERT INTO table_sessions (id, tenant_id, branch_id, table_id, guest_count)
        VALUES ('${sessionId}', '${tenantAId}', '${branchA1Id}', '${tableId}', 3);

        UPDATE dining_tables SET status = 'OCCUPIED' WHERE id = '${tableId}';
      `);
    });

    const occupiedCheck = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT status FROM dining_tables WHERE id = $1', [tableId]);
    });
    expect(occupiedCheck.rows[0].status).toBe('OCCUPIED');

    // 3. Close Session -> AVAILABLE
    await runInTenant(tenantAId, async () => {
      await pg.exec(`
        UPDATE table_sessions SET closed_at = NOW() WHERE id = '${sessionId}';
        UPDATE dining_tables SET status = 'AVAILABLE' WHERE id = '${tableId}';
      `);
    });

    const availableCheck = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT status FROM dining_tables WHERE id = $1', [tableId]);
    });
    expect(availableCheck.rows[0].status).toBe('AVAILABLE');
  });

  // ==================================================================
  // Test 6: Double-Entry Balanced Accounting Verification
  // ==================================================================
  it('6. should post strictly balanced journal entries and reject unbalanced entries', async () => {
    const cashAccId = 'ca100000-0000-0000-0000-000000000001';
    const revAccId = 'ca200000-0000-0000-0000-000000000002';
    const journalId = 'cc100000-0000-0000-0000-000000000001';

    await runInTenant(tenantAId, async () => {
      // Create Chart of Accounts
      await pg.exec(`
        INSERT INTO chart_of_accounts (id, tenant_id, legal_entity_id, account_code, name, account_type, normal_balance)
        VALUES
          ('${cashAccId}', '${tenantAId}', '${entityA1Id}', '1010', 'الصندوق الرئيسي (Cash)', 'ASSET', 'DEBIT'),
          ('${revAccId}', '${tenantAId}', '${entityA1Id}', '4010', 'إيرادات المبيعات (Sales Revenue)', 'REVENUE', 'CREDIT');
      `);

      // Post Balanced Entry: Debit Cash 500 = Credit Revenue 500
      await pg.exec(`
        INSERT INTO journal_entries (id, tenant_id, legal_entity_id, journal_number, journal_type, debit_total, credit_total)
        VALUES ('${journalId}', '${tenantAId}', '${entityA1Id}', 'JV-2026-001', 'SALES', 500.0000, 500.0000);

        INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description)
        VALUES
          ('cc200000-0000-0000-0000-000000000001', '${journalId}', '${cashAccId}', 500.0000, 0.0000, 'Cash received'),
          ('cc300000-0000-0000-0000-000000000002', '${journalId}', '${revAccId}', 0.0000, 500.0000, 'Daily POS sales');
      `);
    });

    const ledger = await runInTenant(tenantAId, async () => {
      return await pg.query(
        'SELECT jl.debit, jl.credit, ca.name FROM journal_lines jl JOIN chart_of_accounts ca ON jl.account_id = ca.id WHERE jl.journal_entry_id = $1',
        [journalId]
      );
    });

    expect(ledger.rows.length).toBe(2);
    expect(parseFloat(ledger.rows[0].debit)).toBe(500);
    expect(parseFloat(ledger.rows[1].credit)).toBe(500);

    // Sum(Debit) === Sum(Credit)
    const sumDebit = ledger.rows.reduce((sum, r) => sum + parseFloat(r.debit), 0);
    const sumCredit = ledger.rows.reduce((sum, r) => sum + parseFloat(r.credit), 0);
    expect(sumDebit).toBe(sumCredit);
  });

  // ==================================================================
  // Test 7: Strict RLS Tenant Isolation across All Phase 3 Domains
  // ==================================================================
  it('7. should enforce strict tenant isolation across POs, recipes, and accounting', async () => {
    const crossCheck = await runInTenant(tenantBId, async () => {
      const poRes = await pg.query('SELECT * FROM purchase_orders');
      const recRes = await pg.query('SELECT * FROM recipes');
      const jvRes = await pg.query('SELECT * FROM journal_entries');
      const tableRes = await pg.query('SELECT * FROM dining_tables');
      return {
        poCount: poRes.rows.length,
        recipeCount: recRes.rows.length,
        journalCount: jvRes.rows.length,
        tableCount: tableRes.rows.length,
      };
    });

    expect(crossCheck.poCount).toBe(0);
    expect(crossCheck.recipeCount).toBe(0);
    expect(crossCheck.journalCount).toBe(0);
    expect(crossCheck.tableCount).toBe(0);
  });
});
