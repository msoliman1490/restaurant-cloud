import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExecutionContext, ForbiddenException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { ProductionService } from '../src/modules/production/production.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { SalesController } from '../src/modules/sales/sales.controller';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderType,
  OrderChannel,
} from '@restaurant-cloud/domain-kernel';
import {
  salesOrders,
  payments,
  orderLines,
  journalEntries,
  items,
  unitsOfMeasure,
  warehouses,
  devices,
} from '@restaurant-cloud/database';

describe('POS Printing & Sales Returns — Permissions, Idempotency & Receipt Integrity (Staging DB)', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let accountingService: AccountingService;
  let financialResourcesService: FinancialResourcesService;
  let opsFramework: OperationsFrameworkService;
  let productionService: ProductionService;
  let salesService: SalesService;

  let tenantId: string;
  let adminUserId: string;
  let legalEntityId: string;
  let branchId: string;
  let warehouseId: string;
  let deviceId: string;
  let uomPcsId: string;
  let burgerItemId: string;
  let sysCtx: TenantContext;

  const tenantCode = `pospr-${Date.now().toString(36).slice(-6)}`;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    postingEngine = new PostingEngineService(dbService, auditService);
    opsFramework = new OperationsFrameworkService(dbService);
    accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
    financialResourcesService = new FinancialResourcesService(dbService, auditService, opsFramework);
    productionService = new ProductionService(dbService, auditService);
    salesService = new SalesService(
      dbService,
      auditService,
      productionService,
      accountingService,
      postingEngine,
      opsFramework
    );

    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `POS Printing & Returns ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة اختبار طباعة ومرتجعات نقاط البيع',
        commercialName: 'POS Print & Return Test LLC',
        vatNumber: '310555555500003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-PR-01',
        name: 'فرع الاختبار الرئيسي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        displayName: 'مدير نقطة البيع',
        password: 'Password123!Secure',
      },
    });

    tenantId = tenantResult.tenant.id;
    adminUserId = tenantResult.user.id;
    legalEntityId = tenantResult.legalEntity.id;
    branchId = tenantResult.branch.id;

    sysCtx = {
      tenantId,
      userId: adminUserId,
      email: `admin-${tenantCode}@restaurant-cloud.test`,
      role: 'SUPER_ADMIN',
      scopes: ['*'],
    };

    const currentYear = new Date().getFullYear();
    await accountingService.createFiscalPeriod(sysCtx, {
      legalEntityId,
      periodName: `FY-${currentYear}`,
      startDate: `${currentYear}-01-01T00:00:00.000Z`,
      endDate: `${currentYear}-12-31T23:59:59.000Z`,
    });

    // Standard COA accounts & mappings
    const salesAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '411000',
      name: 'إيراد مبيعات نقاط البيع',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    const vatAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '211200',
      name: 'ضريبة القيمة المضافة مخرجات',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    const cogsAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '511000',
      name: 'تكلفة البضاعة المباعة',
      accountType: AccountType.COGS,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    const invAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '112000',
      name: 'المخزون',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    const vaultAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '111100',
      name: 'الصندوق النقدي',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '111300',
      name: 'وسيط مدفوعات الشبكة',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    await accountingService.createAccount(sysCtx, {
      legalEntityId,
      accountCode: '111400',
      name: 'وسيط بطاقات الائتمان',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    const vault = await financialResourcesService.createCashVault(sysCtx, {
      legalEntityId,
      branchId,
      code: `VLT-${tenantCode}`,
      nameAr: 'صندوق الكاشير الرئيسي',
      accountId: vaultAcc.id,
    });

    const dev = await financialResourcesService.createPosDevice(sysCtx, {
      legalEntityId,
      branchId,
      deviceCode: `DEV-${tenantCode}`,
      name: 'جهاز كاشير 1',
      deviceType: 'POS',
      cashVaultId: vault.id,
    });
    deviceId = dev.id;

    await dbService.withTenantContext(sysCtx, async (tx) => {
      const [wh] = await tx
        .insert(warehouses)
        .values({
          tenantId,
          legalEntityId,
          branchId,
          code: `WH-${tenantCode}`,
          name: 'المستودع الرئيسي',
          type: 'STORAGE',
        })
        .returning();
      warehouseId = wh.id;

      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId,
          code: `PCS-${tenantCode}`,
          nameAr: 'حبة',
          nameEn: 'Piece',
        })
        .returning();
      uomPcsId = uom.id;

      const [item] = await tx
        .insert(items)
        .values({
          tenantId,
          legalEntityOwnerId: legalEntityId,
          sku: `BRG-${tenantCode}`,
          nameAr: 'برجر لحم مشوي',
          nameEn: 'Grilled Beef Burger',
          baseUomId: uomPcsId,
          isSold: true,
          isActive: true,
          defaultPrice: '50.0000',
          taxRate: '0.1500',
        })
        .returning();
      burgerItemId = item.id;
    });
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('enforces sales.refund permission on POST /api/v1/sales/orders/:id/refund', () => {
    const requiredPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      SalesController.prototype.refundSalesOrder
    );
    expect(requiredPerms).toEqual(['sales.refund']);

    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);

    const makeContext = (scopes: string[]): ExecutionContext =>
      ({
        getHandler: () => SalesController.prototype.refundSalesOrder,
        getClass: () => SalesController,
        switchToHttp: () => ({
          getRequest: () => ({
            tenantContext: {
              tenantId,
              userId: adminUserId,
              scopes,
            },
          }),
        }),
      }) as unknown as ExecutionContext;

    expect(() => guard.canActivate(makeContext(['pos.order.create', 'sales.read']))).toThrow(
      ForbiddenException
    );
    expect(guard.canActivate(makeContext(['sales.refund']))).toBe(true);
  });

  it('verifies receipt total, 15% VAT, discount, and split payment breakdown integrity on Staging DB', async () => {
    // 2 units @ 50.00 = 100.00 gross, 10.00 discount => 90.00 net, 15% VAT = 13.50, grandTotal = 103.50
    const createdOrder = await salesService.createSalesOrder(sysCtx, {
      legalEntityId,
      branchId,
      deviceId,
      warehouseId,
      orderNumber: `ORD-RCPT-${Date.now().toString(36).toUpperCase()}`,
      orderType: OrderType.TAKEAWAY,
      channel: OrderChannel.POS,
      idempotencyKey: `idem-rcpt-${randomUUID()}`,
      lines: [
        {
          itemId: burgerItemId,
          uomId: uomPcsId,
          quantity: '2.0000',
          unitPrice: '50.0000',
          discountAmount: '10.0000',
        },
      ],
      payments: [
        { paymentMethod: 'CASH', amount: '53.5000' },
        { paymentMethod: 'CARD', amount: '50.0000' },
      ],
    });

    expect(Number(createdOrder.subtotal)).toBeCloseTo(90, 2);
    expect(Number(createdOrder.discountTotal)).toBeCloseTo(10, 2);
    expect(Number(createdOrder.taxTotal)).toBeCloseTo(13.5, 2);
    expect(Number(createdOrder.grandTotal)).toBeCloseTo(103.5, 2);

    await dbService.withTenantContext(sysCtx, async (tx) => {
      const dbLines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, createdOrder.id));
      expect(dbLines).toHaveLength(1);
      expect(Number(dbLines[0].discountAmount)).toBeCloseTo(10, 2);

      const dbPayments = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, createdOrder.id));
      expect(dbPayments).toHaveLength(2);

      const cashPayment = dbPayments.find((p) => p.paymentMethod === 'CASH');
      const cardPayment = dbPayments.find((p) => p.paymentMethod === 'CARD');
      expect(Number(cashPayment?.amount)).toBeCloseTo(53.5, 2);
      expect(Number(cardPayment?.amount)).toBeCloseTo(50, 2);
    });
  });

  it('processes sales refund and guarantees idempotency without duplicating refund payments or GL journals', async () => {
    const order = await salesService.createSalesOrder(sysCtx, {
      legalEntityId,
      branchId,
      deviceId,
      warehouseId,
      orderNumber: `ORD-REF-${Date.now().toString(36).toUpperCase()}`,
      orderType: OrderType.TAKEAWAY,
      channel: OrderChannel.POS,
      idempotencyKey: `idem-sale-${randomUUID()}`,
      lines: [
        {
          itemId: burgerItemId,
          uomId: uomPcsId,
          quantity: '1.0000',
          unitPrice: '50.0000',
          discountAmount: '0.0000',
        },
      ],
      payments: [{ paymentMethod: 'CASH', amount: '57.5000' }],
    });

    const refundIdemKey = `idem-refund-${randomUUID()}`;

    const firstRefund = await salesService.refundSalesOrder(sysCtx, order.id, {
      reason: 'Customer returned order',
      approvedBy: adminUserId,
      paymentMethod: 'CASH',
      refundMethod: 'CASH',
      restockInventory: true,
      idempotencyKey: refundIdemKey,
    });
    expect(firstRefund.refundJournal).toBeTruthy();

    // Retry with identical idempotencyKey
    const secondRefund = await salesService.refundSalesOrder(sysCtx, order.id, {
      reason: 'Customer returned order',
      approvedBy: adminUserId,
      paymentMethod: 'CASH',
      refundMethod: 'CASH',
      restockInventory: true,
      idempotencyKey: refundIdemKey,
    });
    expect(secondRefund.refundJournal?.id).toBe(firstRefund.refundJournal?.id);

    await dbService.withTenantContext(sysCtx, async (tx) => {
      const [dbOrder] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, order.id));
      expect(dbOrder.status).toBe('REFUNDED');

      const refundPayments = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.status, 'REFUNDED')));
      expect(refundPayments).toHaveLength(1);
      expect(Number(refundPayments[0].amount)).toBeCloseTo(-57.5, 2);

      const refundJournals = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.sourceId, order.id),
            eq(journalEntries.sourceType, 'sales_refund')
          )
        );
      expect(refundJournals).toHaveLength(1);
    });

    // Reusing same idempotencyKey for a different order must throw ConflictException
    const otherOrder = await salesService.createSalesOrder(sysCtx, {
      legalEntityId,
      branchId,
      deviceId,
      warehouseId,
      orderNumber: `ORD-REF2-${Date.now().toString(36).toUpperCase()}`,
      orderType: OrderType.TAKEAWAY,
      channel: OrderChannel.POS,
      idempotencyKey: `idem-sale2-${randomUUID()}`,
      lines: [
        {
          itemId: burgerItemId,
          uomId: uomPcsId,
          quantity: '1.0000',
          unitPrice: '50.0000',
          discountAmount: '0.0000',
        },
      ],
      payments: [{ paymentMethod: 'CASH', amount: '57.5000' }],
    });

    await expect(
      salesService.refundSalesOrder(sysCtx, otherOrder.id, {
        reason: 'Duplicate key attempt',
        approvedBy: adminUserId,
        paymentMethod: 'CASH',
        refundMethod: 'CASH',
        restockInventory: true,
        idempotencyKey: refundIdemKey,
      })
    ).rejects.toThrow(ConflictException);
  });
});
