import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import {
  TenantContext,
  WarehouseType,
  MovementType,
  MovementDirection,
  CostingMethod,
} from '@restaurant-cloud/domain-kernel';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — WMS Concurrency, Idempotency & FIFO/WAC Costing Verification', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let catalogService: CatalogService;
  let inventoryService: InventoryService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let warehouseId: string;
  let baseUomId: string;

  let fifoItemId: string;
  let wacItemId: string;
  let concurrencyItemId: string;

  const tenantCode = `wms-fifo-${Date.now().toString(36)}`;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    catalogService = new CatalogService(dbService, auditService);
    inventoryService = new InventoryService(dbService, auditService);

    // 1. Onboard dedicated tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `مجموعة التحقق المالي والمخزني - ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة التحقق المالي للمستودعات المحدودة',
        commercialName: 'التحقق المالي',
        vatNumber: '31099887700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-FIFO-01',
        name: 'مستودع الاختبار المركزي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `fifo-admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مسؤول التحقق المخزني',
        password: 'Password123!',
      },
    });

    legalEntityId = tenantResult.legalEntity.id;

    tenantContext = {
      tenantId: tenantResult.tenant.id,
      userId: tenantResult.user.id,
      legalEntityId,
      branchId: tenantResult.branch.id,
      scopes: ['*'],
      permissions: ['*'],
      isPlatformAdmin: false,
    };

    // 2. Base UOM
    const uom = await catalogService.createUom(tenantContext, {
      code: `KG-${Date.now().toString(36).slice(-4)}`,
      nameAr: 'كيلوجرام',
      nameEn: 'Kilogram',
      symbol: 'kg',
      category: 'MASS',
      isBaseUnit: true,
    });
    baseUomId = uom.id;

    // 3. Central Warehouse
    const wh = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      name: 'مستودع تدقيق التكلفة والتزامن',
      code: `WH-FIFO-${Date.now().toString(36).toUpperCase()}`,
      type: WarehouseType.CENTRAL_WAREHOUSE,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    warehouseId = wh.id;

    // 4. Create Items
    // Item 1: Configured with FIFO costing
    const fifoItem = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-FIFO-${Date.now().toString(36).toUpperCase()}`,
      nameAr: 'لحم أنجوس فاخر (FIFO)',
      nameEn: 'Angus Beef (FIFO)',
      itemType: 'RAW_MATERIAL',
      costingMethod: CostingMethod.FIFO,
      defaultCost: '10.0000',
    });
    fifoItemId = fifoItem.id;

    // Item 2: Configured with WEIGHTED_AVERAGE costing
    const wacItem = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-WAC-${Date.now().toString(36).toUpperCase()}`,
      nameAr: 'زيت قلي نباتي (WAC)',
      nameEn: 'Cooking Oil (WAC)',
      itemType: 'RAW_MATERIAL',
      costingMethod: CostingMethod.WEIGHTED_AVERAGE,
      defaultCost: '10.0000',
    });
    wacItemId = wacItem.id;

    // Item 3: Concurrency testing item
    const concItem = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-CONC-${Date.now().toString(36).toUpperCase()}`,
      nameAr: 'جبن شيدر (اختبار التزامن)',
      nameEn: 'Cheddar Cheese (Concurrency Test)',
      itemType: 'RAW_MATERIAL',
      costingMethod: CostingMethod.WEIGHTED_AVERAGE,
      defaultCost: '20.0000',
    });
    concurrencyItemId = concItem.id;
  }, 60000);

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  // =========================================================================
  // Section 1: FIFO vs. Weighted Average Costing Verification
  // =========================================================================

  it('Verification 1.1: FIFO creates sequential cost layers on receipt', async () => {
    // Receive Layer 1: 50 units @ 10.00 SAR
    const rcv1 = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '50.0000',
      unitCost: '10.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-FIFO-001',
    });
    expect(rcv1.movement.quantity).toBe('50.0000');
    expect(rcv1.movement.unitCost).toBe('10.0000');

    // Receive Layer 2: 30 units @ 15.00 SAR
    const rcv2 = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '30.0000',
      unitCost: '15.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-FIFO-002',
    });
    expect(rcv2.movement.quantity).toBe('30.0000');
    expect(rcv2.movement.unitCost).toBe('15.0000');

    // Receive Layer 3: 20 units @ 20.00 SAR
    const rcv3 = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '20.0000',
      unitCost: '20.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-FIFO-003',
    });
    expect(rcv3.movement.quantity).toBe('20.0000');

    // Verify 3 distinct cost layers exist and are intact
    const layers = await inventoryService.getCostLayers(tenantContext, {
      warehouseId,
      itemId: fifoItemId,
    });
    expect(layers.length).toBe(3);
    expect(parseFloat(layers[0].quantityRemaining)).toBe(50);
    expect(parseFloat(layers[0].unitCost)).toBe(10);
    expect(parseFloat(layers[1].quantityRemaining)).toBe(30);
    expect(parseFloat(layers[1].unitCost)).toBe(15);
    expect(parseFloat(layers[2].quantityRemaining)).toBe(20);
    expect(parseFloat(layers[2].unitCost)).toBe(20);
  });

  it('Verification 1.2: FIFO issues stock by consuming oldest layers first (First-In, First-Out)', async () => {
    // Issue 60 units:
    // Should consume entire Layer 1 (50 @ 10 SAR = 500 SAR) + 10 units from Layer 2 (10 @ 15 SAR = 150 SAR)
    // Expected total cost: 650 SAR
    // Expected effective unit cost: 650 / 60 = 10.8333 SAR
    const issue1 = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '60.0000',
      movementType: MovementType.INTERNAL_CONSUMPTION,
      notes: 'صرف تجريبي لاختبار تسلسل طبقات FIFO',
    });

    expect(parseFloat(issue1.movement.quantity)).toBe(60);
    expect(parseFloat(issue1.movement.totalCost)).toBeCloseTo(650, 2);
    expect(parseFloat(issue1.movement.unitCost)).toBeCloseTo(10.8333, 4);
    expect(parseFloat(issue1.balance.onHandQty)).toBe(40);

    // Verify layers after Issue 1
    const layers = await inventoryService.getCostLayers(tenantContext, {
      warehouseId,
      itemId: fifoItemId,
    });
    expect(parseFloat(layers[0].quantityRemaining)).toBe(0); // Layer 1 completely depleted!
    expect(parseFloat(layers[1].quantityRemaining)).toBe(20); // Layer 2 partially depleted (30 - 10 = 20)
    expect(parseFloat(layers[2].quantityRemaining)).toBe(20); // Layer 3 untouched
  });

  it('Verification 1.3: Second FIFO issue consumes remaining Layer 2 and moves into Layer 3', async () => {
    // Issue 35 units:
    // Should consume remaining 20 units of Layer 2 (20 @ 15 SAR = 300 SAR)
    // + 15 units of Layer 3 (15 @ 20 SAR = 300 SAR)
    // Total cost: 600 SAR
    // Effective unit cost: 600 / 35 = 17.1429 SAR
    const issue2 = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '35.0000',
      movementType: MovementType.INTERNAL_CONSUMPTION,
      notes: 'صرف الدفعة الثانية من طبقات FIFO',
    });

    expect(parseFloat(issue2.movement.quantity)).toBe(35);
    expect(parseFloat(issue2.movement.totalCost)).toBeCloseTo(600, 2);
    expect(parseFloat(issue2.movement.unitCost)).toBeCloseTo(17.1429, 4);
    expect(parseFloat(issue2.balance.onHandQty)).toBe(5);

    // Verify layers after Issue 2
    const layers = await inventoryService.getCostLayers(tenantContext, {
      warehouseId,
      itemId: fifoItemId,
    });
    expect(parseFloat(layers[0].quantityRemaining)).toBe(0); // Layer 1 exhausted
    expect(parseFloat(layers[1].quantityRemaining)).toBe(0); // Layer 2 exhausted
    expect(parseFloat(layers[2].quantityRemaining)).toBe(5); // Layer 3 has 5 remaining
  });

  it('Verification 1.4: Strict negative stock enforcement prevents issuing more than FIFO remaining', async () => {
    // Current on-hand is 5. Attempting to issue 10 units must fail
    await expect(
      inventoryService.issueStock(tenantContext, {
        legalEntityId,
        warehouseId,
        itemId: fifoItemId,
        uomId: baseUomId,
        quantity: '10.0000',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('Verification 1.5: Weighted Average Costing operates independently without mutating FIFO layers', async () => {
    // Receive 50 units @ 10 SAR
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '50.0000',
      unitCost: '10.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-WAC-001',
    });

    // Receive 50 units @ 20 SAR -> New WAC = (500 + 1000) / 100 = 15.00 SAR
    const rcv2 = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '50.0000',
      unitCost: '20.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-WAC-002',
    });
    expect(parseFloat(rcv2.balance.wacCost)).toBeCloseTo(15.00, 2);

    // Issue 30 units: Should be priced strictly at current WAC (15.00 SAR)
    const issueWac = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '30.0000',
    });

    expect(parseFloat(issueWac.movement.unitCost)).toBeCloseTo(15.00, 2);
    expect(parseFloat(issueWac.movement.totalCost)).toBeCloseTo(450.00, 2);
    expect(parseFloat(issueWac.balance.onHandQty)).toBe(70.00);
    expect(parseFloat(issueWac.balance.wacCost)).toBeCloseTo(15.00, 2);
  });

  // =========================================================================
  // Section 2: Concurrency & Idempotency Testing
  // =========================================================================

  it('Verification 2.1: Concurrent stock issues cannot cause negative stock (Row Lock Protection)', async () => {
    // 1. Initial stock: 100 units
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '100.0000',
      unitCost: '20.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-CONC-001',
    });

    // 2. Launch two simultaneous issue requests of 60 units each.
    // Total requested = 120 units, but available = 100 units.
    // Concurrency protection MUST guarantee that exactly ONE succeeds and ONE fails.
    const [res1, res2] = await Promise.allSettled([
      inventoryService.issueStock(tenantContext, {
        legalEntityId,
        warehouseId,
        itemId: concurrencyItemId,
        uomId: baseUomId,
        quantity: '60.0000',
        notes: 'صرف متزامن رقم 1',
      }),
      inventoryService.issueStock(tenantContext, {
        legalEntityId,
        warehouseId,
        itemId: concurrencyItemId,
        uomId: baseUomId,
        quantity: '60.0000',
        notes: 'صرف متزامن رقم 2',
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify rejection reason is insufficient stock
    const rejectedError = (failures[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(BadRequestException);
    expect(rejectedError.message).toContain('غير كافٍ للصرف');

    // 3. Final balance must be exactly 40.0000 (never negative)
    const [bal] = await inventoryService.getBalances(tenantContext, {
      warehouseId,
      itemId: concurrencyItemId,
    });
    expect(parseFloat(bal.onHandQty)).toBe(40);
  });

  it('Verification 2.2: Idempotent Stock Receipt prevents duplicate entries and double-incrementing stock', async () => {
    const docNumber = `INV-RCV-IDEMP-${Date.now().toString(36)}`;

    // Call 1: Process receipt
    const firstCall = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '25.0000',
      unitCost: '20.0000',
      sourceDocumentNumber: docNumber,
    });
    expect(parseFloat(firstCall.balance.onHandQty)).toBe(65); // 40 + 25 = 65

    // Call 2: Re-send exact same request with same sourceDocumentNumber
    const secondCall = await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '25.0000',
      unitCost: '20.0000',
      sourceDocumentNumber: docNumber,
    });

    // Must return the exact same movement without creating a second one
    expect(secondCall.movement.id).toBe(firstCall.movement.id);
    expect(parseFloat(secondCall.balance.onHandQty)).toBe(65); // Still 65, NOT 90!
  });

  it('Verification 2.3: Idempotent Stock Issue prevents duplicate entries and double-decrementing stock', async () => {
    const docNumber = `INV-ISS-IDEMP-${Date.now().toString(36)}`;

    // Call 1: Issue 15 units
    const firstCall = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '15.0000',
      sourceDocumentNumber: docNumber,
    });
    expect(parseFloat(firstCall.balance.onHandQty)).toBe(50); // 65 - 15 = 50

    // Call 2: Re-send identical issue request
    const secondCall = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '15.0000',
      sourceDocumentNumber: docNumber,
    });

    // Must return the original movement and unchanged balance
    expect(secondCall.movement.id).toBe(firstCall.movement.id);
    expect(parseFloat(secondCall.balance.onHandQty)).toBe(50); // Still 50, NOT 35!
  });

  it('Verification 2.4: Concurrent double reversal on the same movement allows only one success', async () => {
    // 1. Issue 10 units to create a reversible movement
    const issueToReverse = await inventoryService.issueStock(tenantContext, {
      legalEntityId,
      warehouseId,
      itemId: concurrencyItemId,
      uomId: baseUomId,
      quantity: '10.0000',
      notes: 'حركة مخصصة لاختبار العكس المتزامن',
    });
    const movementId = issueToReverse.movement.id;
    expect(parseFloat(issueToReverse.balance.onHandQty)).toBe(40); // 50 - 10 = 40

    // 2. Launch two simultaneous reversals of the exact same movement
    const [rev1, rev2] = await Promise.allSettled([
      inventoryService.reverseMovement(tenantContext, {
        movementId,
        reversalReason: 'عكس متزامن 1',
      }),
      inventoryService.reverseMovement(tenantContext, {
        movementId,
        reversalReason: 'عكس متزامن 2',
      }),
    ]);

    const successes = [rev1, rev2].filter((r) => r.status === 'fulfilled');
    const failures = [rev1, rev2].filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must be rejected with ConflictException
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const rejectedError = (failures[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(ConflictException);
    expect(rejectedError.message).toContain('تم عكس هذه الحركة مسبقاً');

    // Balance restored exactly once: 40 + 10 = 50 (NOT 60!)
    const [finalBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId,
      itemId: concurrencyItemId,
    });
    expect(parseFloat(finalBal.onHandQty)).toBe(50);
  });
});
