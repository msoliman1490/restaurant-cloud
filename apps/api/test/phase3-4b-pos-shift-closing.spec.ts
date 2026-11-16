import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
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
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderType,
  OrderChannel,
  PaymentMethod,
  ShiftStatus,
  ShiftCashTransactionType,
  JournalType,
} from '@restaurant-cloud/domain-kernel';
import {
  posShifts,
  shiftCashTransactions,
  cashVaults,
  vaultTransactions,
  journalEntries,
  journalLines,
  chartOfAccounts,
  accountMappings,
  items,
  unitsOfMeasure,
  warehouses,
  devices,
  tenantSubscriptions,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe(
  'Restaurant Cloud — Phase 3.4B: POS Shift Closing & Cash Variance Automated Posting Spec',
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

    let tenantId: string;
    let adminUserId: string;
    let legalEntity1Id: string;
    let legalEntity2Id: string;
    let branch1Id: string;
    let branch2Id: string;
    let warehouse1Id: string;
    let device1Id: string;
    let device2Id: string;
    let vault1Id: string;
    let vault2Id: string;
    let vaultAccountId: string;
    let overShortAccountId: string;
    let overageAccountId: string;
    let cashInTransitAccountId: string;
    let generalExpenseAccountId: string;
    let madaAccountId: string;
    let visaAccountId: string;
    let applePayAccountId: string;

    let uomPcsId: string;
    let item1Id: string;

    let sysCtx: TenantContext;
    const tenantCode = `p34b-${Date.now().toString(36).slice(-6)}`;

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }

      dbService = new DatabaseService();
      await dbService.onModuleInit();

      auditService = new AuditService(dbService);
      tenantService = new TenantService(dbService, auditService);
      postingEngine = new PostingEngineService(dbService, auditService);
      opsFramework = new OperationsFrameworkService(dbService);
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

      // 1. Onboard Primary Tenant
      const tenantResult = await tenantService.onboardTenant({
        code: tenantCode,
        displayName: `منشأة إقفال الورديات ${tenantCode}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة تشغيل المطاعم الحديثة ذ.م.م',
          commercialName: 'Modern POS Shifts LLC',
          vatNumber: '310555555500003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-SFT-01',
          name: 'فرع الرياض الرئيسي',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin-${tenantCode}@restaurant-cloud.test`,
          displayName: 'مدير الورديات والحسابات',
          password: 'Password123!Secure',
        },
      });

      tenantId = tenantResult.tenant.id;
      adminUserId = tenantResult.user.id;
      legalEntity1Id = tenantResult.legalEntity.id;
      branch1Id = tenantResult.branch.id;

      sysCtx = {
        tenantId,
        userId: adminUserId,
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        role: 'SUPER_ADMIN',
        scopes: ['*'],
      };

      // Upgrade test tenant subscription to ENTERPRISE so multi-branch tests exceed FREE_TRIAL 3-branch limit
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(tenantSubscriptions)
          .set({ planCode: 'ENTERPRISE', status: 'ACTIVE', maxBranches: 50, maxDevices: 50 })
          .where(eq(tenantSubscriptions.tenantId, tenantId));
      });

      // 2. Second Legal Entity & Second Branch
      const le2 = await tenantService.createLegalEntity(sysCtx, {
        legalName: 'شركة التوسع الثانية ذ.م.م',
        commercialName: 'Expansion Entity LLC',
        vatNumber: '310666666600003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      });
      legalEntity2Id = le2.id;

      const br2 = await tenantService.createBranch(sysCtx, {
        legalEntityId: legalEntity1Id,
        code: 'BR-SFT-02',
        name: 'فرع جدة الثاني',
        businessType: 'RESTAURANT' as any,
      });
      branch2Id = br2.id;

      // 3. Create Open Fiscal Period for Legal Entity 1
      const currentYear = new Date().getFullYear();
      await accountingService.createFiscalPeriod(sysCtx, {
        legalEntityId: legalEntity1Id,
        periodName: `FY-${currentYear}`,
        startDate: `${currentYear}-01-01T00:00:00.000Z`,
        endDate: `${currentYear}-12-31T23:59:59.000Z`,
      });

      // 4. Create Complete Standard Chart of Accounts for Legal Entity 1
      await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '411000',
        name: 'إيرادات المبيعات',
        accountType: AccountType.REVENUE,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });
      await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '211200',
        name: 'ضريبة القيمة المضافة مخرجات',
        accountType: AccountType.LIABILITY,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });
      await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '511000',
        name: 'تكلفة البضاعة المباعة',
        accountType: AccountType.COGS,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '112000',
        name: 'المخزون',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const vaultAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '111100',
        name: 'نقدية الصندوق والخزينة',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      vaultAccountId = vaultAcc.id;

      const madaAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '111300',
        name: 'وسيط مدفوعات مدى',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      madaAccountId = madaAcc.id;

      const visaAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '111400',
        name: 'وسيط البطاقات الائتمانية',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      visaAccountId = visaAcc.id;

      const appleAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '111500',
        name: 'وسيط Apple Pay',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      applePayAccountId = appleAcc.id;

      const citAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '111900',
        name: 'نقدية في الطريق (Cash In Transit)',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      cashInTransitAccountId = citAcc.id;

      const genExpAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '519000',
        name: 'مصروفات تشغيلية ونثرية',
        accountType: AccountType.EXPENSE,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      generalExpenseAccountId = genExpAcc.id;

      const overShortAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '519100',
        name: 'عجز الصندوق والورديات (CASH_OVER_SHORT)',
        accountType: AccountType.EXPENSE,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      overShortAccountId = overShortAcc.id;

      const overageAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '419200',
        name: 'فائض وزيادة الصندوق والورديات (CASH_OVERAGE)',
        accountType: AccountType.OTHER_INCOME,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });
      overageAccountId = overageAcc.id;

      // Also create distinct Rounding Difference account to verify CASH_OVERAGE is independent
      await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '419100',
        name: 'فروقات التقريب (ROUNDING_DIFFERENCE)',
        accountType: AccountType.OTHER_INCOME,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });

      // 5. Create Vaults, Devices, Warehouse, and Product Item
      const v1 = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        code: `VLT1-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة كاشير فرع الرياض 1',
        accountId: vaultAccountId,
      });
      vault1Id = v1.id;

      const v2 = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        code: `VLT2-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة كاشير فرع جدة 2',
        accountId: vaultAccountId,
      });
      vault2Id = v2.id;

      // Initialize vault1 with 500.0000 SAR
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(cashVaults)
          .set({ balance: '500.0000' })
          .where(eq(cashVaults.id, vault1Id));

        await tx
          .update(cashVaults)
          .set({ balance: '500.0000' })
          .where(eq(cashVaults.id, vault2Id));
      });

      const d1 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceCode: `POS-SFT-01-${Date.now().toString().slice(-4)}`,
        name: 'نقطة بيع كاشير 1 - الرياض',
        deviceType: 'POS',
        cashVaultId: vault1Id,
      });
      device1Id = d1.id;

      const d2 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        deviceCode: `POS-SFT-02-${Date.now().toString().slice(-4)}`,
        name: 'نقطة بيع كاشير 2 - جدة',
        deviceType: 'POS',
        cashVaultId: vault2Id,
      });
      device2Id = d2.id;

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            code: `WH-SFT-${Date.now().toString().slice(-4)}`,
            name: 'المستودع الرئيسي',
          })
          .returning();
        warehouse1Id = wh.id;

        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({
            tenantId,
            code: `PCS-${Date.now().toString().slice(-4)}`,
            nameAr: 'قطعة',
            nameEn: 'Piece',
            category: 'UNIT',
            isBase: true,
          })
          .returning();
        uomPcsId = uom.id;

        const [itm] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntity1Id,
            sku: `SFT-ITM-${Date.now().toString().slice(-4)}`,
            nameAr: 'وجبة شاورما دجاج',
            nameEn: 'Chicken Shawarma Meal',
            itemType: 'FINISHED_GOOD',
            baseUomId: uomPcsId,
            defaultCost: '10.0000',
          })
          .returning();
        item1Id = itm.id;
      });
    }, 90000);

    afterAll(async () => {
      if (dbService) {
        await dbService.onModuleDestroy();
      }
    });

    it('1. Should close shift cleanly with zero variance (status CLOSED, expected=counted, metadata saved)', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '500.0000',
      });

      // Create cash order for 115.0000 SAR (100 + 15 VAT)
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-ZVAR-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            taxAmount: '15.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '115.0000' }],
      });

      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '615.0000',
        notes: 'مطابقة تامة بدون أي فرق',
      });

      expect(closed.status).toBe(ShiftStatus.CLOSED);
      expect(parseFloat(closed.expectedCash!)).toBe(615);
      expect(parseFloat(closed.countedCash!)).toBe(615);
      expect(parseFloat(closed.variance!)).toBe(0);
      expect(closed.closeJournalEntryId).toBeNull();
      expect(closed.journalEntry).toBeNull();
      expect(closed.closedBy).toBe(adminUserId);
      expect(closed.closedAt).toBeDefined();

      // Verify DB has 0 pos_shift_close journal entries for this shift
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceType, 'pos_shift_close'),
              eq(journalEntries.sourceId, shift.id)
            )
          );
        expect(jvs.length).toBe(0);

        const vtxs = await tx
          .select()
          .from(vaultTransactions)
          .where(
            and(
              eq(vaultTransactions.tenantId, tenantId),
              eq(vaultTransactions.sourceDocumentType, 'pos_shifts'),
              eq(vaultTransactions.sourceDocumentId, shift.id)
            )
          );
        expect(vtxs.length).toBe(0);
      });
    });

    it('2. Should handle cash deficit by posting balanced journal (Debit CASH_OVER_SHORT, Credit Cash Vault) & updating vault balance', async () => {
      let vaultBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        vaultBefore = parseFloat(v.balance);
      });

      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '500.0000',
      });

      // Counted cash is 475 -> expected 500 -> deficit -25.0000
      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '475.0000',
        notes: 'عجز نقدي 25 ريال',
      });

      expect(closed.status).toBe(ShiftStatus.CLOSED);
      expect(parseFloat(closed.expectedCash!)).toBe(500);
      expect(parseFloat(closed.countedCash!)).toBe(475);
      expect(parseFloat(closed.variance!)).toBe(-25);
      expect(closed.closeJournalEntryId).toBeTruthy();
      expect(closed.journalEntry).toBeDefined();
      expect(closed.journalEntry!.journalType).toBe(JournalType.CLOSING);
      expect(closed.journalEntry!.sourceType).toBe('pos_shift_close');
      expect(closed.journalEntry!.sourceId).toBe(shift.id);
      expect(parseFloat(closed.journalEntry!.debitTotal)).toBe(25);
      expect(parseFloat(closed.journalEntry!.creditTotal)).toBe(25);

      const debitOverShort = closed.journalEntry!.lines.find(
        (l: any) => l.accountId === overShortAccountId && parseFloat(l.debit) === 25
      );
      const creditVault = closed.journalEntry!.lines.find(
        (l: any) => l.accountId === vaultAccountId && parseFloat(l.credit) === 25
      );
      expect(debitOverShort).toBeDefined();
      expect(creditVault).toBeDefined();

      // Verify Cash Vault balance decreased by 25 and COUNT_VARIANCE transaction created
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        expect(parseFloat(v.balance)).toBe(vaultBefore - 25);

        const [vtx] = await tx
          .select()
          .from(vaultTransactions)
          .where(
            and(
              eq(vaultTransactions.tenantId, tenantId),
              eq(vaultTransactions.sourceDocumentType, 'pos_shifts'),
              eq(vaultTransactions.sourceDocumentId, shift.id)
            )
          );
        expect(vtx).toBeDefined();
        expect(vtx.transactionType).toBe('COUNT_VARIANCE');
        expect(parseFloat(vtx.amount)).toBe(25);
      });
    });

    it('3. Should handle cash surplus by posting balanced journal (Debit Cash Vault, Credit CASH_OVERAGE - NOT ROUNDING_DIFFERENCE)', async () => {
      let vaultBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        vaultBefore = parseFloat(v.balance);
      });

      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '500.0000',
      });

      // Counted cash is 530 -> expected 500 -> surplus +30.0000
      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '530.0000',
        notes: 'فائض نقدي 30 ريال',
      });

      expect(closed.status).toBe(ShiftStatus.CLOSED);
      expect(parseFloat(closed.variance!)).toBe(30);
      expect(closed.journalEntry).toBeDefined();
      expect(parseFloat(closed.journalEntry!.debitTotal)).toBe(30);
      expect(parseFloat(closed.journalEntry!.creditTotal)).toBe(30);

      const debitVault = closed.journalEntry!.lines.find(
        (l: any) => l.accountId === vaultAccountId && parseFloat(l.debit) === 30
      );
      const creditOverage = closed.journalEntry!.lines.find(
        (l: any) => l.accountId === overageAccountId && parseFloat(l.credit) === 30
      );
      expect(debitVault).toBeDefined();
      expect(creditOverage).toBeDefined();

      // Verify Vault balance increased by 30
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        expect(parseFloat(v.balance)).toBe(vaultBefore + 30);
      });
    });

    it('4. Should NOT create any journal entry or vault variance record when variance equals zero', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '150.0000',
      });

      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '150.0000',
      });

      expect(parseFloat(closed.variance!)).toBe(0);
      expect(closed.closeJournalEntryId).toBeNull();
      expect(closed.journalEntry).toBeNull();

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceType, 'pos_shift_close'),
              eq(journalEntries.sourceId, shift.id)
            )
          );
        expect(jvs.length).toBe(0);
      });
    });

    it('5. Should strictly exclude Mada, Credit Cards, and Apple Pay from expected cash', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '300.0000',
      });

      // Mada order: 115 SAR
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-MADA-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            taxAmount: '15.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.MADA, amount: '115.0000' }],
      });

      // Visa order: 230 SAR
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-VISA-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '2.0000',
            unitPrice: '100.0000',
            taxAmount: '30.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.VISA_MC, amount: '230.0000' }],
      });

      // Apple Pay order: 57.50 SAR
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-APAY-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '50.0000',
            taxAmount: '7.5000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.APPLE_PAY, amount: '57.5000' }],
      });

      // Cash order: 115 SAR
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-CSH-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            taxAmount: '15.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '115.0000' }],
      });

      const summary = await salesService.getShiftSummary(sysCtx, shift.id);
      expect(summary.breakdown.openingCash).toBe(300);
      expect(summary.breakdown.totalCashReceipts).toBe(115);
      expect(summary.breakdown.totalNonCashSales).toBe(402.5);
      expect(summary.breakdown.expectedCash).toBe(415);

      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '415.0000',
      });
      expect(parseFloat(closed.variance!)).toBe(0);
      expect(closed.closeJournalEntryId).toBeNull();
    });

    it('6. Should accurately compute cash change given (50 paid on 23 bill = +23 net), refunds, cash in & cash out', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '500.0000',
      });

      // Order grandTotal = 20 + 3 VAT = 23 SAR; customer tenders 50 SAR cash -> change 27 SAR
      const order = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-CHG-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
            taxAmount: '3.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '50.0000' }],
      });

      // Partial cash refund of 10 SAR
      await salesService.refundSalesOrder(sysCtx, order.id, {
        refundAmount: '10.0000',
        reason: 'استرجاع جزئي للعميل',
        approvedBy: adminUserId,
        paymentMethod: PaymentMethod.CASH,
        restockInventory: false,
      });

      // Approved inward cash transfer +100 SAR
      await salesService.recordShiftCashTransaction(sysCtx, {
        shiftId: shift.id,
        transactionType: ShiftCashTransactionType.CASH_IN,
        amount: '100.0000',
        reason: 'تغذية درج الكاشير من الخزينة',
      });

      // Approved outward cash expense -40 SAR
      await salesService.recordShiftCashTransaction(sysCtx, {
        shiftId: shift.id,
        transactionType: ShiftCashTransactionType.CASH_OUT,
        amount: '40.0000',
        reason: 'مصروف نثري معتمد لشراء ثلج',
      });

      // Formula: 500 (Open) + 50 (Gross Cash) - 27 (Change) - 10 (Refund) + 100 (Cash In) - 40 (Cash Out) = 573
      const summary = await salesService.getShiftSummary(sysCtx, shift.id);
      expect(summary.breakdown.openingCash).toBe(500);
      expect(summary.breakdown.totalCashReceipts).toBe(50);
      expect(summary.breakdown.totalCashChange).toBe(27);
      expect(summary.breakdown.totalCashRefunds).toBe(10);
      expect(summary.breakdown.totalCashIn).toBe(100);
      expect(summary.breakdown.totalCashOut).toBe(40);
      expect(summary.breakdown.expectedCash).toBe(573);

      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '573.0000',
      });
      expect(parseFloat(closed.expectedCash!)).toBe(573);
      expect(parseFloat(closed.variance!)).toBe(0);
      expect(parseFloat(closed.totalCashReceipts!)).toBe(50);
      expect(parseFloat(closed.totalCashChange!)).toBe(27);
      expect(parseFloat(closed.totalCashRefunds!)).toBe(10);
      expect(parseFloat(closed.totalCashIn!)).toBe(100);
      expect(parseFloat(closed.totalCashOut!)).toBe(40);
    });

    it('7. Should prevent double counting of receipts and exclude voided/cancelled orders from expected cash', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '200.0000',
      });

      // Active cash sale: 115 SAR
      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-ACT-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            taxAmount: '15.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '115.0000' }],
      });

      // Second cash sale: 115 SAR, subsequently voided!
      const voidOrder = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        shiftId: shift.id,
        orderNumber: `ORD-VOD-${Date.now().toString().slice(-6)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            taxAmount: '15.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '115.0000' }],
      });

      await salesService.voidSalesOrder(
        sysCtx,
        voidOrder.id,
        'إلغاء فاتورة نقدية',
        adminUserId,
        false
      );

      // Expected cash = 200 + 115 = 315 (NOT 200 + 115 + 115, and NOT double-counted from vault_transactions)
      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '315.0000',
      });
      expect(parseFloat(closed.expectedCash!)).toBe(315);
      expect(parseFloat(closed.variance!)).toBe(0);
    });

    it('8. Should prevent closing an already closed shift twice', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '100.0000',
      });

      await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '90.0000',
      });

      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shift.id,
          countedCash: '90.0000',
        })
      ).rejects.toThrow(BadRequestException);

      // Even with a different idempotencyKey, closing a closed shift must be rejected
      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shift.id,
          countedCash: '100.0000',
          idempotencyKey: `dup-${Date.now()}`,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('9. Should reject branch-scoped user attempting to close shift of another branch (ForbiddenException)', async () => {
      // Open shift in Branch 2
      const shiftBr2 = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        deviceId: device2Id,
        openingCash: '250.0000',
      });

      // User strictly scoped ONLY to Branch 1
      const branch1CashierCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'cashier-br1@restaurant-cloud.test',
        role: 'CASHIER',
        scopes: ['pos.shift.close'],
        userScopes: [{ scopeType: 'BRANCH', scopeId: branch1Id }],
      };

      await expect(
        salesService.closeShift(branch1CashierCtx, {
          shiftId: shiftBr2.id,
          countedCash: '250.0000',
        })
      ).rejects.toThrow(ForbiddenException);

      // Verify Branch 2 shift remains OPEN
      const stillOpen = await salesService.getActiveShift(sysCtx, device2Id);
      expect(stillOpen?.id).toBe(shiftBr2.id);

      // Clean up: authorized close for Branch 2
      await salesService.closeShift(sysCtx, {
        shiftId: shiftBr2.id,
        countedCash: '250.0000',
      });
    });

    it('10. Should enforce multi-tenant RLS & vault/branch/legal entity isolation', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '400.0000',
      });

      // Foreign Tenant B attempts to view or close Tenant A shift
      const foreignTenantCtx: TenantContext = {
        tenantId: randomUUID(),
        userId: randomUUID(),
        email: 'attacker@foreign-tenant.test',
        role: 'SUPER_ADMIN',
        scopes: ['*'],
      };

      await expect(
        salesService.closeShift(foreignTenantCtx, {
          shiftId: shift.id,
          countedCash: '400.0000',
        })
      ).rejects.toThrow(NotFoundException);

      // Create misconfigured device in branch1 pointing to branch2's vault -> must be rejected!
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(devices)
          .set({ cashVaultId: vault2Id })
          .where(eq(devices.id, device1Id));
        await tx
          .update(posShifts)
          .set({ cashVaultId: vault2Id })
          .where(eq(posShifts.id, shift.id));
      });

      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shift.id,
          countedCash: '390.0000',
        })
      ).rejects.toThrow(BadRequestException);

      // Restore correct vault1Id on device1 & shift and close cleanly
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(devices)
          .set({ cashVaultId: vault1Id })
          .where(eq(devices.id, device1Id));
        await tx
          .update(posShifts)
          .set({ cashVaultId: vault1Id })
          .where(eq(posShifts.id, shift.id));
      });

      await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '400.0000',
      });
    });

    it('11. Should follow Branch Override -> Company Mapping -> System Default priority & reject missing/invalid variance mapping', async () => {
      // Create custom over-short accounts for Company Mapping and Branch Override
      const companyOverShortAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '519101',
        name: 'عجز الصندوق المخصص للمنشأة',
        accountType: AccountType.EXPENSE,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const branchOverShortAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '519102',
        name: 'عجز الصندوق المخصص لفرع الرياض',
        accountType: AccountType.EXPENSE,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      // Set Company Mapping (519101) AND Branch Override (519102)
      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId: legalEntity1Id,
        mappingKey: DefaultAccountMappingKey.CASH_OVER_SHORT,
        accountId: companyOverShortAcc.id,
      });

      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.CASH_OVER_SHORT,
        accountId: branchOverShortAcc.id,
      });

      // Close shift on Branch 1 -> must use Branch Override (519102)
      const shift1 = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '100.0000',
      });
      const closed1 = await salesService.closeShift(sysCtx, {
        shiftId: shift1.id,
        countedCash: '95.0000',
      });
      const brOverrideLine = closed1.journalEntry!.lines.find(
        (l: any) => l.accountId === branchOverShortAcc.id
      );
      expect(brOverrideLine).toBeDefined();

      // Close shift on Branch 2 (no branch override) -> must use Company Mapping (519101)
      const shift2 = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        deviceId: device2Id,
        openingCash: '100.0000',
      });
      const closed2 = await salesService.closeShift(sysCtx, {
        shiftId: shift2.id,
        countedCash: '95.0000',
      });
      const compMappingLine = closed2.journalEntry!.lines.find(
        (l: any) => l.accountId === companyOverShortAcc.id
      );
      expect(compMappingLine).toBeDefined();

      // Clean up custom mappings so defaults remain active
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .delete(accountMappings)
          .where(
            and(
              eq(accountMappings.tenantId, tenantId),
              eq(accountMappings.legalEntityId, legalEntity1Id),
              eq(accountMappings.mappingKey, DefaultAccountMappingKey.CASH_OVER_SHORT)
            )
          );
      });

      // Test Missing / Invalid Variance Account Rejection on Legal Entity 2 (no COA accounts for variance)
      const brLE2 = await tenantService.createBranch(sysCtx, {
        legalEntityId: legalEntity2Id,
        code: 'BR-LE2-SFT',
        name: 'فرع الشركة الثانية',
        businessType: 'RESTAURANT' as any,
      });
      await accountingService.createFiscalPeriod(sysCtx, {
        legalEntityId: legalEntity2Id,
        periodName: `FY-${new Date().getFullYear()}`,
        startDate: `${new Date().getFullYear()}-01-01T00:00:00.000Z`,
        endDate: `${new Date().getFullYear()}-12-31T23:59:59.000Z`,
      });
      const vaultAccLE2 = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity2Id,
        accountCode: '111100',
        name: 'خزينة الشركة الثانية',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      const vLE2 = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId: legalEntity2Id,
        branchId: brLE2.id,
        code: `VLT-LE2-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة LE2',
        accountId: vaultAccLE2.id,
      });
      const dLE2 = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId: legalEntity2Id,
        branchId: brLE2.id,
        deviceCode: `DEV-LE2-${Date.now().toString().slice(-4)}`,
        name: 'جهاز LE2',
        deviceType: 'POS',
        cashVaultId: vLE2.id,
      });

      const shiftLE2 = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity2Id,
        branchId: brLE2.id,
        deviceId: dLE2.id,
        openingCash: '100.0000',
      });

      // Attempting deficit close on LE2 where CASH_OVER_SHORT is completely absent -> MUST REJECT
      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shiftLE2.id,
          countedCash: '90.0000',
        })
      ).rejects.toThrow(BadRequestException);

      // Attempting surplus close on LE2 where CASH_OVERAGE is completely absent -> MUST REJECT
      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shiftLE2.id,
          countedCash: '110.0000',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('12. Should perform complete atomic rollback when posting fails (e.g., inactive CASH_OVERAGE account)', async () => {
      let vaultBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        vaultBefore = parseFloat(v.balance);

        // Temporarily deactivate overage account 419200
        await tx
          .update(chartOfAccounts)
          .set({ status: 'INACTIVE' })
          .where(eq(chartOfAccounts.id, overageAccountId));
      });

      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '200.0000',
      });

      // Surplus +15.0000 fails because CASH_OVERAGE account is INACTIVE
      await expect(
        salesService.closeShift(sysCtx, {
          shiftId: shift.id,
          countedCash: '215.0000',
        })
      ).rejects.toThrow(BadRequestException);

      // Verify FULL ROLLBACK: Shift still OPEN, Vault balance unchanged, 0 JV, 0 VaultTx
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [s] = await tx.select().from(posShifts).where(eq(posShifts.id, shift.id));
        expect(s.status).toBe(ShiftStatus.OPEN);
        expect(s.closedAt).toBeNull();
        expect(s.closeJournalEntryId).toBeNull();

        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        expect(parseFloat(v.balance)).toBe(vaultBefore);

        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceType, 'pos_shift_close'),
              eq(journalEntries.sourceId, shift.id)
            )
          );
        expect(jvs.length).toBe(0);

        const vtxs = await tx
          .select()
          .from(vaultTransactions)
          .where(
            and(
              eq(vaultTransactions.tenantId, tenantId),
              eq(vaultTransactions.sourceDocumentType, 'pos_shifts'),
              eq(vaultTransactions.sourceDocumentId, shift.id)
            )
          );
        expect(vtxs.length).toBe(0);

        // Re-activate overage account 419200
        await tx
          .update(chartOfAccounts)
          .set({ status: 'ACTIVE' })
          .where(eq(chartOfAccounts.id, overageAccountId));
      });

      // Now close cleanly
      await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '215.0000',
      });
    });

    it('13. Should ensure idempotent retry protection prevents duplicate journal entries on same idempotencyKey', async () => {
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        openingCash: '300.0000',
      });

      const idemKey = `idem-close-${randomUUID()}`;
      const firstResult = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '285.0000',
        idempotencyKey: idemKey,
      });

      expect(firstResult.status).toBe(ShiftStatus.CLOSED);
      expect(firstResult.closeJournalEntryId).toBeTruthy();

      // Exact network retry with same idempotencyKey
      const retryResult: any = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '285.0000',
        idempotencyKey: idemKey,
      });

      expect(retryResult.isIdempotentReplay).toBe(true);
      expect(retryResult.closeJournalEntryId).toBe(firstResult.closeJournalEntryId);

      // Confirm only 1 journal entry and 1 vault transaction exist for this shift
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceType, 'pos_shift_close'),
              eq(journalEntries.sourceId, shift.id)
            )
          );
        expect(jvs.length).toBe(1);

        const vtxs = await tx
          .select()
          .from(vaultTransactions)
          .where(
            and(
              eq(vaultTransactions.tenantId, tenantId),
              eq(vaultTransactions.sourceDocumentType, 'pos_shifts'),
              eq(vaultTransactions.sourceDocumentId, shift.id)
            )
          );
        expect(vtxs.length).toBe(1);
      });
    });

    it('14. Should guarantee Cash Vault Ledger strictly matches General Ledger Control Account & listShifts filtering works', async () => {
      // Dedicated Branch, dedicated Cash Vault GL Account, dedicated Cash Vault, and Device
      const brRecon = await tenantService.createBranch(sysCtx, {
        legalEntityId: legalEntity1Id,
        code: `BR-REC-${Date.now().toString().slice(-4)}`,
        name: 'فرع المطابقة المحاسبية',
        businessType: 'RESTAURANT' as any,
      });

      const reconVaultAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: `1111${Date.now().toString().slice(-2)}`,
        name: 'خزينة فرع المطابقة المستقلة',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const equityOpenAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: `3110${Date.now().toString().slice(-2)}`,
        name: 'أرصدة افتتاحية للخزينة',
        accountType: AccountType.EQUITY,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });

      const reconVault = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: brRecon.id,
        code: `VLT-REC-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة المطابقة',
        accountId: reconVaultAcc.id,
      });

      const reconDev = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: brRecon.id,
        deviceCode: `DEV-REC-${Date.now().toString().slice(-4)}`,
        name: 'جهاز المطابقة',
        deviceType: 'POS',
        cashVaultId: reconVault.id,
      });

      // Seed Opening Balance = 1000.0000 in BOTH Cash Vault & GL
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(cashVaults)
          .set({ balance: '1000.0000' })
          .where(eq(cashVaults.id, reconVault.id));

        await postingEngine.postEntry(
          sysCtx,
          {
            legalEntityId: legalEntity1Id,
            branchId: brRecon.id,
            journalNumber: `JV-OPN-${Date.now().toString().slice(-5)}`,
            journalType: JournalType.OPENING,
            sourceType: 'opening_balance',
            sourceId: reconVault.id,
            description: 'رصيد افتتاحي لخزينة فرع المطابقة',
            lines: [
              { accountId: reconVaultAcc.id, debit: '1000.0000', credit: '0.0000' },
              { accountId: equityOpenAcc.id, debit: '0.0000', credit: '1000.0000' },
            ],
          },
          tx
        );
      });

      // Open Shift with 1000.0000
      const shift = await salesService.openShift(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: brRecon.id,
        deviceId: reconDev.id,
        openingCash: '1000.0000',
      });

      // 1. Cash Sale: Bill = 69 (60 + 9 VAT), customer pays 100 -> Change 31 -> Net +69
      const ord1 = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: brRecon.id,
        deviceId: reconDev.id,
        shiftId: shift.id,
        orderNumber: `ORD-REC-1-${Date.now().toString().slice(-5)}`,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: item1Id,
            uomId: uomPcsId,
            quantity: '3.0000',
            unitPrice: '20.0000',
            taxAmount: '9.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: '100.0000' }],
      });

      // 2. Partial Cash Refund: -15.0000
      await salesService.refundSalesOrder(sysCtx, ord1.id, {
        refundAmount: '15.0000',
        reason: 'استرجاع جزئي',
        approvedBy: adminUserId,
        paymentMethod: PaymentMethod.CASH,
        restockInventory: false,
      });

      // 3. Shift Cash In: +200.0000, Cash Out: -50.0000
      await salesService.recordShiftCashTransaction(sysCtx, {
        shiftId: shift.id,
        transactionType: ShiftCashTransactionType.CASH_IN,
        amount: '200.0000',
        reason: 'تغذية الصندوق',
      });
      await salesService.recordShiftCashTransaction(sysCtx, {
        shiftId: shift.id,
        transactionType: ShiftCashTransactionType.CASH_OUT,
        amount: '50.0000',
        reason: 'مصروف تشغيلي معتمد',
      });

      // Expected Cash = 1000 + 69 - 15 + 200 - 50 = 1204.0000
      // Close with Counted Cash = 1184.0000 (Deficit -20.0000)
      const closed = await salesService.closeShift(sysCtx, {
        shiftId: shift.id,
        countedCash: '1184.0000',
      });

      expect(parseFloat(closed.expectedCash!)).toBe(1204);
      expect(parseFloat(closed.variance!)).toBe(-20);

      // Verify Vault Ledger == General Ledger == 1184.0000
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [vault] = await tx
          .select()
          .from(cashVaults)
          .where(eq(cashVaults.id, reconVault.id));
        expect(parseFloat(vault.balance)).toBe(1184);

        const [glAgg] = await tx
          .select({
            netBalance: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.legalEntityId, legalEntity1Id),
              eq(journalLines.accountId, reconVaultAcc.id)
            )
          );

        expect(parseFloat(glAgg.netBalance)).toBe(1184);
        expect(parseFloat(glAgg.netBalance)).toBe(parseFloat(vault.balance));
      });

      // Verify Shift History Search & Filters (`listShifts`)
      const filteredByVault = await salesService.listShifts(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: brRecon.id,
        deviceId: reconDev.id,
        cashVaultId: reconVault.id,
        status: ShiftStatus.CLOSED,
      });
      expect(filteredByVault.length).toBe(1);
      expect(filteredByVault[0].id).toBe(shift.id);
      expect(filteredByVault[0].journalNumber).toBeTruthy();
      expect(filteredByVault[0].vaultName).toBe('خزينة المطابقة');
    });
  }
);
