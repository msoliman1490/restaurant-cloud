import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  arInvoices,
  apInvoices,
  chartOfAccounts,
  journalLines,
  journalEntries,
} from '@restaurant-cloud/database';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, inArray } from 'drizzle-orm';

@Injectable()
export class SubledgerReconciliationService {
  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Reconcile AR Subledger against General Ledger Control Account (113000)
   */
  async reconcileAr(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Sum of Remaining Amount of all Open AR Invoices
      const [subledgerSum] = await tx
        .select({
          totalRemaining: sql<string>`COALESCE(SUM(remaining_amount), 0)`,
          invoiceCount: sql<number>`COUNT(*)`,
        })
        .from(arInvoices)
        .where(
          and(
            eq(arInvoices.tenantId, context.tenantId),
            eq(arInvoices.legalEntityId, legalEntityId),
            inArray(arInvoices.status, ['POSTED', 'PARTIALLY_PAID'])
          )
        );

      const subledgerTotal = parseFloat(subledgerSum?.totalRemaining || '0');

      // 2. Fetch Account 113000 (AR Control)
      const [arAccount] = await tx
        .select({ id: chartOfAccounts.id, code: chartOfAccounts.accountCode, name: chartOfAccounts.name })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId),
            eq(chartOfAccounts.accountCode, '113000')
          )
        )
        .limit(1);

      if (!arAccount) {
        throw new NotFoundException('حساب مراقبة العملاء (113000) غير موجود لهذه الشركة');
      }

      // 3. Calculate GL Net Balance for AR Control (Debit - Credit)
      const [glSum] = await tx
        .select({
          totalDebit: sql<string>`COALESCE(SUM(debit), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(credit), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, legalEntityId),
            eq(journalLines.accountId, arAccount.id),
            eq(journalEntries.status, 'POSTED')
          )
        );

      const glDebit = parseFloat(glSum?.totalDebit || '0');
      const glCredit = parseFloat(glSum?.totalCredit || '0');
      const glNetBalance = glDebit - glCredit;

      // 4. Invariant: Zero Drift Variance
      const variance = Math.abs(subledgerTotal - glNetBalance);
      const isBalanced = variance < 0.0001;

      return {
        legalEntityId,
        subledgerType: 'ACCOUNTS_RECEIVABLE',
        controlAccount: {
          code: arAccount.code,
          name: arAccount.name,
        },
        subledger: {
          openInvoicesTotal: subledgerTotal.toFixed(4),
          openInvoiceCount: Number(subledgerSum?.invoiceCount || 0),
        },
        generalLedger: {
          totalDebit: glDebit.toFixed(4),
          totalCredit: glCredit.toFixed(4),
          netBalance: glNetBalance.toFixed(4),
        },
        variance: variance.toFixed(4),
        isBalanced,
        status: isBalanced ? 'PERFECT_MATCH_ZERO_DRIFT' : 'OUT_OF_BALANCE_VARIANCE_DETECTED',
        reconciledAt: new Date(),
      };
    });
  }

  /**
   * Reconcile AP Subledger against General Ledger Control Account (211000)
   */
  async reconcileAp(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Sum of Remaining Amount of all Open AP Invoices
      const [subledgerSum] = await tx
        .select({
          totalRemaining: sql<string>`COALESCE(SUM(remaining_amount), 0)`,
          invoiceCount: sql<number>`COUNT(*)`,
        })
        .from(apInvoices)
        .where(
          and(
            eq(apInvoices.tenantId, context.tenantId),
            eq(apInvoices.legalEntityId, legalEntityId),
            inArray(apInvoices.status, ['POSTED', 'PARTIALLY_PAID'])
          )
        );

      const subledgerTotal = parseFloat(subledgerSum?.totalRemaining || '0');

      // 2. Fetch Account 211000 (AP Control)
      const [apAccount] = await tx
        .select({ id: chartOfAccounts.id, code: chartOfAccounts.accountCode, name: chartOfAccounts.name })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId),
            eq(chartOfAccounts.accountCode, '211000')
          )
        )
        .limit(1);

      if (!apAccount) {
        throw new NotFoundException('حساب مراقبة الموردين (211000) غير موجود لهذه الشركة');
      }

      // 3. Calculate GL Net Balance for AP Control (Credit - Debit)
      const [glSum] = await tx
        .select({
          totalDebit: sql<string>`COALESCE(SUM(debit), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(credit), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, legalEntityId),
            eq(journalLines.accountId, apAccount.id),
            eq(journalEntries.status, 'POSTED')
          )
        );

      const glDebit = parseFloat(glSum?.totalDebit || '0');
      const glCredit = parseFloat(glSum?.totalCredit || '0');
      const glNetBalance = glCredit - glDebit;

      // 4. Invariant: Zero Drift Variance
      const variance = Math.abs(subledgerTotal - glNetBalance);
      const isBalanced = variance < 0.0001;

      return {
        legalEntityId,
        subledgerType: 'ACCOUNTS_PAYABLE',
        controlAccount: {
          code: apAccount.code,
          name: apAccount.name,
        },
        subledger: {
          openInvoicesTotal: subledgerTotal.toFixed(4),
          openInvoiceCount: Number(subledgerSum?.invoiceCount || 0),
        },
        generalLedger: {
          totalDebit: glDebit.toFixed(4),
          totalCredit: glCredit.toFixed(4),
          netBalance: glNetBalance.toFixed(4),
        },
        variance: variance.toFixed(4),
        isBalanced,
        status: isBalanced ? 'PERFECT_MATCH_ZERO_DRIFT' : 'OUT_OF_BALANCE_VARIANCE_DETECTED',
        reconciledAt: new Date(),
      };
    });
  }
}
