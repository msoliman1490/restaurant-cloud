import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  chartOfAccounts,
  journalEntries,
  journalLines,
  fiscalPeriods,
} from '@restaurant-cloud/database';
import {
  CreateChartOfAccount,
  CreateJournalEntry,
  CreateFiscalPeriodRequest,
  CloseFiscalPeriodRequest,
  ReverseJournalEntryRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalStatus,
  JournalType,
  FiscalPeriodStatus,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class AccountingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  // ==================================================================
  // 1. Chart of Accounts (COA)
  // ==================================================================

  async createAccount(context: TenantContext, dto: CreateChartOfAccount) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate unique account code within legal entity
      const [existing] = await tx
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
            eq(chartOfAccounts.accountCode, dto.accountCode)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Account code '${dto.accountCode}' already exists in this legal entity`
        );
      }

      if (dto.parentId) {
        const [parent] = await tx
          .select()
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.id, dto.parentId)
            )
          )
          .limit(1);

        if (!parent) throw new NotFoundException(`Parent account '${dto.parentId}' not found`);
      }

      const [account] = await tx
        .insert(chartOfAccounts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          accountCode: dto.accountCode,
          name: dto.name,
          accountType: dto.accountType,
          normalBalance: dto.normalBalance,
          parentId: dto.parentId || null,
          isPostable: dto.isPostable ?? true,
          status: 'ACTIVE',
        })
        .returning();

      if (!account) throw new Error('Failed to create account');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ACCOUNT_CREATED',
          entityType: 'chart_of_accounts',
          entityId: account.id,
          afterState: account,
        },
        tx
      );

      return account;
    });
  }

  async getChartOfAccounts(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId)
          )
        )
        .orderBy(asc(chartOfAccounts.accountCode));
    });
  }

  // ==================================================================
  // 2. Balanced Double-Entry Journal Posting
  // ==================================================================

  async postJournalEntry(context: TenantContext, dto: CreateJournalEntry) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Strict Double-Entry Balance Check
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of dto.lines) {
        const debit = parseFloat(line.debit || '0');
        const credit = parseFloat(line.credit || '0');

        if (debit < 0 || credit < 0) {
          throw new BadRequestException('Negative debits or credits are not permitted');
        }

        totalDebit += debit;
        totalCredit += credit;
      }

      if (Math.abs(totalDebit - totalCredit) > 0.0001) {
        throw new BadRequestException(
          `Unbalanced Journal Entry: Total Debit (${totalDebit.toFixed(4)}) must strictly equal Total Credit (${totalCredit.toFixed(4)})`
        );
      }

      // Check unique journal number within legal entity
      const [existingNumber] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, dto.legalEntityId),
            eq(journalEntries.journalNumber, dto.journalNumber)
          )
        )
        .limit(1);

      if (existingNumber) {
        throw new ConflictException(
          `Journal number '${dto.journalNumber}' already exists in this legal entity`
        );
      }

      // 2. Insert Header
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          journalNumber: dto.journalNumber,
          journalType: dto.journalType,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          status: JournalStatus.POSTED,
          debitTotal: totalDebit.toFixed(4),
          creditTotal: totalCredit.toFixed(4),
          postedBy: context.userId,
        })
        .returning();

      if (!entry) throw new Error('Failed to post journal entry');

      // 3. Insert Lines
      const createdLines = await tx
        .insert(journalLines)
        .values(
          dto.lines.map((l) => ({
            journalEntryId: entry.id,
            accountId: l.accountId,
            branchId: l.branchId || null,
            debit: l.debit || '0.0000',
            credit: l.credit || '0.0000',
            currency: l.currency || 'SAR',
            description: l.description || null,
          }))
        )
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'JOURNAL_ENTRY_POSTED',
          entityType: 'journal_entry',
          entityId: entry.id,
          afterState: { entry, lines: createdLines },
        },
        tx
      );

      return {
        ...entry,
        lines: createdLines,
      };
    });
  }

  // ==================================================================
  // 3. General Ledger & Trial Balance
  // ==================================================================

  async getGeneralLedger(
    context: TenantContext,
    params: { legalEntityId: string; accountId?: string; limit?: number; offset?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(journalEntries.tenantId, context.tenantId),
        eq(journalEntries.legalEntityId, params.legalEntityId),
      ];

      if (params.accountId) {
        conditions.push(eq(journalLines.accountId, params.accountId));
      }

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const rows = await tx
        .select({
          journalId: journalEntries.id,
          journalNumber: journalEntries.journalNumber,
          journalType: journalEntries.journalType,
          postedAt: journalEntries.postedAt,
          lineId: journalLines.id,
          accountId: journalLines.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: journalLines.description,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .where(and(...conditions))
        .orderBy(desc(journalEntries.postedAt))
        .limit(limit)
        .offset(offset);

      return rows;
    });
  }

  /**
   * Generates Trial Balance with full verification of Debit/Credit mathematical balance
   */
  async getTrialBalance(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const rows = await tx
        .select({
          accountId: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
        })
        .from(chartOfAccounts)
        .leftJoin(journalLines, eq(chartOfAccounts.id, journalLines.accountId))
        .leftJoin(journalEntries, and(
          eq(journalLines.journalEntryId, journalEntries.id),
          eq(journalEntries.status, JournalStatus.POSTED)
        ))
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId)
          )
        )
        .groupBy(
          chartOfAccounts.id,
          chartOfAccounts.accountCode,
          chartOfAccounts.name,
          chartOfAccounts.accountType
        )
        .orderBy(asc(chartOfAccounts.accountCode));

      let grandDebit = 0;
      let grandCredit = 0;

      const accounts = rows.map((r) => {
        const d = parseFloat(r.totalDebit);
        const c = parseFloat(r.totalCredit);
        grandDebit += d;
        grandCredit += c;

        return {
          ...r,
          netBalance: (d - c).toFixed(4),
        };
      });

      const discrepancy = Math.abs(grandDebit - grandCredit);

      return {
        legalEntityId,
        grandDebitTotal: grandDebit.toFixed(4),
        grandCreditTotal: grandCredit.toFixed(4),
        discrepancy: discrepancy.toFixed(4),
        isBalanced: discrepancy < 0.0001,
        accounts,
      };
    });
  }

  // ==================================================================
  // 4. Inviolable Journal Reversal (Immutability Pattern)
  // ==================================================================

  /**
   * In accounting, posted entries can NEVER be modified directly.
   * Correction is performed by posting an exact inverse entry (Debit <-> Credit reversed).
   */
  async reverseJournalEntry(context: TenantContext, dto: ReverseJournalEntryRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.id, dto.journalEntryId)
          )
        )
        .limit(1);

      if (!entry) throw new NotFoundException(`Journal entry '${dto.journalEntryId}' not found`);

      if (entry.status === JournalStatus.REVERSED) {
        throw new BadRequestException('This journal entry has already been reversed');
      }

      const originalLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, entry.id));

      // 1. Mark original entry as REVERSED
      await tx
        .update(journalEntries)
        .set({ status: JournalStatus.REVERSED })
        .where(eq(journalEntries.id, entry.id));

      // 2. Post the inverted reversal entry
      const reversalLines = originalLines.map((l) => ({
        accountId: l.accountId,
        branchId: l.branchId,
        debit: l.credit,   // Inverted
        credit: l.debit,   // Inverted
        currency: l.currency,
        description: `Reversal of ${entry.journalNumber}: ${dto.reversalReason}`,
      }));

      const reversalResult = await this.postJournalEntry(context, {
        legalEntityId: entry.legalEntityId,
        journalNumber: dto.newJournalNumber,
        journalType: entry.journalType as any,
        sourceType: 'journal_reversal',
        sourceId: entry.id,
        lines: reversalLines,
      });

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'JOURNAL_ENTRY_REVERSED',
          entityType: 'journal_entry',
          entityId: entry.id,
          afterState: { originalId: entry.id, reversalJournal: reversalResult },
        },
        tx
      );

      return reversalResult;
    });
  }

  // ==================================================================
  // 5. Fiscal Periods Management
  // ==================================================================

  async createFiscalPeriod(context: TenantContext, dto: CreateFiscalPeriodRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: fiscalPeriods.id })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, context.tenantId),
            eq(fiscalPeriods.legalEntityId, dto.legalEntityId),
            eq(fiscalPeriods.periodName, dto.periodName)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Fiscal period '${dto.periodName}' already exists`);
      }

      const [period] = await tx
        .insert(fiscalPeriods)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          periodName: dto.periodName,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          status: FiscalPeriodStatus.OPEN,
        })
        .returning();

      return period;
    });
  }

  async closeFiscalPeriod(context: TenantContext, dto: CloseFiscalPeriodRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [period] = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, context.tenantId),
            eq(fiscalPeriods.id, dto.periodId)
          )
        )
        .limit(1);

      if (!period) throw new NotFoundException(`Fiscal period '${dto.periodId}' not found`);

      const [closed] = await tx
        .update(fiscalPeriods)
        .set({
          status: FiscalPeriodStatus.CLOSED,
          closedAt: new Date(),
          closedBy: context.userId,
        })
        .where(eq(fiscalPeriods.id, period.id))
        .returning();

      return closed;
    });
  }
}
