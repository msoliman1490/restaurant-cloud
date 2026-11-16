import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { DeliveryController } from '../src/modules/delivery/delivery.controller';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  tenants,
  legalEntities,
  branches,
  devices,
  salesOrders,
  chartOfAccounts,
  cashVaults,
  vaultTransactions,
  journalEntries,
  journalLines,
  fiscalYears,
  fiscalPeriods,
  deliveryZones,
  deliveryDrivers,
  deliveryOrders,
  deliveryDriverSettlements,
  auditLogs,
} from '@restaurant-cloud/database';
import { TenantContext, AccountType } from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Delivery, Drivers & COD Settlement Module', () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let postingEngine: PostingEngineService;
  let deliveryService: DeliveryService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leAId = randomUUID();
  const leBId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const deviceAId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  const vaultAccountId = randomUUID();
  const clearingAccountId = randomUUID();
  const varianceAccountId = randomUUID();
  const cashVaultId = randomUUID();
  const salesOrderId = randomUUID();

  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();
    auditService = new AuditService(dbService);
    postingEngine = new PostingEngineService(dbService, auditService);
    deliveryService = new DeliveryService(dbService, auditService, postingEngine);

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
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
      { id: tenantAId, code: `del-a-${suffix}`, displayName: 'Delivery Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `del-b-${suffix}`, displayName: 'Delivery Tenant B', status: 'ACTIVE' },
    ]);

    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leAId,
        tenantId: tenantAId,
        legalName: 'Delivery Entity A',
        vatNumber: '310444444444443',
      });
      await tx.insert(branches).values({
        id: branchAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        code: 'DEL-BR-A',
        name: 'Delivery Branch A',
      });
      await tx.insert(devices).values({
        id: deviceAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        deviceCode: 'POS-DEL-1',
        name: 'POS Delivery 1',
      });

      const fyId = randomUUID();
      const now = new Date();
      const startOfYear = new Date(now.getUTCFullYear(), 0, 1);
      const endOfYear = new Date(now.getUTCFullYear(), 11, 31, 23, 59, 59);
      await tx.insert(fiscalYears).values({
        id: fyId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        yearCode: String(now.getUTCFullYear()),
        yearName: String(now.getUTCFullYear()),
        startDate: startOfYear,
        endDate: endOfYear,
        status: 'OPEN',
      });
      await tx.insert(fiscalPeriods).values({
        tenantId: tenantAId,
        legalEntityId: leAId,
        fiscalYearId: fyId,
        periodNumber: now.getUTCMonth() + 1,
        periodName: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
        startDate: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
        endDate: new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
        status: 'OPEN',
      });

      await tx.insert(chartOfAccounts).values([
        {
          id: vaultAccountId,
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '1101',
          name: 'Main Cash Vault',
          nameAr: 'الخزينة الرئيسية',
          accountType: AccountType.ASSET,
          isPostable: true,
          status: 'ACTIVE',
        },
        {
          id: clearingAccountId,
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '1105',
          name: 'Driver COD Clearing',
          nameAr: 'عهدة تحصيل السائقين',
          accountType: AccountType.ASSET,
          isPostable: true,
          status: 'ACTIVE',
        },
        {
          id: varianceAccountId,
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '5199',
          name: 'Cash Variance',
          nameAr: 'فروقات الصندوق',
          accountType: AccountType.EXPENSE,
          isPostable: true,
          status: 'ACTIVE',
        },
      ]);

      await tx.insert(cashVaults).values({
        id: cashVaultId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        code: 'VAULT-DEL-A',
        nameAr: 'خزينة التوصيل',
        accountId: vaultAccountId,
        balance: '100.0000',
        status: 'ACTIVE',
      });

      await tx.insert(salesOrders).values({
        id: salesOrderId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        deviceId: deviceAId,
        orderNumber: `ORD-DEL-${suffix}`,
        orderType: 'DELIVERY',
        channel: 'POS',
        status: 'CONFIRMED',
        subtotal: '100.0000',
        taxTotal: '15.0000',
        grandTotal: '115.0000',
      });
    });

    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leBId,
        tenantId: tenantBId,
        legalName: 'Delivery Entity B',
        vatNumber: '310555555555553',
      });
      await tx.insert(branches).values({
        id: branchBId,
        tenantId: tenantBId,
        legalEntityId: leBId,
        code: 'DEL-BR-B',
        name: 'Delivery Branch B',
      });
    });
  });

  afterAll(async () => {
    try {
      await dbService.withTenantContext(ctxA, async (tx) => {
        await tx.delete(deliveryDriverSettlements).where(eq(deliveryDriverSettlements.tenantId, tenantAId));
        await tx.delete(deliveryOrders).where(eq(deliveryOrders.tenantId, tenantAId));
        await tx.delete(deliveryDrivers).where(eq(deliveryDrivers.tenantId, tenantAId));
        await tx.delete(deliveryZones).where(eq(deliveryZones.tenantId, tenantAId));
      });
    } catch {
      // Immutable ledger/audit triggers prevent deleting posted entries/tenants in Staging
    }
    await dbService.onModuleDestroy();
  });

  it('1. Creates delivery zone & driver, assigns order, and manages dispatch lifecycle', async () => {
    const zone = await deliveryService.createZone(ctxA, {
      legalEntityId: leAId,
      branchId: branchAId,
      code: 'ZN-01',
      nameAr: 'حي العليا',
      deliveryFee: 15,
      estimatedMinutes: 35,
    });
    expect(zone.code).toBe('ZN-01');

    const driver = await deliveryService.createDriver(ctxA, {
      legalEntityId: leAId,
      branchId: branchAId,
      driverCode: 'DRV-01',
      fullNameAr: 'خالد السائق',
      phone: '0501112233',
      vehicleType: 'MOTORBIKE',
    });
    expect(driver.availabilityStatus).toBe('AVAILABLE');

    const dOrder = await deliveryService.createDeliveryOrder(ctxA, {
      legalEntityId: leAId,
      branchId: branchAId,
      salesOrderId,
      zoneId: zone.id,
      channel: 'IN_HOUSE',
      customerName: 'عميل توصيل',
      customerPhone: '0559988776',
      deliveryAddress: 'الرياض - حي العليا',
      codAmount: 130,
    });
    expect(dOrder.status).toBe('PENDING_ASSIGNMENT');
    expect(Number(dOrder.deliveryFee)).toBe(15);

    const assigned = await deliveryService.assignDriver(ctxA, dOrder.id, driver.id);
    expect(assigned.status).toBe('ASSIGNED');

    const [driverAfterAssign] = await deliveryService.listDrivers(ctxA, { branchId: branchAId });
    expect(driverAfterAssign.availabilityStatus).toBe('ON_DELIVERY');

    await deliveryService.updateOrderStatus(ctxA, dOrder.id, { status: 'OUT_FOR_DELIVERY' });
    const delivered = await deliveryService.updateOrderStatus(ctxA, dOrder.id, { status: 'DELIVERED' });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.codCollected).toBe(true);

    const [driverAfterDelivery] = await deliveryService.listDrivers(ctxA, { branchId: branchAId });
    expect(driverAfterDelivery.availabilityStatus).toBe('AVAILABLE');
  }, 25000);

  it('2. Settles driver COD cash into Cash Vault with PostingEngine GL entry and idempotency', async () => {
    const [driver] = await deliveryService.listDrivers(ctxA, { branchId: branchAId });
    const idempKey = `cod-settle-${Date.now()}`;

    const settlement = await deliveryService.settleDriverCod(ctxA, {
      driverId: driver.id,
      cashVaultId,
      settledAmount: 130,
      clearingAccountId,
      varianceAccountId,
      idempotencyKey: idempKey,
    });

    expect(Number(settlement.expectedCodAmount)).toBe(130);
    expect(Number(settlement.settledAmount)).toBe(130);
    expect(Number(settlement.varianceAmount)).toBe(0);
    expect(settlement.journalEntryId).toBeTruthy();

    // Idempotent retry returns exact same settlement
    const retry = await deliveryService.settleDriverCod(ctxA, {
      driverId: driver.id,
      cashVaultId,
      settledAmount: 130,
      clearingAccountId,
      varianceAccountId,
      idempotencyKey: idempKey,
    });
    expect(retry.id).toBe(settlement.id);

    // Cash vault balance increased from 100 to 230
    await dbService.withTenantContext(ctxA, async (tx) => {
      const [vault] = await tx.select().from(cashVaults).where(eq(cashVaults.id, cashVaultId));
      expect(Number(vault.balance)).toBe(230);
    });
  }, 25000);

  it('3. Enforces Tenant & RLS isolation and RBAC permission decorators', async () => {
    const tenantBDrivers = await deliveryService.listDrivers(ctxB, {});
    expect(tenantBDrivers.length).toBe(0);

    const tenantBOrders = await deliveryService.listDeliveryOrders(ctxB, {});
    expect(tenantBOrders.length).toBe(0);

    const settlePerms = Reflect.getMetadata(PERMISSIONS_KEY, DeliveryController.prototype.settleDriverCod);
    expect(settlePerms).toContain('delivery.settle');
    const dispatchPerms = Reflect.getMetadata(PERMISSIONS_KEY, DeliveryController.prototype.assignDriver);
    expect(dispatchPerms).toContain('delivery.dispatch');
  });
});
