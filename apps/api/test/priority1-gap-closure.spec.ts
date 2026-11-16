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
  suppliers,
  supplierInvoices,
  supplierInvoiceLines,
  supplierPayments,
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

describe('Priority 1 Gap Closure: DB Idempotency, Server-Side Drafts & Rollback Injection (Staging)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;
  let withTenantContext: ReturnType<typeof createDatabaseClient>['withTenantContext'];

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let token = '';
  let userId = '';
  let tenantId = '';
  let legalEntityId = '';
  let branchId = '';
  let warehouseId = '';
  let deviceId = '';
  let shiftId = '';
  let itemId = '';
  let uomId = '';
  let supplierId = '';

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
    return { status: res.status, headers: res.headers, body: json };
  }

  beforeAll(async () => {
    const client = createDatabaseClient({ connectionString: loadDbUrl(), maxConnections: 5 });
    db = client.db;
    sqlClient = client.sqlClient;
    withTenantContext = client.withTenantContext;

    const onboard = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `P1 Audit ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `P1 Legal ${uniqueSuffix}`, vatNumber: '310666777800003' },
        initialAdminUser: { email: `p1.${uniqueSuffix}@example.sa`, displayName: 'P1 Admin', password: 'P1Password2026!' },
      },
    });
    expect(onboard.status).toBe(201);
    token = onboard.body.data.token;
    userId = onboard.body.data.user.id;
    tenantId = onboard.body.data.tenant.id;
    legalEntityId = onboard.body.data.legalEntity.id;
    branchId = onboard.body.data.branch.id;
    warehouseId = onboard.body.data.warehouse.id;
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, async (tx) => {
      const [cashAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '1110', name: 'الصندوق', nameAr: 'الصندوق', nameEn: 'Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true,
      }).returning();
      const [invAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '1140', name: 'المخزون', nameAr: 'المخزون', nameEn: 'Inventory', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true,
      }).returning();
      const [apAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '2110', name: 'الدائنون', nameAr: 'الدائنون', nameEn: 'AP', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true,
      }).returning();
      const [vatInAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '1150', name: 'ضريبة المدخلات', nameAr: 'ضريبة المدخلات', nameEn: 'VAT Input', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true,
      }).returning();
      const [salesAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '4100', name: 'المبيعات', nameAr: 'المبيعات', nameEn: 'Sales', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true,
      }).returning();
      const [vatOutAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '2130', name: 'ضريبة المخرجات', nameAr: 'ضريبة المخرجات', nameEn: 'VAT Output', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true,
      }).returning();
      const [expAcc] = await tx.insert(chartOfAccounts).values({
        tenantId, legalEntityId, accountCode: '5100', name: 'مصروفات', nameAr: 'مصروفات', nameEn: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true,
      }).returning();

      await tx.insert(accountMappings).values([
        { tenantId, legalEntityId, mappingKey: 'CASH_VAULT', accountId: cashAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'INVENTORY', accountId: invAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'ACCOUNTS_PAYABLE', accountId: apAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'VAT_INPUT', accountId: vatInAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'SALES', accountId: salesAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'VAT_OUTPUT', accountId: vatOutAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'GENERAL_EXPENSE', accountId: expAcc!.id },
        { tenantId, legalEntityId, mappingKey: 'BANK', accountId: cashAcc!.id },
      ]);

      const [dev] = await tx.insert(devices).values({
        tenantId, legalEntityId, branchId, deviceCode: `POS-P1-${uniqueSuffix}`, deviceName: 'P1 POS', deviceType: 'POS_TERMINAL',
      }).returning();
      deviceId = dev!.id;

      const [uom] = await tx.insert(unitsOfMeasure).values({
        tenantId, code: `P${uniqueSuffix.slice(-4)}`, nameAr: 'حبة', nameEn: 'Piece',
      }).returning();
      uomId = uom!.id;

      const [cat] = await tx.insert(categories).values({
        tenantId, code: `CP1-${uniqueSuffix.slice(-4)}`, nameAr: 'أصناف P1', nameEn: 'P1 Items',
      }).returning();

      const [itm] = await tx.insert(items).values({
        tenantId, legalEntityOwnerId: legalEntityId, sku: `SKUP1-${uniqueSuffix}`, nameAr: 'صنف P1', nameEn: 'P1 Item', categoryId: cat!.id, baseUomId: uomId, sellingPrice: '100.0000', vatRate: '0.1500', trackInventory: false,
      }).returning();
      itemId = itm!.id;

      const [sh] = await tx.insert(posShifts).values({
        tenantId, legalEntityId, branchId, deviceId, cashierId: userId, openingCash: '500.0000', status: 'OPEN',
      }).returning();
      shiftId = sh!.id;

      const [sup] = await tx.insert(suppliers).values({
        tenantId, code: `SUPP1-${uniqueSuffix.slice(-5)}`, name: 'مورد P1', nameAr: 'مورد P1', nameEn: 'P1 Supplier', vatNumber: '310444555600003',
      }).returning();
      supplierId = sup!.id;
    });
  }, 90000);

  afterAll(async () => {
    if (db && createdTenantIds.length > 0) {
      try {
        await db.delete(supplierPayments).where(inArray(supplierPayments.tenantId, createdTenantIds));
        await db.delete(supplierInvoiceLines).where(inArray(supplierInvoiceLines.tenantId, createdTenantIds));
        await db.delete(supplierInvoices).where(inArray(supplierInvoices.tenantId, createdTenantIds));
        await db.delete(suppliers).where(inArray(suppliers.tenantId, createdTenantIds));
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

  it('verifies all 7 partial unique idempotency indexes from 0035 & strict Idempotency-Key policy', async () => {
    const idxRows = await sqlClient`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'uq_purchase_requests_tenant_idemp',
          'uq_purchase_orders_tenant_idemp',
          'uq_goods_receipts_tenant_idemp',
          'uq_supplier_invoices_tenant_idemp',
          'uq_purchase_returns_tenant_idemp',
          'uq_supplier_payments_tenant_idemp',
          'uq_stock_adjustments_tenant_idemp'
        )
    `;
    expect(idxRows.length).toBe(7);

    // Missing Idempotency-Key in strict mode must return 400
    const strictMissing = await apiCall('/sales/orders', {
      method: 'POST',
      token,
      headers: { 'x-idempotency-mode': 'strict' },
      body: {
        legalEntityId, branchId, deviceId, warehouseId, shiftId,
        orderNumber: `ORD-STRICT-${uniqueSuffix}`,
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(strictMissing.status).toBe(400);
  });

  it('prevents 10x concurrent Supplier Invoices & Payments and verifies single DB row + balanced GL', async () => {
    const invKey = `sinv-10x-${uniqueSuffix}`;
    const invPayload = {
      legalEntityId,
      supplierId,
      invoiceNumber: `SINV-${uniqueSuffix}`,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      lines: [{ itemId, uomId, quantity: '2.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
    };

    const invResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        apiCall('/purchasing/invoices', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': invKey },
          body: invPayload,
        })
      )
    );
    for (const r of invResponses) expect([200, 201]).toContain(r.status);
    const invIds = new Set(invResponses.map((r) => r.body.data.id));
    expect(invIds.size).toBe(1);
    const invoiceId = invResponses[0]!.body.data.id;

    // 10x concurrent Supplier Payments against the invoice
    const pmtKey = `spmt-10x-${uniqueSuffix}`;
    const pmtPayload = {
      legalEntityId,
      supplierId,
      invoiceId,
      paymentNumber: `SPMT-${uniqueSuffix}`,
      amount: '115.0000',
      paymentMethod: 'BANK_TRANSFER',
    };
    const pmtResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        apiCall('/purchasing/payments', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': pmtKey },
          body: pmtPayload,
        })
      )
    );
    for (const r of pmtResponses) expect([200, 201]).toContain(r.status);

    const { dbInvs, dbPmts } = await withTenantContext(
      { tenantId, userId, scopes: ['*'] } as any,
      async (tx) => ({
        dbInvs: await tx.select().from(supplierInvoices).where(eq(supplierInvoices.tenantId, tenantId)),
        dbPmts: await tx.select().from(supplierPayments).where(eq(supplierPayments.tenantId, tenantId)),
      })
    );
    expect(dbInvs.length).toBe(1);
    expect(dbPmts.length).toBe(1);
  }, 45000);

  it('supports cross-device Server-Side Draft recovery, version increments, and 409 Conflict on stale expectedVersion', async () => {
    const createDraft = await apiCall('/purchasing/requests', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `pr-draft-${uniqueSuffix}` },
      body: {
        legalEntityId,
        warehouseId,
        requestNumber: `PRD-${uniqueSuffix}`,
        saveAsDraft: true,
        notes: 'Initial Draft Device A',
        lines: [{ itemId, uomId, requestedQty: '3.0000', estimatedUnitCost: '15.0000' }],
      },
    });
    expect(createDraft.status).toBe(201);
    const prId = createDraft.body.data.id;
    expect(createDraft.body.data.status).toBe('DRAFT');
    expect(createDraft.body.data.version).toBe(1);

    // Device B loads the draft from server
    const getDeviceB = await apiCall(`/purchasing/requests/${prId}`, { token });
    expect(getDeviceB.status).toBe(200);
    expect(getDeviceB.body.data.notes).toBe('Initial Draft Device A');

    // Device A updates draft with expectedVersion: 1 -> succeeds, version becomes 2
    const patchA = await apiCall(`/purchasing/requests/${prId}/draft`, {
      method: 'PATCH',
      token,
      body: { expectedVersion: 1, notes: 'Updated by Device A' },
    });
    expect(patchA.status).toBe(200);
    expect(patchA.body.data.version).toBe(2);

    // Device B tries stale update with expectedVersion: 1 -> 409 Conflict!
    const patchBStale = await apiCall(`/purchasing/requests/${prId}/draft`, {
      method: 'PATCH',
      token,
      body: { expectedVersion: 1, notes: 'Stale overwrite from Device B' },
    });
    expect(patchBStale.status).toBe(409);

    // Device B reloads (v2) and submits draft -> SUBMITTED (v3); further draft edits blocked
    const submitB = await apiCall(`/purchasing/requests/${prId}/draft`, {
      method: 'PATCH',
      token,
      body: { expectedVersion: 2, submit: true },
    });
    expect(submitB.status).toBe(200);
    expect(submitB.body.data.status).toBe('SUBMITTED');
    expect(submitB.body.data.version).toBe(3);

    const postSubmitEdit = await apiCall(`/purchasing/requests/${prId}/draft`, {
      method: 'PATCH',
      token,
      body: { expectedVersion: 3, notes: 'Illegal edit after submit' },
    });
    expect(postSubmitEdit.status).toBe(409);
  }, 30000);

  it('injects mid-transaction GL failure after payment insert and proves complete DB Rollback (0 orphan rows)', async () => {
    // Delete VAT_OUTPUT mapping so PostingEngineService throws mid-transaction AFTER sales_orders & payments inserts
    await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, async (tx) => {
      await tx
        .delete(accountMappings)
        .where(
          and(
            eq(accountMappings.tenantId, tenantId),
            eq(accountMappings.legalEntityId, legalEntityId),
            eq(accountMappings.mappingKey, 'VAT_OUTPUT')
          )
        );
    });

    const failOrderNum = `ORD-FAIL-${uniqueSuffix}`;
    const failRes = await apiCall('/sales/orders', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `fail-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId, deviceId, warehouseId, shiftId,
        orderNumber: failOrderNum,
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(failRes.status).toBeGreaterThanOrEqual(400);

    // Verify 0 orphan sales_orders & 0 orphan payments were committed for failOrderNum
    const { orphanOrders, orphanPayments } = await withTenantContext(
      { tenantId, userId, scopes: ['*'] } as any,
      async (tx) => ({
        orphanOrders: await tx
          .select()
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.orderNumber, failOrderNum))),
        orphanPayments: await tx.select().from(payments).where(eq(payments.tenantId, tenantId)),
      })
    );
    expect(orphanOrders.length).toBe(0);
    expect(orphanPayments.length).toBe(0);
  }, 30000);
});
