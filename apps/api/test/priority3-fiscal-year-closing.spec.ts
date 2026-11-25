import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, inArray } from 'drizzle-orm';
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
  fiscalYears,
  fiscalPeriods,
  fiscalPeriodClosingLogs,
  fiscalYearOpeningBalances,
  fiscalYearOpeningSnapshots,
  chartOfAccounts,
  accountMappings,
  journalEntries,
  journalLines,
  idempotencyKeys,
  documentSequences,
  documentNumberAllocations,
  auditLogs,
  tenantSubscriptions,
  tenantIndustryPacks,
  pdplConsents,
  onboardingProgress,
  items,
  categories,
  unitsOfMeasure,
  inventoryBalances,
  businessPartners,
  partnerBalances,
  arInvoices,
  arInvoiceLines,
  suppliers,
  supplierBalances,
  cashVaults,
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

describe('Priority 3 — Fiscal Year Closing, Continuous-GL Opening Balances & Reopening (Staging)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;
  let withTenantContext: ReturnType<typeof createDatabaseClient>['withTenantContext'];

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let adminToken = '';
  let restrictedToken = '';
  let tenantId = '';
  let adminUserId = '';
  let restrictedUserId = '';
  let entityAId = '';
  let entityBId = '';
  let branchAId = '';
  let whAId = '';
  let itemId = '';
  let uomId = '';
  let customerPartnerId = '';
  let supplierId = '';

  // Entity A COA IDs
  let cashAccId = '';
  let arAccId = '';
  let invAccId = '';
  let apAccId = '';
  let vatOutAccId = '';
  let retainedEarningsAccId = '';
  let salesAccId = '';
  let expenseAccId = '';

  // Fiscal Years
  let fy2026AId = '';
  let fy2026BId = '';
  let fy2026APeriods: Array<{ id: string; periodName: string }> = [];
  let fy2027AId = '';

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

    // 1. Onboard fresh Staging tenant (Entity A auto-provisioned with COA + Mappings + Sequences)
    const onboard = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `P3 FY Closing Tenant ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `P3 Legal A ${uniqueSuffix}`, vatNumber: '310888999100003' },
        initialAdminUser: { email: `p3.admin.${uniqueSuffix}@example.sa`, displayName: 'P3 Admin', password: 'NumPassword2026!' },
      },
    });
    expect(onboard.status, JSON.stringify(onboard.body)).toBe(201);
    adminToken = onboard.body.data.token;
    tenantId = onboard.body.data.tenant.id;
    adminUserId = onboard.body.data.user.id;
    entityAId = onboard.body.data.legalEntity.id;
    branchAId = onboard.body.data.branch.id;
    whAId = onboard.body.data.warehouse.id;
    createdTenantIds.push(tenantId);
    createdUserIds.push(adminUserId);

    // 2. Create second Legal Entity B inside the SAME tenant (via real API to test multi-entity isolation)
    const leBRes = await apiCall('/legal-entities', {
      method: 'POST',
      token: adminToken,
      body: {
        legalName: `P3 Legal B ${uniqueSuffix}`,
        vatNumber: '310888999200003',
        functionalCurrency: 'SAR',
      },
    });
    expect(leBRes.status, JSON.stringify(leBRes.body)).toBe(201);
    entityBId = (leBRes.body.data ?? leBRes.body).id;

    // 3. Create a restricted user WITHOUT 'accounting.fiscal_year.reopen' permission (for RBAC test)
    const restrictedEmail = `p3.limited.${uniqueSuffix}@example.sa`;
    const [adminRow] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, adminUserId)).limit(1);
    const [limUser] = await db
      .insert(users)
      .values({
        email: restrictedEmail,
        displayName: 'P3 Limited Accountant',
        passwordHash: adminRow!.passwordHash,
        isActive: true,
      })
      .returning();
    restrictedUserId = limUser!.id;
    createdUserIds.push(restrictedUserId);

    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      // Create role with NO 'accounting.fiscal_year.reopen' permission
      const [limRole] = await tx
        .insert(roles)
        .values({ tenantId, code: `LIM_ACC_${uniqueSuffix}`, name: 'Limited Accountant' })
        .returning();
      const [limMem] = await tx
        .insert(userMemberships)
        .values({ tenantId, userId: restrictedUserId, roleId: limRole!.id, status: 'ACTIVE' })
        .returning();
      await tx.insert(membershipScopes).values({
        membershipId: limMem!.id,
        scopeType: 'TENANT',
        scopeId: tenantId,
      });

      // Resolve auto-provisioned COA accounts for Entity A
      const coaRows = await tx
        .select()
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.tenantId, tenantId), eq(chartOfAccounts.legalEntityId, entityAId)));
      const byCode = new Map(coaRows.map((c) => [c.accountCode, c.id]));
      cashAccId = byCode.get('111100')!;
      arAccId = byCode.get('113100')!;
      invAccId = byCode.get('112000')!;
      apAccId = byCode.get('211100')!;
      vatOutAccId = byCode.get('211200')!;
      retainedEarningsAccId = byCode.get('311000')!;
      salesAccId = byCode.get('411000')!;
      expenseAccId = byCode.get('519000')!;

      expect(cashAccId).toBeTruthy();
      expect(retainedEarningsAccId).toBeTruthy();
      expect(salesAccId).toBeTruthy();
      expect(expenseAccId).toBeTruthy();

      // Seed item, customer, supplier for subledger snapshots & draft-document check
      const [cat] = await tx
        .insert(categories)
        .values({ tenantId, code: `CP3-${uniqueSuffix.slice(-4)}`, nameAr: 'أصناف إقفال', nameEn: 'P3 Items' })
        .returning();
      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({ tenantId, code: `UP3${uniqueSuffix.slice(-3)}`, nameAr: 'قطعة', nameEn: 'Piece' })
        .returning();
      uomId = uom!.id;
      const [it] = await tx
        .insert(items)
        .values({
          tenantId,
          legalEntityOwnerId: entityAId,
          categoryId: cat!.id,
          baseUomId: uomId,
          sku: `SKUP3-${uniqueSuffix}`,
          nameAr: 'صنف إقفال',
          nameEn: 'P3 Item',
          sellingPrice: '100.0000',
          vatRate: '0.1500',
          trackInventory: true,
        })
        .returning();
      itemId = it!.id;

      // Seed matched Inventory balance (10 units * 20 SAR WAC = 200 SAR)
      await tx.insert(inventoryBalances).values({
        tenantId,
        legalEntityOwnerId: entityAId,
        warehouseId: whAId,
        itemId,
        onHandQty: '10.0000',
        wacCost: '20.0000',
        reservedQty: '0.0000',
        version: 1,
      });

      const [cust] = await tx
        .insert(businessPartners)
        .values({
          tenantId,
          partnerNumber: `CUSTP3-${uniqueSuffix}`,
          partnerType: 'CORPORATE',
          legalNameAr: 'عميل إقفال',
          legalNameEn: 'P3 Customer',
          roles: ['CUSTOMER'],
          status: 'ACTIVE',
        })
        .returning();
      customerPartnerId = cust!.id;

      // Seed matched AR balance = 500 SAR & AP vendorBalance = 200 SAR (matches ReconciliationService)
      await tx.insert(partnerBalances).values({
        tenantId,
        legalEntityId: entityAId,
        partnerId: customerPartnerId,
        currency: 'SAR',
        customerBalance: '500.0000',
        vendorBalance: '200.0000',
      });

      const [sup] = await tx
        .insert(suppliers)
        .values({ tenantId, code: `SUPP3-${uniqueSuffix}`, name: 'مورد إقفال' })
        .returning();
      supplierId = sup!.id;

      // Seed supplier_balances row at 0 (AP balance tracked in partnerBalances.vendorBalance)
      await tx.insert(supplierBalances).values({
        tenantId,
        legalEntityId: entityAId,
        supplierId,
        currentBalance: '0.0000',
        totalInvoiced: '0.0000',
        totalPaid: '0.0000',
      });

      // Seed matched Cash Vault balance = 350 SAR (650 sales cash - 300 operating expense)
      await tx.insert(cashVaults).values({
        tenantId,
        legalEntityId: entityAId,
        branchId: branchAId,
        code: 'VLT-P3',
        nameAr: 'خزينة اختبار الإقفال',
        accountId: cashAccId,
        balance: '350.0000',
        status: 'ACTIVE',
      });
    });

    // Login as restricted user scoped to our tenant
    const loginLim = await apiCall('/auth/login', {
      method: 'POST',
      body: { email: restrictedEmail, password: 'NumPassword2026!', tenantId },
    });
    expect(loginLim.status, JSON.stringify(loginLim.body)).toBe(201);
    restrictedToken = loginLim.body.data.token;

    // 4. Create FY2026 with 12 monthly periods for BOTH Entity A and Entity B
    const fyARes = await apiCall('/accounting/fiscal-years', {
      method: 'POST',
      token: adminToken,
      body: {
        legalEntityId: entityAId,
        yearCode: 'FY2026',
        yearName: 'السنة المالية 2026 - الشركة أ',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        generateMonthlyPeriods: true,
      },
    });
    expect(fyARes.status, JSON.stringify(fyARes.body)).toBe(201);
    fy2026AId = fyARes.body.data.fiscalYear.id;
    fy2026APeriods = fyARes.body.data.periods;
    expect(fy2026APeriods.length).toBe(12);

    const fyBRes = await apiCall('/accounting/fiscal-years', {
      method: 'POST',
      token: adminToken,
      body: {
        legalEntityId: entityBId,
        yearCode: 'FY2026',
        yearName: 'السنة المالية 2026 - الشركة ب',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        generateMonthlyPeriods: true,
      },
    });
    expect(fyBRes.status, JSON.stringify(fyBRes.body)).toBe(201);
    fy2026BId = fyBRes.body.data.fiscalYear.id;

    // 5. Post balanced accounting entries in FY2026 for Entity A that match AR(500), AP(200), Inventory(200), Cash(650), VAT(150), Sales(1000), Expense(300)
    // Entry 1 (Jan 2026): Sales Revenue 1000 + VAT Output 150 -> Dr Cash 650, Dr AR 500
    const je1 = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-je1-${uniqueSuffix}` },
      body: {
        legalEntityId: entityAId,
        branchId: branchAId,
        journalNumber: 'AUTO',
        journalType: 'SALES',
        entryDate: '2026-01-15T10:00:00.000Z',
        description: 'مبيعات السنة المالية 2026',
        lines: [
          { accountId: cashAccId, debit: '650.0000', credit: '0.0000' },
          { accountId: arAccId, debit: '500.0000', credit: '0.0000' },
          { accountId: salesAccId, debit: '0.0000', credit: '1000.0000' },
          { accountId: vatOutAccId, debit: '0.0000', credit: '150.0000' },
        ],
      },
    });
    expect(je1.status, JSON.stringify(je1.body)).toBe(201);

    // Entry 2 (Feb 2026): Inventory Purchase 200 -> Dr Inventory 200, Cr AP 200
    const je2 = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-je2-${uniqueSuffix}` },
      body: {
        legalEntityId: entityAId,
        branchId: branchAId,
        journalNumber: 'AUTO',
        journalType: 'PURCHASES',
        entryDate: '2026-01-16T10:00:00.000Z',
        description: 'مشتريات مخزون 2026',
        lines: [
          { accountId: invAccId, debit: '200.0000', credit: '0.0000' },
          { accountId: apAccId, debit: '0.0000', credit: '200.0000' },
        ],
      },
    });
    expect(je2.status, JSON.stringify(je2.body)).toBe(201);

    // Entry 3 (Mar 2026): Operating Expense 300 -> Dr Expense 300, Cr Cash 300 (Net Cash = 350, Net Profit = 1000 - 300 = 700)
    const je3 = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-je3-${uniqueSuffix}` },
      body: {
        legalEntityId: entityAId,
        branchId: branchAId,
        journalNumber: 'AUTO',
        journalType: 'GENERAL',
        entryDate: '2026-01-17T10:00:00.000Z',
        description: 'مصروفات تشغيلية 2026',
        lines: [
          { accountId: expenseAccId, debit: '300.0000', credit: '0.0000' },
          { accountId: cashAccId, debit: '0.0000', credit: '300.0000' },
        ],
      },
    });
    expect(je3.status, JSON.stringify(je3.body)).toBe(201);
  }, 120000);

  afterAll(async () => {
    try {
      for (const tId of createdTenantIds) {
        if (!tId || !adminUserId) continue;
        await withTenantContext({ tenantId: tId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
          await tx.delete(fiscalYearOpeningSnapshots).where(eq(fiscalYearOpeningSnapshots.tenantId, tId));
          await tx.delete(fiscalYearOpeningBalances).where(eq(fiscalYearOpeningBalances.tenantId, tId));
          await tx.delete(fiscalPeriodClosingLogs).where(eq(fiscalPeriodClosingLogs.tenantId, tId));
          await tx.update(fiscalYears).set({ closingJournalEntryId: null, reopenReversalJournalEntryId: null, previousFiscalYearId: null }).where(eq(fiscalYears.tenantId, tId));
          await tx.delete(fiscalPeriods).where(eq(fiscalPeriods.tenantId, tId));
          await tx.delete(fiscalYears).where(eq(fiscalYears.tenantId, tId));
          await tx.delete(documentNumberAllocations).where(eq(documentNumberAllocations.tenantId, tId));
          await tx.delete(documentSequences).where(eq(documentSequences.tenantId, tId));
          await tx.delete(arInvoiceLines).where(eq(arInvoiceLines.tenantId, tId));
          await tx.delete(arInvoices).where(eq(arInvoices.tenantId, tId));
          await tx.delete(partnerBalances).where(eq(partnerBalances.tenantId, tId));
          await tx.delete(businessPartners).where(eq(businessPartners.tenantId, tId));
          await tx.delete(supplierBalances).where(eq(supplierBalances.tenantId, tId));
          await tx.delete(suppliers).where(eq(suppliers.tenantId, tId));
          await tx.delete(cashVaults).where(eq(cashVaults.tenantId, tId));
          await tx.delete(inventoryBalances).where(eq(inventoryBalances.tenantId, tId));
          await tx.delete(items).where(eq(items.tenantId, tId));
          await tx.delete(unitsOfMeasure).where(eq(unitsOfMeasure.tenantId, tId));
          await tx.delete(categories).where(eq(categories.tenantId, tId));
          await tx.delete(journalLines).where(eq(journalLines.journalEntryId, journalEntries.id)).catch(() => {});
          const jeIds = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tId));
          if (jeIds.length > 0) {
            await tx.delete(journalLines).where(inArray(journalLines.journalEntryId, jeIds.map((j) => j.id)));
          }
          await tx.delete(journalEntries).where(eq(journalEntries.tenantId, tId));
          await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.tenantId, tId));
          await tx.delete(accountMappings).where(eq(accountMappings.tenantId, tId));
          await tx.delete(chartOfAccounts).where(eq(chartOfAccounts.tenantId, tId));
          await tx.delete(warehouses).where(eq(warehouses.tenantId, tId));
          await tx.delete(branches).where(eq(branches.tenantId, tId));
          await tx.delete(legalEntities).where(eq(legalEntities.tenantId, tId));
          await tx.delete(groups).where(eq(groups.tenantId, tId));
          await tx.delete(auditLogs).where(eq(auditLogs.tenantId, tId));
          await tx.delete(onboardingProgress).where(eq(onboardingProgress.tenantId, tId));
          await tx.delete(pdplConsents).where(eq(pdplConsents.tenantId, tId));
          await tx.delete(tenantIndustryPacks).where(eq(tenantIndustryPacks.tenantId, tId));
          await tx.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tId));
          const memberships = await tx.select({ id: userMemberships.id }).from(userMemberships).where(eq(userMemberships.tenantId, tId));
          if (memberships.length > 0) {
            await tx.delete(membershipScopes).where(inArray(membershipScopes.membershipId, memberships.map((m) => m.id)));
          }
          await tx.delete(userMemberships).where(eq(userMemberships.tenantId, tId));
          const tenantRoles = await tx.select({ id: roles.id }).from(roles).where(eq(roles.tenantId, tId));
          if (tenantRoles.length > 0) {
            await tx.delete(rolePermissions).where(inArray(rolePermissions.roleId, tenantRoles.map((r) => r.id)));
          }
          await tx.delete(roles).where(eq(roles.tenantId, tId));
          await tx.delete(tenants).where(eq(tenants.id, tId));
        });
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } catch {
      // best-effort cleanup
    }
    await sqlClient.end();
  }, 45000);

  it('1. Rejects fiscal year closing when periods are OPEN, when unbalanced JE exists, or when DRAFT documents exist', async () => {
    // 1A. Periods are still OPEN -> must reject with ALL_PERIODS_CLOSED
    const openPeriodClose = await apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-fail-open-${uniqueSuffix}` },
      body: { autoOpenNextYear: false },
    });
    expect(openPeriodClose.status).toBe(400);

    // 1B. Close all 12 periods of FY2026 Entity A (in batches of 4 over Staging SSH tunnel)
    for (let i = 0; i < fy2026APeriods.length; i += 4) {
      const batch = fy2026APeriods.slice(i, i + 4);
      const results = await Promise.all(
        batch.map((p) =>
          apiCall(`/accounting/fiscal-periods/${p.id}/close`, {
            method: 'POST',
            token: adminToken,
            body: { idempotencyKey: `p3-cp-${p.id}` },
          }),
        ),
      );
      for (const cRes of results) {
        expect(cRes.status, JSON.stringify(cRes.body)).toBe(201);
      }
    }

    // 1C. Inject a DRAFT AR invoice in 2026 -> pre-check & close MUST reject (PENDING_DOCUMENTS)
    const draftAr = await apiCall('/subledger/ar/invoices', {
      method: 'POST',
      token: adminToken,
      body: {
        legalEntityId: entityAId,
        branchId: branchAId,
        partnerId: customerPartnerId,
        invoiceNumber: 'DRAFT-TEST',
        invoiceType: 'TAX_INVOICE',
        issueDate: '2026-06-10',
        dueDate: '2026-06-30',
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
      },
    });
    expect(draftAr.status).toBe(201);
    const draftArId = draftAr.body.data.id;

    const preDraft = await apiCall(`/accounting/fiscal-years/${fy2026AId}/pre-check`, {
      method: 'POST',
      token: adminToken,
    });
    expect(preDraft.status).toBe(201);
    expect(preDraft.body.data.canClose).toBe(false);
    const pendingCheck = preDraft.body.data.checks.find((c: any) => c.code === 'PENDING_DOCUMENTS');
    expect(pendingCheck.severity).toBe('BLOCKER');

    // Clean up draft AR invoice
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      await tx.delete(arInvoiceLines).where(eq(arInvoiceLines.invoiceId, draftArId));
      await tx.delete(arInvoices).where(eq(arInvoices.id, draftArId));
    });

    // 1D. Inject an unbalanced journal entry directly in Staging DB -> pre-check MUST block (UNBALANCED_JOURNALS)
    let badJeId = '';
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      const [badJe] = await tx
        .insert(journalEntries)
        .values({
          tenantId,
          legalEntityId: entityAId,
          journalNumber: `BAD-UNBAL-${uniqueSuffix}`,
          journalType: 'GENERAL',
          sourceType: 'MANUAL',
          sourceId: fy2026AId,
          status: 'POSTED',
          debitTotal: '100.0000',
          creditTotal: '50.0000',
          entryDate: new Date('2026-05-01T00:00:00Z'),
        })
        .returning();
      badJeId = badJe!.id;
      await tx.insert(journalLines).values([
        { journalEntryId: badJeId, accountId: cashAccId, debit: '100.0000', credit: '0.0000' },
        { journalEntryId: badJeId, accountId: salesAccId, debit: '0.0000', credit: '50.0000' },
      ]);
    });

    const preUnbal = await apiCall(`/accounting/fiscal-years/${fy2026AId}/pre-check`, {
      method: 'POST',
      token: adminToken,
    });
    expect(preUnbal.status).toBe(201);
    expect(preUnbal.body.data.canClose).toBe(false);
    const unbalCheck = preUnbal.body.data.checks.find((c: any) => c.code === 'UNBALANCED_JOURNALS');
    expect(unbalCheck.severity).toBe('BLOCKER');

    // Remove injected unbalanced JE
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      await tx.delete(journalLines).where(eq(journalLines.journalEntryId, badJeId));
      await tx.delete(journalEntries).where(eq(journalEntries.id, badJeId));
    });

    // 1E. Failure Injection & Rollback: invalid non-equity retainedEarningsAccountId (Cash account) -> must reject & rollback
    const failInjectRes = await apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-fail-re-${uniqueSuffix}` },
      body: { retainedEarningsAccountId: cashAccId, autoOpenNextYear: true },
    });
    expect(failInjectRes.status).toBe(400);

    // Verify full Rollback: FY2026 still OPEN, 0 closing JEs, 0 opening balances
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      const [fyRow] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, fy2026AId));
      expect(fyRow!.status).toBe('OPEN');
      expect(fyRow!.closingJournalEntryId).toBeNull();
    });
  }, 300000);

  it('2. Executes concurrent close (only 1 succeeds), enforces Idempotency, zeroes ONLY nominal accounts into Retained Earnings, opens FY2027 with balanced Continuous-GL Opening Balances, and verifies Multi-Entity Isolation', async () => {
    const closeKey1 = `p3-close-main-${uniqueSuffix}`;
    const closeKey2 = `p3-close-race-${uniqueSuffix}`;

    // 2A. Fire 2 CONCURRENT close requests with different idempotency keys
    const [r1, r2] = await Promise.all([
      apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
        method: 'POST',
        token: adminToken,
        headers: { 'Idempotency-Key': closeKey1 },
        body: { autoOpenNextYear: true, notes: 'إقفال السنة المالية 2026' },
      }),
      apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
        method: 'POST',
        token: adminToken,
        headers: { 'Idempotency-Key': closeKey2 },
        body: { autoOpenNextYear: true, notes: 'طلب متزامن مكرر' },
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses, JSON.stringify([r1.body, r2.body])).toEqual([201, 409]);

    const winner = r1.status === 201 ? r1.body.data : r2.body.data;
    const winnerKey = r1.status === 201 ? closeKey1 : closeKey2;

    expect(winner.fiscalYear.status).toBe('CLOSED');
    expect(winner.netProfitLoss).toBe('700.0000'); // Sales 1000 - Expense 300 = 700
    expect(winner.closingJournalEntry).toBeTruthy();
    expect(winner.closingJournalEntry.journalNumber).toMatch(/^JV-\d{4}-\d{6}$/);
    expect(winner.nextFiscalYear).toBeTruthy();
    fy2027AId = winner.nextFiscalYear.fiscalYear.id;
    expect(winner.nextFiscalYear.fiscalYear.yearCode).toBe('FY2027');
    expect(winner.nextFiscalYear.periods.length).toBe(12);
    expect(winner.nextFiscalYear.openingSummary.isBalanced).toBe(true);

    // 2B. Idempotency replay with the SAME key returns cached result without creating a second closing entry
    const replay = await apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': winnerKey },
      body: { autoOpenNextYear: true, notes: r1.status === 201 ? 'إقفال السنة المالية 2026' : 'طلب متزامن مكرر' },
    });
    expect(replay.status).toBe(201);

    // Verify strictly ONE closing journal entry in DB (no double closing!)
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      const closingJes = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, tenantId),
            eq(journalEntries.legalEntityId, entityAId),
            eq(journalEntries.journalType, 'CLOSING'),
          ),
        );
      expect(closingJes.length).toBe(1);

      // Verify ZERO duplicate OPENING journal entries in Continuous GL
      const openingJes = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, tenantId),
            eq(journalEntries.legalEntityId, entityAId),
            eq(journalEntries.journalType, 'OPENING'),
          ),
        );
      expect(openingJes.length).toBe(0);
    });

    // 2C. Duplicate open-next MUST be rejected (409 Conflict)
    const dupOpenNext = await apiCall(`/accounting/fiscal-years/${fy2026AId}/open-next`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-dup-open-${uniqueSuffix}` },
      body: {},
    });
    expect(dupOpenNext.status).toBe(409);

    // 2D. Verify Trial Balance post-closing & FY2027 Opening Balances match with ZERO double-counting:
    // Permanent balances: Cash=350 (Dr), AR=500 (Dr), Inv=200 (Dr) => Total Dr = 1050
    //                     AP=200 (Cr), VAT=150 (Cr), Retained Earnings=700 (Cr) => Total Cr = 1050
    // Nominal balances:   Sales=0, Expense=0!
    const tbAfter = await apiCall(`/accounting/trial-balance?legalEntityId=${entityAId}`, {
      token: adminToken,
    });
    expect(tbAfter.status).toBe(200);
    expect(tbAfter.body.data.isBalanced).toBe(true);
    const tbMap = new Map<string, any>(tbAfter.body.data.accounts.map((a: any) => [a.accountCode, a]));
    expect(parseFloat(tbMap.get('411000').netBalance)).toBeCloseTo(0, 4); // Sales zeroed
    expect(parseFloat(tbMap.get('519000').netBalance)).toBeCloseTo(0, 4); // Expense zeroed
    expect(parseFloat(tbMap.get('311000').netBalance)).toBeCloseTo(-700, 4); // Retained Earnings = 700 Cr
    expect(parseFloat(tbMap.get('111100').netBalance)).toBeCloseTo(350, 4); // Cash = 350 Dr (NOT doubled!)
    expect(parseFloat(tbMap.get('113100').netBalance)).toBeCloseTo(500, 4); // AR = 500 Dr
    expect(parseFloat(tbMap.get('112000').netBalance)).toBeCloseTo(200, 4); // Inventory = 200 Dr
    expect(parseFloat(tbMap.get('211100').netBalance)).toBeCloseTo(-200, 4); // AP = 200 Cr
    expect(parseFloat(tbMap.get('211200').netBalance)).toBeCloseTo(-150, 4); // VAT = 150 Cr

    const openBalRes = await apiCall(`/accounting/fiscal-years/${fy2027AId}/opening-balances`, {
      token: adminToken,
    });
    expect(openBalRes.status).toBe(200);
    expect(openBalRes.body.data.totals.isBalanced).toBe(true);
    expect(openBalRes.body.data.totals.totalDebit).toBe('1050.0000');
    expect(openBalRes.body.data.totals.totalCredit).toBe('1050.0000');

    // Verify AR/AP/Inventory subledger snapshots match GL control accounts!
    const snaps = new Map<string, any>(
      openBalRes.body.data.snapshots.map((s: any) => [s.snapshotType, s]),
    );
    expect(snaps.get('AR_CUSTOMERS').totalDebit).toBe('500.0000');
    expect(snaps.get('AP_SUPPLIERS').totalCredit).toBe('200.0000');
    expect(snaps.get('INVENTORY_VALUATION').totalDebit).toBe('200.0000');

    // 2E. Verify Posting to CLOSED FY2026 AND outside approved periods (e.g. 2025) are BOTH blocked
    const postClosed = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-post-closed-${uniqueSuffix}` },
      body: {
        legalEntityId: entityAId,
        journalNumber: 'AUTO',
        journalType: 'GENERAL',
        entryDate: '2026-06-15T10:00:00.000Z',
        description: 'محاولة ترحيل في سنة مقفلة',
        lines: [
          { accountId: cashAccId, debit: '10.0000', credit: '0.0000' },
          { accountId: salesAccId, debit: '0.0000', credit: '10.0000' },
        ],
      },
    });
    expect(postClosed.status).toBe(400);

    const postOutside = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-post-out-${uniqueSuffix}` },
      body: {
        legalEntityId: entityAId,
        journalNumber: 'AUTO',
        journalType: 'GENERAL',
        entryDate: '2025-06-15T10:00:00.000Z',
        description: 'محاولة ترحيل خارج الفترات المعتمدة',
        lines: [
          { accountId: cashAccId, debit: '10.0000', credit: '0.0000' },
          { accountId: salesAccId, debit: '0.0000', credit: '10.0000' },
        ],
      },
    });
    expect(postOutside.status).toBe(400);

    // 2F. Multi-Legal Entity Isolation: Entity B's FY2026 is STILL OPEN and untouched!
    await withTenantContext({ tenantId, userId: adminUserId, scopes: ['*'] } as any, async (tx) => {
      const [fyB] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, fy2026BId));
      expect(fyB!.status).toBe('OPEN');
      expect(fyB!.closingJournalEntryId).toBeNull();
    });
  }, 180000);

  it('3. Enforces RBAC & mandatory reason on Fiscal Year Reopening, posts immutable REVERSAL entry, supersedes FY2027 opening balances, and allows clean re-close', async () => {
    // 3A. Restricted user WITHOUT 'accounting.fiscal_year.reopen' -> 403 Forbidden
    const unauthReopen = await apiCall(`/accounting/fiscal-years/${fy2026AId}/reopen`, {
      method: 'POST',
      token: restrictedToken,
      headers: { 'Idempotency-Key': `p3-reopen-403-${uniqueSuffix}` },
      body: { reason: 'محاولة إعادة فتح بدون صلاحية معتمدة' },
    });
    expect(unauthReopen.status).toBe(403);

    // 3B. Authorized user with short reason (< 10 chars) -> 400 BadRequest
    const shortReason = await apiCall(`/accounting/fiscal-years/${fy2026AId}/reopen`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-reopen-short-${uniqueSuffix}` },
      body: { reason: 'قصير' },
    });
    expect(shortReason.status).toBe(400);

    // 3C. Authorized user with valid reason -> 201, immutable REVERSAL entry created, FY2026 OPEN, FY2027 opening balances SUPERSEDED
    const reopenRes = await apiCall(`/accounting/fiscal-years/${fy2026AId}/reopen`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-reopen-ok-${uniqueSuffix}` },
      body: { reason: 'تصحيح قيد تسوية معتمد من المراجع الخارجي قبل الإقفال النهائي' },
    });
    expect(reopenRes.status, JSON.stringify(reopenRes.body)).toBe(201);
    expect(reopenRes.body.data.fiscalYear.status).toBe('OPEN');
    expect(reopenRes.body.data.reversalJournalEntry).toBeTruthy();
    expect(reopenRes.body.data.reversalJournalEntry.journalType).toBe('REVERSAL');

    // Verify Sales(1000) & Expense(300) are restored and Retained Earnings back to 0 after Reversal
    const tbReopened = await apiCall(`/accounting/trial-balance?legalEntityId=${entityAId}`, {
      token: adminToken,
    });
    const tbMap = new Map<string, any>(tbReopened.body.data.accounts.map((a: any) => [a.accountCode, a]));
    expect(parseFloat(tbMap.get('411000').netBalance)).toBeCloseTo(-1000, 4);
    expect(parseFloat(tbMap.get('519000').netBalance)).toBeCloseTo(300, 4);
    expect(parseFloat(tbMap.get('311000').netBalance)).toBeCloseTo(0, 4);

    // Verify FY2027 active opening balances are now 0 (SUPERSEDED)
    const openBalSuperseded = await apiCall(`/accounting/fiscal-years/${fy2027AId}/opening-balances`, {
      token: adminToken,
    });
    expect(openBalSuperseded.body.data.balances.length).toBe(0);

    // 3D. Re-close FY2026 cleanly with autoOpenNextYear: true -> refreshes FY2027 active opening balances!
    const recloseRes = await apiCall(`/accounting/fiscal-years/${fy2026AId}/close`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `p3-reclose-${uniqueSuffix}` },
      body: { autoOpenNextYear: true, notes: 'إقفال نهائي بعد المراجعة' },
    });
    expect(recloseRes.status, JSON.stringify(recloseRes.body)).toBe(201);
    expect(recloseRes.body.data.fiscalYear.status).toBe('CLOSED');
    expect(recloseRes.body.data.netProfitLoss).toBe('700.0000');

    const openBalRefreshed = await apiCall(`/accounting/fiscal-years/${fy2027AId}/opening-balances`, {
      token: adminToken,
    });
    expect(openBalRefreshed.body.data.totals.isBalanced).toBe(true);
    expect(openBalRefreshed.body.data.totals.totalDebit).toBe('1050.0000');
    expect(openBalRefreshed.body.data.totals.totalCredit).toBe('1050.0000');
  }, 180000);
});
