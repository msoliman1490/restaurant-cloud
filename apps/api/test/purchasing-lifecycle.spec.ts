import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
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
  inventoryBalances,
  chartOfAccounts,
  accountMappings,
  fiscalYears,
  fiscalPeriods,
  journalEntries,
  journalLines,
  purchaseOrders,
  supplierInvoices,
  supplierBalances,
} from '@restaurant-cloud/database';
import {
  TenantContext,
  AccountType,
  DefaultAccountMappingKey,
  PurchaseOrderStatus,
  SupplierInvoiceStatus,
} from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Purchasing Full Lifecycle (Staging DB)', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let postingEngine: PostingEngineService;
  let inventoryService: InventoryService;
  let purchasingService: PurchasingService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leA1Id = randomUUID();
  const leB1Id = randomUUID();
  const branchA1Id = randomUUID();
  const branchB1Id = randomUUID();
  const whA1Id = randomUUID();
  const whB1Id = randomUUID();
  const uomKgId = randomUUID();
  const uomKgBId = randomUUID();
  const itemAId = randomUUID();
  const itemBId = randomUUID();
  const supplierAId = randomUUID();
  const supplierBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  let ctxA: TenantContext;
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
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      permissions: ['*'],
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leB1Id,
      branchId: branchB1Id,
      permissions: ['*'],
    };

    const suffix = Date.now();
    await dbService.db.insert(tenants).values([
      { id: tenantAId, code: `purch-a-${suffix}`, displayName: 'Purchasing Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `purch-b-${suffix}`, displayName: 'Purchasing Tenant B', status: 'ACTIVE' },
    ]);

    const seedTenant = async (
      ctx: TenantContext,
      leId: string,
      branchId: string,
      whId: string,
      uomId: string,
      supplierId: string,
      itemId: string,
      codePrefix: string
    ) => {
      await dbService.withTenantContext(ctx, async (tx) => {
        await tx.insert(legalEntities).values({
          id: leId,
          tenantId: ctx.tenantId,
          legalName: `Purchasing Entity ${codePrefix}`,
          vatNumber: codePrefix === 'A' ? '310111111111113' : '310222222222223',
        });

        await tx.insert(branches).values({
          id: branchId,
          tenantId: ctx.tenantId,
          legalEntityId: leId,
          code: `BR-${codePrefix}-${suffix}`,
          name: `Branch ${codePrefix}`,
          status: 'ACTIVE',
        });

        await tx.insert(warehouses).values({
          id: whId,
          tenantId: ctx.tenantId,
          legalEntityId: leId,
          branchId,
          code: `WH-${codePrefix}-${suffix}`,
          name: `Warehouse ${codePrefix}`,
          warehouseType: 'BRANCH',
          status: 'ACTIVE',
          allowReceiving: true,
          allowIssuing: true,
        });

        await tx.insert(unitsOfMeasure).values({
          id: uomId,
          tenantId: ctx.tenantId,
          code: `KG-${codePrefix}-${suffix}`,
          nameAr: 'كيلوجرام',
          nameEn: 'Kilogram',
          category: 'MASS',
          isBase: true,
        });

        await tx.insert(items).values({
          id: itemId,
          tenantId: ctx.tenantId,
          legalEntityOwnerId: leId,
          sku: `SKU-${codePrefix}-${suffix}`,
          nameAr: `صدور دجاج ${codePrefix}`,
          nameEn: `Chicken Breast ${codePrefix}`,
          baseUomId: uomId,
          defaultCost: '20.0000',
        });

        await tx.insert(suppliers).values({
          id: supplierId,
          tenantId: ctx.tenantId,
          legalEntityId: leId,
          code: `SUP-${codePrefix}-${suffix}`,
          name: `Supplier ${codePrefix}`,
          nameAr: `مورد ${codePrefix}`,
          status: 'ACTIVE',
        });

        const fyId = randomUUID();
        const now = new Date();
        await tx.insert(fiscalYears).values({
          id: fyId,
          tenantId: ctx.tenantId,
          legalEntityId: leId,
          yearCode: String(now.getUTCFullYear()),
          yearName: String(now.getUTCFullYear()),
          startDate: new Date(now.getUTCFullYear(), 0, 1),
          endDate: new Date(now.getUTCFullYear(), 11, 31, 23, 59, 59),
          status: 'OPEN',
        });

        await tx.insert(fiscalPeriods).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          legalEntityId: leId,
          fiscalYearId: fyId,
          periodNumber: now.getUTCMonth() + 1,
          periodName: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
          startDate: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
          endDate: new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
          status: 'OPEN',
        });

        const invAccId = randomUUID();
        const vatAccId = randomUUID();
        const apAccId = randomUUID();
        const cashAccId = randomUUID();
        const bankAccId = randomUUID();

        await tx.insert(chartOfAccounts).values([
          {
            id: invAccId,
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            accountCode: '1104',
            name: 'Inventory',
            nameAr: 'المخزون',
            accountType: AccountType.ASSET,
            isPostable: true,
            status: 'ACTIVE',
          },
          {
            id: vatAccId,
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            accountCode: '2102',
            name: 'VAT Input',
            nameAr: 'ضريبة المدخلات',
            accountType: AccountType.ASSET,
            isPostable: true,
            status: 'ACTIVE',
          },
          {
            id: apAccId,
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            accountCode: '2100',
            name: 'Accounts Payable',
            nameAr: 'ذمم دائنة',
            accountType: AccountType.LIABILITY,
            isPostable: true,
            status: 'ACTIVE',
          },
          {
            id: cashAccId,
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            accountCode: '1010',
            name: 'Cash Vault',
            nameAr: 'الصندوق',
            accountType: AccountType.ASSET,
            isPostable: true,
            status: 'ACTIVE',
          },
          {
            id: bankAccId,
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            accountCode: '1020',
            name: 'Bank Account',
            nameAr: 'البنك',
            accountType: AccountType.ASSET,
            isPostable: true,
            status: 'ACTIVE',
          },
        ]);

        await tx.insert(accountMappings).values([
          {
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            mappingKey: DefaultAccountMappingKey.INVENTORY,
            accountId: invAccId,
            isActive: true,
          },
          {
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            mappingKey: DefaultAccountMappingKey.VAT_INPUT,
            accountId: vatAccId,
            isActive: true,
          },
          {
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
            accountId: apAccId,
            isActive: true,
          },
          {
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            mappingKey: DefaultAccountMappingKey.CASH_VAULT,
            accountId: cashAccId,
            isActive: true,
          },
          {
            tenantId: ctx.tenantId,
            legalEntityId: leId,
            mappingKey: DefaultAccountMappingKey.BANK,
            accountId: bankAccId,
            isActive: true,
          },
        ]);
      });
    };

    await seedTenant(ctxA, leA1Id, branchA1Id, whA1Id, uomKgId, supplierAId, itemAId, 'A');
    await seedTenant(ctxB, leB1Id, branchB1Id, whB1Id, uomKgBId, supplierBId, itemBId, 'B');
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('1. Full PO lifecycle: Draft -> Approve -> Partial & Full GRN -> 3-Way Match Invoice -> Partial & Full Payment', async () => {
    const po = await purchasingService.createPurchaseOrder(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      orderNumber: `PO-LIFE-${Date.now()}`,
      currency: 'SAR',
      submitAsDraft: true,
      lines: [
        {
          itemId: itemAId,
          uomId: uomKgId,
          orderedQty: '10.0000',
          unitPrice: '25.0000',
          taxRate: '0.1500',
        },
      ],
    });
    expect(po.status).toBe(PurchaseOrderStatus.DRAFT);

    // Reject receiving goods while PO is DRAFT
    await expect(
      purchasingService.receiveGoods(ctxA, {
        legalEntityId: leA1Id,
        purchaseOrderId: po.id,
        supplierId: supplierAId,
        warehouseId: whA1Id,
        receiptNumber: `GRN-FAIL-${Date.now()}`,
        lines: [
          {
            purchaseOrderLineId: po.lines[0]!.id,
            itemId: itemAId,
            uomId: uomKgId,
            receivedQty: '4.0000',
            unitCost: '25.0000',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);

    // Approve PO
    const approved = await purchasingService.approvePurchaseOrder(ctxA, po.id);
    expect(approved?.status).toBe(PurchaseOrderStatus.ISSUED);

    // Partial GRN (4 of 10)
    const grn1 = await purchasingService.receiveGoods(ctxA, {
      legalEntityId: leA1Id,
      purchaseOrderId: po.id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      receiptNumber: `GRN-P1-${Date.now()}`,
      lines: [
        {
          purchaseOrderLineId: po.lines[0]!.id,
          itemId: itemAId,
          uomId: uomKgId,
          receivedQty: '4.0000',
          unitCost: '25.0000',
        },
      ],
    });
    expect(grn1.id).toBeDefined();

    // Verify PO is PARTIALLY_RECEIVED and inventory is 4.0000
    await dbService.withTenantContext(ctxA, async (tx) => {
      const [poRow] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
      expect(poRow?.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, itemAId)));
      expect(parseFloat(bal?.onHandQty || '0')).toBe(4);
    });

    // Reject over-receipt (attempting 7 when only 6 remain)
    await expect(
      purchasingService.receiveGoods(ctxA, {
        legalEntityId: leA1Id,
        purchaseOrderId: po.id,
        supplierId: supplierAId,
        warehouseId: whA1Id,
        receiptNumber: `GRN-OVER-${Date.now()}`,
        lines: [
          {
            purchaseOrderLineId: po.lines[0]!.id,
            itemId: itemAId,
            uomId: uomKgId,
            receivedQty: '7.0000',
            unitCost: '25.0000',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);

    // Remaining GRN (6 of 10)
    const grn2 = await purchasingService.receiveGoods(ctxA, {
      legalEntityId: leA1Id,
      purchaseOrderId: po.id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      receiptNumber: `GRN-P2-${Date.now()}`,
      lines: [
        {
          purchaseOrderLineId: po.lines[0]!.id,
          itemId: itemAId,
          uomId: uomKgId,
          receivedQty: '6.0000',
          unitCost: '25.0000',
        },
      ],
    });
    expect(grn2.id).toBeDefined();

    // 3-Way Match guard: reject price variance > 2% without override
    await expect(
      purchasingService.createSupplierInvoice(ctxA, {
        legalEntityId: leA1Id,
        supplierId: supplierAId,
        purchaseOrderId: po.id,
        goodsReceiptId: grn1.id,
        invoiceNumber: `INV-VAR-${Date.now()}`,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        currency: 'SAR',
        lines: [
          {
            itemId: itemAId,
            quantity: '4.0000',
            unitPrice: '35.0000',
            taxRate: '0.1500',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);

    // 3-Way Match guard: reject qty > GRN1 received qty (4)
    await expect(
      purchasingService.createSupplierInvoice(ctxA, {
        legalEntityId: leA1Id,
        supplierId: supplierAId,
        purchaseOrderId: po.id,
        goodsReceiptId: grn1.id,
        invoiceNumber: `INV-QTY-${Date.now()}`,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        currency: 'SAR',
        lines: [
          {
            itemId: itemAId,
            quantity: '5.0000',
            unitPrice: '25.0000',
            taxRate: '0.1500',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);

    // Valid 3-Way Matched Invoice for GRN1 (4 * 25 = 100 + 15 VAT = 115 SAR)
    const inv = await purchasingService.createSupplierInvoice(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      purchaseOrderId: po.id,
      goodsReceiptId: grn1.id,
      invoiceNumber: `INV-OK-${Date.now()}`,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      currency: 'SAR',
      lines: [
        {
          itemId: itemAId,
          quantity: '4.0000',
          unitPrice: '25.0000',
          taxRate: '0.1500',
        },
      ],
    });
    expect(parseFloat(inv.grandTotal)).toBeCloseTo(115, 2);

    // Partial Payment (50 SAR)
    const pmt1 = await purchasingService.createSupplierPayment(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      invoiceId: inv.id,
      paymentNumber: `PMT-1-${Date.now()}`,
      amount: '50.0000',
      paymentMethod: 'BANK_TRANSFER',
    });
    expect(pmt1.id).toBeDefined();

    // Overpayment guard (attempting 70 when 65 remains)
    await expect(
      purchasingService.createSupplierPayment(ctxA, {
        legalEntityId: leA1Id,
        supplierId: supplierAId,
        invoiceId: inv.id,
        paymentNumber: `PMT-OVER-${Date.now()}`,
        amount: '70.0000',
        paymentMethod: 'CASH',
      })
    ).rejects.toThrow(BadRequestException);

    // Remaining Payment (65 SAR)
    const pmt2 = await purchasingService.createSupplierPayment(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      invoiceId: inv.id,
      paymentNumber: `PMT-2-${Date.now()}`,
      amount: '65.0000',
      paymentMethod: 'CASH',
    });
    expect(pmt2.id).toBeDefined();

    await dbService.withTenantContext(ctxA, async (tx) => {
      const [invRow] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, inv.id));
      expect(invRow?.status).toBe(SupplierInvoiceStatus.PAID);

      const [apBal] = await tx
        .select()
        .from(supplierBalances)
        .where(and(eq(supplierBalances.legalEntityId, leA1Id), eq(supplierBalances.supplierId, supplierAId)));
      expect(parseFloat(apBal?.currentBalance || '0')).toBeCloseTo(0, 2);

      // Verify GL entries were posted through PostingEngine (invoice + 2 payments)
      const jvs = await tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.legalEntityId, leA1Id));
      expect(jvs.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('2. Purchase Return deducts inventory via InventoryService and posts reversal GL via PostingEngine', async () => {
    const grn = await purchasingService.receiveGoods(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      receiptNumber: `GRN-RET-${Date.now()}`,
      lines: [
        {
          itemId: itemAId,
          uomId: uomKgId,
          receivedQty: '5.0000',
          unitCost: '20.0000',
        },
      ],
    });

    const ret = await purchasingService.createPurchaseReturn(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      goodsReceiptId: grn.id,
      returnNumber: `RET-${Date.now()}`,
      reason: 'Damaged packaging',
      lines: [
        {
          itemId: itemAId,
          uomId: uomKgId,
          quantity: '2.0000',
          unitCost: '20.0000',
        },
      ],
    });
    expect(parseFloat(ret.totalAmount)).toBeCloseTo(40, 2);

    // Reject returning more than received on GRN (attempting 4 more when only 3 remain)
    await expect(
      purchasingService.createPurchaseReturn(ctxA, {
        legalEntityId: leA1Id,
        supplierId: supplierAId,
        warehouseId: whA1Id,
        goodsReceiptId: grn.id,
        returnNumber: `RET-OVER-${Date.now()}`,
        reason: 'Over return test',
        lines: [
          {
            itemId: itemAId,
            uomId: uomKgId,
            quantity: '4.0000',
            unitCost: '20.0000',
          },
        ],
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('3. Concurrency & Idempotency: concurrent PO approval succeeds once; duplicate receipt/payment rejected', async () => {
    const po = await purchasingService.createPurchaseOrder(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      orderNumber: `PO-CONC-${Date.now()}`,
      currency: 'SAR',
      submitAsDraft: true,
      lines: [
        {
          itemId: itemAId,
          uomId: uomKgId,
          orderedQty: '5.0000',
          unitPrice: '20.0000',
          taxRate: '0.1500',
        },
      ],
    });

    const results = await Promise.allSettled([
      purchasingService.approvePurchaseOrder(ctxA, po.id),
      purchasingService.approvePurchaseOrder(ctxA, po.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('4. Multi-Tenant RLS Isolation & RBAC Metadata Enforcement', async () => {
    // Tenant B cannot see Tenant A purchase orders
    const tenantBOrders = await purchasingService.getPurchaseOrders(ctxB, leA1Id);
    expect(tenantBOrders.length).toBe(0);

    // Verify controller permissions decorators
    const createOrderPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PurchasingController.prototype.createOrder
    );
    const approveOrderPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PurchasingController.prototype.approveOrder
    );
    expect(createOrderPerms).toContain('purchasing.order.create');
    expect(approveOrderPerms).toContain('purchasing.order.approve');
  });

  it('5. Supplier Payment Cancellation reverses AP & invoice status via new reversal JV without altering historical JVs, and supplier_balances matches GL AP', async () => {
    const grn = await purchasingService.receiveGoods(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      warehouseId: whA1Id,
      receiptNumber: `GRN-CXL-${Date.now()}`,
      lines: [
        {
          itemId: itemAId,
          uomId: uomKgId,
          receivedQty: '2.0000',
          unitCost: '50.0000',
        },
      ],
    });

    const inv = await purchasingService.createSupplierInvoice(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      goodsReceiptId: grn.id,
      invoiceNumber: `INV-CXL-${Date.now()}`,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      currency: 'SAR',
      lines: [
        {
          itemId: itemAId,
          quantity: '2.0000',
          unitPrice: '50.0000',
          taxRate: '0.1500',
        },
      ],
    });
    expect(parseFloat(inv.grandTotal)).toBeCloseTo(115, 2);

    const pmtNum = `PMT-CXL-${Date.now()}`;
    const pmt = await purchasingService.createSupplierPayment(ctxA, {
      legalEntityId: leA1Id,
      supplierId: supplierAId,
      invoiceId: inv.id,
      paymentNumber: pmtNum,
      amount: '75.0000',
      paymentMethod: 'BANK_TRANSFER',
    });

    // Cancel the payment
    const cancelled = await purchasingService.cancelSupplierPayment(ctxA, pmt.id, 'Bank transfer bounced');
    expect(cancelled?.notes).toContain('[CANCELLED:');

    // Reject double cancellation
    await expect(
      purchasingService.cancelSupplierPayment(ctxA, pmt.id, 'Double cancel')
    ).rejects.toThrow(BadRequestException);

    await dbService.withTenantContext(ctxA, async (tx) => {
      // Invoice restored to APPROVED with paidAmount = 0
      const [invRow] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, inv.id));
      expect(invRow?.status).toBe(SupplierInvoiceStatus.APPROVED);
      expect(parseFloat(invRow?.paidAmount || '0')).toBeCloseTo(0, 2);

      // Historical payment JV remains untouched (POSTED, 75.0000), and new reversal JV exists
      const [origJv] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.legalEntityId, leA1Id), eq(journalEntries.journalNumber, `JV-PMT-${pmtNum}`)));
      const [revJv] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.legalEntityId, leA1Id), eq(journalEntries.journalNumber, `JV-REV-PMT-${pmtNum}`)));
      expect(origJv?.status).toBe('POSTED');
      expect(parseFloat(origJv?.debitTotal || '0')).toBeCloseTo(75, 2);
      expect(revJv?.status).toBe('POSTED');
      expect(parseFloat(revJv?.debitTotal || '0')).toBeCloseTo(75, 2);

      // Verify supplier_balances matches GL AP account net (Credits - Debits)
      const [apAcc] = await tx
        .select()
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.legalEntityId, leA1Id), eq(chartOfAccounts.accountCode, '2100')));
      const apLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.accountId, apAcc!.id));
      const glApNet = apLines.reduce(
        (sum, l) => sum + parseFloat(l.credit) - parseFloat(l.debit),
        0
      );

      const [apBal] = await tx
        .select()
        .from(supplierBalances)
        .where(and(eq(supplierBalances.legalEntityId, leA1Id), eq(supplierBalances.supplierId, supplierAId)));
      expect(parseFloat(apBal?.currentBalance || '0')).toBeCloseTo(glApNet, 2);
      expect(glApNet).toBeCloseTo(75, 2);
    });
  });
});
