import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import {
  TenantContext,
  WarehouseType,
  TransferStatus,
  StocktakeType,
  StocktakeFrequency,
  StocktakeStatus,
  CostingMethod,
  MovementDirection,
} from '@restaurant-cloud/domain-kernel';
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Advanced WMS Phase B (Stock Transfers & Stocktaking)', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let catalogService: CatalogService;
  let inventoryService: InventoryService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let baseUomId: string;

  // Warehouses
  let centralWarehouseId: string;
  let branchWarehouseId: string;

  // Items
  let fifoItemId: string;
  let wacItemId: string;

  const tenantCode = `wms-b-${Date.now().toString(36)}`;

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
      displayName: `مجموعة الخدمات اللوجستية والمستودعات - ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الإمداد اللوجستي للمطاعم المحدودة',
        commercialName: 'الإمداد اللوجستي',
        vatNumber: '31099887700004',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-WMS-B-01',
        name: 'الفرع اللوجستي الرئيسي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `wms-b-admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مدير العمليات اللوجستية والمخزون',
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

    // 3. Central & Branch Warehouses
    const whCentral = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      name: 'المستودع اللوجستي المركزي',
      code: `WH-CTR-${Date.now().toString(36).toUpperCase()}`,
      type: WarehouseType.CENTRAL_WAREHOUSE,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    centralWarehouseId = whCentral.id;

    const whBranch = await inventoryService.createWarehouse(tenantContext, {
      legalEntityId,
      name: 'مستودع فرع العليا',
      code: `WH-BR-${Date.now().toString(36).toUpperCase()}`,
      type: WarehouseType.BRANCH,
      allowReceiving: true,
      allowIssuing: true,
      allowTransfer: true,
    });
    branchWarehouseId = whBranch.id;

    // 4. Create Items
    // Item 1: Configured with FIFO costing
    const fifoItem = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-B-FIFO-${Date.now().toString(36).toUpperCase()}`,
      nameAr: 'شرائح سلمون مدخن (FIFO)',
      nameEn: 'Smoked Salmon (FIFO)',
      itemType: 'RAW_MATERIAL',
      costingMethod: CostingMethod.FIFO,
      defaultCost: '50.0000',
    });
    fifoItemId = fifoItem.id;

    // Item 2: Configured with WEIGHTED_AVERAGE costing
    const wacItem = await catalogService.createItem(tenantContext, {
      legalEntityOwnerId: legalEntityId,
      baseUomId,
      sku: `SKU-B-WAC-${Date.now().toString(36).toUpperCase()}`,
      nameAr: 'أرز بسمتي فاخر (WAC)',
      nameEn: 'Basmati Rice (WAC)',
      itemType: 'RAW_MATERIAL',
      costingMethod: CostingMethod.WEIGHTED_AVERAGE,
      defaultCost: '10.0000',
    });
    wacItemId = wacItem.id;
  }, 60000);

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  // =========================================================================
  // Section 1: Full Transfer Lifecycle (Draft -> Approved -> Dispatched -> In Transit -> Received)
  // =========================================================================

  it('Phase B - 1: Complete Stock Transfer Lifecycle with reservation and in-transit tracking', async () => {
    // 1. Initial stock in Central Warehouse: 100 units @ 10 SAR
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '100.0000',
      unitCost: '10.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-INIT-001',
    });

    // 2. Create Stock Transfer Request for 40 units (DRAFT)
    const transferNum = `TR-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: wacItemId,
          uomId: baseUomId,
          quantity: '40.0000',
          unitCost: '10.0000',
        },
      ],
      notes: 'مناقلة أرز بسمتي لتغذية فرع العليا',
    });

    expect(transfer.status).toBe(TransferStatus.DRAFT);
    expect(transfer.lines.length).toBe(1);
    expect(parseFloat(transfer.lines[0].quantity)).toBe(40);

    // 3. Approve Transfer (APPROVED) -> Reserves stock at source
    const approvedTransfer = await inventoryService.approveTransfer(tenantContext, transfer.id, {
      approvalNotes: 'معتمد للإرسال الفوري',
    });
    expect(approvedTransfer.status).toBe(TransferStatus.APPROVED);

    // Verify source warehouse balance: On-hand = 100, Reserved = 40, Available = 60
    const [sourceBalAfterApprove] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(sourceBalAfterApprove.onHandQty)).toBe(100);
    expect(parseFloat(sourceBalAfterApprove.reservedQty)).toBe(40);

    // 4. Dispatch Transfer (IN_TRANSIT)
    const dispatchedTransfer = await inventoryService.dispatchTransfer(tenantContext, transfer.id, {
      dispatchedNotes: 'تم التحميل على شاحنة النقل المبردة رقم 12',
    });
    expect(dispatchedTransfer.status).toBe(TransferStatus.IN_TRANSIT);
    expect(parseFloat(dispatchedTransfer.totalShippedQty)).toBe(40);

    // Verify source warehouse after dispatch:
    // On-hand deducted: 100 - 40 = 60
    // Reserved released: 40 - 40 = 0
    // In-transit recorded: 40
    const [sourceBalAfterDispatch] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(sourceBalAfterDispatch.onHandQty)).toBe(60);
    expect(parseFloat(sourceBalAfterDispatch.reservedQty)).toBe(0);
    expect(parseFloat(sourceBalAfterDispatch.inTransitQty)).toBe(40);

    // Verify destination warehouse before receiving: Still 0 available
    const destBalsBeforeReceive = await inventoryService.getBalances(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: wacItemId,
    });
    const destOnHandBefore = destBalsBeforeReceive.length > 0 ? parseFloat(destBalsBeforeReceive[0].onHandQty) : 0;
    expect(destOnHandBefore).toBe(0);

    // 5. Receive Transfer at Destination (RECEIVED)
    const receivedTransfer = await inventoryService.receiveTransfer(tenantContext, transfer.id, {
      receivedLines: [
        {
          itemId: wacItemId,
          receivedQuantity: '40.0000',
        },
      ],
      receivedNotes: 'تم الاستلام والفحص بحالة ممتازة',
    });

    expect(receivedTransfer.status).toBe(TransferStatus.RECEIVED);
    expect(parseFloat(receivedTransfer.totalReceivedQty)).toBe(40);

    // Verify source warehouse after receipt: In-transit cleared to 0
    const [sourceBalAfterReceive] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(sourceBalAfterReceive.inTransitQty)).toBe(0);
    expect(parseFloat(sourceBalAfterReceive.onHandQty)).toBe(60);

    // Verify destination warehouse after receipt: On-hand = 40
    const [destBalAfterReceive] = await inventoryService.getBalances(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(destBalAfterReceive.onHandQty)).toBe(40);
  });

  // =========================================================================
  // Section 2: Partial Transfer Receipt & Variance (Damage / Loss)
  // =========================================================================

  it('Phase B - 2: Partial Transfer Receipt with damage and loss reporting', async () => {
    // Initial stock: 50 units in central warehouse
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '50.0000',
      unitCost: '10.0000',
      sourceType: 'PURCHASE_RECEIPT',
    });

    // Create & Approve transfer for 30 units
    const transferNum = `TR-VAR-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: wacItemId,
          uomId: baseUomId,
          quantity: '30.0000',
          unitCost: '10.0000',
        },
      ],
    });

    await inventoryService.approveTransfer(tenantContext, transfer.id);
    await inventoryService.dispatchTransfer(tenantContext, transfer.id, {});

    // Receive with variance:
    // 20 received good, 5 damaged, 5 lost in transit (Total accounted = 30)
    const received = await inventoryService.receiveTransfer(tenantContext, transfer.id, {
      receivedLines: [
        {
          itemId: wacItemId,
          receivedQuantity: '20.0000',
          damagedQuantity: '5.0000',
          lostQuantity: '5.0000',
          varianceNotes: 'تمزق 5 أكياس وفقدان 5 أكياس أثناء الشحن',
        },
      ],
    });

    expect(received.status).toBe(TransferStatus.RECEIVED);
    expect(parseFloat(received.totalReceivedQty)).toBe(20);
    expect(parseFloat(received.totalDamagedQty)).toBe(5);
    expect(parseFloat(received.totalLostQty)).toBe(5);

    // Verify destination warehouse: onHand received = 40 (from Test 1) + 20 = 60, damaged = 5
    const [destBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(destBal.onHandQty)).toBe(60);
    expect(parseFloat(destBal.damagedQty || '0')).toBe(5);
  });

  // =========================================================================
  // Section 3: Multi-Stage Partial Receipt & Close Remaining
  // =========================================================================

  it('Phase B - 3: Multi-stage partial receipt and closing remaining in-transit goods', async () => {
    // Create transfer for 50 units
    const transferNum = `TR-PART-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: wacItemId,
          uomId: baseUomId,
          quantity: '50.0000',
          unitCost: '10.0000',
        },
      ],
    });

    await inventoryService.approveTransfer(tenantContext, transfer.id);
    await inventoryService.dispatchTransfer(tenantContext, transfer.id, {});

    // Stage 1: Receive only 30 units (Partial)
    const partialRec = await inventoryService.receiveTransfer(tenantContext, transfer.id, {
      receivedLines: [
        {
          itemId: wacItemId,
          receivedQuantity: '30.0000',
        },
      ],
      receivedNotes: 'دفعة أولى 30 كيس فقط',
    });

    expect(partialRec.status).toBe(TransferStatus.PARTIALLY_RECEIVED);
    expect(parseFloat(partialRec.totalReceivedQty)).toBe(30);

    // Stage 2: Remaining 20 units cancelled / closed
    const closedTransfer = await inventoryService.closeTransfer(tenantContext, transfer.id, {
      closingNotes: 'إغلاق المناقلة وإلغاء المتبقي لتعذر استكماله',
    });

    expect(closedTransfer.status).toBe(TransferStatus.CLOSED);

    // Source in-transit should be cleared back to 0
    const [sourceBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(sourceBal.inTransitQty)).toBe(0);
  });

  // =========================================================================
  // Section 4: Transfer Over-Receipt Strictly Blocked
  // =========================================================================

  it('Phase B - 4: Over-receipt beyond dispatched quantity is strictly rejected', async () => {
    const transferNum = `TR-OVER-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: wacItemId,
          uomId: baseUomId,
          quantity: '20.0000',
          unitCost: '10.0000',
        },
      ],
    });

    await inventoryService.approveTransfer(tenantContext, transfer.id);
    await inventoryService.dispatchTransfer(tenantContext, transfer.id, {});

    // Attempt to receive 25 units when only 20 were shipped
    await expect(
      inventoryService.receiveTransfer(tenantContext, transfer.id, {
        receivedLines: [
          {
            itemId: wacItemId,
            receivedQuantity: '25.0000',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);
  });

  // =========================================================================
  // Section 5: Transfer Rejection and Reservation Release
  // =========================================================================

  it('Phase B - 5: Rejecting an approved transfer releases reserved stock back to available', async () => {
    // Receive dedicated stock so test is self-sufficient
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
      uomId: baseUomId,
      quantity: '30.0000',
      unitCost: '10.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-TEST5-001',
    });

    const [initialSourceBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    const initialReserved = parseFloat(initialSourceBal.reservedQty);

    const transferNum = `TR-REJ-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: wacItemId,
          uomId: baseUomId,
          quantity: '15.0000',
          unitCost: '10.0000',
        },
      ],
    });

    // Approve: reserves 15 units
    await inventoryService.approveTransfer(tenantContext, transfer.id);
    const [balAfterApprove] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(balAfterApprove.reservedQty)).toBe(initialReserved + 15);

    // Reject: releases 15 units
    const rejected = await inventoryService.rejectTransfer(tenantContext, transfer.id, {
      rejectionReason: 'إلغاء الطلب بناءً على رغبة الفرع',
    });
    expect(rejected.status).toBe(TransferStatus.REJECTED);

    const [balAfterReject] = await inventoryService.getBalances(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(balAfterReject.reservedQty)).toBe(initialReserved);
  });

  // =========================================================================
  // Section 6: FIFO Transfer Cost Layers Depletion & Propagation
  // =========================================================================

  it('Phase B - 6: FIFO items consume oldest layers at source and propagate cost layers to destination', async () => {
    // 1. Receive Layer 1 at Central: 30 units @ 50.00 SAR
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: centralWarehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '30.0000',
      unitCost: '50.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-FIFO-S1',
    });

    // 2. Receive Layer 2 at Central: 20 units @ 60.00 SAR
    await inventoryService.receiveStock(tenantContext, {
      legalEntityId,
      warehouseId: centralWarehouseId,
      itemId: fifoItemId,
      uomId: baseUomId,
      quantity: '20.0000',
      unitCost: '60.0000',
      sourceType: 'PURCHASE_RECEIPT',
      sourceDocumentNumber: 'PO-FIFO-S2',
    });

    // Total Central FIFO on-hand = 50 units (Layer 1: 30 @ 50, Layer 2: 20 @ 60)
    // 3. Create & Dispatch Transfer of 35 units to Branch
    const transferNum = `TR-FIFO-${Date.now().toString(36).toUpperCase()}`;
    const transfer = await inventoryService.createTransfer(tenantContext, {
      legalEntityId,
      sourceWarehouseId: centralWarehouseId,
      destinationWarehouseId: branchWarehouseId,
      transferNumber: transferNum,
      lines: [
        {
          itemId: fifoItemId,
          uomId: baseUomId,
          quantity: '35.0000',
          unitCost: '50.0000',
        },
      ],
    });

    await inventoryService.approveTransfer(tenantContext, transfer.id);
    await inventoryService.dispatchTransfer(tenantContext, transfer.id, {});

    // Verify Central Cost Layers:
    // Layer 1 (30 @ 50) completely consumed -> 0 remaining
    // Layer 2 (20 @ 60) partially consumed (5 units) -> 15 remaining
    const centralLayers = await inventoryService.getCostLayers(tenantContext, {
      warehouseId: centralWarehouseId,
      itemId: fifoItemId,
    });
    expect(parseFloat(centralLayers[0].quantityRemaining)).toBe(0);
    expect(parseFloat(centralLayers[1].quantityRemaining)).toBe(15);

    // 4. Receive Transfer at Branch
    await inventoryService.receiveTransfer(tenantContext, transfer.id, {
      receivedLines: [
        {
          itemId: fifoItemId,
          receivedQuantity: '35.0000',
        },
      ],
    });

    // Verify Branch Cost Layers:
    // Must contain a new FIFO cost layer with 35 units received & remaining!
    const branchLayers = await inventoryService.getCostLayers(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: fifoItemId,
    });
    expect(branchLayers.length).toBeGreaterThanOrEqual(1);
    expect(parseFloat(branchLayers[0].quantityRemaining)).toBe(35);
  });

  // =========================================================================
  // Section 7: Stocktake Order Lifecycle (Draft -> In Progress -> Counted -> Approved Variance)
  // =========================================================================

  it('Phase B - 7: Complete Stocktake Order Lifecycle with snapshot, variance calculation, and adjustment execution', async () => {
    // 1. Create Stocktake Order (FULL, PERIODIC)
    const orderNumber = `STK-${Date.now().toString(36).toUpperCase()}`;
    const order = await inventoryService.createStocktakeOrder(tenantContext, {
      legalEntityId,
      warehouseId: branchWarehouseId,
      orderNumber,
      stocktakeType: StocktakeType.FULL,
      countFrequency: StocktakeFrequency.PERIODIC,
      notes: 'جرد ربع سنوي شامل لمستودع فرع العليا',
    });

    expect(order.status).toBe(StocktakeStatus.DRAFT);
    expect(order.orderNumber).toBe(orderNumber);

    // 2. Start Stocktake (captures system snapshot of items in branch warehouse)
    const startedOrder = await inventoryService.startStocktake(tenantContext, order.id);
    expect(startedOrder.status).toBe(StocktakeStatus.IN_PROGRESS);

    // Fetch order details with snapshot lines
    const orderDetails = await inventoryService.getStocktakeOrderById(tenantContext, order.id);
    expect(orderDetails.lines.length).toBeGreaterThanOrEqual(2); // Contains wacItem and fifoItem

    // 3. Record Counted Quantities
    // Find lines for WAC item and FIFO item
    const wacLine = orderDetails.lines.find((l) => l.itemId === wacItemId);
    const fifoLine = orderDetails.lines.find((l) => l.itemId === fifoItemId);

    const wacSystemQty = parseFloat(wacLine!.systemQuantity); // Currently 90
    const fifoSystemQty = parseFloat(fifoLine!.systemQuantity); // Currently 35

    // Physical count scenario:
    // WAC item: Counted 95 (Surplus of +5 units)
    // FIFO item: Counted 30 (Shortage of -5 units)
    const countedWacQty = (wacSystemQty + 5).toFixed(4);
    const countedFifoQty = (fifoSystemQty - 5).toFixed(4);

    const countedOrder = await inventoryService.recordStocktakeCounts(tenantContext, order.id, {
      counts: [
        {
          itemId: wacItemId,
          countedQuantity: countedWacQty,
          notes: 'زيادة 5 كجم نتيجة عدم تسجيل حركة مرتجع',
        },
        {
          itemId: fifoItemId,
          countedQuantity: countedFifoQty,
          notes: 'عجز 5 كجم ناتج عن تلف أثناء التخزين',
        },
      ],
    });

    expect(countedOrder.status).toBe(StocktakeStatus.COUNTED);

    // Verify calculated difference and variance amount
    const countedDetails = await inventoryService.getStocktakeOrderById(tenantContext, order.id);
    const updatedWacLine = countedDetails.lines.find((l) => l.itemId === wacItemId);
    const updatedFifoLine = countedDetails.lines.find((l) => l.itemId === fifoItemId);

    expect(parseFloat(updatedWacLine!.differenceQuantity)).toBe(5);
    expect(parseFloat(updatedFifoLine!.differenceQuantity)).toBe(-5);

    // 4. Approve Stocktake Variance (Executes stock adjustment and updates balances)
    const approvedResult = await inventoryService.approveStocktakeVariance(tenantContext, order.id, {
      approvalNotes: 'تمت مراجعة الفروقات واعتماد التسوية المخزنية رسمياً',
    });

    expect(approvedResult.order.status).toBe(StocktakeStatus.APPROVED);
    expect(approvedResult.adjustment).toBeDefined();

    // 5. Verify final balances in branch warehouse:
    // WAC item: exactly 95 units
    // FIFO item: exactly 30 units
    const [finalWacBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: wacItemId,
    });
    expect(parseFloat(finalWacBal.onHandQty)).toBe(parseFloat(countedWacQty));

    const [finalFifoBal] = await inventoryService.getBalances(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: fifoItemId,
    });
    expect(parseFloat(finalFifoBal.onHandQty)).toBe(parseFloat(countedFifoQty));

    // Verify FIFO Cost Layer after shortage: 5 units were consumed from branch layer (35 - 5 = 30)
    const branchLayersAfterShortage = await inventoryService.getCostLayers(tenantContext, {
      warehouseId: branchWarehouseId,
      itemId: fifoItemId,
    });
    expect(parseFloat(branchLayersAfterShortage[0].quantityRemaining)).toBe(30);
  });
});
