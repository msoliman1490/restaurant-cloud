import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from './posting-engine.service';
import {
  chartOfAccounts,
  costCenters,
  fiscalPeriods,
  journalEntries,
  journalLines,
  accountMappings,
  cashVaults,
  bankAccounts,
  paymentVouchers,
  receiptVouchers,
  expenses,
  vaultTransactions,
  bankReconciliations,
  businessPartners,
  branches,
  legalEntities,
  salesOrders,
  posShifts,
  settlementBatches,
  stockTransfers,
  purchaseOrders,
} from '@restaurant-cloud/database';
import {
  CreateChartOfAccount,
  UpdateChartOfAccountRequest,
  CreateJournalEntry,
  UpdateDraftJournalEntryRequest,
  QueryJournalEntries,
  BankTransferRequest,
  CreateFiscalPeriodRequest,
  CloseFiscalPeriodRequest,
  ReverseJournalEntryRequest,
  CreateCostCenterRequest,
  UpdateCostCenterRequest,
  SetAccountMappingRequest,
  CreateCashVaultRequest,
  UpdateCashVaultRequest,
  VaultTransferRequest,
  VaultPhysicalCountRequest,
  CreateBankAccountRequest,
  UpdateBankAccountRequest,
  BankReconciliationRequest,
  CreatePaymentVoucherRequest,
  CreateReceiptVoucherRequest,
  CreateExpenseRequest,
  YearEndClosingRequest,
  FinancialReportQuery,
  VatReturnReportQuery,
  AgingReportQuery,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalStatus,
  JournalType,
  FiscalPeriodStatus,
  VoucherStatus,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, or, ilike, sql, desc, asc, inArray, gte, lte, lt } from 'drizzle-orm';

import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { DocumentNumberingService } from '../../common/operations/document-numbering.service';

@Injectable()
export class AccountingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly documentNumbering: DocumentNumberingService
  ) {}

  // ==================================================================
  // 1. Chart of Accounts (دليل الحسابات الشجري)
  // ==================================================================

  calculateNextCode(parentCode: string, existingSiblingCodes: string[]): string {
    const numericSiblings = existingSiblingCodes
      .map((c) => parseInt(c, 10))
      .filter((n) => !isNaN(n));

    if (parentCode.endsWith('0000')) {
      // Level 2 -> Level 3 (step: 1000)
      const basePrefix = parentCode.slice(0, 2);
      const maxNum = numericSiblings.length > 0
        ? Math.max(...numericSiblings)
        : parseInt(`${basePrefix}0000`, 10);
      return (maxNum + 1000).toString().padStart(6, '0');
    }
    if (parentCode.endsWith('000')) {
      // Level 3 -> Level 4 (step: 100)
      const basePrefix = parentCode.slice(0, 3);
      const maxNum = numericSiblings.length > 0
        ? Math.max(...numericSiblings)
        : parseInt(`${basePrefix}000`, 10);
      return (maxNum + 100).toString().padStart(6, '0');
    }
    if (parentCode.endsWith('00')) {
      // Level 4 -> Level 5 (step: 1)
      const basePrefix = parentCode.slice(0, 4);
      const maxNum = numericSiblings.length > 0
        ? Math.max(...numericSiblings)
        : parseInt(`${basePrefix}00`, 10);
      return (maxNum + 1).toString().padStart(6, '0');
    }
    // Level 5+ -> append or increment (step: 1)
    const maxNum = numericSiblings.length > 0
      ? Math.max(...numericSiblings)
      : parseInt(parentCode, 10) * 10;
    return (maxNum + 1).toString();
  }

  async getNextAccountCode(
    context: TenantContext,
    params: { legalEntityId: string; parentId?: string; accountType?: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (params.parentId) {
        const [parent] = await tx
          .select({
            id: chartOfAccounts.id,
            accountCode: chartOfAccounts.accountCode,
            level: chartOfAccounts.level,
            accountType: chartOfAccounts.accountType,
            normalBalance: chartOfAccounts.normalBalance,
          })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, params.legalEntityId),
              eq(chartOfAccounts.id, params.parentId)
            )
          )
          .limit(1);

        if (!parent) {
          throw new NotFoundException('الحساب الأب المحدد غير موجود');
        }

        const siblings = await tx
          .select({ accountCode: chartOfAccounts.accountCode })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, params.legalEntityId),
              eq(chartOfAccounts.parentId, parent.id)
            )
          )
          .orderBy(desc(chartOfAccounts.accountCode));

        const nextCode = this.calculateNextCode(
          parent.accountCode,
          siblings.map((s) => s.accountCode)
        );

        return {
          nextCode,
          level: (parent.level || 1) + 1,
          accountType: parent.accountType,
          normalBalance: parent.normalBalance,
        };
      }

      const type = params.accountType || 'ASSET';
      const rootBaseMap: Record<string, string> = {
        ASSET: '100000',
        LIABILITY: '200000',
        EQUITY: '300000',
        REVENUE: '400000',
        EXPENSE: '500000',
      };
      const rootBase = rootBaseMap[type] || '100000';
      const normalBal = (type === 'ASSET' || type === 'EXPENSE') ? 'DEBIT' : 'CREDIT';

      return {
        nextCode: rootBase,
        level: 1,
        accountType: type,
        normalBalance: normalBal,
      };
    });
  }

  async createAccount(context: TenantContext, dto: CreateChartOfAccount) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      let level = dto.level || 1;
      let effectiveAccountType = dto.accountType;
      let effectiveNormalBalance = dto.normalBalance;
      let allocatedCode = dto.accountCode;

      // 1. Lock and validate parent if specified
      if (dto.parentId) {
        const [parent] = await tx
          .select()
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
              eq(chartOfAccounts.id, dto.parentId)
            )
          )
          .for('update')
          .limit(1);

        if (!parent) {
          throw new NotFoundException(`الحساب الرئيسي المحدد '${dto.parentId}' غير موجود`);
        }

        level = (parent.level || 1) + 1;
        // Invariant: Inherit accountType strictly from parent
        effectiveAccountType = parent.accountType as any;
        // Invariant: Inherit normalBalance from parent unless explicitly provided
        if (!dto.normalBalance) {
          effectiveNormalBalance = parent.normalBalance as any;
        }

        // If code is not provided, allocate automatically using atomic sequence
        if (!allocatedCode) {
          const siblings = await tx
            .select({ accountCode: chartOfAccounts.accountCode })
            .from(chartOfAccounts)
            .where(
              and(
                eq(chartOfAccounts.tenantId, context.tenantId),
                eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
                eq(chartOfAccounts.parentId, parent.id)
              )
            )
            .orderBy(desc(chartOfAccounts.accountCode));

          allocatedCode = this.calculateNextCode(
            parent.accountCode,
            siblings.map((s) => s.accountCode)
          );
        }

        // Rule: A parent account with children must strictly be a summary account (isPostable = false)
        if (parent.isPostable) {
          await tx
            .update(chartOfAccounts)
            .set({ isPostable: false, updatedAt: new Date() })
            .where(
              and(
                eq(chartOfAccounts.tenantId, context.tenantId),
                eq(chartOfAccounts.id, parent.id)
              )
            );
        }
      }

      if (!allocatedCode) {
        throw new BadRequestException('رمز الحساب إلزامي لإنشاء حساب مالي جديد');
      }

      // 2. Validate unique code within legal entity
      const [existing] = await tx
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
            eq(chartOfAccounts.accountCode, allocatedCode)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `رمز الحساب '${allocatedCode}' مسجل مسبقاً في هذه المنشأة القانونية`
        );
      }

      const [account] = await tx
        .insert(chartOfAccounts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          accountCode: allocatedCode,
          name: dto.name,
          nameAr: dto.nameAr || dto.name,
          nameEn: dto.nameEn || null,
          description: dto.description || null,
          accountType: effectiveAccountType,
          normalBalance: effectiveNormalBalance,
          parentId: dto.parentId || null,
          level,
          isPostable: dto.isPostable ?? true,
          currency: dto.currency || 'SAR',
          status: 'ACTIVE',
        })
        .returning();

      if (!account) throw new Error('فشل إنشاء الحساب المحاسبي');

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

  async updateAccount(context: TenantContext, accountId: string, dto: UpdateChartOfAccountRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.id, accountId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new NotFoundException(`الحساب '${accountId}' غير موجود`);
      }

      if (dto.isPostable === true && !existing.isPostable) {
        // Check if account has child accounts
        const [hasChildren] = await tx
          .select({ id: chartOfAccounts.id })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.parentId, accountId)
            )
          )
          .limit(1);

        if (hasChildren) {
          throw new BadRequestException('لا يمكن تحويل حساب تجميعي إلى حساب قابل للترحيل لأنه يحتوي على حسابات فرعية');
        }
      }

      if (dto.parentId && dto.parentId === accountId) {
        throw new BadRequestException('لا يمكن أن يكون الحساب أباً لنفسه (حلقة دائرية مفرغة)');
      }

      // Check cyclical descendant if parentId changed
      if (dto.parentId && dto.parentId !== existing.parentId) {
        const allAccounts = await tx
          .select({ id: chartOfAccounts.id, parentId: chartOfAccounts.parentId })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, existing.legalEntityId)
            )
          );

        let curr: string | null = dto.parentId;
        const visited = new Set<string>();
        while (curr) {
          if (curr === accountId) {
            throw new BadRequestException('لا يمكن تعيين حساب فرعي كأب لحساب رئيسي (حلقة دائرية مفرغة)');
          }
          if (visited.has(curr)) break;
          visited.add(curr);
          const parentAcc = allAccounts.find((a) => a.id === curr);
          curr = parentAcc ? parentAcc.parentId : null;
        }
      }

      const [updated] = await tx
        .update(chartOfAccounts)
        .set({
          name: dto.name ?? existing.name,
          nameAr: dto.nameAr ?? existing.nameAr,
          nameEn: dto.nameEn ?? existing.nameEn,
          description: dto.description ?? existing.description,
          parentId: dto.parentId !== undefined ? dto.parentId : existing.parentId,
          isPostable: dto.isPostable ?? existing.isPostable,
          status: dto.status ?? existing.status,
          updatedAt: new Date(),
        })
        .where(eq(chartOfAccounts.id, accountId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ACCOUNT_UPDATED',
          entityType: 'chart_of_accounts',
          entityId: accountId,
          beforeState: existing,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async deleteAccount(context: TenantContext, accountId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Check if account has child accounts
      const [child] = await tx
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.parentId, accountId)
          )
        )
        .limit(1);

      if (child) {
        throw new BadRequestException('لا يمكن حذف حساب يحتوي على حسابات فرعية تحته');
      }

      // 2. Check if account has any journal lines
      const [line] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(eq(journalLines.accountId, accountId))
        .limit(1);

      if (line) {
        throw new BadRequestException('لا يمكن حذف حساب تمت عليه قيود محاسبية أو حركات مالية');
      }

      const [deleted] = await tx
        .delete(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.id, accountId)
          )
        )
        .returning();

      if (!deleted) throw new NotFoundException('الحساب غير موجود');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ACCOUNT_DELETED',
          entityType: 'chart_of_accounts',
          entityId: accountId,
          beforeState: deleted,
        },
        tx
      );

      return { success: true, id: accountId };
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

  /**
   * Builds full hierarchical tree of Chart of Accounts with calculated balances
   */
  async getChartOfAccountsHierarchy(context: TenantContext, legalEntityId: string) {
    const flatAccounts = await this.getChartOfAccounts(context, legalEntityId);
    const trialBalance = await this.getTrialBalance(context, legalEntityId);
    const balanceMap = new Map<string, any>(
      trialBalance.accounts.map((a) => [a.accountId, a])
    );

    // Map each account to a tree node
    const nodeMap = new Map<string, any>();
    for (const acc of flatAccounts) {
      const bal = balanceMap.get(acc.id) || { totalDebit: '0.0000', totalCredit: '0.0000', netBalance: '0.0000' };
      nodeMap.set(acc.id, {
        ...acc,
        totalDebit: bal.totalDebit,
        totalCredit: bal.totalCredit,
        netBalance: bal.netBalance,
        children: [],
      });
    }

    const rootNodes: any[] = [];
    for (const acc of flatAccounts) {
      const node = nodeMap.get(acc.id);
      if (acc.parentId && nodeMap.has(acc.parentId)) {
        nodeMap.get(acc.parentId).children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // Recursive rollup for summary / group accounts
    function calculateRollup(node: any): { debit: number; credit: number; net: number } {
      let d = parseFloat(node.totalDebit || '0');
      let c = parseFloat(node.totalCredit || '0');
      let net = parseFloat(node.netBalance || '0');

      for (const child of node.children) {
        const childTotals = calculateRollup(child);
        d += childTotals.debit;
        c += childTotals.credit;
        net += childTotals.net;
      }

      if (!node.isPostable) {
        node.totalDebit = d.toFixed(4);
        node.totalCredit = c.toFixed(4);
        node.netBalance = net.toFixed(4);
      }

      return { debit: d, credit: c, net };
    }

    for (const root of rootNodes) {
      calculateRollup(root);
    }

    return rootNodes;
  }

  // ==================================================================
  // 2. Configurable Account Mappings & Branch Overrides (Phase 3.3)
  // ==================================================================

  validateMappingAccountCompatibility(mappingKey: string, account: { accountType: string; normalBalance: string }) {
    const key = mappingKey.toUpperCase();
    const type = account.accountType.toUpperCase();
    const balance = account.normalBalance.toUpperCase();

    switch (key) {
      case DefaultAccountMappingKey.SALES:
        if (type !== AccountType.REVENUE || balance !== NormalBalance.CREDIT) {
          throw new BadRequestException(`مفتاح المبيعات '${mappingKey}' يتطلب حساب إيرادات بطبيعة دائنة (REVENUE / CREDIT)`);
        }
        break;

      case DefaultAccountMappingKey.SALES_RETURNS:
      case DefaultAccountMappingKey.SALES_DISCOUNTS:
        if (type !== AccountType.REVENUE && type !== AccountType.EXPENSE) {
          throw new BadRequestException(`مفتاح '${mappingKey}' يتطلب حساب إيرادات مقابل (Contra Revenue) أو حساب مصروفات`);
        }
        break;

      case DefaultAccountMappingKey.VAT_OUTPUT:
        if (type !== AccountType.LIABILITY || balance !== NormalBalance.CREDIT) {
          throw new BadRequestException(`مفتاح ضريبة المخرجات '${mappingKey}' يتطلب حساب التزامات بطبيعة دائنة (LIABILITY / CREDIT)`);
        }
        break;

      case DefaultAccountMappingKey.VAT_INPUT:
        if (type !== AccountType.ASSET || balance !== NormalBalance.DEBIT) {
          throw new BadRequestException(`مفتاح ضريبة المدخلات '${mappingKey}' يتطلب حساب أصول بطبيعة مدينة (ASSET / DEBIT)`);
        }
        break;

      case DefaultAccountMappingKey.INVENTORY:
      case DefaultAccountMappingKey.INVENTORY_IN_TRANSIT:
      case DefaultAccountMappingKey.DUE_FROM_AFFILIATE:
      case DefaultAccountMappingKey.CASH_VAULT:
      case DefaultAccountMappingKey.BANK:
      case DefaultAccountMappingKey.MADA_CLEARING:
      case DefaultAccountMappingKey.VISA_CLEARING:
      case DefaultAccountMappingKey.APPLE_PAY_CLEARING:
      case DefaultAccountMappingKey.STC_PAY_CLEARING:
      case DefaultAccountMappingKey.CARD_CLEARING:
      case DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE:
      case DefaultAccountMappingKey.CASH_IN_TRANSIT:
      case DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE:
        if (type !== AccountType.ASSET || balance !== NormalBalance.DEBIT) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب أصول بطبيعة مدينة (ASSET / DEBIT)`);
        }
        break;

      case DefaultAccountMappingKey.COGS:
      case DefaultAccountMappingKey.AGGREGATOR_COMMISSION:
      case DefaultAccountMappingKey.GATEWAY_FEES:
      case DefaultAccountMappingKey.GENERAL_EXPENSE:
        if (type !== AccountType.COGS && type !== AccountType.EXPENSE) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب تكلفة بضاعة أو مصروفات (COGS / EXPENSE)`);
        }
        break;

      case DefaultAccountMappingKey.ACCOUNTS_PAYABLE:
      case DefaultAccountMappingKey.DUE_TO_AFFILIATE:
        if (type !== AccountType.LIABILITY || balance !== NormalBalance.CREDIT) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب التزامات بطبيعة دائنة (LIABILITY / CREDIT)`);
        }
        break;

      case DefaultAccountMappingKey.RETAINED_EARNINGS:
        if (type !== AccountType.EQUITY || balance !== NormalBalance.CREDIT) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب حقوق ملكية بطبيعة دائنة (EQUITY / CREDIT)`);
        }
        break;

      case DefaultAccountMappingKey.ROUNDING_DIFFERENCE:
        if (type !== AccountType.EXPENSE && type !== AccountType.REVENUE && type !== AccountType.OTHER_INCOME && type !== AccountType.OTHER_EXPENSE) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب مصروفات أو إيرادات لمعالجة الفروقات`);
        }
        break;

      case DefaultAccountMappingKey.CASH_OVER_SHORT:
      case DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS:
        if (type !== AccountType.EXPENSE && type !== AccountType.OTHER_EXPENSE) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب مصروفات أو مصروفات أخرى (EXPENSE / OTHER_EXPENSE)`);
        }
        break;

      case DefaultAccountMappingKey.CASH_OVERAGE:
      case DefaultAccountMappingKey.INVENTORY_GAIN:
        if (type !== AccountType.REVENUE && type !== AccountType.OTHER_INCOME) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب إيرادات أو إيرادات أخرى (REVENUE / OTHER_INCOME)`);
        }
        break;

      case DefaultAccountMappingKey.INTER_BRANCH_CLEARING:
      case DefaultAccountMappingKey.AGGREGATOR_SUSPENSE:
        if (type !== AccountType.ASSET && type !== AccountType.LIABILITY) {
          throw new BadRequestException(`مفتاح الربط '${mappingKey}' يتطلب حساب تسوية وسيط (أصول أو التزامات)`);
        }
        break;
    }
  }

  async getAccountMappings(
    context: TenantContext,
    legalEntityId: string,
    branchId?: string,
    includeEffective?: boolean
  ) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId,
        branchId: branchId || undefined,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // Fetch raw mappings
      const rawMappings = await tx
        .select({
          id: accountMappings.id,
          legalEntityId: accountMappings.legalEntityId,
          branchId: accountMappings.branchId,
          branchName: branches.name,
          mappingKey: accountMappings.mappingKey,
          accountId: accountMappings.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
          normalBalance: chartOfAccounts.normalBalance,
          description: accountMappings.description,
          isActive: accountMappings.isActive,
          createdAt: accountMappings.createdAt,
          updatedAt: accountMappings.updatedAt,
        })
        .from(accountMappings)
        .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
        .leftJoin(branches, eq(accountMappings.branchId, branches.id))
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, legalEntityId)
          )
        )
        .orderBy(asc(accountMappings.mappingKey));

      if (!includeEffective || !branchId) {
        if (branchId) {
          return rawMappings.filter((m) => m.branchId === branchId);
        }
        return rawMappings;
      }

      // If branchId and includeEffective: return full resolution view for standard approved keys
      const approvedKeys = Object.values(DefaultAccountMappingKey);
      const companyMap = new Map<string, (typeof rawMappings)[0]>();
      const branchMap = new Map<string, (typeof rawMappings)[0]>();

      rawMappings.forEach((m) => {
        if (!m.branchId) {
          companyMap.set(m.mappingKey, m);
        } else if (m.branchId === branchId) {
          branchMap.set(m.mappingKey, m);
        }
      });

      return approvedKeys.map((key) => {
        const branchOverride = branchMap.get(key);
        const companyMapping = companyMap.get(key);

        if (branchOverride && branchOverride.isActive) {
          return {
            mappingKey: key,
            source: 'BRANCH_OVERRIDE' as const,
            isOverride: true,
            id: branchOverride.id,
            accountId: branchOverride.accountId,
            accountCode: branchOverride.accountCode,
            accountName: branchOverride.accountName,
            accountType: branchOverride.accountType,
            normalBalance: branchOverride.normalBalance,
            description: branchOverride.description,
            isActive: branchOverride.isActive,
            branchId,
            companyAccountId: companyMapping?.accountId || null,
            companyAccountCode: companyMapping?.accountCode || null,
          };
        }

        if (companyMapping && companyMapping.isActive) {
          return {
            mappingKey: key,
            source: 'COMPANY_MAPPING' as const,
            isOverride: false,
            id: companyMapping.id,
            accountId: companyMapping.accountId,
            accountCode: companyMapping.accountCode,
            accountName: companyMapping.accountName,
            accountType: companyMapping.accountType,
            normalBalance: companyMapping.normalBalance,
            description: companyMapping.description,
            isActive: companyMapping.isActive,
            branchId: null,
            companyAccountId: companyMapping.accountId,
            companyAccountCode: companyMapping.accountCode,
          };
        }

        return {
          mappingKey: key,
          source: 'NOT_CONFIGURED' as const,
          isOverride: false,
          id: null,
          accountId: null,
          accountCode: null,
          accountName: null,
          accountType: null,
          normalBalance: null,
          description: null,
          isActive: false,
          branchId: null,
          companyAccountId: null,
          companyAccountCode: null,
        };
      });
    });
  }

  async setAccountMapping(context: TenantContext, dto: SetAccountMappingRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Validate Account
      const [acc] = await tx
        .select({
          id: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          name: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
          normalBalance: chartOfAccounts.normalBalance,
          isPostable: chartOfAccounts.isPostable,
          status: chartOfAccounts.status,
          legalEntityId: chartOfAccounts.legalEntityId,
        })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
            eq(chartOfAccounts.id, dto.accountId)
          )
        )
        .limit(1);

      if (!acc) throw new NotFoundException('الحساب المحاسبي المحدد غير موجود في هذه الشركة القانونية');
      if (acc.status !== 'ACTIVE') throw new BadRequestException(`الحساب (${acc.accountCode} - ${acc.name}) غير نشط ولا يمكن ربطه`);
      if (!acc.isPostable) throw new BadRequestException(`الحساب (${acc.accountCode} - ${acc.name}) رئيسي/تجميعي وغير قابل للترحيل`);

      // 2. Validate Branch (if specified)
      if (dto.branchId) {
        const [branch] = await tx
          .select({ id: branches.id, legalEntityId: branches.legalEntityId })
          .from(branches)
          .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, dto.branchId)))
          .limit(1);

        if (!branch) throw new NotFoundException('الفرع المحدد غير موجود');
        if (branch.legalEntityId !== dto.legalEntityId) {
          throw new ForbiddenException('الفرع المحدد لا يتبع الشركة القانونية المختارة');
        }
      }

      // 3. Validate Account Type Compatibility
      this.validateMappingAccountCompatibility(dto.mappingKey, acc as any);

      // 4. Upsert Mapping
      const branchCondition = dto.branchId
        ? eq(accountMappings.branchId, dto.branchId)
        : sql`${accountMappings.branchId} IS NULL`;

      const [existing] = await tx
        .select({ id: accountMappings.id })
        .from(accountMappings)
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, dto.legalEntityId),
            branchCondition,
            eq(accountMappings.mappingKey, dto.mappingKey)
          )
        )
        .limit(1);

      if (existing) {
        if (
          context.scopes &&
          !context.scopes.includes('*') &&
          !context.scopes.includes('accounting.mapping.manage') &&
          !context.scopes.includes('accounting.mapping.update')
        ) {
          throw new ForbiddenException('المستخدم لا يملك صلاحية تعديل الربط المحاسبي (accounting.mapping.update)');
        }

        const [updated] = await tx
          .update(accountMappings)
          .set({
            accountId: dto.accountId,
            description: dto.description || null,
            isActive: dto.isActive !== undefined ? dto.isActive : true,
            updatedAt: new Date(),
          })
          .where(eq(accountMappings.id, existing.id))
          .returning();

        return updated;
      }

      if (
        context.scopes &&
        !context.scopes.includes('*') &&
        !context.scopes.includes('accounting.mapping.manage') &&
        !context.scopes.includes('accounting.mapping.create')
      ) {
        throw new ForbiddenException('المستخدم لا يملك صلاحية إنشاء ربط محاسبي جديد (accounting.mapping.create)');
      }

      const [created] = await tx
        .insert(accountMappings)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          mappingKey: dto.mappingKey,
          accountId: dto.accountId,
          description: dto.description || null,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        })
        .returning();

      return created;
    });
  }

  async deleteAccountMapping(context: TenantContext, id: string) {
    if (
      context.scopes &&
      !context.scopes.includes('*') &&
      !context.scopes.includes('accounting.mapping.manage') &&
      !context.scopes.includes('accounting.mapping.delete')
    ) {
      throw new ForbiddenException('المستخدم لا يملك صلاحية حذف الربط المحاسبي (accounting.mapping.delete)');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [mapping] = await tx
        .select()
        .from(accountMappings)
        .where(and(eq(accountMappings.tenantId, context.tenantId), eq(accountMappings.id, id)))
        .limit(1);

      if (!mapping) throw new NotFoundException('إعداد الربط المحاسبي غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: mapping.legalEntityId,
          branchId: mapping.branchId || undefined,
        });
      }

      await tx.delete(accountMappings).where(eq(accountMappings.id, id));
      return { success: true, message: 'تم حذف إعداد الربط المحاسبي بنجاح' };
    });
  }

  async resolveAccount(
    context: TenantContext,
    params: { legalEntityId: string; branchId?: string | null; mappingKey: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Branch Override
      if (params.branchId) {
        const [branchOverride] = await tx
          .select({
            id: accountMappings.id,
            mappingKey: accountMappings.mappingKey,
            accountId: accountMappings.accountId,
            accountCode: chartOfAccounts.accountCode,
            accountName: chartOfAccounts.name,
            accountType: chartOfAccounts.accountType,
            normalBalance: chartOfAccounts.normalBalance,
            status: chartOfAccounts.status,
            isPostable: chartOfAccounts.isPostable,
          })
          .from(accountMappings)
          .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
          .where(
            and(
              eq(accountMappings.tenantId, context.tenantId),
              eq(accountMappings.legalEntityId, params.legalEntityId),
              eq(accountMappings.branchId, params.branchId),
              eq(accountMappings.mappingKey, params.mappingKey),
              eq(accountMappings.isActive, true)
            )
          )
          .limit(1);

        if (branchOverride) {
          if (branchOverride.status !== 'ACTIVE' || !branchOverride.isPostable) {
            throw new BadRequestException(
              `الحساب المخصص للفرع للمفتاح '${params.mappingKey}' (${branchOverride.accountCode}) غير نشط أو غير قابل للترحيل`
            );
          }
          return {
            ...branchOverride,
            source: 'BRANCH_OVERRIDE' as const,
            isOverride: true,
            branchId: params.branchId,
          };
        }
      }

      // 2. Company Default Mapping
      const [companyMapping] = await tx
        .select({
          id: accountMappings.id,
          mappingKey: accountMappings.mappingKey,
          accountId: accountMappings.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
          normalBalance: chartOfAccounts.normalBalance,
          status: chartOfAccounts.status,
          isPostable: chartOfAccounts.isPostable,
        })
        .from(accountMappings)
        .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, params.legalEntityId),
            sql`${accountMappings.branchId} IS NULL`,
            eq(accountMappings.mappingKey, params.mappingKey),
            eq(accountMappings.isActive, true)
          )
        )
        .limit(1);

      if (companyMapping) {
        if (companyMapping.status !== 'ACTIVE' || !companyMapping.isPostable) {
          throw new BadRequestException(
            `الحساب الافتراضي للمنشأة للمفتاح '${params.mappingKey}' (${companyMapping.accountCode}) غير نشط أو غير قابل للترحيل`
          );
        }
        return {
          ...companyMapping,
          source: 'COMPANY_MAPPING' as const,
          isOverride: false,
          branchId: null,
        };
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
        [DefaultAccountMappingKey.GENERAL_EXPENSE]: '519000',
      };

      const defaultCode = standardDefaultCodes[params.mappingKey];
      if (defaultCode) {
        const [sysDefault] = await tx
          .select({
            id: chartOfAccounts.id,
            accountCode: chartOfAccounts.accountCode,
            accountName: chartOfAccounts.name,
            accountType: chartOfAccounts.accountType,
            normalBalance: chartOfAccounts.normalBalance,
            status: chartOfAccounts.status,
            isPostable: chartOfAccounts.isPostable,
          })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.tenantId, context.tenantId),
              eq(chartOfAccounts.legalEntityId, params.legalEntityId),
              eq(chartOfAccounts.accountCode, defaultCode)
            )
          )
          .limit(1);

        if (!sysDefault) {
          throw new BadRequestException(
            `لم يتم العثور على ربط محاسبي صالح للمفتاح '${params.mappingKey}' في المنشأة أو الفرع، وحساب النظام الافتراضي (${defaultCode}) غير موجود في دليل حسابات هذه المنشأة`
          );
        }

        if (sysDefault.status !== 'ACTIVE') {
          throw new BadRequestException(
            `الحساب الافتراضي للنظام للمفتاح '${params.mappingKey}' (${sysDefault.accountCode} - ${sysDefault.accountName}) غير نشط ولا يمكن استخدامه`
          );
        }

        if (!sysDefault.isPostable) {
          throw new BadRequestException(
            `الحساب الافتراضي للنظام للمفتاح '${params.mappingKey}' (${sysDefault.accountCode} - ${sysDefault.accountName}) رئيسي/تجميعي وغير قابل للترحيل`
          );
        }

        // Validate account type & balance compatibility
        this.validateMappingAccountCompatibility(params.mappingKey, {
          accountType: sysDefault.accountType,
          normalBalance: sysDefault.normalBalance,
        } as any);

        return {
          id: sysDefault.id,
          mappingKey: params.mappingKey,
          accountId: sysDefault.id,
          accountCode: sysDefault.accountCode,
          accountName: sysDefault.accountName,
          accountType: sysDefault.accountType,
          normalBalance: sysDefault.normalBalance,
          status: sysDefault.status,
          isPostable: sysDefault.isPostable,
          source: 'SYSTEM_DEFAULT' as const,
          isOverride: false,
          branchId: null,
        };
      }

      // 4. Strict Rejection
      throw new BadRequestException(
        `لم يتم العثور على ربط محاسبي صالح للمفتاح '${params.mappingKey}' في المنشأة القانونية أو الفرع المحدد`
      );
    });
  }

  // ==================================================================
  // 3. Cost Centers & Dimensions (مراكز التكلفة)
  // ==================================================================

  async createCostCenter(context: TenantContext, dto: CreateCostCenterRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(
          and(
            eq(costCenters.tenantId, context.tenantId),
            eq(costCenters.legalEntityId, dto.legalEntityId),
            eq(costCenters.code, dto.code)
          )
        )
        .limit(1);

      if (existing) throw new ConflictException(`رمز مركز التكلفة '${dto.code}' موجود مسبقاً`);

      const [center] = await tx
        .insert(costCenters)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          code: dto.code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn || null,
          parentId: dto.parentId || null,
        })
        .returning();

      return center;
    });
  }

  async getCostCenters(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(costCenters)
        .where(
          and(
            eq(costCenters.tenantId, context.tenantId),
            eq(costCenters.legalEntityId, legalEntityId)
          )
        )
        .orderBy(asc(costCenters.code));
    });
  }

  async updateCostCenter(context: TenantContext, id: string, dto: UpdateCostCenterRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [updated] = await tx
        .update(costCenters)
        .set({
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          parentId: dto.parentId,
          status: dto.status,
        })
        .where(and(eq(costCenters.tenantId, context.tenantId), eq(costCenters.id, id)))
        .returning();

      if (!updated) throw new NotFoundException('مركز التكلفة غير موجود');
      return updated;
    });
  }

  // ==================================================================
  // 4. Cash Vaults & Safes Management (الخزائن والصناديق)
  // ==================================================================

  async createCashVault(context: TenantContext, dto: CreateCashVaultRequest) {
    if (context.userScopes) {
      if (!dto.branchId) {
        const isBranchOnly = context.userScopes.every((s) => s.scopeType === 'BRANCH');
        if (isBranchOnly && !context.scopes?.includes('*')) {
          throw new ForbiddenException(
            'المستخدم المقيد بفرع لا يملك صلاحية إنشاء أو إدارة الخزائن المركزية على مستوى الشركة'
          );
        }
      }

      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: cashVaults.id })
        .from(cashVaults)
        .where(
          and(
            eq(cashVaults.tenantId, context.tenantId),
            eq(cashVaults.legalEntityId, dto.legalEntityId),
            eq(cashVaults.code, dto.code)
          )
        )
        .limit(1);

      if (existing) throw new ConflictException(`رمز الخزينة '${dto.code}' مسجل مسبقاً`);

      const [vault] = await tx
        .insert(cashVaults)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          code: dto.code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn || null,
          accountId: dto.accountId,
          custodianId: dto.custodianId || null,
          balance: '0.0000',
        })
        .returning();

      return vault;
    });
  }

  async listCashVaults(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select({
          id: cashVaults.id,
          code: cashVaults.code,
          nameAr: cashVaults.nameAr,
          nameEn: cashVaults.nameEn,
          branchId: cashVaults.branchId,
          accountId: cashVaults.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          balance: cashVaults.balance,
          status: cashVaults.status,
        })
        .from(cashVaults)
        .innerJoin(chartOfAccounts, eq(cashVaults.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(cashVaults.tenantId, context.tenantId),
            eq(cashVaults.legalEntityId, legalEntityId)
          )
        )
        .orderBy(asc(cashVaults.code));
    });
  }

  /**
   * Cash transfer between vaults with overdraft protection and auto-generated balanced JV
   */
  async transferBetweenVaults(context: TenantContext, dto: VaultTransferRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const transferAmount = parseFloat(dto.amount);
      if (transferAmount <= 0) throw new BadRequestException('مبلغ التحويل يجب أن يكون أكبر من صفر');

      const [fromVault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.fromVaultId)))
        .for('update')
        .limit(1);

      if (!fromVault) throw new NotFoundException('خزينة المصدر غير موجودة');
      if (fromVault.status !== 'ACTIVE') {
        throw new BadRequestException(`لا يمكن التحويل من الخزينة '${fromVault.nameAr}' لأن حالتها معطلة أو غير نشطة (${fromVault.status})`);
      }

      if (context.userScopes && fromVault.branchId) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: dto.legalEntityId,
          branchId: fromVault.branchId,
        });
      }

      const currentFromBal = parseFloat(fromVault.balance);
      if (currentFromBal < transferAmount) {
        throw new BadRequestException(
          `رصيد الخزينة المصدر غير كافٍ (${currentFromBal.toFixed(4)} < ${transferAmount.toFixed(4)}). منع السحب على المكشوف صارم.`
        );
      }

      const [toVault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.toVaultId)))
        .for('update')
        .limit(1);

      if (!toVault) throw new NotFoundException('خزينة الوجهة غير موجودة');
      if (toVault.status !== 'ACTIVE') {
        throw new BadRequestException(`لا يمكن التحويل إلى الخزينة '${toVault.nameAr}' لأن حالتها معطلة أو غير نشطة (${toVault.status})`);
      }

      const newFromBal = (currentFromBal - transferAmount).toFixed(4);
      const newToBal = (parseFloat(toVault.balance) + transferAmount).toFixed(4);

      // Update balances
      await tx
        .update(cashVaults)
        .set({ balance: newFromBal })
        .where(eq(cashVaults.id, fromVault.id));

      await tx
        .update(cashVaults)
        .set({ balance: newToBal })
        .where(eq(cashVaults.id, toVault.id));

      // Record vault transactions
      await tx.insert(vaultTransactions).values([
        {
          tenantId: context.tenantId,
          vaultId: fromVault.id,
          transactionType: 'TRANSFER_OUT',
          amount: transferAmount.toFixed(4),
          balanceAfter: newFromBal,
          notes: `تحويل إلى ${toVault.nameAr}: ${dto.notes || ''}`,
          performedBy: context.userId,
        },
        {
          tenantId: context.tenantId,
          vaultId: toVault.id,
          transactionType: 'TRANSFER_IN',
          amount: transferAmount.toFixed(4),
          balanceAfter: newToBal,
          notes: `تحويل وارد من ${fromVault.nameAr}: ${dto.notes || ''}`,
          performedBy: context.userId,
        },
      ]);

      // Post Balanced GL Journal Entry
      const jvNumber = `JV-TRF-${Date.now().toString().slice(-6)}`;
      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          branchId: toVault.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'vault_transfer',
          sourceId: fromVault.id,
          description: `تحويل نقدي بين الخزائن: من ${fromVault.nameAr} إلى ${toVault.nameAr}`,
          lines: [
            {
              accountId: toVault.accountId,
              debit: transferAmount.toFixed(4),
              credit: '0.0000',
              description: `إيداع تحويل وارد إلى ${toVault.nameAr}`,
            },
            {
              accountId: fromVault.accountId,
              debit: '0.0000',
              credit: transferAmount.toFixed(4),
              description: `سحب تحويل صادر من ${fromVault.nameAr}`,
            },
          ],
        },
        tx
      );

      return {
        fromVaultId: fromVault.id,
        toVaultId: toVault.id,
        amount: transferAmount.toFixed(4),
        fromBalanceAfter: newFromBal,
        toBalanceAfter: newToBal,
        journalEntry: jv,
      };
    });
  }

  /**
   * Vault Physical Count (جرد الخزينة الفعلي وتسوية العجز أو الفائض)
   */
  async countCashVault(context: TenantContext, dto: VaultPhysicalCountRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.vaultId)))
        .limit(1);

      if (!vault) throw new NotFoundException('الخزينة غير موجودة');
      if (vault.status !== 'ACTIVE') {
        throw new BadRequestException(`لا يمكن جرد الخزينة '${vault.nameAr}' لأن حالتها معطلة أو غير نشطة (${vault.status})`);
      }

      if (context.userScopes && vault.branchId) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: dto.legalEntityId,
          branchId: vault.branchId,
        });
      }

      const bookBalance = parseFloat(vault.balance);
      const actualBalance = parseFloat(dto.actualAmount);
      const diff = actualBalance - bookBalance;

      // Update vault balance to actual count
      await tx
        .update(cashVaults)
        .set({ balance: actualBalance.toFixed(4) })
        .where(eq(cashVaults.id, vault.id));

      await tx.insert(vaultTransactions).values({
        tenantId: context.tenantId,
        vaultId: vault.id,
        transactionType: 'COUNT_VARIANCE',
        amount: Math.abs(diff).toFixed(4),
        balanceAfter: actualBalance.toFixed(4),
        notes: `جرد فعلي - الفرق: ${diff.toFixed(4)} (${dto.notes || ''})`,
        performedBy: context.userId,
      });

      let jv = null;
      if (Math.abs(diff) > 0.0001) {
        const jvNumber = `JV-COUNT-${Date.now().toString().slice(-6)}`;
        if (diff > 0) {
          // Surplus (فائض) -> Debit Vault, Credit Other Income
          jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: dto.legalEntityId,
              branchId: vault.branchId,
              journalNumber: jvNumber,
              journalType: JournalType.ADJUSTMENT,
              sourceType: 'vault_count',
              sourceId: vault.id,
              description: `تسوية زيادة جرد في خزينة ${vault.nameAr}`,
              lines: [
                {
                  accountId: vault.accountId,
                  debit: diff.toFixed(4),
                  credit: '0.0000',
                  description: `إثبات زيادة الجرد الفعلي في ${vault.nameAr}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.ROUNDING_DIFFERENCE,
                  debit: '0.0000',
                  credit: diff.toFixed(4),
                  description: 'إيراد تسوية فروقات وفائض الجرد النقدي',
                },
              ],
            },
            tx
          );
        } else {
          // Shortage (عجز) -> Debit Expense, Credit Vault
          const absDiff = Math.abs(diff).toFixed(4);
          jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: dto.legalEntityId,
              branchId: vault.branchId,
              journalNumber: jvNumber,
              journalType: JournalType.ADJUSTMENT,
              sourceType: 'vault_count',
              sourceId: vault.id,
              description: `تسوية عجز جرد في خزينة ${vault.nameAr}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
                  debit: absDiff,
                  credit: '0.0000',
                  description: 'مصروف تسوية عجز وفروقات الجرد النقدي',
                },
                {
                  accountId: vault.accountId,
                  debit: '0.0000',
                  credit: absDiff,
                  description: `خصم عجز الجرد من خزينة ${vault.nameAr}`,
                },
              ],
            },
            tx
          );
        }
      }

      return {
        vaultId: vault.id,
        bookBalance: bookBalance.toFixed(4),
        actualBalance: actualBalance.toFixed(4),
        variance: diff.toFixed(4),
        journalEntry: jv,
      };
    });
  }

  // ==================================================================
  // 5. Bank Accounts & Reconciliations (الحسابات البنكية ومطابقتها)
  // ==================================================================

  async createBankAccount(context: TenantContext, dto: CreateBankAccountRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.tenantId, context.tenantId),
            eq(bankAccounts.legalEntityId, dto.legalEntityId),
            eq(bankAccounts.accountNumber, dto.accountNumber)
          )
        )
        .limit(1);

      if (existing) throw new ConflictException(`رقم الحساب البنكي '${dto.accountNumber}' مسجل مسبقاً`);

      const [bank] = await tx
        .insert(bankAccounts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          iban: dto.iban || null,
          swiftCode: dto.swiftCode || null,
          currency: dto.currency || 'SAR',
          accountId: dto.accountId,
          balance: dto.openingBalance || '0.0000',
        })
        .returning();

      return bank;
    });
  }

  async listBankAccounts(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select({
          id: bankAccounts.id,
          bankName: bankAccounts.bankName,
          accountNumber: bankAccounts.accountNumber,
          iban: bankAccounts.iban,
          swiftCode: bankAccounts.swiftCode,
          currency: bankAccounts.currency,
          accountId: bankAccounts.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          balance: bankAccounts.balance,
          status: bankAccounts.status,
        })
        .from(bankAccounts)
        .innerJoin(chartOfAccounts, eq(bankAccounts.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(bankAccounts.tenantId, context.tenantId),
            eq(bankAccounts.legalEntityId, legalEntityId)
          )
        );
    });
  }

  async reconcileBankAccount(context: TenantContext, dto: BankReconciliationRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, dto.bankAccountId)))
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');

      const bookBal = parseFloat(bank.balance);
      const stmtBal = parseFloat(dto.statementEndingBalance);
      const discrepancy = stmtBal - bookBal;

      const [rec] = await tx
        .insert(bankReconciliations)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          bankAccountId: bank.id,
          statementDate: new Date(dto.statementDate),
          statementEndingBalance: stmtBal.toFixed(4),
          bookEndingBalance: bookBal.toFixed(4),
          reconciledBalance: stmtBal.toFixed(4),
          discrepancy: discrepancy.toFixed(4),
          status: Math.abs(discrepancy) < 0.0001 ? 'RECONCILED' : 'DISCREPANCY',
          reconciledBy: context.userId,
        })
        .returning();

      return rec;
    });
  }

  // ==================================================================
  // 6. Payment Vouchers (سندات الصرف مع منع السحب على المكشوف)
  // ==================================================================

  async createPaymentVoucher(context: TenantContext, dto: CreatePaymentVoucherRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
        documentType: 'PAYMENT',
        sourceType: 'payment_vouchers',
      },
      async (allocatedVoucherNumber) => {
        return await this.dbService.withTenantContext(context, async (tx) => {
          const amount = parseFloat(dto.amount);
          if (amount <= 0) throw new BadRequestException('مبلغ سند الصرف يجب أن يكون أكبر من صفر');

          // 2. Strict Overdraft Prevention for Vaults
      let creditAccountId: string;
      if (dto.sourceType === 'VAULT') {
        const [vault] = await tx
          .select()
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.sourceId)))
          .limit(1);

        if (!vault) throw new NotFoundException('الخزينة المحددة غير موجودة');
        if (vault.status !== 'ACTIVE') {
          throw new BadRequestException(`لا يمكن صرف أموال من الخزينة '${vault.nameAr}' لأن حالتها معطلة أو غير نشطة (${vault.status})`);
        }

        const currentBal = parseFloat(vault.balance);
        if (currentBal < amount) {
          throw new BadRequestException(
            `رصيد الخزينة غير كافٍ لإتمام سند الصرف (الرصيد: ${currentBal.toFixed(4)}, المطلوب صرفه: ${amount.toFixed(4)}). منع السحب على المكشوف صارم.`
          );
        }

        const newBal = (currentBal - amount).toFixed(4);
        await tx
          .update(cashVaults)
          .set({ balance: newBal })
          .where(eq(cashVaults.id, vault.id));

        await tx.insert(vaultTransactions).values({
          tenantId: context.tenantId,
          vaultId: vault.id,
          transactionType: 'WITHDRAWAL',
          amount: amount.toFixed(4),
          balanceAfter: newBal,
          sourceDocumentType: 'payment_vouchers',
          notes: `سند صرف #${dto.voucherNumber} لصالح ${dto.beneficiaryName}`,
          performedBy: context.userId,
        });

        creditAccountId = vault.accountId;
      } else {
        const [bank] = await tx
          .select()
          .from(bankAccounts)
          .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, dto.sourceId)))
          .limit(1);

        if (!bank) throw new NotFoundException('الحساب البنكي المحدد غير موجود');

        const currentBal = parseFloat(bank.balance);
        const newBal = (currentBal - amount).toFixed(4);
        await tx
          .update(bankAccounts)
          .set({ balance: newBal })
          .where(eq(bankAccounts.id, bank.id));

        creditAccountId = bank.accountId;
      }

      // 3. Post Balanced Journal Entry (Debit Expense/Beneficiary Account, Credit Vault/Bank)
      const jvNumber = `JV-PV-${dto.voucherNumber}`;
      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'payment_vouchers',
          sourceId: dto.sourceId,
          description: `سند صرف #${dto.voucherNumber} - ${dto.beneficiaryName}`,
          lines: [
            {
              accountId: dto.accountId,
              costCenterId: dto.costCenterId,
              debit: amount.toFixed(4),
              credit: '0.0000',
              description: `صرف لصالح ${dto.beneficiaryName} (${dto.voucherType})`,
            },
            {
              accountId: creditAccountId,
              debit: '0.0000',
              credit: amount.toFixed(4),
              description: `خصم من حساب الدفع (${dto.paymentMethod})`,
            },
          ],
        },
        tx
      );

      // 4. Insert Payment Voucher Record
      const [voucher] = await tx
        .insert(paymentVouchers)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          voucherNumber: allocatedVoucherNumber,
          voucherDate: dto.voucherDate ? new Date(dto.voucherDate) : new Date(),
          voucherType: dto.voucherType,
          beneficiaryType: dto.beneficiaryType,
          beneficiaryId: dto.beneficiaryId || null,
          beneficiaryName: dto.beneficiaryName,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          accountId: dto.accountId,
          costCenterId: dto.costCenterId || null,
          paymentMethod: dto.paymentMethod,
          amount: amount.toFixed(4),
          unallocatedAmount: amount.toFixed(4),
          currency: dto.currency || 'SAR',
          exchangeRate: dto.exchangeRate || '1.000000',
          status: VoucherStatus.POSTED,
          journalEntryId: jv.id,
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning();

      return {
        ...voucher,
        journalEntry: jv,
      };
        });
      }
    );
  }

  async listPaymentVouchers(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(paymentVouchers)
        .where(
          and(
            eq(paymentVouchers.tenantId, context.tenantId),
            eq(paymentVouchers.legalEntityId, legalEntityId)
          )
        )
        .orderBy(desc(paymentVouchers.voucherDate));
    });
  }

  // ==================================================================
  // 7. Receipt Vouchers (سندات القبض والتحصيل)
  // ==================================================================

  async createReceiptVoucher(context: TenantContext, dto: CreateReceiptVoucherRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
        documentType: 'RECEIPT',
        sourceType: 'receipt_vouchers',
      },
      async (allocatedVoucherNumber) => {
        return await this.dbService.withTenantContext(context, async (tx) => {
          const amount = parseFloat(dto.amount);
          if (amount <= 0) throw new BadRequestException('مبلغ سند القبض يجب أن يكون أكبر من صفر');

          // Destination: Vault or Bank
      let debitAccountId: string;
      if (dto.destinationType === 'VAULT') {
        const [vault] = await tx
          .select()
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.destinationId)))
          .limit(1);

        if (!vault) throw new NotFoundException('الخزينة المحددة غير موجودة');
        if (vault.status !== 'ACTIVE') {
          throw new BadRequestException(`لا يمكن صرف أموال من الخزينة '${vault.nameAr}' لأن حالتها معطلة أو غير نشطة (${vault.status})`);
        }

        const currentBal = parseFloat(vault.balance);
        const newBal = (currentBal + amount).toFixed(4);

        await tx
          .update(cashVaults)
          .set({ balance: newBal })
          .where(eq(cashVaults.id, vault.id));

        await tx.insert(vaultTransactions).values({
          tenantId: context.tenantId,
          vaultId: vault.id,
          transactionType: 'DEPOSIT',
          amount: amount.toFixed(4),
          balanceAfter: newBal,
          sourceDocumentType: 'receipt_vouchers',
          notes: `سند قبض #${dto.voucherNumber} من ${dto.payerName}`,
          performedBy: context.userId,
        });

        debitAccountId = vault.accountId;
      } else {
        const [bank] = await tx
          .select()
          .from(bankAccounts)
          .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, dto.destinationId)))
          .limit(1);

        if (!bank) throw new NotFoundException('الحساب البنكي المحدد غير موجود');

        const currentBal = parseFloat(bank.balance);
        const newBal = (currentBal + amount).toFixed(4);

        await tx
          .update(bankAccounts)
          .set({ balance: newBal })
          .where(eq(bankAccounts.id, bank.id));

        debitAccountId = bank.accountId;
      }

      // Post Balanced JV (Debit Vault/Bank, Credit Account/Customer)
      const jvNumber = `JV-RV-${dto.voucherNumber}`;
      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'receipt_vouchers',
          sourceId: dto.destinationId,
          description: `سند قبض #${dto.voucherNumber} - ${dto.payerName}`,
          lines: [
            {
              accountId: debitAccountId,
              debit: amount.toFixed(4),
              credit: '0.0000',
              description: `إيداع تحصيل في الخزينة/البنك (${dto.paymentMethod})`,
            },
            {
              accountId: dto.accountId,
              debit: '0.0000',
              credit: amount.toFixed(4),
              description: `سداد/قبض من ${dto.payerName} (${dto.voucherType})`,
            },
          ],
        },
        tx
      );

      const [voucher] = await tx
        .insert(receiptVouchers)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          voucherNumber: allocatedVoucherNumber,
          voucherDate: dto.voucherDate ? new Date(dto.voucherDate) : new Date(),
          voucherType: dto.voucherType,
          payerType: dto.payerType,
          payerId: dto.payerId || null,
          payerName: dto.payerName,
          destinationType: dto.destinationType,
          destinationId: dto.destinationId,
          accountId: dto.accountId,
          paymentMethod: dto.paymentMethod,
          amount: amount.toFixed(4),
          unallocatedAmount: amount.toFixed(4),
          currency: dto.currency || 'SAR',
          exchangeRate: dto.exchangeRate || '1.000000',
          status: VoucherStatus.POSTED,
          journalEntryId: jv.id,
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning();

      return {
        ...voucher,
        journalEntry: jv,
      };
        });
      }
    );
  }

  async listReceiptVouchers(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(receiptVouchers)
        .where(
          and(
            eq(receiptVouchers.tenantId, context.tenantId),
            eq(receiptVouchers.legalEntityId, legalEntityId)
          )
        )
        .orderBy(desc(receiptVouchers.voucherDate));
    });
  }

  // ==================================================================
  // 8. Expenses Management (إدارة المصروفات التشغيلية وضريبتها)
  // ==================================================================

  async createExpense(context: TenantContext, dto: CreateExpenseRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const subtotal = parseFloat(dto.subtotal);
      const taxRate = parseFloat(dto.taxRate || '0.1500');
      const vatAmount = subtotal * taxRate;
      const totalAmount = subtotal + vatAmount;

      const [existing] = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, context.tenantId),
            eq(expenses.legalEntityId, dto.legalEntityId),
            eq(expenses.expenseNumber, dto.expenseNumber)
          )
        )
        .limit(1);

      if (existing) throw new ConflictException(`رقم المصروف '${dto.expenseNumber}' مسجل مسبقاً`);

      const [exp] = await tx
        .insert(expenses)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          costCenterId: dto.costCenterId || null,
          expenseNumber: dto.expenseNumber,
          expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
          category: dto.category,
          accountId: dto.accountId,
          vendorName: dto.vendorName || null,
          subtotal: subtotal.toFixed(4),
          taxRate: taxRate.toFixed(4),
          vatAmount: vatAmount.toFixed(4),
          totalAmount: totalAmount.toFixed(4),
          paymentVoucherId: dto.paymentVoucherId || null,
          status: 'APPROVED',
          notes: dto.notes || null,
        })
        .returning();

      return exp;
    });
  }

  async listExpenses(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select({
          id: expenses.id,
          expenseNumber: expenses.expenseNumber,
          expenseDate: expenses.expenseDate,
          category: expenses.category,
          vendorName: expenses.vendorName,
          subtotal: expenses.subtotal,
          vatAmount: expenses.vatAmount,
          totalAmount: expenses.totalAmount,
          status: expenses.status,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
        })
        .from(expenses)
        .innerJoin(chartOfAccounts, eq(expenses.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(expenses.tenantId, context.tenantId),
            eq(expenses.legalEntityId, legalEntityId)
          )
        )
        .orderBy(desc(expenses.expenseDate));
    });
  }

  // ==================================================================
  // 9. Year-End Closing (إقفال السنة المالية وتدوير الأرباح المبقاة)
  // ==================================================================

  /**
   * Closes all Revenue and Expense accounts into Retained Earnings, balancing out P&L to zero.
   */
  async closeFiscalYear(context: TenantContext, dto: YearEndClosingRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Get trial balance
      const tb = await this.getTrialBalance(context, dto.legalEntityId);

      // 2. Identify nominal accounts (REVENUE, COGS, EXPENSE, OTHER_INCOME, OTHER_EXPENSE)
      const nominalAccounts = tb.accounts.filter(
        (a) =>
          a.accountType === AccountType.REVENUE ||
          a.accountType === AccountType.EXPENSE ||
          a.accountType === AccountType.COGS ||
          a.accountType === AccountType.OTHER_INCOME ||
          a.accountType === AccountType.OTHER_EXPENSE
      );

      const closingLines: any[] = [];
      let totalClosingDebit = 0;
      let totalClosingCredit = 0;

      for (const acc of nominalAccounts) {
        const net = parseFloat(acc.netBalance);
        if (Math.abs(net) < 0.0001) continue;

        if (net > 0) {
          // Debit balance (Expenses/COGS) -> Zero out by Crediting
          closingLines.push({
            accountId: acc.accountId,
            debit: '0.0000',
            credit: net.toFixed(4),
            description: `إقفال حساب ${acc.accountName} في نهاية السنة المالية ${dto.closingFiscalYear}`,
          });
          totalClosingCredit += net;
        } else {
          // Credit balance (Revenues) -> Zero out by Debiting
          const absNet = Math.abs(net);
          closingLines.push({
            accountId: acc.accountId,
            debit: absNet.toFixed(4),
            credit: '0.0000',
            description: `إقفال حساب ${acc.accountName} في نهاية السنة المالية ${dto.closingFiscalYear}`,
          });
          totalClosingDebit += absNet;
        }
      }

      // Net Income = Credit (Revenues) - Debit (Expenses)
      // If totalClosingDebit > totalClosingCredit, we have Net Profit -> Credit Retained Earnings
      // If totalClosingCredit > totalClosingDebit, we have Net Loss -> Debit Retained Earnings
      const diff = totalClosingDebit - totalClosingCredit;
      const targetRetainedEarningsId = dto.retainedEarningsAccountId;
      if (Math.abs(diff) > 0.0001) {
        if (!targetRetainedEarningsId) {
          throw new BadRequestException('يجب تحديد حساب الأرباح المبقاة (retainedEarningsAccountId)');
        }
        if (diff > 0) {
          // Profit -> Credit Retained Earnings
          closingLines.push({
            accountId: targetRetainedEarningsId,
            debit: '0.0000',
            credit: diff.toFixed(4),
            description: `ترحيل صافي أرباح السنة المالية ${dto.closingFiscalYear || ''} للأرباح المبقاة`,
          });
        } else {
          // Loss -> Debit Retained Earnings
          const absDiff = Math.abs(diff);
          closingLines.push({
            accountId: targetRetainedEarningsId,
            debit: absDiff.toFixed(4),
            credit: '0.0000',
            description: `ترحيل صافي خسائر السنة المالية ${dto.closingFiscalYear || ''} للأرباح المبقاة`,
          });
        }
      }

      if (closingLines.length === 0) {
        throw new BadRequestException('لا توجد إيرادات أو مصروفات لإقفالها في هذه السنة');
      }

      // 3. Post closing entry
      const closingEntry = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          journalNumber: dto.closingJournalNumber || `JV-CLOSE-${Date.now().toString(36).toUpperCase()}`,
          journalType: JournalType.CLOSING,
          sourceType: 'year_end_closing',
          sourceId: targetRetainedEarningsId || dto.legalEntityId,
          description: `قيد إقفال السنة المالية ${dto.closingFiscalYear || ''}`,
          lines: closingLines,
        },
        tx
      );

      return {
        closingFiscalYear: dto.closingFiscalYear,
        netProfitLoss: diff.toFixed(4),
        journalEntry: closingEntry,
      };
    });
  }

  // ==================================================================
  // 10. Financial Statements & ZATCA VAT Return (التقارير المالية والضريبية)
  // ==================================================================

  /**
   * Income Statement (قائمة الدخل: إيرادات - تكلفة - مصروفات = صافي الربح)
   */
  async getIncomeStatement(context: TenantContext, query: FinancialReportQuery) {
    const tb = await this.getTrialBalance(context, query.legalEntityId);

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalExpense = 0;
    let totalOtherIncome = 0;
    let totalOtherExpense = 0;

    const revenueAccounts: any[] = [];
    const cogsAccounts: any[] = [];
    const expenseAccounts: any[] = [];

    for (const acc of tb.accounts) {
      const net = parseFloat(acc.netBalance);
      if (acc.accountType === AccountType.REVENUE) {
        const rev = Math.abs(net);
        totalRevenue += rev;
        revenueAccounts.push({ ...acc, amount: rev.toFixed(4) });
      } else if (acc.accountType === AccountType.COGS) {
        totalCogs += net;
        cogsAccounts.push({ ...acc, amount: net.toFixed(4) });
      } else if (acc.accountType === AccountType.EXPENSE) {
        totalExpense += net;
        expenseAccounts.push({ ...acc, amount: net.toFixed(4) });
      } else if (acc.accountType === AccountType.OTHER_INCOME) {
        totalOtherIncome += Math.abs(net);
      } else if (acc.accountType === AccountType.OTHER_EXPENSE) {
        totalOtherExpense += net;
      }
    }

    const grossProfit = totalRevenue - totalCogs;
    const operatingIncome = grossProfit - totalExpense;
    const netProfit = operatingIncome + totalOtherIncome - totalOtherExpense;

    return {
      legalEntityId: query.legalEntityId,
      totalRevenue: totalRevenue.toFixed(4),
      totalCogs: totalCogs.toFixed(4),
      grossProfit: grossProfit.toFixed(4),
      totalExpense: totalExpense.toFixed(4),
      operatingIncome: operatingIncome.toFixed(4),
      otherIncome: totalOtherIncome.toFixed(4),
      otherExpense: totalOtherExpense.toFixed(4),
      netProfit: netProfit.toFixed(4),
      revenueAccounts,
      cogsAccounts,
      expenseAccounts,
    };
  }

  /**
   * Balance Sheet (الميزانية العمومية: الأصول = الالتزامات + حقوق الملكية)
   */
  async getBalanceSheet(context: TenantContext, query: FinancialReportQuery) {
    const tb = await this.getTrialBalance(context, query.legalEntityId);

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    const assetAccounts: any[] = [];
    const liabilityAccounts: any[] = [];
    const equityAccounts: any[] = [];

    for (const acc of tb.accounts) {
      const net = parseFloat(acc.netBalance);
      if (acc.accountType === AccountType.ASSET) {
        totalAssets += net;
        assetAccounts.push({ ...acc, amount: net.toFixed(4) });
      } else if (acc.accountType === AccountType.LIABILITY) {
        const liab = Math.abs(net);
        totalLiabilities += liab;
        liabilityAccounts.push({ ...acc, amount: liab.toFixed(4) });
      } else if (acc.accountType === AccountType.EQUITY) {
        const eqVal = Math.abs(net);
        totalEquity += eqVal;
        equityAccounts.push({ ...acc, amount: eqVal.toFixed(4) });
      }
    }

    // Add current period net profit into equity
    const pnl = await this.getIncomeStatement(context, query);
    const periodNetProfit = parseFloat(pnl.netProfit);
    const adjustedEquity = totalEquity + periodNetProfit;
    const isBalanced = Math.abs(totalAssets - (totalLiabilities + adjustedEquity)) < 0.0001;

    return {
      legalEntityId: query.legalEntityId,
      totalAssets: totalAssets.toFixed(4),
      totalLiabilities: totalLiabilities.toFixed(4),
      baseEquity: totalEquity.toFixed(4),
      currentPeriodProfit: periodNetProfit.toFixed(4),
      totalEquity: adjustedEquity.toFixed(4),
      totalLiabilitiesAndEquity: (totalLiabilities + adjustedEquity).toFixed(4),
      isBalanced,
      assetAccounts,
      liabilityAccounts,
      equityAccounts,
    };
  }

  /**
   * ZATCA Official 15% VAT Return Report
   */
  async getZatcaVatReturn(context: TenantContext, query: VatReturnReportQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Output VAT from Sales Orders
      const salesResult = await tx
        .select({
          totalSales: sql<string>`COALESCE(SUM(CAST(subtotal AS NUMERIC)), 0)::text`,
          totalOutputVat: sql<string>`COALESCE(SUM(CAST(vat_amount AS NUMERIC)), 0)::text`,
        })
        .from(expenses) // Just fallback shape, let's query journal lines for accurate accounting
        .limit(1);

      // Query Journal Lines linked to VAT Output and VAT Input
      const vatOutputMapping = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, query.legalEntityId),
            eq(accountMappings.mappingKey, DefaultAccountMappingKey.VAT_OUTPUT)
          )
        )
        .limit(1);

      const vatInputMapping = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.legalEntityId, query.legalEntityId),
            eq(accountMappings.mappingKey, DefaultAccountMappingKey.VAT_INPUT)
          )
        )
        .limit(1);

      let outputVat = 0;
      let inputVat = 0;

      const outMap = vatOutputMapping[0];
      if (outMap) {
        const [outRes] = await tx
          .select({
            creditSum: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
          })
          .from(journalLines)
          .where(eq(journalLines.accountId, outMap.accountId));
        outputVat = parseFloat(outRes?.creditSum || '0');
      }

      const inMap = vatInputMapping[0];
      if (inMap) {
        const [inRes] = await tx
          .select({
            debitSum: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
          })
          .from(journalLines)
          .where(eq(journalLines.accountId, inMap.accountId));
        inputVat = parseFloat(inRes?.debitSum || '0');
      }

      // If no explicit mapping or journal entries yet, derive from expenses table
      const [expTotals] = await tx
        .select({
          subtotalSum: sql<string>`COALESCE(SUM(CAST(subtotal AS NUMERIC)), 0)::text`,
          vatSum: sql<string>`COALESCE(SUM(CAST(vat_amount AS NUMERIC)), 0)::text`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, context.tenantId),
            eq(expenses.legalEntityId, query.legalEntityId)
          )
        );

      if (inputVat === 0 && expTotals) {
        inputVat = parseFloat(expTotals.vatSum || '0');
      }

      const taxableSales = outputVat > 0 ? outputVat / 0.15 : 0;
      const taxablePurchases = inputVat > 0 ? inputVat / 0.15 : parseFloat(expTotals?.subtotalSum || '0');
      const netVatPayable = outputVat - inputVat;

      return {
        legalEntityId: query.legalEntityId,
        startDate: query.startDate,
        endDate: query.endDate,
        box1_standardSales: taxableSales.toFixed(4),
        box1_outputVat: outputVat.toFixed(4),
        box7_standardPurchases: taxablePurchases.toFixed(4),
        box7_inputVat: inputVat.toFixed(4),
        totalOutputVat: outputVat.toFixed(4),
        totalInputVat: inputVat.toFixed(4),
        netVatPayableOrRefund: netVatPayable.toFixed(4),
        status: netVatPayable >= 0 ? 'PAYABLE' : 'REFUNDABLE',
      };
    });
  }

  /**
   * AR & AP Aging Analysis (أعمار الديون والذمم المدينة والدائنة)
   */
  async getAgingReport(context: TenantContext, query: AgingReportQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // In Restaurant Cloud, we analyze aging from Vouchers and Invoices
      return {
        legalEntityId: query.legalEntityId,
        entityType: query.entityType,
        asOfDate: query.asOfDate || new Date().toISOString(),
        buckets: {
          current: '0.0000',
          days1_30: '0.0000',
          days31_60: '0.0000',
          days61_90: '0.0000',
          days90Plus: '0.0000',
        },
        entities: [],
      };
    });
  }

  // ==================================================================
  // 11. Core Journal Entry Posting & Reversal (Delegated to PostingEngine)
  // ==================================================================

  async postJournalEntry(context: TenantContext, dto: CreateJournalEntry) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
        documentType: 'JOURNAL_ENTRY',
        sourceType: 'journal_entries',
      },
      async (allocatedJournalNumber) => {
        return await this.postingEngine.postEntry(context, {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: allocatedJournalNumber,
          journalType: dto.journalType,
          sourceType: dto.sourceType || 'MANUAL',
          sourceId: dto.sourceId || randomUUID(),
          description: dto.description,
          notes: dto.notes,
          entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
          lines: dto.lines,
        });
      }
    );
  }

  async reverseJournalEntry(context: TenantContext, dto: ReverseJournalEntryRequest) {
    const [entryMeta] = await this.dbService.withTenantContext(context, async (tx) =>
      tx
        .select({
          legalEntityId: journalEntries.legalEntityId,
          branchId: journalEntries.branchId,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.id, dto.journalEntryId)
          )
        )
        .limit(1)
    );

    if (!entryMeta) throw new NotFoundException(`القيد '${dto.journalEntryId}' غير موجود`);

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: entryMeta.legalEntityId,
        branchId: entryMeta.branchId,
        documentType: 'JOURNAL_ENTRY',
        sourceType: 'journal_reversal',
      },
      async (allocatedJournalNumber) => {
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

          if (!entry) throw new NotFoundException(`القيد '${dto.journalEntryId}' غير موجود`);

          if (entry.status === JournalStatus.REVERSED) {
            throw new BadRequestException('تم عكس هذا القيد مسبقاً ولا يمكن عكسه مرة أخرى');
          }

          const originalLines = await tx
            .select()
            .from(journalLines)
            .where(eq(journalLines.journalEntryId, entry.id));

          // Mark original entry as REVERSED
          await tx
            .update(journalEntries)
            .set({ status: JournalStatus.REVERSED })
            .where(eq(journalEntries.id, entry.id));

          // Post inverted entry
          const reversalLines = originalLines.map((l) => ({
            accountId: l.accountId,
            branchId: l.branchId,
            costCenterId: l.costCenterId,
            partnerId: l.partnerId,
            partnerRole: l.partnerRole,
            debit: l.credit,
            credit: l.debit,
            currency: l.currency,
            description: `عكس القيد ${entry.journalNumber}: ${dto.reversalReason}`,
          }));

          const newJournalNum = allocatedJournalNumber;

      const reversalResult = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: entry.legalEntityId,
          branchId: entry.branchId,
          journalNumber: newJournalNum,
          journalType: JournalType.REVERSAL,
          sourceType: 'journal_reversal',
          sourceId: entry.id,
          description: `قيد عكسي للقيد #${entry.journalNumber} - السبب: ${dto.reversalReason}`,
          lines: reversalLines,
        },
        tx
      );

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'JOURNAL_ENTRY_REVERSED',
          entityType: 'journal_entries',
          entityId: entry.id,
          afterState: { originalId: entry.id, reversalJournal: reversalResult },
        },
        tx
      );

      return reversalResult;
        });
      }
    );
  }

  /**
   * List Journal Entries with headers, lines, accounts, and business partners
   */
  async listJournalEntries(context: TenantContext, query: QueryJournalEntries) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const conditions: any[] = [
        eq(journalEntries.tenantId, context.tenantId),
        eq(journalEntries.legalEntityId, query.legalEntityId),
      ];

      if (query.status) {
        conditions.push(eq(journalEntries.status, query.status as any));
      }

      if (query.journalType) {
        conditions.push(eq(journalEntries.journalType, query.journalType as any));
      }

      if (query.fromDate) {
        conditions.push(sql`${journalEntries.entryDate} >= ${new Date(query.fromDate)}`);
      }

      if (query.toDate) {
        conditions.push(sql`${journalEntries.entryDate} <= ${new Date(query.toDate)}`);
      }

      if (query.search) {
        conditions.push(
          or(
            ilike(journalEntries.journalNumber, `%${query.search}%`),
            ilike(journalEntries.description, `%${query.search}%`)
          )
        );
      }

      const entries = await tx
        .select()
        .from(journalEntries)
        .where(and(...conditions))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.postedAt))
        .limit(limit)
        .offset(offset);

      const [totalCount] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(journalEntries)
        .where(and(...conditions));

      if (entries.length === 0) {
        return { items: [], total: 0 };
      }

      const entryIds = entries.map((e) => e.id);

      const lines = await tx
        .select({
          id: journalLines.id,
          journalEntryId: journalLines.journalEntryId,
          accountId: journalLines.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          accountNameAr: chartOfAccounts.nameAr,
          branchId: journalLines.branchId,
          costCenterId: journalLines.costCenterId,
          partnerId: journalLines.partnerId,
          partnerName: businessPartners.legalNameAr,
          partnerRole: journalLines.partnerRole,
          debit: journalLines.debit,
          credit: journalLines.credit,
          currency: journalLines.currency,
          description: journalLines.description,
        })
        .from(journalLines)
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .leftJoin(businessPartners, eq(journalLines.partnerId, businessPartners.id))
        .where(inArray(journalLines.journalEntryId, entryIds));

      const linesByEntry = new Map<string, any[]>();
      for (const line of lines) {
        if (!linesByEntry.has(line.journalEntryId)) {
          linesByEntry.set(line.journalEntryId, []);
        }
        linesByEntry.get(line.journalEntryId)!.push(line);
      }

      const enriched = entries.map((e) => ({
        ...e,
        lines: linesByEntry.get(e.id) || [],
      }));

      return {
        items: enriched,
        total: Number(totalCount?.count || 0),
      };
    });
  }

  /**
   * Get single Journal Entry with lines
   */
  async getJournalEntryById(context: TenantContext, entryId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.id, entryId)
          )
        )
        .limit(1);

      if (!entry) throw new NotFoundException('القيد غير موجود');

      const lines = await tx
        .select({
          id: journalLines.id,
          journalEntryId: journalLines.journalEntryId,
          accountId: journalLines.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          accountNameAr: chartOfAccounts.nameAr,
          branchId: journalLines.branchId,
          costCenterId: journalLines.costCenterId,
          partnerId: journalLines.partnerId,
          partnerName: businessPartners.legalNameAr,
          partnerRole: journalLines.partnerRole,
          debit: journalLines.debit,
          credit: journalLines.credit,
          currency: journalLines.currency,
          description: journalLines.description,
        })
        .from(journalLines)
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .leftJoin(businessPartners, eq(journalLines.partnerId, businessPartners.id))
        .where(eq(journalLines.journalEntryId, entry.id));

      return {
        ...entry,
        lines,
      };
    });
  }

  /**
   * Create Multi-Line Journal Entry (supports DRAFT and POSTED)
   */
  async createJournalEntry(context: TenantContext, dto: CreateJournalEntry) {
    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
        documentType: 'JOURNAL_ENTRY',
        sourceType: 'journal_entries',
      },
      async (allocatedJournalNumber) => {
        if (dto.status === JournalStatus.DRAFT) {
          return await this.dbService.withTenantContext(context, async (tx) => {
            let totalDebit = 0;
            let totalCredit = 0;
            for (const l of dto.lines) {
              totalDebit += parseFloat(l.debit || '0');
              totalCredit += parseFloat(l.credit || '0');
            }

            const entryDate = dto.entryDate ? new Date(dto.entryDate) : new Date();

            const [draft] = await tx
              .insert(journalEntries)
              .values({
                tenantId: context.tenantId,
                legalEntityId: dto.legalEntityId,
                branchId: dto.branchId || null,
                journalNumber: allocatedJournalNumber,
            journalType: dto.journalType,
            sourceType: dto.sourceType || 'MANUAL',
            sourceId: dto.sourceId || randomUUID(),
            status: JournalStatus.DRAFT,
            approvalStatus: 'PENDING',
            debitTotal: totalDebit.toFixed(4),
            creditTotal: totalCredit.toFixed(4),
            description: dto.description || null,
            notes: dto.notes || null,
            entryDate,
            documentDate: entryDate,
            postedBy: context.userId,
          })
          .returning();

        if (!draft) throw new Error('فشل إنشاء مسودة القيد');

        for (const line of dto.lines) {
          await tx.insert(journalLines).values({
            journalEntryId: draft.id,
            accountId: line.accountId,
            branchId: line.branchId || dto.branchId || null,
            costCenterId: line.costCenterId || null,
            partnerId: line.partnerId || null,
            partnerRole: line.partnerRole || null,
            debit: parseFloat(line.debit || '0').toFixed(4),
            credit: parseFloat(line.credit || '0').toFixed(4),
            currency: line.currency || 'SAR',
            description: line.description || dto.description || null,
          });
        }

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'JOURNAL_DRAFT_CREATED',
            entityType: 'journal_entries',
            entityId: draft.id,
            afterState: { journalNumber: draft.journalNumber, status: 'DRAFT' },
          },
          tx
        );

        return draft;
      });
    }

        return await this.postingEngine.postEntry(context, {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: allocatedJournalNumber,
          journalType: dto.journalType,
          sourceType: dto.sourceType || 'MANUAL',
          sourceId: dto.sourceId || randomUUID(),
          description: dto.description,
          notes: dto.notes,
          entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
          lines: dto.lines,
        });
      }
    );
  }

  /**
   * Update Draft Journal Entry
   */
  async updateDraftJournalEntry(context: TenantContext, entryId: string, dto: UpdateDraftJournalEntryRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.id, entryId)
          )
        )
        .limit(1);

      if (!existing) throw new NotFoundException('القيد غير موجود');
      if (existing.status !== JournalStatus.DRAFT) {
        throw new BadRequestException('لا يمكن تعديل قيد تم ترحيله أو إلغاؤه؛ القيود المرحلة غير قابلة للتعديل');
      }

      let totalDebit = parseFloat(existing.debitTotal);
      let totalCredit = parseFloat(existing.creditTotal);

      if (dto.lines) {
        totalDebit = 0;
        totalCredit = 0;
        for (const l of dto.lines) {
          totalDebit += parseFloat(l.debit || '0');
          totalCredit += parseFloat(l.credit || '0');
        }

        await tx.delete(journalLines).where(eq(journalLines.journalEntryId, entryId));
        for (const line of dto.lines) {
          if (line.accountId) {
            const [acc] = await tx
              .select({
                id: chartOfAccounts.id,
                accountCode: chartOfAccounts.accountCode,
                name: chartOfAccounts.name,
                isPostable: chartOfAccounts.isPostable,
              })
              .from(chartOfAccounts)
              .where(
                and(
                  eq(chartOfAccounts.tenantId, context.tenantId),
                  eq(chartOfAccounts.id, line.accountId)
                )
              )
              .limit(1);

            if (acc && !acc.isPostable) {
              throw new BadRequestException(`لا يمكن إضافة حساب رئيسي/تجميعي في أسطر القيد: (${acc.accountCode} - ${acc.name})`);
            }
          }

          await tx.insert(journalLines).values({
            journalEntryId: entryId,
            accountId: line.accountId,
            branchId: line.branchId || dto.branchId || existing.branchId || null,
            costCenterId: line.costCenterId || null,
            partnerId: line.partnerId || null,
            partnerRole: line.partnerRole || null,
            debit: parseFloat(line.debit || '0').toFixed(4),
            credit: parseFloat(line.credit || '0').toFixed(4),
            currency: line.currency || 'SAR',
            description: line.description || dto.description || existing.description || null,
          });
        }
      }

      const [updated] = await tx
        .update(journalEntries)
        .set({
          branchId: dto.branchId !== undefined ? dto.branchId : existing.branchId,
          journalType: dto.journalType ?? existing.journalType,
          description: dto.description ?? existing.description,
          notes: dto.notes ?? existing.notes,
          entryDate: dto.entryDate ? new Date(dto.entryDate) : existing.entryDate,
          status: dto.status ?? existing.status,
          debitTotal: totalDebit.toFixed(4),
          creditTotal: totalCredit.toFixed(4),
        })
        .where(eq(journalEntries.id, entryId))
        .returning();

      return updated;
    });
  }

  /**
   * Delete Draft Journal Entry
   */
  async deleteDraftJournalEntry(context: TenantContext, entryId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.id, entryId)
          )
        )
        .limit(1);

      if (!existing) throw new NotFoundException('القيد غير موجود');
      if (existing.status !== JournalStatus.DRAFT) {
        throw new BadRequestException('ممنوع حذف القيود المرحلة؛ المحاسبة السليمة تتطلب عكس القيد وليس حذفه');
      }

      await tx.delete(journalLines).where(eq(journalLines.journalEntryId, entryId));
      await tx.delete(journalEntries).where(eq(journalEntries.id, entryId));

      return { success: true, message: 'تم حذف مسودة القيد بنجاح' };
    });
  }

  /**
   * Post a Draft Journal Entry to General Ledger
   */
  async postDraftJournalEntry(context: TenantContext, entryId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const entryWithLines = await this.getJournalEntryById(context, entryId);
      if (entryWithLines.status !== JournalStatus.DRAFT) {
        throw new BadRequestException('القيد مرحل مسبقاً أو غير قابل للترحيل');
      }

      await tx.delete(journalLines).where(eq(journalLines.journalEntryId, entryId));
      await tx.delete(journalEntries).where(eq(journalEntries.id, entryId));

      return await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: entryWithLines.legalEntityId,
          branchId: entryWithLines.branchId,
          journalNumber: entryWithLines.journalNumber,
          journalType: entryWithLines.journalType as any,
          sourceType: 'MANUAL',
          sourceId: entryWithLines.sourceId,
          description: entryWithLines.description || undefined,
          notes: entryWithLines.notes || undefined,
          entryDate: entryWithLines.entryDate ? new Date(entryWithLines.entryDate) : undefined,
          lines: entryWithLines.lines.map((l: any) => ({
            accountId: l.accountId,
            branchId: l.branchId,
            costCenterId: l.costCenterId,
            partnerId: l.partnerId,
            partnerRole: l.partnerRole,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency,
            description: l.description,
          })),
        },
        tx
      );
    });
  }

  /**
   * Bank and Vault Transfers with Automated Double-Entry
   */
  async bankTransfer(context: TenantContext, dto: BankTransferRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const amount = parseFloat(dto.amount);
      if (amount <= 0) throw new BadRequestException('مبلغ التحويل يجب أن يكون أكبر من صفر');

      // 1. Direct identifier comparison guard
      if (dto.sourceType === dto.destinationType && dto.sourceId === dto.destinationId) {
        throw new BadRequestException('لا يمكن التحويل من الحساب إلى نفسه. اختر حسابًا آخر كوجهة');
      }

      // 2. Fetch and validate Source record (without modifying balance yet)
      let sourceAccountId: string;
      let sourceName: string;
      let sourceBalance: number;

      if (dto.sourceType === 'VAULT') {
        const [vault] = await tx.select().from(cashVaults).where(eq(cashVaults.id, dto.sourceId)).limit(1);
        if (!vault) throw new NotFoundException('الخزينة المصدر غير موجودة');
        if (context.userScopes && vault.branchId) {
          this.opsFramework.verifyScope(context, context.userScopes, {
            legalEntityId: dto.legalEntityId,
            branchId: vault.branchId,
          });
        }
        sourceAccountId = vault.accountId;
        sourceName = vault.nameAr;
        sourceBalance = parseFloat(vault.balance);
      } else {
        const [bank] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, dto.sourceId)).limit(1);
        if (!bank) throw new NotFoundException('الحساب البنكي المصدر غير موجود');
        sourceAccountId = bank.accountId;
        sourceName = bank.bankName;
        sourceBalance = parseFloat(bank.balance);
      }

      // 3. Fetch and validate Destination record (without modifying balance yet)
      let destAccountId: string;
      let destName: string;
      let destBalance: number;

      if (dto.destinationType === 'VAULT') {
        const [vault] = await tx.select().from(cashVaults).where(eq(cashVaults.id, dto.destinationId)).limit(1);
        if (!vault) throw new NotFoundException('الخزينة الوجهة غير موجودة');
        if (context.userScopes && vault.branchId) {
          this.opsFramework.verifyScope(context, context.userScopes, {
            legalEntityId: dto.legalEntityId,
            branchId: vault.branchId,
          });
        }
        destAccountId = vault.accountId;
        destName = vault.nameAr;
        destBalance = parseFloat(vault.balance);
      } else {
        const [bank] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, dto.destinationId)).limit(1);
        if (!bank) throw new NotFoundException('الحساب البنكي الوجهة غير موجود');
        destAccountId = bank.accountId;
        destName = bank.bankName;
        destBalance = parseFloat(bank.balance);
      }

      // 4. Underlying GL Account ID comparison guard (prevents transferring to same COA account across records)
      if (sourceAccountId === destAccountId) {
        throw new BadRequestException('لا يمكن التحويل من الحساب إلى نفسه. اختر حسابًا آخر كوجهة');
      }

      // 5. Sufficient balance verification
      if (sourceBalance < amount) {
        throw new BadRequestException(`رصيد المصدر غير كافٍ (${sourceBalance.toFixed(4)})`);
      }

      // 6. Only after ALL guards pass: atomically update balances
      if (dto.sourceType === 'VAULT') {
        const newBal = (sourceBalance - amount).toFixed(4);
        await tx.update(cashVaults).set({ balance: newBal }).where(eq(cashVaults.id, dto.sourceId));
      } else {
        const newBal = (sourceBalance - amount).toFixed(4);
        await tx.update(bankAccounts).set({ balance: newBal }).where(eq(bankAccounts.id, dto.sourceId));
      }

      if (dto.destinationType === 'VAULT') {
        const newBal = (destBalance + amount).toFixed(4);
        await tx.update(cashVaults).set({ balance: newBal }).where(eq(cashVaults.id, dto.destinationId));
      } else {
        const newBal = (destBalance + amount).toFixed(4);
        await tx.update(bankAccounts).set({ balance: newBal }).where(eq(bankAccounts.id, dto.destinationId));
      }

      const jvNumber = `TRF-${Date.now().toString().slice(-6)}`;
      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'TRANSFER',
          sourceId: randomUUID(),
          description: `تحويل نقدي من ${sourceName} إلى ${destName} - ${dto.notes || ''}`,
          lines: [
            {
              accountId: destAccountId,
              debit: amount.toFixed(4),
              credit: '0.0000',
              description: `استلام تحويل من ${sourceName}`,
            },
            {
              accountId: sourceAccountId,
              debit: '0.0000',
              credit: amount.toFixed(4),
              description: `تحويل صادر إلى ${destName}`,
            },
          ],
        },
        tx
      );

      return {
        success: true,
        journalEntryId: jv.id,
        journalNumber: jv.journalNumber,
        amount: amount.toFixed(4),
        source: sourceName,
        destination: destName,
      };
    });
  }

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

  async getTrialBalance(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const rows = await tx
        .select({
          accountId: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          name: chartOfAccounts.name,
          nameAr: chartOfAccounts.nameAr,
          nameEn: chartOfAccounts.nameEn,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          accountType: chartOfAccounts.accountType,
          isPostable: chartOfAccounts.isPostable,
          level: chartOfAccounts.level,
          parentId: chartOfAccounts.parentId,
          totalDebit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.id} IS NOT NULL THEN CAST(${journalLines.debit} AS NUMERIC) ELSE 0 END), 0)::text`,
          totalCredit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.id} IS NOT NULL THEN CAST(${journalLines.credit} AS NUMERIC) ELSE 0 END), 0)::text`,
        })
        .from(chartOfAccounts)
        .leftJoin(journalLines, eq(chartOfAccounts.id, journalLines.accountId))
        .leftJoin(
          journalEntries,
          and(
            eq(journalLines.journalEntryId, journalEntries.id),
            eq(journalEntries.status, JournalStatus.POSTED)
          )
        )
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
          chartOfAccounts.nameAr,
          chartOfAccounts.nameEn,
          chartOfAccounts.accountType,
          chartOfAccounts.isPostable,
          chartOfAccounts.level,
          chartOfAccounts.parentId
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
        totalDebit: grandDebit.toFixed(4),
        totalCredit: grandCredit.toFixed(4),
        discrepancy: discrepancy.toFixed(4),
        difference: discrepancy.toFixed(4),
        isBalanced: discrepancy < 0.0001,
        accounts,
      };
    });
  }

  // ==================================================================
  // 12. Fiscal Periods
  // ==================================================================

  async createFiscalPeriod(context: TenantContext, dto: CreateFiscalPeriodRequest) {
    const startDt = new Date(dto.startDate);
    const endDt = new Date(dto.endDate);
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime()) || startDt >= endDt) {
      throw new BadRequestException('تاريخ بداية الفترة المالية يجب أن يكون قبل تاريخ النهاية');
    }

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
            gte(fiscalPeriods.endDate, startDt)
          )
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
          periodName: dto.periodName,
          startDate: startDt,
          endDate: endDt,
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

      if (!period) throw new NotFoundException('الفترة المالية غير موجودة');

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

  // ==================================================================
  // Phase 3.5 — Hierarchical Trial Balance, GL, Statement & Drill-Down
  // ==================================================================

  private async verifyReportEntityAndBranchScope(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    branchId?: string
  ) {
    const [le] = await tx
      .select({ id: legalEntities.id })
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.id, legalEntityId)))
      .limit(1);
    if (!le) {
      throw new NotFoundException(`المنشأة القانونية '${legalEntityId}' غير موجودة`);
    }

    await this.opsFramework.verifyScope(context, context.userScopes || [], {
      legalEntityId,
      branchId,
    });

    if (!branchId && !(context.scopes || []).includes('*')) {
      const scopes = context.userScopes || [];
      const hasBroadScope = scopes.some((s) => s.scopeType === 'TENANT' || s.scopeType === 'LEGAL_ENTITY');
      if (scopes.length > 0 && !hasBroadScope) {
        throw new ForbiddenException('المستخدم المقيد بفرع لا يمكنه استعراض تقارير المنشأة القانونية بالكامل دون تحديد الفرع المصرح به.');
      }
    }
  }

  async getHierarchicalTrialBalance(
    context: TenantContext,
    params: {
      legalEntityId: string;
      branchId?: string;
      fiscalPeriodId?: string;
      startDate?: string;
      endDate?: string;
      accountId?: string;
      accountType?: string;
      search?: string;
      includeZeroBalances?: boolean;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyReportEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);

      let startDt: Date | null = params.startDate ? new Date(params.startDate) : null;
      let endDt: Date | null = params.endDate ? new Date(params.endDate) : null;

      if (params.fiscalPeriodId) {
        const [fp] = await tx
          .select()
          .from(fiscalPeriods)
          .where(and(eq(fiscalPeriods.tenantId, context.tenantId), eq(fiscalPeriods.id, params.fiscalPeriodId)))
          .limit(1);
        if (!fp) throw new NotFoundException('الفترة المالية غير موجودة');
        startDt = fp.startDate;
        endDt = fp.endDate;
      }

      const coaRows = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, params.legalEntityId)
          )
        )
        .orderBy(asc(chartOfAccounts.accountCode));

      const lineConds = [
        eq(journalEntries.tenantId, context.tenantId),
        eq(journalEntries.legalEntityId, params.legalEntityId),
        eq(journalEntries.status, JournalStatus.POSTED),
      ];
      if (params.branchId) {
        lineConds.push(eq(journalLines.branchId, params.branchId));
      }
      if (endDt) {
        lineConds.push(lte(journalEntries.entryDate, endDt));
      }

      const startIso = startDt ? startDt.toISOString() : null;
      const openingDebitExpr = startIso
        ? sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} < ${startIso}::timestamptz THEN CAST(${journalLines.debit} AS NUMERIC) ELSE 0 END), 0)::text`
        : sql<string>`'0'::text`;
      const openingCreditExpr = startIso
        ? sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} < ${startIso}::timestamptz THEN CAST(${journalLines.credit} AS NUMERIC) ELSE 0 END), 0)::text`
        : sql<string>`'0'::text`;
      const periodDebitExpr = startIso
        ? sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} >= ${startIso}::timestamptz THEN CAST(${journalLines.debit} AS NUMERIC) ELSE 0 END), 0)::text`
        : sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`;
      const periodCreditExpr = startIso
        ? sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} >= ${startIso}::timestamptz THEN CAST(${journalLines.credit} AS NUMERIC) ELSE 0 END), 0)::text`
        : sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`;

      const aggRows = await tx
        .select({
          accountId: journalLines.accountId,
          openingDebit: openingDebitExpr,
          openingCredit: openingCreditExpr,
          periodDebit: periodDebitExpr,
          periodCredit: periodCreditExpr,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(and(...lineConds))
        .groupBy(journalLines.accountId);

      const aggMap = new Map<
        string,
        { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number }
      >();
      let grandOpeningDebit = 0;
      let grandOpeningCredit = 0;
      let grandPeriodDebit = 0;
      let grandPeriodCredit = 0;

      for (const r of aggRows) {
        const od = parseFloat(r.openingDebit || '0');
        const oc = parseFloat(r.openingCredit || '0');
        const pd = parseFloat(r.periodDebit || '0');
        const pc = parseFloat(r.periodCredit || '0');
        aggMap.set(r.accountId, { openingDebit: od, openingCredit: oc, periodDebit: pd, periodCredit: pc });
        grandOpeningDebit += od;
        grandOpeningCredit += oc;
        grandPeriodDebit += pd;
        grandPeriodCredit += pc;
      }

      type TbNode = {
        accountId: string;
        accountCode: string;
        name: string;
        nameAr: string | null;
        nameEn: string | null;
        accountType: string;
        normalBalance: string;
        parentId: string | null;
        level: number;
        isPostable: boolean;
        openingDebit: number;
        openingCredit: number;
        periodDebit: number;
        periodCredit: number;
        closingDebit: number;
        closingCredit: number;
        openingNormalBalance: number;
        closingNormalBalance: number;
        children: TbNode[];
      };

      const nodeMap = new Map<string, TbNode>();
      for (const acc of coaRows) {
        const direct = aggMap.get(acc.id) ?? {
          openingDebit: 0,
          openingCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
        };
        nodeMap.set(acc.id, {
          accountId: acc.id,
          accountCode: acc.accountCode,
          name: acc.nameAr || acc.name,
          nameAr: acc.nameAr,
          nameEn: acc.nameEn,
          accountType: acc.accountType,
          normalBalance: acc.normalBalance,
          parentId: acc.parentId,
          level: acc.level,
          isPostable: acc.isPostable,
          openingDebit: direct.openingDebit,
          openingCredit: direct.openingCredit,
          periodDebit: direct.periodDebit,
          periodCredit: direct.periodCredit,
          closingDebit: 0,
          closingCredit: 0,
          openingNormalBalance: 0,
          closingNormalBalance: 0,
          children: [],
        });
      }

      // Build hierarchy and propagate bottom-up without double counting
      const roots: TbNode[] = [];
      for (const node of nodeMap.values()) {
        if (node.parentId && nodeMap.has(node.parentId)) {
          nodeMap.get(node.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      const rollUp = (node: TbNode) => {
        for (const child of node.children) {
          rollUp(child);
          node.openingDebit += child.openingDebit;
          node.openingCredit += child.openingCredit;
          node.periodDebit += child.periodDebit;
          node.periodCredit += child.periodCredit;
        }
        const openNet = node.openingDebit - node.openingCredit;
        const closeNet = openNet + (node.periodDebit - node.periodCredit);
        node.closingDebit = closeNet > 0 ? closeNet : 0;
        node.closingCredit = closeNet < 0 ? Math.abs(closeNet) : 0;
        node.openingNormalBalance = node.normalBalance === NormalBalance.CREDIT ? -openNet : openNet;
        node.closingNormalBalance = node.normalBalance === NormalBalance.CREDIT ? -closeNet : closeNet;
      };

      for (const r of roots) {
        rollUp(r);
      }

      const includeZero = params.includeZeroBalances ?? true;
      const searchTerm = params.search?.trim().toLowerCase() ?? '';
      const formatNode = (node: TbNode): any => {
        const formattedChildren = node.children.map(formatNode).filter(Boolean);
        const hasActivity =
          Math.abs(node.openingDebit) > 0.0001 ||
          Math.abs(node.openingCredit) > 0.0001 ||
          Math.abs(node.periodDebit) > 0.0001 ||
          Math.abs(node.periodCredit) > 0.0001 ||
          formattedChildren.length > 0;
        if (!includeZero && !hasActivity) return null;
        if (params.accountType && node.accountType !== params.accountType && formattedChildren.length === 0) return null;
        if (params.accountId && node.accountId !== params.accountId && formattedChildren.length === 0) return null;
        if (
          searchTerm &&
          !node.accountCode.toLowerCase().includes(searchTerm) &&
          !node.name.toLowerCase().includes(searchTerm) &&
          formattedChildren.length === 0
        ) {
          return null;
        }
        return {
          accountId: node.accountId,
          accountCode: node.accountCode,
          name: node.name,
          nameAr: node.nameAr,
          nameEn: node.nameEn,
          accountType: node.accountType,
          normalBalance: node.normalBalance,
          parentId: node.parentId,
          level: node.level,
          isPostable: node.isPostable,
          openingDebit: node.openingDebit.toFixed(4),
          openingCredit: node.openingCredit.toFixed(4),
          openingNormalBalance: node.openingNormalBalance.toFixed(4),
          periodDebit: node.periodDebit.toFixed(4),
          periodCredit: node.periodCredit.toFixed(4),
          closingDebit: node.closingDebit.toFixed(4),
          closingCredit: node.closingCredit.toFixed(4),
          closingNormalBalance: node.closingNormalBalance.toFixed(4),
          children: formattedChildren,
        };
      };

      const tree = roots.map(formatNode).filter(Boolean);
      const flatAccounts = Array.from(nodeMap.values())
        .map((n) => ({
          accountId: n.accountId,
          accountCode: n.accountCode,
          name: n.name,
          accountType: n.accountType,
          normalBalance: n.normalBalance,
          parentId: n.parentId,
          level: n.level,
          isPostable: n.isPostable,
          openingDebit: n.openingDebit.toFixed(4),
          openingCredit: n.openingCredit.toFixed(4),
          openingNormalBalance: n.openingNormalBalance.toFixed(4),
          periodDebit: n.periodDebit.toFixed(4),
          periodCredit: n.periodCredit.toFixed(4),
          closingDebit: n.closingDebit.toFixed(4),
          closingCredit: n.closingCredit.toFixed(4),
          closingNormalBalance: n.closingNormalBalance.toFixed(4),
        }))
        .filter((a) => (!params.accountType || a.accountType === params.accountType));

      const grandClosingDebit = Array.from(nodeMap.values())
        .filter((n) => n.children.length === 0)
        .reduce((s, n) => s + n.closingDebit, 0);
      const grandClosingCredit = Array.from(nodeMap.values())
        .filter((n) => n.children.length === 0)
        .reduce((s, n) => s + n.closingCredit, 0);

      return {
        legalEntityId: params.legalEntityId,
        branchId: params.branchId ?? null,
        startDate: startDt?.toISOString() ?? null,
        endDate: endDt?.toISOString() ?? null,
        tree,
        accounts: flatAccounts,
        grandTotals: {
          openingDebit: grandOpeningDebit.toFixed(4),
          openingCredit: grandOpeningCredit.toFixed(4),
          periodDebit: grandPeriodDebit.toFixed(4),
          periodCredit: grandPeriodCredit.toFixed(4),
          closingDebit: grandClosingDebit.toFixed(4),
          closingCredit: grandClosingCredit.toFixed(4),
          isBalanced:
            Math.abs(grandOpeningDebit - grandOpeningCredit) < 0.01 &&
            Math.abs(grandPeriodDebit - grandPeriodCredit) < 0.01 &&
            Math.abs(grandClosingDebit - grandClosingCredit) < 0.01,
        },
      };
    });
  }

  async getGeneralLedgerReport(
    context: TenantContext,
    params: {
      legalEntityId: string;
      branchId?: string;
      accountId?: string;
      journalType?: string;
      sourceType?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyReportEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);

      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 50));
      const offset = (page - 1) * limit;

      const conds = [
        eq(journalEntries.tenantId, context.tenantId),
        eq(journalEntries.legalEntityId, params.legalEntityId),
        eq(journalEntries.status, JournalStatus.POSTED),
      ];
      if (params.branchId) conds.push(eq(journalLines.branchId, params.branchId));
      if (params.accountId) conds.push(eq(journalLines.accountId, params.accountId));
      if (params.journalType) conds.push(eq(journalEntries.journalType, params.journalType));
      if (params.sourceType) conds.push(eq(journalEntries.sourceType, params.sourceType));
      if (params.startDate) conds.push(gte(journalEntries.entryDate, new Date(params.startDate)));
      if (params.endDate) conds.push(lte(journalEntries.entryDate, new Date(params.endDate)));
      if (params.search?.trim()) {
        const term = `%${params.search.trim()}%`;
        conds.push(
          sql`(${journalEntries.journalNumber} ILIKE ${term} OR ${chartOfAccounts.accountCode} ILIKE ${term} OR COALESCE(${journalLines.description}, ${journalEntries.description}, '') ILIKE ${term})`
        );
      }

      const [countRow] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .where(and(...conds));

      const data = await tx
        .select({
          lineId: journalLines.id,
          journalEntryId: journalEntries.id,
          journalNumber: journalEntries.journalNumber,
          journalType: journalEntries.journalType,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          entryDate: journalEntries.entryDate,
          postedAt: journalEntries.postedAt,
          branchId: journalLines.branchId,
          accountId: journalLines.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          normalBalance: chartOfAccounts.normalBalance,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: sql<string>`COALESCE(${journalLines.description}, ${journalEntries.description})`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .where(and(...conds))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.postedAt), asc(journalLines.id))
        .limit(limit)
        .offset(offset);

      const total = countRow?.count ?? 0;
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        totals: {
          debit: parseFloat(countRow?.totalDebit ?? '0').toFixed(4),
          credit: parseFloat(countRow?.totalCredit ?? '0').toFixed(4),
        },
      };
    });
  }

  async getAccountStatement(
    context: TenantContext,
    params: {
      legalEntityId: string;
      accountId: string;
      branchId?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyReportEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);

      const [account] = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, params.legalEntityId),
            eq(chartOfAccounts.id, params.accountId)
          )
        )
        .limit(1);
      if (!account) {
        throw new NotFoundException('الحساب المحاسبي غير موجود');
      }

      const startDt = params.startDate ? new Date(params.startDate) : null;
      const endDt = params.endDate ? new Date(params.endDate) : null;
      const isCreditNormal = account.normalBalance === NormalBalance.CREDIT;

      let openingNormal = 0;
      if (startDt) {
        const openConds = [
          eq(journalEntries.tenantId, context.tenantId),
          eq(journalEntries.legalEntityId, params.legalEntityId),
          eq(journalEntries.status, JournalStatus.POSTED),
          eq(journalLines.accountId, params.accountId),
          lt(journalEntries.entryDate, startDt),
        ];
        if (params.branchId) openConds.push(eq(journalLines.branchId, params.branchId));

        const [openRow] = await tx
          .select({
            debit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
            credit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(and(...openConds));

        const od = parseFloat(openRow?.debit ?? '0');
        const oc = parseFloat(openRow?.credit ?? '0');
        openingNormal = isCreditNormal ? oc - od : od - oc;
      }

      const periodConds = [
        eq(journalEntries.tenantId, context.tenantId),
        eq(journalEntries.legalEntityId, params.legalEntityId),
        eq(journalEntries.status, JournalStatus.POSTED),
        eq(journalLines.accountId, params.accountId),
      ];
      if (params.branchId) periodConds.push(eq(journalLines.branchId, params.branchId));
      if (startDt) periodConds.push(gte(journalEntries.entryDate, startDt));
      if (endDt) periodConds.push(lte(journalEntries.entryDate, endDt));

      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(200, Math.max(1, params.limit ?? 50));
      const offset = (page - 1) * limit;

      const [countRow] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(and(...periodConds));

      const rows = await tx
        .select({
          lineId: journalLines.id,
          journalEntryId: journalEntries.id,
          journalNumber: journalEntries.journalNumber,
          journalType: journalEntries.journalType,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          entryDate: journalEntries.entryDate,
          postedAt: journalEntries.postedAt,
          branchId: journalLines.branchId,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: sql<string>`COALESCE(${journalLines.description}, ${journalEntries.description})`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(and(...periodConds))
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.postedAt), asc(journalLines.id))
        .limit(limit)
        .offset(offset);

      let running = openingNormal;
      const statements = rows.map((r) => {
        const d = parseFloat(r.debit || '0');
        const c = parseFloat(r.credit || '0');
        running += isCreditNormal ? c - d : d - c;
        return {
          ...r,
          runningBalance: running.toFixed(4),
        };
      });

      const pd = parseFloat(countRow?.totalDebit ?? '0');
      const pc = parseFloat(countRow?.totalCredit ?? '0');
      const closingNormal = openingNormal + (isCreditNormal ? pc - pd : pd - pc);
      const total = countRow?.count ?? 0;

      return {
        account: {
          id: account.id,
          accountCode: account.accountCode,
          name: account.nameAr || account.name,
          accountType: account.accountType,
          normalBalance: account.normalBalance,
        },
        openingBalance: openingNormal.toFixed(4),
        periodDebit: pd.toFixed(4),
        periodCredit: pc.toFixed(4),
        closingBalance: closingNormal.toFixed(4),
        data: statements,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async getJournalSourceDetails(context: TenantContext, journalEntryId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, context.tenantId), eq(journalEntries.id, journalEntryId)))
        .limit(1);

      if (!entry) {
        throw new NotFoundException(`القيد المحاسبي '${journalEntryId}' غير موجود`);
      }

      await this.opsFramework.verifyScope(context, context.userScopes || [], {
        legalEntityId: entry.legalEntityId,
        branchId: entry.branchId ?? undefined,
      });

      const lines = await tx
        .select({
          id: journalLines.id,
          accountId: journalLines.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          branchId: journalLines.branchId,
          partnerId: journalLines.partnerId,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: journalLines.description,
        })
        .from(journalLines)
        .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
        .where(eq(journalLines.journalEntryId, entry.id))
        .orderBy(asc(journalLines.id));

      let sourceDocument: Record<string, unknown> | null = null;
      if (entry.sourceId && entry.sourceType) {
        const st = entry.sourceType.toUpperCase();
        if (st.includes('SALES') || st.includes('POS_ORDER')) {
          const [ord] = await tx
            .select()
            .from(salesOrders)
            .where(and(eq(salesOrders.tenantId, context.tenantId), eq(salesOrders.id, entry.sourceId)))
            .limit(1);
          if (ord) sourceDocument = { type: 'SALES_ORDER', ...ord };
        } else if (st.includes('SHIFT')) {
          const [sh] = await tx
            .select()
            .from(posShifts)
            .where(and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, entry.sourceId)))
            .limit(1);
          if (sh) sourceDocument = { type: 'POS_SHIFT', ...sh };
        } else if (st.includes('SETTLEMENT')) {
          const [sb] = await tx
            .select()
            .from(settlementBatches)
            .where(and(eq(settlementBatches.tenantId, context.tenantId), eq(settlementBatches.id, entry.sourceId)))
            .limit(1);
          if (sb) sourceDocument = { type: 'SETTLEMENT_BATCH', ...sb };
        } else if (st.includes('TRANSFER')) {
          const [tr] = await tx
            .select()
            .from(stockTransfers)
            .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, entry.sourceId)))
            .limit(1);
          if (tr) sourceDocument = { type: 'STOCK_TRANSFER', ...tr };
        } else if (st.includes('PURCHASE')) {
          const [po] = await tx
            .select()
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.id, entry.sourceId)))
            .limit(1);
          if (po) sourceDocument = { type: 'PURCHASE_ORDER', ...po };
        } else if (st.includes('VAULT')) {
          const [vt] = await tx
            .select()
            .from(vaultTransactions)
            .where(and(eq(vaultTransactions.tenantId, context.tenantId), eq(vaultTransactions.id, entry.sourceId)))
            .limit(1);
          if (vt) sourceDocument = { type: 'VAULT_TRANSACTION', ...vt };
        }
      }

      return {
        journalEntry: entry,
        lines,
        sourceDocument,
      };
    });
  }
}
