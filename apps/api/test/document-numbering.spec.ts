import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import {
  createDatabaseClient,
  DatabaseInstance,
  tenants,
  users,
  userMemberships,
  membershipScopes,
  roles,
  rolePermissions,
  groups,
  legalEntities,
  branches,
  warehouses,
  devices,
  posShifts,
  salesOrders,
  orderLines,
  payments,
  journalEntries,
  journalLines,
  idempotencyKeys,
  documentSequences,
  documentNumberAllocations,
  fiscalPeriods,
  tenantSubscriptions,
  tenantIndustryPacks,
  pdplConsents,
  onboardingProgress,
  auditLogs,
  items,
  categories,
  unitsOfMeasure,
  chartOfAccounts,
  accountMappings,
} from '@restaurant-cloud/database';
import type postgres from 'postgres';

const API_BASE = 'http://127.0.0.1:4000/api/v1';

function loadDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL not found');
}

describe('Phase 2: Customer-Specific Document Numbering & 20x Concurrency (Staging DB)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;
  let withTenantContext: ReturnType<typeof createDatabaseClient>['withTenantContext'];

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let token1 = '';
  let token2 = '';
  let t1Id = '';
  let t1UserId = '';
  let t1Entity1Id = '';
  let t1Entity2Id = '';
  let t1Branch1Id = '';
  let t1Branch2Id = '';
  let t1WarehouseId = '';
  let t1DeviceId = '';
  let t1ShiftId = '';
  let t1ItemId = '';
  let t1UomId = '';
  let t1PeriodId = '';
  let t2EntityId = '';

  async function apiCall(
    endpoint: string,
    options: { method?: string; token?: string; headers?: Record<string, string>; body?: unknown } = {}
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, body: json };
  }

  beforeAll(async () => {
    const client = createDatabaseClient({ connectionString: loadDbUrl(), maxConnections: 5 });
    db = client.db;
    sqlClient = client.sqlClient;
    withTenantContext = client.withTenantContext;

    const t1 = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Num Tenant 1 ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `Num Legal 1 ${uniqueSuffix}`, vatNumber: '310111222300003' },
        initialAdminUser: { email: `num1.${uniqueSuffix}@example.sa`, displayName: 'Num Admin 1', password: 'NumPassword2026!' },
      },
    });
    expect(t1.status).toBe(201);
    token1 = t1.body.data.token;
    t1Id = t1.body.data.tenant.id;
    t1UserId = t1.body.data.user.id;
    t1Entity1Id = t1.body.data.legalEntity.id;
    t1Branch1Id = t1.body.data.branch.id;
    t1WarehouseId = t1.body.data.warehouse.id;
    createdTenantIds.push(t1Id);
    createdUserIds.push(t1UserId);

    const t2 = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Num Tenant 2 ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `Num Legal 2 ${uniqueSuffix}`, vatNumber: '310333444500003' },
        initialAdminUser: { email: `num2.${uniqueSuffix}@example.sa`, displayName: 'Num Admin 2', password: 'NumPassword2026!' },
      },
    });
    expect(t2.status).toBe(201);
    token2 = t2.body.data.token;
    t2EntityId = t2.body.data.legalEntity.id;
    createdTenantIds.push(t2.body.data.tenant.id);
    createdUserIds.push(t2.body.data.user.id);

    await withTenantContext({ tenantId: t1Id, userId: t1UserId, scopes: ['*'] } as any, async (tx) => {
      const [grp] = await tx.select().from(groups).where(eq(groups.tenantId, t1Id)).limit(1);
      const [ent2] = await tx.insert(legalEntities).values({
        tenantId: t1Id, groupId: grp!.id, legalName: `Num Legal 1B ${uniqueSuffix}`, vatNumber: '310999888700003',
      }).returning();
      t1Entity2Id = ent2!.id;

      const [br2] = await tx.insert(branches).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, code: 'BR-02', name: 'الفرع الثاني',
      }).returning();
      t1Branch2Id = br2!.id;

      const [fp] = await tx.insert(fiscalPeriods).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, periodName: `FY-${new Date().getFullYear()}`, startDate: new Date(`${new Date().getFullYear()}-01-01`), endDate: new Date(`${new Date().getFullYear()}-12-31`), status: 'OPEN',
      }).returning();
      t1PeriodId = fp!.id;

      const [cashAcc] = await tx.insert(chartOfAccounts).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, accountCode: '1110', name: 'الصندوق', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true,
      }).returning();
      const [salesAcc] = await tx.insert(chartOfAccounts).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, accountCode: '4100', name: 'المبيعات', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true,
      }).returning();
      const [vatAcc] = await tx.insert(chartOfAccounts).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, accountCode: '2130', name: 'ضريبة المخرجات', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true,
      }).returning();
      await tx.insert(accountMappings).values([
        { tenantId: t1Id, legalEntityId: t1Entity1Id, mappingKey: 'CASH_VAULT', accountId: cashAcc!.id },
        { tenantId: t1Id, legalEntityId: t1Entity1Id, mappingKey: 'SALES', accountId: salesAcc!.id },
        { tenantId: t1Id, legalEntityId: t1Entity1Id, mappingKey: 'VAT_OUTPUT', accountId: vatAcc!.id },
      ]);

      const [dev] = await tx.insert(devices).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, branchId: t1Branch1Id, deviceCode: `POS-N-${uniqueSuffix}`, deviceName: 'Num POS', deviceType: 'POS_TERMINAL',
      }).returning();
      t1DeviceId = dev!.id;

      const [uom] = await tx.insert(unitsOfMeasure).values({
        tenantId: t1Id, code: `N${uniqueSuffix.slice(-4)}`, nameAr: 'حبة', nameEn: 'Piece',
      }).returning();
      t1UomId = uom!.id;

      const [cat] = await tx.insert(categories).values({
        tenantId: t1Id, code: `CN-${uniqueSuffix.slice(-4)}`, nameAr: 'أصناف ترقيم', nameEn: 'Num Items',
      }).returning();

      const [itm] = await tx.insert(items).values({
        tenantId: t1Id, legalEntityOwnerId: t1Entity1Id, sku: `SKUN-${uniqueSuffix}`, nameAr: 'صنف ترقيم', nameEn: 'Num Item', categoryId: cat!.id, baseUomId: t1UomId, sellingPrice: '100.0000', vatRate: '0.1500', trackInventory: false,
      }).returning();
      t1ItemId = itm!.id;

      const [sh] = await tx.insert(posShifts).values({
        tenantId: t1Id, legalEntityId: t1Entity1Id, branchId: t1Branch1Id, deviceId: t1DeviceId, cashierId: t1UserId, openingCash: '500.0000', status: 'OPEN',
      }).returning();
      t1ShiftId = sh!.id;
    });
  }, 90000);

  afterAll(async () => {
    if (db && createdTenantIds.length > 0) {
      try {
        await db.delete(documentNumberAllocations).where(inArray(documentNumberAllocations.tenantId, createdTenantIds));
        await db.delete(documentSequences).where(inArray(documentSequences.tenantId, createdTenantIds));
        await db.delete(payments).where(inArray(payments.tenantId, createdTenantIds));
        await db.delete(orderLines).where(inArray(orderLines.tenantId, createdTenantIds));
        await db.delete(salesOrders).where(inArray(salesOrders.tenantId, createdTenantIds));
        await db.delete(posShifts).where(inArray(posShifts.tenantId, createdTenantIds));
        await db.delete(journalLines).where(inArray(journalLines.tenantId, createdTenantIds));
        await db.delete(journalEntries).where(inArray(journalEntries.tenantId, createdTenantIds));
        await db.delete(accountMappings).where(inArray(accountMappings.tenantId, createdTenantIds));
        await db.delete(chartOfAccounts).where(inArray(chartOfAccounts.tenantId, createdTenantIds));
        await db.delete(fiscalPeriods).where(inArray(fiscalPeriods.tenantId, createdTenantIds));
        await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.tenantId, createdTenantIds));
        await db.delete(items).where(inArray(items.tenantId, createdTenantIds));
        await db.delete(categories).where(inArray(categories.tenantId, createdTenantIds));
        await db.delete(unitsOfMeasure).where(inArray(unitsOfMeasure.tenantId, createdTenantIds));
        await db.delete(devices).where(inArray(devices.tenantId, createdTenantIds));
        await db.delete(pdplConsents).where(inArray(pdplConsents.tenantId, createdTenantIds));
        await db.delete(onboardingProgress).where(inArray(onboardingProgress.tenantId, createdTenantIds));
        await db.delete(tenantIndustryPacks).where(inArray(tenantIndustryPacks.tenantId, createdTenantIds));
        await db.delete(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, createdTenantIds));
        await db.delete(auditLogs).where(inArray(auditLogs.tenantId, createdTenantIds));
        await db.delete(warehouses).where(inArray(warehouses.tenantId, createdTenantIds));
        await db.delete(branches).where(inArray(branches.tenantId, createdTenantIds));
        await db.delete(legalEntities).where(inArray(legalEntities.tenantId, createdTenantIds));
        await db.delete(groups).where(inArray(groups.tenantId, createdTenantIds));
        const memberships = await db.select({ id: userMemberships.id }).from(userMemberships).where(inArray(userMemberships.tenantId, createdTenantIds));
        if (memberships.length > 0) {
          await db.delete(membershipScopes).where(inArray(membershipScopes.membershipId, memberships.map((m) => m.id)));
        }
        await db.delete(userMemberships).where(inArray(userMemberships.tenantId, createdTenantIds));
        const tenantRoles = await db.select({ id: roles.id }).from(roles).where(inArray(roles.tenantId, createdTenantIds));
        if (tenantRoles.length > 0) {
          await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, tenantRoles.map((r) => r.id)));
        }
        await db.delete(roles).where(inArray(roles.tenantId, createdTenantIds));
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
        if (createdUserIds.length > 0) {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }
      } catch {
        // Best-effort cleanup
      }
    }
    if (sqlClient) await sqlClient.end();
  }, 45000);

  it('isolates sequences across tenants, legal entities, document types, and branches', async () => {
    // Tenant 1 Entity 1 vs Tenant 2 Entity 1
    await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity1Id, documentType: 'SALES_INVOICE', prefix: 'T1E1', startingNumber: 100, padding: 5, fiscalYearFormat: 'YYYY' },
    });
    await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token2,
      body: { legalEntityId: t2EntityId, documentType: 'SALES_INVOICE', prefix: 'T2E1', startingNumber: 1, padding: 4, fiscalYearFormat: 'NONE' },
    });
    // Tenant 1 Entity 2 & Branch 1/2 overrides
    await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity2Id, documentType: 'SALES_INVOICE', prefix: 'T1E2', startingNumber: 50, padding: 5 },
    });
    await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity1Id, branchId: t1Branch1Id, documentType: 'PURCHASE_ORDER', prefix: 'POB1', startingNumber: 1, padding: 4 },
    });
    await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity1Id, branchId: t1Branch2Id, documentType: 'PURCHASE_ORDER', prefix: 'POB2', startingNumber: 1, padding: 4 },
    });

    const a1 = await apiCall('/document-numbering/allocate', { method: 'POST', token: token1, body: { legalEntityId: t1Entity1Id, documentType: 'SALES_INVOICE' } });
    const a2 = await apiCall('/document-numbering/allocate', { method: 'POST', token: token2, body: { legalEntityId: t2EntityId, documentType: 'SALES_INVOICE' } });
    const b1 = await apiCall('/document-numbering/allocate', { method: 'POST', token: token1, body: { legalEntityId: t1Entity2Id, documentType: 'SALES_INVOICE' } });
    const po1 = await apiCall('/document-numbering/allocate', { method: 'POST', token: token1, body: { legalEntityId: t1Entity1Id, branchId: t1Branch1Id, documentType: 'PURCHASE_ORDER' } });
    const po2 = await apiCall('/document-numbering/allocate', { method: 'POST', token: token1, body: { legalEntityId: t1Entity1Id, branchId: t1Branch2Id, documentType: 'PURCHASE_ORDER' } });

    expect(a1.body.data.formattedNumber).toMatch(/^T1E1-\d{4}-00100$/);
    expect(a2.body.data.formattedNumber).toBe('T2E1-0001');
    expect(b1.body.data.formattedNumber).toMatch(/^T1E2-\d{4}-00050$/);
    expect(po1.body.data.formattedNumber).toMatch(/^POB1-\d{4}-0001$/);
    expect(po2.body.data.formattedNumber).toMatch(/^POB2-\d{4}-0001$/);

    // Cross-tenant isolation: Tenant 2 cannot see Tenant 1 sequences
    const t2List = await apiCall('/document-numbering/sequences', { token: token2 });
    expect(t2List.body.data.every((s: any) => s.legalEntityId === t2EntityId)).toBe(true);
  }, 30000);

  it('allocates 20 unique sequential numbers under 20x concurrent requests with zero duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        apiCall('/document-numbering/allocate', {
          method: 'POST',
          token: token1,
          body: { legalEntityId: t1Entity1Id, documentType: 'JOURNAL_ENTRY' },
        })
      )
    );
    for (const r of results) expect(r.status).toBe(201);
    const numbers = results.map((r) => r.body.data.formattedNumber);
    expect(new Set(numbers).size).toBe(20);
  }, 45000);

  it('locks used sequences during open period, allows future update after period close, and preserves historical numbers', async () => {
    // SALES_INVOICE on t1Entity1Id was used above and t1PeriodId is OPEN -> 409 Conflict!
    const lockedEdit = await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity1Id, documentType: 'SALES_INVOICE', prefix: 'NEWINV', startingNumber: 200, padding: 5 },
    });
    expect(lockedEdit.status).toBe(409);

    // Close the fiscal period in DB, then update startingNumber to 200 (> current 100) -> 200 OK
    await withTenantContext({ tenantId: t1Id, userId: t1UserId, scopes: ['*'] } as any, async (tx) => {
      await tx.update(fiscalPeriods).set({ status: 'CLOSED' }).where(eq(fiscalPeriods.id, t1PeriodId));
    });

    const postCloseEdit = await apiCall('/document-numbering/sequences', {
      method: 'PUT',
      token: token1,
      body: { legalEntityId: t1Entity1Id, documentType: 'SALES_INVOICE', prefix: 'NEWINV', startingNumber: 200, padding: 5, reason: 'Post-close update' },
    });
    expect(postCloseEdit.status).toBe(200);

    const nextAfterClose = await apiCall('/document-numbering/allocate', {
      method: 'POST',
      token: token1,
      body: { legalEntityId: t1Entity1Id, documentType: 'SALES_INVOICE' },
    });
    expect(nextAfterClose.body.data.formattedNumber).toMatch(/^NEWINV-\d{4}-00200$/);

    // Historical allocation T1E1-...-00100 remains unchanged in document_number_allocations
    const allocs = await apiCall(`/document-numbering/allocations?legalEntityId=${t1Entity1Id}&documentType=SALES_INVOICE`, { token: token1 });
    expect(allocs.body.data.some((a: any) => a.formattedNumber.startsWith('T1E1-'))).toBe(true);
  }, 30000);

  it('assigns final server commercial number on Offline POS sync and never reuses numbers from failed transactions', async () => {
    // Re-open fiscal period after the previous period-close test so sales posting is permitted
    await withTenantContext({ tenantId: t1Id, userId: t1UserId, scopes: ['*'] } as any, async (tx) => {
      await tx.update(fiscalPeriods).set({ status: 'OPEN' }).where(eq(fiscalPeriods.id, t1PeriodId));
    });

    // 1. Offline POS sync with OFFLINE-... gets final POS-... commercial number
    const offlineRes = await apiCall('/sales/orders', {
      method: 'POST',
      token: token1,
      headers: { 'Idempotency-Key': `off-sync-${uniqueSuffix}` },
      body: {
        legalEntityId: t1Id ? t1Entity1Id : t1Entity1Id,
        branchId: t1Branch1Id,
        deviceId: t1DeviceId,
        warehouseId: t1WarehouseId,
        shiftId: t1ShiftId,
        orderNumber: `OFFLINE-TMP-${uniqueSuffix}`,
        orderType: 'TAKEAWAY',
        channel: 'POS',
        lines: [{ itemId: t1ItemId, uomId: t1UomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(offlineRes.status).toBe(201);
    expect(offlineRes.body.data.orderNumber).toMatch(/^POS-\d{4}-000001$/);
    expect(offlineRes.body.data.notes).toContain(`OFFLINE-TMP-${uniqueSuffix}`);

    // 2. Delete VAT_OUTPUT so next AUTO order fails mid-transaction AFTER allocating POS-2026-000002
    await withTenantContext({ tenantId: t1Id, userId: t1UserId, scopes: ['*'] } as any, async (tx) => {
      await tx.delete(accountMappings).where(and(eq(accountMappings.tenantId, t1Id), eq(accountMappings.mappingKey, 'VAT_OUTPUT')));
    });

    const failedAuto = await apiCall('/sales/orders', {
      method: 'POST',
      token: token1,
      headers: { 'Idempotency-Key': `auto-fail-${uniqueSuffix}` },
      body: {
        legalEntityId: t1Entity1Id,
        branchId: t1Branch1Id,
        deviceId: t1DeviceId,
        warehouseId: t1WarehouseId,
        shiftId: t1ShiftId,
        orderNumber: 'AUTO',
        orderType: 'TAKEAWAY',
        channel: 'POS',
        lines: [{ itemId: t1ItemId, uomId: t1UomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(failedAuto.status).toBeGreaterThanOrEqual(400);

    // 3. Next allocation must be 000003 — failed 000002 is NEVER reused!
    const nextAlloc = await apiCall('/document-numbering/allocate', {
      method: 'POST',
      token: token1,
      body: { legalEntityId: t1Entity1Id, branchId: t1Branch1Id, documentType: 'POS_TRANSACTION' },
    });
    expect(nextAlloc.body.data.allocatedNumber).toBe(3);
  }, 45000);
});
