import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { ConflictException } from '@nestjs/common';
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
import { OfflinePosService } from '../src/modules/sales/offline-pos.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderType,
  OrderChannel,
  PaymentMethod,
} from '@restaurant-cloud/domain-kernel';
import {
  salesOrders,
  inventoryBalances,
  cashVaults,
  journalEntries,
  items,
  unitsOfMeasure,
  warehouses,
  offlineQuotaLeases,
  accountMappings,
} from '@restaurant-cloud/database';

describe(
  'Restaurant Cloud — Offline POS Quota Leases & Idempotent Sync (Staging DB)',
  { timeout: 90000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let financialResourcesService: FinancialResourcesService;
    let opsFramework: OperationsFrameworkService;
    let productionService: ProductionService;
    let salesService: SalesService;
    let offlinePosService: OfflinePosService;

    let tenantId: string;
    let adminUserId: string;
    let legalEntityId: string;
    let branchId: string;
    let warehouseId: string;
    let device1Id: string;
    let device2Id: string;
    let vaultId: string;
    let uomPcsId: string;
    let item1Id: string;
    let item2Id: string;

    let sysCtx: TenantContext;
    const tenantCode = `off-${Date.now().toString(36).slice(-6)}`;
    const device1Epoch = randomUUID();
    const device2Epoch = randomUUID();

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
      opsFramework = new OperationsFrameworkService(dbService, auditService);
      accountingService = new AccountingService(
        dbService,
        auditService,
        postingEngine,
        opsFramework,
      );
      financialResourcesService = new FinancialResourcesService(
        dbService,
        auditService,
        opsFramework,
      );
      productionService = new ProductionService(dbService, auditService);
      salesService = new SalesService(
        dbService,
        auditService,
        productionService,
        accountingService,
        postingEngine,
        opsFramework,
      );
      offlinePosService = new OfflinePosService(
        dbService,
        auditService,
        opsFramework,
        salesService,
      );

      // 1. Onboard Tenant
      const tenantResult = await tenantService.onboardTenant({
        code: tenantCode,
        displayName: `Offline POS Test ${tenantCode}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة اختبار نقاط البيع دون اتصال ذ.م.م',
          commercialName: 'Offline POS Test LLC',
          vatNumber: '310999888700003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-OFF-01',
          name: 'فرع الاختبار الرئيسي',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin-${tenantCode}@restaurant-cloud.test`,
          displayName: 'مدير اختبار الأوفلاين',
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

      // 2. Fiscal Period & COA Accounts
      const currentYear = new Date().getFullYear();
      await accountingService.createFiscalPeriod(sysCtx, {
        legalEntityId,
        periodName: `FY-${currentYear}`,
        startDate: `${currentYear}-01-01T00:00:00.000Z`,
        endDate: `${currentYear}-12-31T23:59:59.000Z`,
      });

      const salesAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '411000',
        name: 'إيراد المبيعات',
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
        name: 'تكلفة المبيعات',
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
        name: 'الصندوق',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const madaAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '111300',
        name: 'وسيط مدى',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      // Configure default account mappings for PostingEngine
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const mappingsToInsert = [
          { mappingKey: DefaultAccountMappingKey.SALES, accountId: salesAcc.id },
          { mappingKey: DefaultAccountMappingKey.VAT_OUTPUT, accountId: vatAcc.id },
          { mappingKey: DefaultAccountMappingKey.COGS, accountId: cogsAcc.id },
          { mappingKey: DefaultAccountMappingKey.INVENTORY, accountId: invAcc.id },
          { mappingKey: DefaultAccountMappingKey.CASH_VAULT, accountId: vaultAcc.id },
          { mappingKey: DefaultAccountMappingKey.MADA_CLEARING, accountId: madaAcc.id },
          { mappingKey: DefaultAccountMappingKey.CARD_CLEARING, accountId: madaAcc.id },
        ];
        for (const m of mappingsToInsert) {
          await tx.insert(accountMappings).values({
            tenantId,
            legalEntityId,
            mappingKey: m.mappingKey,
            accountId: m.accountId,
          });
        }
      });

      // 3. Cash Vault & 2 POS Devices
      const vault = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId,
        branchId,
        code: `VLT-OFF-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة الأوفلاين',
        accountId: vaultAcc.id,
      });
      vaultId = vault.id;

      const d1 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId,
        branchId,
        deviceCode: `POS-OFF-1-${Date.now().toString().slice(-4)}`,
        name: 'جهاز كاشير 1',
        deviceType: 'POS',
        cashVaultId: vaultId,
      });
      device1Id = d1.id;

      const d2 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId,
        branchId,
        deviceCode: `POS-OFF-2-${Date.now().toString().slice(-4)}`,
        name: 'جهاز كاشير 2',
        deviceType: 'POS',
        cashVaultId: vaultId,
      });
      device2Id = d2.id;

      // 4. Warehouse, UOM, Items, Initial Stock Balances
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId,
            branchId,
            code: `WH-OFF-${Date.now().toString().slice(-4)}`,
            name: 'مستودع الفرع',
            type: 'STORAGE',
          })
          .returning();
        warehouseId = wh.id;

        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({
            tenantId,
            code: `PCS-${Date.now().toString().slice(-4)}`,
            nameAr: 'قطعة',
            nameEn: 'Piece',
            isBaseUnit: true,
          })
          .returning();
        uomPcsId = uom.id;

        const [it1] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntityId,
            sku: `SKU-OFF-1-${Date.now().toString().slice(-4)}`,
            nameAr: 'عصير برتقال طازج',
            nameEn: 'Fresh Orange Juice',
            itemType: 'RETAIL_GOOD',
            baseUomId: uomPcsId,
            defaultPrice: '20.0000',
            defaultCost: '5.0000',
            isSold: true,
            isActive: true,
          })
          .returning();
        item1Id = it1.id;

        const [it2] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntityId,
            sku: `SKU-OFF-2-${Date.now().toString().slice(-4)}`,
            nameAr: 'كرواسون زبدة',
            nameEn: 'Butter Croissant',
            itemType: 'RETAIL_GOOD',
            baseUomId: uomPcsId,
            defaultPrice: '15.0000',
            defaultCost: '4.0000',
            isSold: true,
            isActive: true,
          })
          .returning();
        item2Id = it2.id;

        await tx.insert(inventoryBalances).values([
          {
            tenantId,
            legalEntityOwnerId: legalEntityId,
            warehouseId,
            itemId: item1Id,
            onHandQty: '20.0000',
            reservedQty: '0.0000',
            wacCost: '5.0000',
          },
          {
            tenantId,
            legalEntityOwnerId: legalEntityId,
            warehouseId,
            itemId: item2Id,
            onHandQty: '10.0000',
            reservedQty: '0.0000',
            wacCost: '4.0000',
          },
        ]);
      });
    }, 60000);

    afterAll(async () => {
      if (dbService) {
        await dbService.onModuleDestroy();
      }
    });

    it('1. should allocate signed offline quota leases with unlimited duration and list active leases', async () => {
      const leases = await offlinePosService.allocateOrRenewLeases(sysCtx, {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        items: [{ itemId: item1Id, requestedQty: 10 }],
      });

      expect(leases).toHaveLength(1);
      expect(leases[0].status).toBe('ACTIVE');
      expect(parseFloat(leases[0].allocatedQty)).toBe(10);
      expect(leases[0].signature).toMatch(/^[a-f0-9]{64}$/);
      // Unlimited offline duration: validUntil far in the future
      expect(leases[0].validUntil.getFullYear()).toBeGreaterThan(
        new Date().getFullYear() + 50,
      );

      // Explicit validUntil renewal
      const customValidUntil = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const renewed = await offlinePosService.allocateOrRenewLeases(sysCtx, {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        validUntil: customValidUntil,
        items: [{ itemId: item1Id, requestedQty: 12 }],
      });

      expect(parseFloat(renewed[0].allocatedQty)).toBe(12);

      const listed = await offlinePosService.listLeases(sysCtx, {
        deviceId: device1Id,
        branchId,
      });
      expect(listed.some((l) => l.itemId === item1Id && l.status === 'ACTIVE')).toBe(
        true,
      );
    });

    it('2. should sync queued offline order upon reconnection and post atomic GL + inventory deduction', async () => {
      const txId1 = randomUUID();
      const orderNum = `OFF-ORD-${Date.now().toString().slice(-5)}-1`;

      const res = await offlinePosService.syncOfflineBatch(sysCtx, {
        orders: [
          {
            clientTransactionId: txId1,
            idempotencyKey: txId1,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 1,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: orderNum,
            orderType: OrderType.TAKEAWAY,
            channel: OrderChannel.POS,
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item1Id,
                uomId: uomPcsId,
                quantity: '3.0000',
                unitPrice: '20.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [
              {
                paymentMethod: PaymentMethod.CASH,
                amount: '69.0000',
              },
            ],
          },
        ],
      });

      expect(res.summary.synced).toBe(1);
      expect(res.results[0].status).toBe('SYNCED');
      expect(res.results[0].orderId).toBeDefined();

      // Verify inventory deducted (20 - 3 = 17) and GL journal posted
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.warehouseId, warehouseId),
              eq(inventoryBalances.itemId, item1Id),
            ),
          )
          .limit(1);
        expect(parseFloat(bal.onHandQty)).toBeCloseTo(17, 4);

        const journals = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceId, res.results[0].orderId!),
            ),
          );
        expect(journals.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('3. should be strictly idempotent on repeated sync of the same idempotencyKey (ALREADY_SYNCED)', async () => {
      const txId = randomUUID();
      const orderNum = `OFF-IDEM-${Date.now().toString().slice(-5)}`;

      const payload = {
        orders: [
          {
            clientTransactionId: txId,
            idempotencyKey: txId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 2,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: orderNum,
            orderType: OrderType.TAKEAWAY,
            channel: OrderChannel.POS,
            invoiceType: 'SIMPLIFIED' as const,
            lines: [
              {
                itemId: item1Id,
                uomId: uomPcsId,
                quantity: '2.0000',
                unitPrice: '20.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: PaymentMethod.MADA, amount: '46.0000' }],
          },
        ],
      };

      const first = await offlinePosService.syncOfflineBatch(sysCtx, payload);
      expect(first.results[0].status).toBe('SYNCED');

      const second = await offlinePosService.syncOfflineBatch(sysCtx, payload);
      expect(second.summary.alreadySynced).toBe(1);
      expect(second.results[0].status).toBe('ALREADY_SYNCED');
      expect(second.results[0].orderId).toBe(first.results[0].orderId);

      // Ensure no duplicate orders exist
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const orders = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, tenantId),
              eq(salesOrders.idempotencyKey, txId),
            ),
          );
        expect(orders).toHaveLength(1);
      });
    });

    it('4. should survive app/service restart and enforce seq conflict prevention', async () => {
      // Simulate service restart with a fresh OfflinePosService instance
      const restartedService = new OfflinePosService(
        dbService,
        auditService,
        opsFramework,
        salesService,
      );

      // Reusing seq=2 with a DIFFERENT clientTransactionId must be rejected as SEQ_CONFLICT
      const conflictTxId = randomUUID();
      const conflictRes = await restartedService.syncOfflineBatch(sysCtx, {
        orders: [
          {
            clientTransactionId: conflictTxId,
            idempotencyKey: conflictTxId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 2,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `OFF-SEQ-CONF-${Date.now().toString().slice(-4)}`,
            orderType: OrderType.TAKEAWAY,
            channel: OrderChannel.POS,
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item1Id,
                uomId: uomPcsId,
                quantity: '1.0000',
                unitPrice: '20.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: PaymentMethod.CASH, amount: '23.0000' }],
          },
        ],
      });

      expect(conflictRes.summary.conflict).toBe(1);
      expect(conflictRes.results[0].status).toBe('CONFLICT');
      expect(conflictRes.results[0].reasonCode).toBe('SEQ_CONFLICT');

      // Next valid seq=3 succeeds after restart
      const validTxId = randomUUID();
      const okRes = await restartedService.syncOfflineBatch(sysCtx, {
        orders: [
          {
            clientTransactionId: validTxId,
            idempotencyKey: validTxId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 3,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `OFF-RST-${Date.now().toString().slice(-4)}`,
            orderType: OrderType.TAKEAWAY,
            channel: OrderChannel.POS,
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item1Id,
                uomId: uomPcsId,
                quantity: '1.0000',
                unitPrice: '20.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: PaymentMethod.CASH, amount: '23.0000' }],
          },
        ],
      });

      expect(okRes.summary.synced).toBe(1);
      expect(okRes.results[0].status).toBe('SYNCED');
    });

    it('5. should enforce shared local stock across concurrent devices without over-allocation', async () => {
      // item2Id has 10.0000 on hand. Two devices concurrently ask for 6 each (total 12 > 10).
      const results = await Promise.allSettled([
        offlinePosService.allocateOrRenewLeases(sysCtx, {
          legalEntityId,
          branchId,
          warehouseId,
          deviceId: device1Id,
          deviceEpoch: device1Epoch,
          items: [{ itemId: item2Id, requestedQty: 6 }],
        }),
        offlinePosService.allocateOrRenewLeases(sysCtx, {
          legalEntityId,
          branchId,
          warehouseId,
          deviceId: device2Id,
          deviceEpoch: device2Epoch,
          items: [{ itemId: item2Id, requestedQty: 6 }],
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
    });

    it('6. should PREVENT conflict on insufficient server stock without overwriting balances or creating invoices', async () => {
      // Allocate lease for item2Id on device2 (or use whichever device got the 6 lease; let's allocate 4 for device2 if needed)
      const activeLeases = await offlinePosService.listLeases(sysCtx, {
        warehouseId,
        status: 'ACTIVE',
      });
      const item2Lease = activeLeases.find((l) => l.itemId === item2Id)!;
      expect(item2Lease).toBeDefined();

      // Simulate another channel depleting item2Id server stock to 1.0000
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(inventoryBalances)
          .set({ onHandQty: '1.0000' })
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.warehouseId, warehouseId),
              eq(inventoryBalances.itemId, item2Id),
            ),
          );
      });

      const txId = randomUUID();
      const res = await offlinePosService.syncOfflineBatch(sysCtx, {
        orders: [
          {
            clientTransactionId: txId,
            idempotencyKey: txId,
            deviceId: item2Lease.deviceId,
            deviceEpoch: item2Lease.deviceEpoch,
            seq: item2Lease.lastReceivedSeq + 1,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `OFF-INSUFF-${Date.now().toString().slice(-4)}`,
            orderType: OrderType.TAKEAWAY,
            channel: OrderChannel.POS,
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item2Id,
                uomId: uomPcsId,
                quantity: '5.0000',
                unitPrice: '15.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: PaymentMethod.CASH, amount: '86.2500' }],
          },
        ],
      });

      expect(res.summary.conflict).toBe(1);
      expect(res.results[0].status).toBe('CONFLICT');
      expect(res.results[0].reasonCode).toBe('INSUFFICIENT_STOCK');

      // Verify stock balance was NOT overwritten and NO sales order was created
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.warehouseId, warehouseId),
              eq(inventoryBalances.itemId, item2Id),
            ),
          )
          .limit(1);
        expect(parseFloat(bal.onHandQty)).toBeCloseTo(1, 4);

        const orders = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, tenantId),
              eq(salesOrders.idempotencyKey, txId),
            ),
          );
        expect(orders).toHaveLength(0);
      });
    });
  },
);
