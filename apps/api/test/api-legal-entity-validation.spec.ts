import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
// Load compiled dist modules so NestJS DI has full tsc emitDecoratorMetadata (design:paramtypes)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../dist/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GlobalExceptionFilter } = require('../dist/common/filters/global-exception.filter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TenantService } = require('../dist/modules/tenant/tenant.service');

describe(
  'API LegalEntityId Validation Regression Suite (HTTP 400 vs 500)',
  { timeout: 60000 },
  () => {
    let app: NestFastifyApplication;
    let authToken: string;
    let legalEntityId: string;

    const testTenantCode = `val-${Date.now().toString(36)}`;
    const adminEmail = `val-admin-${Date.now().toString(36)}@rc-staging.local`;

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }

      app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
        { logger: false }
      );
      app.useGlobalFilters(new GlobalExceptionFilter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const tenantService = app.get(TenantService);
      const onboarded = await tenantService.onboardTenant({
        code: testTenantCode,
        displayName: 'API Validation Test Tenant',
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'en-US',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'API Validation Legal Entity LLC',
          vatNumber: '310000000000003',
          crNumber: '1010998877',
          functionalCurrency: 'SAR',
        },
        initialAdminUser: {
          displayName: 'Validation Admin',
          email: adminEmail,
          phone: '0501234567',
          password: 'SuperSecurePassword123!',
        },
      });

      authToken = onboarded.token;
      legalEntityId = onboarded.legalEntity.id;

      // Seed AR (113000) and AP (211000) control accounts so subledger reconciliation returns 200
      const arRes = await app.inject({
        method: 'POST',
        url: '/api/v1/accounting/accounts',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          legalEntityId,
          accountCode: '113000',
          name: 'Accounts Receivable Control',
          nameAr: 'ذمم العملاء',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isPostable: true,
        },
      });
      expect([200, 201]).toContain(arRes.statusCode);

      const apRes = await app.inject({
        method: 'POST',
        url: '/api/v1/accounting/accounts',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          legalEntityId,
          accountCode: '211000',
          name: 'Accounts Payable Control',
          nameAr: 'ذمم الموردين',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          isPostable: true,
        },
      });
      expect([200, 201]).toContain(apRes.statusCode);
    }, 60000);

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    const authHeaders = () => ({
      authorization: `Bearer ${authToken}`,
    });

    const requiredGetEndpoints: Array<{ name: string; path: string }> = [
      // Accounting
      { name: 'GET /api/v1/accounting/accounts', path: '/api/v1/accounting/accounts' },
      { name: 'GET /api/v1/accounting/accounts/next-code', path: '/api/v1/accounting/accounts/next-code' },
      { name: 'GET /api/v1/accounting/accounts/hierarchy', path: '/api/v1/accounting/accounts/hierarchy' },
      { name: 'GET /api/v1/accounting/account-mappings', path: '/api/v1/accounting/account-mappings' },
      { name: 'GET /api/v1/accounting/cost-centers', path: '/api/v1/accounting/cost-centers' },
      { name: 'GET /api/v1/accounting/vaults', path: '/api/v1/accounting/vaults' },
      { name: 'GET /api/v1/accounting/bank-accounts', path: '/api/v1/accounting/bank-accounts' },
      { name: 'GET /api/v1/accounting/pos-devices', path: '/api/v1/accounting/pos-devices' },
      { name: 'GET /api/v1/accounting/payment-terminals', path: '/api/v1/accounting/payment-terminals' },
      { name: 'GET /api/v1/accounting/payment-vouchers', path: '/api/v1/accounting/payment-vouchers' },
      { name: 'GET /api/v1/accounting/receipt-vouchers', path: '/api/v1/accounting/receipt-vouchers' },
      { name: 'GET /api/v1/accounting/expenses', path: '/api/v1/accounting/expenses' },
      { name: 'GET /api/v1/accounting/ledger', path: '/api/v1/accounting/ledger' },
      { name: 'GET /api/v1/accounting/trial-balance', path: '/api/v1/accounting/trial-balance' },
      { name: 'GET /api/v1/accounting/reports/trial-balance-hierarchy', path: '/api/v1/accounting/reports/trial-balance-hierarchy' },
      { name: 'GET /api/v1/accounting/reports/general-ledger', path: '/api/v1/accounting/reports/general-ledger' },
      { name: 'GET /api/v1/accounting/reconciliation/live', path: '/api/v1/accounting/reconciliation/live' },
      { name: 'GET /api/v1/accounting/reconciliation/discrepancies', path: '/api/v1/accounting/reconciliation/discrepancies' },
      { name: 'GET /api/v1/accounting/fiscal-years', path: '/api/v1/accounting/fiscal-years' },
      { name: 'GET /api/v1/accounting/fiscal-periods', path: '/api/v1/accounting/fiscal-periods' },
      { name: 'GET /api/v1/accounting/fiscal-periods/closing-logs', path: '/api/v1/accounting/fiscal-periods/closing-logs' },
      // ZATCA
      { name: 'GET /api/v1/zatca/config', path: '/api/v1/zatca/config' },
      { name: 'GET /api/v1/zatca/egs-units', path: '/api/v1/zatca/egs-units' },
      { name: 'GET /api/v1/zatca/documents', path: '/api/v1/zatca/documents' },
      { name: 'GET /api/v1/zatca/outbox', path: '/api/v1/zatca/outbox' },
      { name: 'GET /api/v1/zatca/reports/errors', path: '/api/v1/zatca/reports/errors' },
      { name: 'GET /api/v1/zatca/reports/reconciliation', path: '/api/v1/zatca/reports/reconciliation' },
      { name: 'GET /api/v1/zatca/audit-logs', path: '/api/v1/zatca/audit-logs' },
      // Settlements
      { name: 'GET /api/v1/settlements/summary', path: '/api/v1/settlements/summary' },
      // Subledger
      { name: 'GET /api/v1/subledger/reconciliation/ar', path: '/api/v1/subledger/reconciliation/ar' },
      { name: 'GET /api/v1/subledger/reconciliation/ap', path: '/api/v1/subledger/reconciliation/ap' },
    ];

    const optionalGetEndpoints: Array<{ name: string; path: string }> = [
      // Accounting
      { name: 'GET /api/v1/accounting/reconciliation/runs', path: '/api/v1/accounting/reconciliation/runs' },
      { name: 'GET /api/v1/accounting/reconciliation/items', path: '/api/v1/accounting/reconciliation/items' },
      // Settlements
      { name: 'GET /api/v1/settlements/providers', path: '/api/v1/settlements/providers' },
      { name: 'GET /api/v1/settlements/batches', path: '/api/v1/settlements/batches' },
      { name: 'GET /api/v1/settlements/discrepancies', path: '/api/v1/settlements/discrepancies' },
      // Purchasing
      { name: 'GET /api/v1/purchasing/requests', path: '/api/v1/purchasing/requests' },
      { name: 'GET /api/v1/purchasing/orders', path: '/api/v1/purchasing/orders' },
      { name: 'GET /api/v1/purchasing/receipts', path: '/api/v1/purchasing/receipts' },
      { name: 'GET /api/v1/purchasing/invoices', path: '/api/v1/purchasing/invoices' },
      { name: 'GET /api/v1/purchasing/returns', path: '/api/v1/purchasing/returns' },
      { name: 'GET /api/v1/purchasing/payments', path: '/api/v1/purchasing/payments' },
      // Inventory
      { name: 'GET /api/v1/inventory/valuation', path: '/api/v1/inventory/valuation' },
      { name: 'GET /api/v1/inventory/transfers', path: '/api/v1/inventory/transfers' },
      { name: 'GET /api/v1/inventory/transfers/reports/reconciliation', path: '/api/v1/inventory/transfers/reports/reconciliation' },
      { name: 'GET /api/v1/inventory/balances/detailed', path: '/api/v1/inventory/balances/detailed' },
      { name: 'GET /api/v1/inventory/warehouses', path: '/api/v1/inventory/warehouses' },
      // Production
      { name: 'GET /api/v1/production/batches', path: '/api/v1/production/batches' },
      { name: 'GET /api/v1/production/waste', path: '/api/v1/production/waste' },
      // Sales
      { name: 'GET /api/v1/sales/shifts', path: '/api/v1/sales/shifts' },
      // Tenant
      { name: 'GET /api/v1/branches', path: '/api/v1/branches' },
    ];

    it('preserves TenantContextGuard (401 when unauthenticated)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounting/accounts',
      });
      expect(res.statusCode).toBe(401);
    });

    describe('Required legalEntityId endpoints', () => {
      it.each(requiredGetEndpoints)(
        '$name returns 400 when missing or invalid, and 200 when valid UUID',
        async ({ path: endpointPath }) => {
          const missingRes = await app.inject({
            method: 'GET',
            url: endpointPath,
            headers: authHeaders(),
          });
          expect(missingRes.statusCode).toBe(400);
          expect(missingRes.json().error?.code).toBe('VALIDATION_ERROR');

          const emptyRes = await app.inject({
            method: 'GET',
            url: `${endpointPath}?legalEntityId=`,
            headers: authHeaders(),
          });
          expect(emptyRes.statusCode).toBe(400);
          expect(emptyRes.json().error?.code).toBe('VALIDATION_ERROR');

          const invalidRes = await app.inject({
            method: 'GET',
            url: `${endpointPath}?legalEntityId=not-a-valid-uuid`,
            headers: authHeaders(),
          });
          expect(invalidRes.statusCode).toBe(400);
          expect(invalidRes.json().error?.code).toBe('VALIDATION_ERROR');

          const validRes = await app.inject({
            method: 'GET',
            url: `${endpointPath}?legalEntityId=${legalEntityId}`,
            headers: authHeaders(),
          });
          expect(validRes.statusCode).toBe(200);
        }
      );

      it('POST /api/v1/settlements/providers/seed-defaults returns 400 when missing/invalid and 200/201 when valid', async () => {
        const missingRes = await app.inject({
          method: 'POST',
          url: '/api/v1/settlements/providers/seed-defaults',
          headers: authHeaders(),
          payload: {},
        });
        expect(missingRes.statusCode).toBe(400);
        expect(missingRes.json().error?.code).toBe('VALIDATION_ERROR');

        const invalidRes = await app.inject({
          method: 'POST',
          url: '/api/v1/settlements/providers/seed-defaults',
          headers: authHeaders(),
          payload: { legalEntityId: 'invalid-uuid' },
        });
        expect(invalidRes.statusCode).toBe(400);
        expect(invalidRes.json().error?.code).toBe('VALIDATION_ERROR');

        const validRes = await app.inject({
          method: 'POST',
          url: '/api/v1/settlements/providers/seed-defaults',
          headers: authHeaders(),
          payload: { legalEntityId },
        });
        expect([200, 201]).toContain(validRes.statusCode);
      });

      it('GET /api/v1/purchasing/suppliers/:supplierId/balance returns 400 when legalEntityId missing/invalid and 200 when valid', async () => {
        const supplierUuid = legalEntityId;
        const missingRes = await app.inject({
          method: 'GET',
          url: `/api/v1/purchasing/suppliers/${supplierUuid}/balance`,
          headers: authHeaders(),
        });
        expect(missingRes.statusCode).toBe(400);

        const invalidRes = await app.inject({
          method: 'GET',
          url: `/api/v1/purchasing/suppliers/${supplierUuid}/balance?legalEntityId=bad-uuid`,
          headers: authHeaders(),
        });
        expect(invalidRes.statusCode).toBe(400);

        const validRes = await app.inject({
          method: 'GET',
          url: `/api/v1/purchasing/suppliers/${supplierUuid}/balance?legalEntityId=${legalEntityId}`,
          headers: authHeaders(),
        });
        expect(validRes.statusCode).toBe(200);
      });
    });

    describe('Optional legalEntityId endpoints', () => {
      it.each(optionalGetEndpoints)(
        '$name returns 200 when omitted, 400 when invalid UUID, and 200 when valid UUID',
        async ({ path: endpointPath }) => {
          const omittedRes = await app.inject({
            method: 'GET',
            url: endpointPath,
            headers: authHeaders(),
          });
          expect(omittedRes.statusCode).toBe(200);

          const invalidRes = await app.inject({
            method: 'GET',
            url: `${endpointPath}?legalEntityId=not-a-valid-uuid`,
            headers: authHeaders(),
          });
          expect(invalidRes.statusCode).toBe(400);
          expect(invalidRes.json().error?.code).toBe('VALIDATION_ERROR');

          const validRes = await app.inject({
            method: 'GET',
            url: `${endpointPath}?legalEntityId=${legalEntityId}`,
            headers: authHeaders(),
          });
          expect(validRes.statusCode).toBe(200);
        }
      );
    });
  }
);
