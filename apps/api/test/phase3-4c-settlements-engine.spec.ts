import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import * as zlib from 'zlib';
import path from 'path';
import fs from 'fs';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { ProductionService } from '../src/modules/production/production.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { SettlementsService } from '../src/modules/settlements/settlements.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderType,
  OrderChannel,
  PaymentMethod,
  SettlementProviderCategory,
  SettlementDiscrepancyStatus,
  SettlementDiscrepancyType,
  SettlementBatchStatus,
  PaymentSettlementStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  accountMappings,
  bankAccounts,
  bankSettlementTransactions,
  settlementBatches,
  settlementBatchLines,
  settlementDiscrepancies,
  settlementProviders,
  journalEntries,
  journalLines,
  payments,
  items,
  unitsOfMeasure,
  warehouses,
  devices,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

// Minimal valid OOXML (.xlsx) generator for testing Excel import end-to-end
function buildMinimalXlsxBase64(rows: string[][]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colLetter = (idx: number) => String.fromCharCode(65 + idx);
  const sheetRows = rows
    .map((r, rIdx) => {
      const cells = r
        .map(
          (val, cIdx) =>
            `<c r="${colLetter(cIdx)}${rIdx + 1}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`
        )
        .join('');
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const content = zlib.deflateRawSync(Buffer.from(sheetXml, 'utf8'));
  const nameBuf = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(Buffer.byteLength(sheetXml), 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuf, content]).toString('base64');
}

describe(
  'Restaurant Cloud — Phase 3.4C: Payment Gateway & Delivery Aggregator Settlements Spec',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let financialResourcesService: FinancialResourcesService;
    let opsFramework: OperationsFrameworkService;
    let productionService: ProductionService;
    let salesService: SalesService;
    let settlementsService: SettlementsService;

    let tenantId: string;
    let tenant2Id: string;
    let adminUserId: string;
    let legalEntity1Id: string;
    let legalEntity2Id: string;
    let branch1Id: string;
    let branch2Id: string;
    let warehouse1Id: string;
    let device1Id: string;
    let uomPcsId: string;
    let item1Id: string;

    let bank1Id: string;
    let bank1GlAccountId: string;
    let bank2Id: string;
    let madaClearingAccId: string;
    let visaClearingAccId: string;
    let applePayClearingAccId: string;
    let stcPayClearingAccId: string;
    let cardClearingAccId: string;
    let gatewayFeesAccId: string;
    let aggReceivableAccId: string;
    let aggCommissionAccId: string;
    let aggSuspenseAccId: string;
    let vatInputAccId: string;
    let salesDiscountsAccId: string;

    let providersMap: Record<string, any> = {};
    let sysCtx: TenantContext;
    const tenantCode = `p34c-${Date.now().toString(36).slice(-6)}`;

    async function ensureCoaAccount(
      leId: string,
      code: string,
      nameAr: string,
      nameEn: string,
      accountType: AccountType,
      normalBalance: NormalBalance
    ) {
      return dbService.withTenantContext(sysCtx, async (tx) => {
        const [existing] = await tx
          .select()
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, tenantId),
              eq(chartOfAccounts.legalEntityId, leId),
              eq(chartOfAccounts.accountCode, code)
            )
          )
          .limit(1);
        if (existing) return existing;
        const [acc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId,
            legalEntityId: leId,
            accountCode: code,
            name: nameEn,
            nameAr,
            accountType,
            normalBalance,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        return acc!;
      });
    }

    async function createPaidOrder(params: {
      orderNumber: string;
      method: PaymentMethod;
      providerCode: string;
      externalRef?: string;
      unitPrice: string;
      channel?: OrderChannel;
      branchId?: string;
    }) {
      return salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: params.branchId || branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber: params.orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: params.channel || OrderChannel.POS,
        idempotencyKey: `ORD-${params.orderNumber}-${randomUUID()}`,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: params.unitPrice,
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: params.method,
            amount: (parseFloat(params.unitPrice) * 1.15).toFixed(4),
            providerCode: params.providerCode,
            providerTransactionRef: params.externalRef,
          },
        ],
      });
    }

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }

      dbService = new DatabaseService();
      await dbService.onModuleInit();
      auditService = new AuditService(dbService);
      opsFramework = new OperationsFrameworkService(dbService);
      tenantService = new TenantService(dbService, auditService);
      postingEngine = new PostingEngineService(dbService, auditService);
      accountingService = new AccountingService(
        dbService,
        auditService,
        postingEngine,
        opsFramework
      );
      financialResourcesService = new FinancialResourcesService(
        dbService,
        auditService,
        opsFramework
      );
      productionService = new ProductionService(dbService, auditService);
      salesService = new SalesService(
        dbService,
        auditService,
        productionService,
        accountingService,
        postingEngine,
        opsFramework
      );
      settlementsService = new SettlementsService(
        dbService,
        auditService,
        postingEngine,
        opsFramework
      );

      // Provision Tenant 1 & Tenant 2
      const prov1 = await tenantService.onboardTenant({
        code: tenantCode,
        displayName: `Phase 3.4C Test Tenant ${tenantCode}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة التسويات الأولى ذ.م.م',
          commercialName: 'Main Restaurant Co',
          vatNumber: '310777777700003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-01',
          name: 'Riyadh Main Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin-${tenantCode}@test.local`,
          displayName: 'P34C Admin',
          password: 'Password123!Secure',
        },
      });
      tenantId = prov1.tenant.id;
      adminUserId = prov1.user.id;
      legalEntity1Id = prov1.legalEntity.id;
      branch1Id = prov1.branch.id;

      sysCtx = {
        tenantId,
        userId: adminUserId,
        email: `admin-${tenantCode}@test.local`,
        role: 'SUPER_ADMIN',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeId: tenantId }],
        permissions: ['*'],
      } as any;

      const prov2 = await tenantService.onboardTenant({
        code: `${tenantCode}-t2`,
        displayName: `Phase 3.4C Tenant 2`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة معزولة ثانية ذ.م.م',
          commercialName: 'Other Tenant Co',
          vatNumber: '310888888800003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-T2',
          name: 'Other Tenant Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin2-${tenantCode}@test.local`,
          displayName: 'P34C Admin 2',
          password: 'Password123!Secure',
        },
      });
      tenant2Id = prov2.tenant.id;

      // Second Legal Entity & Branch inside Tenant 1
      const le2 = await tenantService.createLegalEntity(sysCtx, {
        legalName: 'شركة ثانية ذ.م.م',
        commercialName: 'Second Legal Entity',
        vatNumber: '310999999900003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      });
      legalEntity2Id = le2.id;

      const br2 = await tenantService.createBranch(sysCtx, {
        legalEntityId: legalEntity1Id,
        code: 'BR-02',
        name: 'Jeddah Branch',
        businessType: 'RESTAURANT' as any,
      });
      branch2Id = br2.id;

      // Create Open Fiscal Period for LE1
      const currentYear = new Date().getFullYear();
      await accountingService.createFiscalPeriod(sysCtx, {
        legalEntityId: legalEntity1Id,
        periodName: `FY-${currentYear}`,
        startDate: `${currentYear}-01-01T00:00:00.000Z`,
        endDate: `${currentYear}-12-31T23:59:59.000Z`,
      });

      // Standard Chart of Accounts for LE1
      await ensureCoaAccount(legalEntity1Id, '411000', 'مبيعات', 'Sales Revenue', AccountType.REVENUE, NormalBalance.CREDIT);
      await ensureCoaAccount(legalEntity1Id, '211200', 'ضريبة المخرجات', 'VAT Output', AccountType.LIABILITY, NormalBalance.CREDIT);
      await ensureCoaAccount(legalEntity1Id, '511000', 'تكلفة المبيعات', 'COGS', AccountType.EXPENSE, NormalBalance.DEBIT);
      await ensureCoaAccount(legalEntity1Id, '112000', 'المخزون', 'Inventory', AccountType.ASSET, NormalBalance.DEBIT);
      await ensureCoaAccount(legalEntity1Id, '111100', 'الصندوق', 'Cash Vault', AccountType.ASSET, NormalBalance.DEBIT);

      const bankGl = await ensureCoaAccount(legalEntity1Id, '111201', 'بنك الراجحي', 'Al Rajhi Bank', AccountType.ASSET, NormalBalance.DEBIT);
      bank1GlAccountId = bankGl.id;
      const bank2Gl = await ensureCoaAccount(legalEntity2Id, '111202', 'بنك الشركة الثانية', 'LE2 Bank', AccountType.ASSET, NormalBalance.DEBIT);

      madaClearingAccId = (await ensureCoaAccount(legalEntity1Id, '111300', 'وسيط مدى', 'Mada Clearing', AccountType.ASSET, NormalBalance.DEBIT)).id;
      cardClearingAccId = (await ensureCoaAccount(legalEntity1Id, '111350', 'وسيط البطاقات', 'Card Clearing', AccountType.ASSET, NormalBalance.DEBIT)).id;
      visaClearingAccId = (await ensureCoaAccount(legalEntity1Id, '111400', 'وسيط فيزا', 'Visa Clearing', AccountType.ASSET, NormalBalance.DEBIT)).id;
      applePayClearingAccId = (await ensureCoaAccount(legalEntity1Id, '111500', 'وسيط أبل باي', 'Apple Pay Clearing', AccountType.ASSET, NormalBalance.DEBIT)).id;
      stcPayClearingAccId = (await ensureCoaAccount(legalEntity1Id, '111600', 'وسيط STC Pay', 'STC Pay Clearing', AccountType.ASSET, NormalBalance.DEBIT)).id;
      gatewayFeesAccId = (await ensureCoaAccount(legalEntity1Id, '512100', 'رسوم بوابات الدفع', 'Gateway Fees', AccountType.EXPENSE, NormalBalance.DEBIT)).id;
      aggReceivableAccId = (await ensureCoaAccount(legalEntity1Id, '113200', 'ذمم تطبيقات التوصيل', 'Aggregator Receivable', AccountType.ASSET, NormalBalance.DEBIT)).id;
      aggCommissionAccId = (await ensureCoaAccount(legalEntity1Id, '512000', 'عمولة تطبيقات التوصيل', 'Aggregator Commission', AccountType.EXPENSE, NormalBalance.DEBIT)).id;
      aggSuspenseAccId = (await ensureCoaAccount(legalEntity1Id, '211900', 'وسيط معلق التطبيقات', 'Aggregator Suspense', AccountType.LIABILITY, NormalBalance.CREDIT)).id;
      vatInputAccId = (await ensureCoaAccount(legalEntity1Id, '114200', 'ضريبة المدخلات', 'VAT Input', AccountType.ASSET, NormalBalance.DEBIT)).id;
      salesDiscountsAccId = (await ensureCoaAccount(legalEntity1Id, '412000', 'خصومات المبيعات', 'Sales Discounts', AccountType.EXPENSE, NormalBalance.DEBIT)).id;

      // Bank Accounts
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [b1] = await tx
          .insert(bankAccounts)
          .values({
            tenantId,
            legalEntityId: legalEntity1Id,
            bankName: 'Al Rajhi Settlement Bank',
            accountNumber: `SA-${tenantCode}-01`,
            accountId: bank1GlAccountId,
            balance: '0.0000',
            status: 'ACTIVE',
          })
          .returning();
        bank1Id = b1!.id;

        const [b2] = await tx
          .insert(bankAccounts)
          .values({
            tenantId,
            legalEntityId: legalEntity2Id,
            bankName: 'LE2 Bank Account',
            accountNumber: `SA-${tenantCode}-02`,
            accountId: bank2Gl.id,
            balance: '0.0000',
            status: 'ACTIVE',
          })
          .returning();
        bank2Id = b2!.id;

        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            code: `WH-${tenantCode}`,
            name: 'Main Warehouse',
            status: 'ACTIVE',
          })
          .returning();
        warehouse1Id = wh!.id;

        const [dev] = await tx
          .insert(devices)
          .values({
            tenantId,
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            deviceCode: `POS-${tenantCode}`,
            deviceName: 'POS 1',
            status: 'ACTIVE',
          })
          .returning();
        device1Id = dev!.id;

        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({
            tenantId,
            code: `PCS-${tenantCode}`,
            nameAr: 'قطعة',
            nameEn: 'Piece',
            category: 'UNIT',
            isBase: true,
          })
          .returning();
        uomPcsId = uom!.id;

        const [itm] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntity1Id,
            sku: `SKU-${tenantCode}`,
            nameAr: 'وجبة برجر',
            nameEn: 'Burger Meal',
            itemType: 'FINISHED_GOOD',
            baseUomId: uomPcsId,
            defaultCost: '10.0000',
          })
          .returning();
        item1Id = itm!.id;
      });

      // Seed default 13 Settlement Providers for LE1
      const seeded = await settlementsService.seedDefaultProviders(sysCtx, legalEntity1Id);
      for (const p of seeded) {
        providersMap[p.code] = p;
      }
    }, 90000);

    afterAll(async () => {
      await dbService.onModuleDestroy();
    });

    it('1. Should complete full Mada settlement (CSV import, match, post balanced JV & bank deposit)', async () => {
      const extRef = `MADA-REF-${Date.now()}`;
      // 100.0000 * 1.15 = 115.0000 SAR
      const orderRes = await createPaidOrder({
        orderNumber: `ORD-MADA-${Date.now()}`,
        method: PaymentMethod.MADA,
        providerCode: 'MADA',
        externalRef: extRef,
        unitPrice: '100.0000',
      });

      const csv = [
        'externalRef,orderNumber,grossAmount,feeAmount,feeTaxAmount,netAmount',
        `${extRef},${orderRes.orderNumber},115.0000,1.0000,0.0000,114.0000`,
      ].join('\n');

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'CSV',
        fileName: 'mada-batch-1.csv',
        csvContent: csv,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
      });

      expect(batch.status).toBe(SettlementBatchStatus.RECONCILING);
      expect(parseFloat(batch.grossAmount)).toBe(115);

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '114.0000',
        bankReference: `BNK-MADA-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
        idempotencyKey: `POST-MADA-${batch.id}`,
      });

      expect(posted.status).toBe(SettlementBatchStatus.POSTED);
      expect(posted.journalEntryId).toBeTruthy();

      const details = await settlementsService.getBatchDetails(sysCtx, batch.id);
      const jLines = details.journalEntry!.lines;
      const totalDebit = jLines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
      const totalCredit = jLines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
      expect(totalDebit).toBeCloseTo(115, 2);
      expect(totalCredit).toBeCloseTo(115, 2);
      expect(jLines.some((l: any) => l.accountId === bank1GlAccountId && parseFloat(l.debit) === 114)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === gatewayFeesAccId && parseFloat(l.debit) === 1)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === madaClearingAccId && parseFloat(l.credit) === 115)).toBe(true);
    });

    it('2. Should complete VISA / Mastercard settlement using VISA_CLEARING', async () => {
      const extRef = `VISA-REF-${Date.now()}`;
      const orderRes = await createPaidOrder({
        orderNumber: `ORD-VISA-${Date.now()}`,
        method: PaymentMethod.VISA_MC,
        providerCode: 'VISA_MC',
        externalRef: extRef,
        unitPrice: '200.0000', // 230.0000 SAR
      });

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        providerId: providersMap.VISA_MC.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'visa.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [
          {
            externalRef: extRef,
            orderNumber: orderRes.orderNumber,
            grossAmount: '230.0000',
            discountRestaurant: '0.0000',
            discountPlatform: '0.0000',
            deliveryFee: '0.0000',
            feeAmount: '5.0000',
            feeTaxAmount: '0.0000',
            withheldAmount: '0.0000',
            netAmount: '225.0000',
          },
        ],
      });

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '225.0000',
        bankReference: `BNK-VISA-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });

      const details = await settlementsService.getBatchDetails(sysCtx, posted.id);
      expect(
        details.journalEntry!.lines.some(
          (l: any) => l.accountId === visaClearingAccId && parseFloat(l.credit) === 230
        )
      ).toBe(true);
    });

    it('3. Should settle Apple Pay and STC Pay to their dedicated clearing accounts', async () => {
      const appleRef = `APL-REF-${Date.now()}`;
      await createPaidOrder({
        orderNumber: `ORD-APL-${Date.now()}`,
        method: PaymentMethod.APPLE_PAY,
        providerCode: 'APPLE_PAY',
        externalRef: appleRef,
        unitPrice: '100.0000', // 115
      });
      const bApple = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.APPLE_PAY.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'apple.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: appleRef, grossAmount: '115.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '2.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });
      const pApple = await settlementsService.postSettlementBatch(sysCtx, bApple.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '113.0000',
        bankReference: `BNK-APL-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });
      const dApple = await settlementsService.getBatchDetails(sysCtx, pApple.id);
      expect(dApple.journalEntry!.lines.some((l: any) => l.accountId === applePayClearingAccId && parseFloat(l.credit) === 115)).toBe(true);

      // STC Pay
      const stcRef = `STC-REF-${Date.now()}`;
      await createPaidOrder({
        orderNumber: `ORD-STC-${Date.now()}`,
        method: PaymentMethod.CARD,
        providerCode: 'STC_PAY',
        externalRef: stcRef,
        unitPrice: '100.0000', // 115
      });
      const bStc = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.STC_PAY.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'stc.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: stcRef, grossAmount: '115.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '2.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });
      const pStc = await settlementsService.postSettlementBatch(sysCtx, bStc.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '113.0000',
        bankReference: `BNK-STC-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });
      const dStc = await settlementsService.getBatchDetails(sysCtx, pStc.id);
      expect(dStc.journalEntry!.lines.some((l: any) => l.accountId === stcPayClearingAccId && parseFloat(l.credit) === 115)).toBe(true);
    });

    it('4 & 5. Should calculate 10,000 gross / 200 fee / 30 VAT Input / 9,770 net bank when valid tax invoice & recoverable VAT exist', async () => {
      const extRef = `VAT-ELIG-${Date.now()}`;
      // unitPrice = 10000 / 1.15 = 8695.6522 -> grandTotal = 10000.0000
      await createPaidOrder({
        orderNumber: `ORD-10K-${Date.now()}`,
        method: PaymentMethod.MADA,
        providerCode: 'MADA',
        externalRef: extRef,
        unitPrice: '8695.6522',
      });

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: '10k-vat-ok.json',
        hasValidTaxInvoice: true,
        taxInvoiceNumber: 'TINV-2026-001',
        isVatRecoverable: true,
        rows: [{ externalRef: extRef, grossAmount: '10000.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '200.0000', feeTaxAmount: '30.0000', withheldAmount: '0.0000', netAmount: '9770.0000' }],
      });

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '9770.0000',
        bankReference: `BNK-10K-${Date.now()}`,
        hasValidTaxInvoice: true,
        taxInvoiceNumber: 'TINV-2026-001',
        isVatRecoverable: true,
        allowSuspensePosting: false,
      });

      const details = await settlementsService.getBatchDetails(sysCtx, posted.id);
      const jLines = details.journalEntry!.lines;
      expect(jLines.some((l: any) => l.accountId === bank1GlAccountId && parseFloat(l.debit) === 9770)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === gatewayFeesAccId && parseFloat(l.debit) === 200)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === vatInputAccId && parseFloat(l.debit) === 30)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === madaClearingAccId && parseFloat(l.credit) === 10000)).toBe(true);
    });

    it('6. Should NOT debit VAT_INPUT when tax invoice is missing or VAT is non-recoverable (absorbs tax into fee expense)', async () => {
      const extRef = `NO-VAT-${Date.now()}`;
      await createPaidOrder({
        orderNumber: `ORD-NOVAT-${Date.now()}`,
        method: PaymentMethod.MADA,
        providerCode: 'MADA',
        externalRef: extRef,
        unitPrice: '869.5652', // 1000.0000 SAR
      });

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'no-vat-inv.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: extRef, grossAmount: '1000.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '20.0000', feeTaxAmount: '3.0000', withheldAmount: '0.0000', netAmount: '977.0000' }],
      });

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '977.0000',
        bankReference: `BNK-NOVAT-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });

      const details = await settlementsService.getBatchDetails(sysCtx, posted.id);
      const jLines = details.journalEntry!.lines;
      expect(jLines.some((l: any) => l.accountId === vatInputAccId)).toBe(false);
      expect(jLines.some((l: any) => l.accountId === gatewayFeesAccId && parseFloat(l.debit) === 23)).toBe(true);
    });

    it('7. Should support partial settlements (PARTIALLY_SETTLED -> SETTLED on second batch)', async () => {
      const extRef = `PARTIAL-REF-${Date.now()}`;
      const ord = await createPaidOrder({
        orderNumber: `ORD-PART-${Date.now()}`,
        method: PaymentMethod.MADA,
        providerCode: 'MADA',
        externalRef: extRef,
        unitPrice: '100.0000', // 115.0000 SAR
      });

      // Batch 1 settles 60.0000
      const b1 = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'partial-1.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: extRef, grossAmount: '60.0000', status: 'PARTIAL', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '1.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });
      await settlementsService.postSettlementBatch(sysCtx, b1.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '59.0000',
        bankReference: `BNK-P1-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [p] = await tx.select().from(payments).where(eq(payments.orderId, ord.id)).limit(1);
        expect(p?.settlementStatus).toBe(PaymentSettlementStatus.PARTIALLY_SETTLED);
        expect(parseFloat(p?.settledAmount || '0')).toBeCloseTo(60, 2);
      });

      // Batch 2 settles remaining 55.0000
      const b2 = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'partial-2.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: extRef, grossAmount: '55.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '1.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });
      await settlementsService.postSettlementBatch(sysCtx, b2.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '54.0000',
        bankReference: `BNK-P2-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [p] = await tx.select().from(payments).where(eq(payments.orderId, ord.id)).limit(1);
        expect(p?.settlementStatus).toBe(PaymentSettlementStatus.SETTLED);
        expect(parseFloat(p?.settledAmount || '0')).toBeCloseTo(115, 2);
      });
    });

    it('8. Should settle multiple transactions in one Excel (.xlsx) batch', async () => {
      const r1 = `XLSX-1-${Date.now()}`;
      const r2 = `XLSX-2-${Date.now()}`;
      const r3 = `XLSX-3-${Date.now()}`;
      await createPaidOrder({ orderNumber: `ORD-X1-${Date.now()}`, method: PaymentMethod.CARD, providerCode: 'GEIDEA', externalRef: r1, unitPrice: '100.0000' });
      await createPaidOrder({ orderNumber: `ORD-X2-${Date.now()}`, method: PaymentMethod.CARD, providerCode: 'GEIDEA', externalRef: r2, unitPrice: '100.0000' });
      await createPaidOrder({ orderNumber: `ORD-X3-${Date.now()}`, method: PaymentMethod.CARD, providerCode: 'GEIDEA', externalRef: r3, unitPrice: '100.0000' });

      const xlsxB64 = buildMinimalXlsxBase64([
        ['externalRef', 'grossAmount', 'feeAmount', 'netAmount'],
        [r1, '115.0000', '2.0000', '113.0000'],
        [r2, '115.0000', '2.0000', '113.0000'],
        [r3, '115.0000', '2.0000', '113.0000'],
      ]);

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.GEIDEA.id,
        settlementDate: new Date().toISOString(),
        format: 'EXCEL',
        fileName: 'geidea-3tx.xlsx',
        fileContentBase64: xlsxB64,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
      });

      expect(batch.matchedRows).toBe(3);
      expect(parseFloat(batch.grossAmount)).toBe(345);
      expect(parseFloat(batch.netExpectedAmount)).toBe(339);

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '339.0000',
        bankReference: `BNK-XLSX-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
      });
      expect(posted.status).toBe(SettlementBatchStatus.POSTED);
    });

    it('9, 10, 11, 12. Should detect MISSING_IN_SYSTEM, MISSING_IN_STATEMENT, DUPLICATE_ENTRY, AMOUNT_MISMATCH, and FEE_MISMATCH', async () => {
      const start = new Date(Date.now() - 60000);
      const validRef = `DET-OK-${Date.now()}`;
      const missingInStmtRef = `DET-MISS-STMT-${Date.now()}`;
      await createPaidOrder({ orderNumber: `ORD-DET1-${Date.now()}`, method: PaymentMethod.MADA, providerCode: 'MADA', externalRef: validRef, unitPrice: '100.0000' }); // 115
      await createPaidOrder({ orderNumber: `ORD-DET2-${Date.now()}`, method: PaymentMethod.MADA, providerCode: 'MADA', externalRef: missingInStmtRef, unitPrice: '100.0000' }); // 115
      const end = new Date(Date.now() + 60000);

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        format: 'JSON_API',
        fileName: 'discrepancy-suite.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [
          // 1. Amount mismatch (system=115, stmt=110) + Fee/net mismatch (110 - 5 != 99)
          { externalRef: validRef, grossAmount: '110.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '5.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000', netAmount: '99.0000' },
          // 2. Duplicate in statement
          { externalRef: validRef, grossAmount: '110.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '5.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' },
          // 3. Missing in system
          { externalRef: `UNKNOWN-REF-${Date.now()}`, grossAmount: '50.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '1.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' },
        ],
      });

      expect(batch.status).toBe(SettlementBatchStatus.DISCREPANCY_PENDING);
      const details = await settlementsService.getBatchDetails(sysCtx, batch.id);
      const types = new Set(details.discrepancies.map((d: any) => d.discrepancyType));

      expect(types.has(SettlementDiscrepancyType.AMOUNT_MISMATCH)).toBe(true);
      expect(types.has(SettlementDiscrepancyType.FEE_MISMATCH)).toBe(true);
      expect(types.has(SettlementDiscrepancyType.DUPLICATE_ENTRY)).toBe(true);
      expect(types.has(SettlementDiscrepancyType.MISSING_IN_SYSTEM)).toBe(true);
      expect(types.has(SettlementDiscrepancyType.MISSING_IN_STATEMENT)).toBe(true);

      // 16. Reject posting while OPEN discrepancies exist
      await expect(
        settlementsService.postSettlementBatch(sysCtx, batch.id, {
          bankAccountId: bank1Id,
          bankReceivedAmount: '148.0000',
          bankReference: 'BNK-BLOCKED',
          hasValidTaxInvoice: false,
          isVatRecoverable: false,
          allowSuspensePosting: false,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('13. Should handle WITHHELD_AMOUNT by posting to AGGREGATOR_SUSPENSE', async () => {
      const ordNum = `ORD-HOLD-${Date.now()}`;
      await createPaidOrder({
        orderNumber: ordNum,
        method: PaymentMethod.CARD,
        providerCode: 'HUNGERSTATION',
        channel: OrderChannel.AGGREGATOR,
        unitPrice: '100.0000', // 115
      });

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.HUNGERSTATION.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'hs-withheld.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [
          {
            orderNumber: ordNum,
            grossAmount: '115.0000',
            discountRestaurant: '0.0000',
            discountPlatform: '0.0000',
            deliveryFee: '0.0000',
            feeAmount: '20.0000',
            feeTaxAmount: '0.0000',
            withheldAmount: '15.0000',
            netAmount: '80.0000',
          },
        ],
      });

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '80.0000',
        bankReference: `BNK-HOLD-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: true,
      });

      const details = await settlementsService.getBatchDetails(sysCtx, posted.id);
      expect(
        details.journalEntry!.lines.some(
          (l: any) => l.accountId === aggSuspenseAccId && parseFloat(l.debit) === 15
        )
      ).toBe(true);
    });

    it('14 & 15. Should settle full Delivery Aggregator batch (gross orders, restaurant/platform discounts, commission, VAT Input, net receivable)', async () => {
      const ordNum = `ORD-JAHEZ-${Date.now()}`;
      await createPaidOrder({
        orderNumber: ordNum,
        method: PaymentMethod.CARD,
        providerCode: 'JAHEZ',
        channel: OrderChannel.AGGREGATOR,
        unitPrice: '1000.0000', // 1150.0000 gross
      });

      // Gross: 1150, Restaurant Discount: 50, Platform Discount (info): 30,
      // Commission: 200, Commission VAT: 30, Net Bank: 1150 - 50 - 200 - 30 = 870
      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.JAHEZ.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'jahez-full.json',
        hasValidTaxInvoice: true,
        taxInvoiceNumber: 'JAHEZ-VAT-88',
        isVatRecoverable: true,
        rows: [
          {
            orderNumber: ordNum,
            grossAmount: '1150.0000',
            discountRestaurant: '50.0000',
            discountPlatform: '30.0000',
            deliveryFee: '0.0000',
            feeAmount: '200.0000',
            feeTaxAmount: '30.0000',
            withheldAmount: '0.0000',
            netAmount: '870.0000',
          },
        ],
      });

      expect(parseFloat(batch.restaurantDiscountAmount)).toBe(50);
      expect(parseFloat(batch.platformDiscountAmount)).toBe(30);
      expect(parseFloat(batch.netExpectedAmount)).toBe(870);

      const posted = await settlementsService.postSettlementBatch(sysCtx, batch.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '870.0000',
        bankReference: `BNK-JHZ-${Date.now()}`,
        hasValidTaxInvoice: true,
        taxInvoiceNumber: 'JAHEZ-VAT-88',
        isVatRecoverable: true,
        allowSuspensePosting: false,
      });

      const details = await settlementsService.getBatchDetails(sysCtx, posted.id);
      const jLines = details.journalEntry!.lines;
      expect(jLines.some((l: any) => l.accountId === bank1GlAccountId && parseFloat(l.debit) === 870)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === aggCommissionAccId && parseFloat(l.debit) === 200)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === vatInputAccId && parseFloat(l.debit) === 30)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === salesDiscountsAccId && parseFloat(l.debit) === 50)).toBe(true);
      expect(jLines.some((l: any) => l.accountId === aggReceivableAccId && parseFloat(l.credit) === 1150)).toBe(true);
    });

    it('17 & 18. Should enforce idempotency on re-importing same file and re-posting same idempotencyKey', async () => {
      const extRef = `IDEMP-${Date.now()}`;
      await createPaidOrder({ orderNumber: `ORD-IDEMP-${Date.now()}`, method: PaymentMethod.MADA, providerCode: 'MADA', externalRef: extRef, unitPrice: '100.0000' });

      const csv = `externalRef,grossAmount,feeAmount,netAmount\n${extRef},115.0000,1.0000,114.0000`;
      const b1 = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'CSV',
        fileName: 'idemp.csv',
        csvContent: csv,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
      });
      const b2 = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'CSV',
        fileName: 'idemp.csv',
        csvContent: csv,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
      });
      expect(b2.id).toBe(b1.id);
      expect(b2.idempotent).toBe(true);

      const idempKey = `POST-IDEMP-${b1.id}`;
      const p1 = await settlementsService.postSettlementBatch(sysCtx, b1.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '114.0000',
        bankReference: `BNK-IDEMP-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
        idempotencyKey: idempKey,
      });
      const p2 = await settlementsService.postSettlementBatch(sysCtx, b1.id, {
        bankAccountId: bank1Id,
        bankReceivedAmount: '114.0000',
        bankReference: `BNK-IDEMP-${Date.now()}`,
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        allowSuspensePosting: false,
        idempotencyKey: idempKey,
      });
      expect(p2.idempotent).toBe(true);
      expect(p2.journalEntryId).toBe(p1.journalEntryId);

      // 24. Historical posted batch cannot be re-posted with different key
      await expect(
        settlementsService.postSettlementBatch(sysCtx, b1.id, {
          bankAccountId: bank1Id,
          bankReceivedAmount: '114.0000',
          bankReference: 'BNK-REPOST',
          hasValidTaxInvoice: false,
          isVatRecoverable: false,
          allowSuspensePosting: false,
          idempotencyKey: 'DIFFERENT-KEY',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('19 & 20. Should enforce Legal Entity, Branch, Bank Account ownership & Multi-Tenant RLS isolation', async () => {
      // Branch-scoped user on branch2Id cannot access branch1Id batch
      const branch2Ctx: TenantContext = {
        tenantId,
        userId: adminUserId,
        userScopes: [{ scopeType: 'BRANCH', scopeId: branch2Id }],
        permissions: ['*'],
      };
      const batchesRes = await settlementsService.listBatches(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
      });
      if (batchesRes.items.length > 0) {
        const bId = batchesRes.items[0]!.id;
        await expect(settlementsService.getBatchDetails(branch2Ctx, bId)).rejects.toThrow(
          ForbiddenException
        );
      }

      // Cannot post LE1 batch using LE2 bank account
      const extRef = `ISO-BANK-${Date.now()}`;
      await createPaidOrder({ orderNumber: `ORD-ISO-${Date.now()}`, method: PaymentMethod.MADA, providerCode: 'MADA', externalRef: extRef, unitPrice: '100.0000' });
      const bIso = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'iso-bank.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: extRef, grossAmount: '115.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '1.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });
      await expect(
        settlementsService.postSettlementBatch(sysCtx, bIso.id, {
          bankAccountId: bank2Id, // belongs to LE2!
          bankReceivedAmount: '114.0000',
          bankReference: 'BNK-WRONG-LE',
          hasValidTaxInvoice: false,
          isVatRecoverable: false,
          allowSuspensePosting: false,
        })
      ).rejects.toThrow(ForbiddenException);

      // Multi-Tenant RLS check across all 6 new tables under rc_app_user
      const tenant2Ctx: TenantContext = {
        tenantId: tenant2Id,
        userId: adminUserId,
        userScopes: [{ scopeType: 'TENANT', scopeId: tenant2Id }],
        permissions: ['*'],
      };
      await dbService.withTenantContext(tenant2Ctx, async (tx) => {
        const pRows = await tx.select().from(settlementProviders);
        const bRows = await tx.select().from(settlementBatches);
        const lRows = await tx.select().from(settlementBatchLines);
        const dRows = await tx.select().from(settlementDiscrepancies);
        const btRows = await tx.select().from(bankSettlementTransactions);
        expect(pRows.length).toBe(0);
        expect(bRows.length).toBe(0);
        expect(lRows.length).toBe(0);
        expect(dRows.length).toBe(0);
        expect(btRows.length).toBe(0);
      });
    });

    it('21. Should perform complete atomic rollback when PostingEngine fails (e.g. inactive fee account)', async () => {
      const extRef = `RB-REF-${Date.now()}`;
      await createPaidOrder({ orderNumber: `ORD-RB-${Date.now()}`, method: PaymentMethod.MADA, providerCode: 'MADA', externalRef: extRef, unitPrice: '100.0000' });

      const batch = await settlementsService.importStatement(sysCtx, {
        legalEntityId: legalEntity1Id,
        providerId: providersMap.MADA.id,
        settlementDate: new Date().toISOString(),
        format: 'JSON_API',
        fileName: 'rollback.json',
        hasValidTaxInvoice: false,
        isVatRecoverable: false,
        rows: [{ externalRef: extRef, grossAmount: '115.0000', discountRestaurant: '0.0000', discountPlatform: '0.0000', deliveryFee: '0.0000', feeAmount: '2.0000', feeTaxAmount: '0.0000', withheldAmount: '0.0000' }],
      });

      const [bankBefore] = await dbService.withTenantContext(sysCtx, (tx) =>
        tx.select().from(bankAccounts).where(eq(bankAccounts.id, bank1Id))
      );

      // Deactivate GATEWAY_FEES GL account temporarily
      await dbService.withTenantContext(sysCtx, (tx) =>
        tx.update(chartOfAccounts).set({ status: 'INACTIVE' }).where(eq(chartOfAccounts.id, gatewayFeesAccId))
      );

      await expect(
        settlementsService.postSettlementBatch(sysCtx, batch.id, {
          bankAccountId: bank1Id,
          bankReceivedAmount: '113.0000',
          bankReference: 'BNK-RB',
          hasValidTaxInvoice: false,
          isVatRecoverable: false,
          allowSuspensePosting: false,
        })
      ).rejects.toThrow(BadRequestException);

      // Restore account active
      await dbService.withTenantContext(sysCtx, (tx) =>
        tx.update(chartOfAccounts).set({ status: 'ACTIVE' }).where(eq(chartOfAccounts.id, gatewayFeesAccId))
      );

      // Verify zero side effects
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bankAfter] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, bank1Id));
        expect(bankAfter!.balance).toBe(bankBefore!.balance);
        const [bAfter] = await tx.select().from(settlementBatches).where(eq(settlementBatches.id, batch.id));
        expect(bAfter!.status).toBe(SettlementBatchStatus.RECONCILING);
        expect(bAfter!.journalEntryId).toBeNull();
      });
    });

    it('22 & 23. Should reconcile Bank Ledger balance with GL Bank Account & Clearing accounts with unsettled payments', async () => {
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bank] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, bank1Id));
        const [glBank] = await tx
          .select({
            net: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(14,4)`,
          })
          .from(journalLines)
          .where(eq(journalLines.accountId, bank1GlAccountId));

        expect(parseFloat(bank!.balance)).toBeCloseTo(parseFloat(glBank!.net), 2);
      });

      const summary = await settlementsService.getReconciliationSummary(sysCtx, legalEntity1Id);
      expect(summary.postedBatches).toBeGreaterThanOrEqual(7);
      expect(parseFloat(summary.totalPostedNetBank)).toBeGreaterThan(0);
    });
  }
);
