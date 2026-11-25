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
  suppliers,
  supplierBalances,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceipts,
  goodsReceiptLines,
  supplierInvoices,
  supplierInvoiceLines,
  purchaseReturns,
  purchaseReturnLines,
  supplierPayments,
  cashVaults,
  vaultTransactions,
  paymentVouchers,
  receiptVouchers,
  stockTransfers,
  stockTransferLines,
  stockAdjustments,
  stockAdjustmentLines,
  inventoryBalances,
  inventoryMovements,
  deliveryOrders,
  businessPartners,
  partnerBalances,
  partnerCompanySettings,
  arInvoices,
  arInvoiceLines,
  zatcaLegalEntityConfigs,
  egsUnits,
  zatcaCertificates,
  zatcaDocuments,
  zatcaOutboxQueue,
  zatcaAuditLogs,
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

describe('Priority 2 Final Closure — SALES_INVOICE + GL + ZATCA & Full-Matrix Concurrency (Staging)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;
  let withTenantContext: ReturnType<typeof createDatabaseClient>['withTenantContext'];

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let token = '';
  let tenantId = '';
  let userId = '';
  let legalEntityId = '';
  let branchId = '';
  let wh1Id = '';
  let wh2Id = '';
  let deviceId = '';
  let shiftId = '';
  let itemId = '';
  let uomId = '';
  let supplierId = '';
  let customerPartnerId = '';
  let cashAccId = '';
  let salesAccId = '';
  let expenseAccId = '';
  let vaultId = '';
  let egsUnitId = '';

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

    const onboard = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `P2 Closure Tenant ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `P2 Closure Legal ${uniqueSuffix}`, vatNumber: '310777888900003' },
        initialAdminUser: { email: `p2c.${uniqueSuffix}@example.sa`, displayName: 'P2 Closure Admin', password: 'NumPassword2026!' },
      },
    });
    expect(onboard.status, JSON.stringify(onboard.body)).toBe(201);
    token = onboard.body.data.token;
    tenantId = onboard.body.data.tenant.id;
    userId = onboard.body.data.user.id;
    legalEntityId = onboard.body.data.legalEntity.id;
    branchId = onboard.body.data.branch.id;
    wh1Id = onboard.body.data.warehouse.id;
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, async (tx) => {
      await tx
        .update(warehouses)
        .set({ legalEntityId, allowTransfer: true, allowIssuing: true, allowReceiving: true })
        .where(eq(warehouses.id, wh1Id));

      const [wh2] = await tx
        .insert(warehouses)
        .values({
          tenantId,
          legalEntityId,
          branchId,
          code: 'WH-DEST',
          name: 'مستودع الوجهة',
          status: 'ACTIVE',
          allowReceiving: true,
          allowIssuing: true,
          allowTransfer: true,
        })
        .returning();
      wh2Id = wh2!.id;

      const [dev] = await tx
        .insert(devices)
        .values({
          tenantId,
          legalEntityId,
          branchId,
          deviceCode: `POS-${uniqueSuffix}`,
          deviceName: 'POS 1',
          deviceType: 'POS_TERMINAL',
        })
        .returning();
      deviceId = dev!.id;

      const [sh] = await tx
        .insert(posShifts)
        .values({
          tenantId,
          legalEntityId,
          branchId,
          deviceId,
          cashierId: userId,
          openingCash: '500.0000',
          status: 'OPEN',
        })
        .returning();
      shiftId = sh!.id;

      const [cat] = await tx
        .insert(categories)
        .values({ tenantId, code: `C-${uniqueSuffix.slice(-4)}`, nameAr: 'أصناف الإغلاق', nameEn: 'Closure Items' })
        .returning();
      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({ tenantId, code: `U${uniqueSuffix.slice(-4)}`, nameAr: 'قطعة', nameEn: 'Piece' })
        .returning();
      uomId = uom!.id;

      const [it] = await tx
        .insert(items)
        .values({
          tenantId,
          legalEntityOwnerId: legalEntityId,
          categoryId: cat!.id,
          baseUomId: uomId,
          sku: `SKU-${uniqueSuffix}`,
          nameAr: 'صنف اختبار الإغلاق',
          nameEn: 'Closure Test Item',
          sellingPrice: '100.0000',
          vatRate: '0.1500',
          trackInventory: true,
        })
        .returning();
      itemId = it!.id;

      await tx.insert(inventoryBalances).values({
        tenantId,
        legalEntityOwnerId: legalEntityId,
        warehouseId: wh1Id,
        itemId,
        onHandQty: '500.0000',
        reservedQty: '0.0000',
        version: 1,
      });

      const [sup] = await tx
        .insert(suppliers)
        .values({ tenantId, code: `SUP-${uniqueSuffix}`, name: 'مورد اختبار الإغلاق' })
        .returning();
      supplierId = sup!.id;

      const [cust] = await tx
        .insert(businessPartners)
        .values({
          tenantId,
          partnerNumber: `CUST-${uniqueSuffix}`,
          partnerType: 'CORPORATE',
          legalNameAr: 'شركة عميل اختبار الزكاة',
          legalNameEn: 'ZATCA Test Customer Co',
          taxIdentificationNumber: '310444555600003',
          roles: ['CUSTOMER'],
          status: 'ACTIVE',
        })
        .returning();
      customerPartnerId = cust!.id;

      await tx.insert(fiscalPeriods).values({
        tenantId,
        legalEntityId,
        periodName: '2026-P2C',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T23:59:59Z'),
        status: 'OPEN',
      });

      // Resolve auto-provisioned COA accounts (created by CoaProvisioningService during onboard)
      const coaRows = await tx
        .select()
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.tenantId, tenantId), eq(chartOfAccounts.legalEntityId, legalEntityId)));
      const byCode = new Map(coaRows.map((c) => [c.accountCode, c.id]));
      cashAccId = byCode.get('111100')!;
      salesAccId = byCode.get('411000')!;
      expenseAccId = byCode.get('519000')!;
      expect(cashAccId).toBeTruthy();
      expect(salesAccId).toBeTruthy();
      expect(expenseAccId).toBeTruthy();

      const [v] = await tx
        .insert(cashVaults)
        .values({
          tenantId,
          legalEntityId,
          branchId,
          code: 'VLT-P2C',
          nameAr: 'الخزينة الرئيسية',
          accountId: cashAccId,
          balance: '50000.0000',
          status: 'ACTIVE',
        })
        .returning();
      vaultId = v!.id;
    });

    // Provision ZATCA v2 Sandbox Config + EGS Unit + CSID via real APIs
    const zCfg = await apiCall('/zatca/config', {
      method: 'POST',
      token,
      body: {
        legalEntityId,
        v2Enabled: true,
        environment: 'SANDBOX',
        sellerVatNumber: '310777888900003',
        sellerNameAr: `شركة اختبار الزكاة ${uniqueSuffix}`,
        sellerNameEn: `ZATCA Test Co ${uniqueSuffix}`,
        crNumber: '1010555666',
        streetName: 'King Fahd Road',
        buildingNumber: '1234',
        cityName: 'Riyadh',
        postalZone: '12345',
        districtName: 'Olaya',
        industrySector: 'Food & Beverage',
      },
    });
    expect(zCfg.status, JSON.stringify(zCfg.body)).toBe(201);

    const egsRes = await apiCall('/zatca/egs-units', {
      method: 'POST',
      token,
      body: {
        legalEntityId,
        branchId,
        deviceId,
        unitIdentifier: `1-RC|2-POS|3-${uniqueSuffix}`,
      },
    });
    expect(egsRes.status, JSON.stringify(egsRes.body)).toBe(201);
    egsUnitId = (egsRes.body.data ?? egsRes.body).id;

    const otpRes = await apiCall(`/zatca/egs-units/${egsUnitId}/onboard-otp`, {
      method: 'POST',
      token,
      body: { deviceId, otp: '123456' },
    });
    expect(otpRes.status, JSON.stringify(otpRes.body)).toBe(201);
    const certId = (otpRes.body.data ?? otpRes.body).certificate?.id ?? (otpRes.body.data ?? otpRes.body).id;

    const compRes = await apiCall(`/zatca/egs-units/${egsUnitId}/compliance-checks`, {
      method: 'POST',
      token,
      body: { certificateId: certId },
    });
    expect(compRes.status, JSON.stringify(compRes.body)).toBe(201);

    const prodRes = await apiCall(`/zatca/certificates/${certId}/issue-production`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(prodRes.status, JSON.stringify(prodRes.body)).toBe(201);
  }, 90000);

  afterAll(async () => {
    try {
      for (const tId of createdTenantIds) {
        if (!tId || !userId) continue;
        await withTenantContext({ tenantId: tId, userId, scopes: ['*'] } as any, async (tx) => {
          await tx.delete(zatcaOutboxQueue).where(eq(zatcaOutboxQueue.tenantId, tId));
          await tx.delete(zatcaDocuments).where(eq(zatcaDocuments.tenantId, tId));
          await tx.delete(zatcaCertificates).where(eq(zatcaCertificates.tenantId, tId));
          await tx.delete(egsUnits).where(eq(egsUnits.tenantId, tId));
          await tx.delete(zatcaLegalEntityConfigs).where(eq(zatcaLegalEntityConfigs.tenantId, tId));
          await tx.delete(documentNumberAllocations).where(eq(documentNumberAllocations.tenantId, tId));
          await tx.delete(documentSequences).where(eq(documentSequences.tenantId, tId));
          await tx.delete(arInvoiceLines).where(eq(arInvoiceLines.tenantId, tId));
          await tx.delete(arInvoices).where(eq(arInvoices.tenantId, tId));
          await tx.delete(partnerCompanySettings).where(eq(partnerCompanySettings.tenantId, tId));
          await tx.delete(partnerBalances).where(eq(partnerBalances.tenantId, tId));
          await tx.delete(businessPartners).where(eq(businessPartners.tenantId, tId));
          await tx.delete(deliveryOrders).where(eq(deliveryOrders.tenantId, tId));
          await tx.delete(inventoryMovements).where(eq(inventoryMovements.tenantId, tId));
          await tx.delete(stockTransferLines).where(eq(stockTransferLines.tenantId, tId));
          await tx.delete(stockTransfers).where(eq(stockTransfers.tenantId, tId));
          await tx.delete(stockAdjustmentLines).where(eq(stockAdjustmentLines.tenantId, tId));
          await tx.delete(stockAdjustments).where(eq(stockAdjustments.tenantId, tId));
          await tx.delete(inventoryBalances).where(eq(inventoryBalances.tenantId, tId));
          await tx.delete(supplierPayments).where(eq(supplierPayments.tenantId, tId));
          await tx.delete(purchaseReturnLines).where(eq(purchaseReturnLines.tenantId, tId));
          await tx.delete(purchaseReturns).where(eq(purchaseReturns.tenantId, tId));
          await tx.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.tenantId, tId));
          await tx.delete(supplierInvoices).where(eq(supplierInvoices.tenantId, tId));
          await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.tenantId, tId));
          await tx.delete(goodsReceipts).where(eq(goodsReceipts.tenantId, tId));
          await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, tId));
          await tx.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, tId));
          await tx.delete(supplierBalances).where(eq(supplierBalances.tenantId, tId));
          await tx.delete(suppliers).where(eq(suppliers.tenantId, tId));
          await tx.delete(vaultTransactions).where(eq(vaultTransactions.tenantId, tId));
          await tx.delete(paymentVouchers).where(eq(paymentVouchers.tenantId, tId));
          await tx.delete(receiptVouchers).where(eq(receiptVouchers.tenantId, tId));
          await tx.delete(cashVaults).where(eq(cashVaults.tenantId, tId));
          await tx.delete(payments).where(eq(payments.tenantId, tId));
          await tx.delete(orderLines).where(eq(orderLines.tenantId, tId));
          await tx.delete(salesOrders).where(eq(salesOrders.tenantId, tId));
          await tx.delete(journalLines).where(eq(journalLines.tenantId, tId));
          await tx.delete(journalEntries).where(eq(journalEntries.tenantId, tId));
          await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.tenantId, tId));
          await tx.delete(accountMappings).where(eq(accountMappings.tenantId, tId));
          await tx.delete(chartOfAccounts).where(eq(chartOfAccounts.tenantId, tId));
          await tx.delete(fiscalPeriods).where(eq(fiscalPeriods.tenantId, tId));
          await tx.delete(posShifts).where(eq(posShifts.tenantId, tId));
          await tx.delete(devices).where(eq(devices.tenantId, tId));
          await tx.delete(items).where(eq(items.tenantId, tId));
          await tx.delete(unitsOfMeasure).where(eq(unitsOfMeasure.tenantId, tId));
          await tx.delete(categories).where(eq(categories.tenantId, tId));
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
      // Best-effort cleanup (zatca_audit_logs is append-only for rc_app_user)
    }
    await sqlClient.end();
  }, 45000);

  it('Point 1: SALES_INVOICE generates final approved AR invoice number, links exact number to GL & ZATCA, and preserves independent ZATCA ICV/PIH', async () => {
    const dueDate = new Date(Date.now() + 7 * 86400_000).toISOString();

    // A. Create DRAFT AR Tax Invoice with spoofed client number -> server assigns DRAFT-..., does NOT consume SALES_INVOICE
    const draftRes = await apiCall('/subledger/ar/invoices', {
      method: 'POST',
      token,
      body: {
        legalEntityId,
        branchId,
        partnerId: customerPartnerId,
        invoiceNumber: 'CLIENT-SPOOF-999',
        invoiceType: 'TAX_INVOICE',
        dueDate,
        lines: [{ itemId, uomId, quantity: '2.0000', unitPrice: '100.0000', taxRate: '0.1500' }],
      },
    });
    expect(draftRes.status, JSON.stringify(draftRes.body)).toBe(201);
    const draftInv = draftRes.body.data;
    expect(draftInv.status).toBe('DRAFT');
    expect(draftInv.invoiceNumber).toMatch(/^DRAFT-[A-F0-9]{8}$/);
    expect(draftInv.invoiceNumber).not.toBe('CLIENT-SPOOF-999');

    // B. ZATCA MUST reject issuing a document for an unapproved DRAFT invoice
    const draftZatcaRes = await apiCall('/zatca/documents/generate', {
      method: 'POST',
      token,
      body: {
        egsUnitId,
        sourceType: 'AR_INVOICE',
        sourceId: draftInv.id,
        idempotencyKey: `z-draft-${uniqueSuffix}`,
      },
    });
    expect(draftZatcaRes.status).toBe(400);

    // C. Approve & Post AR Invoice -> allocates final official SALES_INVOICE number (INV-YYYY-000001) + posts GL entry
    const postRes = await apiCall(`/subledger/ar/invoices/${draftInv.id}/post`, {
      method: 'POST',
      token,
    });
    expect(postRes.status, JSON.stringify(postRes.body)).toBe(201);
    const postedInv = postRes.body.data;
    expect(postedInv.status).toBe('POSTED');
    expect(postedInv.invoiceNumber).toMatch(/^INV-\d{4}-000001$/);
    expect(postedInv.journalEntryId).toBeTruthy();

    // Verify GL Journal Entry in Staging DB carries the exact final invoice number
    const [glRow] = await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, (tx) =>
      tx.select().from(journalEntries).where(eq(journalEntries.id, postedInv.journalEntryId)).limit(1)
    );
    expect(glRow).toBeTruthy();
    expect(glRow!.sourceType).toBe('AR_INVOICE');
    expect(glRow!.sourceId).toBe(postedInv.id);
    expect(glRow!.journalNumber).toBe(`JRN-AR-${postedInv.invoiceNumber}`);
    expect(glRow!.description).toContain(postedInv.invoiceNumber);

    // Verify allocation audit trail in document_number_allocations
    const [allocRow] = await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, (tx) =>
      tx
        .select()
        .from(documentNumberAllocations)
        .where(
          and(
            eq(documentNumberAllocations.tenantId, tenantId),
            eq(documentNumberAllocations.formattedNumber, postedInv.invoiceNumber)
          )
        )
        .limit(1)
    );
    expect(allocRow).toBeTruthy();
    expect(allocRow!.status).toBe('USED');
    expect(allocRow!.sourceId).toBe(postedInv.id);

    // D. Issue ZATCA Document for the posted AR Invoice -> exact same documentNumber & journalEntryId, independent ICV=1
    const zatca1Res = await apiCall('/zatca/documents/generate', {
      method: 'POST',
      token,
      body: {
        egsUnitId,
        sourceType: 'AR_INVOICE',
        sourceId: postedInv.id,
        idempotencyKey: `z-ar1-${uniqueSuffix}`,
      },
    });
    expect(zatca1Res.status, JSON.stringify(zatca1Res.body)).toBe(201);
    const zDoc1 = (zatca1Res.body.data ?? zatca1Res.body).document;
    expect(zDoc1.documentNumber).toBe(postedInv.invoiceNumber);
    expect(zDoc1.journalEntryId).toBe(postedInv.journalEntryId);
    expect(zDoc1.icv).toBe(1);
    expect(zDoc1.ublXml).toContain(`<cbc:ID>${postedInv.invoiceNumber}</cbc:ID>`);
    expect(zDoc1.signedXml).toContain(`<cbc:ID>${postedInv.invoiceNumber}</cbc:ID>`);

    // E. Create & Post an AR Credit Note (CN-YYYY-000001) -> ZATCA ICV advances monotonically to 2 with PIH = zDoc1.invoiceHash
    const cnDraftRes = await apiCall('/subledger/ar/invoices', {
      method: 'POST',
      token,
      body: {
        legalEntityId,
        branchId,
        partnerId: customerPartnerId,
        invoiceNumber: 'AUTO',
        invoiceType: 'CREDIT_NOTE',
        originalInvoiceId: postedInv.id,
        originalInvoiceUuid: zDoc1.uuid,
        originalInvoiceNumber: postedInv.invoiceNumber,
        zatcaReasonCode: 'RETURN',
        dueDate,
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000', taxRate: '0.1500' }],
      },
    });
    expect(cnDraftRes.status, JSON.stringify(cnDraftRes.body)).toBe(201);
    const cnPostRes = await apiCall(`/subledger/ar/invoices/${cnDraftRes.body.data.id}/post`, {
      method: 'POST',
      token,
    });
    expect(cnPostRes.status, JSON.stringify(cnPostRes.body)).toBe(201);
    const postedCn = cnPostRes.body.data;
    expect(postedCn.invoiceNumber).toMatch(/^CN-\d{4}-000001$/);

    const zatca2Res = await apiCall('/zatca/documents/generate', {
      method: 'POST',
      token,
      body: {
        egsUnitId,
        sourceType: 'AR_INVOICE',
        sourceId: postedCn.id,
        idempotencyKey: `z-cn1-${uniqueSuffix}`,
      },
    });
    expect(zatca2Res.status, JSON.stringify(zatca2Res.body)).toBe(201);
    const zDoc2 = (zatca2Res.body.data ?? zatca2Res.body).document;
    expect(zDoc2.documentNumber).toBe(postedCn.invoiceNumber);
    expect(zDoc2.journalEntryId).toBe(postedCn.journalEntryId);
    expect(zDoc2.icv).toBe(2);
    expect(zDoc2.pih).toBe(zDoc1.invoiceHash);

    // F. Also verify SALES_ORDER (non-POS) -> INV-YYYY-000002 + GL + ZATCA ICV=3 (PIH = zDoc2.invoiceHash)
    const soRes = await apiCall('/sales/orders', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2c-so-${uniqueSuffix}` },
      body: {
        legalEntityId,
        branchId,
        deviceId,
        warehouseId: wh1Id,
        shiftId,
        orderNumber: 'CLIENT-SO-SPOOF',
        orderType: 'DELIVERY',
        channel: 'ONLINE',
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(soRes.status, JSON.stringify(soRes.body)).toBe(201);
    const soData = soRes.body.data;
    expect(soData.orderNumber).toMatch(/^INV-\d{4}-000002$/);
    expect(soData.journalEntry.journalNumber).toBe(`JV-SALE-${soData.orderNumber}`);

    const zatca3Res = await apiCall('/zatca/documents/generate', {
      method: 'POST',
      token,
      body: {
        egsUnitId,
        sourceType: 'SALES_ORDER',
        sourceId: soData.id,
        idempotencyKey: `z-so1-${uniqueSuffix}`,
      },
    });
    expect(zatca3Res.status, JSON.stringify(zatca3Res.body)).toBe(201);
    const zDoc3 = (zatca3Res.body.data ?? zatca3Res.body).document;
    expect(zDoc3.documentNumber).toBe(soData.orderNumber);
    expect(zDoc3.journalEntryId).toBe(soData.journalEntry.id);
    expect(zDoc3.icv).toBe(3);
    expect(zDoc3.pih).toBe(zDoc2.invoiceHash);
  }, 120000);

  it('Point 2A: Directly concurrency-tests Sales, Delivery & Purchasing paths (9 paths x 5x parallel) with zero duplicates', async () => {
    const N = 5;
    const dueDate = new Date(Date.now() + 7 * 86400_000).toISOString();

    // 1. SALES_INVOICE (AR Invoice Post — 5 concurrent posts)
    const arDrafts = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/subledger/ar/invoices', {
          method: 'POST',
          token,
          body: {
            legalEntityId,
            branchId,
            partnerId: customerPartnerId,
            invoiceNumber: `CONC-AR-${i}`,
            invoiceType: 'TAX_INVOICE',
            dueDate,
            lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
          },
        })
      )
    );
    for (const d of arDrafts) expect(d.status).toBe(201);
    const arPosts = await Promise.all(
      arDrafts.map((d) => apiCall(`/subledger/ar/invoices/${d.body.data.id}/post`, { method: 'POST', token }))
    );
    for (const r of arPosts) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const arInvNums = arPosts.map((r) => r.body.data.invoiceNumber);
    expect(new Set(arInvNums).size).toBe(N);
    for (const n of arInvNums) expect(n).toMatch(/^INV-\d{4}-\d{6}$/);

    // 2. SALES_INVOICE (Sales Order Online — 5 concurrent)
    const onlineOrders = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/sales/orders', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-onl-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            branchId,
            deviceId,
            warehouseId: wh1Id,
            shiftId,
            orderNumber: `CONC-ONL-${i}`,
            orderType: 'DELIVERY',
            channel: 'ONLINE',
            lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '50.0000' }],
            payments: [{ paymentMethod: 'CASH', amount: '57.5000' }],
          },
        })
      )
    );
    for (const r of onlineOrders) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const onlineNums = onlineOrders.map((r) => r.body.data.orderNumber);
    expect(new Set(onlineNums).size).toBe(N);
    for (const n of onlineNums) expect(n).toMatch(/^INV-\d{4}-\d{6}$/);

    // 3. POS_TRANSACTION (5 concurrent)
    const posOrders = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/sales/orders', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-pos-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            branchId,
            deviceId,
            warehouseId: wh1Id,
            shiftId,
            orderNumber: `CONC-POS-${i}`,
            orderType: 'TAKEAWAY',
            channel: 'POS',
            lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '50.0000' }],
            payments: [{ paymentMethod: 'CASH', amount: '57.5000' }],
          },
        })
      )
    );
    for (const r of posOrders) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const posNums = posOrders.map((r) => r.body.data.orderNumber);
    expect(new Set(posNums).size).toBe(N);
    for (const n of posNums) expect(n).toMatch(/^POS-\d{4}-\d{6}$/);

    // 4. CREDIT_NOTE (5 concurrent refunds on the 5 POS orders)
    const cnCalls = await Promise.all(
      posOrders.map((o, i) =>
        apiCall(`/sales/orders/${o.body.data.id}/refund`, {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-cn-${uniqueSuffix}-${i}` },
          body: { reason: `مرتجع متزامن ${i}`, restockInventory: false, idempotencyKey: `conc-cn-${uniqueSuffix}-${i}` },
        })
      )
    );
    for (const r of cnCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const cnNums = cnCalls.map((r) => r.body.data.creditNoteNumber);
    expect(new Set(cnNums).size).toBe(N);
    for (const n of cnNums) expect(n).toMatch(/^CN-\d{4}-\d{6}$/);

    // 5. DELIVERY_NOTE (5 concurrent delivery orders linked to the 5 online orders)
    const dlvCalls = await Promise.all(
      onlineOrders.map((o, i) =>
        apiCall('/delivery/orders', {
          method: 'POST',
          token,
          body: {
            legalEntityId,
            branchId,
            salesOrderId: o.body.data.id,
            customerName: `عميل توصيل ${i}`,
            customerPhone: `050000000${i}`,
            deliveryAddress: 'الرياض',
            externalReference: `CONC-DLV-${i}`,
          },
        })
      )
    );
    for (const r of dlvCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const dlvNums = dlvCalls.map((r) => (r.body.data ?? r.body).externalReference);
    expect(new Set(dlvNums).size).toBe(N);
    for (const n of dlvNums) expect(n).toMatch(/^DLV-\d{4}-\d{6}$/);

    // 6. PURCHASE_ORDER (5 concurrent)
    const poCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/purchasing/orders', {
          method: 'POST',
          token,
          body: {
            legalEntityId,
            supplierId,
            warehouseId: wh1Id,
            orderNumber: `CONC-PO-${i}`,
            lines: [{ itemId, uomId, orderedQty: '5.0000', unitPrice: '20.0000', taxRate: '0.1500' }],
          },
        })
      )
    );
    for (const r of poCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const poNums = poCalls.map((r) => r.body.data.orderNumber);
    expect(new Set(poNums).size).toBe(N);
    for (const n of poNums) expect(n).toMatch(/^PO-\d{4}-\d{6}$/);

    // 7. GOODS_RECEIPT (5 concurrent, each against its own PO)
    const grnCalls = await Promise.all(
      poCalls.map((p, i) =>
        apiCall('/purchasing/receipts', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-grn-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            purchaseOrderId: p.body.data.id,
            supplierId,
            warehouseId: wh1Id,
            receiptNumber: `CONC-GRN-${i}`,
            lines: [{ itemId, uomId, receivedQty: '5.0000', unitCost: '20.0000' }],
          },
        })
      )
    );
    for (const r of grnCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const grnNums = grnCalls.map((r) => r.body.data.receiptNumber);
    expect(new Set(grnNums).size).toBe(N);
    for (const n of grnNums) expect(n).toMatch(/^GRN-\d{4}-\d{6}$/);

    // 8. PURCHASE_INVOICE (5 concurrent)
    const sinvCalls = await Promise.all(
      grnCalls.map((g, i) =>
        apiCall('/purchasing/invoices', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-sinv-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            supplierId,
            purchaseOrderId: poCalls[i]!.body.data.id,
            goodsReceiptId: g.body.data.id,
            invoiceNumber: `VEND-CONC-${i}`,
            invoiceDate: new Date().toISOString(),
            dueDate,
            lines: [{ itemId, quantity: '5.0000', unitPrice: '20.0000', taxRate: '0.1500' }],
          },
        })
      )
    );
    for (const r of sinvCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const sinvNums = sinvCalls.map((r) => r.body.data.invoiceNumber);
    expect(new Set(sinvNums).size).toBe(N);
    for (const n of sinvNums) expect(n).toMatch(/^SINV-\d{4}-\d{6}$/);

    // 9. DEBIT_NOTE (5 concurrent purchase returns)
    const dnCalls = await Promise.all(
      grnCalls.map((g, i) =>
        apiCall('/purchasing/returns', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-dn-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            supplierId,
            goodsReceiptId: g.body.data.id,
            warehouseId: wh1Id,
            returnNumber: `CONC-DN-${i}`,
            reason: `مرتجع مورد متزامن ${i}`,
            lines: [{ itemId, quantity: '1.0000', unitCost: '20.0000' }],
          },
        })
      )
    );
    for (const r of dnCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const dnNums = dnCalls.map((r) => r.body.data.returnNumber);
    expect(new Set(dnNums).size).toBe(N);
    for (const n of dnNums) expect(n).toMatch(/^DN-\d{4}-\d{6}$/);
  }, 420000);

  it('Point 2B: Directly concurrency-tests Accounting & Inventory paths (5 paths x 5x parallel) with zero duplicates', async () => {
    const N = 5;

    // 10. JOURNAL_ENTRY (5 concurrent)
    const jvCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/accounting/journal-entries', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-jv-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            branchId,
            journalNumber: `CONC-JV-${i}`,
            journalType: 'GENERAL',
            description: `قيد متزامن ${i}`,
            lines: [
              { accountId: cashAccId, debit: '10.0000', credit: '0.0000' },
              { accountId: salesAccId, debit: '0.0000', credit: '10.0000' },
            ],
          },
        })
      )
    );
    for (const r of jvCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const jvNums = jvCalls.map((r) => r.body.data.journalNumber);
    expect(new Set(jvNums).size).toBe(N);
    for (const n of jvNums) expect(n).toMatch(/^JV-\d{4}-\d{6}$/);

    // 11. RECEIPT (5 concurrent receipt vouchers)
    const rcpCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/accounting/receipt-vouchers', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-rcp-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            branchId,
            voucherNumber: `CONC-RCP-${i}`,
            destinationType: 'VAULT',
            destinationId: vaultId,
            payerType: 'OTHER',
            payerName: `دافع متزامن ${i}`,
            accountId: salesAccId,
            amount: '15.0000',
            description: `سند قبض متزامن ${i}`,
          },
        })
      )
    );
    for (const r of rcpCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rcpNums = rcpCalls.map((r) => r.body.data.voucherNumber);
    expect(new Set(rcpNums).size).toBe(N);
    for (const n of rcpNums) expect(n).toMatch(/^RCP-\d{4}-\d{6}$/);

    // 12. PAYMENT (5 concurrent payment vouchers)
    const payCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/accounting/payment-vouchers', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-pay-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            branchId,
            voucherNumber: `CONC-PAY-${i}`,
            sourceType: 'VAULT',
            sourceId: vaultId,
            beneficiaryType: 'OTHER',
            beneficiaryName: `مستفيد متزامن ${i}`,
            accountId: expenseAccId,
            amount: '12.0000',
            description: `سند صرف متزامن ${i}`,
          },
        })
      )
    );
    for (const r of payCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const payNums = payCalls.map((r) => r.body.data.voucherNumber);
    expect(new Set(payNums).size).toBe(N);
    for (const n of payNums) expect(n).toMatch(/^PAY-\d{4}-\d{6}$/);

    // 13. STOCK_TRANSFER (5 concurrent)
    const trnCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/inventory/transfers', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-trn-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            sourceWarehouseId: wh1Id,
            destinationWarehouseId: wh2Id,
            transferNumber: `CONC-TRN-${i}`,
            lines: [{ itemId, uomId, quantity: '1.0000' }],
          },
        })
      )
    );
    for (const r of trnCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const trnNums = trnCalls.map((r) => r.body.data.transferNumber);
    expect(new Set(trnNums).size).toBe(N);
    for (const n of trnNums) expect(n).toMatch(/^TRN-\d{4}-\d{6}$/);

    // 14. STOCK_ADJUSTMENT (5 concurrent)
    const adjCalls = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        apiCall('/inventory/adjustments', {
          method: 'POST',
          token,
          headers: { 'Idempotency-Key': `conc-adj-${uniqueSuffix}-${i}` },
          body: {
            legalEntityId,
            warehouseId: wh1Id,
            adjustmentNumber: `CONC-ADJ-${i}`,
            reason: 'PHYSICAL_COUNT',
            lines: [{ itemId, uomId, countedQuantity: String(490 - i) + '.0000' }],
          },
        })
      )
    );
    for (const r of adjCalls) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const adjNums = adjCalls.map((r) => r.body.data.adjustmentNumber);
    expect(new Set(adjNums).size).toBe(N);
    for (const n of adjNums) expect(n).toMatch(/^ADJ-\d{4}-\d{6}$/);
  }, 300000);
});
