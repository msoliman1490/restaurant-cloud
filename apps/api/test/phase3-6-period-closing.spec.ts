import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { ReconciliationService } from '../src/modules/accounting/reconciliation.service';
import { PeriodClosingService } from '../src/modules/accounting/period-closing.service';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalType,
  FiscalPeriodStatus,
  PeriodClosingAction,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  journalEntries,
  journalLines,
  branches,
  legalEntities,
  devices,
  posShifts,
  settlementProviders,
  settlementBatches,
  financialReconciliationRuns,
  financialReconciliationItems,
  fiscalYears,
  fiscalPeriods,
  fiscalPeriodClosingLogs,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';

describe(
  'Restaurant Cloud — Phase 3.6: Financial Period Closing Engine',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let reconciliationService: ReconciliationService;
    let periodClosingService: PeriodClosingService;
    let opsFramework: OperationsFrameworkService;

    let tenantId: string;
    let tenantBId: string;
    let le1Id: string;
    let le2Id: string;
    let branch1Id: string;
    let branch2Id: string;
    let userId: string;

    let ctxAdmin: TenantContext;
    let ctxTenantB: TenantContext;
    let ctxBranch1Only: TenantContext;

    let cashAccountId: string;
    let revenueAccountId: string;
    let janPeriodId: string;
    let febPeriodId: string;
    let postedJournalId: string;

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }
      dbService = new DatabaseService();
      await dbService.onModuleInit();
      auditService = new AuditService(dbService);
      opsFramework = new OperationsFrameworkService(dbService);
      postingEngine = new PostingEngineService(dbService, auditService);
      accountingService = new AccountingService(
        dbService,
        auditService,
        postingEngine,
        opsFramework,
      );
      reconciliationService = new ReconciliationService(
        dbService,
        auditService,
        opsFramework,
      );
      periodClosingService = new PeriodClosingService(
        dbService,
        auditService,
        opsFramework,
        accountingService,
        reconciliationService,
      );
      tenantService = new TenantService(dbService, auditService);

      const suffix = Date.now().toString(36).slice(-6);
      const t1 = await tenantService.onboardTenant({
        code: `p36a-${suffix}`,
        displayName: `Phase 3.6 Alpha ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'P36 Alpha Foods Co',
          commercialName: 'P36 Alpha',
          vatNumber: '310999999900036',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR1',
          name: 'Main Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p36-admin-${suffix}@test.local`,
          displayName: 'P36 Admin',
          password: 'Password123!Secure',
        },
      } as any);

      tenantId = t1.tenant.id;
      le1Id = t1.legalEntity.id;
      branch1Id = t1.branch.id;
      userId = t1.user.id;

      ctxAdmin = {
        tenantId,
        userId,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantId }],
      } as any;

      ctxBranch1Only = {
        tenantId,
        userId,
        role: 'BRANCH_MANAGER',
        scopes: ['accounting.period.view'],
        userScopes: [{ scopeType: 'BRANCH', scopeEntityId: branch1Id }],
      } as any;

      const t2 = await tenantService.onboardTenant({
        code: `p36b-${suffix}`,
        displayName: `Phase 3.6 Beta ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'P36 Beta Foods Co',
          commercialName: 'P36 Beta',
          vatNumber: '310999999900037',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BRB1',
          name: 'Beta Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p36b-admin-${suffix}@test.local`,
          displayName: 'P36B Admin',
          password: 'Password123!Secure',
        },
      } as any);

      tenantBId = t2.tenant.id;
      ctxTenantB = {
        tenantId: tenantBId,
        userId: t2.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantBId }],
      } as any;

      // Create second legal entity + second branch in Tenant 1
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [le2] = await tx
          .insert(legalEntities)
          .values({
            tenantId,
            legalName: 'P36 Second Entity',
            commercialName: 'P36 Second',
            vatNumber: '310999999900038',
            functionalCurrency: 'SAR',
            timezone: 'Asia/Riyadh',
          })
          .returning();
        le2Id = le2.id;

        const [b2] = await tx
          .insert(branches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            code: 'BR2',
            name: 'Second Branch',
            businessType: 'RESTAURANT',
          })
          .returning();
        branch2Id = b2.id;

        const [cashAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            accountCode: '1101',
            name: 'Cash',
            nameAr: 'النقدية',
            accountType: AccountType.ASSET,
            normalBalance: NormalBalance.DEBIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        cashAccountId = cashAcc.id;

        const [revAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            accountCode: '4101',
            name: 'Sales Revenue',
            nameAr: 'إيرادات المبيعات',
            accountType: AccountType.REVENUE,
            normalBalance: NormalBalance.CREDIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        revenueAccountId = revAcc.id;
      });
    }, 120000);

    afterAll(async () => {
      await dbService.onModuleDestroy();
    }, 30000);

    it('1. Creates a fiscal year with 12 monthly periods and prevents overlapping years/periods', async () => {
      const created = await periodClosingService.createFiscalYear(ctxAdmin, {
        legalEntityId: le1Id,
        yearCode: 'FY2028',
        yearName: 'السنة المالية 2028',
        startDate: '2028-01-01',
        endDate: '2028-12-31',
        generateMonthlyPeriods: true,
      });

      expect(created.fiscalYear.yearCode).toBe('FY2028');
      expect(created.periods.length).toBe(12);
      janPeriodId = created.periods[0].id;
      febPeriodId = created.periods[1].id;

      // Overlapping fiscal year should fail
      await expect(
        periodClosingService.createFiscalYear(ctxAdmin, {
          legalEntityId: le1Id,
          yearCode: 'FY2028-DUP',
          yearName: 'Overlap',
          startDate: '2028-06-01',
          endDate: '2029-05-31',
        }),
      ).rejects.toThrow(ConflictException);

      // Overlapping fiscal period should fail
      await expect(
        periodClosingService.createFiscalPeriod(ctxAdmin, {
          legalEntityId: le1Id,
          periodName: '2028-OVERLAP',
          startDate: '2028-01-15',
          endDate: '2028-02-15',
        }),
      ).rejects.toThrow(ConflictException);

      // Duplicate period name should fail
      await expect(
        periodClosingService.createFiscalPeriod(ctxAdmin, {
          legalEntityId: le1Id,
          periodName: 'FY2028-P01',
          startDate: '2029-01-01',
          endDate: '2029-01-31',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('2. Supports server-side pagination on fiscal periods list', async () => {
      const page1 = await periodClosingService.listFiscalPeriods(ctxAdmin, {
        legalEntityId: le1Id,
        page: 1,
        limit: 5,
      });
      const page2 = await periodClosingService.listFiscalPeriods(ctxAdmin, {
        legalEntityId: le1Id,
        page: 2,
        limit: 5,
      });
      expect(page1.data.length).toBe(5);
      expect(page2.data.length).toBe(5);
      expect(page1.total).toBe(12);
      expect(page1.totalPages).toBe(3);
    });

    it('3. Blocks closing when unposted journals, open shifts, pending settlements, or unresolved discrepancies exist', async () => {
      // Seed a posted journal in Jan 2028 first
      const posted = await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        journalNumber: 'JE-P36-JAN-001',
        journalType: JournalType.GENERAL,
        sourceType: 'MANUAL',
        sourceId: randomUUID(),
        entryDate: new Date('2028-01-10T12:00:00Z'),
        description: 'Valid January Sale',
        lines: [
          { accountId: cashAccountId, debit: '500.0000', credit: '0.0000' },
          { accountId: revenueAccountId, debit: '0.0000', credit: '500.0000' },
        ],
      });
      postedJournalId = posted.id;

      // Seed blockers: DRAFT journal, OPEN POS shift, PENDING settlement batch
      let draftJournalId = '';
      let openShiftId = '';
      let pendingBatchId = '';

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [dj] = await tx
          .insert(journalEntries)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            fiscalPeriodId: janPeriodId,
            journalNumber: 'JE-DRAFT-P36',
            journalType: JournalType.GENERAL,
            sourceType: 'MANUAL',
            sourceId: randomUUID(),
            documentDate: new Date('2028-01-15T10:00:00Z'),
            entryDate: new Date('2028-01-15T10:00:00Z'),
            status: 'DRAFT',
            debitTotal: '100.0000',
            creditTotal: '100.0000',
          })
          .returning();
        draftJournalId = dj.id;

        const [dev] = await tx
          .insert(devices)
          .values({
            tenantId,
            branchId: branch1Id,
            deviceCode: 'POS-P36',
            name: 'POS P36',
            deviceType: 'POS',
            status: 'ACTIVE',
          })
          .returning();

        const [sh] = await tx
          .insert(posShifts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            deviceId: dev.id,
            cashierId: userId,
            status: 'OPEN',
            openedAt: new Date('2028-01-16T08:00:00Z'),
            openingCash: '100.0000',
          })
          .returning();
        openShiftId = sh.id;

        const [prov] = await tx
          .insert(settlementProviders)
          .values({
            tenantId,
            legalEntityId: le1Id,
            code: 'MADA-P36',
            nameAr: 'مدى P36',
            nameEn: 'Mada P36',
            category: 'PAYMENT_GATEWAY',
            clearingMappingKey: 'CARD_CLEARING',
            feeMappingKey: 'BANK_FEES',
          })
          .returning();

        const [sb] = await tx
          .insert(settlementBatches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            providerId: prov.id,
            batchNumber: 'SB-P36-01',
            settlementType: 'PAYMENT_GATEWAY',
            settlementDate: new Date('2028-01-17T00:00:00Z'),
            status: 'DRAFT',
            grossAmount: '200.0000',
            feeAmount: '2.0000',
            netExpectedAmount: '198.0000',
          })
          .returning();
        pendingBatchId = sb.id;
      });

      try {
        const pre = await periodClosingService.runPreClosingChecks(ctxAdmin, janPeriodId);
        expect(pre.canClose).toBe(false);
        expect(pre.blockersCount).toBeGreaterThanOrEqual(2);

        const pendingPage = await periodClosingService.getPendingItemsReport(ctxAdmin, janPeriodId, {
          page: 1,
          limit: 10,
        });
        expect(pendingPage.total).toBeGreaterThanOrEqual(3);

        await expect(
          periodClosingService.closeFiscalPeriod(ctxAdmin, { periodId: janPeriodId }),
        ).rejects.toThrow(BadRequestException);
      } finally {
        // Clean up blockers
        await dbService.withTenantContext(ctxAdmin, async (tx) => {
          await tx
            .update(journalEntries)
            .set({ status: 'VOIDED' })
            .where(eq(journalEntries.id, draftJournalId));
          await tx
            .update(posShifts)
            .set({ status: 'CLOSED', closedAt: new Date('2028-01-16T20:00:00Z') })
            .where(eq(posShifts.id, openShiftId));
          await tx
            .update(settlementBatches)
            .set({ status: 'POSTED' })
            .where(eq(settlementBatches.id, pendingBatchId));
        });
      }
    });

    it('4. Closes clean period, persists snapshot & logs, and blocks posting/backdated entries into closed period', async () => {
      const closeRes = await periodClosingService.closeFiscalPeriod(ctxAdmin, {
        periodId: janPeriodId,
        notes: 'Monthly Jan 2028 close',
        idempotencyKey: 'close-jan-2028-v1',
      });

      expect(closeRes.period.status).toBe(FiscalPeriodStatus.CLOSED);
      expect(closeRes.log.action).toBe(PeriodClosingAction.CLOSED);
      expect(closeRes.idempotentHit).toBe(false);

      // Idempotent retry
      const retryRes = await periodClosingService.closeFiscalPeriod(ctxAdmin, {
        periodId: janPeriodId,
        idempotencyKey: 'close-jan-2028-v1',
      });
      expect(retryRes.idempotentHit).toBe(true);

      // Final Trial Balance report returns CLOSING_SNAPSHOT
      const finalTb = await periodClosingService.getFinalTrialBalanceReport(ctxAdmin, janPeriodId);
      expect(finalTb.source).toBe('CLOSING_SNAPSHOT');
      expect(finalTb.trialBalance.grandTotals.isBalanced).toBe(true);

      // Posting into CLOSED period must be blocked (backdated entry inside Jan 2028)
      await expect(
        postingEngine.postEntry(ctxAdmin, {
          legalEntityId: le1Id,
          branchId: branch1Id,
          journalNumber: 'JE-P36-JAN-BLOCKED',
          journalType: JournalType.GENERAL,
          sourceType: 'MANUAL',
          sourceId: randomUUID(),
          entryDate: new Date('2028-01-25T12:00:00Z'),
          description: 'Backdated attempt in closed period',
          lines: [
            { accountId: cashAccountId, debit: '10.0000', credit: '0.0000' },
            { accountId: revenueAccountId, debit: '0.0000', credit: '10.0000' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      // Posting into CLOSING period must also be blocked
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(fiscalPeriods)
          .set({ status: FiscalPeriodStatus.CLOSING })
          .where(eq(fiscalPeriods.id, febPeriodId));
      });
      await expect(
        postingEngine.postEntry(ctxAdmin, {
          legalEntityId: le1Id,
          branchId: branch1Id,
          journalNumber: 'JE-P36-FEB-CLOSING',
          journalType: JournalType.GENERAL,
          sourceType: 'MANUAL',
          sourceId: randomUUID(),
          entryDate: new Date('2028-02-10T12:00:00Z'),
          description: 'Attempt in CLOSING period',
          lines: [
            { accountId: cashAccountId, debit: '10.0000', credit: '0.0000' },
            { accountId: revenueAccountId, debit: '0.0000', credit: '10.0000' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(fiscalPeriods)
          .set({ status: FiscalPeriodStatus.OPEN })
          .where(eq(fiscalPeriods.id, febPeriodId));
      });
    });

    it('5. Enforces independent reopen permission, mandatory reason, immutable logs, and preserves historical journals', async () => {
      // Verify controller metadata for reopen endpoint uses independent permission
      const perms = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AccountingController.prototype.reopenFiscalPeriod,
      );
      expect(perms).toEqual(['accounting.period.reopen']);

      // Missing / short reason rejected
      await expect(
        periodClosingService.reopenFiscalPeriod(ctxAdmin, {
          periodId: janPeriodId,
          reason: 'no',
        }),
      ).rejects.toThrow(BadRequestException);

      // Valid reopen
      const reopenRes = await periodClosingService.reopenFiscalPeriod(ctxAdmin, {
        periodId: janPeriodId,
        reason: 'Adjustment entry required for January accrual',
        idempotencyKey: 'reopen-jan-2028-v1',
      });
      expect(reopenRes.period.status).toBe(FiscalPeriodStatus.OPEN);
      expect(reopenRes.log.action).toBe(PeriodClosingAction.REOPENED);

      // Historical posted journal remains untouched
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [je] = await tx
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.id, postedJournalId));
        expect(je).toBeDefined();
        expect(je!.status).toBe('POSTED');
        expect(Number(je!.debitTotal)).toBe(500);
      });

      // Posting allowed again after reopen
      const postAfterReopen = await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        journalNumber: 'JE-P36-JAN-REOPEN-002',
        journalType: JournalType.GENERAL,
        sourceType: 'MANUAL',
        sourceId: randomUUID(),
        entryDate: new Date('2028-01-28T12:00:00Z'),
        description: 'Post-reopen accrual',
        lines: [
          { accountId: cashAccountId, debit: '25.0000', credit: '0.0000' },
          { accountId: revenueAccountId, debit: '0.0000', credit: '25.0000' },
        ],
      });
      expect(postAfterReopen.status).toBe('POSTED');

      // Closing logs pagination
      const logs = await periodClosingService.getClosingLogs(ctxAdmin, {
        legalEntityId: le1Id,
        periodId: janPeriodId,
        page: 1,
        limit: 10,
      });
      expect(logs.total).toBeGreaterThanOrEqual(2);
    });

    it('6. Enforces Tenant, LegalEntity, Branch isolation, RLS, and log immutability', async () => {
      // Cross-tenant isolation
      await expect(
        periodClosingService.runPreClosingChecks(ctxTenantB, janPeriodId),
      ).rejects.toThrow(NotFoundException);

      await expect(
        periodClosingService.listFiscalPeriods(ctxTenantB, { legalEntityId: le1Id }),
      ).rejects.toThrow(NotFoundException);

      // Branch isolation
      await expect(
        periodClosingService.runPreClosingChecks(ctxBranch1Only, janPeriodId, branch2Id),
      ).rejects.toThrow(ForbiddenException);

      // RLS verification: Tenant B session cannot read Tenant A rows in fiscal_years or fiscal_period_closing_logs
      await dbService.withTenantContext(ctxTenantB, async (tx) => {
        const fyRows = await tx
          .select()
          .from(fiscalYears)
          .where(eq(fiscalYears.legalEntityId, le1Id));
        expect(fyRows.length).toBe(0);

        const logRows = await tx
          .select()
          .from(fiscalPeriodClosingLogs)
          .where(eq(fiscalPeriodClosingLogs.periodId, janPeriodId));
        expect(logRows.length).toBe(0);
      });

      // Immutability of fiscal_period_closing_logs for rc_app_user (no UPDATE / DELETE)
      await expect(
        dbService.withTenantContext(ctxAdmin, async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE rc_app_user`);
          await tx
            .update(fiscalPeriodClosingLogs)
            .set({ reason: 'TAMPERED' })
            .where(eq(fiscalPeriodClosingLogs.periodId, janPeriodId));
        }),
      ).rejects.toThrow();
    });
  },
);
