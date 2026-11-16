import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
// Import compiled NestJS modules from dist/ so TypeScript emitDecoratorMetadata is preserved under Vitest
// (Vitest's esbuild transformer strips design:paramtypes metadata).
// Run `pnpm --filter @restaurant-cloud/api build` before running this suite if src/ changed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../dist/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GlobalExceptionFilter } = require('../dist/common/filters/global-exception.filter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseService } = require('../dist/database/database.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CryptoUtil } = require('../dist/modules/iam/crypto.util');
import { AccountType, NormalBalance } from '@restaurant-cloud/domain-kernel';
import {
  tenants,
  legalEntities,
  branches,
  devices,
  warehouses,
  users,
  roles,
  permissions,
  rolePermissions,
  userMemberships,
  membershipScopes,
  chartOfAccounts,
  accountMappings,
  cashVaults,
  fiscalYears,
  fiscalPeriods,
  items,
  categories,
  unitsOfMeasure,
  suppliers,
  salesOrders,
  salesOrderLines,
  posShifts,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceipts,
  goodsReceiptLines,
  supplierInvoices,
  supplierInvoiceLines,
} from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';

describe('Restaurant Cloud — HTTP E2E Critical User Journeys (Fastify app.inject)', { timeout: 120000 }, () => {
  let app: NestFastifyApplication;
  let dbService: any;

  const suffix = Date.now();
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leAId = randomUUID();
  const leBId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const warehouseAId = randomUUID();
  let deviceAId = '';
  let vaultAId = '';
  const userAId = randomUUID();
  const userBId = randomUUID();
  const roleAId = randomUUID();
  const roleBId = randomUUID();

  const emailA = `e2e-admin-a-${suffix}@restaurant.local`;
  const emailB = `e2e-admin-b-${suffix}@restaurant.local`;
  const passwordPlain = 'E2ePass#2026!';

  let tokenA = '';
  let tokenB = '';

  let categoryId = '';
  let uomId = '';
  let saleItemId = '';
  let rawItemId = '';
  let supplierId = '';
  let poId = '';
  let poLineId = '';
  let grnId = '';
  let shiftId = '';
  let orderId = '';
  let fiscalYearId = '';
  let fiscalPeriodId = '';
  let createdBranchId = '';

  const authHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    const adapter = new FastifyAdapter({ logger: false });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    dbService = app.get(DatabaseService);
    const passwordHash = await CryptoUtil.hashPassword(passwordPlain);

    const allPerms = await dbService.db.select({ id: permissions.id }).from(permissions);

    // Seed Tenant A & Tenant B
    await dbService.db.insert(tenants).values([
      { id: tenantAId, code: `e2e-a-${suffix}`, displayName: 'E2E Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `e2e-b-${suffix}`, displayName: 'E2E Tenant B', status: 'ACTIVE' },
    ]);

    const ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      legalEntityId: leAId,
      branchId: branchAId,
      permissions: ['*'],
    };

    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leAId,
        tenantId: tenantAId,
        legalName: 'E2E Legal Entity A',
        vatNumber: '310111111111113',
      });
      await tx.insert(branches).values({
        id: branchAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        code: `BR-A-${suffix}`,
        name: 'E2E Branch A',
        isActive: true,
      });
      await tx.insert(warehouses).values({
        id: warehouseAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        code: `WH-A-${suffix}`,
        name: 'Warehouse A',
        isActive: true,
      });
      await tx.insert(users).values({
        id: userAId,
        tenantId: tenantAId,
        email: emailA,
        displayName: 'E2E Admin A',
        passwordHash,
        status: 'ACTIVE',
      });
      await tx.insert(roles).values({
        id: roleAId,
        tenantId: tenantAId,
        code: `ADMIN_A_${suffix}`,
        name: `ADMIN_A_${suffix}`,
      });
      if (allPerms.length > 0) {
        await tx.insert(rolePermissions).values(
          allPerms.map((p) => ({
            id: randomUUID(),
            roleId: roleAId,
            permissionId: p.id,
          })),
        );
      }
      const membershipAId = randomUUID();
      await tx.insert(userMemberships).values({
        id: membershipAId,
        tenantId: tenantAId,
        userId: userAId,
        roleId: roleAId,
        status: 'ACTIVE',
      });
      await tx.insert(membershipScopes).values({
        id: randomUUID(),
        tenantId: tenantAId,
        membershipId: membershipAId,
        scopeType: 'TENANT',
        scopeId: tenantAId,
      });

      const vaultAccId = randomUUID();
      const apAccId = randomUUID();
      await tx.insert(chartOfAccounts).values([
        {
          id: vaultAccId,
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '111100',
          name: 'نقدية الصندوق والخزينة',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          isPostable: true,
        },
        {
          id: randomUUID(),
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '112000',
          name: 'مخزون المواد الغذائية',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          isPostable: true,
        },
        {
          id: apAccId,
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '211100',
          name: 'ذمم الموردين الدائنة',
          accountType: AccountType.LIABILITY,
          normalBalance: NormalBalance.CREDIT,
          isPostable: true,
        },
        {
          id: randomUUID(),
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '211200',
          name: 'ضريبة القيمة المضافة المستحقة (مخرجات)',
          accountType: AccountType.LIABILITY,
          normalBalance: NormalBalance.CREDIT,
          isPostable: true,
        },
        {
          id: randomUUID(),
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '114200',
          name: 'ضريبة القيمة المضافة (مدخلات)',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          isPostable: true,
        },
        {
          id: randomUUID(),
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '411000',
          name: 'إيراد المبيعات',
          accountType: AccountType.REVENUE,
          normalBalance: NormalBalance.CREDIT,
          isPostable: true,
        },
        {
          id: randomUUID(),
          tenantId: tenantAId,
          legalEntityId: leAId,
          accountCode: '511000',
          name: 'تكلفة البضاعة المباعة',
          accountType: AccountType.COGS,
          normalBalance: NormalBalance.DEBIT,
          isPostable: true,
        },
      ]);

      vaultAId = randomUUID();
      await tx.insert(cashVaults).values({
        id: vaultAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        code: `VLT-A-${suffix}`,
        nameAr: 'خزينة الكاشير A',
        nameEn: 'Cashier Vault A',
        vaultType: 'POS_CASH_DRAWER',
        accountId: vaultAccId,
        balance: '0.0000',
        isActive: true,
      });

      deviceAId = randomUUID();
      await tx.insert(devices).values({
        id: deviceAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        branchId: branchAId,
        deviceCode: `POS-A-${suffix}`,
        name: 'POS Device A',
        deviceType: 'POS',
        cashVaultId: vaultAId,
        status: 'ACTIVE',
      });

      await tx.insert(accountMappings).values({
        id: randomUUID(),
        tenantId: tenantAId,
        legalEntityId: leAId,
        mappingKey: 'ACCOUNTS_PAYABLE',
        accountId: apAccId,
        isActive: true,
      });
    });

    const ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leBId,
      branchId: branchBId,
      permissions: ['*'],
    };

    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leBId,
        tenantId: tenantBId,
        legalName: 'E2E Legal Entity B',
        vatNumber: '310222222222223',
      });
      await tx.insert(branches).values({
        id: branchBId,
        tenantId: tenantBId,
        legalEntityId: leBId,
        code: `BR-B-${suffix}`,
        name: 'E2E Branch B',
        isActive: true,
      });
      await tx.insert(users).values({
        id: userBId,
        tenantId: tenantBId,
        email: emailB,
        displayName: 'E2E Admin B',
        passwordHash,
        status: 'ACTIVE',
      });
      await tx.insert(roles).values({
        id: roleBId,
        tenantId: tenantBId,
        code: `ADMIN_B_${suffix}`,
        name: `ADMIN_B_${suffix}`,
      });
      if (allPerms.length > 0) {
        await tx.insert(rolePermissions).values(
          allPerms.map((p) => ({
            id: randomUUID(),
            roleId: roleBId,
            permissionId: p.id,
          })),
        );
      }
      const membershipBId = randomUUID();
      await tx.insert(userMemberships).values({
        id: membershipBId,
        tenantId: tenantBId,
        userId: userBId,
        roleId: roleBId,
        status: 'ACTIVE',
      });
      await tx.insert(membershipScopes).values({
        id: randomUUID(),
        tenantId: tenantBId,
        membershipId: membershipBId,
        scopeType: 'TENANT',
        scopeId: tenantBId,
      });
    });
  }, 120000);

  afterAll(async () => {
    try {
      const safeDelete = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch {
          // Ignore immutable/append-only table restrictions during test teardown
        }
      };

      const cleanupTenant = async (tid: string, uid: string, lid: string, bid: string) => {
        const ctx = { tenantId: tid, userId: uid, legalEntityId: lid, branchId: bid, permissions: ['*'] };
        await safeDelete(() =>
          dbService.withTenantContext(ctx, async (tx) => {
            await tx.delete(fiscalPeriods).where(eq(fiscalPeriods.tenantId, tid));
            await tx.delete(fiscalYears).where(eq(fiscalYears.tenantId, tid));
            await tx.delete(salesOrderLines).where(eq(salesOrderLines.tenantId, tid));
            await tx.delete(salesOrders).where(eq(salesOrders.tenantId, tid));
            await tx.delete(posShifts).where(eq(posShifts.tenantId, tid));
            await tx.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.tenantId, tid));
            await tx.delete(supplierInvoices).where(eq(supplierInvoices.tenantId, tid));
            await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.tenantId, tid));
            await tx.delete(goodsReceipts).where(eq(goodsReceipts.tenantId, tid));
            await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, tid));
            await tx.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, tid));
            await tx.delete(suppliers).where(eq(suppliers.tenantId, tid));
            await tx.delete(items).where(eq(items.tenantId, tid));
            await tx.delete(categories).where(eq(categories.tenantId, tid));
            await tx.delete(unitsOfMeasure).where(eq(unitsOfMeasure.tenantId, tid));
            await tx.delete(devices).where(eq(devices.tenantId, tid));
            await tx.delete(cashVaults).where(eq(cashVaults.tenantId, tid));
            await tx.delete(accountMappings).where(eq(accountMappings.tenantId, tid));
            await tx.delete(warehouses).where(eq(warehouses.tenantId, tid));
            await tx.delete(branches).where(eq(branches.tenantId, tid));
            await tx.delete(legalEntities).where(eq(legalEntities.tenantId, tid));
            await tx.delete(membershipScopes).where(eq(membershipScopes.tenantId, tid));
            await tx.delete(userMemberships).where(eq(userMemberships.tenantId, tid));
            await tx.delete(roles).where(eq(roles.tenantId, tid));
            await tx.delete(users).where(eq(users.tenantId, tid));
          }),
        );
      };

      await cleanupTenant(tenantAId, userAId, leAId, branchAId);
      await cleanupTenant(tenantBId, userBId, leBId, branchBId);
      await safeDelete(() => dbService.db.delete(tenants).where(eq(tenants.id, tenantAId)));
      await safeDelete(() => dbService.db.delete(tenants).where(eq(tenants.id, tenantBId)));
    } finally {
      await app.close();
    }
  }, 120000);

  it('1. Login & Session: authenticates Tenant A & B via /api/v1/auth/login and rejects bad credentials', async () => {
    const badRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailA, password: 'WrongPassword!' },
    });
    expect(badRes.statusCode).toBe(401);

    const loginARes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailA, password: passwordPlain },
    });
    expect(loginARes.statusCode).toBe(201);
    const bodyA = loginARes.json();
    expect(bodyA.success).toBe(true);
    expect(bodyA.data.token).toBeTruthy();
    tokenA = bodyA.data.token;

    const loginBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailB, password: passwordPlain },
    });
    expect(loginBRes.statusCode).toBe(201);
    tokenB = loginBRes.json().data.token;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(tokenA),
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data.user.email).toBe(emailA);

    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(unauthRes.statusCode).toBe(401);
  });

  it('2. Tenant & Branch Hierarchy: lists legal entities, creates a branch, and retrieves it', async () => {
    const leRes = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: authHeaders(tokenA),
    });
    expect(leRes.statusCode).toBe(200);
    const entities = leRes.json().data;
    expect(entities.some((e: any) => e.id === leAId)).toBe(true);

    const createBrRes = await app.inject({
      method: 'POST',
      url: '/api/v1/branches',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        code: `BR-NEW-${suffix}`,
        name: 'E2E New Branch',
      },
    });
    expect(createBrRes.statusCode).toBe(201);
    createdBranchId = createBrRes.json().data.id;

    const getBrRes = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${createdBranchId}`,
      headers: authHeaders(tokenA),
    });
    expect(getBrRes.statusCode).toBe(200);
    expect(getBrRes.json().data.name).toBe('E2E New Branch');
  });

  it('3. Catalog Management: creates category, UOM, saleable & raw items, and updates price', async () => {
    const catRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/categories',
      headers: authHeaders(tokenA),
      payload: {
        code: `CAT-${suffix}`,
        nameAr: 'مشروبات',
        nameEn: 'Beverages',
      },
    });
    expect(catRes.statusCode).toBe(201);
    categoryId = catRes.json().data.id;

    const uomRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/uom',
      headers: authHeaders(tokenA),
      payload: {
        code: `PCS-${suffix}`.slice(0, 20),
        nameAr: 'حبة',
        nameEn: 'Piece',
      },
    });
    expect(uomRes.statusCode).toBe(201);
    uomId = uomRes.json().data.id;

    const saleItemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/items',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityOwnerId: leAId,
        categoryId,
        baseUomId: uomId,
        sku: `SKU-SALE-${suffix}`,
        nameAr: 'عصير برتقال',
        nameEn: 'Orange Juice',
        productType: 'SALEABLE',
        defaultCost: '5.0000',
        defaultPrice: '15.0000',
        taxRate: '0.1500',
        isSold: true,
        isPurchased: false,
      },
    });
    expect(saleItemRes.statusCode).toBe(201);
    saleItemId = saleItemRes.json().data.id;

    const rawItemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/items',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityOwnerId: leAId,
        categoryId,
        baseUomId: uomId,
        sku: `SKU-RAW-${suffix}`,
        nameAr: 'برتقال طازج',
        nameEn: 'Fresh Oranges',
        productType: 'RAW_MATERIAL',
        defaultCost: '4.0000',
        defaultPrice: '0.0000',
        taxRate: '0.1500',
        isSold: false,
        isPurchased: true,
      },
    });
    expect(rawItemRes.statusCode).toBe(201);
    rawItemId = rawItemRes.json().data.id;

    const priceRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/catalog/items/${saleItemId}/price`,
      headers: authHeaders(tokenA),
      payload: { defaultPrice: '18.0000', reason: 'E2E Price Update' },
    });
    expect(priceRes.statusCode).toBe(200);
    expect(Number(priceRes.json().data.defaultPrice)).toBe(18);
  });

  it('4. Purchasing Lifecycle: supplier -> PO -> approve -> GRN -> supplier invoice', async () => {
    const supRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/suppliers',
      headers: authHeaders(tokenA),
      payload: {
        code: `SUP-${suffix}`,
        name: 'Fresh Fruits Supplier',
      },
    });
    expect(supRes.statusCode).toBe(201);
    supplierId = supRes.json().data.id;

    const poRes = await app.inject({
      method: 'POST',
      url: '/api/v1/purchasing/orders',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        supplierId,
        warehouseId: warehouseAId,
        orderNumber: `PO-E2E-${suffix}`,
        currency: 'SAR',
        submitAsDraft: true,
        lines: [
          {
            itemId: rawItemId,
            uomId,
            orderedQty: '10.0000',
            unitPrice: '4.0000',
            taxRate: '0.1500',
          },
        ],
      },
    });
    expect(poRes.statusCode).toBe(201);
    poId = poRes.json().data.id;
    poLineId = poRes.json().data.lines[0].id;

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/purchasing/orders/${poId}/approve`,
      headers: authHeaders(tokenA),
      payload: {},
    });
    expect(approveRes.statusCode).toBe(201);

    const grnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/purchasing/receipts',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        purchaseOrderId: poId,
        supplierId,
        warehouseId: warehouseAId,
        receiptNumber: `GRN-E2E-${suffix}`,
        lines: [
          {
            purchaseOrderLineId: poLineId,
            itemId: rawItemId,
            uomId,
            receivedQty: '10.0000',
            unitCost: '4.0000',
          },
        ],
      },
    });
    expect(grnRes.statusCode).toBe(201);
    grnId = grnRes.json().data.id;

    const nowIso = new Date().toISOString();
    const invRes = await app.inject({
      method: 'POST',
      url: '/api/v1/purchasing/invoices',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        supplierId,
        purchaseOrderId: poId,
        goodsReceiptId: grnId,
        invoiceNumber: `SINV-E2E-${suffix}`,
        invoiceDate: nowIso,
        dueDate: nowIso,
        currency: 'SAR',
        lines: [
          {
            itemId: rawItemId,
            quantity: '10.0000',
            unitPrice: '4.0000',
            taxRate: '0.1500',
          },
        ],
      },
    });
    expect(invRes.statusCode, JSON.stringify(invRes.json())).toBe(201);
  });

  it('5. Sales & Refund Lifecycle: open POS shift -> create paid order -> partial/full refund', async () => {
    const shiftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/shifts/open',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        branchId: branchAId,
        deviceId: deviceAId,
        openingCash: '500.0000',
      },
    });
    expect(shiftRes.statusCode).toBe(201);
    shiftId = shiftRes.json().data.id;

    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/orders',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        branchId: branchAId,
        deviceId: deviceAId,
        warehouseId: warehouseAId,
        shiftId,
        orderNumber: `ORD-E2E-${suffix}`,
        orderType: 'TAKEAWAY',
        channel: 'POS',
        lines: [
          {
            itemId: saleItemId,
            uomId,
            quantity: '2.0000',
            unitPrice: '18.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: 'CASH',
            amount: '41.4000',
          },
        ],
      },
    });
    expect(orderRes.statusCode).toBe(201);
    orderId = orderRes.json().data.id;

    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/orders/${orderId}/refund`,
      headers: authHeaders(tokenA),
      payload: {
        refundAmount: '20.7000',
        reason: 'E2E Customer Return',
        refundMethod: 'CASH',
        restockInventory: false,
        idempotencyKey: `refund-e2e-${suffix}`,
      },
    });
    expect(refundRes.statusCode).toBe(201);
  });

  it('6. Period Closing Engine: creates fiscal year, lists periods, and runs pre-closing checks', async () => {
    const yearCode = `FY-${String(suffix).slice(-6)}`;
    const fyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounting/fiscal-years',
      headers: authHeaders(tokenA),
      payload: {
        legalEntityId: leAId,
        yearCode,
        yearName: `Fiscal Year ${yearCode}`,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        generateMonthlyPeriods: true,
      },
    });
    expect(fyRes.statusCode).toBe(201);
    fiscalYearId = fyRes.json().data.fiscalYear.id;

    const periodsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/accounting/fiscal-periods?legalEntityId=${leAId}&fiscalYearId=${fiscalYearId}`,
      headers: authHeaders(tokenA),
    });
    expect(periodsRes.statusCode).toBe(200);
    const periodsPayload = periodsRes.json().data;
    const periodsList = Array.isArray(periodsPayload) ? periodsPayload : periodsPayload?.data || [];
    expect(periodsList.length).toBeGreaterThanOrEqual(1);
    fiscalPeriodId = periodsList[0].id;

    const preCheckRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounting/fiscal-periods/${fiscalPeriodId}/pre-check`,
      headers: authHeaders(tokenA),
      payload: {},
    });
    expect(preCheckRes.statusCode).toBe(201);
    expect(preCheckRes.json().data).toHaveProperty('checks');
  });

  it('7. Multi-Tenant Isolation (BOLA/IDOR Defense): Tenant B cannot read or mutate Tenant A resources', async () => {
    const crossBranchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${createdBranchId}`,
      headers: authHeaders(tokenB),
    });
    expect([403, 404]).toContain(crossBranchRes.statusCode);

    const crossItemRes = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/items/${saleItemId}`,
      headers: authHeaders(tokenB),
    });
    expect([403, 404]).toContain(crossItemRes.statusCode);

    const crossPeriodCheckRes = await app.inject({
      method: 'POST',
      url: `/api/v1/accounting/fiscal-periods/${fiscalPeriodId}/pre-check`,
      headers: authHeaders(tokenB),
      payload: {},
    });
    expect([403, 404]).toContain(crossPeriodCheckRes.statusCode);

    const crossItemsListRes = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/items',
      headers: authHeaders(tokenB),
    });
    expect(crossItemsListRes.statusCode).toBe(200);
    const itemsB = crossItemsListRes.json().data?.items || crossItemsListRes.json().data || [];
    expect(itemsB.some((i: any) => i.id === saleItemId)).toBe(false);
  });
});
