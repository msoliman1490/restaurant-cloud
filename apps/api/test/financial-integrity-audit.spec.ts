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
  purchaseRequests,
  purchaseRequestLines,
  journalEntries,
  journalLines,
  idempotencyKeys,
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

describe('Financial Integrity, 10x Concurrency Idempotency & Draft Safety Audit (Staging DB)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;
  let withTenantContext: ReturnType<typeof createDatabaseClient>['withTenantContext'];

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let token = '';
  let tenantId = '';
  let legalEntityId = '';
  let branchId = '';
  let warehouseId = '';
  let deviceId = '';
  let shiftId = '';
  let itemId = '';
  let uomId = '';
  let createdJournalId = '';

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

    // 1. Onboard isolated test tenant
    const onboard = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Audit Org ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `Audit Legal ${uniqueSuffix}`, vatNumber: '310777888900003' },
        initialAdminUser: { email: `audit.${uniqueSuffix}@example.sa`, displayName: 'Audit Admin', password: 'AuditPassword2026!' },
      },
    });
    expect(onboard.status).toBe(201);
    token = onboard.body.data.token;
    tenantId = onboard.body.data.tenant.id;
    legalEntityId = onboard.body.data.legalEntity.id;
    branchId = onboard.body.data.branch.id;
    warehouseId = onboard.body.data.warehouse.id;
    createdTenantIds.push(tenantId);
    createdUserIds.push(onboard.body.data.user.id);

    // 2. Seed Cash Vault, Sales, and VAT Output accounts & Account Mappings inside RLS tenant context
    await withTenantContext(
      { tenantId, userId: onboard.body.data.user.id, scopes: ['*'] } as any,
      async (tx) => {
        const [cashAcc] = await tx.insert(chartOfAccounts).values({
          tenantId, legalEntityId, accountCode: '1110', name: 'الصندوق', nameAr: 'الصندوق', nameEn: 'Cash Vault', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true,
        }).returning();
        const [salesAcc] = await tx.insert(chartOfAccounts).values({
          tenantId, legalEntityId, accountCode: '4100', name: 'المبيعات', nameAr: 'المبيعات', nameEn: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true,
        }).returning();
        const [vatAcc] = await tx.insert(chartOfAccounts).values({
          tenantId, legalEntityId, accountCode: '2130', name: 'ضريبة المخرجات', nameAr: 'ضريبة المخرجات', nameEn: 'VAT Output', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true,
        }).returning();

        await tx.insert(accountMappings).values([
          { tenantId, legalEntityId, mappingKey: 'CASH_VAULT', accountId: cashAcc!.id },
          { tenantId, legalEntityId, mappingKey: 'SALES', accountId: salesAcc!.id },
          { tenantId, legalEntityId, mappingKey: 'VAT_OUTPUT', accountId: vatAcc!.id },
        ]);

        const [dev] = await tx.insert(devices).values({
          tenantId, legalEntityId, branchId, deviceCode: `POS-AUD-${uniqueSuffix}`, deviceName: 'Audit POS', deviceType: 'POS_TERMINAL',
        }).returning();
        deviceId = dev!.id;

        const [uom] = await tx.insert(unitsOfMeasure).values({
          tenantId, code: `U${uniqueSuffix.slice(-4)}`, nameAr: 'حبة', nameEn: 'Piece',
        }).returning();
        uomId = uom!.id;

        const [cat] = await tx.insert(categories).values({
          tenantId, code: `CAT-${uniqueSuffix.slice(-6)}`, nameAr: 'أصناف الاختبار', nameEn: 'Audit Items',
        }).returning();

        const [itm] = await tx.insert(items).values({
          tenantId, legalEntityOwnerId: legalEntityId, sku: `SKU-${uniqueSuffix}`, nameAr: 'وجبة اختبار', nameEn: 'Audit Meal', categoryId: cat!.id, baseUomId: uomId, sellingPrice: '100.0000', vatRate: '0.1500', trackInventory: false,
        }).returning();
        itemId = itm!.id;

        const [sh] = await tx.insert(posShifts).values({
          tenantId, legalEntityId, branchId, deviceId, cashierId: onboard.body.data.user.id, openingCash: '500.0000', status: 'OPEN',
        }).returning();
        shiftId = sh!.id;
      }
    );
  }, 90000);

  afterAll(async () => {
    if (db && createdTenantIds.length > 0) {
      try {
        await db.delete(payments).where(inArray(payments.tenantId, createdTenantIds));
        await db.delete(orderLines).where(inArray(orderLines.tenantId, createdTenantIds));
        await db.delete(salesOrders).where(inArray(salesOrders.tenantId, createdTenantIds));
        await db.delete(posShifts).where(inArray(posShifts.tenantId, createdTenantIds));
        await db.delete(purchaseRequestLines).where(inArray(purchaseRequestLines.tenantId, createdTenantIds));
        await db.delete(purchaseRequests).where(inArray(purchaseRequests.tenantId, createdTenantIds));
        await db.delete(journalLines).where(inArray(journalLines.tenantId, createdTenantIds));
        await db.delete(journalEntries).where(inArray(journalEntries.tenantId, createdTenantIds));
        await db.delete(accountMappings).where(inArray(accountMappings.tenantId, createdTenantIds));
        await db.delete(chartOfAccounts).where(inArray(chartOfAccounts.tenantId, createdTenantIds));
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

  it('prevents double-submission on 10x concurrent POS orders & replays exact original order + balanced GL entry', async () => {
    const idempKey = `pos-10x-${uniqueSuffix}`;
    const payload = {
      legalEntityId,
      branchId,
      deviceId,
      warehouseId,
      shiftId,
      orderNumber: `ORD-10X-${uniqueSuffix}`,
      orderType: 'TAKEAWAY',
      channel: 'POS',
      idempotencyKey: idempKey,
      lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000' }],
      payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        apiCall('/sales/orders', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': idempKey },
          body: payload,
        })
      )
    );

    for (const r of responses) {
      expect([200, 201]).toContain(r.status);
      expect(r.body.success).toBe(true);
    }

    const orderIds = new Set(responses.map((r) => r.body.data.id));
    expect(orderIds.size).toBe(1);

    // Verify DB evidence: exactly 1 order, 1 payment, 1 balanced journal entry
    const dbOrders = await db.select().from(salesOrders).where(eq(salesOrders.tenantId, tenantId));
    const dbPayments = await db.select().from(payments).where(eq(payments.tenantId, tenantId));
    const dbJournals = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId));

    expect(dbOrders.length).toBe(1);
    expect(dbPayments.length).toBe(1);
    expect(dbJournals.length).toBe(1);
    expect(Number(dbJournals[0]!.debitTotal)).toBeCloseTo(Number(dbJournals[0]!.creditTotal), 4);
    createdJournalId = dbJournals[0]!.id;

    // Reusing same Idempotency-Key with DIFFERENT payload must return 409 Conflict
    const mismatchRes = await apiCall('/sales/orders', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idempKey },
      body: { ...payload, orderNumber: `ORD-DIFF-${uniqueSuffix}` },
    });
    expect(mismatchRes.status).toBe(409);
  }, 45000);

  it('prevents 10x concurrent Purchase Request creation and enforces concurrent Draft Approval locking + version increment', async () => {
    const prKey = `pr-10x-${uniqueSuffix}`;
    const prPayload = {
      legalEntityId,
      warehouseId,
      requestNumber: `PR-10X-${uniqueSuffix}`,
      notes: 'Concurrent PR Audit',
      lines: [{ itemId, uomId, requestedQty: '5.0000', estimatedUnitCost: '20.0000' }],
    };

    const prResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        apiCall('/purchasing/requests', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': prKey },
          body: prPayload,
        })
      )
    );
    for (const r of prResponses) expect([200, 201]).toContain(r.status);
    const prId = prResponses[0]!.body.data.id;

    const dbPrs = await db.select().from(purchaseRequests).where(eq(purchaseRequests.tenantId, tenantId));
    expect(dbPrs.length).toBe(1);
    expect(dbPrs[0]!.version).toBe(1);

    // Concurrent approval race: 2 users/requests approve same draft at the exact same millisecond
    const [app1, app2] = await Promise.all([
      apiCall(`/purchasing/requests/${prId}/approve`, { method: 'POST', token }),
      apiCall(`/purchasing/requests/${prId}/approve`, { method: 'POST', token }),
    ]);
    const statuses = [app1.status, app2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const [updatedPr] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, prId));
    expect(updatedPr!.status).toBe('APPROVED');
    expect(updatedPr!.version).toBe(2);
  }, 30000);

  it('enforces Journal Entry immutability (reversal only) and verifies 0034 DB locks', async () => {
    // Reversing posted journal entry creates a balanced reversal entry without mutating original
    const revRes = await apiCall(`/accounting/journal-entries/${createdJournalId}/reverse`, {
      method: 'POST',
      token,
      body: { reason: 'Audit Reversal Test' },
    });
    expect([200, 201]).toContain(revRes.status);

    const allJournals = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId));
    expect(allJournals.length).toBe(2);
    for (const j of allJournals) {
      expect(Number(j.debitTotal)).toBeCloseTo(Number(j.creditTotal), 4);
    }

    // Verify 0034 partial unique indexes exist on Staging DB
    const idxRows = await sqlClient`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('uq_sales_orders_tenant_idemp', 'uq_payments_tenant_idemp', 'uq_journal_entries_tenant_idemp')
    `;
    expect(idxRows.length).toBe(3);
  }, 30000);
});
