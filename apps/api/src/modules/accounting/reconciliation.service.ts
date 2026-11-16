import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  TenantContext,
  DefaultAccountMappingKey,
  JournalStatus,
  ReconciliationCategory,
  ReconciliationStatus,
  ReconciliationRunStatus,
  TransferDiscrepancyStatus,
  SettlementDiscrepancyStatus,
  PaymentSettlementStatus,
  PaymentStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  accountMappings,
  journalEntries,
  journalLines,
  cashVaults,
  vaultTransactions,
  bankAccounts,
  bankAccountBranchAccess,
  inventoryBalances,
  warehouses,
  stockTransfers,
  stockTransferLines,
  stockTransferDiscrepancies,
  partnerBalances,
  businessPartners,
  payments,
  salesOrders,
  settlementProviders,
  settlementBatches,
  settlementDiscrepancies,
  legalEntities,
  branches,
  financialReconciliationRuns,
  financialReconciliationItems,
} from '@restaurant-cloud/database';
import { eq, and, lte, desc, asc, sql, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';

export interface ReconciliationCheckItem {
  category: ReconciliationCategory;
  mappingKey: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  branchId: string | null;
  entityId: string | null;
  entityName: string;
  operationalBalance: string;
  glBalance: string;
  variance: string;
  status: ReconciliationStatus;
  varianceSource: string | null;
  referenceType: string | null;
  referenceId: string | null;
  lastReconciledAt: string;
  detailsJson?: Record<string, unknown>;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly opsFramework: OperationsFrameworkService
  ) {}

  private async verifyEntityAndBranchScope(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    branchId?: string
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
        .select({ id: branches.id, legalEntityId: branches.legalEntityId, name: branches.name })
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
        throw new ForbiddenException('المستخدم المقيد بفرع لا يمكنه استعراض بيانات المنشأة القانونية بالكامل دون تحديد الفرع المصرح به.');
      }
    }
    return le;
  }

  private async resolveMappingAccount(
    tx: any,
    tenantId: string,
    legalEntityId: string,
    mappingKey: string,
    branchId?: string
  ) {
    // 1. Branch-specific override
    if (branchId) {
      const [brMap] = await tx
        .select({
          accountId: accountMappings.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          normalBalance: chartOfAccounts.normalBalance,
        })
        .from(accountMappings)
        .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(accountMappings.tenantId, tenantId),
            eq(accountMappings.legalEntityId, legalEntityId),
            eq(accountMappings.branchId, branchId),
            eq(accountMappings.mappingKey, mappingKey),
            eq(accountMappings.isActive, true)
          )
        )
        .limit(1);
      if (brMap) return brMap;
    }

    // 2. Legal entity default
    const [leMap] = await tx
      .select({
        accountId: accountMappings.accountId,
        accountCode: chartOfAccounts.accountCode,
        accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
        normalBalance: chartOfAccounts.normalBalance,
      })
      .from(accountMappings)
      .innerJoin(chartOfAccounts, eq(accountMappings.accountId, chartOfAccounts.id))
      .where(
        and(
          eq(accountMappings.tenantId, tenantId),
          eq(accountMappings.legalEntityId, legalEntityId),
          isNull(accountMappings.branchId),
          eq(accountMappings.mappingKey, mappingKey),
          eq(accountMappings.isActive, true)
        )
      )
      .limit(1);

    return leMap ?? null;
  }

  private async getGlAccountBalance(
    tx: any,
    tenantId: string,
    legalEntityId: string,
    accountId: string,
    asOfDate: Date,
    branchId?: string,
    creditNormal = false
  ): Promise<number> {
    const conds = [
      eq(journalEntries.tenantId, tenantId),
      eq(journalEntries.legalEntityId, legalEntityId),
      eq(journalEntries.status, JournalStatus.POSTED),
      lte(journalEntries.entryDate, asOfDate),
      eq(journalLines.accountId, accountId),
    ];
    if (branchId) {
      conds.push(eq(journalLines.branchId, branchId));
    }

    const [row] = await tx
      .select({
        debit: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
        credit: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(...conds));

    const d = parseFloat(row?.debit ?? '0');
    const c = parseFloat(row?.credit ?? '0');
    return creditNormal ? c - d : d - c;
  }

  private buildItem(
    params: {
      category: ReconciliationCategory;
      mappingKey?: string | null;
      account?: { accountId: string; accountCode: string; accountName: string } | null;
      branchId?: string | null;
      entityId?: string | null;
      entityName: string;
      operationalBalance: number;
      glBalance: number;
      varianceSource?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
      nowIso: string;
      detailsJson?: Record<string, unknown>;
      notConfigured?: boolean;
    }
  ): ReconciliationCheckItem {
    const variance = params.operationalBalance - params.glBalance;
    const isMatched = !params.notConfigured && Math.abs(variance) <= 0.005;
    const status = params.notConfigured
      ? ReconciliationStatus.NOT_CONFIGURED
      : isMatched
      ? ReconciliationStatus.MATCHED
      : ReconciliationStatus.DISCREPANCY;

    return {
      category: params.category,
      mappingKey: params.mappingKey ?? null,
      accountId: params.account?.accountId ?? null,
      accountCode: params.account?.accountCode ?? null,
      accountName: params.account?.accountName ?? null,
      branchId: params.branchId ?? null,
      entityId: params.entityId ?? null,
      entityName: params.entityName,
      operationalBalance: params.operationalBalance.toFixed(4),
      glBalance: params.glBalance.toFixed(4),
      variance: variance.toFixed(4),
      status,
      varianceSource:
        status === ReconciliationStatus.MATCHED
          ? null
          : params.varianceSource ?? 'فرق بين الرصيد التشغيلي ورصيد الأستاذ العام يتطلب المراجعة',
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      lastReconciledAt: params.nowIso,
      detailsJson: params.detailsJson,
    };
  }

  private async computeReconciliationItems(
    tx: any,
    context: TenantContext,
    params: {
      legalEntityId: string;
      branchId?: string;
      asOfDate?: Date;
      category?: ReconciliationCategory;
    }
  ): Promise<ReconciliationCheckItem[]> {
    const asOfDate = params.asOfDate ?? new Date();
    const nowIso = new Date().toISOString();
    const itemsList: ReconciliationCheckItem[] = [];
    const want = (cat: ReconciliationCategory) => !params.category || params.category === cat;

    // 1. INVENTORY (Warehouse Operational Stock Value vs GL INVENTORY)
    if (want(ReconciliationCategory.INVENTORY)) {
      const invAcc = await this.resolveMappingAccount(
        tx,
        context.tenantId,
        params.legalEntityId,
        DefaultAccountMappingKey.INVENTORY,
        params.branchId
      );
      const whConds = [
        eq(inventoryBalances.tenantId, context.tenantId),
        eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
      ];
      if (params.branchId) {
        whConds.push(eq(warehouses.branchId, params.branchId));
      }
      const whRows = await tx
        .select({
          warehouseId: warehouses.id,
          warehouseName: sql<string>`COALESCE(${warehouses.name}, ${warehouses.code})`,
          branchId: warehouses.branchId,
          opValue: sql<string>`COALESCE(SUM(CAST(${inventoryBalances.onHandQty} AS NUMERIC) * CAST(${inventoryBalances.wacCost} AS NUMERIC)), 0)::text`,
        })
        .from(inventoryBalances)
        .innerJoin(warehouses, eq(inventoryBalances.warehouseId, warehouses.id))
        .where(and(...whConds))
        .groupBy(warehouses.id, warehouses.name, warehouses.code, warehouses.branchId);

      const totalOpInv = whRows.reduce((s: number, r: any) => s + parseFloat(r.opValue || '0'), 0);
      const glInv = invAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, invAcc.accountId, asOfDate, params.branchId)
        : 0;

      itemsList.push(
        this.buildItem({
          category: ReconciliationCategory.INVENTORY,
          mappingKey: DefaultAccountMappingKey.INVENTORY,
          account: invAcc,
          branchId: params.branchId ?? null,
          entityId: params.legalEntityId,
          entityName: params.branchId ? 'مخزون مستودعات الفرع' : 'إجمالي مخزون المستودعات',
          operationalBalance: totalOpInv,
          glBalance: glInv,
          notConfigured: !invAcc,
          varianceSource: !invAcc
            ? 'حساب INVENTORY غير مربوط في Account Mapping'
            : Math.abs(totalOpInv - glInv) > 0.005
            ? 'فرق بين تقييم المخزون التشغيلي (inventory_balances) ورصيد حساب المخزون في GL (قد يعود لحركات افتتاحية أو تسويات غير مرحلة)'
            : null,
          referenceType: 'WAREHOUSE_INVENTORY',
          nowIso,
          detailsJson: { warehouses: whRows },
        })
      );
    }

    // 2. INVENTORY_IN_TRANSIT & INTER_BRANCH_TRANSFERS
    if (want(ReconciliationCategory.INVENTORY_IN_TRANSIT) || want(ReconciliationCategory.INTER_BRANCH_TRANSFERS)) {
      const inTransitAcc = await this.resolveMappingAccount(
        tx,
        context.tenantId,
        params.legalEntityId,
        DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
        params.branchId
      );
      const trConds = [
        eq(stockTransfers.tenantId, context.tenantId),
        eq(stockTransfers.legalEntityId, params.legalEntityId),
        inArray(stockTransfers.status, ['DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY']),
      ];
      if (params.branchId) {
        trConds.push(eq(stockTransfers.sourceBranchId, params.branchId));
      }

      const openTransfers = await tx
        .select({
          transferId: stockTransfers.id,
          transferNumber: stockTransfers.transferNumber,
          status: stockTransfers.status,
          transferType: stockTransfers.transferType,
          inTransitVal: sql<string>`COALESCE(SUM(GREATEST(0, CAST(${stockTransferLines.dispatchedQuantity} AS NUMERIC) - COALESCE(CAST(${stockTransferLines.receivedQuantity} AS NUMERIC), 0) - CAST(${stockTransferLines.damagedQuantity} AS NUMERIC) - CAST(${stockTransferLines.lostQuantity} AS NUMERIC)) * CAST(${stockTransferLines.unitCost} AS NUMERIC)), 0)::text`,
        })
        .from(stockTransfers)
        .innerJoin(stockTransferLines, eq(stockTransferLines.transferId, stockTransfers.id))
        .where(and(...trConds))
        .groupBy(stockTransfers.id, stockTransfers.transferNumber, stockTransfers.status, stockTransfers.transferType);

      const openDiscRows = await tx
        .select({
          id: stockTransferDiscrepancies.id,
          transferId: stockTransferDiscrepancies.transferId,
          totalValue: stockTransferDiscrepancies.totalValue,
        })
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.tenantId, context.tenantId),
            eq(stockTransferDiscrepancies.legalEntityId, params.legalEntityId),
            inArray(stockTransferDiscrepancies.status, [TransferDiscrepancyStatus.OPEN, TransferDiscrepancyStatus.UNDER_REVIEW])
          )
        );

      const opInTransit = openTransfers.reduce((s: number, r: any) => s + parseFloat(r.inTransitVal || '0'), 0);
      const openDiscVal = openDiscRows.reduce((s: number, r: any) => s + parseFloat(r.totalValue || '0'), 0);
      const glInTransit = inTransitAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, inTransitAcc.accountId, asOfDate, params.branchId)
        : 0;

      if (want(ReconciliationCategory.INVENTORY_IN_TRANSIT)) {
        itemsList.push(
          this.buildItem({
            category: ReconciliationCategory.INVENTORY_IN_TRANSIT,
            mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
            account: inTransitAcc,
            branchId: params.branchId ?? null,
            entityId: params.legalEntityId,
            entityName: 'مخزون في الطريق (قيد النقل)',
            operationalBalance: opInTransit + openDiscVal,
            glBalance: glInTransit,
            notConfigured: !inTransitAcc,
            varianceSource: !inTransitAcc
              ? 'حساب INVENTORY_IN_TRANSIT غير مربوط'
              : Math.abs(opInTransit + openDiscVal - glInTransit) > 0.005
              ? `يوجد ${openTransfers.length} مناقلات قيد النقل و${openDiscRows.length} فروقات مفتوحة لا تطابق رصيد GL`
              : null,
            referenceType: 'STOCK_TRANSFER',
            referenceId: openTransfers[0]?.transferId ?? null,
            nowIso,
            detailsJson: {
              openTransfersCount: openTransfers.length,
              openTransfersValue: opInTransit.toFixed(4),
              openDiscrepanciesCount: openDiscRows.length,
              openDiscrepanciesValue: openDiscVal.toFixed(4),
            },
          })
        );
      }

      if (want(ReconciliationCategory.INTER_BRANCH_TRANSFERS)) {
        itemsList.push(
          this.buildItem({
            category: ReconciliationCategory.INTER_BRANCH_TRANSFERS,
            mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
            account: inTransitAcc,
            branchId: params.branchId ?? null,
            entityId: params.legalEntityId,
            entityName: 'التحويلات المفتوحة بين الفروع والمستودعات',
            operationalBalance: opInTransit + openDiscVal,
            glBalance: glInTransit,
            notConfigured: !inTransitAcc,
            varianceSource:
              Math.abs(opInTransit + openDiscVal - glInTransit) > 0.005
                ? 'عدم تطابق قيمة التحويلات المفتوحة مع رصيد المخزون في الطريق'
                : null,
            referenceType: 'STOCK_TRANSFER',
            referenceId: openTransfers[0]?.transferId ?? null,
            nowIso,
            detailsJson: { openTransfers },
          })
        );
      }
    }

    // 3. CASH_VAULTS (per vault)
    if (want(ReconciliationCategory.CASH_VAULTS)) {
      const vaultConds = [eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.legalEntityId, params.legalEntityId)];
      if (params.branchId) vaultConds.push(eq(cashVaults.branchId, params.branchId));

      const vaults = await tx
        .select({
          id: cashVaults.id,
          code: cashVaults.code,
          nameAr: cashVaults.nameAr,
          nameEn: cashVaults.nameEn,
          branchId: cashVaults.branchId,
          accountId: cashVaults.accountId,
          balance: cashVaults.balance,
          accountCode: chartOfAccounts.accountCode,
          accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
        })
        .from(cashVaults)
        .innerJoin(chartOfAccounts, eq(cashVaults.accountId, chartOfAccounts.id))
        .where(and(...vaultConds));

      for (const v of vaults) {
        const opBal = parseFloat(v.balance || '0');
        const glBal = await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, v.accountId, asOfDate, v.branchId ?? undefined);
        itemsList.push(
          this.buildItem({
            category: ReconciliationCategory.CASH_VAULTS,
            mappingKey: DefaultAccountMappingKey.CASH_VAULT,
            account: { accountId: v.accountId, accountCode: v.accountCode, accountName: v.accountName },
            branchId: v.branchId ?? null,
            entityId: v.id,
            entityName: `خزينة: ${v.nameAr || v.nameEn || v.code}`,
            operationalBalance: opBal,
            glBalance: glBal,
            varianceSource:
              Math.abs(opBal - glBal) > 0.005
                ? `فرق بين رصيد الخزينة '${v.code}' وحساب الأستاذ العام المرتبط '${v.accountCode}'`
                : null,
            referenceType: 'CASH_VAULT',
            referenceId: v.id,
            nowIso,
          })
        );
      }
    }

    // 4. BANK_ACCOUNTS (per bank account)
    if (want(ReconciliationCategory.BANK_ACCOUNTS)) {
      const bankConds = [eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.legalEntityId, params.legalEntityId)];
      let banks: any[];
      if (params.branchId) {
        banks = await tx
          .select({
            id: bankAccounts.id,
            bankName: bankAccounts.bankName,
            accountNumber: bankAccounts.accountNumber,
            accountId: bankAccounts.accountId,
            balance: bankAccounts.balance,
            accountCode: chartOfAccounts.accountCode,
            accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          })
          .from(bankAccounts)
          .innerJoin(bankAccountBranchAccess, eq(bankAccountBranchAccess.bankAccountId, bankAccounts.id))
          .innerJoin(chartOfAccounts, eq(bankAccounts.accountId, chartOfAccounts.id))
          .where(and(...bankConds, eq(bankAccountBranchAccess.branchId, params.branchId)));
      } else {
        banks = await tx
          .select({
            id: bankAccounts.id,
            bankName: bankAccounts.bankName,
            accountNumber: bankAccounts.accountNumber,
            accountId: bankAccounts.accountId,
            balance: bankAccounts.balance,
            accountCode: chartOfAccounts.accountCode,
            accountName: sql<string>`COALESCE(${chartOfAccounts.nameAr}, ${chartOfAccounts.name})`,
          })
          .from(bankAccounts)
          .innerJoin(chartOfAccounts, eq(bankAccounts.accountId, chartOfAccounts.id))
          .where(and(...bankConds));
      }

      for (const b of banks) {
        const opBal = parseFloat(b.balance || '0');
        const glBal = await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, b.accountId, asOfDate);
        itemsList.push(
          this.buildItem({
            category: ReconciliationCategory.BANK_ACCOUNTS,
            mappingKey: 'BANK_ACCOUNT',
            account: { accountId: b.accountId, accountCode: b.accountCode, accountName: b.accountName },
            branchId: params.branchId ?? null,
            entityId: b.id,
            entityName: `بنك: ${b.bankName} (${b.accountNumber})`,
            operationalBalance: opBal,
            glBalance: glBal,
            varianceSource:
              Math.abs(opBal - glBal) > 0.005
                ? `فرق بين رصيد الحساب البنكي '${b.accountNumber}' وحساب الأستاذ العام '${b.accountCode}'`
                : null,
            referenceType: 'BANK_ACCOUNT',
            referenceId: b.id,
            nowIso,
          })
        );
      }
    }

    // 5. AR_CUSTOMERS
    if (want(ReconciliationCategory.AR_CUSTOMERS)) {
      const arAcc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE, params.branchId);
      const [arRow] = await tx
        .select({
          totalAr: sql<string>`COALESCE(SUM(CAST(${partnerBalances.customerBalance} AS NUMERIC) - CAST(${partnerBalances.customerUnallocatedReceipts} AS NUMERIC)), 0)::text`,
        })
        .from(partnerBalances)
        .where(and(eq(partnerBalances.tenantId, context.tenantId), eq(partnerBalances.legalEntityId, params.legalEntityId)));

      const opAr = parseFloat(arRow?.totalAr ?? '0');
      const glAr = arAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, arAcc.accountId, asOfDate, params.branchId)
        : 0;

      itemsList.push(
        this.buildItem({
          category: ReconciliationCategory.AR_CUSTOMERS,
          mappingKey: DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE,
          account: arAcc,
          branchId: params.branchId ?? null,
          entityId: params.legalEntityId,
          entityName: 'ذمم العملاء المدينة (AR Subledger vs GL)',
          operationalBalance: opAr,
          glBalance: glAr,
          notConfigured: !arAcc,
          varianceSource: !arAcc
            ? 'حساب ACCOUNTS_RECEIVABLE غير مربوط'
            : Math.abs(opAr - glAr) > 0.005
            ? 'فرق بين دفتر العملاء المساعد (partner_balances) وحساب الذمم المدينة في الأستاذ العام'
            : null,
          referenceType: 'PARTNER_AR',
          nowIso,
        })
      );
    }

    // 6. AP_SUPPLIERS
    if (want(ReconciliationCategory.AP_SUPPLIERS)) {
      const apAcc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, DefaultAccountMappingKey.ACCOUNTS_PAYABLE, params.branchId);
      const [apRow] = await tx
        .select({
          totalAp: sql<string>`COALESCE(SUM(CAST(${partnerBalances.vendorBalance} AS NUMERIC) - CAST(${partnerBalances.vendorUnallocatedPayments} AS NUMERIC)), 0)::text`,
        })
        .from(partnerBalances)
        .where(and(eq(partnerBalances.tenantId, context.tenantId), eq(partnerBalances.legalEntityId, params.legalEntityId)));

      const opAp = parseFloat(apRow?.totalAp ?? '0');
      const glAp = apAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, apAcc.accountId, asOfDate, params.branchId, true)
        : 0;

      itemsList.push(
        this.buildItem({
          category: ReconciliationCategory.AP_SUPPLIERS,
          mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
          account: apAcc,
          branchId: params.branchId ?? null,
          entityId: params.legalEntityId,
          entityName: 'ذمم الموردين الدائنة (AP Subledger vs GL)',
          operationalBalance: opAp,
          glBalance: glAp,
          notConfigured: !apAcc,
          varianceSource: !apAcc
            ? 'حساب ACCOUNTS_PAYABLE غير مربوط'
            : Math.abs(opAp - glAp) > 0.005
            ? 'فرق بين دفتر الموردين المساعد (partner_balances) وحساب الذمم الدائنة في الأستاذ العام'
            : null,
          referenceType: 'PARTNER_AP',
          nowIso,
        })
      );
    }

    // 7. PAYMENT_GATEWAYS & 8. DELIVERY_AGGREGATORS
    const providerOpByAccountId = new Map<string, number>();
    if (want(ReconciliationCategory.PAYMENT_GATEWAYS) || want(ReconciliationCategory.DELIVERY_AGGREGATORS) || want(ReconciliationCategory.CLEARING_ACCOUNTS)) {
      const providers = await tx
        .select()
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.legalEntityId, params.legalEntityId),
            eq(settlementProviders.isActive, true)
          )
        );

      for (const p of providers) {
        const isGateway = p.category === 'PAYMENT_GATEWAY';
        const cat = isGateway ? ReconciliationCategory.PAYMENT_GATEWAYS : ReconciliationCategory.DELIVERY_AGGREGATORS;

        const clearAcc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, p.clearingMappingKey, params.branchId);
        const payConds = [
          eq(payments.tenantId, context.tenantId),
          eq(payments.legalEntityId, params.legalEntityId),
          eq(payments.status, PaymentStatus.CAPTURED),
          inArray(payments.settlementStatus, [PaymentSettlementStatus.UNSETTLED, PaymentSettlementStatus.PARTIALLY_SETTLED]),
          eq(payments.providerCode, p.code),
        ];
        if (params.branchId) {
          payConds.push(eq(salesOrders.branchId, params.branchId));
        }

        const [unsettledRow] = await tx
          .select({
            unsettled: sql<string>`COALESCE(SUM(GREATEST(0, CAST(${payments.amount} AS NUMERIC) - CAST(${payments.settledAmount} AS NUMERIC))), 0)::text`,
          })
          .from(payments)
          .innerJoin(salesOrders, eq(payments.orderId, salesOrders.id))
          .where(and(...payConds));

        // Add open WITHHELD_AMOUNT discrepancies for this provider (posted to clearing/suspense account)
        const withheldConds = [
          eq(settlementDiscrepancies.tenantId, context.tenantId),
          eq(settlementDiscrepancies.legalEntityId, params.legalEntityId),
          eq(settlementBatches.providerId, p.id),
          eq(settlementDiscrepancies.discrepancyType, 'WITHHELD_AMOUNT'),
          inArray(settlementDiscrepancies.status, [SettlementDiscrepancyStatus.OPEN, SettlementDiscrepancyStatus.UNDER_REVIEW]),
        ];
        if (params.branchId) {
          withheldConds.push(eq(settlementDiscrepancies.branchId, params.branchId));
        }
        const [withheldRow] = await tx
          .select({
            withheld: sql<string>`COALESCE(SUM(CAST(${settlementDiscrepancies.amount} AS NUMERIC)), 0)::text`,
          })
          .from(settlementDiscrepancies)
          .innerJoin(settlementBatches, eq(settlementDiscrepancies.batchId, settlementBatches.id))
          .where(and(...withheldConds));

        const opUnsettled = parseFloat(unsettledRow?.unsettled ?? '0') + parseFloat(withheldRow?.withheld ?? '0');
        if (clearAcc) {
          providerOpByAccountId.set(clearAcc.accountId, (providerOpByAccountId.get(clearAcc.accountId) ?? 0) + opUnsettled);
        }
        if (!want(cat)) continue;

        const glClear = clearAcc
          ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, clearAcc.accountId, asOfDate, params.branchId)
          : 0;

        itemsList.push(
          this.buildItem({
            category: cat,
            mappingKey: p.clearingMappingKey,
            account: clearAcc,
            branchId: params.branchId ?? null,
            entityId: p.id,
            entityName: `${isGateway ? 'بوابة دفع' : 'تطبيق توصيل'}: ${p.nameAr || p.nameEn}`,
            operationalBalance: opUnsettled,
            glBalance: glClear,
            notConfigured: !clearAcc,
            varianceSource: !clearAcc
              ? `حساب التسوية '${p.clearingMappingKey}' غير مربوط`
              : Math.abs(opUnsettled - glClear) > 0.005
              ? `فرق بين المتحصلات غير المسواة للمزود '${p.code}' ورصيد حساب '${clearAcc.accountCode}'`
              : null,
            referenceType: 'SETTLEMENT_PROVIDER',
            referenceId: p.id,
            nowIso,
          })
        );
      }
    }

    // 9. CLEARING_ACCOUNTS (INTER_BRANCH_CLEARING, CARD_CLEARING, AGGREGATOR_SUSPENSE)
    if (want(ReconciliationCategory.CLEARING_ACCOUNTS)) {
      const clearingKeys = [
        DefaultAccountMappingKey.INTER_BRANCH_CLEARING,
        DefaultAccountMappingKey.CARD_CLEARING,
        DefaultAccountMappingKey.AGGREGATOR_SUSPENSE,
      ];
      for (const key of clearingKeys) {
        const acc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, key, params.branchId);
        if (!acc) continue;
        const glBal = await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, acc.accountId, asOfDate, params.branchId);

        let expectedOp = 0;
        if (key === DefaultAccountMappingKey.CARD_CLEARING || key === DefaultAccountMappingKey.AGGREGATOR_SUSPENSE) {
          const methodFilter = key === DefaultAccountMappingKey.CARD_CLEARING ? 'CARD' : 'AGGREGATOR';
          const fallbackPayConds = [
            eq(payments.tenantId, context.tenantId),
            eq(payments.legalEntityId, params.legalEntityId),
            eq(payments.status, PaymentStatus.CAPTURED),
            inArray(payments.settlementStatus, [PaymentSettlementStatus.UNSETTLED, PaymentSettlementStatus.PARTIALLY_SETTLED]),
            eq(payments.paymentMethod, methodFilter),
          ];
          if (params.branchId) {
            fallbackPayConds.push(eq(salesOrders.branchId, params.branchId));
          }
          const [methodRow] = await tx
            .select({
              unsettled: sql<string>`COALESCE(SUM(GREATEST(0, CAST(${payments.amount} AS NUMERIC) - CAST(${payments.settledAmount} AS NUMERIC))), 0)::text`,
            })
            .from(payments)
            .innerJoin(salesOrders, eq(payments.orderId, salesOrders.id))
            .where(and(...fallbackPayConds));

          let withheldTotal = 0;
          if (key === DefaultAccountMappingKey.AGGREGATOR_SUSPENSE) {
            const whConds = [
              eq(settlementDiscrepancies.tenantId, context.tenantId),
              eq(settlementDiscrepancies.legalEntityId, params.legalEntityId),
              eq(settlementDiscrepancies.discrepancyType, 'WITHHELD_AMOUNT'),
              inArray(settlementDiscrepancies.status, [SettlementDiscrepancyStatus.OPEN, SettlementDiscrepancyStatus.UNDER_REVIEW]),
            ];
            if (params.branchId) {
              whConds.push(eq(settlementDiscrepancies.branchId, params.branchId));
            }
            const [whRow] = await tx
              .select({
                withheld: sql<string>`COALESCE(SUM(CAST(${settlementDiscrepancies.amount} AS NUMERIC)), 0)::text`,
              })
              .from(settlementDiscrepancies)
              .where(and(...whConds));
            withheldTotal = parseFloat(whRow?.withheld ?? '0');
          }

          const providerSum = providerOpByAccountId.get(acc.accountId) ?? 0;
          const methodSum = parseFloat(methodRow?.unsettled ?? '0') + withheldTotal;
          // Use provider-aggregated sum when providers are mapped to this account, otherwise paymentMethod fallback
          expectedOp = providerSum > 0 ? providerSum : methodSum;
        }

        itemsList.push(
          this.buildItem({
            category: ReconciliationCategory.CLEARING_ACCOUNTS,
            mappingKey: key,
            account: acc,
            branchId: params.branchId ?? null,
            entityId: acc.accountId,
            entityName: `حساب مقاصة: ${acc.accountName} (${acc.accountCode})`,
            operationalBalance: expectedOp,
            glBalance: glBal,
            varianceSource:
              Math.abs(expectedOp - glBal) > 0.005
                ? `فرق في حساب المقاصة '${acc.accountCode}': المتوقع (${expectedOp.toFixed(4)}) مقابل GL (${glBal.toFixed(4)})`
                : null,
            referenceType: 'CHART_OF_ACCOUNTS',
            referenceId: acc.accountId,
            nowIso,
          })
        );
      }
    }

    // 10. INTERCOMPANY_AFFILIATES (DUE_FROM_AFFILIATE vs DUE_TO_AFFILIATE across tenant)
    if (want(ReconciliationCategory.INTERCOMPANY_AFFILIATES)) {
      const dueFromAcc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, DefaultAccountMappingKey.DUE_FROM_AFFILIATE, params.branchId);
      const dueToAcc = await this.resolveMappingAccount(tx, context.tenantId, params.legalEntityId, DefaultAccountMappingKey.DUE_TO_AFFILIATE, params.branchId);

      const dueFromBal = dueFromAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, dueFromAcc.accountId, asOfDate, params.branchId)
        : 0;
      const dueToBal = dueToAcc
        ? await this.getGlAccountBalance(tx, context.tenantId, params.legalEntityId, dueToAcc.accountId, asOfDate, params.branchId, true)
        : 0;

      // Cross-entity tenant symmetry check (when user has access or tenant-level view)
      const [tenantDueFrom] = await tx
        .select({
          net: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC) - CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
        })
        .from(accountMappings)
        .innerJoin(journalLines, eq(accountMappings.accountId, journalLines.accountId))
        .innerJoin(journalEntries, and(eq(journalLines.journalEntryId, journalEntries.id), eq(journalEntries.status, JournalStatus.POSTED)))
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.mappingKey, DefaultAccountMappingKey.DUE_FROM_AFFILIATE),
            eq(accountMappings.isActive, true)
          )
        );

      const [tenantDueTo] = await tx
        .select({
          net: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC) - CAST(${journalLines.debit} AS NUMERIC)), 0)::text`,
        })
        .from(accountMappings)
        .innerJoin(journalLines, eq(accountMappings.accountId, journalLines.accountId))
        .innerJoin(journalEntries, and(eq(journalLines.journalEntryId, journalEntries.id), eq(journalEntries.status, JournalStatus.POSTED)))
        .where(
          and(
            eq(accountMappings.tenantId, context.tenantId),
            eq(accountMappings.mappingKey, DefaultAccountMappingKey.DUE_TO_AFFILIATE),
            eq(accountMappings.isActive, true)
          )
        );

      const tFrom = parseFloat(tenantDueFrom?.net ?? '0');
      const tTo = parseFloat(tenantDueTo?.net ?? '0');

      itemsList.push(
        this.buildItem({
          category: ReconciliationCategory.INTERCOMPANY_AFFILIATES,
          mappingKey: DefaultAccountMappingKey.DUE_FROM_AFFILIATE,
          account: dueFromAcc ?? dueToAcc,
          branchId: params.branchId ?? null,
          entityId: params.legalEntityId,
          entityName: 'تطابق حسابات المنشآت الشقيقة (Due From vs Due To)',
          operationalBalance: tFrom,
          glBalance: tTo,
          notConfigured: !dueFromAcc && !dueToAcc,
          varianceSource:
            Math.abs(tFrom - tTo) > 0.005
              ? `عدم تطابق إجمالي المستحق من المنشآت الشقيقة (${tFrom.toFixed(4)}) مع المستحق للمنشآت الشقيقة (${tTo.toFixed(4)})`
              : null,
          referenceType: 'INTERCOMPANY_LEDGER',
          nowIso,
          detailsJson: {
            entityDueFrom: dueFromBal.toFixed(4),
            entityDueTo: dueToBal.toFixed(4),
            tenantTotalDueFrom: tFrom.toFixed(4),
            tenantTotalDueTo: tTo.toFixed(4),
          },
        })
      );
    }

    return itemsList;
  }

  private summarizeItems(items: ReconciliationCheckItem[]) {
    const matchedCount = items.filter((i) => i.status === ReconciliationStatus.MATCHED).length;
    const notConfiguredCount = items.filter((i) => i.status === ReconciliationStatus.NOT_CONFIGURED).length;

    // Deduplicate clearing/provider discrepancies sharing the same GL accountId across
    // PAYMENT_GATEWAYS, DELIVERY_AGGREGATORS, and CLEARING_ACCOUNTS so the same variance
    // is never counted twice in discrepancyCount or totalVariance.
    const providerReportedAccountIds = new Set(
      items
        .filter(
          (i) =>
            (i.category === ReconciliationCategory.PAYMENT_GATEWAYS ||
              i.category === ReconciliationCategory.DELIVERY_AGGREGATORS) &&
            i.accountId
        )
        .map((i) => i.accountId as string)
    );

    const nonDuplicateItems = items.filter(
      (i) =>
        !(
          i.category === ReconciliationCategory.CLEARING_ACCOUNTS &&
          i.accountId &&
          providerReportedAccountIds.has(i.accountId)
        )
    );

    const discrepancyCount = nonDuplicateItems.filter((i) => i.status === ReconciliationStatus.DISCREPANCY).length;
    const totalVariance = nonDuplicateItems.reduce((s, i) => s + Math.abs(parseFloat(i.variance)), 0);

    return {
      totalChecks: items.length,
      matchedCount,
      discrepancyCount,
      notConfiguredCount,
      totalVariance: totalVariance.toFixed(4),
    };
  }

  async previewReconciliation(
    context: TenantContext,
    params: {
      legalEntityId: string;
      branchId?: string;
      asOfDate?: string;
      category?: ReconciliationCategory;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);
      const asOfDate = params.asOfDate ? new Date(params.asOfDate) : new Date();
      const items = await this.computeReconciliationItems(tx, context, {
        legalEntityId: params.legalEntityId,
        branchId: params.branchId,
        asOfDate,
        category: params.category,
      });

      return {
        legalEntityId: params.legalEntityId,
        branchId: params.branchId ?? null,
        asOfDate: asOfDate.toISOString(),
        summary: this.summarizeItems(items),
        items,
      };
    });
  }

  async runReconciliation(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      branchId?: string;
      asOfDate?: string;
      category?: ReconciliationCategory;
      idempotencyKey?: string;
      notes?: string;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityAndBranchScope(tx, context, dto.legalEntityId, dto.branchId);

      if (dto.idempotencyKey) {
        const [existingRun] = await tx
          .select()
          .from(financialReconciliationRuns)
          .where(
            and(
              eq(financialReconciliationRuns.tenantId, context.tenantId),
              eq(financialReconciliationRuns.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);
        if (existingRun) {
          const existingItems = await tx
            .select()
            .from(financialReconciliationItems)
            .where(eq(financialReconciliationItems.runId, existingRun.id))
            .orderBy(asc(financialReconciliationItems.category), asc(financialReconciliationItems.entityName));
          return { run: existingRun, items: existingItems };
        }
      }

      const asOfDate = dto.asOfDate ? new Date(dto.asOfDate) : new Date();
      const computed = await this.computeReconciliationItems(tx, context, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
        asOfDate,
        category: dto.category,
      });

      const summary = this.summarizeItems(computed);

      const runNumber = `RECON-${Date.now().toString(36).toUpperCase()}`;
      const [run] = await tx
        .insert(financialReconciliationRuns)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId ?? null,
          runNumber,
          asOfDate,
          status: ReconciliationRunStatus.COMPLETED,
          totalChecks: summary.totalChecks,
          matchedCount: summary.matchedCount,
          discrepancyCount: summary.discrepancyCount,
          notConfiguredCount: summary.notConfiguredCount,
          totalVariance: summary.totalVariance,
          executedBy: context.userId,
          idempotencyKey: dto.idempotencyKey ?? null,
          notes: dto.notes ?? null,
        })
        .returning();

      let insertedItems: any[] = [];
      if (computed.length > 0 && run) {
        insertedItems = await tx
          .insert(financialReconciliationItems)
          .values(
            computed.map((item) => ({
              runId: run.id,
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              branchId: item.branchId ?? null,
              category: item.category,
              mappingKey: item.mappingKey,
              accountId: item.accountId,
              accountCode: item.accountCode,
              accountName: item.accountName,
              entityId: item.entityId,
              entityName: item.entityName,
              operationalBalance: item.operationalBalance,
              glBalance: item.glBalance,
              variance: item.variance,
              status: item.status,
              varianceSource: item.varianceSource,
              referenceType: item.referenceType,
              referenceId: item.referenceId,
              lastReconciledAt: new Date(item.lastReconciledAt),
              detailsJson: item.detailsJson ?? null,
            }))
          )
          .returning();
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'FINANCIAL_RECONCILIATION_RUN',
          entityType: 'financial_reconciliation_run',
          entityId: run!.id,
          afterState: {
            runNumber,
            legalEntityId: dto.legalEntityId,
            totalChecks: summary.totalChecks,
            discrepancyCount: summary.discrepancyCount,
            totalVariance: summary.totalVariance,
          },
        },
        tx
      );

      return { run, items: insertedItems };
    });
  }

  async getReconciliationRuns(
    context: TenantContext,
    params: { legalEntityId?: string; branchId?: string; page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (params.legalEntityId) {
        await this.verifyEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);
      }

      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 20));
      const offset = (page - 1) * limit;

      const conds = [eq(financialReconciliationRuns.tenantId, context.tenantId)];
      if (params.legalEntityId) conds.push(eq(financialReconciliationRuns.legalEntityId, params.legalEntityId));
      if (params.branchId) conds.push(eq(financialReconciliationRuns.branchId, params.branchId));

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(financialReconciliationRuns)
        .where(and(...conds));

      const data = await tx
        .select()
        .from(financialReconciliationRuns)
        .where(and(...conds))
        .orderBy(desc(financialReconciliationRuns.createdAt))
        .limit(limit)
        .offset(offset);

      const total = countRow?.count ?? 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getReconciliationItems(
    context: TenantContext,
    params: {
      runId?: string;
      legalEntityId?: string;
      category?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (params.legalEntityId) {
        await this.verifyEntityAndBranchScope(tx, context, params.legalEntityId);
      }

      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [eq(financialReconciliationItems.tenantId, context.tenantId)];
      if (params.runId) conds.push(eq(financialReconciliationItems.runId, params.runId));
      if (params.legalEntityId) conds.push(eq(financialReconciliationItems.legalEntityId, params.legalEntityId));
      if (params.category) conds.push(eq(financialReconciliationItems.category, params.category));
      if (params.status) conds.push(eq(financialReconciliationItems.status, params.status));
      if (params.search) {
        const term = `%${params.search.trim()}%`;
        conds.push(
          sql`(${financialReconciliationItems.entityName} ILIKE ${term} OR COALESCE(${financialReconciliationItems.accountCode}, '') ILIKE ${term} OR COALESCE(${financialReconciliationItems.varianceSource}, '') ILIKE ${term})`
        );
      }

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(financialReconciliationItems)
        .where(and(...conds));

      const data = await tx
        .select()
        .from(financialReconciliationItems)
        .where(and(...conds))
        .orderBy(desc(financialReconciliationItems.createdAt), asc(financialReconciliationItems.category))
        .limit(limit)
        .offset(offset);

      const total = countRow?.count ?? 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getUnresolvedDiscrepancies(
    context: TenantContext,
    params: { legalEntityId: string; branchId?: string; search?: string; page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityAndBranchScope(tx, context, params.legalEntityId, params.branchId);

      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const term = params.search?.trim() ? `%${params.search.trim()}%` : null;

      // Combine live reconciliation discrepancies + open stock transfer discrepancies + open settlement discrepancies via SQL UNION ALL
      const unionQuery = sql`
        SELECT * FROM (
          SELECT
            std.id::text AS id,
            'STOCK_TRANSFER_DISCREPANCY'::text AS source_domain,
            std.discrepancy_type::text AS discrepancy_type,
            std.total_value::numeric(18,4)::text AS amount,
            std.status::text AS status,
            COALESCE(std.notes, 'فرق استلام مناقلة مخزنية') AS description,
            st.transfer_number::text AS reference_number,
            std.transfer_id::text AS reference_id,
            std.created_at AS created_at
          FROM stock_transfer_discrepancies std
          JOIN stock_transfers st ON st.id = std.transfer_id
          WHERE std.tenant_id = ${context.tenantId}::uuid
            AND std.legal_entity_id = ${params.legalEntityId}::uuid
            AND std.status IN ('OPEN', 'UNDER_REVIEW')
          UNION ALL
          SELECT
            sd.id::text AS id,
            'SETTLEMENT_DISCREPANCY'::text AS source_domain,
            sd.discrepancy_type::text AS discrepancy_type,
            sd.amount::numeric(18,4)::text AS amount,
            sd.status::text AS status,
            COALESCE(sd.description, 'فرق تسوية بوابة دفع أو تطبيق توصيل') AS description,
            sd.id::text AS reference_number,
            sd.batch_id::text AS reference_id,
            sd.created_at AS created_at
          FROM settlement_discrepancies sd
          WHERE sd.tenant_id = ${context.tenantId}::uuid
            AND sd.legal_entity_id = ${params.legalEntityId}::uuid
            AND sd.status IN ('OPEN', 'UNDER_REVIEW')
          UNION ALL
          SELECT
            fri.id::text AS id,
            'RECONCILIATION_DISCREPANCY'::text AS source_domain,
            fri.category::text AS discrepancy_type,
            fri.variance::numeric(18,4)::text AS amount,
            fri.status::text AS status,
            COALESCE(fri.variance_source, fri.entity_name) AS description,
            COALESCE(fri.account_code, fri.category)::text AS reference_number,
            fri.run_id::text AS reference_id,
            fri.created_at AS created_at
          FROM financial_reconciliation_items fri
          JOIN financial_reconciliation_runs frr ON frr.id = fri.run_id
          WHERE fri.tenant_id = ${context.tenantId}::uuid
            AND frr.legal_entity_id = ${params.legalEntityId}::uuid
            AND fri.status = 'DISCREPANCY'
            AND frr.id = (
              SELECT id FROM financial_reconciliation_runs
              WHERE tenant_id = ${context.tenantId}::uuid
                AND legal_entity_id = ${params.legalEntityId}::uuid
              ORDER BY created_at DESC
              LIMIT 1
            )
        ) combined
        ${term ? sql`WHERE (combined.description ILIKE ${term} OR combined.reference_number ILIKE ${term} OR combined.discrepancy_type ILIKE ${term})` : sql``}
      `;

      const countRes = await tx.execute(sql`SELECT COUNT(*)::int AS cnt FROM (${unionQuery}) q`);
      const rowsRes = await tx.execute(
        sql`SELECT * FROM (${unionQuery}) q ORDER BY q.created_at DESC LIMIT ${limit} OFFSET ${offset}`
      );

      const total = Number((countRes as any)?.[0]?.cnt ?? 0);
      return {
        data: rowsRes as any[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }
}
