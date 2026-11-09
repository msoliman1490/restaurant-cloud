import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import {
  TenantContext,
  WarehouseType,
  MovementType,
  MovementDirection,
} from '@restaurant-cloud/domain-kernel';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Advanced Inventory & Warehouse Management (Phase A Spec)', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let catalogService: CatalogService;
  let inventoryService: InventoryService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;
  let baseUomId: string;

  // Warehouses
  let mainWarehouseId: string;
  let branchWarehouseId: string;
  let rawWarehouseId: string;

  // Items
  let burgerPattyItemId: string;

  const tenantCode = `wms-test-${Date.now().toString(36)}`;

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
    catalogService = new CatalogService(dbService, auditService, opsService);
    inventoryService = new InventoryService(dbService, auditService);

    // 1. Provision Test Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: 'مجموعة الأغذية والتخزين المتطورة',
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الإمداد الغذائي المحدودة',
        commercialName: 'الإمداد الغذائي',
        vatNumber: '310998877665544',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-WMS-01',
        name: 'فرع الإمداد المركزي - الرياض',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `wms-admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مدير المستودعات المركزي',
        password: 'Password123!',
      },
    });

    legalEntityId = tenantResult.legalEntity.id;
    branchId = tenantResult.branch.id;

    tenantContext = {
      tenantId: tenantResult.tenant.id,
      userId: tenantResult.user.id,
      legalEntityId,
      branchId,
      scopes: ['*'],
    };

    // 2. Create Base UOM (Kilogram)
    const uom = await catalogService.createUom(tenantContext, {
      code: `KG-${Date.now().toString(36).slice(-4)}`,
      nameAr: 'كيلوجرام',
      nameEn: 'Kilogram',
      symbol: 'kg',
      category: 'MASS',
      isBaseUnit: true,
    });
    baseUomId = uom.id;

    // 3. Create Inventory Test Item
    const item = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-PATTY-${Date.now().toString(36)}`,
      nameAr: 'شريحة لحم برجر أنجوس 150 جرام',
      nameEn: 'Angus Burger Patty 150g',
      itemType: 'RAW_MATERIAL',
      costingMethod: 'WEIGHTED_AVERAGE',
      defaultCost: '20.0000',
    });
    burgerPattyItemId = item.id;
  });

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  // =========================================================================
  // Scenario 1: Warehouse Multi-Type Provisioning & Isolation
  // =========================================================================
  it('Scenario 1: Creates warehouses with proper types and enforces unique code constraint', async () => {
    const mainWh = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      code: `WH-MAIN-${Date.now().toString(36).slice(-4)}`,
      name: 'المستودع الرئيسي المركزي',
      warehouseType: WarehouseType.MAIN,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    expect(mainWh).toBeDefined();
    expect(mainWh.warehouseType).toBe(WarehouseType.MAIN);
    expect(mainWh.status).toBe('ACTIVE');
    mainWarehouseId = mainWh.id;

    const branchWh = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      branchId,
      code: `WH-BR-${Date.now().toString(36).slice(-4)}`,
      name: 'مستودع فرع العليا',
      warehouseType: WarehouseType.BRANCH,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    expect(branchWh).toBeDefined();
    expect(branchWh.warehouseType).toBe(WarehouseType.BRANCH);
    branchWarehouseId = branchWh.id;

    const rawWh = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      code: `WH-RAW-${Date.now().toString(36).slice(-4)}`,
      name: 'مستودع المواد الأولية والتجهيز',
      warehouseType: WarehouseType.RAW_MATERIALS,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    expect(rawWh).toBeDefined();
    expect(rawWh.warehouseType).toBe(WarehouseType.RAW_MATERIALS);
    rawWarehouseId = rawWh.id;

    // Enforce unique code per tenant
    await expect(
      inventoryService.createWarehouse(tenantContext, {
        code: mainWh.code,
        name: 'مستودع مكرر الكود',
      })
    ).rejects.toThrow(ConflictException);
  });

  // =========================================================================
  // Scenario 2: Direct Stock Receiving & Initial WAC Setup
  // =========================================================================
  it('Scenario 2: Direct stock receipt increments on-hand quantity and sets initial WAC', async () => {
    const receiveResult = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: mainWarehouseId,
      itemId: burgerPattyItemId,
      uomId: baseUomId,
      quantity: '100.0000',
      unitCost: '20.0000',
      movementType: MovementType.PURCHASE_RECEIPT,
      sourceType: 'PURCHASE_INVOICE',
      batchNumber: 'BATCH-2026-A1',
      notes: 'توريد مباشر من المورد المعتمد',
    });

    expect(receiveResult).toBeDefined();
    expect(parseFloat(receiveResult.balance.onHandQty)).toBe(100);
    expect(parseFloat(receiveResult.balance.wacCost)).toBe(20);

    // Verify Central Movement Ledger entry
    expect(receiveResult.movement.movementNumber).toMatch(/^MOV-RCV-/);
    expect(receiveResult.movement.direction).toBe(MovementDirection.IN);
    expect(receiveResult.movement.movementType).toBe(MovementType.PURCHASE_RECEIPT);
    expect(parseFloat(receiveResult.movement.quantity)).toBe(100);
    expect(parseFloat(receiveResult.movement.unitCost)).toBe(20);
    expect(parseFloat(receiveResult.movement.totalCost)).toBe(2000);
    expect(receiveResult.movement.isReversed).toBe(false);
  });

  // =========================================================================
  // Scenario 3: Dynamic WAC Recalculation on Subsequent Receipts
  // =========================================================================
  it('Scenario 3: Second stock receipt dynamically recalculates Weighted Average Cost', async () => {
    // Current: 100 qty @ 20.00 = 2000 SAR
    // Incoming: 50 qty @ 35.00 = 1750 SAR
    // Expected New WAC: (2000 + 1750) / 150 = 3750 / 150 = 25.0000 SAR
    const receiveResult = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: mainWarehouseId,
      itemId: burgerPattyItemId,
      uomId: baseUomId,
      quantity: '50.0000',
      unitCost: '35.0000',
      movementType: MovementType.PURCHASE_RECEIPT,
      sourceType: 'PURCHASE_INVOICE',
      batchNumber: 'BATCH-2026-A2',
    });

    expect(parseFloat(receiveResult.balance.onHandQty)).toBe(150);
    expect(parseFloat(receiveResult.balance.wacCost)).toBe(25);
  });

  // =========================================================================
  // Scenario 4: Direct Stock Issuing at WAC Cost
  // =========================================================================
  let lastIssueMovementId: string;

  it('Scenario 4: Direct stock issue decrements on-hand at current WAC without altering WAC', async () => {
    // Current: 150 qty @ 25.00 WAC
    // Issue: 40 qty
    // Remaining: 110 qty @ 25.00 WAC
    const issueResult = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId: mainWarehouseId,
      itemId: burgerPattyItemId,
      uomId: baseUomId,
      quantity: '40.0000',
      movementType: MovementType.INTERNAL_CONSUMPTION,
      notes: 'صرف تحضيري للمطبخ المركزي',
    });

    expect(parseFloat(issueResult.balance.onHandQty)).toBe(110);
    expect(parseFloat(issueResult.balance.wacCost)).toBe(25);

    // Verify Movement Ledger
    expect(issueResult.movement.movementNumber).toMatch(/^MOV-ISS-/);
    expect(issueResult.movement.direction).toBe(MovementDirection.OUT);
    expect(parseFloat(issueResult.movement.unitCost)).toBe(25);
    expect(parseFloat(issueResult.movement.totalCost)).toBe(1000); // 40 * 25 = 1000

    lastIssueMovementId = issueResult.movement.id;
  });

  // =========================================================================
  // Scenario 5: Strict Overdraft Prevention (No Negative Stock Allowed)
  // =========================================================================
  it('Scenario 5: Attempting to issue more than available stock is strictly blocked', async () => {
    // Current available is 110. Attempting to issue 150 must fail.
    await expect(
      inventoryService.issueStock(tenantContext, {
        legalEntityId,
        warehouseId: mainWarehouseId,
        itemId: burgerPattyItemId,
        uomId: baseUomId,
        quantity: '150.0000',
      })
    ).rejects.toThrow(BadRequestException);

    // Verify balance remains 110
    const [balance] = await inventoryService.getBalances(tenantContext, {
      warehouseId: mainWarehouseId,
      itemId: burgerPattyItemId,
    });
    expect(parseFloat(balance.onHandQty)).toBe(110);
  });

  // =========================================================================
  // Scenario 6: Warehouse Capability Enforcement
  // =========================================================================
  it('Scenario 6: Warehouse operational flags (allowReceiving, allowIssuing) are strictly enforced', async () => {
    // Warehouse with receiving disabled
    const noRcvWh = await inventoryService.createWarehouse(tenantContext, {
      code: `WH-NORCV-${Date.now().toString(36).slice(-4)}`,
      name: 'مستودع غير مسموح بالاستلام',
      allowReceiving: false,
      allowIssuing: true,
    });

    await expect(
      inventoryService.receiveStock(tenantContext, {
        warehouseId: noRcvWh.id,
        itemId: burgerPattyItemId,
        uomId: baseUomId,
        quantity: '10.0000',
        unitCost: '20.0000',
      })
    ).rejects.toThrow(BadRequestException);

    // Warehouse with issuing disabled
    const noIssWh = await inventoryService.createWarehouse(tenantContext, {
      code: `WH-NOISS-${Date.now().toString(36).slice(-4)}`,
      name: 'مستودع غير مسموح بالصرف',
      allowReceiving: true,
      allowIssuing: false,
    });

    await expect(
      inventoryService.issueStock(tenantContext, {
        warehouseId: noIssWh.id,
        itemId: burgerPattyItemId,
        uomId: baseUomId,
        quantity: '5.0000',
      })
    ).rejects.toThrow(BadRequestException);
  });

  // =========================================================================
  // Scenario 7: Inviolable Movement Reversal
  // =========================================================================
  it('Scenario 7: Reverses an issue movement, restores stock on-hand, and blocks double reversal', async () => {
    // Reversing the 40 qty issue from Scenario 4:
    // On-hand before reversal: 110
    // On-hand after reversal: 150
    const reversalResult = await inventoryService.reverseMovement(tenantContext, {
      movementId: lastIssueMovementId,
      reversalReason: 'خطأ إداري في كمية الصرف التشغيلي',
    });

    expect(parseFloat(reversalResult.balance.onHandQty)).toBe(150);
    expect(reversalResult.reversalMovement.movementNumber).toMatch(/^MOV-REV-/);
    expect(reversalResult.reversalMovement.direction).toBe(MovementDirection.IN);
    expect(reversalResult.reversalMovement.reversalOfId).toBe(lastIssueMovementId);

    // Attempting to reverse the same movement again must fail (409 Conflict)
    await expect(
      inventoryService.reverseMovement(tenantContext, {
        movementId: lastIssueMovementId,
        reversalReason: 'محاولة عكس ثانية غير مسموحة',
      })
    ).rejects.toThrow(ConflictException);
  });

  // =========================================================================
  // Scenario 8: Detailed Balances & Stock Availability Valuation
  // =========================================================================
  it('Scenario 8: Queries detailed balances with calculated available quantity and total valuation', async () => {
    const detailed = await inventoryService.getDetailedBalances(tenantContext, {
      warehouseId: mainWarehouseId,
      itemId: burgerPattyItemId,
    });

    expect(detailed.items.length).toBe(1);
    const itemBalance = detailed.items[0];

    expect(parseFloat(itemBalance.onHandQty)).toBe(150);
    expect(parseFloat(itemBalance.availableQty)).toBe(150);
    expect(parseFloat(itemBalance.wacCost)).toBe(25);
    expect(parseFloat(itemBalance.totalValuation)).toBe(3750); // 150 * 25 = 3750
    expect(itemBalance.availabilityStatus).toBe('IN_STOCK');

    expect(parseFloat(detailed.summary.totalValuation)).toBe(3750);
    expect(parseFloat(detailed.summary.totalOnHandQuantity)).toBe(150);
  });
});
