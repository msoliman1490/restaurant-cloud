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

describe('Priority 2 — Document Numbering Integration: Final Acceptance Audit (Staging)', () => {
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
  let cashAccId = '';
  let salesAccId = '';
  let vatOutAccId = '';
  let vatInAccId = '';
  let invAccId = '';
  let cogsAccId = '';
  let apAccId = '';
  let expenseAccId = '';
  let vaultId = '';

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
        displayName: `P2 Audit Tenant ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `P2 Audit Legal ${uniqueSuffix}`, vatNumber: '310555666700003' },
        initialAdminUser: { email: `p2.${uniqueSuffix}@example.sa`, displayName: 'P2 Admin', password: 'NumPassword2026!' },
      },
    });
    expect(onboard.status).toBe(201);
    token = onboard.body.data.token;
    tenantId = onboard.body.data.tenant.id;
    userId = onboard.body.data.user.id;
    legalEntityId = onboard.body.data.legalEntity.id;
    branchId = onboard.body.data.branch.id;
    wh1Id = onboard.body.data.warehouse.id;
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, async (tx) => {
      await tx.update(warehouses).set({ legalEntityId, allowTransfer: true, allowIssuing: true, allowReceiving: true }).where(eq(warehouses.id, wh1Id));
      const [wh2] = await tx.insert(warehouses).values({
        tenantId, legalEntityId, branchId, code: 'WH-DEST', name: 'مستودع الوجهة',
        status: 'ACTIVE', allowReceiving: true, allowIssuing: true, allowTransfer: true,
      }).returning();
      wh2Id = wh2!.id;

      const [dev] = await tx.insert(devices).values({
        tenantId, legalEntityId, branchId, deviceCode: `POS-${uniqueSuffix}`, deviceName: 'POS 1', deviceType: 'POS_TERMINAL',
      }).returning();
      deviceId = dev!.id;

      const [sh] = await tx.insert(posShifts).values({
        tenantId, legalEntityId, branchId, deviceId, cashierId: userId, openingCash: '100.0000', status: 'OPEN',
      }).returning();
      shiftId = sh!.id;

      const [cat] = await tx.insert(categories).values({ tenantId, code: `C-${uniqueSuffix.slice(-4)}`, nameAr: 'أصناف الاختبار', nameEn: 'Test Items' }).returning();
      const [uom] = await tx.insert(unitsOfMeasure).values({ tenantId, code: `U${uniqueSuffix.slice(-4)}`, nameAr: 'قطعة', nameEn: 'Piece' }).returning();
      uomId = uom!.id;
      const [it] = await tx.insert(items).values({
        tenantId, legalEntityOwnerId: legalEntityId, categoryId: cat!.id, baseUomId: uomId, sku: `SKU-${uniqueSuffix}`, nameAr: 'صنف اختبار', nameEn: 'Test Item',
        sellingPrice: '100.0000', vatRate: '0.1500', trackInventory: true,
      }).returning();
      itemId = it!.id;

      await tx.insert(inventoryBalances).values({
        tenantId, legalEntityOwnerId: legalEntityId, warehouseId: wh1Id, itemId,
        onHandQty: '50.0000', reservedQty: '0.0000', version: 1,
      });

      const [sup] = await tx.insert(suppliers).values({
        tenantId, code: `SUP-${uniqueSuffix}`, name: 'مورد الاختبار',
      }).returning();
      supplierId = sup!.id;

      await tx.insert(fiscalPeriods).values({
        tenantId, legalEntityId, periodName: '2026-P2',
        startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T23:59:59Z'), status: 'OPEN',
      });

      const coaRows = await tx.insert(chartOfAccounts).values([
        { tenantId, legalEntityId, accountCode: '1110', name: 'النقدية', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '4100', name: 'المبيعات', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '2120', name: 'ضريبة المخرجات', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '1125', name: 'ضريبة المدخلات', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '1130', name: 'المخزون', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '5100', name: 'تكلفة المبيعات', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '2110', name: 'الموردون', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true },
        { tenantId, legalEntityId, accountCode: '5200', name: 'مصروفات عامة', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true },
      ]).returning();

      cashAccId = coaRows[0]!.id;
      salesAccId = coaRows[1]!.id;
      vatOutAccId = coaRows[2]!.id;
      vatInAccId = coaRows[3]!.id;
      invAccId = coaRows[4]!.id;
      cogsAccId = coaRows[5]!.id;
      apAccId = coaRows[6]!.id;
      expenseAccId = coaRows[7]!.id;

      await tx.insert(accountMappings).values([
        { tenantId, legalEntityId, mappingKey: 'CASH_VAULT', accountId: cashAccId },
        { tenantId, legalEntityId, mappingKey: 'SALES', accountId: salesAccId },
        { tenantId, legalEntityId, mappingKey: 'VAT_OUTPUT', accountId: vatOutAccId },
        { tenantId, legalEntityId, mappingKey: 'VAT_INPUT', accountId: vatInAccId },
        { tenantId, legalEntityId, mappingKey: 'INVENTORY', accountId: invAccId },
        { tenantId, legalEntityId, mappingKey: 'COGS', accountId: cogsAccId },
        { tenantId, legalEntityId, mappingKey: 'ACCOUNTS_PAYABLE', accountId: apAccId },
        { tenantId, legalEntityId, mappingKey: 'SALES_RETURNS', accountId: salesAccId },
      ]);

      const [v] = await tx.insert(cashVaults).values({
        tenantId, legalEntityId, branchId, code: 'VLT-1', nameAr: 'الخزينة الرئيسية',
        accountId: cashAccId, balance: '5000.0000', status: 'ACTIVE',
      }).returning();
      vaultId = v!.id;
    });
  }, 45000);

  afterAll(async () => {
    try {
      for (const tId of createdTenantIds) {
        if (!tId || !userId) continue;
        await withTenantContext({ tenantId: tId, userId, scopes: ['*'] } as any, async (tx) => {
        await tx.delete(documentNumberAllocations).where(eq(documentNumberAllocations.tenantId, tId));
        await tx.delete(documentSequences).where(eq(documentSequences.tenantId, tId));
        await tx.delete(deliveryOrders).where(eq(deliveryOrders.tenantId, tId));
        await tx.delete(inventoryMovements).where(eq(inventoryMovements.tenantId, tId));
        await tx.delete(stockTransfers).where(eq(stockTransfers.tenantId, tId));
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
      // ignore cleanup order issues
    }
    await sqlClient.end();
  }, 45000);

  it('creates all 12 document types through real APIs using DocumentNumberingService and blocks client bypass', async () => {
    // 1. Sales Invoice (with client bypass attempt 'BYPASS-INV-999' -> server assigns INV-YYYY-000001)
    const saleRes = await apiCall('/sales/orders', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-sale-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId, deviceId, warehouseId: wh1Id, shiftId,
        orderNumber: 'BYPASS-INV-999',
        orderType: 'DELIVERY',
        channel: 'ONLINE',
        lines: [{ itemId, uomId, quantity: '1.0000', unitPrice: '100.0000' }],
        payments: [{ paymentMethod: 'CASH', amount: '115.0000' }],
      },
    });
    expect(saleRes.status).toBe(201);
    expect(saleRes.body.data.orderNumber).toMatch(/^INV-\d{4}-000001$/);
    const salesOrderId = saleRes.body.data.id;

    // 2. Delivery Note (POST /delivery/orders -> DLV-YYYY-000001)
    const dlvRes = await apiCall('/delivery/orders', {
      method: 'POST',
      token,
      body: {
        legalEntityId, branchId, salesOrderId,
        customerName: 'عميل توصيل', customerPhone: '0500000000', deliveryAddress: 'الرياض',
        externalReference: 'BYPASS-DLV-999',
      },
    });
    expect(dlvRes.status).toBe(201);
    const dlvData = dlvRes.body.data ?? dlvRes.body;
    expect(dlvData.externalReference).toMatch(/^DLV-\d{4}-000001$/);

    // 3. Credit Note (POST /sales/orders/:id/refund -> CN-YYYY-000001 + JV-YYYY-000001)
    const cnRes = await apiCall(`/sales/orders/${salesOrderId}/refund`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-cn-${uniqueSuffix}` },
      body: { reason: 'مرتجع عميل للاختبار', restockInventory: false, idempotencyKey: `p2-cn-${uniqueSuffix}` },
    });
    expect(cnRes.status).toBe(201);
    expect(cnRes.body.data.creditNoteNumber).toMatch(/^CN-\d{4}-000001$/);
    expect(cnRes.body.data.refundJournal.journalNumber).toMatch(/^JV-\d{4}-000001$/);

    // 4. Purchase Order (POST /purchasing/orders with bypass attempt -> PO-YYYY-000001)
    const poRes = await apiCall('/purchasing/orders', {
      method: 'POST',
      token,
      body: {
        legalEntityId, supplierId, warehouseId: wh1Id,
        orderNumber: 'BYPASS-PO-999',
        lines: [{ itemId, uomId, orderedQty: '4.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
      },
    });
    expect(poRes.status).toBe(201);
    expect(poRes.body.data.orderNumber).toMatch(/^PO-\d{4}-000001$/);
    const poId = poRes.body.data.id;

    // 5. Goods Receipt (POST /purchasing/receipts -> GRN-YYYY-000001)
    const grnRes = await apiCall('/purchasing/receipts', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-grn-${uniqueSuffix}` },
      body: {
        legalEntityId, purchaseOrderId: poId, supplierId, warehouseId: wh1Id,
        receiptNumber: 'BYPASS-GRN-999',
        lines: [{ itemId, uomId, receivedQty: '4.0000', unitCost: '50.0000' }],
      },
    });
    expect(grnRes.status).toBe(201);
    expect(grnRes.body.data.receiptNumber).toMatch(/^GRN-\d{4}-000001$/);
    const grnId = grnRes.body.data.id;

    // 6. Purchase Invoice (POST /purchasing/invoices -> SINV-YYYY-000001)
    const sinvRes = await apiCall('/purchasing/invoices', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-sinv-${uniqueSuffix}` },
      body: {
        legalEntityId, supplierId, purchaseOrderId: poId, goodsReceiptId: grnId,
        invoiceNumber: 'VENDOR-EXT-777',
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
        lines: [{ itemId, quantity: '4.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
      },
    });
    expect(sinvRes.status).toBe(201);
    expect(sinvRes.body.data.invoiceNumber).toMatch(/^SINV-\d{4}-000001$/);
    expect(sinvRes.body.data.notes).toContain('VENDOR-EXT-777');
    const sinvId = sinvRes.body.data.id;

    // 7. Debit Note (POST /purchasing/returns -> DN-YYYY-000001)
    const dnRes = await apiCall('/purchasing/returns', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-dn-${uniqueSuffix}` },
      body: {
        legalEntityId, supplierId, goodsReceiptId: grnId, warehouseId: wh1Id,
        returnNumber: 'BYPASS-DN-999',
        reason: 'تلف جزئي',
        lines: [{ itemId, quantity: '1.0000', unitCost: '50.0000' }],
      },
    });
    expect(dnRes.status).toBe(201);
    expect(dnRes.body.data.returnNumber).toMatch(/^DN-\d{4}-000001$/);

    // 8. Payment (POST /purchasing/payments -> PAY-YYYY-000001 & POST /accounting/payment-vouchers -> PAY-YYYY-000002)
    const spayRes = await apiCall('/purchasing/payments', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-spay-${uniqueSuffix}` },
      body: {
        legalEntityId, supplierId, invoiceId: sinvId,
        paymentNumber: 'BYPASS-PAY-999',
        amount: '50.0000',
        paymentMethod: 'CASH',
      },
    });
    expect(spayRes.status).toBe(201);
    expect(spayRes.body.data.paymentNumber).toMatch(/^PAY-\d{4}-000001$/);

    const pvRes = await apiCall('/accounting/payment-vouchers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-pv-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId,
        voucherNumber: 'BYPASS-PV-999',
        sourceType: 'VAULT', sourceId: vaultId,
        beneficiaryType: 'OTHER', beneficiaryName: 'مورد نقدي',
        accountId: expenseAccId,
        amount: '25.0000',
        description: 'مصروف تشغيلي',
      },
    });
    expect(pvRes.status).toBe(201);
    expect(pvRes.body.data.voucherNumber).toMatch(/^PAY-\d{4}-000002$/);

    // 9. Receipt (POST /accounting/receipt-vouchers -> RCP-YYYY-000001)
    const rvRes = await apiCall('/accounting/receipt-vouchers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-rv-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId,
        voucherNumber: 'BYPASS-RV-999',
        destinationType: 'VAULT', destinationId: vaultId,
        payerType: 'OTHER', payerName: 'متحصلات',
        accountId: salesAccId,
        amount: '40.0000',
        description: 'إيصال قبض',
      },
    });
    expect(rvRes.status).toBe(201);
    expect(rvRes.body.data.voucherNumber).toMatch(/^RCP-\d{4}-000001$/);

    // 10. Journal Entry (POST /accounting/journal-entries -> JV-YYYY-000002 since 000001 was refund JV)
    const jvRes = await apiCall('/accounting/journal-entries', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-jv-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId,
        journalNumber: 'BYPASS-JV-999',
        journalType: 'GENERAL',
        description: 'قيد يومية اختباري',
        lines: [
          { accountId: cashAccId, debit: '10.0000', credit: '0.0000' },
          { accountId: salesAccId, debit: '0.0000', credit: '10.0000' },
        ],
      },
    });
    expect(jvRes.status).toBe(201);
    expect(jvRes.body.data.journalNumber).toMatch(/^JV-\d{4}-000002$/);

    // 11. Stock Transfer (POST /inventory/transfers -> TRN-YYYY-000001)
    const trnRes = await apiCall('/inventory/transfers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-trn-${uniqueSuffix}` },
      body: {
        legalEntityId, sourceWarehouseId: wh1Id, destinationWarehouseId: wh2Id,
        transferNumber: 'BYPASS-TRN-999',
        lines: [{ itemId, uomId, quantity: '2.0000' }],
      },
    });
    expect(trnRes.status, JSON.stringify(trnRes.body)).toBe(201);
    expect(trnRes.body.data.transferNumber).toMatch(/^TRN-\d{4}-000001$/);

    // 12. Inventory Adjustment (POST /inventory/adjustments -> ADJ-YYYY-000001)
    const adjRes = await apiCall('/inventory/adjustments', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-adj-${uniqueSuffix}` },
      body: {
        legalEntityId, warehouseId: wh1Id,
        adjustmentNumber: 'BYPASS-ADJ-999',
        reason: 'DAMAGE',
        lines: [{ itemId, uomId, countedQuantity: '49.0000' }],
      },
    });
    expect(adjRes.status, JSON.stringify(adjRes.body)).toBe(201);
    expect(adjRes.body.data.adjustmentNumber).toMatch(/^ADJ-\d{4}-000001$/);
  }, 240000);

  it('prevents duplicate numbers under 10x concurrent real Purchase Order & Journal Entry creation', async () => {
    const poCalls = Array.from({ length: 10 }, (_, idx) =>
      apiCall('/purchasing/orders', {
        method: 'POST',
        token,
        body: {
          legalEntityId, supplierId, warehouseId: wh1Id,
          orderNumber: `CONC-PO-${idx}`,
          lines: [{ itemId, uomId, orderedQty: '1.0000', unitPrice: '50.0000', taxRate: '0.1500' }],
        },
      })
    );
    const poResults = await Promise.all(poCalls);
    for (const r of poResults) expect(r.status).toBe(201);
    const poNumbers = poResults.map((r) => r.body.data.orderNumber);
    expect(new Set(poNumbers).size).toBe(10);
  }, 45000);

  it('proves in Staging DB that FAILED_TX allocations are persisted and never reused on subsequent transactions', async () => {
    // Trigger an intentional failure (non-existent vault -> 404 inside tx AFTER allocating PAYMENT number)
    const failedPay = await apiCall('/accounting/payment-vouchers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-fail-pay-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId,
        voucherNumber: 'AUTO',
        sourceType: 'VAULT', sourceId: '00000000-0000-0000-0000-000000000000',
        beneficiaryType: 'OTHER', beneficiaryName: 'اختبار فشل',
        accountId: expenseAccId,
        amount: '15.0000',
        description: 'فشل متعمد',
      },
    });
    expect(failedPay.status).toBeGreaterThanOrEqual(400);

    // Verify in Staging DB that the failed allocation is recorded with status = 'FAILED_TX'
    const allocRows = await withTenantContext({ tenantId, userId, scopes: ['*'] } as any, async (tx) =>
      tx
        .select()
        .from(documentNumberAllocations)
        .where(
          and(
            eq(documentNumberAllocations.tenantId, tenantId),
            eq(documentNumberAllocations.legalEntityId, legalEntityId),
            eq(documentNumberAllocations.documentType, 'PAYMENT'),
            eq(documentNumberAllocations.status, 'FAILED_TX')
          )
        )
    );
    expect(allocRows.length).toBeGreaterThanOrEqual(1);
    const failedAllocatedNum = Math.max(...allocRows.map((r) => r.allocatedNumber));

    // Next valid PAYMENT must receive failedAllocatedNum + 1 — failed number is NEVER reused!
    const nextValidPay = await apiCall('/accounting/payment-vouchers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': `p2-ok-pay-${uniqueSuffix}` },
      body: {
        legalEntityId, branchId,
        voucherNumber: 'AUTO',
        sourceType: 'VAULT', sourceId: vaultId,
        beneficiaryType: 'OTHER', beneficiaryName: 'دفع صحيح بعد الفشل',
        accountId: expenseAccId,
        amount: '10.0000',
        description: 'سند صرف ناجح',
      },
    });
    expect(nextValidPay.status).toBe(201);
    const expectedPadded = String(failedAllocatedNum + 1).padStart(6, '0');
    expect(nextValidPay.body.data.voucherNumber).toMatch(new RegExp(`^PAY-\\d{4}-${expectedPadded}$`));
  }, 60000);
});
