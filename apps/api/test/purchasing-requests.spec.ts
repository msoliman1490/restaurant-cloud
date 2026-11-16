import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PurchasingService } from '../src/modules/purchasing/purchasing.service';
import { PurchasingController } from '../src/modules/purchasing/purchasing.controller';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  tenants,
  legalEntities,
  branches,
  warehouses,
  unitsOfMeasure,
  items,
  suppliers,
} from '@restaurant-cloud/database';
import {
  TenantContext,
  PurchaseRequestStatus,
  PurchaseOrderStatus,
} from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Purchase Requests & Pagination (Staging DB)', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let postingEngine: PostingEngineService;
  let inventoryService: InventoryService;
  let purchasingService: PurchasingService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leAId = randomUUID();
  const leBId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const whA1Id = randomUUID();
  const whA2Id = randomUUID();
  const whBId = randomUUID();
  const uomAId = randomUUID();
  const uomBId = randomUUID();
  const itemAId = randomUUID();
  const itemBId = randomUUID();
  const supplierAId = randomUUID();
  const userAId = randomUUID();
  const approverAId = randomUUID();
  const userBId = randomUUID();

  let ctxA: TenantContext;
  let ctxApproverA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();
    auditService = new AuditService(dbService);
    postingEngine = new PostingEngineService(dbService, auditService);
    inventoryService = new InventoryService(dbService, auditService, postingEngine, null as any);
    purchasingService = new PurchasingService(dbService, auditService, inventoryService, postingEngine);

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      legalEntityId: leAId,
      branchId: branchAId,
      permissions: ['*'],
    };
    ctxApproverA = {
      tenantId: tenantAId,
      userId: approverAId,
      legalEntityId: leAId,
      branchId: branchAId,
      permissions: ['*'],
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leBId,
      branchId: branchBId,
      permissions: ['*'],
    };

    const suffix = Date.now();
    await dbService.db.insert(tenants).values([
      { id: tenantAId, code: `pr-a-${suffix}`, displayName: 'PR Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `pr-b-${suffix}`, displayName: 'PR Tenant B', status: 'ACTIVE' },
    ]);

    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leAId,
        tenantId: tenantAId,
        legalName: 'PR Entity A',
        vatNumber: '310333333333333',
      });
      await tx.insert(branches).values({
        id: branchAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        code: `BR-PRA-${suffix}`,
        name: 'Branch PR A',
        status: 'ACTIVE',
      });
      await tx.insert(warehouses).values([
        {
          id: whA1Id,
          tenantId: tenantAId,
          legalEntityId: leAId,
          branchId: branchAId,
          code: `WH-PRA1-${suffix}`,
          name: 'Warehouse PR A1',
          warehouseType: 'BRANCH',
          status: 'ACTIVE',
          allowReceiving: true,
          allowIssuing: true,
        },
        {
          id: whA2Id,
          tenantId: tenantAId,
          legalEntityId: leAId,
          branchId: branchAId,
          code: `WH-PRA2-${suffix}`,
          name: 'Warehouse PR A2',
          warehouseType: 'BRANCH',
          status: 'ACTIVE',
          allowReceiving: true,
          allowIssuing: true,
        },
      ]);
      await tx.insert(unitsOfMeasure).values({
        id: uomAId,
        tenantId: tenantAId,
        code: `KG-PRA-${suffix}`,
        nameAr: 'كيلو',
        nameEn: 'KG',
        category: 'MASS',
        isBase: true,
      });
      await tx.insert(items).values({
        id: itemAId,
        tenantId: tenantAId,
        legalEntityOwnerId: leAId,
        sku: `SKU-PRA-${suffix}`,
        nameAr: 'صنف اختبار طلب شراء',
        nameEn: 'PR Test Item',
        itemType: 'RAW_MATERIAL',
        baseUomId: uomAId,
        isTrackInventory: true,
        status: 'ACTIVE',
      });
      await tx.insert(suppliers).values({
        id: supplierAId,
        tenantId: tenantAId,
        code: `SUP-PRA-${suffix}`,
        name: 'مورد طلبات الشراء',
        status: 'ACTIVE',
      });
    });

    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leBId,
        tenantId: tenantBId,
        legalName: 'PR Entity B',
        vatNumber: '310444444444443',
      });
      await tx.insert(branches).values({
        id: branchBId,
        tenantId: tenantBId,
        legalEntityId: leBId,
        code: `BR-PRB-${suffix}`,
        name: 'Branch PR B',
        status: 'ACTIVE',
      });
      await tx.insert(warehouses).values({
        id: whBId,
        tenantId: tenantBId,
        legalEntityId: leBId,
        branchId: branchBId,
        code: `WH-PRB-${suffix}`,
        name: 'Warehouse PR B',
        warehouseType: 'BRANCH',
        status: 'ACTIVE',
        allowReceiving: true,
        allowIssuing: true,
      });
      await tx.insert(unitsOfMeasure).values({
        id: uomBId,
        tenantId: tenantBId,
        code: `KG-PRB-${suffix}`,
        nameAr: 'كيلو',
        nameEn: 'KG',
        category: 'MASS',
        isBase: true,
      });
      await tx.insert(items).values({
        id: itemBId,
        tenantId: tenantBId,
        legalEntityOwnerId: leBId,
        sku: `SKU-PRB-${suffix}`,
        nameAr: 'صنف ب',
        nameEn: 'Item B',
        itemType: 'RAW_MATERIAL',
        baseUomId: uomBId,
        isTrackInventory: true,
        status: 'ACTIVE',
      });
    });
  });

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('1. Create PR, List with Filters & Pagination, and Fetch Details', async () => {
    const suffix = Date.now();
    const pr1 = await purchasingService.createPurchaseRequest(ctxA, {
      legalEntityId: leAId,
      warehouseId: whA1Id,
      requestNumber: `PR-1-${suffix}`,
      notes: 'Urgent kitchen restock',
      lines: [
        {
          itemId: itemAId,
          uomId: uomAId,
          requestedQty: '12.0000',
          estimatedUnitCost: '15.0000',
        },
      ],
    });
    expect(pr1.status).toBe(PurchaseRequestStatus.SUBMITTED);
    expect(pr1.lines.length).toBe(1);

    const pr2 = await purchasingService.createPurchaseRequest(ctxA, {
      legalEntityId: leAId,
      warehouseId: whA2Id,
      requestNumber: `PR-2-${suffix}`,
      lines: [
        {
          itemId: itemAId,
          uomId: uomAId,
          requestedQty: '5.0000',
          estimatedUnitCost: '20.0000',
        },
      ],
    });

    const page1 = await purchasingService.getPurchaseRequests(ctxA, {
      legalEntityId: leAId,
      page: 1,
      limit: 1,
    });
    expect(page1.items.length).toBe(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);
    expect(page1.totalPages).toBeGreaterThanOrEqual(2);

    const wh2Filtered = await purchasingService.getPurchaseRequests(ctxA, {
      legalEntityId: leAId,
      warehouseId: whA2Id,
    });
    expect(wh2Filtered.items.some((r) => r.id === pr2.id)).toBe(true);
    expect(wh2Filtered.items.some((r) => r.id === pr1.id)).toBe(false);

    const detail = await purchasingService.getPurchaseRequestById(ctxA, pr1.id);
    expect(detail.id).toBe(pr1.id);
    expect(detail.lines.length).toBe(1);
    expect(detail.approvalMetadata.requestedBy).toBe(userAId);
  });

  it('2. Approve, Reject, and Convert Approved PR to PO (with Duplicate & Concurrency Guards)', async () => {
    const suffix = Date.now();
    const prApprove = await purchasingService.createPurchaseRequest(ctxA, {
      legalEntityId: leAId,
      warehouseId: whA1Id,
      requestNumber: `PR-APP-${suffix}`,
      lines: [
        {
          itemId: itemAId,
          uomId: uomAId,
          requestedQty: '10.0000',
          estimatedUnitCost: '25.0000',
        },
      ],
    });

    // Cannot convert SUBMITTED PR before approval
    await expect(
      purchasingService.convertPurchaseRequestToOrder(ctxA, prApprove.id, {
        supplierId: supplierAId,
      })
    ).rejects.toThrow(ConflictException);

    const approved = await purchasingService.approvePurchaseRequest(ctxApproverA, prApprove.id);
    expect(approved.status).toBe(PurchaseRequestStatus.APPROVED);
    expect(approved.approvedBy).toBe(approverAId);

    // Cannot approve again
    await expect(
      purchasingService.approvePurchaseRequest(ctxApproverA, prApprove.id)
    ).rejects.toThrow(ConflictException);

    // Concurrent convert-to-po: only one succeeds
    const results = await Promise.allSettled([
      purchasingService.convertPurchaseRequestToOrder(ctxA, prApprove.id, {
        supplierId: supplierAId,
        orderNumber: `PO-FROM-PR-${suffix}-1`,
      }),
      purchasingService.convertPurchaseRequestToOrder(ctxA, prApprove.id, {
        supplierId: supplierAId,
        orderNumber: `PO-FROM-PR-${suffix}-2`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const converted = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(converted.purchaseRequest.status).toBe('CONVERTED_TO_PO');
    expect(converted.purchaseOrder.status).toBe(PurchaseOrderStatus.ISSUED);
    expect(converted.purchaseOrder.lines.length).toBe(1);
    // 10 * 25 = 250 subtotal + 37.50 VAT = 287.50
    expect(parseFloat(converted.purchaseOrder.grandTotal)).toBeCloseTo(287.5, 2);

    // Subsequent conversion attempt rejected with ConflictException
    await expect(
      purchasingService.convertPurchaseRequestToOrder(ctxA, prApprove.id, {
        supplierId: supplierAId,
      })
    ).rejects.toThrow(ConflictException);

    // Reject workflow
    const prReject = await purchasingService.createPurchaseRequest(ctxA, {
      legalEntityId: leAId,
      warehouseId: whA1Id,
      requestNumber: `PR-REJ-${suffix}`,
      lines: [
        {
          itemId: itemAId,
          uomId: uomAId,
          requestedQty: '3.0000',
          estimatedUnitCost: '10.0000',
        },
      ],
    });
    const rejectedPr = await purchasingService.rejectPurchaseRequest(ctxApproverA, prReject.id, 'Budget exceeded');
    expect(rejectedPr.status).toBe(PurchaseRequestStatus.REJECTED);
    expect(rejectedPr.notes).toContain('Budget exceeded');

    await expect(
      purchasingService.approvePurchaseRequest(ctxApproverA, prReject.id)
    ).rejects.toThrow(ConflictException);
  });

  it('3. Server-side Pagination on POs, GRNs, Invoices, Returns & RLS/RBAC Verification', async () => {
    const poPage = await purchasingService.getPurchaseOrders(ctxA, leAId, { page: 1, limit: 5 });
    expect(Array.isArray(poPage.items)).toBe(true);
    expect(poPage.total).toBeGreaterThanOrEqual(1);
    expect(poPage.page).toBe(1);
    expect(poPage.limit).toBe(5);

    const grnPage = await purchasingService.getGoodsReceipts(ctxA, leAId, { page: 1, limit: 5 });
    expect(Array.isArray(grnPage.items)).toBe(true);
    expect(typeof grnPage.totalPages).toBe('number');

    const invPage = await purchasingService.getSupplierInvoices(ctxA, leAId, { page: 1, limit: 5 });
    expect(Array.isArray(invPage.items)).toBe(true);

    const retPage = await purchasingService.getPurchaseReturns(ctxA, leAId, { page: 1, limit: 5 });
    expect(Array.isArray(retPage.items)).toBe(true);

    // Tenant B cannot see Tenant A PRs
    const tenantBList = await purchasingService.getPurchaseRequests(ctxB, { legalEntityId: leAId });
    expect(tenantBList.items.length).toBe(0);
    expect(tenantBList.total).toBe(0);

    // Verify controller permission decorators
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PurchasingController.prototype.getRequests)
    ).toContain('purchasing.read');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PurchasingController.prototype.getRequestById)
    ).toContain('purchasing.read');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PurchasingController.prototype.approveRequest)
    ).toContain('purchasing.approve');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PurchasingController.prototype.rejectRequest)
    ).toContain('purchasing.approve');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PurchasingController.prototype.convertRequestToPo)
    ).toContain('purchasing.create');
  });
});
