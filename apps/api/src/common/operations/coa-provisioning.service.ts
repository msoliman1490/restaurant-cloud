import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  chartOfAccounts,
  accountMappings,
  documentSequences,
} from '@restaurant-cloud/database';
import {
  AccountType,
  DefaultAccountMappingKey,
  NormalBalance,
} from '@restaurant-cloud/domain-kernel';
import { AuditService } from '../../modules/audit/audit.service';
import { DEFAULT_PREFIX_MAP } from './document-numbering.service';

export interface CoaTemplateNode {
  accountCode: string;
  nameAr: string;
  nameEn: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  level: number;
  parentCode?: string;
  isPostable: boolean;
  mappingKey?: DefaultAccountMappingKey;
}

export const STANDARD_COA_TEMPLATE: CoaTemplateNode[] = [
  // Level 1 — Root Categories
  { accountCode: '100000', nameAr: 'الأصول', nameEn: 'Assets', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 1, isPostable: false },
  { accountCode: '200000', nameAr: 'الالتزامات', nameEn: 'Liabilities', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 1, isPostable: false },
  { accountCode: '300000', nameAr: 'حقوق الملكية', nameEn: 'Equity', accountType: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT, level: 1, isPostable: false },
  { accountCode: '400000', nameAr: 'الإيرادات', nameEn: 'Revenue', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 1, isPostable: false },
  { accountCode: '500000', nameAr: 'المصروفات والتكاليف', nameEn: 'Expenses & COGS', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 1, isPostable: false },

  // Level 2 — Account Groups
  { accountCode: '110000', nameAr: 'الأصول المتداولة', nameEn: 'Current Assets', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 2, parentCode: '100000', isPostable: false },
  { accountCode: '210000', nameAr: 'الالتزامات المتداولة', nameEn: 'Current Liabilities', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 2, parentCode: '200000', isPostable: false },
  { accountCode: '310000', nameAr: 'رأس المال والأرباح المبقاة', nameEn: 'Capital & Retained Earnings', accountType: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT, level: 2, parentCode: '300000', isPostable: false },
  { accountCode: '410000', nameAr: 'إيرادات النشاط والمبيعات', nameEn: 'Operating Revenue', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 2, parentCode: '400000', isPostable: false },
  { accountCode: '510000', nameAr: 'تكلفة المبيعات والمصروفات التشغيلية', nameEn: 'COGS & Operating Expenses', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 2, parentCode: '500000', isPostable: false },

  // Level 3 — Postable Assets
  { accountCode: '111100', nameAr: 'الصناديق والخزائن النقدية', nameEn: 'Cash & Vaults', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.CASH_VAULT },
  { accountCode: '111200', nameAr: 'الحسابات البنكية الجارية', nameEn: 'Bank Accounts', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.BANK },
  { accountCode: '111300', nameAr: 'مقاصة مدى', nameEn: 'Mada Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.MADA_CLEARING },
  { accountCode: '111350', nameAr: 'مقاصة البطاقات الإلكترونية', nameEn: 'Card Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.CARD_CLEARING },
  { accountCode: '111400', nameAr: 'مقاصة فيزا وماستركارد', nameEn: 'Visa / Mastercard Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.VISA_CLEARING },
  { accountCode: '111500', nameAr: 'مقاصة Apple Pay', nameEn: 'Apple Pay Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.APPLE_PAY_CLEARING },
  { accountCode: '111600', nameAr: 'مقاصة STC Pay', nameEn: 'STC Pay Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.STC_PAY_CLEARING },
  { accountCode: '111900', nameAr: 'النقدية في الطريق', nameEn: 'Cash in Transit', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.CASH_IN_TRANSIT },
  { accountCode: '112000', nameAr: 'مخزون المواد الغذائية والمستودعات', nameEn: 'Inventory', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.INVENTORY },
  { accountCode: '112900', nameAr: 'مخزون في الطريق', nameEn: 'Inventory in Transit', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT },
  { accountCode: '113100', nameAr: 'ذمم العملاء المدينة', nameEn: 'Accounts Receivable', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE },
  { accountCode: '113200', nameAr: 'مستحقات تطبيقات التوصيل', nameEn: 'Aggregator Receivable', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE },
  { accountCode: '114200', nameAr: 'ضريبة القيمة المضافة - مدخلات', nameEn: 'VAT Input', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.VAT_INPUT },
  { accountCode: '119100', nameAr: 'حساب مقاصة الفروع', nameEn: 'Inter-Branch Clearing', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.INTER_BRANCH_CLEARING },
  { accountCode: '119200', nameAr: 'مستحق من شركات شقيقة', nameEn: 'Due from Affiliate', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '110000', isPostable: true, mappingKey: DefaultAccountMappingKey.DUE_FROM_AFFILIATE },

  // Level 3 — Postable Liabilities
  { accountCode: '211100', nameAr: 'ذمم الموردين الدائنة', nameEn: 'Accounts Payable', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '210000', isPostable: true, mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE },
  { accountCode: '211200', nameAr: 'ضريبة القيمة المضافة - مخرجات', nameEn: 'VAT Output', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '210000', isPostable: true, mappingKey: DefaultAccountMappingKey.VAT_OUTPUT },
  { accountCode: '211900', nameAr: 'معلقات تطبيقات التوصيل', nameEn: 'Aggregator Suspense', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '210000', isPostable: true, mappingKey: DefaultAccountMappingKey.AGGREGATOR_SUSPENSE },
  { accountCode: '219200', nameAr: 'مستحق لشركات شقيقة', nameEn: 'Due to Affiliate', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '210000', isPostable: true, mappingKey: DefaultAccountMappingKey.DUE_TO_AFFILIATE },

  // Level 3 — Postable Equity
  { accountCode: '311000', nameAr: 'الأرباح المبقاة', nameEn: 'Retained Earnings', accountType: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '310000', isPostable: true, mappingKey: DefaultAccountMappingKey.RETAINED_EARNINGS },

  // Level 3 — Postable Revenue
  { accountCode: '411000', nameAr: 'إيرادات المبيعات', nameEn: 'Sales Revenue', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.SALES },
  { accountCode: '411200', nameAr: 'مردودات المبيعات', nameEn: 'Sales Returns', accountType: AccountType.REVENUE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.SALES_RETURNS },
  { accountCode: '412000', nameAr: 'خصومات المبيعات', nameEn: 'Sales Discounts', accountType: AccountType.REVENUE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.SALES_DISCOUNTS },
  { accountCode: '419100', nameAr: 'فروقات التقريب', nameEn: 'Rounding Difference', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.ROUNDING_DIFFERENCE },
  { accountCode: '419200', nameAr: 'فائض الصندوق', nameEn: 'Cash Overage', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.CASH_OVERAGE },
  { accountCode: '419300', nameAr: 'أرباح ومكاسب المخزون', nameEn: 'Inventory Gain', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.INVENTORY_GAIN },
  { accountCode: '419400', nameAr: 'خصومات مكتسبة', nameEn: 'Discounts Received', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, level: 3, parentCode: '410000', isPostable: true, mappingKey: DefaultAccountMappingKey.DISCOUNTS_RECEIVED },

  // Level 3 — Postable Expenses & COGS
  { accountCode: '511000', nameAr: 'تكلفة البضاعة المباعة', nameEn: 'Cost of Goods Sold', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.COGS },
  { accountCode: '512000', nameAr: 'عمولات تطبيقات التوصيل', nameEn: 'Aggregator Commissions', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION },
  { accountCode: '512100', nameAr: 'رسوم بوابات الدفع', nameEn: 'Payment Gateway Fees', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.GATEWAY_FEES },
  { accountCode: '519000', nameAr: 'مصروفات عامة وتشغيلية', nameEn: 'General Operating Expenses', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE },
  { accountCode: '519100', nameAr: 'عجز الصندوق', nameEn: 'Cash Short', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.CASH_OVER_SHORT },
  { accountCode: '519200', nameAr: 'خسائر وتوالف المخزون', nameEn: 'Inventory Damage & Loss', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, level: 3, parentCode: '510000', isPostable: true, mappingKey: DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS },
];

export interface CoaProvisionResult {
  accountsCreated: number;
  accountsExisting: number;
  mappingsCreated: number;
  mappingsExisting: number;
  sequencesCreated: number;
}

@Injectable()
export class CoaProvisioningService {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Idempotently & atomically provisions the standard Chart of Accounts,
   * default Account Mappings, and default Document Numbering Sequences
   * for a Legal Entity inside the caller's transaction (`tx`).
   */
  async provisionLegalEntityDefaultsInTx(
    tx: any,
    params: {
      tenantId: string;
      legalEntityId: string;
      actorId?: string | null;
      currency?: string;
      simulateFailureAfterAccounts?: boolean;
    }
  ): Promise<CoaProvisionResult> {
    const currency = params.currency || 'SAR';
    const existingAccounts = await tx
      .select({
        id: chartOfAccounts.id,
        accountCode: chartOfAccounts.accountCode,
      })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.tenantId, params.tenantId),
          eq(chartOfAccounts.legalEntityId, params.legalEntityId)
        )
      );

    const codeToId = new Map<string, string>();
    for (const acc of existingAccounts) {
      codeToId.set(acc.accountCode, acc.id);
    }

    let accountsCreated = 0;
    let accountsExisting = 0;

    for (const node of STANDARD_COA_TEMPLATE) {
      const existingId = codeToId.get(node.accountCode);
      if (existingId) {
        accountsExisting++;
        continue;
      }

      const parentId = node.parentCode ? (codeToId.get(node.parentCode) ?? null) : null;
      const [inserted] = await tx
        .insert(chartOfAccounts)
        .values({
          tenantId: params.tenantId,
          legalEntityId: params.legalEntityId,
          accountCode: node.accountCode,
          name: node.nameAr,
          nameAr: node.nameAr,
          nameEn: node.nameEn,
          accountType: node.accountType,
          normalBalance: node.normalBalance,
          parentId,
          level: node.level,
          isPostable: node.isPostable,
          isSystem: true,
          currency,
          status: 'ACTIVE',
        })
        .onConflictDoNothing()
        .returning({ id: chartOfAccounts.id, accountCode: chartOfAccounts.accountCode });

      if (inserted) {
        codeToId.set(inserted.accountCode, inserted.id);
        accountsCreated++;
      } else {
        const [refetched] = await tx
          .select({ id: chartOfAccounts.id })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.legalEntityId, params.legalEntityId),
              eq(chartOfAccounts.accountCode, node.accountCode)
            )
          )
          .limit(1);
        if (refetched) {
          codeToId.set(node.accountCode, refetched.id);
        }
        accountsExisting++;
      }
    }

    if (params.simulateFailureAfterAccounts) {
      throw new Error('SIMULATED_COA_PROVISIONING_FAILURE');
    }

    const existingMappings = await tx
      .select({ mappingKey: accountMappings.mappingKey })
      .from(accountMappings)
      .where(
        and(
          eq(accountMappings.tenantId, params.tenantId),
          eq(accountMappings.legalEntityId, params.legalEntityId),
          isNull(accountMappings.branchId)
        )
      );

    const existingMappingKeys = new Set(existingMappings.map((m: any) => m.mappingKey));
    let mappingsCreated = 0;
    let mappingsExisting = 0;

    for (const node of STANDARD_COA_TEMPLATE) {
      if (!node.mappingKey) continue;
      if (existingMappingKeys.has(node.mappingKey)) {
        mappingsExisting++;
        continue;
      }

      const accountId = codeToId.get(node.accountCode);
      if (!accountId) continue;

      await tx
        .insert(accountMappings)
        .values({
          tenantId: params.tenantId,
          legalEntityId: params.legalEntityId,
          branchId: null,
          mappingKey: node.mappingKey,
          accountId,
          description: `الربط التلقائي: ${node.nameAr}`,
          isActive: true,
        })
        .onConflictDoNothing();

      existingMappingKeys.add(node.mappingKey);
      mappingsCreated++;
    }

    // Provision default Document Numbering Sequences for all document types
    const yearStr = String(new Date().getUTCFullYear());
    const existingSeqs = await tx
      .select({ documentType: documentSequences.documentType })
      .from(documentSequences)
      .where(
        and(
          eq(documentSequences.tenantId, params.tenantId),
          eq(documentSequences.legalEntityId, params.legalEntityId),
          isNull(documentSequences.branchId),
          eq(documentSequences.periodKey, yearStr)
        )
      );
    const existingSeqTypes = new Set(existingSeqs.map((s: any) => s.documentType));
    let sequencesCreated = 0;

    for (const [docType, prefix] of Object.entries(DEFAULT_PREFIX_MAP)) {
      if (existingSeqTypes.has(docType)) continue;
      await tx
        .insert(documentSequences)
        .values({
          tenantId: params.tenantId,
          legalEntityId: params.legalEntityId,
          branchId: null,
          documentType: docType,
          periodKey: yearStr,
          prefix,
          startingNumber: 1,
          currentValue: 0,
          padding: 6,
          fiscalYearFormat: 'YYYY',
          annualResetPolicy: 'ANNUAL',
          isActive: true,
          isLockedByUsage: false,
        })
        .onConflictDoNothing();
      sequencesCreated++;
    }

    await this.auditService.log(
      {
        tenantId: params.tenantId,
        actorId: params.actorId || undefined,
        action: 'LEGAL_ENTITY_COA_PROVISIONED',
        entityType: 'legal_entity',
        entityId: params.legalEntityId,
        afterState: {
          accountsCreated,
          accountsExisting,
          mappingsCreated,
          mappingsExisting,
          sequencesCreated,
        },
      },
      tx
    );

    return {
      accountsCreated,
      accountsExisting,
      mappingsCreated,
      mappingsExisting,
      sequencesCreated,
    };
  }
}
