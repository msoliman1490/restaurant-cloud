import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Phase 2 — Catalog & Inventory Engine Verification', () => {
  let pg: PGlite;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const entityAId = 'a1111111-1111-1111-1111-111111111111';
  const branchA1Id = 'ab111111-1111-1111-1111-111111111111';
  const whA1Id = 'ad111111-1111-1111-1111-111111111111';
  const whA2Id = 'ad222222-2222-2222-2222-222222222222';
  const uomPieceId = 'ac000000-0000-0000-0000-000000000001';
  const catBurgersId = 'c0000000-0000-0000-0000-000000000001';
  const itemBurgerId = 'aa000000-0000-0000-0000-000000000001';

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

    // 1. Create Core Schemas
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

      CREATE TABLE categories (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        parent_id UUID REFERENCES categories(id),
        code VARCHAR(50) NOT NULL,
        name_ar VARCHAR(255) NOT NULL,
        name_en VARCHAR(255) NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT uq_cat_tenant_code UNIQUE (tenant_id, code)
      );

      CREATE TABLE units_of_measure (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(20) NOT NULL,
        name_ar VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NOT NULL,
        category VARCHAR(30) NOT NULL DEFAULT 'UNIT',
        is_base BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT uq_uom_tenant_code UNIQUE (tenant_id, code)
      );

      CREATE TABLE items (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        category_id UUID REFERENCES categories(id),
        base_uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        sku VARCHAR(50) NOT NULL,
        barcode VARCHAR(100),
        name_ar VARCHAR(255) NOT NULL,
        name_en VARCHAR(255) NOT NULL,
        product_type VARCHAR(30) NOT NULL DEFAULT 'STOCKED',
        costing_method VARCHAR(30) NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
        default_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        default_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500,
        is_sold BOOLEAN NOT NULL DEFAULT TRUE,
        is_purchased BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT uq_item_tenant_sku UNIQUE (tenant_id, sku)
      );

      CREATE TABLE branch_item_prices (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        item_id UUID NOT NULL REFERENCES items(id),
        price NUMERIC(14, 4) NOT NULL,
        cost_override NUMERIC(14, 4),
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT uq_bip_branch_item UNIQUE (branch_id, item_id)
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
        CONSTRAINT uq_inv_balance UNIQUE (warehouse_id, item_id)
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
        source_id UUID NOT NULL
      );

      CREATE TABLE stock_transfers (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        transfer_number VARCHAR(50) NOT NULL,
        source_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        destination_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        CONSTRAINT uq_st_entity_number UNIQUE (legal_entity_id, transfer_number)
      );

      CREATE TABLE stock_transfer_lines (
        id UUID PRIMARY KEY,
        transfer_id UUID NOT NULL REFERENCES stock_transfers(id),
        item_id UUID NOT NULL REFERENCES items(id),
        uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        quantity NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        received_quantity NUMERIC(14, 4)
      );

      CREATE TABLE stock_adjustments (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL REFERENCES warehouses(id),
        adjustment_number VARCHAR(50) NOT NULL,
        reason VARCHAR(50) NOT NULL DEFAULT 'PHYSICAL_COUNT',
        CONSTRAINT uq_sa_entity_number UNIQUE (legal_entity_id, adjustment_number)
      );

      CREATE TABLE stock_adjustment_lines (
        id UUID PRIMARY KEY,
        adjustment_id UUID NOT NULL REFERENCES stock_adjustments(id),
        item_id UUID NOT NULL REFERENCES items(id),
        uom_id UUID NOT NULL REFERENCES units_of_measure(id),
        system_quantity NUMERIC(14, 4) NOT NULL,
        counted_quantity NUMERIC(14, 4) NOT NULL,
        difference_quantity NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(14, 4) NOT NULL,
        total_variance_amount NUMERIC(14, 4) NOT NULL
      );
    `);

    // Enable and force RLS on all tenant-owned tables
    const tenantTables = [
      'categories',
      'units_of_measure',
      'items',
      'branch_item_prices',
      'inventory_balances',
      'inventory_movements',
      'stock_transfers',
      'stock_adjustments',
    ];

    for (const table of tenantTables) {
      await pg.exec(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
      `);
    }

    // Create non-superuser runtime role
    await pg.exec(`
      CREATE ROLE rc_app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
    `);

    // Seed Tenants & Infrastructure
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
        ('${tenantAId}', 'tenant-a', 'مطاعم النخبة أ'),
        ('${tenantBId}', 'tenant-b', 'كافيهات العاصمة ب');

      INSERT INTO legal_entities (id, tenant_id, legal_name) VALUES
        ('${entityAId}', '${tenantAId}', 'شركة النخبة للأغذية ذ.م.م');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
        ('${branchA1Id}', '${tenantAId}', '${entityAId}', 'BR-01', 'فرع الرياض العليا');

      INSERT INTO warehouses (id, tenant_id, branch_id, code, name) VALUES
        ('${whA1Id}', '${tenantAId}', '${branchA1Id}', 'WH-01', 'مستودع الفرع الرئيسي'),
        ('${whA2Id}', '${tenantAId}', NULL, 'WH-CENTRAL', 'المستودع المركزي بالملز');
    `);
  });

  it('1. should allow creating UoM, Category, and Item under Tenant A', async () => {
    await runInTenant(tenantAId, async () => {
      // UoM
      await pg.exec(`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en, category, is_base)
        VALUES ('${uomPieceId}', '${tenantAId}', 'PCS', 'حبة', 'Piece', 'UNIT', TRUE);
      `);

      // Category
      await pg.exec(`
        INSERT INTO categories (id, tenant_id, code, name_ar, name_en, display_order)
        VALUES ('${catBurgersId}', '${tenantAId}', 'BURGERS', 'برجر', 'Burgers', 1);
      `);

      // Item
      await pg.exec(`
        INSERT INTO items (id, tenant_id, legal_entity_owner_id, category_id, base_uom_id, sku, barcode, name_ar, name_en, default_cost, default_price, tax_rate)
        VALUES ('${itemBurgerId}', '${tenantAId}', '${entityAId}', '${catBurgersId}', '${uomPieceId}', 'BRG-CLASSIC', '628100000001', 'برجر كلاسيك لحم', 'Classic Beef Burger', 12.0000, 30.0000, 0.1500);
      `);
    });

    const res = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT * FROM items WHERE id = $1', [itemBurgerId]);
    });

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name_en).toBe('Classic Beef Burger');
    expect(parseFloat(res.rows[0].default_price)).toBe(30);
  });

  it('2. should enforce unique SKU per tenant, but allow same SKU in different tenants', async () => {
    // Attempting same SKU in same tenant should fail
    await expect(
      runInTenant(tenantAId, async () => {
        await pg.exec(`
          INSERT INTO items (id, tenant_id, legal_entity_owner_id, category_id, base_uom_id, sku, name_ar, name_en, default_cost, default_price)
          VALUES ('ee000000-0000-0000-0000-000000000002', '${tenantAId}', '${entityAId}', '${catBurgersId}', '${uomPieceId}', 'BRG-CLASSIC', 'برجر مكرر', 'Duplicate', 10, 25);
        `);
      })
    ).rejects.toThrow();

    // Tenant B can create their own UoM and Item with same SKU 'BRG-CLASSIC'
    const tenantBUomId = 'eb000000-0000-0000-0000-000000000002';
    const tenantBItemId = 'ee000000-0000-0000-0000-000000000003';

    await pg.exec(`
      INSERT INTO legal_entities (id, tenant_id, legal_name) VALUES
        ('b1111111-1111-1111-1111-111111111111', '${tenantBId}', 'مؤسسة العاصمة');
    `);

    await runInTenant(tenantBId, async () => {
      await pg.exec(`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES ('${tenantBUomId}', '${tenantBId}', 'PCS', 'قطعة', 'Piece');

        INSERT INTO items (id, tenant_id, legal_entity_owner_id, base_uom_id, sku, name_ar, name_en, default_price)
        VALUES ('${tenantBItemId}', '${tenantBId}', 'b1111111-1111-1111-1111-111111111111', '${tenantBUomId}', 'BRG-CLASSIC', 'برجر العاصمة', 'Capital Burger', 35.0000);
      `);
    });

    const bRes = await runInTenant(tenantBId, async () => {
      return await pg.query('SELECT sku, name_en FROM items WHERE id = $1', [tenantBItemId]);
    });
    expect(bRes.rows[0].sku).toBe('BRG-CLASSIC');
    expect(bRes.rows[0].name_en).toBe('Capital Burger');
  });

  it('3. should support branch-specific price overrides over default price', async () => {
    const bipId = 'b1000000-0000-0000-0000-000000000001';

    // Set branch price override for Branch A1 (34 SAR instead of 30 SAR default)
    await runInTenant(tenantAId, async () => {
      await pg.exec(`
        INSERT INTO branch_item_prices (id, tenant_id, branch_id, item_id, price)
        VALUES ('${bipId}', '${tenantAId}', '${branchA1Id}', '${itemBurgerId}', 34.0000);
      `);
    });

    // Query effective price using SQL LEFT JOIN
    const result = await runInTenant(tenantAId, async () => {
      return await pg.query(`
        SELECT
          i.id,
          i.name_en,
          i.default_price,
          COALESCE(bip.price, i.default_price) AS effective_price,
          (bip.price IS NOT NULL) AS has_override
        FROM items i
        LEFT JOIN branch_item_prices bip
          ON bip.item_id = i.id AND bip.branch_id = '${branchA1Id}'
        WHERE i.id = '${itemBurgerId}';
      `);
    });

    expect(parseFloat(result.rows[0].default_price)).toBe(30);
    expect(parseFloat(result.rows[0].effective_price)).toBe(34);
    expect(result.rows[0].has_override).toBe(true);
  });

  it('4. should track initial inventory balance and stock adjustments', async () => {
    const balanceId = 'ba000000-0000-0000-0000-000000000001';
    const adjId = 'da000000-0000-0000-0000-000000000001';
    const adjLineId = 'dc000000-0000-0000-0000-000000000001';

    await runInTenant(tenantAId, async () => {
      // 1. Initial stock balance: 50 burgers in Central Warehouse (whA2Id)
      await pg.exec(`
        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('${balanceId}', '${tenantAId}', '${entityAId}', '${whA2Id}', '${itemBurgerId}', 50.0000, 1);
      `);

      // 2. Physical count adjustment: counted 48 (2 lost/damaged)
      await pg.exec(`
        INSERT INTO stock_adjustments (id, tenant_id, legal_entity_id, warehouse_id, adjustment_number, reason)
        VALUES ('${adjId}', '${tenantAId}', '${entityAId}', '${whA2Id}', 'ADJ-2026-001', 'DAMAGE');

        INSERT INTO stock_adjustment_lines (id, adjustment_id, item_id, uom_id, system_quantity, counted_quantity, difference_quantity, unit_cost, total_variance_amount)
        VALUES ('${adjLineId}', '${adjId}', '${itemBurgerId}', '${uomPieceId}', 50.0000, 48.0000, -2.0000, 12.0000, 24.0000);

        UPDATE inventory_balances
        SET on_hand_qty = 48.0000, version = version + 1
        WHERE id = '${balanceId}';

        INSERT INTO inventory_movements (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, movement_type, direction, quantity, unit_cost, source_type, source_id)
        VALUES ('ea000000-0000-0000-0000-000000000001', '${tenantAId}', '${entityAId}', '${whA2Id}', '${itemBurgerId}', 'STOCK_ADJUSTMENT', 'OUT', 2.0000, 12.0000, 'stock_adjustment', '${adjId}');
      `);
    });

    const balRes = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT on_hand_qty, version FROM inventory_balances WHERE id = $1', [balanceId]);
    });
    expect(parseFloat(balRes.rows[0].on_hand_qty)).toBe(48);
    expect(balRes.rows[0].version).toBe(2);
  });

  it('5. should execute atomic stock transfer from Central WH to Branch WH', async () => {
    const transferId = 'de000000-0000-0000-0000-000000000001';
    const transferLineId = 'df000000-0000-0000-0000-000000000001';
    const destBalanceId = 'ba000000-0000-0000-0000-000000000002';

    await runInTenant(tenantAId, async () => {
      // 1. Create Transfer Draft for 20 burgers
      await pg.exec(`
        INSERT INTO stock_transfers (id, tenant_id, legal_entity_id, transfer_number, source_warehouse_id, destination_warehouse_id, status)
        VALUES ('${transferId}', '${tenantAId}', '${entityAId}', 'TRF-001', '${whA2Id}', '${whA1Id}', 'DRAFT');

        INSERT INTO stock_transfer_lines (id, transfer_id, item_id, uom_id, quantity, unit_cost)
        VALUES ('${transferLineId}', '${transferId}', '${itemBurgerId}', '${uomPieceId}', 20.0000, 12.0000);
      `);

      // 2. Dispatch Transfer: Status -> IN_TRANSIT, Source balance - 20 (from 48 down to 28)
      await pg.exec(`
        UPDATE stock_transfers SET status = 'IN_TRANSIT' WHERE id = '${transferId}';

        UPDATE inventory_balances
        SET on_hand_qty = on_hand_qty - 20.0000, version = version + 1
        WHERE warehouse_id = '${whA2Id}' AND item_id = '${itemBurgerId}';

        INSERT INTO inventory_movements (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, movement_type, direction, quantity, unit_cost, source_type, source_id)
        VALUES ('ea000000-0000-0000-0000-000000000002', '${tenantAId}', '${entityAId}', '${whA2Id}', '${itemBurgerId}', 'TRANSFER_OUT', 'OUT', 20.0000, 12.0000, 'stock_transfer', '${transferId}');
      `);

      // 3. Receive Transfer: Status -> RECEIVED, Destination balance + 20
      await pg.exec(`
        UPDATE stock_transfers SET status = 'RECEIVED' WHERE id = '${transferId}';

        UPDATE stock_transfer_lines SET received_quantity = 20.0000 WHERE id = '${transferLineId}';

        INSERT INTO inventory_balances (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES ('${destBalanceId}', '${tenantAId}', '${entityAId}', '${whA1Id}', '${itemBurgerId}', 20.0000, 1);

        INSERT INTO inventory_movements (id, tenant_id, legal_entity_owner_id, warehouse_id, item_id, movement_type, direction, quantity, unit_cost, source_type, source_id)
        VALUES ('ea000000-0000-0000-0000-000000000003', '${tenantAId}', '${entityAId}', '${whA1Id}', '${itemBurgerId}', 'TRANSFER_IN', 'IN', 20.0000, 12.0000, 'stock_transfer', '${transferId}');
      `);
    });

    // Verify source WH balance is 28
    const sourceBal = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT on_hand_qty FROM inventory_balances WHERE warehouse_id = $1 AND item_id = $2', [whA2Id, itemBurgerId]);
    });
    expect(parseFloat(sourceBal.rows[0].on_hand_qty)).toBe(28);

    // Verify destination WH balance is 20
    const destBal = await runInTenant(tenantAId, async () => {
      return await pg.query('SELECT on_hand_qty FROM inventory_balances WHERE warehouse_id = $1 AND item_id = $2', [whA1Id, itemBurgerId]);
    });
    expect(parseFloat(destBal.rows[0].on_hand_qty)).toBe(20);

    // Total stock across both warehouses = 28 + 20 = 48 (perfect conservation of inventory mass)
    expect(parseFloat(sourceBal.rows[0].on_hand_qty) + parseFloat(destBal.rows[0].on_hand_qty)).toBe(48);
  });

  it('6. should enforce strict RLS isolation: Tenant B cannot see Tenant A items or balances', async () => {
    const crossQuery = await runInTenant(tenantBId, async () => {
      const itemsRes = await pg.query('SELECT * FROM items WHERE id = $1', [itemBurgerId]);
      const balRes = await pg.query('SELECT * FROM inventory_balances WHERE item_id = $1', [itemBurgerId]);
      return { itemsCount: itemsRes.rows.length, balCount: balRes.rows.length };
    });

    expect(crossQuery.itemsCount).toBe(0);
    expect(crossQuery.balCount).toBe(0);
  });
});
