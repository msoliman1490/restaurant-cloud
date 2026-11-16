import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { ProductionService } from '../src/modules/production/production.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { DiningService } from '../src/modules/dining/dining.service';
import { DiningController } from '../src/modules/dining/dining.controller';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  TenantContext,
  ProductType,
  CostingMethod,
  TableStatus,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  accountMappings,
  fiscalPeriods,
  devices,
  cashVaults,
  journalEntries,
  inventoryBalances,
  unitsOfMeasure,
} from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';

describe('Restaurant Cloud — Dining, Tables, KDS & Integrated Checkout', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let catalogService: CatalogService;
  let inventoryService: InventoryService;
  let diningService: DiningService;

  let tenantAId: string;
  let leA1Id: string;
  let branchA1Id: string;
  let whA1Id: string;
  let deviceA1Id: string;
  let uomId: string;
  let burgerItemId: string;
  let friesItemId: string;

  let ctxA: TenantContext;
  let ctxB: TenantContext;

  let table1Id: string;
  let table2Id: string;
  let table3Id: string;

  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    const opsService = new OperationsFrameworkService(dbService, auditService);
    const postingEngine = new PostingEngineService(dbService, auditService);
    const accountingService = new AccountingService(dbService, auditService, opsService);
    catalogService = new CatalogService(dbService, auditService, opsService);
    inventoryService = new InventoryService(dbService, auditService, postingEngine, opsService);
    const productionService = new ProductionService(dbService, auditService, postingEngine, opsService);
    const salesService = new SalesService(
      dbService,
      auditService,
      productionService,
      accountingService,
      postingEngine,
      opsService,
    );
    diningService = new DiningService(dbService, auditService, salesService, opsService);

    const tA = await tenantService.onboardTenant({
      code: `din-a-${suffix}`,
      displayName: `مطعم الصالة أ - ${suffix}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الصالة أ المحدودة',
        commercialName: 'الصالة أ',
        vatNumber: '310444555600003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-DIN-A1',
        name: 'فرع الصالة أ',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `din-a-${suffix}@rc-staging.local`,
        displayName: 'مدير الصالة أ',
        password: 'Password123!',
      },
    });
    tenantAId = tA.tenant.id;
    leA1Id = tA.legalEntity.id;
    branchA1Id = tA.branch.id;
    ctxA = {
      tenantId: tenantAId,
      userId: tA.user.id,
      roles: ['OWNER'],
      permissions: ['*'],
      deploymentMode: 'SHARED' as any,
      locale: 'ar-SA',
    };

    const tB = await tenantService.onboardTenant({
      code: `din-b-${suffix}`,
      displayName: `مطعم الصالة ب - ${suffix}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الصالة ب المحدودة',
        commercialName: 'الصالة ب',
        vatNumber: '310777888900003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-DIN-B1',
        name: 'فرع الصالة ب',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `din-b-${suffix}@rc-staging.local`,
        displayName: 'مدير الصالة ب',
        password: 'Password123!',
      },
    });
    ctxB = {
      tenantId: tB.tenant.id,
      userId: tB.user.id,
      roles: ['OWNER'],
      permissions: ['*'],
      deploymentMode: 'SHARED' as any,
      locale: 'ar-SA',
    };

    // Setup warehouse, device, cash vault, fiscal period, COA mappings, UOM, and 2 items
    await dbService.withTenantContext(ctxA, async (tx) => {
      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({ tenantId: tenantAId, code: `PCS-${suffix}`, nameAr: 'حبة', nameEn: 'Piece', uomType: 'COUNT' })
        .returning();
      uomId = uom!.id;

      const accDefs = [
        { code: '1110', nameAr: 'النقدية بالخزينة', accountType: 'ASSET', key: DefaultAccountMappingKey.CASH_VAULT },
        { code: '1120', nameAr: 'ذمم الشبكة', accountType: 'ASSET', key: DefaultAccountMappingKey.BANK },
        { code: '1310', nameAr: 'المخزون', accountType: 'ASSET', key: DefaultAccountMappingKey.INVENTORY },
        { code: '2140', nameAr: 'ضريبة المخرجات', accountType: 'LIABILITY', key: DefaultAccountMappingKey.VAT_OUTPUT },
        { code: '4100', nameAr: 'إيرادات المبيعات', accountType: 'REVENUE', key: DefaultAccountMappingKey.SALES },
        { code: '5100', nameAr: 'تكلفة المبيعات', accountType: 'EXPENSE', key: DefaultAccountMappingKey.COGS },
      ];
      let cashAccountId = '';
      for (const a of accDefs) {
        const [acc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: tenantAId,
            legalEntityId: leA1Id,
            accountCode: a.code,
            name: a.nameAr,
            nameAr: a.nameAr,
            nameEn: a.code,
            accountType: a.accountType,
            normalBalance: a.accountType === 'ASSET' || a.accountType === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
            isPostable: true,
          })
          .returning();
        if (a.code === '1110') cashAccountId = acc!.id;
        await tx.insert(accountMappings).values({
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          mappingKey: a.key,
          accountId: acc!.id,
        });
      }

      const [vault] = await tx
        .insert(cashVaults)
        .values({
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          branchId: branchA1Id,
          accountId: cashAccountId,
          code: `VLT-${suffix}`,
          nameAr: 'خزنة الصالة',
          nameEn: 'Dining Vault',
          currentBalance: '0.0000',
        })
        .returning();

      const [dev] = await tx
        .insert(devices)
        .values({
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          branchId: branchA1Id,
          cashVaultId: vault!.id,
          deviceCode: `POS-DIN-${suffix}`,
          deviceName: 'كاشير الصالة',
        })
        .returning();
      deviceA1Id = dev!.id;

      const year = new Date().getUTCFullYear();
      await tx.insert(fiscalPeriods).values({
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        periodName: `FY-${year}`,
        startDate: new Date(`${year}-01-01T00:00:00Z`),
        endDate: new Date(`${year}-12-31T23:59:59Z`),
        status: 'OPEN',
      });
    });

    const wh = await inventoryService.createWarehouse(ctxA, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      code: `WH-DIN-${suffix}`,
      name: 'مستودع الصالة',
      warehouseType: 'BRANCH' as any,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    whA1Id = wh.id;

    const burger = await catalogService.createItem(ctxA, {
      legalEntityOwnerId: leA1Id,
      baseUomId: uomId,
      sku: `BRG-${suffix}`,
      nameAr: 'برجر لحم مشوي',
      nameEn: 'Grilled Burger',
      productType: ProductType.STOCKED,
      costingMethod: CostingMethod.WEIGHTED_AVERAGE,
      defaultCost: '10.0000',
      defaultPrice: '30.0000',
      taxRate: '0.1500',
      isSold: true,
      isPurchased: true,
      isRecipeIngredient: false,
      isActive: true,
    });
    burgerItemId = burger.id;

    const fries = await catalogService.createItem(ctxA, {
      legalEntityOwnerId: leA1Id,
      baseUomId: uomId,
      sku: `FRS-${suffix}`,
      nameAr: 'بطاطس مقلية',
      nameEn: 'French Fries',
      productType: ProductType.STOCKED,
      costingMethod: CostingMethod.WEIGHTED_AVERAGE,
      defaultCost: '4.0000',
      defaultPrice: '12.0000',
      taxRate: '0.1500',
      isSold: true,
      isPurchased: true,
      isRecipeIngredient: false,
      isActive: true,
    });
    friesItemId = fries.id;

    await inventoryService.receiveStock(ctxA, {
      legalEntityId: leA1Id,
      warehouseId: whA1Id,
      itemId: burgerItemId,
      uomId,
      quantity: '50.0000',
      unitCost: '10.0000',
    });
    await inventoryService.receiveStock(ctxA, {
      legalEntityId: leA1Id,
      warehouseId: whA1Id,
      itemId: friesItemId,
      uomId,
      quantity: '50.0000',
      unitCost: '4.0000',
    });
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('1. Creates tables, enforces duplicate number guard, and serializes concurrent openTableSession', async () => {
    const t1 = await diningService.createTable(ctxA, { branchId: branchA1Id, tableNumber: 'T-01', section: 'MAIN', capacity: 4 });
    const t2 = await diningService.createTable(ctxA, { branchId: branchA1Id, tableNumber: 'T-02', section: 'MAIN', capacity: 4 });
    const t3 = await diningService.createTable(ctxA, { branchId: branchA1Id, tableNumber: 'T-03', section: 'VIP', capacity: 6 });
    table1Id = t1.id;
    table2Id = t2.id;
    table3Id = t3.id;

    await expect(
      diningService.createTable(ctxA, { branchId: branchA1Id, tableNumber: 'T-01', section: 'MAIN', capacity: 4 }),
    ).rejects.toThrow(ConflictException);

    // Concurrent openTableSession on T-01 -> exactly 1 succeeds, 1 rejected
    const openResults = await Promise.allSettled([
      diningService.openTableSession(ctxA, { branchId: branchA1Id, tableId: table1Id, guestCount: 3 }),
      diningService.openTableSession(ctxA, { branchId: branchA1Id, tableId: table1Id, guestCount: 2 }),
    ]);
    expect(openResults.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(openResults.filter((r) => r.status === 'rejected').length).toBe(1);
  });

  it('2. Creates dine-in order with modifiers, generates idempotent KDS ticket, and enforces KDS state transitions', async () => {
    const idemKey = `kds-${suffix}`;
    const res1 = await diningService.createOrAppendTableOrder(ctxA, table1Id, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      deviceId: deviceA1Id,
      idempotencyKey: idemKey,
      lines: [
        {
          itemId: burgerItemId,
          quantity: 2,
          modifiers: [{ modifierNameAr: 'جبنة إضافية', modifierNameEn: 'Extra Cheese', priceDelta: '5.0000', quantity: 1 }],
        },
      ],
    });

    // Idempotent duplicate returns same order & ticket
    const res2 = await diningService.createOrAppendTableOrder(ctxA, table1Id, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      deviceId: deviceA1Id,
      idempotencyKey: idemKey,
      lines: [{ itemId: burgerItemId, quantity: 2 }],
    });
    expect(res2.kitchenTicket.id).toBe(res1.kitchenTicket.id);
    expect(res1.kitchenTicket.status).toBe('PENDING');

    // Invalid direct jump PENDING -> SERVED blocked
    await expect(
      diningService.updateKitchenTicketStatus(ctxA, res1.kitchenTicket.id, 'SERVED'),
    ).rejects.toThrow(ConflictException);

    const prep = await diningService.updateKitchenTicketStatus(ctxA, res1.kitchenTicket.id, 'IN_PREPARATION');
    expect(prep.status).toBe('IN_PREPARATION');
    const ready = await diningService.updateKitchenTicketStatus(ctxA, res1.kitchenTicket.id, 'READY');
    expect(ready.status).toBe('READY');
    const served = await diningService.updateKitchenTicketStatus(ctxA, res1.kitchenTicket.id, 'SERVED');
    expect(served.status).toBe('SERVED');
  });

  it('3. Transfers table to available T-02 and merges T-03 into T-02 with total recalculation', async () => {
    // Transfer T-01 -> T-02
    const transferred = await diningService.transferTable(ctxA, table1Id, table2Id);
    expect(transferred.status).toBe(TableStatus.OCCUPIED);
    expect(transferred.currentOrderId).toBeTruthy();

    // Open T-03 and add Fries
    await diningService.openTableSession(ctxA, { branchId: branchA1Id, tableId: table3Id, guestCount: 2 });
    await diningService.createOrAppendTableOrder(ctxA, table3Id, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      deviceId: deviceA1Id,
      lines: [{ itemId: friesItemId, quantity: 1 }],
    });

    // Merge T-03 into T-02
    const mergedOrder = await diningService.mergeTables(ctxA, table3Id, table2Id);
    expect(Number(mergedOrder.grandTotal)).toBeGreaterThan(70); // (65 + 12) * 1.15 = 88.55

    const tablesAfter = await diningService.getTablesByBranch(ctxA, branchA1Id);
    const t3 = tablesAfter.find((t) => t.id === table3Id);
    expect(t3?.status).toBe(TableStatus.AVAILABLE);
  });

  it('4. Checks out T-02 via SalesService (Inventory + PostingEngine GL), resets table, and blocks concurrent checkout', async () => {
    const orderInfo = await diningService.getTableOrder(ctxA, table2Id);
    const grandTotal = Number(orderInfo.order!.grandTotal);

    const checkoutResults = await Promise.allSettled([
      diningService.checkoutTableOrder(ctxA, table2Id, {
        legalEntityId: leA1Id,
        branchId: branchA1Id,
        deviceId: deviceA1Id,
        warehouseId: whA1Id,
        payments: [{ paymentMethod: 'CASH', amount: grandTotal.toFixed(4) }],
      }),
      diningService.checkoutTableOrder(ctxA, table2Id, {
        legalEntityId: leA1Id,
        branchId: branchA1Id,
        deviceId: deviceA1Id,
        warehouseId: whA1Id,
        payments: [{ paymentMethod: 'CASH', amount: grandTotal.toFixed(4) }],
      }),
    ]);

    expect(checkoutResults.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(checkoutResults.filter((r) => r.status === 'rejected').length).toBe(1);

    const settledOrder = (checkoutResults.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;

    // Verify table T-02 is AVAILABLE again, inventory deducted (50 - 2 = 48 burgers, 50 - 1 = 49 fries), and GL posted
    const tables = await diningService.getTablesByBranch(ctxA, branchA1Id);
    const t2 = tables.find((t) => t.id === table2Id);
    expect(t2?.status).toBe(TableStatus.AVAILABLE);

    await dbService.withTenantContext(ctxA, async (tx) => {
      const [burgerBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, burgerItemId)));
      expect(Number(burgerBal?.onHandQty)).toBe(48);

      const [friesBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, friesItemId)));
      expect(Number(friesBal?.onHandQty)).toBe(49);

      const jvs = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantAId), eq(journalEntries.sourceId, settledOrder.id)));
      expect(jvs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('5. Enforces Tenant & RLS isolation and RBAC permission decorators', async () => {
    const tenantBTables = await diningService.getTablesByBranch(ctxB, branchA1Id);
    expect(tenantBTables.length).toBe(0);

    const checkoutPerms = Reflect.getMetadata(PERMISSIONS_KEY, DiningController.prototype.checkoutTableOrder);
    expect(checkoutPerms).toContain('dining.order.checkout');
    const kdsPerms = Reflect.getMetadata(PERMISSIONS_KEY, DiningController.prototype.updateKitchenTicketStatus);
    expect(kdsPerms).toContain('dining.kitchen.manage');
  });
});
