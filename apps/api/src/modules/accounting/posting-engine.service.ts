import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  chartOfAccounts,
  journalEntries,
  journalLines,
  accountMappings,
  fiscalPeriods,
  cashVaults,
  bankAccounts,
  vaultTransactions,
} from '@restaurant-cloud/database';
import {
  TenantContext,
  JournalStatus,
  JournalType,
  FiscalPeriodStatus,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql } from 'drizzle-orm';

export interface PostingLineInput {
  accountId?: string;
  mappingKey?: DefaultAccountMappingKey | string;
  branchId?: string | null;
  costCenterId?: string | null;
  partnerId?: string | null;
  partnerRole?: string | null;
  subledgerDocumentType?: string | null;
  subledgerDocumentId?: string | null;
  debit: string | number;
  credit: string | number;
  currency?: string;
  description?: string;
}

export interface PostJournalParams {
  legalEntityId: string;
  branchId?: string | null;
  journalNumber: string;
  journalType: JournalType;
  sourceType: string;
  sourceId: string;
  description?: string;
  notes?: string;
  entryDate?: Date;
  lines: PostingLineInput[];
}

@Injectable()
export class PostingEngineService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Resolves an account ID from explicit accountId or from the legal entity's AccountMappings table.
   */
  async resolveAccountId(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    line: PostingLineInput,
    fallbackBranchId?: string
  ): Promise<string> {
    if (line.accountId) {
      // Validate that the account exists, belongs to tenant & legal entity, and is postable
      const [acc] = await tx
        .select({
          id: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          name: chartOfAccounts.name,
          nameAr: chartOfAccounts.nameAr,
          isPostable: chartOfAccounts.isPostable,
          status: chartOfAccounts.status,
        })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId),
            eq(chartOfAccounts.id, line.accountId)
          )
        )
        .limit(1);

      if (!acc) {
        throw new NotFoundException(`الحساب المحدد غير موجود: ${line.accountId}`);
      }

      // 1. Inactive account guard
      if (acc.status && acc.status !== 'ACTIVE') {
        throw new BadRequestException(`لا يمكن الترحيل لحساب غير نشط: (${acc.accountCode} - ${acc.nameAr || acc.name})`);
      }

      // 2. isPostable flag guard
      if (!acc.isPostable) {
        throw new BadRequestException(`لا يمكن الترحيل لحساب رئيسي/تجميعي: (${acc.accountCode} - ${acc.nameAr || acc.name})`);
      }

      // 3. Dynamic hierarchy child-check guard
      const [childCheck] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.parentId, acc.id)
          )
        );
      if (childCheck && childCheck.count > 0) {
        throw new BadRequestException(`لا يمكن الترحيل لحساب تجميعي لديه حسابات فرعية: (${acc.accountCode} - ${acc.nameAr || acc.name})`);
      }

      // Guarded Control Accounts Enforcement (113000 AR Control / 211000 AP Control)
      if ((acc.accountCode === '113000' || acc.accountCode === '211000') && !line.partnerId) {
        throw new BadRequestException(`حساب المراقبة (${acc.accountCode} - ${acc.nameAr || acc.name}) محمي ويتطلب تحديد الطرف التجاري (partnerId)`);
      }

      return acc.id;
    }

    if (line.mappingKey) {
      const effectiveBranchId = line.branchId || fallbackBranchId || null;

      // 1. Branch Override
      if (effectiveBranchId) {
        const [branchOverride] = await tx
          .select({
            accountId: accountMappings.accountId,
            accountCode: chartOfAccounts.accountCode,
            status: chartOfAccounts.status,
            isPostable: chartOfAccounts.isPostable,
          })
          .from(accountMappings)
          .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
          .where(
            and(
              eq(accountMappings.tenantId, context.tenantId),
              eq(accountMappings.legalEntityId, legalEntityId),
              eq(accountMappings.branchId, effectiveBranchId),
              eq(accountMappings.mappingKey, line.mappingKey),
              eq(accountMappings.isActive, true)
            )
          )
          .limit(1);

        if (branchOverride) {
          if (branchOverride.status !== 'ACTIVE' || !branchOverride.isPostable) {
            throw new BadRequestException(
              `الحساب المخصص للفرع للمفتاح '${line.mappingKey}' (${branchOverride.accountCode}) غير نشط أو غير قابل للترحيل`
            );
          }
          return branchOverride.accountId;
        }
      }

      // 2. Company Default Mapping (branch_id IS NULL)
      const [companyMapping] = await tx
        .select({
          accountId: accountMappings.accountId,
          accountCode: chartOfAccounts.accountCode,
          status: chartOfAccounts.status,
          isPostable: chartOfAccounts.isPostable,
        })
        .from(accountMappings)
        .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, legalEntityId),
            sql`${accountMappings.branchId} IS NULL`,
            eq(accountMappings.mappingKey, line.mappingKey),
            eq(accountMappings.isActive, true)
          )
        )
        .limit(1);

      if (companyMapping) {
        if (companyMapping.status !== 'ACTIVE' || !companyMapping.isPostable) {
          throw new BadRequestException(
            `الحساب الافتراضي للمنشأة للمفتاح '${line.mappingKey}' (${companyMapping.accountCode}) غير نشط أو غير قابل للترحيل`
          );
        }
        return companyMapping.accountId;
      }

      // 3. System Default (Well-known standard chart codes)
      const standardDefaultCodes: Record<string, string> = {
        [DefaultAccountMappingKey.SALES]: '411000',
        [DefaultAccountMappingKey.VAT_OUTPUT]: '211200',
        [DefaultAccountMappingKey.VAT_INPUT]: '114200',
        [DefaultAccountMappingKey.COGS]: '511000',
        [DefaultAccountMappingKey.INVENTORY]: '112000',
        [DefaultAccountMappingKey.CASH_VAULT]: '111100',
        [DefaultAccountMappingKey.BANK]: '111200',
        [DefaultAccountMappingKey.MADA_CLEARING]: '111300',
        [DefaultAccountMappingKey.CARD_CLEARING]: '111350',
        [DefaultAccountMappingKey.VISA_CLEARING]: '111400',
        [DefaultAccountMappingKey.APPLE_PAY_CLEARING]: '111500',
        [DefaultAccountMappingKey.STC_PAY_CLEARING]: '111600',
        [DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE]: '113100',
        [DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE]: '113200',
        [DefaultAccountMappingKey.AGGREGATOR_COMMISSION]: '512000',
        [DefaultAccountMappingKey.GATEWAY_FEES]: '512100',
        [DefaultAccountMappingKey.AGGREGATOR_SUSPENSE]: '211900',
        [DefaultAccountMappingKey.SALES_DISCOUNTS]: '412000',
        [DefaultAccountMappingKey.INTER_BRANCH_CLEARING]: '119100',
        [DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]: '112900',
        [DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS]: '519200',
        [DefaultAccountMappingKey.INVENTORY_GAIN]: '419300',
        [DefaultAccountMappingKey.DUE_FROM_AFFILIATE]: '119200',
        [DefaultAccountMappingKey.DUE_TO_AFFILIATE]: '219200',
        [DefaultAccountMappingKey.CASH_IN_TRANSIT]: '111900',
        [DefaultAccountMappingKey.CASH_OVER_SHORT]: '519100',
        [DefaultAccountMappingKey.CASH_OVERAGE]: '419200',
        [DefaultAccountMappingKey.ROUNDING_DIFFERENCE]: '419100',
        [DefaultAccountMappingKey.GENERAL_EXPENSE]: '519000',
      };

      const defaultCode = standardDefaultCodes[line.mappingKey];
      if (defaultCode) {
        const [sysDefault] = await tx
          .select({
            id: chartOfAccounts.id,
            accountCode: chartOfAccounts.accountCode,
            accountType: chartOfAccounts.accountType,
            status: chartOfAccounts.status,
            isPostable: chartOfAccounts.isPostable,
          })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, legalEntityId),
              eq(chartOfAccounts.accountCode, defaultCode)
            )
          )
          .limit(1);

        if (sysDefault) {
          if (sysDefault.status !== 'ACTIVE' || !sysDefault.isPostable) {
            throw new BadRequestException(
              `الحساب الافتراضي للنظام للمفتاح '${line.mappingKey}' (${sysDefault.accountCode}) غير نشط أو غير قابل للترحيل`
            );
          }
          if (
            (line.mappingKey === DefaultAccountMappingKey.CASH_OVER_SHORT ||
              line.mappingKey === DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS) &&
            sysDefault.accountType !== 'EXPENSE' &&
            sysDefault.accountType !== 'OTHER_EXPENSE'
          ) {
            throw new BadRequestException(
              `الحساب الافتراضي للمفتاح '${line.mappingKey}' (${sysDefault.accountCode}) غير متوافق نوعياً؛ يجب أن يكون مصروفات`
            );
          }
          if (
            (line.mappingKey === DefaultAccountMappingKey.CASH_OVERAGE ||
              line.mappingKey === DefaultAccountMappingKey.INVENTORY_GAIN) &&
            sysDefault.accountType !== 'REVENUE' &&
            sysDefault.accountType !== 'OTHER_INCOME'
          ) {
            throw new BadRequestException(
              `الحساب الافتراضي للمفتاح '${line.mappingKey}' (${sysDefault.accountCode}) غير متوافق نوعياً؛ يجب أن يكون إيرادات`
            );
          }
          return sysDefault.id;
        }
      }

      // 4. Strict Failure Guard
      throw new BadRequestException(
        `لم يتم العثور على ربط محاسبي صالح للمفتاح '${line.mappingKey}' في المنشأة القانونية أو الفرع المحدد`
      );
    }

    throw new BadRequestException('يجب تحديد accountId أو mappingKey لكل بند في القيد');
  }

  /**
   * Validates that the transaction date does not fall within a CLOSED fiscal period.
   */
  async assertPeriodIsOpen(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    entryDate: Date
  ): Promise<string | null> {
    const periods = await tx
      .select({
        id: fiscalPeriods.id,
        periodName: fiscalPeriods.periodName,
        status: fiscalPeriods.status,
        startDate: fiscalPeriods.startDate,
        endDate: fiscalPeriods.endDate,
      })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.tenantId, context.tenantId),
          eq(fiscalPeriods.legalEntityId, legalEntityId)
        )
      );

    // If no periods are defined yet, allow posting (open by default)
    if (periods.length === 0) return null;

    const matchedPeriod = periods.find(
      (p: { startDate: Date; endDate: Date }) =>
        new Date(p.startDate) <= entryDate && entryDate <= new Date(p.endDate)
    );

    if (matchedPeriod) {
      if (
        matchedPeriod.status === FiscalPeriodStatus.CLOSED ||
        matchedPeriod.status === FiscalPeriodStatus.CLOSING ||
        matchedPeriod.status === FiscalPeriodStatus.LOCKED
      ) {
        throw new BadRequestException(
          `لا يمكن إنشاء أو ترحيل قيود في فترة مالية مغلقة أو قيد الإقفال (${matchedPeriod.periodName} - ${matchedPeriod.status})`
        );
      }
      return matchedPeriod.id;
    }

    return null;
  }

  /**
   * Core posting function: strictly validates double-entry balance, ensures open period,
   * generates immutable journal entry with lines in atomic transaction.
   */
  async postEntry(context: TenantContext, params: PostJournalParams, externalTx?: any) {
    const runner = async (tx: any) => {
      const entryDate = params.entryDate || new Date();

      // 1. Verify Fiscal Period
      const fiscalPeriodId = await this.assertPeriodIsOpen(
        tx,
        context,
        params.legalEntityId,
        entryDate
      );

      // 2. Strict Double-Entry Balance Calculation
      let totalDebit = 0;
      let totalCredit = 0;

      const resolvedLines: Array<{
        accountId: string;
        branchId: string | null;
        costCenterId: string | null;
        partnerId: string | null;
        partnerRole: string | null;
        subledgerDocumentType: string | null;
        subledgerDocumentId: string | null;
        debit: string;
        credit: string;
        currency: string;
        description: string | null;
      }> = [];

      for (const line of params.lines) {
        const d = parseFloat(String(line.debit || '0'));
        const c = parseFloat(String(line.credit || '0'));

        if (d < 0 || c < 0) {
          throw new BadRequestException('القيم المدينة والدائنة لا يمكن أن تكون سالبة');
        }

        if (d === 0 && c === 0) {
          continue; // Skip zero line
        }

        totalDebit += d;
        totalCredit += c;

        const resolvedAccountId = await this.resolveAccountId(
          tx,
          context,
          params.legalEntityId,
          line,
          params.branchId || undefined
        );

        resolvedLines.push({
          accountId: resolvedAccountId,
          branchId: line.branchId || params.branchId || null,
          costCenterId: line.costCenterId || null,
          partnerId: line.partnerId || null,
          partnerRole: line.partnerRole || null,
          subledgerDocumentType: line.subledgerDocumentType || null,
          subledgerDocumentId: line.subledgerDocumentId || null,
          debit: d.toFixed(4),
          credit: c.toFixed(4),
          currency: line.currency || 'SAR',
          description: line.description || params.description || null,
        });
      }

      if (resolvedLines.length < 2) {
        throw new BadRequestException('يجب أن يحتوي القيد على بندين على الأقل');
      }

      const discrepancy = Math.abs(totalDebit - totalCredit);
      if (discrepancy > 0.0001) {
        throw new BadRequestException(
          `قيد غير متوازن: إجمالي المدين (${totalDebit.toFixed(4)}) لا يساوي إجمالي الدائن (${totalCredit.toFixed(4)})، الفرق: ${discrepancy.toFixed(4)}`
        );
      }

      // 3. Unique Journal Number check
      const [existing] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, params.legalEntityId),
            eq(journalEntries.journalNumber, params.journalNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`رقم القيد '${params.journalNumber}' موجود مسبقاً في هذه المنشأة`);
      }

      // 4. Insert Journal Header
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          tenantId: context.tenantId,
          legalEntityId: params.legalEntityId,
          branchId: params.branchId || null,
          journalNumber: params.journalNumber,
          journalType: params.journalType,
          sourceType: params.sourceType || 'MANUAL',
          sourceId: params.sourceId || randomUUID(),
          status: JournalStatus.POSTED,
          approvalStatus: 'APPROVED',
          debitTotal: totalDebit.toFixed(4),
          creditTotal: totalCredit.toFixed(4),
          description: params.description || null,
          notes: params.notes || null,
          documentDate: entryDate,
          entryDate,
          fiscalPeriodId,
          postedAt: new Date(),
          postedBy: context.userId,
          approvedBy: context.userId,
          approvedAt: new Date(),
        })
        .returning();

      if (!entry) throw new Error('فشل إنشاء ترويسة القيد المحاسبي');

      // 5. Insert Journal Lines
      const createdLines = await tx
        .insert(journalLines)
        .values(
          resolvedLines.map((l) => ({
            journalEntryId: entry.id,
            accountId: l.accountId,
            branchId: l.branchId,
            costCenterId: l.costCenterId,
            partnerId: l.partnerId,
            partnerRole: l.partnerRole,
            subledgerDocumentType: l.subledgerDocumentType,
            subledgerDocumentId: l.subledgerDocumentId,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency,
            description: l.description,
          }))
        )
        .returning();

      // 6. Audit Trail
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'FINANCIAL_JOURNAL_POSTED',
          entityType: 'journal_entries',
          entityId: entry.id,
          afterState: { entry, lines: createdLines },
        },
        tx
      );

      return {
        ...entry,
        lines: createdLines,
      };
    };

    if (externalTx) {
      return await runner(externalTx);
    }
    return await this.dbService.withTenantContext(context, runner);
  }

  /**
   * Generates balanced journal entry for Sales Orders (POS/Takeaway/Dine-In)
   * Debit: Cash Vault / Mada / AR
   * Credit: Sales Revenue, Output VAT (15%)
   */
  async postSalesOrderJournal(
    context: TenantContext,
    params: {
      orderId: string;
      orderNumber: string;
      legalEntityId: string;
      branchId?: string | null;
      subtotal: string | number;
      vatAmount: string | number;
      totalAmount: string | number;
      paymentMethod: string;
      vaultAccountId?: string;
    },
    externalTx?: any
  ) {
    const total = parseFloat(String(params.totalAmount));
    const subtotal = parseFloat(String(params.subtotal));
    const vat = parseFloat(String(params.vatAmount));

    const lines: PostingLineInput[] = [
      {
        accountId: params.vaultAccountId,
        mappingKey: params.vaultAccountId ? undefined : DefaultAccountMappingKey.CASH_VAULT,
        branchId: params.branchId,
        debit: total.toFixed(4),
        credit: '0.0000',
        description: `تحصيل مبيعات الفاتورة ${params.orderNumber} (${params.paymentMethod})`,
      },
      {
        mappingKey: DefaultAccountMappingKey.SALES,
        branchId: params.branchId,
        debit: '0.0000',
        credit: subtotal.toFixed(4),
        description: `إيراد مبيعات الفاتورة ${params.orderNumber}`,
      },
    ];

    if (vat > 0) {
      lines.push({
        mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
        branchId: params.branchId,
        debit: '0.0000',
        credit: vat.toFixed(4),
        description: `ضريبة القيمة المضافة المستحقة (15%) - فاتورة ${params.orderNumber}`,
      });
    }

    return await this.postEntry(
      context,
      {
        legalEntityId: params.legalEntityId,
        branchId: params.branchId,
        journalNumber: `JV-POS-${params.orderNumber}`,
        journalType: JournalType.GENERAL,
        sourceType: 'sales_orders',
        sourceId: params.orderId,
        description: `قيد مبيعات نقاط البيع - الفاتورة #${params.orderNumber}`,
        lines,
      },
      externalTx
    );
  }
}
