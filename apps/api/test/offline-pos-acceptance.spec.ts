import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import {
  salesOrders,
  payments,
  inventoryBalances,
  inventoryMovements,
  journalEntries,
  items,
  unitsOfMeasure,
  warehouses,
  offlineQuotaLeases,
  accountMappings,
} from '@restaurant-cloud/database';
import {
  getOrCreateDeviceEpoch,
  saveLocalLeases,
  getRemainingLocalQuota,
  enqueueOfflineOrder,
  listQueuedOrders,
  updateQueuedOrder,
  recoverInterruptedSyncs,
  syncOfflineQueue,
  type LocalQuotaLease,
} from '../../web/src/utils/offlinePosQueue';

const API_BASE = 'http://127.0.0.1:4000';

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe(
  'Restaurant Cloud — Offline POS Final Acceptance (HTTP http://127.0.0.1:4000 + Staging DB + Frontend Queue)',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let financialResourcesService: FinancialResourcesService;
    let opsFramework: OperationsFrameworkService;

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
    let accessToken: string;
    let sysCtx: TenantContext;

    const tenantCode = `acc-${Date.now().toString(36).slice(-6)}`;
    const adminEmail = `admin-${tenantCode}@restaurant-cloud.test`;
    const adminPassword = 'Password123!Secure';
    const device1Epoch = randomUUID();
    const device2Epoch = randomUUID();

    async function apiPost(endpoint: string, body: unknown) {
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      return { status: resp.status, ok: resp.ok, body: json };
    }

    async function apiGet(endpoint: string) {
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'GET',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const json = await resp.json().catch(() => ({}));
      return { status: resp.status, ok: resp.ok, body: json };
    }

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

      const tenantResult = await tenantService.onboardTenant({
        code: tenantCode,
        displayName: `Offline Acceptance ${tenantCode}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة اختبار القبول للأوفلاين ذ.م.م',
          commercialName: 'Offline Acceptance LLC',
          vatNumber: '310999777600003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-ACC-01',
          name: 'فرع القبول الرئيسي',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: adminEmail,
          displayName: 'مدير القبول',
          password: adminPassword,
        },
      });

      tenantId = tenantResult.tenant.id;
      adminUserId = tenantResult.user.id;
      legalEntityId = tenantResult.legalEntity.id;
      branchId = tenantResult.branch.id;

      sysCtx = {
        tenantId,
        userId: adminUserId,
        email: adminEmail,
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

      await dbService.withTenantContext(sysCtx, async (tx) => {
        for (const m of [
          { mappingKey: DefaultAccountMappingKey.SALES, accountId: salesAcc.id },
          { mappingKey: DefaultAccountMappingKey.VAT_OUTPUT, accountId: vatAcc.id },
          { mappingKey: DefaultAccountMappingKey.COGS, accountId: cogsAcc.id },
          { mappingKey: DefaultAccountMappingKey.INVENTORY, accountId: invAcc.id },
          { mappingKey: DefaultAccountMappingKey.CASH_VAULT, accountId: vaultAcc.id },
          { mappingKey: DefaultAccountMappingKey.MADA_CLEARING, accountId: madaAcc.id },
          { mappingKey: DefaultAccountMappingKey.CARD_CLEARING, accountId: madaAcc.id },
        ]) {
          await tx.insert(accountMappings).values({
            tenantId,
            legalEntityId,
            mappingKey: m.mappingKey,
            accountId: m.accountId,
          });
        }
      });

      const vault = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId,
        branchId,
        code: `VLT-ACC-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة القبول',
        accountId: vaultAcc.id,
      });
      vaultId = vault.id;

      const d1 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId,
        branchId,
        deviceCode: `POS-ACC-1-${Date.now().toString().slice(-4)}`,
        name: 'كاشير القبول 1',
        deviceType: 'POS',
        cashVaultId: vaultId,
      });
      device1Id = d1.id;

      const d2 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId,
        branchId,
        deviceCode: `POS-ACC-2-${Date.now().toString().slice(-4)}`,
        name: 'كاشير القبول 2',
        deviceType: 'POS',
        cashVaultId: vaultId,
      });
      device2Id = d2.id;

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId,
            branchId,
            code: `WH-ACC-${Date.now().toString().slice(-4)}`,
            name: 'مستودع القبول',
            type: 'STORAGE',
          })
          .returning();
        warehouseId = wh.id;

        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({
            tenantId,
            code: `PCS-ACC-${Date.now().toString().slice(-4)}`,
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
            sku: `SKU-ACC-1-${Date.now().toString().slice(-4)}`,
            nameAr: 'برجر دجاج مقرمش',
            nameEn: 'Crispy Chicken Burger',
            itemType: 'RETAIL_GOOD',
            baseUomId: uomPcsId,
            defaultPrice: '20.0000',
            defaultCost: '6.0000',
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
            sku: `SKU-ACC-2-${Date.now().toString().slice(-4)}`,
            nameAr: 'بطاطس مقلية',
            nameEn: 'French Fries',
            itemType: 'RETAIL_GOOD',
            baseUomId: uomPcsId,
            defaultPrice: '10.0000',
            defaultCost: '3.0000',
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
            averageCost: '6.0000',
          },
          {
            tenantId,
            legalEntityOwnerId: legalEntityId,
            warehouseId,
            itemId: item2Id,
            onHandQty: '10.0000',
            reservedQty: '0.0000',
            averageCost: '3.0000',
          },
        ]);
      });

      // Authenticate against live Staging API (http://127.0.0.1:4000)
      const loginResp = await apiPost('/api/v1/auth/login', {
        email: adminEmail,
        password: adminPassword,
      });
      expect(loginResp.status).toBe(201);
      accessToken = loginResp.body?.data?.token || loginResp.body?.data?.accessToken;
      expect(accessToken).toBeTruthy();
    }, 90000);

    afterAll(async () => {
      if (dbService) {
        await dbService.onModuleDestroy();
      }
    });

    it('1. Frontend offlinePosQueue: disconnect during sale, persist in storage, survive SYNCING restart, and sync on reconnect', async () => {
      (globalThis as any).localStorage = createStorageMock();
      const origNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });
      try {

      const epoch = await getOrCreateDeviceEpoch(device1Id);
      const lease: LocalQuotaLease = {
        id: randomUUID(),
        warehouseId,
        itemId: item1Id,
        deviceId: device1Id,
        deviceEpoch: epoch,
        allocatedQty: 10,
        consumedQty: 0,
        lastReceivedSeq: 0,
        validUntil: new Date(Date.now() + 86400_000).toISOString(),
        signature: 'local-sig',
        status: 'ACTIVE',
      };
      await saveLocalLeases([lease]);
      expect(await getRemainingLocalQuota(device1Id, warehouseId, item1Id)).toBe(10);

      const queued = await enqueueOfflineOrder({
        deviceId: device1Id,
        legalEntityId,
        branchId,
        warehouseId,
        orderNumber: `FE-OFF-${Date.now().toString().slice(-4)}`,
        orderType: 'TAKEAWAY',
        channel: 'POS',
        invoiceType: 'SIMPLIFIED',
        lines: [{ itemId: item1Id, uomId: uomPcsId, quantity: '2.0000', unitPrice: '20.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '46.0000' }],
        grandTotalEstimate: '46.0000',
      });
      expect(queued.status).toBe('PENDING');
      expect(await getRemainingLocalQuota(device1Id, warehouseId, item1Id)).toBe(8);

      // Simulate crash while SYNCING
      await updateQueuedOrder(queued.clientTransactionId, { status: 'SYNCING' });
      const recovered = await recoverInterruptedSyncs();
      expect(recovered).toBe(1);

      const listAfterRestart = await listQueuedOrders();
      expect(listAfterRestart).toHaveLength(1);
      expect(listAfterRestart[0].status).toBe('PENDING');

      // Reconnect & sync
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        configurable: true,
      });
      const syncOut = await syncOfflineQueue(async ({ orders }) => ({
        summary: { total: 1, synced: 1, alreadySynced: 0, conflict: 0, failed: 0 },
        results: [
          {
            clientTransactionId: orders[0].clientTransactionId,
            idempotencyKey: orders[0].idempotencyKey,
            seq: orders[0].seq,
            status: 'SYNCED',
            orderId: randomUUID(),
            orderNumber: orders[0].orderNumber,
            grandTotal: '46.0000',
          },
        ],
      }));
      expect(syncOut?.summary.synced).toBe(1);
      const finalOrders = await listQueuedOrders();
      expect(finalOrders[0].status).toBe('SYNCED');
      } finally {
        if (origNavigatorDesc) {
          Object.defineProperty(globalThis, 'navigator', origNavigatorDesc);
        }
      }
    });

    it('2. HTTP POST /api/v1/sales/offline/sync + idempotencyKey repeat -> ALREADY_SYNCED with ZERO duplicate invoice/payment/movement/GL', async () => {
      // Allocate lease via HTTP
      const allocResp = await apiPost('/api/v1/sales/offline/leases', {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        items: [{ itemId: item1Id, requestedQty: 5 }],
      });
      expect(allocResp.ok).toBe(true);
      expect(allocResp.body?.data).toHaveLength(1);

      const listResp = await apiGet(`/api/v1/sales/offline/leases?deviceId=${device1Id}&warehouseId=${warehouseId}`);
      expect(listResp.ok).toBe(true);
      expect(listResp.body?.data?.length).toBeGreaterThanOrEqual(1);

      const clientTxId = randomUUID();
      const payload = {
        orders: [
          {
            clientTransactionId: clientTxId,
            idempotencyKey: clientTxId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 1,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `HTTP-OFF-${Date.now().toString().slice(-4)}`,
            orderType: 'TAKEAWAY',
            channel: 'POS',
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item1Id,
                uomId: uomPcsId,
                quantity: '2.0000',
                unitPrice: '20.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: 'CASH', amount: '46.0000' }],
          },
        ],
      };

      const firstSync = await apiPost('/api/v1/sales/offline/sync', payload);
      expect(firstSync.ok).toBe(true);
      expect(firstSync.body?.data?.summary?.synced).toBe(1);
      const orderId = firstSync.body?.data?.results?.[0]?.orderId;
      expect(orderId).toBeTruthy();

      // Repeat EXACT same HTTP request
      const secondSync = await apiPost('/api/v1/sales/offline/sync', payload);
      expect(secondSync.ok).toBe(true);
      expect(secondSync.body?.data?.summary?.alreadySynced).toBe(1);
      expect(secondSync.body?.data?.results?.[0]?.status).toBe('ALREADY_SYNCED');
      expect(secondSync.body?.data?.results?.[0]?.orderId).toBe(orderId);

      // Verify ZERO duplicates in Staging DB
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const ordRows = await tx
          .select()
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.idempotencyKey, clientTxId)));
        expect(ordRows).toHaveLength(1);

        const pmtRows = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId)));
        expect(pmtRows).toHaveLength(1);

        const movRows = await tx
          .select()
          .from(inventoryMovements)
          .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.sourceId, orderId)));
        expect(movRows).toHaveLength(1);

        const glRows = await tx
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, orderId)));
        expect(glRows).toHaveLength(1);
      });
    });

    it('3. Concurrent two-device shared local stock allocation via HTTP Promise.all without over-allocation', async () => {
      // item2 has 10 onHandQty. Device 1 & Device 2 concurrently request 6 each (total 12 > 10).
      const [r1, r2] = await Promise.all([
        apiPost('/api/v1/sales/offline/leases', {
          legalEntityId,
          branchId,
          warehouseId,
          deviceId: device1Id,
          deviceEpoch: device1Epoch,
          items: [{ itemId: item2Id, requestedQty: 6 }],
        }),
        apiPost('/api/v1/sales/offline/leases', {
          legalEntityId,
          branchId,
          warehouseId,
          deviceId: device2Id,
          deviceEpoch: device2Epoch,
          items: [{ itemId: item2Id, requestedQty: 6 }],
        }),
      ]);

      const successes = [r1, r2].filter((r) => r.ok);
      const conflicts = [r1, r2].filter((r) => r.status === 409);
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);

      // Second device can still allocate remaining 4
      const loserDeviceId = r1.ok ? device2Id : device1Id;
      const loserEpoch = r1.ok ? device2Epoch : device1Epoch;
      const r3 = await apiPost('/api/v1/sales/offline/leases', {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: loserDeviceId,
        deviceEpoch: loserEpoch,
        items: [{ itemId: item2Id, requestedQty: 4 }],
      });
      expect(r3.ok).toBe(true);
    });

    it('4. Expired quota lease: reject past validUntil, return LEASE_EXPIRED on sync, renew lease, and sync succeeds', async () => {
      const pastResp = await apiPost('/api/v1/sales/offline/leases', {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        validUntil: new Date(Date.now() - 60_000).toISOString(),
        items: [{ itemId: item1Id, requestedQty: 5 }],
      });
      expect(pastResp.status).toBe(400);

      // Allocate a legitimately signed short-lived lease (2.5s) and let it naturally expire
      const shortResp = await apiPost('/api/v1/sales/offline/leases', {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        validUntil: new Date(Date.now() + 2500).toISOString(),
        items: [{ itemId: item1Id, requestedQty: 5 }],
      });
      expect(shortResp.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 3200));

      const expiredTxId = randomUUID();
      const expiredSyncPayload = {
        orders: [
          {
            clientTransactionId: expiredTxId,
            idempotencyKey: expiredTxId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 2,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `HTTP-EXP-${Date.now().toString().slice(-4)}`,
            orderType: 'TAKEAWAY',
            channel: 'POS',
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
            payments: [{ paymentMethod: 'CASH', amount: '23.0000' }],
          },
        ],
      };

      const expiredSyncResp = await apiPost('/api/v1/sales/offline/sync', expiredSyncPayload);
      expect(expiredSyncResp.ok).toBe(true);
      expect(expiredSyncResp.body?.data?.summary?.conflict).toBe(1);
      expect(expiredSyncResp.body?.data?.results?.[0]?.status).toBe('CONFLICT');
      expect(expiredSyncResp.body?.data?.results?.[0]?.reasonCode).toBe('LEASE_EXPIRED');

      // Renew lease via HTTP
      const renewResp = await apiPost('/api/v1/sales/offline/leases', {
        legalEntityId,
        branchId,
        warehouseId,
        deviceId: device1Id,
        deviceEpoch: device1Epoch,
        validUntil: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ itemId: item1Id, requestedQty: 5 }],
      });
      expect(renewResp.ok).toBe(true);

      // Retry sync -> succeeds
      const retryResp = await apiPost('/api/v1/sales/offline/sync', expiredSyncPayload);
      expect(retryResp.ok).toBe(true);
      expect(retryResp.body?.data?.summary?.synced).toBe(1);
      expect(retryResp.body?.data?.results?.[0]?.status).toBe('SYNCED');
    });

    it('5. Sync failure (INSUFFICIENT_STOCK PREVENT) + stock replenishment + retry recovery', async () => {
      // Drop item2 server stock to 1 while device1/device2 holds lease >= 4
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

      const failTxId = randomUUID();
      const failPayload = {
        orders: [
          {
            clientTransactionId: failTxId,
            idempotencyKey: failTxId,
            deviceId: device1Id,
            deviceEpoch: device1Epoch,
            seq: 3,
            legalEntityId,
            branchId,
            warehouseId,
            orderNumber: `HTTP-REC-${Date.now().toString().slice(-4)}`,
            orderType: 'TAKEAWAY',
            channel: 'POS',
            invoiceType: 'SIMPLIFIED',
            lines: [
              {
                itemId: item2Id,
                uomId: uomPcsId,
                quantity: '3.0000',
                unitPrice: '10.0000',
                discountAmount: '0.0000',
              },
            ],
            payments: [{ paymentMethod: 'CASH', amount: '34.5000' }],
          },
        ],
      };

      // Note: ensure device1 has a lease for item2 (allocate if device2 won 6 and device1 got 4, either way device1 has >=4)
      const failResp = await apiPost('/api/v1/sales/offline/sync', failPayload);
      expect(failResp.ok).toBe(true);
      expect(failResp.body?.data?.summary?.conflict).toBe(1);
      expect(failResp.body?.data?.results?.[0]?.status).toBe('CONFLICT');
      expect(failResp.body?.data?.results?.[0]?.reasonCode).toBe('INSUFFICIENT_STOCK');

      // Replenish server stock to 10
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(inventoryBalances)
          .set({ onHandQty: '10.0000' })
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.warehouseId, warehouseId),
              eq(inventoryBalances.itemId, item2Id),
            ),
          );
      });

      // Retry exact same payload -> recovers and syncs
      const recoverResp = await apiPost('/api/v1/sales/offline/sync', failPayload);
      expect(recoverResp.ok).toBe(true);
      expect(recoverResp.body?.data?.summary?.synced).toBe(1);
      expect(recoverResp.body?.data?.results?.[0]?.status).toBe('SYNCED');
    });
  },
);
