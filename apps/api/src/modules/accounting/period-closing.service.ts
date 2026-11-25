import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  TenantContext,
  FiscalPeriodStatus,
  FiscalYearStatus,
  PeriodClosingAction,
  ClosingCheckSeverity,
  JournalStatus,
  JournalType,
  AccountType,
  DefaultAccountMappingKey,
  ReconciliationStatus,
  TransferDiscrepancyStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  fiscalYears,
  fiscalPeriods,
  fiscalPeriodClosingLogs,
  fiscalYearOpeningBalances,
  fiscalYearOpeningSnapshots,
  journalEntries,
  journalLines,
  chartOfAccounts,
  accountMappings,
  posShifts,
  settlementBatches,
  stockTransfers,
  stockTransferDiscrepancies,
  paymentVouchers,
  receiptVouchers,
  arInvoices,
  apInvoices,
  partnerBalances,
  supplierBalances,
  inventoryBalances,
  items,
  legalEntities,
  branches,
} from '@restaurant-cloud/database';
import { eq, and, gte, lte, desc, asc, sql, inArray, ne } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { DocumentNumberingService } from '../../common/operations/document-numbering.service';
import { AccountingService } from './accounting.service';
import { ReconciliationService } from './reconciliation.service';
import { PostingEngineService } from './posting-engine.service';

export interface PreClosingCheckItem {
  code: string;
  title: string;
  severity: ClosingCheckSeverity;
  count: number;
  message: string;
  details?: any;
}

@Injectable()
export class PeriodClosingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly accountingService: AccountingService,
    private readonly reconciliationService: ReconciliationService,
    @Optional() private readonly postingEngine?: PostingEngineService,
    @Optional() private readonly documentNumbering?: DocumentNumberingService,
  ) {}

  private async verifyEntityScope(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    branchId?: string,
  ) {
    const [le] = await tx
      .select({ id: legalEntities.id, legalName: legalEntities.legalName })
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.id, legalEntityId)))
      .limit(1);
    if (!le) {
      throw new NotFoundException(`المنشأة القانونية '${legalEntityId}' غير موجودة`);
    }

    if (branchId) {
      const [br] = await tx
        .select({ id: branches.id, legalEntityId: branches.legalEntityId })
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, branchId)))
        .limit(1);
      if (!br || br.legalEntityId !== legalEntityId) {
        throw new BadRequestException('الفرع المحدد لا ينتمي للمنشأة القانونية المحددة');
      }
    }

    await this.opsFramework.verifyScope(context, context.userScopes || [], {
      legalEntityId,
      branchId,
    });

    if (!branchId && !(context.scopes || []).includes('*')) {
      const scopes = context.userScopes || [];
      const hasBroadScope = scopes.some((s) => s.scopeType === 'TENANT' || s.scopeType === 'LEGAL_ENTITY');
      if (scopes.length > 0 && !hasBroadScope) {
        throw new ForbiddenException(
          'المستخدم المقيد بفرع لا يمكنه تنفيذ عمليات إقفال على مستوى المنشأة القانونية بالكامل.',
        );
      }
    }

    return le;
  }

  private async getPeriodAndVerifyScope(
    tx: any,
    context: TenantContext,
    periodId: string,
    branchId?: string,
    forUpdate = false,
  ) {
    const query = tx
      .select()
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.tenantId, context.tenantId), eq(fiscalPeriods.id, periodId)))
      .limit(1);

    const [period] = forUpdate ? await query.for('update') : await query;
    if (!period) {
      throw new NotFoundException('الفترة المالية غير موجودة');
    }

    await this.verifyEntityScope(tx, context, period.legalEntityId, branchId);
    return period;
  }

  // ==================================================================
  // 1. Fiscal Years & Periods Management
  // ==================================================================

  async createFiscalYear(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      yearCode: string;
      yearName: string;
      startDate: string;
      endDate: string;
      generateMonthlyPeriods?: boolean;
    },
  ) {
    const startDt = new Date(dto.startDate);
    const endDt = new Date(dto.endDate);
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime()) || startDt >= endDt) {
      throw new BadRequestException('تاريخ بداية السنة المالية يجب أن يكون قبل تاريخ النهاية');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, dto.legalEntityId);

      const [dupCode] = await tx
        .select({ id: fiscalYears.id })
        .from(fiscalYears)
        .where(
          and(
            eq(fiscalYears.tenantId, context.tenantId),
            eq(fiscalYears.legalEntityId, dto.legalEntityId),
            eq(fiscalYears.yearCode, dto.yearCode),
          ),
        )
        .limit(1);
      if (dupCode) {
        throw new ConflictException(`السنة المالية '${dto.yearCode}' مسجلة مسبقاً`);
      }

      const [overlap] = await tx
        .select({ id: fiscalYears.id, yearCode: fiscalYears.yearCode })
        .from(fiscalYears)
        .where(
          and(
            eq(fiscalYears.tenantId, context.tenantId),
            eq(fiscalYears.legalEntityId, dto.legalEntityId),
            lte(fiscalYears.startDate, endDt),
            gte(fiscalYears.endDate, startDt),
          ),
        )
        .limit(1);
      if (overlap) {
        throw new ConflictException(`تتداخل تواريخ السنة المالية مع السنة '${overlap.yearCode}'`);
      }

      const [fy] = await tx
        .insert(fiscalYears)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          yearCode: dto.yearCode,
          yearName: dto.yearName,
          startDate: startDt,
          endDate: endDt,
          status: FiscalYearStatus.OPEN,
          createdBy: context.userId,
        })
        .returning();

      if (!fy) {
        throw new BadRequestException('Failed to create fiscal year');
      }

      const generatedPeriods: any[] = [];
      if (dto.generateMonthlyPeriods) {
        let cur = new Date(Date.UTC(startDt.getUTCFullYear(), startDt.getUTCMonth(), 1));
        let idx = 1;
        while (cur <= endDt && idx <= 12) {
          const pStart = new Date(cur);
          const pEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59, 999));
          const clampedEnd = pEnd > endDt ? endDt : pEnd;
          const periodName = `${dto.yearCode}-P${String(idx).padStart(2, '0')}`;

          const [p] = await tx
            .insert(fiscalPeriods)
            .values({
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              fiscalYearId: fy.id,
              periodNumber: idx,
              periodName,
              startDate: pStart,
              endDate: clampedEnd,
              status: FiscalPeriodStatus.OPEN,
            })
            .returning();
          generatedPeriods.push(p);

          cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
          idx++;
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'FISCAL_YEAR_CREATED',
          entityType: 'fiscal_year',
          entityId: fy.id,
          afterState: { yearCode: fy.yearCode, periodsGenerated: generatedPeriods.length },
        },
        tx,
      );

      return { fiscalYear: fy, periods: generatedPeriods };
    });
  }

  async listFiscalYears(
    context: TenantContext,
    params: { legalEntityId: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const cond = and(
        eq(fiscalYears.tenantId, context.tenantId),
        eq(fiscalYears.legalEntityId, params.legalEntityId),
      );
      const fyCountRows = await tx.select({ cnt: sql<number>`count(*)::int` }).from(fiscalYears).where(cond);
      const cnt = fyCountRows[0]?.cnt ?? 0;
      const rows = await tx
        .select()
        .from(fiscalYears)
        .where(cond)
        .orderBy(desc(fiscalYears.startDate))
        .limit(limit)
        .offset(offset);

      return { data: rows, total: cnt, page, limit, totalPages: Math.ceil(cnt / limit) };
    });
  }

  async createFiscalPeriod(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      fiscalYearId?: string;
      periodNumber?: number;
      periodName: string;
      startDate: string;
      endDate: string;
    },
  ) {
    const startDt = new Date(dto.startDate);
    const endDt = new Date(dto.endDate);
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime()) || startDt >= endDt) {
      throw new BadRequestException('تاريخ بداية الفترة المالية يجب أن يكون قبل تاريخ النهاية');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, dto.legalEntityId);

      if (dto.fiscalYearId) {
        const [fy] = await tx
          .select()
          .from(fiscalYears)
          .where(
            and(
              eq(fiscalYears.tenantId, context.tenantId),
              eq(fiscalYears.legalEntityId, dto.legalEntityId),
              eq(fiscalYears.id, dto.fiscalYearId),
            ),
          )
          .limit(1);
        if (!fy) throw new NotFoundException('السنة المالية غير موجودة');
        if (fy.status === FiscalYearStatus.CLOSED) {
          throw new BadRequestException('لا يمكن إضافة فترة مالية لسنة مالية مغلقة');
        }
        if (startDt < new Date(fy.startDate) || endDt > new Date(fy.endDate)) {
          throw new BadRequestException('تواريخ الفترة المالية تقع خارج نطاق السنة المالية المحددة');
        }
      }

      const [dupName] = await tx
        .select({ id: fiscalPeriods.id })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, context.tenantId),
            eq(fiscalPeriods.legalEntityId, dto.legalEntityId),
            eq(fiscalPeriods.periodName, dto.periodName),
          ),
        )
        .limit(1);
      if (dupName) {
        throw new ConflictException(`الفترة المالية '${dto.periodName}' مسجلة مسبقاً`);
      }

      const [overlap] = await tx
        .select({ id: fiscalPeriods.id, periodName: fiscalPeriods.periodName })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, context.tenantId),
            eq(fiscalPeriods.legalEntityId, dto.legalEntityId),
            lte(fiscalPeriods.startDate, endDt),
            gte(fiscalPeriods.endDate, startDt),
          ),
        )
        .limit(1);
      if (overlap) {
        throw new ConflictException(`تتداخل الفترة المالية مع الفترة '${overlap.periodName}'`);
      }

      const [period] = await tx
        .insert(fiscalPeriods)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          fiscalYearId: dto.fiscalYearId ?? null,
          periodNumber: dto.periodNumber ?? null,
          periodName: dto.periodName,
          startDate: startDt,
          endDate: endDt,
          status: FiscalPeriodStatus.OPEN,
        })
        .returning();

      return period;
    });
  }

  async listFiscalPeriods(
    context: TenantContext,
    params: {
      legalEntityId: string;
      fiscalYearId?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [
        eq(fiscalPeriods.tenantId, context.tenantId),
        eq(fiscalPeriods.legalEntityId, params.legalEntityId),
      ];
      if (params.fiscalYearId) conds.push(eq(fiscalPeriods.fiscalYearId, params.fiscalYearId));
      if (params.status) conds.push(eq(fiscalPeriods.status, params.status));

      const periodCountRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(fiscalPeriods)
        .where(and(...conds));
      const cnt = periodCountRows[0]?.cnt ?? 0;
      const rows = await tx
        .select()
        .from(fiscalPeriods)
        .where(and(...conds))
        .orderBy(desc(fiscalPeriods.startDate))
        .limit(limit)
        .offset(offset);

      return { data: rows, total: cnt, page, limit, totalPages: Math.ceil(cnt / limit) };
    });
  }

  // ==================================================================
  // 2. Pre-Closing Checks (Core Engine)
  // ==================================================================

  private async evaluateChecksInTx(
    tx: any,
    context: TenantContext,
    period: any,
    branchId?: string,
  ) {
    const startDt = new Date(period.startDate);
    const endDt = new Date(period.endDate);
    const checks: PreClosingCheckItem[] = [];

    // 1. Unposted journal entries in period
    const unpostedConds = [
      eq(journalEntries.tenantId, context.tenantId),
      eq(journalEntries.legalEntityId, period.legalEntityId),
      gte(journalEntries.entryDate, startDt),
      lte(journalEntries.entryDate, endDt),
      inArray(journalEntries.status, [JournalStatus.DRAFT]),
    ];
    if (branchId) unpostedConds.push(eq(journalEntries.branchId, branchId));
    const [{ unpostedCnt }] = await tx
      .select({ unpostedCnt: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(and(...unpostedConds));
    checks.push({
      code: 'UNPOSTED_JOURNALS',
      title: 'القيود غير المرحلة',
      severity: unpostedCnt > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: unpostedCnt,
      message:
        unpostedCnt > 0
          ? `يوجد ${unpostedCnt} قيد غير مرحل (DRAFT) ضمن الفترة`
          : 'لا توجد قيود غير مرحلة في الفترة',
    });

    // 2. Unbalanced journal entries in period
    const jeConds = [
      eq(journalEntries.tenantId, context.tenantId),
      eq(journalEntries.legalEntityId, period.legalEntityId),
      gte(journalEntries.entryDate, startDt),
      lte(journalEntries.entryDate, endDt),
      ne(journalEntries.status, 'CANCELLED'),
    ];
    if (branchId) jeConds.push(eq(journalEntries.branchId, branchId));
    const unbalancedRows = await tx
      .select({
        id: journalEntries.id,
        journalNumber: journalEntries.journalNumber,
        diff: sql<string>`ABS(COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0) - COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0))::text`,
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(...jeConds))
      .groupBy(journalEntries.id, journalEntries.journalNumber)
      .having(
        sql`ABS(COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0) - COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)) > 0.0001`,
      );
    checks.push({
      code: 'UNBALANCED_JOURNALS',
      title: 'توازن القيود المحاسبية',
      severity: unbalancedRows.length > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: unbalancedRows.length,
      message:
        unbalancedRows.length > 0
          ? `يوجد ${unbalancedRows.length} قيد غير متوازن في الفترة`
          : 'جميع القيود المحاسبية متوازنة',
      details: unbalancedRows.slice(0, 10),
    });

    // 3. Pending financial documents (open POS shifts, unposted settlement batches, unposted vouchers, open transfer discrepancies)
    const shiftConds = [
      eq(posShifts.tenantId, context.tenantId),
      eq(posShifts.legalEntityId, period.legalEntityId),
      gte(posShifts.openedAt, startDt),
      lte(posShifts.openedAt, endDt),
      eq(posShifts.status, 'OPEN'),
    ];
    if (branchId) shiftConds.push(eq(posShifts.branchId, branchId));
    const [{ openShiftsCnt }] = await tx
      .select({ openShiftsCnt: sql<number>`count(*)::int` })
      .from(posShifts)
      .where(and(...shiftConds));

    const batchConds = [
      eq(settlementBatches.tenantId, context.tenantId),
      eq(settlementBatches.legalEntityId, period.legalEntityId),
      gte(settlementBatches.settlementDate, startDt),
      lte(settlementBatches.settlementDate, endDt),
      inArray(settlementBatches.status, ['DRAFT', 'IMPORTED', 'MATCHED', 'APPROVED']),
    ];
    if (branchId) batchConds.push(eq(settlementBatches.branchId, branchId));
    const [{ pendingBatchesCnt }] = await tx
      .select({ pendingBatchesCnt: sql<number>`count(*)::int` })
      .from(settlementBatches)
      .where(and(...batchConds));

    const [{ pendingPvCnt }] = await tx
      .select({ pendingPvCnt: sql<number>`count(*)::int` })
      .from(paymentVouchers)
      .where(
        and(
          eq(paymentVouchers.tenantId, context.tenantId),
          eq(paymentVouchers.legalEntityId, period.legalEntityId),
          gte(paymentVouchers.voucherDate, startDt),
          lte(paymentVouchers.voucherDate, endDt),
          eq(paymentVouchers.status, 'DRAFT'),
        ),
      );

    const [{ pendingRvCnt }] = await tx
      .select({ pendingRvCnt: sql<number>`count(*)::int` })
      .from(receiptVouchers)
      .where(
        and(
          eq(receiptVouchers.tenantId, context.tenantId),
          eq(receiptVouchers.legalEntityId, period.legalEntityId),
          gte(receiptVouchers.voucherDate, startDt),
          lte(receiptVouchers.voucherDate, endDt),
          eq(receiptVouchers.status, 'DRAFT'),
        ),
      );

    const pendingBlockers = openShiftsCnt + pendingBatchesCnt + pendingPvCnt + pendingRvCnt;
    checks.push({
      code: 'PENDING_FINANCIAL_DOCUMENTS',
      title: 'المستندات المالية المعلقة (الورديات، التسويات، السندات)',
      severity: pendingBlockers > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: pendingBlockers,
      message:
        pendingBlockers > 0
          ? `توجد مستندات معلقة تمنع الإقفال (ورديات مفتوحة: ${openShiftsCnt}، دفعات تسوية غير مرحلة: ${pendingBatchesCnt}، سندات مسودة: ${pendingPvCnt + pendingRvCnt})`
          : 'لا توجد ورديات مفتوحة أو مستندات مالية معلقة',
      details: { openShiftsCnt, pendingBatchesCnt, pendingPvCnt, pendingRvCnt },
    });

    // Open in-transit stock transfers (Warning) & unresolved transfer discrepancies (Blocker)
    const [{ openTransfersCnt }] = await tx
      .select({ openTransfersCnt: sql<number>`count(*)::int` })
      .from(stockTransfers)
      .where(
        and(
          eq(stockTransfers.tenantId, context.tenantId),
          eq(stockTransfers.legalEntityId, period.legalEntityId),
          gte(stockTransfers.requestedAt, startDt),
          lte(stockTransfers.requestedAt, endDt),
          inArray(stockTransfers.status, ['DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY']),
        ),
      );
    const [{ openTransferDiscCnt }] = await tx
      .select({ openTransferDiscCnt: sql<number>`count(*)::int` })
      .from(stockTransferDiscrepancies)
      .where(
        and(
          eq(stockTransferDiscrepancies.tenantId, context.tenantId),
          eq(stockTransferDiscrepancies.legalEntityId, period.legalEntityId),
          gte(stockTransferDiscrepancies.createdAt, startDt),
          lte(stockTransferDiscrepancies.createdAt, endDt),
          inArray(stockTransferDiscrepancies.status, [
            TransferDiscrepancyStatus.OPEN,
            TransferDiscrepancyStatus.UNDER_REVIEW,
          ]),
        ),
      );
    if (openTransfersCnt > 0 || openTransferDiscCnt > 0) {
      checks.push({
        code: 'OPEN_INTERBRANCH_TRANSFERS',
        title: 'تحويلات المخزون المفتوحة وفروقاتها',
        severity: openTransferDiscCnt > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.WARNING,
        count: openTransferDiscCnt > 0 ? openTransferDiscCnt : openTransfersCnt,
        message:
          openTransferDiscCnt > 0
            ? `يوجد ${openTransferDiscCnt} فروقات تحويل مخزني غير محلولة تمنع الإقفال`
            : `تنبيه: يوجد ${openTransfersCnt} تحويل مخزني قيد النقل لم يُستلم بعد`,
      });
    } else {
      checks.push({
        code: 'OPEN_INTERBRANCH_TRANSFERS',
        title: 'تحويلات المخزون المفتوحة وفروقاتها',
        severity: ClosingCheckSeverity.PASS,
        count: 0,
        message: 'لا توجد تحويلات مخزنية معلقة أو فروقات مفتوحة',
      });
    }

    // 4. Trial Balance check for the period
    const tb = await this.accountingService.getHierarchicalTrialBalance(context, {
      legalEntityId: period.legalEntityId,
      branchId,
      startDate: startDt.toISOString(),
      endDate: endDt.toISOString(),
      includeZeroBalances: false,
    });
    checks.push({
      code: 'TRIAL_BALANCE_INTEGRITY',
      title: 'توازن ميزان المراجعة للفترة',
      severity: tb.grandTotals.isBalanced ? ClosingCheckSeverity.PASS : ClosingCheckSeverity.BLOCKER,
      count: tb.grandTotals.isBalanced ? 0 : 1,
      message: tb.grandTotals.isBalanced
        ? `ميزان المراجعة متوازن (المدين = الدائن = ${tb.grandTotals.closingDebit})`
        : 'ميزان المراجعة غير متوازن',
      details: tb.grandTotals,
    });

    // 5. Financial Reconciliation Discrepancies check
    const recon = await this.reconciliationService.previewReconciliation(context, {
      legalEntityId: period.legalEntityId,
      branchId,
      asOfDate: endDt.toISOString(),
    });
    checks.push({
      code: 'UNRESOLVED_RECONCILIATION_DISCREPANCIES',
      title: 'المصالحة المالية والفروقات غير المسوّاة',
      severity:
        recon.summary.discrepancyCount > 0
          ? ClosingCheckSeverity.BLOCKER
          : recon.summary.notConfiguredCount > 0
          ? ClosingCheckSeverity.WARNING
          : ClosingCheckSeverity.PASS,
      count: recon.summary.discrepancyCount,
      message:
        recon.summary.discrepancyCount > 0
          ? `يوجد ${recon.summary.discrepancyCount} فروقات مالية غير مسوّاة بإجمالي ${recon.summary.totalVariance}`
          : recon.summary.notConfiguredCount > 0
          ? `تنبيه: يوجد ${recon.summary.notConfiguredCount} حسابات غير مربوطة في المصالحة`
          : 'جميع المصالحات المالية متطابقة بالكامل',
      details: recon.summary,
    });

    // 6. Document-to-Journal link integrity (posted journals with 0 lines + posted vouchers missing journalEntryId)
    const emptyLineJournals = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.tenantId, context.tenantId),
          eq(journalEntries.legalEntityId, period.legalEntityId),
          gte(journalEntries.entryDate, startDt),
          lte(journalEntries.entryDate, endDt),
          eq(journalEntries.status, JournalStatus.POSTED),
        ),
      )
      .groupBy(journalEntries.id)
      .having(sql`count(${journalLines.id}) = 0`);

    const [{ orphanPvCnt }] = await tx
      .select({ orphanPvCnt: sql<number>`count(*)::int` })
      .from(paymentVouchers)
      .where(
        and(
          eq(paymentVouchers.tenantId, context.tenantId),
          eq(paymentVouchers.legalEntityId, period.legalEntityId),
          gte(paymentVouchers.voucherDate, startDt),
          lte(paymentVouchers.voucherDate, endDt),
          eq(paymentVouchers.status, 'POSTED'),
          sql`${paymentVouchers.journalEntryId} IS NULL`,
        ),
      );

    const linkIssuesCount = emptyLineJournals.length + orphanPvCnt;
    checks.push({
      code: 'DOCUMENT_JOURNAL_LINK_INTEGRITY',
      title: 'سلامة ترابط المستندات والقيود',
      severity: linkIssuesCount > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: linkIssuesCount,
      message:
        linkIssuesCount > 0
          ? `يوجد ${linkIssuesCount} خلل في ترابط المستندات والقيود`
          : 'ترابط المستندات والقيود سليم',
    });

    const blockersCount = checks.filter((c) => c.severity === ClosingCheckSeverity.BLOCKER).length;
    const warningsCount = checks.filter((c) => c.severity === ClosingCheckSeverity.WARNING).length;

    return {
      canClose: blockersCount === 0,
      blockersCount,
      warningsCount,
      checks,
      trialBalance: tb,
      reconciliationSummary: recon.summary,
    };
  }

  async runPreClosingChecks(context: TenantContext, periodId: string, branchId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const period = await this.getPeriodAndVerifyScope(tx, context, periodId, branchId);
      const evalRes = await this.evaluateChecksInTx(tx, context, period, branchId);

      const precheckStatus = evalRes.canClose
        ? evalRes.warningsCount > 0
          ? 'READY_WITH_WARNINGS'
          : 'READY'
        : 'BLOCKED';

      await tx
        .update(fiscalPeriods)
        .set({ lastPrecheckAt: new Date(), lastPrecheckStatus: precheckStatus })
        .where(eq(fiscalPeriods.id, period.id));

      await tx.insert(fiscalPeriodClosingLogs).values({
        tenantId: context.tenantId,
        legalEntityId: period.legalEntityId,
        periodId: period.id,
        fiscalYearId: period.fiscalYearId ?? null,
        action: PeriodClosingAction.PRE_CHECK,
        previousStatus: period.status,
        newStatus: period.status,
        actorId: context.userId,
        blockersCount: evalRes.blockersCount,
        warningsCount: evalRes.warningsCount,
        checksSnapshotJson: evalRes.checks,
      });

      return {
        period,
        precheckStatus,
        canClose: evalRes.canClose,
        blockersCount: evalRes.blockersCount,
        warningsCount: evalRes.warningsCount,
        checks: evalRes.checks,
      };
    });
  }

  // ==================================================================
  // 3. Close Fiscal Period (Atomic + Idempotent)
  // ==================================================================

  async closeFiscalPeriod(
    context: TenantContext,
    dto: {
      periodId: string;
      branchId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingLog] = await tx
          .select()
          .from(fiscalPeriodClosingLogs)
          .where(
            and(
              eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
              eq(fiscalPeriodClosingLogs.idempotencyKey, dto.idempotencyKey),
              eq(fiscalPeriodClosingLogs.action, PeriodClosingAction.CLOSED),
            ),
          )
          .limit(1);
        if (existingLog && existingLog.periodId) {
          const [p] = await tx
            .select()
            .from(fiscalPeriods)
            .where(eq(fiscalPeriods.id, existingLog.periodId))
            .limit(1);
          return {
            period: p,
            log: existingLog,
            checks: existingLog.checksSnapshotJson,
            warningsCount: existingLog.warningsCount,
            idempotentHit: true,
          };
        }
      }

      const period = await this.getPeriodAndVerifyScope(tx, context, dto.periodId, dto.branchId, true);
      if (period.status === FiscalPeriodStatus.CLOSED || period.status === FiscalPeriodStatus.LOCKED) {
        throw new ConflictException(`الفترة المالية '${period.periodName}' مغلقة بالفعل`);
      }

      const prevStatus = period.status;

      // Transition to CLOSING inside atomic transaction before checks
      await tx
        .update(fiscalPeriods)
        .set({ status: FiscalPeriodStatus.CLOSING })
        .where(eq(fiscalPeriods.id, period.id));

      const evalRes = await this.evaluateChecksInTx(tx, context, period, dto.branchId);
      if (!evalRes.canClose) {
        const blockerMessages = evalRes.checks
          .filter((c) => c.severity === ClosingCheckSeverity.BLOCKER)
          .map((c) => c.message);
        throw new BadRequestException({
          message: `تعذر إقفال الفترة المالية '${period.periodName}' لوجود ${evalRes.blockersCount} عوائق تمنع الإقفال`,
          blockers: blockerMessages,
          checks: evalRes.checks,
        });
      }

      const now = new Date();
      const [closedPeriod] = await tx
        .update(fiscalPeriods)
        .set({
          status: FiscalPeriodStatus.CLOSED,
          closedAt: now,
          closedBy: context.userId,
          closingNotes: dto.notes ?? null,
          lastPrecheckAt: now,
          lastPrecheckStatus: evalRes.warningsCount > 0 ? 'READY_WITH_WARNINGS' : 'READY',
          idempotencyKey: dto.idempotencyKey ?? null,
        })
        .where(eq(fiscalPeriods.id, period.id))
        .returning();

      const [log] = await tx
        .insert(fiscalPeriodClosingLogs)
        .values({
          tenantId: context.tenantId,
          legalEntityId: period.legalEntityId,
          periodId: period.id,
          fiscalYearId: period.fiscalYearId ?? null,
          action: PeriodClosingAction.CLOSED,
          previousStatus: prevStatus,
          newStatus: FiscalPeriodStatus.CLOSED,
          actorId: context.userId,
          reason: dto.notes ?? 'إقفال دوري معتمد',
          blockersCount: 0,
          warningsCount: evalRes.warningsCount,
          checksSnapshotJson: evalRes.checks,
          trialBalanceSnapshotJson: evalRes.trialBalance,
          idempotencyKey: dto.idempotencyKey ?? null,
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'FISCAL_PERIOD_CLOSED',
          entityType: 'fiscal_period',
          entityId: period.id,
          beforeState: { status: prevStatus },
          afterState: { status: FiscalPeriodStatus.CLOSED, warningsCount: evalRes.warningsCount },
        },
        tx,
      );

      return {
        period: closedPeriod,
        log,
        checks: evalRes.checks,
        warningsCount: evalRes.warningsCount,
        idempotentHit: false,
      };
    });
  }

  // ==================================================================
  // 4. Reopen Fiscal Period (Restricted Permission + Mandatory Reason)
  // ==================================================================

  async reopenFiscalPeriod(
    context: TenantContext,
    dto: { periodId: string; reason: string; idempotencyKey?: string },
  ) {
    const cleanReason = (dto.reason || '').trim();
    if (cleanReason.length < 5) {
      throw new BadRequestException('يجب إدخال سبب واضح لإعادة فتح الفترة المالية (5 أحرف على الأقل)');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingLog] = await tx
          .select()
          .from(fiscalPeriodClosingLogs)
          .where(
            and(
              eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
              eq(fiscalPeriodClosingLogs.idempotencyKey, dto.idempotencyKey),
              eq(fiscalPeriodClosingLogs.action, PeriodClosingAction.REOPENED),
            ),
          )
          .limit(1);
        if (existingLog && existingLog.periodId) {
          const [p] = await tx
            .select()
            .from(fiscalPeriods)
            .where(eq(fiscalPeriods.id, existingLog.periodId))
            .limit(1);
          return { period: p, log: existingLog, idempotentHit: true };
        }
      }

      const period = await this.getPeriodAndVerifyScope(tx, context, dto.periodId, undefined, true);
      if (period.status === FiscalPeriodStatus.OPEN) {
        throw new BadRequestException(`الفترة المالية '${period.periodName}' مفتوحة بالفعل`);
      }

      if (period.fiscalYearId) {
        const [fy] = await tx
          .select()
          .from(fiscalYears)
          .where(eq(fiscalYears.id, period.fiscalYearId))
          .limit(1);
        if (fy && fy.status === FiscalYearStatus.CLOSED) {
          throw new BadRequestException('لا يمكن إعادة فتح فترة تابعة لسنة مالية مقفلة');
        }
      }

      const prevStatus = period.status;
      const now = new Date();
      const [reopened] = await tx
        .update(fiscalPeriods)
        .set({
          status: FiscalPeriodStatus.OPEN,
          reopenedAt: now,
          reopenedBy: context.userId,
          reopenReason: cleanReason,
        })
        .where(eq(fiscalPeriods.id, period.id))
        .returning();

      const [log] = await tx
        .insert(fiscalPeriodClosingLogs)
        .values({
          tenantId: context.tenantId,
          legalEntityId: period.legalEntityId,
          periodId: period.id,
          fiscalYearId: period.fiscalYearId ?? null,
          action: PeriodClosingAction.REOPENED,
          previousStatus: prevStatus,
          newStatus: FiscalPeriodStatus.OPEN,
          actorId: context.userId,
          reason: cleanReason,
          blockersCount: 0,
          warningsCount: 0,
          idempotencyKey: dto.idempotencyKey ?? null,
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'FISCAL_PERIOD_REOPENED',
          entityType: 'fiscal_period',
          entityId: period.id,
          beforeState: { status: prevStatus },
          afterState: { status: FiscalPeriodStatus.OPEN, reason: cleanReason },
        },
        tx,
      );

      return { period: reopened, log, idempotentHit: false };
    });
  }

  // ==================================================================
  // 5. Reports (Readiness, Pending Items, Final TB, Closing Logs)
  // ==================================================================

  async getClosingReadinessReport(context: TenantContext, periodId: string, branchId?: string) {
    return await this.runPreClosingChecks(context, periodId, branchId);
  }

  async getPendingItemsReport(
    context: TenantContext,
    periodId: string,
    params: { page?: number; limit?: number; type?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const period = await this.getPeriodAndVerifyScope(tx, context, periodId);
      const startIso = new Date(period.startDate).toISOString();
      const endIso = new Date(period.endDate).toISOString();
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const unionQuery = sql`
        SELECT * FROM (
          SELECT
            je.id::text AS id,
            'UNPOSTED_JOURNAL'::text AS item_type,
            je.journal_number::text AS reference_number,
            je.status::text AS status,
            COALESCE(je.description, 'قيد غير مرحل') AS description,
            je.debit_total::numeric(18,4)::text AS amount,
            je.entry_date AS item_date
          FROM journal_entries je
          WHERE je.tenant_id = ${context.tenantId}::uuid
            AND je.legal_entity_id = ${period.legalEntityId}::uuid
            AND je.entry_date >= ${startIso}::timestamptz
            AND je.entry_date <= ${endIso}::timestamptz
            AND je.status = 'DRAFT'
          UNION ALL
          SELECT
            ps.id::text AS id,
            'OPEN_POS_SHIFT'::text AS item_type,
            ps.id::text AS reference_number,
            ps.status::text AS status,
            'وردية نقاط بيع مفتوحة'::text AS description,
            ps.opening_cash::numeric(18,4)::text AS amount,
            ps.opened_at AS item_date
          FROM pos_shifts ps
          WHERE ps.tenant_id = ${context.tenantId}::uuid
            AND ps.legal_entity_id = ${period.legalEntityId}::uuid
            AND ps.opened_at >= ${startIso}::timestamptz
            AND ps.opened_at <= ${endIso}::timestamptz
            AND ps.status = 'OPEN'
          UNION ALL
          SELECT
            sb.id::text AS id,
            'PENDING_SETTLEMENT_BATCH'::text AS item_type,
            sb.batch_number::text AS reference_number,
            sb.status::text AS status,
            'دفعة تسوية غير مرحلة'::text AS description,
            sb.gross_amount::numeric(18,4)::text AS amount,
            sb.settlement_date AS item_date
          FROM settlement_batches sb
          WHERE sb.tenant_id = ${context.tenantId}::uuid
            AND sb.legal_entity_id = ${period.legalEntityId}::uuid
            AND sb.settlement_date >= ${startIso}::timestamptz
            AND sb.settlement_date <= ${endIso}::timestamptz
            AND sb.status IN ('DRAFT', 'IMPORTED', 'MATCHED', 'APPROVED')
          UNION ALL
          SELECT
            st.id::text AS id,
            'OPEN_STOCK_TRANSFER'::text AS item_type,
            st.transfer_number::text AS reference_number,
            st.status::text AS status,
            'تحويل مخزني قيد النقل'::text AS description,
            '0.0000'::text AS amount,
            st.requested_at AS item_date
          FROM stock_transfers st
          WHERE st.tenant_id = ${context.tenantId}::uuid
            AND st.legal_entity_id = ${period.legalEntityId}::uuid
            AND st.requested_at >= ${startIso}::timestamptz
            AND st.requested_at <= ${endIso}::timestamptz
            AND st.status IN ('DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY')
        ) items
        ${params.type ? sql`WHERE items.item_type = ${params.type}` : sql``}
      `;

      const countRes = await tx.execute(sql`SELECT COUNT(*)::int AS cnt FROM (${unionQuery}) q`);
      const rowsRes = await tx.execute(
        sql`SELECT * FROM (${unionQuery}) q ORDER BY q.item_date DESC LIMIT ${limit} OFFSET ${offset}`,
      );
      const total = Number((countRes as any)?.[0]?.cnt ?? 0);

      return {
        period,
        data: rowsRes as any[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async getFinalTrialBalanceReport(context: TenantContext, periodId: string, branchId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const period = await this.getPeriodAndVerifyScope(tx, context, periodId, branchId);

      // If closed and no branch filter, return immutable closing snapshot if available
      if (period.status === FiscalPeriodStatus.CLOSED && !branchId) {
        const [closedLog] = await tx
          .select({ trialBalanceSnapshotJson: fiscalPeriodClosingLogs.trialBalanceSnapshotJson })
          .from(fiscalPeriodClosingLogs)
          .where(
            and(
              eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
              eq(fiscalPeriodClosingLogs.periodId, period.id),
              eq(fiscalPeriodClosingLogs.action, PeriodClosingAction.CLOSED),
            ),
          )
          .orderBy(desc(fiscalPeriodClosingLogs.createdAt))
          .limit(1);
        if (closedLog?.trialBalanceSnapshotJson) {
          return {
            period,
            source: 'CLOSING_SNAPSHOT',
            trialBalance: closedLog.trialBalanceSnapshotJson,
          };
        }
      }

      const tb = await this.accountingService.getHierarchicalTrialBalance(context, {
        legalEntityId: period.legalEntityId,
        branchId,
        startDate: new Date(period.startDate).toISOString(),
        endDate: new Date(period.endDate).toISOString(),
        includeZeroBalances: false,
      });

      return {
        period,
        source: 'LIVE_GL',
        trialBalance: tb,
      };
    });
  }

  async getClosingLogs(
    context: TenantContext,
    params: { legalEntityId: string; periodId?: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [
        eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
        eq(fiscalPeriodClosingLogs.legalEntityId, params.legalEntityId),
      ];
      if (params.periodId) conds.push(eq(fiscalPeriodClosingLogs.periodId, params.periodId));

      const logCountRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(fiscalPeriodClosingLogs)
        .where(and(...conds));
      const cnt = logCountRows[0]?.cnt ?? 0;
      const rows = await tx
        .select()
        .from(fiscalPeriodClosingLogs)
        .where(and(...conds))
        .orderBy(desc(fiscalPeriodClosingLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return { data: rows, total: cnt, page, limit, totalPages: Math.ceil(cnt / limit) };
    });
  }

  // ==================================================================
  // 6. Priority 3 — Fiscal Year Closing, Opening Balances & Reopening
  //    (Continuous GL Architecture — Zero Double-Counting)
  // ==================================================================

  private async getFiscalYearAndVerifyScope(
    tx: any,
    context: TenantContext,
    fiscalYearId: string,
    forUpdate = false,
  ) {
    const query = tx
      .select()
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, context.tenantId), eq(fiscalYears.id, fiscalYearId)))
      .limit(1);
    const [fy] = forUpdate ? await query.for('update') : await query;
    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة');
    }
    await this.verifyEntityScope(tx, context, fy.legalEntityId);
    return fy;
  }

  private async resolveRetainedEarningsAccountInTx(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    explicitAccountId?: string,
  ): Promise<{ id: string; accountCode: string; name: string } | null> {
    let targetAccountId = explicitAccountId;
    if (!targetAccountId) {
      const [mapped] = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, legalEntityId),
            eq(accountMappings.mappingKey, DefaultAccountMappingKey.RETAINED_EARNINGS),
            eq(accountMappings.isActive, true),
          ),
        )
        .limit(1);
      targetAccountId = mapped?.accountId;
    }

    if (!targetAccountId) {
      // Fallback to standard COA code 311000
      const [byCode] = await tx
        .select({
          id: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          name: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
          isPostable: chartOfAccounts.isPostable,
          status: chartOfAccounts.status,
        })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId),
            eq(chartOfAccounts.accountCode, '311000'),
          ),
        )
        .limit(1);
      if (byCode && byCode.status === 'ACTIVE' && byCode.isPostable && byCode.accountType === AccountType.EQUITY) {
        return { id: byCode.id, accountCode: byCode.accountCode, name: byCode.name };
      }
      return null;
    }

    const [acc] = await tx
      .select({
        id: chartOfAccounts.id,
        accountCode: chartOfAccounts.accountCode,
        name: chartOfAccounts.name,
        accountType: chartOfAccounts.accountType,
        isPostable: chartOfAccounts.isPostable,
        status: chartOfAccounts.status,
      })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.tenantId, context.tenantId),
          eq(chartOfAccounts.legalEntityId, legalEntityId),
          eq(chartOfAccounts.id, targetAccountId),
        ),
      )
      .limit(1);

    if (!acc || acc.status !== 'ACTIVE' || !acc.isPostable || acc.accountType !== AccountType.EQUITY) {
      return null;
    }
    return { id: acc.id, accountCode: acc.accountCode, name: acc.name };
  }

  private async evaluateYearEndChecksInTx(
    tx: any,
    context: TenantContext,
    fy: any,
    retainedEarningsAccountId?: string,
  ) {
    const startDt = new Date(fy.startDate);
    const endDt = new Date(fy.endDate);
    const startDateStr = startDt.toISOString().slice(0, 10);
    const endDateStr = endDt.toISOString().slice(0, 10);
    const checks: PreClosingCheckItem[] = [];

    // 1. All fiscal periods belonging to this fiscal year must be CLOSED or LOCKED
    const fyPeriods = await tx
      .select({
        id: fiscalPeriods.id,
        periodName: fiscalPeriods.periodName,
        status: fiscalPeriods.status,
      })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.tenantId, context.tenantId),
          eq(fiscalPeriods.legalEntityId, fy.legalEntityId),
          eq(fiscalPeriods.fiscalYearId, fy.id),
        ),
      );

    const openPeriods = fyPeriods.filter(
      (p: any) => p.status !== FiscalPeriodStatus.CLOSED && p.status !== FiscalPeriodStatus.LOCKED,
    );
    const missingPeriods = fyPeriods.length === 0;
    checks.push({
      code: 'ALL_PERIODS_CLOSED',
      title: 'إغلاق جميع الفترات المالية للسنة',
      severity:
        missingPeriods || openPeriods.length > 0
          ? ClosingCheckSeverity.BLOCKER
          : ClosingCheckSeverity.PASS,
      count: missingPeriods ? 1 : openPeriods.length,
      message: missingPeriods
        ? 'لا توجد فترات مالية مرتبطة بهذه السنة المالية'
        : openPeriods.length > 0
          ? `يوجد ${openPeriods.length} فترة مالية غير مغلقة تمنع إقفال السنة (${openPeriods.map((p: any) => p.periodName).slice(0, 5).join(', ')})`
          : `جميع الفترات المالية (${fyPeriods.length}) مغلقة بنجاح`,
      details: { totalPeriods: fyPeriods.length, openPeriods: openPeriods.slice(0, 12) },
    });

    // 2. Unposted / Pending journal entries within the fiscal year
    const [{ unpostedJournalsCnt }] = await tx
      .select({ unpostedJournalsCnt: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, context.tenantId),
          eq(journalEntries.legalEntityId, fy.legalEntityId),
          gte(journalEntries.entryDate, startDt),
          lte(journalEntries.entryDate, endDt),
          inArray(journalEntries.status, [
            JournalStatus.DRAFT,
            JournalStatus.PENDING_APPROVAL,
            JournalStatus.APPROVED,
            JournalStatus.VALIDATED,
          ]),
        ),
      );
    checks.push({
      code: 'UNPOSTED_JOURNALS',
      title: 'القيود غير المرحلة والمسودات',
      severity: unpostedJournalsCnt > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: unpostedJournalsCnt,
      message:
        unpostedJournalsCnt > 0
          ? `يوجد ${unpostedJournalsCnt} قيد غير مرحل ضمن السنة المالية`
          : 'لا توجد قيود غير مرحلة ضمن السنة المالية',
    });

    // 3. Unbalanced journal entries within the fiscal year
    const unbalancedRows = await tx
      .select({
        id: journalEntries.id,
        journalNumber: journalEntries.journalNumber,
        diff: sql<string>`ABS(COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0) - COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0))::text`,
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.tenantId, context.tenantId),
          eq(journalEntries.legalEntityId, fy.legalEntityId),
          gte(journalEntries.entryDate, startDt),
          lte(journalEntries.entryDate, endDt),
          ne(journalEntries.status, 'CANCELLED'),
        ),
      )
      .groupBy(journalEntries.id, journalEntries.journalNumber)
      .having(
        sql`ABS(COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0) - COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)) > 0.0001`,
      );
    checks.push({
      code: 'UNBALANCED_JOURNALS',
      title: 'توازن جميع قيود السنة المالية',
      severity: unbalancedRows.length > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: unbalancedRows.length,
      message:
        unbalancedRows.length > 0
          ? `يوجد ${unbalancedRows.length} قيد غير متوازن في السنة المالية`
          : 'جميع قيود السنة المالية متوازنة',
      details: unbalancedRows.slice(0, 10),
    });

    // 4. Pending / Draft financial documents within the fiscal year
    const [{ openShiftsCnt }] = await tx
      .select({ openShiftsCnt: sql<number>`count(*)::int` })
      .from(posShifts)
      .where(
        and(
          eq(posShifts.tenantId, context.tenantId),
          eq(posShifts.legalEntityId, fy.legalEntityId),
          gte(posShifts.openedAt, startDt),
          lte(posShifts.openedAt, endDt),
          eq(posShifts.status, 'OPEN'),
        ),
      );
    const [{ pendingBatchesCnt }] = await tx
      .select({ pendingBatchesCnt: sql<number>`count(*)::int` })
      .from(settlementBatches)
      .where(
        and(
          eq(settlementBatches.tenantId, context.tenantId),
          eq(settlementBatches.legalEntityId, fy.legalEntityId),
          gte(settlementBatches.settlementDate, startDt),
          lte(settlementBatches.settlementDate, endDt),
          inArray(settlementBatches.status, ['DRAFT', 'IMPORTED', 'MATCHED', 'APPROVED']),
        ),
      );
    const [{ draftPvCnt }] = await tx
      .select({ draftPvCnt: sql<number>`count(*)::int` })
      .from(paymentVouchers)
      .where(
        and(
          eq(paymentVouchers.tenantId, context.tenantId),
          eq(paymentVouchers.legalEntityId, fy.legalEntityId),
          gte(paymentVouchers.voucherDate, startDt),
          lte(paymentVouchers.voucherDate, endDt),
          inArray(paymentVouchers.status, ['DRAFT', 'PENDING_APPROVAL']),
        ),
      );
    const [{ draftRvCnt }] = await tx
      .select({ draftRvCnt: sql<number>`count(*)::int` })
      .from(receiptVouchers)
      .where(
        and(
          eq(receiptVouchers.tenantId, context.tenantId),
          eq(receiptVouchers.legalEntityId, fy.legalEntityId),
          gte(receiptVouchers.voucherDate, startDt),
          lte(receiptVouchers.voucherDate, endDt),
          inArray(receiptVouchers.status, ['DRAFT', 'PENDING_APPROVAL']),
        ),
      );
    const [{ draftArCnt }] = await tx
      .select({ draftArCnt: sql<number>`count(*)::int` })
      .from(arInvoices)
      .where(
        and(
          eq(arInvoices.tenantId, context.tenantId),
          eq(arInvoices.legalEntityId, fy.legalEntityId),
          gte(arInvoices.issueDate, startDateStr),
          lte(arInvoices.issueDate, endDateStr),
          eq(arInvoices.status, 'DRAFT'),
        ),
      );
    const [{ draftApCnt }] = await tx
      .select({ draftApCnt: sql<number>`count(*)::int` })
      .from(apInvoices)
      .where(
        and(
          eq(apInvoices.tenantId, context.tenantId),
          eq(apInvoices.legalEntityId, fy.legalEntityId),
          gte(apInvoices.invoiceDate, startDateStr),
          lte(apInvoices.invoiceDate, endDateStr),
          eq(apInvoices.status, 'DRAFT'),
        ),
      );
    const [{ openTransferDiscCnt }] = await tx
      .select({ openTransferDiscCnt: sql<number>`count(*)::int` })
      .from(stockTransferDiscrepancies)
      .where(
        and(
          eq(stockTransferDiscrepancies.tenantId, context.tenantId),
          eq(stockTransferDiscrepancies.legalEntityId, fy.legalEntityId),
          gte(stockTransferDiscrepancies.createdAt, startDt),
          lte(stockTransferDiscrepancies.createdAt, endDt),
          inArray(stockTransferDiscrepancies.status, [
            TransferDiscrepancyStatus.OPEN,
            TransferDiscrepancyStatus.UNDER_REVIEW,
          ]),
        ),
      );

    const pendingDocsTotal =
      openShiftsCnt +
      pendingBatchesCnt +
      draftPvCnt +
      draftRvCnt +
      draftArCnt +
      draftApCnt +
      openTransferDiscCnt;

    checks.push({
      code: 'PENDING_DOCUMENTS',
      title: 'المستندات غير المرحلة والمسودات (فواتير، سندات، ورديات، تسويات)',
      severity: pendingDocsTotal > 0 ? ClosingCheckSeverity.BLOCKER : ClosingCheckSeverity.PASS,
      count: pendingDocsTotal,
      message:
        pendingDocsTotal > 0
          ? `توجد ${pendingDocsTotal} مستندات معلقة أو مسودة تمنع إقفال السنة`
          : 'لا توجد مستندات مسودة أو معلقة ضمن السنة المالية',
      details: {
        openShiftsCnt,
        pendingBatchesCnt,
        draftPvCnt,
        draftRvCnt,
        draftArCnt,
        draftApCnt,
        openTransferDiscCnt,
      },
    });

    // 5. Trial Balance integrity for the fiscal year
    const tb = await this.accountingService.getHierarchicalTrialBalance(context, {
      legalEntityId: fy.legalEntityId,
      startDate: startDt.toISOString(),
      endDate: endDt.toISOString(),
      includeZeroBalances: false,
    });
    checks.push({
      code: 'TRIAL_BALANCE_INTEGRITY',
      title: 'توازن ميزان المراجعة قبل الإقفال',
      severity: tb.grandTotals.isBalanced ? ClosingCheckSeverity.PASS : ClosingCheckSeverity.BLOCKER,
      count: tb.grandTotals.isBalanced ? 0 : 1,
      message: tb.grandTotals.isBalanced
        ? `ميزان المراجعة متوازن (المدين = الدائن = ${tb.grandTotals.closingDebit})`
        : 'ميزان المراجعة للسنة المالية غير متوازن',
      details: tb.grandTotals,
    });

    // 6. Reconciliation check as of fiscal year end
    const recon = await this.reconciliationService.previewReconciliation(context, {
      legalEntityId: fy.legalEntityId,
      asOfDate: endDt.toISOString(),
    });
    checks.push({
      code: 'UNRESOLVED_RECONCILIATION_DISCREPANCIES',
      title: 'المصالحة المالية للعملاء والموردين والمخزون والنقدية',
      severity:
        recon.summary.discrepancyCount > 0
          ? ClosingCheckSeverity.BLOCKER
          : recon.summary.notConfiguredCount > 0
            ? ClosingCheckSeverity.WARNING
            : ClosingCheckSeverity.PASS,
      count: recon.summary.discrepancyCount,
      message:
        recon.summary.discrepancyCount > 0
          ? `يوجد ${recon.summary.discrepancyCount} فروقات مالية غير مسوّاة بإجمالي ${recon.summary.totalVariance}`
          : 'جميع المصالحات المالية متطابقة بالكامل',
      details: recon.summary,
    });

    // 7. Retained Earnings account validation
    const reAccount = await this.resolveRetainedEarningsAccountInTx(
      tx,
      context,
      fy.legalEntityId,
      retainedEarningsAccountId,
    );
    checks.push({
      code: 'RETAINED_EARNINGS_ACCOUNT',
      title: 'حساب الأرباح المبقاة (Retained Earnings)',
      severity: reAccount ? ClosingCheckSeverity.PASS : ClosingCheckSeverity.BLOCKER,
      count: reAccount ? 0 : 1,
      message: reAccount
        ? `حساب الأرباح المبقاة معتمد (${reAccount.accountCode} - ${reAccount.name})`
        : 'لم يتم العثور على حساب أرباح مبقاة نشط وقابل للترحيل من نوع EQUITY لهذه الشركة القانونية',
      details: reAccount,
    });

    const blockersCount = checks.filter((c) => c.severity === ClosingCheckSeverity.BLOCKER).length;
    const warningsCount = checks.filter((c) => c.severity === ClosingCheckSeverity.WARNING).length;

    return {
      canClose: blockersCount === 0,
      blockersCount,
      warningsCount,
      checks,
      trialBalance: tb,
      reconciliationSummary: recon.summary,
      retainedEarningsAccount: reAccount,
    };
  }

  async runYearEndPreChecks(
    context: TenantContext,
    fiscalYearId: string,
    retainedEarningsAccountId?: string,
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const fy = await this.getFiscalYearAndVerifyScope(tx, context, fiscalYearId);
      const evalRes = await this.evaluateYearEndChecksInTx(tx, context, fy, retainedEarningsAccountId);
      return {
        fiscalYear: fy,
        canClose: evalRes.canClose,
        blockersCount: evalRes.blockersCount,
        warningsCount: evalRes.warningsCount,
        checks: evalRes.checks,
        retainedEarningsAccount: evalRes.retainedEarningsAccount,
      };
    });
  }

  /**
   * Atomically closes a Fiscal Year (Continuous GL):
   * - Acquires advisory + row lock on fiscal_years
   * - Enforces all year-end pre-closing checks (12 periods closed, balanced JEs, no drafts, recon clean)
   * - Zeroes ONLY nominal accounts strictly within [FY.startDate, FY.endDate] into Retained Earnings
   * - Leaves permanent accounts (ASSET/LIABILITY/EQUITY) untouched for Continuous GL carry-forward
   * - Locks all FY periods -> LOCKED and sets fiscal_years -> CLOSED
   * - Optionally executes openNextFiscalYearInTx inside the exact same atomic transaction
   */
  async closeFiscalYear(
    context: TenantContext,
    dto: {
      fiscalYearId: string;
      retainedEarningsAccountId?: string;
      autoOpenNextYear?: boolean;
      nextYearCode?: string;
      nextYearName?: string;
      idempotencyKey?: string;
      notes?: string;
    },
  ) {
    if (!this.postingEngine) {
      throw new BadRequestException('PostingEngineService is not available');
    }

    const allocRef: { number: string | null; legalEntityId: string | null } = {
      number: null,
      legalEntityId: null,
    };

    try {
      const outcome = await this.dbService.withTenantContext(context, async (tx) => {
        // 1. Advisory lock + FOR UPDATE row lock to serialize concurrent year-end close attempts
        const lockKey = `fy-close:${context.tenantId}:${dto.fiscalYearId}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        // 2. Idempotency check (same key -> return cached closing result)
        if (dto.idempotencyKey) {
          const [existingFy] = await tx
            .select()
            .from(fiscalYears)
            .where(
              and(
                eq(fiscalYears.tenantId, context.tenantId),
                eq(fiscalYears.closingIdempotencyKey, dto.idempotencyKey),
              ),
            )
            .limit(1);
          if (existingFy) {
            await this.verifyEntityScope(tx, context, existingFy.legalEntityId);
            const [closingJe] = existingFy.closingJournalEntryId
              ? await tx
                  .select()
                  .from(journalEntries)
                  .where(eq(journalEntries.id, existingFy.closingJournalEntryId))
                  .limit(1)
              : [null];
            return {
              fiscalYear: existingFy,
              closingJournalEntry: closingJe,
              netProfitLoss: null,
              nextFiscalYear: null,
              idempotentHit: true,
            };
          }
        }

        const fy = await this.getFiscalYearAndVerifyScope(tx, context, dto.fiscalYearId, true);

        if (fy.status === FiscalYearStatus.CLOSED) {
          throw new ConflictException(`السنة المالية '${fy.yearCode}' مقفلة بالفعل ولا يمكن إقفالها مرتين`);
        }

        const prevStatus = fy.status;

        // 3. Evaluate all year-end pre-closing checks atomically
        const evalRes = await this.evaluateYearEndChecksInTx(
          tx,
          context,
          fy,
          dto.retainedEarningsAccountId,
        );
        if (!evalRes.canClose || !evalRes.retainedEarningsAccount) {
          const blockerMessages = evalRes.checks
            .filter((c) => c.severity === ClosingCheckSeverity.BLOCKER)
            .map((c) => c.message);
          throw new BadRequestException({
            message: `تعذر إقفال السنة المالية '${fy.yearCode}' لوجود ${evalRes.blockersCount} عوائق تمنع الإقفال`,
            blockers: blockerMessages,
            checks: evalRes.checks,
          });
        }

        // 4. Transition to CLOSING inside the atomic tx
        await tx
          .update(fiscalYears)
          .set({ status: FiscalYearStatus.CLOSING })
          .where(eq(fiscalYears.id, fy.id));

        const startDt = new Date(fy.startDate);
        const endDt = new Date(fy.endDate);

        // 5. Compute nominal account balances STRICTLY within [FY.startDate, FY.endDate]
        //    Grouped by (accountId, branchId, currency) to preserve branch/currency dimensions
        const nominalRows = await tx
          .select({
            accountId: chartOfAccounts.id,
            accountCode: chartOfAccounts.accountCode,
            accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
            accountType: chartOfAccounts.accountType,
            branchId: journalLines.branchId,
            currency: journalLines.currency,
            totalDebit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
            totalCredit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
          .where(
            and(
              eq(journalEntries.tenantId, context.tenantId),
              eq(journalEntries.legalEntityId, fy.legalEntityId),
              eq(journalEntries.status, JournalStatus.POSTED),
              gte(journalEntries.entryDate, startDt),
              lte(journalEntries.entryDate, endDt),
              inArray(chartOfAccounts.accountType, [
                AccountType.REVENUE,
                AccountType.COGS,
                AccountType.EXPENSE,
                AccountType.OTHER_INCOME,
                AccountType.OTHER_EXPENSE,
              ]),
            ),
          )
          .groupBy(
            chartOfAccounts.id,
            chartOfAccounts.accountCode,
            chartOfAccounts.nameAr,
            chartOfAccounts.name,
            chartOfAccounts.accountType,
            journalLines.branchId,
            journalLines.currency,
          );

        const closingLines: any[] = [];
        let totalClosingDebit = 0;
        let totalClosingCredit = 0;

        for (const row of nominalRows) {
          const net = parseFloat(row.totalDebit || '0') - parseFloat(row.totalCredit || '0');
          if (Math.abs(net) < 0.0001) continue;

          if (net > 0) {
            // Debit balance (Expense / COGS) -> Credit to zero out
            closingLines.push({
              accountId: row.accountId,
              branchId: row.branchId || null,
              currency: row.currency || 'SAR',
              debit: '0.0000',
              credit: net.toFixed(4),
              description: `إقفال حساب ${row.accountName} (${row.accountCode}) - السنة المالية ${fy.yearCode}`,
            });
            totalClosingCredit += net;
          } else {
            // Credit balance (Revenue / Other Income) -> Debit to zero out
            const absNet = Math.abs(net);
            closingLines.push({
              accountId: row.accountId,
              branchId: row.branchId || null,
              currency: row.currency || 'SAR',
              debit: absNet.toFixed(4),
              credit: '0.0000',
              description: `إقفال حساب ${row.accountName} (${row.accountCode}) - السنة المالية ${fy.yearCode}`,
            });
            totalClosingDebit += absNet;
          }
        }

        // Net Profit = totalClosingDebit (Revenues) - totalClosingCredit (Expenses)
        const netProfitLoss = totalClosingDebit - totalClosingCredit;
        if (Math.abs(netProfitLoss) > 0.0001) {
          if (netProfitLoss > 0) {
            closingLines.push({
              accountId: evalRes.retainedEarningsAccount.id,
              debit: '0.0000',
              credit: netProfitLoss.toFixed(4),
              description: `ترحيل صافي أرباح السنة المالية ${fy.yearCode} إلى الأرباح المبقاة`,
            });
          } else {
            closingLines.push({
              accountId: evalRes.retainedEarningsAccount.id,
              debit: Math.abs(netProfitLoss).toFixed(4),
              credit: '0.0000',
              description: `ترحيل صافي خسائر السنة المالية ${fy.yearCode} إلى الأرباح المبقاة`,
            });
          }
        }

        // 6. Post balanced Closing Entry (if there are nominal balances to close)
        let closingEntry: any = null;
        if (closingLines.length >= 2) {
          let journalNumber = `JV-CLOSE-${fy.yearCode}-${Date.now().toString(36).toUpperCase()}`;
          if (this.documentNumbering) {
            const alloc = await this.documentNumbering.allocateNextNumber(context, {
              legalEntityId: fy.legalEntityId,
              documentType: 'JOURNAL_ENTRY',
              documentDate: endDt,
              sourceType: 'fiscal_year_closing',
            });
            journalNumber = alloc.formattedNumber;
            allocRef.number = journalNumber;
            allocRef.legalEntityId = fy.legalEntityId;
          }

          closingEntry = await this.postingEngine!.postEntry(
            context,
            {
              legalEntityId: fy.legalEntityId,
              journalNumber,
              journalType: JournalType.CLOSING,
              sourceType: 'fiscal_year_closing',
              sourceId: fy.id,
              entryDate: endDt,
              description: `قيد إقفال السنة المالية ${fy.yearCode}`,
              notes: dto.notes,
              lines: closingLines,
              allowClosingForYearId: fy.id,
            },
            tx,
          );
        }

        // 7. Lock all fiscal periods of this year -> LOCKED
        await tx
          .update(fiscalPeriods)
          .set({ status: FiscalPeriodStatus.LOCKED })
          .where(
            and(
              eq(fiscalPeriods.tenantId, context.tenantId),
              eq(fiscalPeriods.legalEntityId, fy.legalEntityId),
              eq(fiscalPeriods.fiscalYearId, fy.id),
            ),
          );

        // 8. Capture post-closing Trial Balance summary directly inside tx (so closing entry is included)
        const postClosingTb = await this.computePermanentBalancesInTx(tx, context, fy.legalEntityId, endDt);

        const now = new Date();
        const [closedFy] = await tx
          .update(fiscalYears)
          .set({
            status: FiscalYearStatus.CLOSED,
            closedAt: now,
            closedBy: context.userId,
            closingJournalEntryId: closingEntry?.id ?? null,
            closingIdempotencyKey: dto.idempotencyKey ?? null,
            closingTrialBalanceSnapshotJson: postClosingTb.summary,
          })
          .where(eq(fiscalYears.id, fy.id))
          .returning();

        // 9. Write immutable closing log & audit log
        const [closingLog] = await tx
          .insert(fiscalPeriodClosingLogs)
          .values({
            tenantId: context.tenantId,
            legalEntityId: fy.legalEntityId,
            periodId: null,
            fiscalYearId: fy.id,
            action: PeriodClosingAction.YEAR_END_CLOSE,
            previousStatus: prevStatus,
            newStatus: FiscalYearStatus.CLOSED,
            actorId: context.userId,
            reason: dto.notes ?? `إقفال السنة المالية ${fy.yearCode}`,
            blockersCount: 0,
            warningsCount: evalRes.warningsCount,
            checksSnapshotJson: evalRes.checks,
            trialBalanceSnapshotJson: postClosingTb.summary,
            idempotencyKey: dto.idempotencyKey ?? null,
          })
          .returning();

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'FISCAL_YEAR_CLOSED',
            entityType: 'fiscal_year',
            entityId: fy.id,
            beforeState: { status: prevStatus },
            afterState: {
              status: FiscalYearStatus.CLOSED,
              closingJournalEntryId: closingEntry?.id ?? null,
              netProfitLoss: netProfitLoss.toFixed(4),
              retainedEarningsAccountId: evalRes.retainedEarningsAccount.id,
            },
          },
          tx,
        );

        // 10. Optionally open next fiscal year & carry forward permanent opening balances atomically
        let nextYearResult: any = null;
        if (dto.autoOpenNextYear) {
          nextYearResult = await this.openNextFiscalYearInTx(tx, context, closedFy!, {
            nextYearCode: dto.nextYearCode,
            nextYearName: dto.nextYearName,
            generateMonthlyPeriods: true,
            idempotencyKey: dto.idempotencyKey ? `${dto.idempotencyKey}:next` : undefined,
          });
        }

        return {
          fiscalYear: closedFy,
          closingJournalEntry: closingEntry,
          closingLog,
          netProfitLoss: netProfitLoss.toFixed(4),
          retainedEarningsAccount: evalRes.retainedEarningsAccount,
          postClosingSummary: postClosingTb.summary,
          nextFiscalYear: nextYearResult,
          idempotentHit: false,
        };
      });

      if (allocRef.number && allocRef.legalEntityId && this.documentNumbering) {
        await this.documentNumbering.markAllocationStatus(
          context,
          allocRef.number,
          'JOURNAL_ENTRY',
          allocRef.legalEntityId,
          'USED',
          outcome.closingJournalEntry?.id,
        );
      }

      return outcome;
    } catch (err) {
      if (allocRef.number && allocRef.legalEntityId && this.documentNumbering) {
        await this.documentNumbering
          .markAllocationStatus(
            context,
            allocRef.number,
            'JOURNAL_ENTRY',
            allocRef.legalEntityId,
            'FAILED_TX',
          )
          .catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Computes cumulative closing balances of PERMANENT accounts ONLY (ASSET, LIABILITY, EQUITY)
   * up to `asOfDate`, grouped by (accountId, branchId, currency).
   * Nominal accounts are already zeroed by the Closing Entry.
   */
  private async computePermanentBalancesInTx(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    asOfDate: Date,
  ) {
    const rows = await tx
      .select({
        accountId: chartOfAccounts.id,
        accountCode: chartOfAccounts.accountCode,
        accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
        accountType: chartOfAccounts.accountType,
        branchId: journalLines.branchId,
        currency: journalLines.currency,
        totalDebit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
      .where(
        and(
          eq(journalEntries.tenantId, context.tenantId),
          eq(journalEntries.legalEntityId, legalEntityId),
          eq(journalEntries.status, JournalStatus.POSTED),
          lte(journalEntries.entryDate, asOfDate),
          inArray(chartOfAccounts.accountType, [
            AccountType.ASSET,
            AccountType.LIABILITY,
            AccountType.EQUITY,
          ]),
        ),
      )
      .groupBy(
        chartOfAccounts.id,
        chartOfAccounts.accountCode,
        chartOfAccounts.nameAr,
        chartOfAccounts.name,
        chartOfAccounts.accountType,
        journalLines.branchId,
        journalLines.currency,
      )
      .orderBy(asc(chartOfAccounts.accountCode));

    let grandDebit = 0;
    let grandCredit = 0;
    const balances: Array<{
      accountId: string;
      accountCode: string;
      accountName: string;
      accountType: string;
      branchId: string | null;
      currency: string;
      openingDebit: string;
      openingCredit: string;
      netBalance: string;
    }> = [];

    for (const r of rows) {
      const net = parseFloat(r.totalDebit || '0') - parseFloat(r.totalCredit || '0');
      if (Math.abs(net) < 0.0001) continue;
      const od = net > 0 ? net : 0;
      const oc = net < 0 ? Math.abs(net) : 0;
      grandDebit += od;
      grandCredit += oc;
      balances.push({
        accountId: r.accountId,
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountType: r.accountType,
        branchId: r.branchId || null,
        currency: r.currency || 'SAR',
        openingDebit: od.toFixed(4),
        openingCredit: oc.toFixed(4),
        netBalance: net.toFixed(4),
      });
    }

    const discrepancy = Math.abs(grandDebit - grandCredit);
    return {
      balances,
      summary: {
        asOfDate: asOfDate.toISOString(),
        accountCount: balances.length,
        totalDebit: grandDebit.toFixed(4),
        totalCredit: grandCredit.toFixed(4),
        discrepancy: discrepancy.toFixed(4),
        isBalanced: discrepancy < 0.0001,
      },
    };
  }

  private async openNextFiscalYearInTx(
    tx: any,
    context: TenantContext,
    closedFy: any,
    opts: {
      nextYearCode?: string;
      nextYearName?: string;
      generateMonthlyPeriods?: boolean;
      idempotencyKey?: string;
    },
  ) {
    if (closedFy.status !== FiscalYearStatus.CLOSED) {
      throw new BadRequestException('يجب إقفال السنة المالية الحالية أولاً قبل فتح السنة المالية التالية');
    }

    // Check if next fiscal year already exists for this closed year
    const [existingNext] = await tx
      .select()
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.tenantId, context.tenantId),
          eq(fiscalYears.legalEntityId, closedFy.legalEntityId),
          eq(fiscalYears.previousFiscalYearId, closedFy.id),
        ),
      )
      .limit(1);

    let nextFy = existingNext;
    let generatedPeriods: any[] = [];

    if (nextFy) {
      // Check if active opening balances already exist (prevent duplicate opening balance carry-forward)
      const [{ activeBalCnt }] = await tx
        .select({ activeBalCnt: sql<number>`count(*)::int` })
        .from(fiscalYearOpeningBalances)
        .where(
          and(
            eq(fiscalYearOpeningBalances.tenantId, context.tenantId),
            eq(fiscalYearOpeningBalances.fiscalYearId, nextFy.id),
            eq(fiscalYearOpeningBalances.status, 'ACTIVE'),
          ),
        );
      if (activeBalCnt > 0 || nextFy.openingCarryForwardCompletedAt) {
        throw new ConflictException(
          `تم فتح السنة المالية التالية '${nextFy.yearCode}' وترحيل الأرصدة الافتتاحية لها مسبقاً`,
        );
      }
    } else {
      const prevEnd = new Date(closedFy.endDate);
      const nextStart = new Date(
        Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate() + 1, 0, 0, 0, 0),
      );
      const nextYearNum = nextStart.getUTCFullYear();
      const nextEnd = new Date(Date.UTC(nextYearNum, 11, 31, 23, 59, 59, 999));

      const yearCode = opts.nextYearCode?.trim() || `FY${nextYearNum}`;
      const yearName = opts.nextYearName?.trim() || `السنة المالية ${nextYearNum}`;

      // Guard against code or date overlap
      const [dupCode] = await tx
        .select({ id: fiscalYears.id })
        .from(fiscalYears)
        .where(
          and(
            eq(fiscalYears.tenantId, context.tenantId),
            eq(fiscalYears.legalEntityId, closedFy.legalEntityId),
            eq(fiscalYears.yearCode, yearCode),
          ),
        )
        .limit(1);
      if (dupCode) {
        throw new ConflictException(`السنة المالية '${yearCode}' مسجلة مسبقاً`);
      }

      const [insertedFy] = await tx
        .insert(fiscalYears)
        .values({
          tenantId: context.tenantId,
          legalEntityId: closedFy.legalEntityId,
          yearCode,
          yearName,
          startDate: nextStart,
          endDate: nextEnd,
          status: FiscalYearStatus.OPEN,
          previousFiscalYearId: closedFy.id,
          createdBy: context.userId,
        })
        .returning();
      nextFy = insertedFy!;

      if (opts.generateMonthlyPeriods !== false) {
        let cur = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth(), 1));
        let idx = 1;
        while (cur <= nextEnd && idx <= 12) {
          const pStart = new Date(cur);
          const pEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59, 999));
          const clampedEnd = pEnd > nextEnd ? nextEnd : pEnd;
          const periodName = `${yearCode}-P${String(idx).padStart(2, '0')}`;

          const [p] = await tx
            .insert(fiscalPeriods)
            .values({
              tenantId: context.tenantId,
              legalEntityId: closedFy.legalEntityId,
              fiscalYearId: nextFy.id,
              periodNumber: idx,
              periodName,
              startDate: pStart,
              endDate: clampedEnd,
              status: FiscalPeriodStatus.OPEN,
            })
            .returning();
          generatedPeriods.push(p);

          cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
          idx++;
        }
      }
    }

    // Compute permanent account closing balances as of closedFy.endDate (Continuous GL: NO duplicate GL entries!)
    const perm = await this.computePermanentBalancesInTx(
      tx,
      context,
      closedFy.legalEntityId,
      new Date(closedFy.endDate),
    );
    if (!perm.summary.isBalanced) {
      throw new BadRequestException(
        `تعذر ترحيل الأرصدة الافتتاحية لعدم توازن الأرصدة الدائمة (المدين: ${perm.summary.totalDebit}، الدائن: ${perm.summary.totalCredit})`,
      );
    }

    // Insert immutable opening balances for permanent accounts
    const insertedBalances: any[] = [];
    for (const b of perm.balances) {
      const [row] = await tx
        .insert(fiscalYearOpeningBalances)
        .values({
          tenantId: context.tenantId,
          legalEntityId: closedFy.legalEntityId,
          fiscalYearId: nextFy.id,
          sourceFiscalYearId: closedFy.id,
          accountId: b.accountId,
          branchId: b.branchId,
          currency: b.currency,
          openingDebit: b.openingDebit,
          openingCredit: b.openingCredit,
          netBalance: b.netBalance,
          status: 'ACTIVE',
          createdBy: context.userId,
        })
        .returning();
      insertedBalances.push(row);
    }

    // Capture Subledger Opening Snapshots (AR Customers, AP Suppliers, Inventory Valuation, TB Summary)
    const arRows = await tx
      .select({
        partnerId: partnerBalances.partnerId,
        currency: partnerBalances.currency,
        customerBalance: partnerBalances.customerBalance,
        customerUnallocatedReceipts: partnerBalances.customerUnallocatedReceipts,
      })
      .from(partnerBalances)
      .where(
        and(
          eq(partnerBalances.tenantId, context.tenantId),
          eq(partnerBalances.legalEntityId, closedFy.legalEntityId),
        ),
      );
    const arTotal = arRows.reduce((s: number, r: any) => s + parseFloat(r.customerBalance || '0'), 0);

    const apSupRows = await tx
      .select({
        supplierId: supplierBalances.supplierId,
        currentBalance: supplierBalances.currentBalance,
      })
      .from(supplierBalances)
      .where(
        and(
          eq(supplierBalances.tenantId, context.tenantId),
          eq(supplierBalances.legalEntityId, closedFy.legalEntityId),
        ),
      );
    const apPartnerRows = await tx
      .select({
        partnerId: partnerBalances.partnerId,
        currency: partnerBalances.currency,
        vendorBalance: partnerBalances.vendorBalance,
      })
      .from(partnerBalances)
      .where(
        and(
          eq(partnerBalances.tenantId, context.tenantId),
          eq(partnerBalances.legalEntityId, closedFy.legalEntityId),
        ),
      );
    const apTotal =
      apSupRows.reduce((s: number, r: any) => s + parseFloat(r.currentBalance || '0'), 0) +
      apPartnerRows.reduce((s: number, r: any) => s + parseFloat(r.vendorBalance || '0'), 0);

    const invRows = await tx
      .select({
        warehouseId: inventoryBalances.warehouseId,
        itemId: inventoryBalances.itemId,
        onHandQty: inventoryBalances.onHandQty,
        wacCost: inventoryBalances.wacCost,
      })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, closedFy.legalEntityId),
        ),
      );
    const invTotalValue = invRows.reduce(
      (s: number, r: any) =>
        s + parseFloat(r.onHandQty || '0') * parseFloat(r.wacCost || '0'),
      0,
    );

    const snapshotsToInsert = [
      {
        snapshotType: 'TRIAL_BALANCE_SUMMARY',
        totalDebit: perm.summary.totalDebit,
        totalCredit: perm.summary.totalCredit,
        isBalanced: perm.summary.isBalanced,
        payloadJson: perm.summary,
      },
      {
        snapshotType: 'AR_CUSTOMERS',
        totalDebit: arTotal.toFixed(4),
        totalCredit: '0.0000',
        isBalanced: true,
        payloadJson: { totalArBalance: arTotal.toFixed(4), count: arRows.length, partners: arRows },
      },
      {
        snapshotType: 'AP_SUPPLIERS',
        totalDebit: '0.0000',
        totalCredit: apTotal.toFixed(4),
        isBalanced: true,
        payloadJson: {
          totalApBalance: apTotal.toFixed(4),
          suppliersCount: apSupRows.length,
          partnersCount: apPartnerRows.length,
          suppliers: apSupRows,
          partners: apPartnerRows,
        },
      },
      {
        snapshotType: 'INVENTORY_VALUATION',
        totalDebit: invTotalValue.toFixed(4),
        totalCredit: '0.0000',
        isBalanced: true,
        payloadJson: {
          totalInventoryValue: invTotalValue.toFixed(4),
          skuWarehouseCount: invRows.length,
          items: invRows,
        },
      },
    ];

    for (const snap of snapshotsToInsert) {
      await tx.insert(fiscalYearOpeningSnapshots).values({
        tenantId: context.tenantId,
        legalEntityId: closedFy.legalEntityId,
        fiscalYearId: nextFy.id,
        sourceFiscalYearId: closedFy.id,
        snapshotType: snap.snapshotType,
        status: 'ACTIVE',
        totalDebit: snap.totalDebit,
        totalCredit: snap.totalCredit,
        isBalanced: snap.isBalanced,
        payloadJson: snap.payloadJson,
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:${snap.snapshotType}` : null,
        createdBy: context.userId,
      });
    }

    const [updatedNextFy] = await tx
      .update(fiscalYears)
      .set({ openingCarryForwardCompletedAt: new Date() })
      .where(eq(fiscalYears.id, nextFy.id))
      .returning();

    await tx.insert(fiscalPeriodClosingLogs).values({
      tenantId: context.tenantId,
      legalEntityId: closedFy.legalEntityId,
      periodId: null,
      fiscalYearId: nextFy.id,
      action: PeriodClosingAction.NEXT_YEAR_OPENED,
      previousStatus: 'NONE',
      newStatus: FiscalYearStatus.OPEN,
      actorId: context.userId,
      reason: `فتح السنة المالية ${nextFy.yearCode} وترحيل الأرصدة الافتتاحية من ${closedFy.yearCode}`,
      blockersCount: 0,
      warningsCount: 0,
      trialBalanceSnapshotJson: perm.summary,
      idempotencyKey: opts.idempotencyKey ?? null,
    });

    await this.auditService.log(
      {
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'NEXT_FISCAL_YEAR_OPENED',
        entityType: 'fiscal_year',
        entityId: nextFy.id,
        afterState: {
          yearCode: nextFy.yearCode,
          sourceFiscalYearId: closedFy.id,
          periodsGenerated: generatedPeriods.length,
          openingBalancesCount: insertedBalances.length,
          openingTotalDebit: perm.summary.totalDebit,
          openingTotalCredit: perm.summary.totalCredit,
        },
      },
      tx,
    );

    return {
      fiscalYear: updatedNextFy,
      periods: generatedPeriods,
      openingBalancesCount: insertedBalances.length,
      openingSummary: perm.summary,
      subledgerTotals: {
        arCustomers: arTotal.toFixed(4),
        apSuppliers: apTotal.toFixed(4),
        inventoryValuation: invTotalValue.toFixed(4),
      },
    };
  }

  async openNextFiscalYear(
    context: TenantContext,
    dto: {
      sourceFiscalYearId: string;
      nextYearCode?: string;
      nextYearName?: string;
      generateMonthlyPeriods?: boolean;
      idempotencyKey?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const lockKey = `fy-open-next:${context.tenantId}:${dto.sourceFiscalYearId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      if (dto.idempotencyKey) {
        const [existingLog] = await tx
          .select()
          .from(fiscalPeriodClosingLogs)
          .where(
            and(
              eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
              eq(fiscalPeriodClosingLogs.idempotencyKey, dto.idempotencyKey),
              eq(fiscalPeriodClosingLogs.action, PeriodClosingAction.NEXT_YEAR_OPENED),
            ),
          )
          .limit(1);
        if (existingLog?.fiscalYearId) {
          const [fy] = await tx
            .select()
            .from(fiscalYears)
            .where(eq(fiscalYears.id, existingLog.fiscalYearId))
            .limit(1);
          return {
            fiscalYear: fy,
            openingSummary: existingLog.trialBalanceSnapshotJson,
            idempotentHit: true,
          };
        }
      }

      const closedFy = await this.getFiscalYearAndVerifyScope(tx, context, dto.sourceFiscalYearId, true);
      const res = await this.openNextFiscalYearInTx(tx, context, closedFy, {
        nextYearCode: dto.nextYearCode,
        nextYearName: dto.nextYearName,
        generateMonthlyPeriods: dto.generateMonthlyPeriods,
        idempotencyKey: dto.idempotencyKey,
      });
      return { ...res, idempotentHit: false };
    });
  }

  /**
   * Reopens a CLOSED Fiscal Year with strict RBAC (`accounting.fiscal_year.reopen`),
   * mandatory reason (>= 10 chars), immutable REVERSAL journal entry for the closing entry,
   * unlocking periods from LOCKED -> CLOSED, and marking carried-forward opening balances SUPERSEDED.
   */
  async reopenFiscalYear(
    context: TenantContext,
    dto: {
      fiscalYearId: string;
      reason: string;
      idempotencyKey?: string;
    },
  ) {
    if (!this.postingEngine) {
      throw new BadRequestException('PostingEngineService is not available');
    }

    const cleanReason = (dto.reason || '').trim();
    if (cleanReason.length < 10) {
      throw new BadRequestException('يجب إدخال سبب واضح ومفصل لإعادة فتح السنة المالية (10 أحرف على الأقل)');
    }

    const revAllocRef: { number: string | null; legalEntityId: string | null } = {
      number: null,
      legalEntityId: null,
    };

    try {
      const outcome = await this.dbService.withTenantContext(context, async (tx) => {
        const lockKey = `fy-close:${context.tenantId}:${dto.fiscalYearId}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        if (dto.idempotencyKey) {
          const [existingLog] = await tx
            .select()
            .from(fiscalPeriodClosingLogs)
            .where(
              and(
                eq(fiscalPeriodClosingLogs.tenantId, context.tenantId),
                eq(fiscalPeriodClosingLogs.idempotencyKey, dto.idempotencyKey),
                eq(fiscalPeriodClosingLogs.action, PeriodClosingAction.YEAR_END_REOPENED),
              ),
            )
            .limit(1);
          if (existingLog?.fiscalYearId) {
            const [fy] = await tx
              .select()
              .from(fiscalYears)
              .where(eq(fiscalYears.id, existingLog.fiscalYearId))
              .limit(1);
            return { fiscalYear: fy, log: existingLog, reversalJournalEntry: null, idempotentHit: true };
          }
        }

        const fy = await this.getFiscalYearAndVerifyScope(tx, context, dto.fiscalYearId, true);
        if (fy.status !== FiscalYearStatus.CLOSED) {
          throw new BadRequestException(`السنة المالية '${fy.yearCode}' ليست مقفلة حالياً`);
        }

        // Cannot reopen FY N if FY N+1 is already CLOSED
        const [nextFy] = await tx
          .select({ id: fiscalYears.id, yearCode: fiscalYears.yearCode, status: fiscalYears.status })
          .from(fiscalYears)
          .where(
            and(
              eq(fiscalYears.tenantId, context.tenantId),
              eq(fiscalYears.legalEntityId, fy.legalEntityId),
              eq(fiscalYears.previousFiscalYearId, fy.id),
            ),
          )
          .limit(1);
        if (nextFy && nextFy.status === FiscalYearStatus.CLOSED) {
          throw new BadRequestException(
            `لا يمكن إعادة فتح السنة المالية '${fy.yearCode}' لأن السنة المالية التالية '${nextFy.yearCode}' مقفلة بالفعل`,
          );
        }

        // Reverse original closing entry via immutable REVERSAL entry (NEVER delete/mutate historical JE)
        let reversalEntry: any = null;
        if (fy.closingJournalEntryId) {
          const origLines = await tx
            .select()
            .from(journalLines)
            .where(eq(journalLines.journalEntryId, fy.closingJournalEntryId));

          if (origLines.length >= 2) {
            let revJournalNumber = `JV-REOPEN-${fy.yearCode}-${Date.now().toString(36).toUpperCase()}`;
            if (this.documentNumbering) {
              const alloc = await this.documentNumbering.allocateNextNumber(context, {
                legalEntityId: fy.legalEntityId,
                documentType: 'JOURNAL_ENTRY',
                documentDate: new Date(fy.endDate),
                sourceType: 'fiscal_year_reopen',
              });
              revJournalNumber = alloc.formattedNumber;
              revAllocRef.number = revJournalNumber;
              revAllocRef.legalEntityId = fy.legalEntityId;
            }

            const reversedLines = origLines.map((l: any) => ({
              accountId: l.accountId,
              branchId: l.branchId,
              costCenterId: l.costCenterId,
              partnerId: l.partnerId,
              partnerRole: l.partnerRole,
              currency: l.currency || 'SAR',
              debit: l.credit,
              credit: l.debit,
              description: `عكس قيد إقفال السنة المالية ${fy.yearCode} - السبب: ${cleanReason}`,
            }));

            reversalEntry = await this.postingEngine!.postEntry(
              context,
              {
                legalEntityId: fy.legalEntityId,
                journalNumber: revJournalNumber,
                journalType: JournalType.REVERSAL,
                sourceType: 'fiscal_year_reopen',
                sourceId: fy.id,
                entryDate: new Date(fy.endDate),
                description: `قيد عكسي لإعادة فتح السنة المالية ${fy.yearCode}`,
                notes: cleanReason,
                lines: reversedLines,
                allowClosingForYearId: fy.id,
              },
              tx,
            );

            await tx
              .update(journalEntries)
              .set({ reversalOfId: fy.closingJournalEntryId })
              .where(eq(journalEntries.id, reversalEntry.id));
          }
        }

        const now = new Date();
        const [reopenedFy] = await tx
          .update(fiscalYears)
          .set({
            status: FiscalYearStatus.OPEN,
            reopenedAt: now,
            reopenedBy: context.userId,
            reopenReason: cleanReason,
            reopenReversalJournalEntryId: reversalEntry?.id ?? null,
            closingIdempotencyKey: null,
          })
          .where(eq(fiscalYears.id, fy.id))
          .returning();

        // Unlock periods from LOCKED back to CLOSED (still require explicit period reopen if editing)
        await tx
          .update(fiscalPeriods)
          .set({ status: FiscalPeriodStatus.CLOSED })
          .where(
            and(
              eq(fiscalPeriods.tenantId, context.tenantId),
              eq(fiscalPeriods.legalEntityId, fy.legalEntityId),
              eq(fiscalPeriods.fiscalYearId, fy.id),
              eq(fiscalPeriods.status, FiscalPeriodStatus.LOCKED),
            ),
          );

        // Supersede any carried-forward opening balances & snapshots generated from this fiscal year
        await tx
          .update(fiscalYearOpeningBalances)
          .set({ status: 'SUPERSEDED' })
          .where(
            and(
              eq(fiscalYearOpeningBalances.tenantId, context.tenantId),
              eq(fiscalYearOpeningBalances.sourceFiscalYearId, fy.id),
              eq(fiscalYearOpeningBalances.status, 'ACTIVE'),
            ),
          );
        await tx
          .update(fiscalYearOpeningSnapshots)
          .set({ status: 'SUPERSEDED' })
          .where(
            and(
              eq(fiscalYearOpeningSnapshots.tenantId, context.tenantId),
              eq(fiscalYearOpeningSnapshots.sourceFiscalYearId, fy.id),
              eq(fiscalYearOpeningSnapshots.status, 'ACTIVE'),
            ),
          );
        if (nextFy) {
          await tx
            .update(fiscalYears)
            .set({ openingCarryForwardCompletedAt: null })
            .where(eq(fiscalYears.id, nextFy.id));
        }

        const [log] = await tx
          .insert(fiscalPeriodClosingLogs)
          .values({
            tenantId: context.tenantId,
            legalEntityId: fy.legalEntityId,
            periodId: null,
            fiscalYearId: fy.id,
            action: PeriodClosingAction.YEAR_END_REOPENED,
            previousStatus: FiscalYearStatus.CLOSED,
            newStatus: FiscalYearStatus.OPEN,
            actorId: context.userId,
            reason: cleanReason,
            blockersCount: 0,
            warningsCount: 0,
            idempotencyKey: dto.idempotencyKey ?? null,
          })
          .returning();

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'FISCAL_YEAR_REOPENED',
            entityType: 'fiscal_year',
            entityId: fy.id,
            beforeState: { status: FiscalYearStatus.CLOSED, closingJournalEntryId: fy.closingJournalEntryId },
            afterState: {
              status: FiscalYearStatus.OPEN,
              reopenReason: cleanReason,
              reopenReversalJournalEntryId: reversalEntry?.id ?? null,
            },
          },
          tx,
        );

        return {
          fiscalYear: reopenedFy,
          reversalJournalEntry: reversalEntry,
          log,
          idempotentHit: false,
        };
      });

      if (revAllocRef.number && revAllocRef.legalEntityId && this.documentNumbering) {
        await this.documentNumbering.markAllocationStatus(
          context,
          revAllocRef.number,
          'JOURNAL_ENTRY',
          revAllocRef.legalEntityId,
          'USED',
          outcome.reversalJournalEntry?.id,
        );
      }

      return outcome;
    } catch (err) {
      if (revAllocRef.number && revAllocRef.legalEntityId && this.documentNumbering) {
        await this.documentNumbering
          .markAllocationStatus(
            context,
            revAllocRef.number,
            'JOURNAL_ENTRY',
            revAllocRef.legalEntityId,
            'FAILED_TX',
          )
          .catch(() => {});
      }
      throw err;
    }
  }

  async getFiscalYearOpeningBalances(context: TenantContext, fiscalYearId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const fy = await this.getFiscalYearAndVerifyScope(tx, context, fiscalYearId);

      const balances = await tx
        .select({
          id: fiscalYearOpeningBalances.id,
          accountId: fiscalYearOpeningBalances.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          accountType: chartOfAccounts.accountType,
          branchId: fiscalYearOpeningBalances.branchId,
          currency: fiscalYearOpeningBalances.currency,
          openingDebit: fiscalYearOpeningBalances.openingDebit,
          openingCredit: fiscalYearOpeningBalances.openingCredit,
          netBalance: fiscalYearOpeningBalances.netBalance,
          status: fiscalYearOpeningBalances.status,
          createdAt: fiscalYearOpeningBalances.createdAt,
        })
        .from(fiscalYearOpeningBalances)
        .innerJoin(chartOfAccounts, eq(fiscalYearOpeningBalances.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(fiscalYearOpeningBalances.tenantId, context.tenantId),
            eq(fiscalYearOpeningBalances.fiscalYearId, fy.id),
            eq(fiscalYearOpeningBalances.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(chartOfAccounts.accountCode));

      const snapshots = await tx
        .select()
        .from(fiscalYearOpeningSnapshots)
        .where(
          and(
            eq(fiscalYearOpeningSnapshots.tenantId, context.tenantId),
            eq(fiscalYearOpeningSnapshots.fiscalYearId, fy.id),
            eq(fiscalYearOpeningSnapshots.status, 'ACTIVE'),
          ),
        );

      const totalDebit = balances.reduce((s: number, b: any) => s + parseFloat(b.openingDebit || '0'), 0);
      const totalCredit = balances.reduce((s: number, b: any) => s + parseFloat(b.openingCredit || '0'), 0);

      return {
        fiscalYear: fy,
        balances,
        totals: {
          totalDebit: totalDebit.toFixed(4),
          totalCredit: totalCredit.toFixed(4),
          discrepancy: Math.abs(totalDebit - totalCredit).toFixed(4),
          isBalanced: Math.abs(totalDebit - totalCredit) < 0.0001,
        },
        snapshots,
      };
    });
  }
}
