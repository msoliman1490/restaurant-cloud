import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  TenantContext,
  FiscalPeriodStatus,
  FiscalYearStatus,
  PeriodClosingAction,
  ClosingCheckSeverity,
  JournalStatus,
  ReconciliationStatus,
  TransferDiscrepancyStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  fiscalYears,
  fiscalPeriods,
  fiscalPeriodClosingLogs,
  journalEntries,
  journalLines,
  posShifts,
  settlementBatches,
  stockTransfers,
  stockTransferDiscrepancies,
  paymentVouchers,
  receiptVouchers,
  legalEntities,
  branches,
} from '@restaurant-cloud/database';
import { eq, and, gte, lte, desc, asc, sql, inArray, ne } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { AccountingService } from './accounting.service';
import { ReconciliationService } from './reconciliation.service';

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
        if (existingLog) {
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
        if (existingLog) {
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
}
