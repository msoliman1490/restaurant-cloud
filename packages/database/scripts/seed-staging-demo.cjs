const postgres = require('../node_modules/postgres');
const { randomBytes, scrypt } = require('crypto');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const scryptAsync = promisify(scrypt);

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Connect as migrator/admin to bypass RLS for setup and set up the tenant cleanly
const adminUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
const sql = postgres(adminUrl);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function seedDemo() {
  console.log('================================================================');
  console.log('>>> Seeding Clean Staging Demo Environment (Restaurant Cloud) <<<');
  console.log('================================================================');

  const tenantCode = 'demo-restaurant';
  const ownerEmail = 'demo@restaurantcloud.sa';
  const ownerPassword = 'RestaurantDemo2026!';

  // 1. Check if demo tenant already exists
  const [existingTenant] = await sql`
    SELECT id, code, display_name FROM tenants WHERE code = ${tenantCode} LIMIT 1;
  `;

  let tenantId;
  if (existingTenant) {
    console.log(`[INFO] Tenant '${tenantCode}' already exists (ID: ${existingTenant.id}). Cleaning existing data for fresh demo...`);
    tenantId = existingTenant.id;
  } else {
    const [newTenant] = await sql`
      INSERT INTO tenants (code, display_name, deployment_mode, primary_locale, timezone, status)
      VALUES (
        ${tenantCode},
        'مجموعة مطاعم السحاب التجريبية (Demo Staging)',
        'SHARED',
        'ar-SA',
        'Asia/Riyadh',
        'ACTIVE'
      )
      RETURNING id;
    `;
    tenantId = newTenant.id;
    console.log(`[SUCCESS] Created Demo Tenant: ${tenantCode} (ID: ${tenantId})`);
  }

  // Set session tenant context
  await sql`SELECT set_config('app.current_tenant_id', ${tenantId}::text, false);`;

  // 2. Default Group
  let [group] = await sql`SELECT id FROM groups WHERE tenant_id = ${tenantId} LIMIT 1;`;
  if (!group) {
    [group] = await sql`
      INSERT INTO groups (tenant_id, name, reporting_currency)
      VALUES (${tenantId}, 'مجموعة مطاعم السحاب - الإدارة العامة', 'SAR')
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Group: ${group.id}`);
  }

  // 3. Primary Legal Entity
  let [legalEntity] = await sql`SELECT id FROM legal_entities WHERE tenant_id = ${tenantId} LIMIT 1;`;
  if (!legalEntity) {
    [legalEntity] = await sql`
      INSERT INTO legal_entities (
        tenant_id, group_id, legal_name, commercial_name, vat_number, cr_number, functional_currency, timezone
      )
      VALUES (
        ${tenantId},
        ${group.id},
        'شركة السحاب للمأكولات والضيافة المحدودة',
        'مطاعم وكافيهات السحاب',
        '31099887700003',
        '1010998877',
        'SAR',
        'Asia/Riyadh'
      )
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Legal Entity: ${legalEntity.id}`);
  }

  // 4. Default Chart of Accounts (COA) for Legal Entity
  console.log('[INFO] Ensuring standard Chart of Accounts...');
  const coaAccounts = [
    { code: '111000', nameAr: 'الصناديق والخزائن النقدية', type: 'ASSET', normal: 'DEBIT' },
    { code: '111001', nameAr: 'خزينة الإدارة العامة (الرئيسية)', type: 'ASSET', normal: 'DEBIT', parent: '111000' },
    { code: '111002', nameAr: 'خزينة فرع الرياض (العليا)', type: 'ASSET', normal: 'DEBIT', parent: '111000' },
    { code: '111100', nameAr: 'الحسابات البنكية الجارية', type: 'ASSET', normal: 'DEBIT' },
    { code: '111101', nameAr: 'بنك الراجحي - الحساب التشغيلي', type: 'ASSET', normal: 'DEBIT', parent: '111100' },
    { code: '112000', nameAr: 'مخزون المواد الغذائية والمستودعات', type: 'ASSET', normal: 'DEBIT' },
    { code: '113000', nameAr: 'مراقبة الذمم المدينة (العملاء)', type: 'ASSET', normal: 'DEBIT' },
    { code: '114000', nameAr: 'ضريبة القيمة المضافة المدفوعة (مدخلات)', type: 'ASSET', normal: 'DEBIT' },
    { code: '211000', nameAr: 'مراقبة الذمم الدائنة (الموردين)', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '212000', nameAr: 'ضريبة القيمة المضافة المستحقة (مخرجات)', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '213000', nameAr: 'دفعات مقدمة من العملاء', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '411000', nameAr: 'إيرادات مبيعات المطاعم والمشروبات', type: 'REVENUE', normal: 'CREDIT' },
    { code: '511000', nameAr: 'تكلفة البضاعة المباعة (COGS)', type: 'EXPENSE', normal: 'DEBIT' },
    { code: '512000', nameAr: 'فروقات وتوالف الجرد المخزني', type: 'EXPENSE', normal: 'DEBIT' },
  ];

  const coaMap = {};
  for (const acc of coaAccounts) {
    const parentId = acc.parent ? coaMap[acc.parent] : null;
    let [existingAcc] = await sql`
      SELECT id FROM chart_of_accounts 
      WHERE tenant_id = ${tenantId} AND legal_entity_id = ${legalEntity.id} AND account_code = ${acc.code};
    `;
    if (!existingAcc) {
      [existingAcc] = await sql`
        INSERT INTO chart_of_accounts (
          tenant_id, legal_entity_id, account_code, name, name_ar, account_type, normal_balance, parent_id, is_postable, is_system
        )
        VALUES (
          ${tenantId}, ${legalEntity.id}, ${acc.code}, ${acc.nameAr}, ${acc.nameAr}, ${acc.type}, ${acc.normal}, ${parentId}, true, true
        )
        RETURNING id;
      `;
    }
    coaMap[acc.code] = existingAcc.id;
  }

  // 5. Branches
  let [branch] = await sql`
    SELECT id FROM branches WHERE tenant_id = ${tenantId} AND code = 'BR-01' LIMIT 1;
  `;
  if (!branch) {
    [branch] = await sql`
      INSERT INTO branches (
        tenant_id, legal_entity_id, code, name, business_type, timezone
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, 'BR-01', 'فرع الرياض الرئيسي (العليا)', 'RESTAURANT', 'Asia/Riyadh'
      )
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Branch: ${branch.id}`);
  }

  // 6. Warehouses
  let [whMain] = await sql`
    SELECT id FROM warehouses WHERE tenant_id = ${tenantId} AND code = 'WH-MAIN' LIMIT 1;
  `;
  if (!whMain) {
    [whMain] = await sql`
      INSERT INTO warehouses (
        tenant_id, legal_entity_id, code, name, name_ar, warehouse_type, status, allow_receiving, allow_issuing, allow_transfer
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, 'WH-MAIN', 'المستودع الرئيسي (الملز)', 'المستودع الرئيسي (الملز)', 'MAIN', 'ACTIVE', true, true, true
      )
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Main Warehouse: ${whMain.id}`);
  }

  let [whKitchen] = await sql`
    SELECT id FROM warehouses WHERE tenant_id = ${tenantId} AND code = 'WH-KITCHEN' LIMIT 1;
  `;
  if (!whKitchen) {
    [whKitchen] = await sql`
      INSERT INTO warehouses (
        tenant_id, legal_entity_id, branch_id, code, name, name_ar, warehouse_type, status, allow_receiving, allow_issuing, allow_transfer
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, ${branch.id}, 'WH-KITCHEN', 'مستودع تشغيل المطبخ (فرع العليا)', 'مستودع تشغيل المطبخ (فرع العليا)', 'BRANCH', 'ACTIVE', true, true, true
      )
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Kitchen Warehouse: ${whKitchen.id}`);
  }

  // 7. Admin / Owner User
  const passwordHash = await hashPassword(ownerPassword);
  let [user] = await sql`SELECT id FROM users WHERE email = ${ownerEmail} LIMIT 1;`;
  if (!user) {
    [user] = await sql`
      INSERT INTO users (email, display_name, password_hash, phone, status)
      VALUES (
        ${ownerEmail}, 'مالك المشروع - المدير العام', ${passwordHash}, '+966500000001', 'ACTIVE'
      )
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Owner User: ${user.id} (${ownerEmail})`);
  } else {
    // Update password hash to guarantee match
    await sql`
      UPDATE users SET password_hash = ${passwordHash}, status = 'ACTIVE' WHERE id = ${user.id};
    `;
    console.log(`[INFO] Updated Owner User password hash.`);
  }

  // 8. Owner Role & Permissions
  let [ownerRole] = await sql`
    SELECT id FROM roles WHERE tenant_id = ${tenantId} AND code = 'TENANT_OWNER' LIMIT 1;
  `;
  if (!ownerRole) {
    [ownerRole] = await sql`
      INSERT INTO roles (tenant_id, code, name, is_system_role)
      VALUES (${tenantId}, 'TENANT_OWNER', 'مالك المنشأة (Owner)', true)
      RETURNING id;
    `;
  }

  let [wildcardPerm] = await sql`SELECT id FROM permissions WHERE code = '*' LIMIT 1;`;
  if (!wildcardPerm) {
    [wildcardPerm] = await sql`
      INSERT INTO permissions (code, resource, action, description)
      VALUES ('*', 'all', 'all', 'Full Superadmin Permissions')
      RETURNING id;
    `;
  }

  await sql`
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (${ownerRole.id}, ${wildcardPerm.id})
    ON CONFLICT DO NOTHING;
  `;

  // 9. User Membership
  let [membership] = await sql`
    SELECT id FROM user_memberships WHERE tenant_id = ${tenantId} AND user_id = ${user.id} LIMIT 1;
  `;
  if (!membership) {
    [membership] = await sql`
      INSERT INTO user_memberships (tenant_id, user_id, role_id, status)
      VALUES (${tenantId}, ${user.id}, ${ownerRole.id}, 'ACTIVE')
      RETURNING id;
    `;
    console.log(`[SUCCESS] Created Membership: ${membership.id}`);
  } else {
    await sql`
      UPDATE user_memberships SET role_id = ${ownerRole.id}, status = 'ACTIVE' WHERE id = ${membership.id};
    `;
  }

  // 10. Categories
  console.log('[INFO] Seeding Categories...');
  const categoriesList = [
    { code: 'CAT-BURGER', nameAr: 'البرجر والوجبات الرئيسية', nameEn: 'Burgers & Meals' },
    { code: 'CAT-APPETIZERS', nameAr: 'المقبلات والوجبات الخفيفة', nameEn: 'Appetizers & Snacks' },
    { code: 'CAT-BEVERAGES', nameAr: 'المشروبات والعصائر', nameEn: 'Beverages' },
    { code: 'CAT-RAW', nameAr: 'المواد الخام والتجهيز', nameEn: 'Raw Materials' },
  ];

  const catMap = {};
  for (const cat of categoriesList) {
    let [c] = await sql`
      SELECT id FROM categories WHERE tenant_id = ${tenantId} AND code = ${cat.code} LIMIT 1;
    `;
    if (!c) {
      [c] = await sql`
        INSERT INTO categories (tenant_id, code, name_ar, name_en, is_active)
        VALUES (${tenantId}, ${cat.code}, ${cat.nameAr}, ${cat.nameEn}, true)
        RETURNING id;
      `;
    }
    catMap[cat.code] = c.id;
  }

  // 11. Units of Measure
  console.log('[INFO] Seeding Units of Measure...');
  const uomsList = [
    { code: 'KG', nameAr: 'كيلوجرام', nameEn: 'Kilogram', category: 'MASS', isBase: true },
    { code: 'G', nameAr: 'جرام', nameEn: 'Gram', category: 'MASS', isBase: false },
    { code: 'UNIT', nameAr: 'حبة / قطعة', nameEn: 'Unit', category: 'UNIT', isBase: true },
    { code: 'BOX', nameAr: 'كرتون', nameEn: 'Box', category: 'PACK', isBase: false },
  ];

  const uomMap = {};
  for (const u of uomsList) {
    let [row] = await sql`
      SELECT id FROM units_of_measure WHERE tenant_id = ${tenantId} AND code = ${u.code} LIMIT 1;
    `;
    if (!row) {
      [row] = await sql`
        INSERT INTO units_of_measure (tenant_id, code, name_ar, name_en, category, is_base, is_active)
        VALUES (${tenantId}, ${u.code}, ${u.nameAr}, ${u.nameEn}, ${u.category}, ${u.isBase}, true)
        RETURNING id;
      `;
    }
    uomMap[u.code] = row.id;
  }

  // 12. Items & Recipes
  console.log('[INFO] Seeding Catalog Items...');
  const demoItems = [
    {
      sku: 'BRG-001',
      nameAr: 'برجر أنجوس كلاسيك (شريحة خام)',
      nameEn: 'Black Angus Beef Patty (Raw)',
      cat: 'CAT-RAW',
      uom: 'KG',
      costingMethod: 'FIFO',
      cost: '14.5000',
      price: '0.0000',
      isPurchased: true,
      isSold: false,
    },
    {
      sku: 'BRG-002',
      nameAr: 'برجر دجاج كرسبي مقرمش',
      nameEn: 'Crispy Chicken Patty',
      cat: 'CAT-RAW',
      uom: 'KG',
      costingMethod: 'FIFO',
      cost: '11.0000',
      price: '0.0000',
      isPurchased: true,
      isSold: false,
    },
    {
      sku: 'RAW-001',
      nameAr: 'جبن شيدر أصفر شرائح (كجم)',
      nameEn: 'Cheddar Cheese Slices',
      cat: 'CAT-RAW',
      uom: 'KG',
      costingMethod: 'FIFO',
      cost: '28.0000',
      price: '0.0000',
      isPurchased: true,
      isSold: false,
    },
    {
      sku: 'BEV-001',
      nameAr: 'كوكاكولا عبوة معدنية 330 مل',
      nameEn: 'Coca Cola Can 330ml',
      cat: 'CAT-BEVERAGES',
      uom: 'UNIT',
      costingMethod: 'WEIGHTED_AVERAGE',
      cost: '2.2000',
      price: '6.0000',
      isPurchased: true,
      isSold: true,
    },
    {
      sku: 'POS-MEAL-01',
      nameAr: 'وجبة أنجوس برجر الكلاسيكية',
      nameEn: 'Classic Angus Burger Meal',
      cat: 'CAT-BURGER',
      uom: 'UNIT',
      costingMethod: 'WEIGHTED_AVERAGE',
      cost: '18.5000',
      price: '45.0000',
      isPurchased: false,
      isSold: true,
    },
  ];

  const itemMap = {};
  for (const item of demoItems) {
    let [it] = await sql`
      SELECT id FROM items WHERE tenant_id = ${tenantId} AND sku = ${item.sku} LIMIT 1;
    `;
    if (!it) {
      [it] = await sql`
        INSERT INTO items (
          tenant_id, legal_entity_owner_id, category_id, base_uom_id, sku, name_ar, name_en,
          product_type, costing_method, default_cost, default_price, is_purchased, is_sold, is_active
        )
        VALUES (
          ${tenantId}, ${legalEntity.id}, ${catMap[item.cat]}, ${uomMap[item.uom]}, ${item.sku},
          ${item.nameAr}, ${item.nameEn}, 'STOCKED', ${item.costingMethod}, ${item.cost},
          ${item.price}, ${item.isPurchased}, ${item.isSold}, true
        )
        RETURNING id;
      `;
    }
    itemMap[item.sku] = it.id;
  }

  // 13. Inventory Balances & Cost Layers
  console.log('[INFO] Seeding Inventory Balances & FIFO Cost Layers...');
  const balancesSetup = [
    // Main Warehouse
    { wh: whMain.id, item: 'BRG-001', onHand: '450.0000', cost: '14.5000', reserved: '30.0000' },
    { wh: whMain.id, item: 'BRG-002', onHand: '300.0000', cost: '11.0000', reserved: '0.0000' },
    { wh: whMain.id, item: 'RAW-001', onHand: '80.0000', cost: '28.0000', reserved: '0.0000' },
    { wh: whMain.id, item: 'BEV-001', onHand: '1200.0000', cost: '2.2000', reserved: '100.0000' },
    // Kitchen Warehouse
    { wh: whKitchen.id, item: 'BRG-001', onHand: '85.0000', cost: '14.5000', reserved: '5.0000' },
    { wh: whKitchen.id, item: 'BRG-002', onHand: '50.0000', cost: '11.0000', reserved: '0.0000' },
    { wh: whKitchen.id, item: 'RAW-001', onHand: '15.0000', cost: '28.0000', reserved: '0.0000' },
    { wh: whKitchen.id, item: 'BEV-001', onHand: '350.0000', cost: '2.2000', reserved: '15.0000' },
  ];

  for (const b of balancesSetup) {
    const itemId = itemMap[b.item];

    let [bal] = await sql`
      SELECT id FROM inventory_balances 
      WHERE tenant_id = ${tenantId} AND warehouse_id = ${b.wh} AND item_id = ${itemId} LIMIT 1;
    `;

    if (!bal) {
      await sql`
        INSERT INTO inventory_balances (
          tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, reserved_qty,
          wac_cost, min_stock, max_stock, reorder_point
        )
        VALUES (
          ${tenantId}, ${legalEntity.id}, ${b.wh}, ${itemId}, ${b.onHand}, ${b.reserved},
          ${b.cost}, 20.0000, 1000.0000, 50.0000
        );
      `;
    } else {
      await sql`
        UPDATE inventory_balances 
        SET on_hand_qty = ${b.onHand}, reserved_qty = ${b.reserved}, wac_cost = ${b.cost}
        WHERE id = ${bal.id};
      `;
    }

    // Insert FIFO Cost Layer
    await sql`
      INSERT INTO inventory_cost_layers (
        tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, ${b.wh}, ${itemId}, ${b.onHand}, ${b.onHand}, ${b.cost}, 'OPENING_BALANCE', ${legalEntity.id}
      );
    `;
  }

  // 14. Cash Vaults
  console.log('[INFO] Seeding Cash Vaults...');
  const vaultsList = [
    { code: 'VLT-HQ', nameAr: 'خزينة الإدارة العامة (الرئيسية)', acc: '111001', bal: '50000.0000', branch: null },
    { code: 'VLT-OLAYA', nameAr: 'خزينة فرع الرياض (العليا)', acc: '111002', bal: '10000.0000', branch: branch.id },
  ];

  for (const v of vaultsList) {
    let [vRow] = await sql`
      SELECT id FROM cash_vaults WHERE tenant_id = ${tenantId} AND code = ${v.code} LIMIT 1;
    `;
    if (!vRow) {
      await sql`
        INSERT INTO cash_vaults (
          tenant_id, legal_entity_id, branch_id, code, name_ar, name_en, account_id, balance, status
        )
        VALUES (
          ${tenantId}, ${legalEntity.id}, ${v.branch}, ${v.code}, ${v.nameAr}, ${v.nameAr},
          ${coaMap[v.acc]}, ${v.bal}, 'ACTIVE'
        );
      `;
    }
  }

  // 15. Sample WMS Phase B Transfer
  console.log('[INFO] Seeding Demo Stock Transfer...');
  const [trf] = await sql`
    SELECT id FROM stock_transfers WHERE tenant_id = ${tenantId} AND transfer_number = 'TRF-2026-DEMO01' LIMIT 1;
  `;
  if (!trf) {
    const [newTrf] = await sql`
      INSERT INTO stock_transfers (
        tenant_id, legal_entity_id, source_warehouse_id, destination_warehouse_id, transfer_number,
        status, total_shipped_qty, notes
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, ${whMain.id}, ${whKitchen.id}, 'TRF-2026-DEMO01',
        'IN_TRANSIT', 40.0000, 'شحنة تجريبية مبردة في الطريق إلى فرع العليا'
      )
      RETURNING id;
    `;

    await sql`
      INSERT INTO stock_transfer_lines (
        transfer_id, item_id, uom_id, quantity, dispatched_quantity, unit_cost
      )
      VALUES (
        ${newTrf.id}, ${itemMap['BRG-001']}, ${uomMap['KG']}, 40.0000, 40.0000, 14.5000
      );
    `;
  }

  // 16. Sample Stocktake Order
  console.log('[INFO] Seeding Demo Stocktake Order...');
  const [stk] = await sql`
    SELECT id FROM stocktake_orders WHERE tenant_id = ${tenantId} AND order_number = 'STK-2026-DEMO01' LIMIT 1;
  `;
  if (!stk) {
    const [newStk] = await sql`
      INSERT INTO stocktake_orders (
        tenant_id, legal_entity_id, warehouse_id, order_number, stocktake_type, count_frequency,
        status, freeze_movements, notes
      )
      VALUES (
        ${tenantId}, ${legalEntity.id}, ${whKitchen.id}, 'STK-2026-DEMO01', 'FULL', 'PERIODIC',
        'IN_PROGRESS', true, 'جرد تشغيلي ربع سنوي لمستودع المطبخ'
      )
      RETURNING id;
    `;

    await sql`
      INSERT INTO stocktake_lines (
        tenant_id, stocktake_id, item_id, uom_id, system_quantity, difference_quantity, unit_cost, variance_amount
      )
      VALUES (
        ${tenantId}, ${newStk.id}, ${itemMap['BRG-001']}, ${uomMap['KG']}, 85.0000, 0.0000, 14.5000, 0.0000
      );
    `;
  }

  console.log('================================================================');
  console.log('>>> [SUCCESS] Demo Staging Environment Seeded Successfully! <<<');
  console.log('================================================================');
  console.log(`Tenant Code:  ${tenantCode}`);
  console.log(`Owner Email:  ${ownerEmail}`);
  console.log(`Password:     ${ownerPassword}`);
  console.log('================================================================');

  await sql.end();
}

seedDemo().catch(err => {
  console.error('Fatal Seeding Error:', err);
  process.exit(1);
});
