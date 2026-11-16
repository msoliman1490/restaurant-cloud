import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { ReconciliationService } from '../src/modules/accounting/reconciliation.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  ReconciliationCategory,
  ReconciliationStatus,
  JournalType,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  accountMappings,
  journalEntries,
  journalLines,
  branches,
  legalEntities,
  cashVaults,
  bankAccounts,
  businessPartners,
  partnerBalances,
  devices,
  salesOrders,
  payments,
  settlementProviders,
  settlementBatches,
  settlementDiscrepancies,
  stockTransfers,
  stockTransferLines,
  items,
  unitsOfMeasure,
  warehouses,
  inventoryBalances,
  financialReconciliationRuns,
  financialReconciliationItems,
  auditLogs,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';

describe(
  'Restaurant Cloud — Phase 3.5: Financial Reconciliation & Reporting Engine',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let reconciliationService: ReconciliationService;
    let opsFramework: OperationsFrameworkService;

    let tenantId: string;
    let tenantBId: string;
    let le1Id: string;
    let le2Id: string;
    let branch1Id: string;
    let branch2Id: string;

    let ctxAdmin: TenantContext;
    let ctxTenantB: TenantContext;
    let ctxBranch1Only: TenantContext;

    const acc: Record<string, string> = {};
    let vaultId: string;
    let bankId: string;
    let sampleJournalEntryId: string;

    async function insertCoaNode(
      tx: any,
      leId: string,
      opts: {
        code: string;
        name: string;
        accountType: AccountType;
        normalBalance: NormalBalance;
        level: number;
        isPostable: boolean;
        parentId?: string | null;
      },
    ) {
      const [row] = await tx
        .insert(chartOfAccounts)
        .values({
          tenantId,
          legalEntityId: leId,
          accountCode: opts.code,
          name: opts.name,
          nameAr: opts.name,
          accountType: opts.accountType,
          normalBalance: opts.normalBalance,
          level: opts.level,
          isPostable: opts.isPostable,
          parentId: opts.parentId ?? null,
          status: 'ACTIVE',
        })
        .returning();
      return row;
    }

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
      tenantService = new TenantService(dbService, auditService);

      const suffix = Date.now().toString(36).slice(-6);
      const t1 = await tenantService.onboardTenant({
        code: `p35a-${suffix}`,
        displayName: `Phase 3.5 Alpha ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Alpha Foods Co',
          commercialName: 'Alpha Foods',
          vatNumber: '310999999900001',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR1',
          name: 'Main Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p35-admin-${suffix}@test.local`,
          displayName: 'P35 Admin',
          password: 'Password123!Secure',
        },
      } as any);

      tenantId = t1.tenant.id;
      le1Id = t1.legalEntity.id;
      branch1Id = t1.branch.id;
      ctxAdmin = {
        tenantId,
        userId: t1.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantId }],
      } as any;

      // Second branch + second legal entity under Tenant A
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [br2] = await tx
          .insert(branches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            code: 'BR2',
            name: 'Second Branch',
            businessType: 'RESTAURANT',
            isActive: true,
          })
          .returning();
        branch2Id = br2.id;

        const [le2] = await tx
          .insert(legalEntities)
          .values({
            tenantId,
            legalName: 'Beta Foods Co',
            commercialName: 'Beta Foods',
            vatNumber: '310999999900002',
            functionalCurrency: 'SAR',
            timezone: 'Asia/Riyadh',
            isActive: true,
          })
          .returning();
        le2Id = le2.id;
      });

      ctxBranch1Only = {
        tenantId,
        userId: t1.user.id,
        role: 'MANAGER',
        scopes: ['accounting:read'],
        userScopes: [{ scopeType: 'BRANCH', scopeEntityId: branch1Id }],
      } as any;

      // Tenant B for isolation tests
      const t2 = await tenantService.onboardTenant({
        code: `p35b-${suffix}`,
        displayName: `Phase 3.5 Beta ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Other Tenant Co',
          commercialName: 'Other Tenant',
          vatNumber: '310999999900003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'B1',
          name: 'Other Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p35-other-${suffix}@test.local`,
          displayName: 'Other Admin',
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

      // Build 3-level COA hierarchy for LE1
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const assets = await insertCoaNode(tx, le1Id, {
          code: '1000',
          name: 'Assets',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 1,
          isPostable: false,
        });
        const currentAssets = await insertCoaNode(tx, le1Id, {
          code: '1100',
          name: 'Current Assets',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 2,
          isPostable: false,
          parentId: assets.id,
        });

        const cashVaultAcc = await insertCoaNode(tx, le1Id, {
          code: '1101',
          name: 'Cash Vault',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const bankAcc = await insertCoaNode(tx, le1Id, {
          code: '1102',
          name: 'Bank Account',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const invAcc = await insertCoaNode(tx, le1Id, {
          code: '1103',
          name: 'Inventory',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const inTransitAcc = await insertCoaNode(tx, le1Id, {
          code: '1104',
          name: 'Inventory In Transit',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const arAcc = await insertCoaNode(tx, le1Id, {
          code: '1105',
          name: 'Accounts Receivable',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const cardClearingAcc = await insertCoaNode(tx, le1Id, {
          code: '1106',
          name: 'Card Clearing',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const aggSuspenseAcc = await insertCoaNode(tx, le1Id, {
          code: '1107',
          name: 'Aggregator Suspense',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const interBranchAcc = await insertCoaNode(tx, le1Id, {
          code: '1108',
          name: 'Inter-Branch Clearing',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });
        const dueFromAffAcc = await insertCoaNode(tx, le1Id, {
          code: '1109',
          name: 'Due From Affiliate',
          accountType: AccountType.ASSET,
          normalBalance: NormalBalance.DEBIT,
          level: 3,
          isPostable: true,
          parentId: currentAssets.id,
        });

        const liabilities = await insertCoaNode(tx, le1Id, {
          code: '2000',
          name: 'Liabilities',
          accountType: AccountType.LIABILITY,
          normalBalance: NormalBalance.CREDIT,
          level: 1,
          isPostable: false,
        });
        const apAcc = await insertCoaNode(tx, le1Id, {
          code: '2101',
          name: 'Accounts Payable',
          accountType: AccountType.LIABILITY,
          normalBalance: NormalBalance.CREDIT,
          level: 2,
          isPostable: true,
          parentId: liabilities.id,
        });
        const dueToAffAcc = await insertCoaNode(tx, le1Id, {
          code: '2102',
          name: 'Due To Affiliate',
          accountType: AccountType.LIABILITY,
          normalBalance: NormalBalance.CREDIT,
          level: 2,
          isPostable: true,
          parentId: liabilities.id,
        });

        const equity = await insertCoaNode(tx, le1Id, {
          code: '3000',
          name: 'Capital',
          accountType: AccountType.EQUITY,
          normalBalance: NormalBalance.CREDIT,
          level: 1,
          isPostable: true,
        });

        const revenue = await insertCoaNode(tx, le1Id, {
          code: '4000',
          name: 'Revenue',
          accountType: AccountType.REVENUE,
          normalBalance: NormalBalance.CREDIT,
          level: 1,
          isPostable: false,
        });
        const salesRevAcc = await insertCoaNode(tx, le1Id, {
          code: '4101',
          name: 'Sales Revenue',
          accountType: AccountType.REVENUE,
          normalBalance: NormalBalance.CREDIT,
          level: 2,
          isPostable: true,
          parentId: revenue.id,
        });

        acc.assets = assets.id;
        acc.currentAssets = currentAssets.id;
        acc.cashVault = cashVaultAcc.id;
        acc.bank = bankAcc.id;
        acc.inventory = invAcc.id;
        acc.inTransit = inTransitAcc.id;
        acc.ar = arAcc.id;
        acc.cardClearing = cardClearingAcc.id;
        acc.aggSuspense = aggSuspenseAcc.id;
        acc.interBranch = interBranchAcc.id;
        acc.dueFromAff = dueFromAffAcc.id;
        acc.liabilities = liabilities.id;
        acc.ap = apAcc.id;
        acc.dueToAff = dueToAffAcc.id;
        acc.equity = equity.id;
        acc.revenue = revenue.id;
        acc.salesRev = salesRevAcc.id;

        const mappings: Array<[DefaultAccountMappingKey, string]> = [
          [DefaultAccountMappingKey.CASH_VAULT, acc.cashVault],
          [DefaultAccountMappingKey.INVENTORY, acc.inventory],
          [DefaultAccountMappingKey.INVENTORY_IN_TRANSIT, acc.inTransit],
          [DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE, acc.ar],
          [DefaultAccountMappingKey.CARD_CLEARING, acc.cardClearing],
          [DefaultAccountMappingKey.AGGREGATOR_SUSPENSE, acc.aggSuspense],
          [DefaultAccountMappingKey.INTER_BRANCH_CLEARING, acc.interBranch],
          [DefaultAccountMappingKey.DUE_FROM_AFFILIATE, acc.dueFromAff],
          [DefaultAccountMappingKey.ACCOUNTS_PAYABLE, acc.ap],
          [DefaultAccountMappingKey.DUE_TO_AFFILIATE, acc.dueToAff],
        ];
        for (const [mappingKey, accountId] of mappings) {
          await tx.insert(accountMappings).values({
            tenantId,
            legalEntityId: le1Id,
            mappingKey,
            accountId,
            isActive: true,
          });
        }

        // Operational records matching GL balances
        const [v] = await tx
          .insert(cashVaults)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            code: 'V-MAIN',
            nameAr: 'الخزينة الرئيسية',
            nameEn: 'Main Vault',
            accountId: acc.cashVault,
            balance: '1000.0000',
            status: 'ACTIVE',
          })
          .returning();
        vaultId = v.id;

        const [b] = await tx
          .insert(bankAccounts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            bankName: 'AlRajhi',
            accountNumber: 'SA123456789',
            accountId: acc.bank,
            balance: '5000.0000',
            status: 'ACTIVE',
          })
          .returning();
        bankId = b.id;

        // Inventory operational balance: 2500.0000
        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({ tenantId, code: `KG-${suffix}`, nameEn: 'Kilogram', nameAr: 'كيلو', isBase: true })
          .returning();
        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            code: 'WH1',
            name: 'Main Warehouse',
            nameAr: 'المستودع الرئيسي',
          })
          .returning();
        const [itm] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: `SKU-${suffix}`,
            nameEn: 'Flour',
            nameAr: 'دقيق',
            baseUomId: uom.id,
            costingMethod: 'WEIGHTED_AVERAGE',
          })
          .returning();
        await tx.insert(inventoryBalances).values({
          tenantId,
          legalEntityOwnerId: le1Id,
          warehouseId: wh.id,
          itemId: itm.id,
          onHandQty: '100.0000',
          wacCost: '25.0000',
        });

        // AR Customer & AP Supplier operational balances
        const [cust] = await tx
          .insert(businessPartners)
          .values({
            tenantId,
            partnerNumber: `CUST-${suffix}`,
            partnerType: 'CORPORATE',
            legalNameAr: 'عميل شركة',
            legalNameEn: 'Corporate Client',
            isActive: true,
          })
          .returning();
        await tx.insert(partnerBalances).values({
          tenantId,
          legalEntityId: le1Id,
          partnerId: cust.id,
          customerBalance: '800.0000',
          customerUnallocatedReceipts: '0.0000',
          vendorBalance: '0.0000',
          vendorUnallocatedPayments: '0.0000',
        });

        const [supp] = await tx
          .insert(businessPartners)
          .values({
            tenantId,
            partnerNumber: `SUPP-${suffix}`,
            partnerType: 'CORPORATE',
            legalNameAr: 'مورد أغذية',
            legalNameEn: 'Food Supplier',
            isActive: true,
          })
          .returning();
        await tx.insert(partnerBalances).values({
          tenantId,
          legalEntityId: le1Id,
          partnerId: supp.id,
          customerBalance: '0.0000',
          customerUnallocatedReceipts: '0.0000',
          vendorBalance: '1200.0000',
          vendorUnallocatedPayments: '0.0000',
        });

        const [dev] = await tx
          .insert(devices)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            deviceCode: `POS-${suffix}`,
            name: 'POS Terminal 1',
          })
          .returning();
        const [ord] = await tx
          .insert(salesOrders)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            deviceId: dev.id,
            orderNumber: `ORD-${suffix}`,
            grandTotal: '750.0000',
          })
          .returning();

        // Settlement Providers (MADA Gateway + HUNGERSTATION Aggregator)
        await tx.insert(settlementProviders).values([
          {
            tenantId,
            legalEntityId: le1Id,
            code: 'MADA',
            nameAr: 'مدى',
            nameEn: 'Mada',
            category: 'PAYMENT_GATEWAY',
            clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
            feeMappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
            defaultBankAccountId: bankId,
            isActive: true,
          },
          {
            tenantId,
            legalEntityId: le1Id,
            code: 'HUNGERSTATION',
            nameAr: 'هنقرستيشن',
            nameEn: 'HungerStation',
            category: 'DELIVERY_AGGREGATOR',
            clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_SUSPENSE,
            feeMappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
            defaultBankAccountId: bankId,
            isActive: true,
          },
        ]);

        // Unsettled CARD payment (300) + AGGREGATOR payment (450)
        await tx.insert(payments).values([
          {
            tenantId,
            legalEntityId: le1Id,
            orderId: ord.id,
            paymentMethod: 'CARD',
            providerCode: 'MADA',
            amount: '300.0000',
            status: 'CAPTURED',
            settlementStatus: 'UNSETTLED',
            settledAmount: '0.0000',
          },
          {
            tenantId,
            legalEntityId: le1Id,
            orderId: ord.id,
            paymentMethod: 'AGGREGATOR',
            providerCode: 'HUNGERSTATION',
            amount: '450.0000',
            status: 'CAPTURED',
            settlementStatus: 'UNSETTLED',
            settledAmount: '0.0000',
          },
        ]);
      });

      // Fiscal period covering last month and current month
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      await accountingService.createFiscalPeriod(ctxAdmin, {
        legalEntityId: le1Id,
        periodName: `P35-${suffix}`,
        startDate: periodStart.toISOString(),
        endDate: periodEnd.toISOString(),
      });

      // Opening entry (dated 15 days ago — before currentMonthStart)
      const openingDate = new Date(now.getFullYear(), now.getMonth(), 1);
      openingDate.setDate(openingDate.getDate() - 5);

      const jeOpening = await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        entryDate: openingDate,
        journalNumber: `JV-OPEN-${suffix}`,
        journalType: JournalType.GENERAL,
        sourceType: 'MANUAL',
        sourceId: vaultId,
        description: 'Opening Capital & Balances',
        lines: [
          { accountId: acc.cashVault, debit: '1000.0000', credit: '0.0000' },
          { accountId: acc.bank, debit: '5000.0000', credit: '0.0000' },
          { accountId: acc.inventory, debit: '2500.0000', credit: '0.0000' },
          { accountId: acc.equity, debit: '0.0000', credit: '8500.0000' },
        ],
      });
      sampleJournalEntryId = jeOpening.id;

      // Period entry (dated today) for AR, AP, Card Clearing, Aggregator Suspense, Sales Revenue
      await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        entryDate: new Date(),
        journalNumber: `JV-PER-${suffix}`,
        journalType: JournalType.SALES,
        sourceType: 'MANUAL',
        sourceId: vaultId,
        description: 'Period Operational Postings',
        lines: [
          { accountId: acc.ar, debit: '800.0000', credit: '0.0000' },
          { accountId: acc.cardClearing, debit: '300.0000', credit: '0.0000' },
          { accountId: acc.aggSuspense, debit: '450.0000', credit: '0.0000' },
          { accountId: acc.inventory, debit: '1200.0000', credit: '0.0000' },
          { accountId: acc.ap, debit: '0.0000', credit: '1200.0000' },
          { accountId: acc.salesRev, debit: '0.0000', credit: '1550.0000' },
        ],
      });

      // Adjust inventory operational balance to 148 * 25 = 3700 so Inventory reconciles 100%
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(inventoryBalances)
          .set({ onHandQty: '148.0000' })
          .where(eq(inventoryBalances.tenantId, tenantId));
      });
    }, 60000);

    afterAll(async () => {
      await dbService.onModuleDestroy();
    });

    it('1-3. Hierarchical Trial Balance: balanced totals, opening/period/closing accuracy, no parent double counting', async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const tb = await accountingService.getHierarchicalTrialBalance(ctxAdmin, {
        legalEntityId: le1Id,
        startDate: monthStart,
        endDate: monthEnd,
        includeZeroBalances: false,
      });

      expect(tb.grandTotals.isBalanced).toBe(true);
      expect(parseFloat(tb.grandTotals.openingDebit)).toBeCloseTo(8500, 4);
      expect(parseFloat(tb.grandTotals.openingCredit)).toBeCloseTo(8500, 4);
      expect(parseFloat(tb.grandTotals.periodDebit)).toBeCloseTo(2750, 4);
      expect(parseFloat(tb.grandTotals.periodCredit)).toBeCloseTo(2750, 4);
      expect(parseFloat(tb.grandTotals.closingDebit)).toBeCloseTo(11250, 4);
      expect(parseFloat(tb.grandTotals.closingCredit)).toBeCloseTo(11250, 4);

      // Verify 3-level parent rollup without double counting:
      // Assets (1000) == Current Assets (1100) == 1000 + 5000 + 3700 + 800 + 300 + 450 = 11250
      const assetsNode = tb.tree.find((n: any) => n.accountCode === '1000');
      expect(assetsNode).toBeDefined();
      expect(parseFloat(assetsNode.closingDebit)).toBeCloseTo(11250, 4);
      expect(assetsNode.children.length).toBe(1);
      const currentAssetsNode = assetsNode.children[0];
      expect(currentAssetsNode.accountCode).toBe('1100');
      expect(parseFloat(currentAssetsNode.closingDebit)).toBeCloseTo(11250, 4);

      // Normal balance respect: Equity/AP/Sales Revenue appear on Credit side
      const eqNode = tb.tree.find((n: any) => n.accountCode === '3000');
      expect(parseFloat(eqNode.closingCredit)).toBeCloseTo(8500, 4);
      expect(parseFloat(eqNode.closingDebit)).toBe(0);
    });

    it('4. General Ledger, Account Statement, and Drill-Down to source document', async () => {
      const gl = await accountingService.getGeneralLedgerReport(ctxAdmin, {
        legalEntityId: le1Id,
        page: 1,
        limit: 25,
      });
      expect(gl.total).toBeGreaterThanOrEqual(10);
      expect(parseFloat(gl.totals.debit)).toBeCloseTo(parseFloat(gl.totals.credit), 4);

      const stmt = await accountingService.getAccountStatement(ctxAdmin, {
        legalEntityId: le1Id,
        accountId: acc.inventory,
        page: 1,
        limit: 25,
      });
      expect(parseFloat(stmt.closingBalance)).toBeCloseTo(3700, 4);
      expect(stmt.data.length).toBe(2);

      const drill = await accountingService.getJournalSourceDetails(ctxAdmin, sampleJournalEntryId);
      expect(drill.journalEntry.id).toBe(sampleJournalEntryId);
      expect(drill.lines.length).toBe(4);
    });

    it('5-8. Unified Reconciliation Engine: all categories match (0 discrepancies, no double-counting) + partial/full settlement, withheld, refund, inter-branch & idempotent audit', async () => {
      const preview = await reconciliationService.previewReconciliation(ctxAdmin, {
        legalEntityId: le1Id,
      });

      const byCat = (cat: ReconciliationCategory) =>
        preview.items.filter((i: any) => i.category === cat);

      expect(byCat(ReconciliationCategory.INVENTORY)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.CASH_VAULTS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.BANK_ACCOUNTS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.AR_CUSTOMERS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.AP_SUPPLIERS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.PAYMENT_GATEWAYS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.DELIVERY_AGGREGATORS)[0].status).toBe(ReconciliationStatus.MATCHED);
      expect(byCat(ReconciliationCategory.INTERCOMPANY_AFFILIATES)[0].status).toBe(ReconciliationStatus.MATCHED);

      // Verify CLEARING_ACCOUNTS: MADA (300) and HUNGERSTATION (450) are MATCHED (not false 0-target discrepancies)
      const clearingItems = byCat(ReconciliationCategory.CLEARING_ACCOUNTS);
      const cardClearingItem = clearingItems.find((i: any) => i.mappingKey === DefaultAccountMappingKey.CARD_CLEARING);
      const aggSuspenseItem = clearingItems.find((i: any) => i.mappingKey === DefaultAccountMappingKey.AGGREGATOR_SUSPENSE);
      const interBranchItem = clearingItems.find((i: any) => i.mappingKey === DefaultAccountMappingKey.INTER_BRANCH_CLEARING);
      expect(cardClearingItem.status).toBe(ReconciliationStatus.MATCHED);
      expect(parseFloat(cardClearingItem.operationalBalance)).toBeCloseTo(300, 4);
      expect(aggSuspenseItem.status).toBe(ReconciliationStatus.MATCHED);
      expect(parseFloat(aggSuspenseItem.operationalBalance)).toBeCloseTo(450, 4);
      expect(interBranchItem.status).toBe(ReconciliationStatus.MATCHED);
      expect(preview.summary.discrepancyCount).toBe(0);
      expect(parseFloat(preview.summary.totalVariance)).toBe(0);

      // Idempotent snapshot + audit log
      const idemKey = `p35-run-${Date.now()}`;
      const run1 = await reconciliationService.runReconciliation(ctxAdmin, {
        legalEntityId: le1Id,
        idempotencyKey: idemKey,
        notes: 'Initial clean run',
      });
      const run2 = await reconciliationService.runReconciliation(ctxAdmin, {
        legalEntityId: le1Id,
        idempotencyKey: idemKey,
      });
      expect(run2.run.id).toBe(run1.run.id);

      const logs = await dbService.withTenantContext(ctxAdmin, async (tx) => {
        return await tx
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, tenantId),
              eq(auditLogs.entityType, 'financial_reconciliation_run'),
              eq(auditLogs.entityId, run1.run.id),
            ),
          );
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // Partial settlement (100 of 300 on MADA) + GL credit 100 -> remains MATCHED at 200
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(payments)
          .set({ settledAmount: '100.0000', settlementStatus: 'PARTIALLY_SETTLED' })
          .where(and(eq(payments.tenantId, tenantId), eq(payments.providerCode, 'MADA')));
      });
      await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        entryDate: new Date(),
        journalNumber: `JV-PSET-${Date.now()}`,
        journalType: JournalType.GENERAL,
        sourceType: 'SETTLEMENT_BATCH',
        sourceId: bankId,
        description: 'Partial MADA settlement (100)',
        lines: [
          { accountId: acc.bank, debit: '100.0000', credit: '0.0000' },
          { accountId: acc.cardClearing, debit: '0.0000', credit: '100.0000' },
        ],
      });
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx.update(bankAccounts).set({ balance: '5100.0000' }).where(eq(bankAccounts.id, bankId));
      });

      const afterPartial = await reconciliationService.previewReconciliation(ctxAdmin, { legalEntityId: le1Id });
      const cardAfterPartial = afterPartial.items.find(
        (i: any) => i.category === ReconciliationCategory.CLEARING_ACCOUNTS && i.mappingKey === DefaultAccountMappingKey.CARD_CLEARING,
      );
      expect(cardAfterPartial.status).toBe(ReconciliationStatus.MATCHED);
      expect(parseFloat(cardAfterPartial.operationalBalance)).toBeCloseTo(200, 4);
      expect(parseFloat(cardAfterPartial.glBalance)).toBeCloseTo(200, 4);

      // Full settlement of remaining 200 (refund/reversal of remaining 200 or full settle) -> 0 and MATCHED
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(payments)
          .set({ settledAmount: '300.0000', settlementStatus: 'SETTLED' })
          .where(and(eq(payments.tenantId, tenantId), eq(payments.providerCode, 'MADA')));
      });
      await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        entryDate: new Date(),
        journalNumber: `JV-FSET-${Date.now()}`,
        journalType: JournalType.GENERAL,
        sourceType: 'SETTLEMENT_BATCH',
        sourceId: bankId,
        description: 'Full MADA settlement (200)',
        lines: [
          { accountId: acc.bank, debit: '200.0000', credit: '0.0000' },
          { accountId: acc.cardClearing, debit: '0.0000', credit: '200.0000' },
        ],
      });
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx.update(bankAccounts).set({ balance: '5300.0000' }).where(eq(bankAccounts.id, bankId));
      });

      // Aggregator settlement (450) with 50 WITHHELD_AMOUNT -> AGGREGATOR_SUSPENSE expected = 50, GL = 50 -> MATCHED without double-counting
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [prov] = await tx
          .select()
          .from(settlementProviders)
          .where(and(eq(settlementProviders.tenantId, tenantId), eq(settlementProviders.code, 'HUNGERSTATION')))
          .limit(1);
        const [batch] = await tx
          .insert(settlementBatches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            providerId: prov.id,
            settlementType: 'DELIVERY_AGGREGATOR',
            settlementDate: new Date(),
            bankAccountId: bankId,
            batchNumber: `SB-${Date.now()}`,
            status: 'POSTED',
            grossAmount: '450.0000',
            feeAmount: '0.0000',
            feeTaxAmount: '0.0000',
            withheldAmount: '50.0000',
            netExpectedAmount: '400.0000',
            bankReceivedAmount: '400.0000',
          })
          .returning();
        await tx.insert(settlementDiscrepancies).values({
          tenantId,
          legalEntityId: le1Id,
          branchId: branch1Id,
          batchId: batch.id,
          discrepancyType: 'WITHHELD_AMOUNT',
          sourceSystem: 'DELIVERY_AGGREGATOR',
          amount: '50.0000',
          description: 'Withheld reserve by HungerStation',
          status: 'OPEN',
        });
        await tx
          .update(payments)
          .set({ settledAmount: '450.0000', settlementStatus: 'SETTLED' })
          .where(and(eq(payments.tenantId, tenantId), eq(payments.providerCode, 'HUNGERSTATION')));
        await tx.update(bankAccounts).set({ balance: '5700.0000' }).where(eq(bankAccounts.id, bankId));
      });
      await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        entryDate: new Date(),
        journalNumber: `JV-AGG-${Date.now()}`,
        journalType: JournalType.GENERAL,
        sourceType: 'SETTLEMENT_BATCH',
        sourceId: bankId,
        description: 'HungerStation settlement (400 bank, 50 withheld)',
        lines: [
          { accountId: acc.bank, debit: '400.0000', credit: '0.0000' },
          { accountId: acc.aggSuspense, debit: '0.0000', credit: '400.0000' },
        ],
      });

      const afterAgg = await reconciliationService.previewReconciliation(ctxAdmin, { legalEntityId: le1Id });
      expect(afterAgg.summary.discrepancyCount).toBe(0);
      expect(parseFloat(afterAgg.summary.totalVariance)).toBe(0);
      const aggSuspAfter = afterAgg.items.find(
        (i: any) => i.category === ReconciliationCategory.CLEARING_ACCOUNTS && i.mappingKey === DefaultAccountMappingKey.AGGREGATOR_SUSPENSE,
      );
      expect(parseFloat(aggSuspAfter.operationalBalance)).toBeCloseTo(50, 4);
      expect(parseFloat(aggSuspAfter.glBalance)).toBeCloseTo(50, 4);
      expect(aggSuspAfter.status).toBe(ReconciliationStatus.MATCHED);
    });

    it('9. Discrepancy Detection WITHOUT Auto-Fix (Isolated Discrepancy Tenant): detects real GL/vault mismatch without double-counting or mutating data', async () => {
      // Isolated tenant dedicated to discrepancy detection so clean financial tenant remains untouched
      const suffix = `d${Date.now().toString(36).slice(-5)}`;
      const td = await tenantService.onboardTenant({
        code: `p35d-${suffix}`,
        displayName: `Phase 3.5 Discrepancy ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Discrepancy Test Co',
          commercialName: 'Discrepancy Test',
          vatNumber: '310777777700001',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: { code: 'BR1', name: 'Main Branch', businessType: 'RESTAURANT' as any },
        initialAdminUser: {
          email: `p35d-${suffix}@test.local`,
          displayName: 'Disc Admin',
          password: 'Password123!Secure',
        },
      } as any);
      const ctxDisc: TenantContext = {
        tenantId: td.tenant.id,
        userId: td.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: td.tenant.id }],
      } as any;

      let discVaultId = '';
      let discCardAccId = '';
      await dbService.withTenantContext(ctxDisc, async (tx) => {
        const [vAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: td.tenant.id,
            legalEntityId: td.legalEntity.id,
            accountCode: '1101',
            name: 'Cash Vault',
            nameAr: 'الخزينة',
            accountType: AccountType.ASSET,
            normalBalance: NormalBalance.DEBIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        const [cAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: td.tenant.id,
            legalEntityId: td.legalEntity.id,
            accountCode: '1106',
            name: 'Card Clearing',
            nameAr: 'مقاصة البطاقات',
            accountType: AccountType.ASSET,
            normalBalance: NormalBalance.DEBIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        const [eqAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: td.tenant.id,
            legalEntityId: td.legalEntity.id,
            accountCode: '3000',
            name: 'Capital',
            nameAr: 'رأس المال',
            accountType: AccountType.EQUITY,
            normalBalance: NormalBalance.CREDIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        discCardAccId = cAcc.id;

        await tx.insert(accountMappings).values([
          { tenantId: td.tenant.id, legalEntityId: td.legalEntity.id, mappingKey: DefaultAccountMappingKey.CASH_VAULT, accountId: vAcc.id, isActive: true },
          { tenantId: td.tenant.id, legalEntityId: td.legalEntity.id, mappingKey: DefaultAccountMappingKey.CARD_CLEARING, accountId: cAcc.id, isActive: true },
        ]);
        const [v] = await tx
          .insert(cashVaults)
          .values({
            tenantId: td.tenant.id,
            legalEntityId: td.legalEntity.id,
            branchId: td.branch.id,
            code: 'V-DISC',
            nameAr: 'خزينة الفحص',
            accountId: vAcc.id,
            balance: '1150.0000', // 150 higher than 1000 GL
            status: 'ACTIVE',
          })
          .returning();
        discVaultId = v.id;

        await tx.insert(settlementProviders).values({
          tenantId: td.tenant.id,
          legalEntityId: td.legalEntity.id,
          code: 'MADA',
          nameAr: 'مدى',
          nameEn: 'Mada',
          category: 'PAYMENT_GATEWAY',
          clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
          feeMappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
          isActive: true,
        });

        await postingEngine.postEntry(
          ctxDisc,
          {
            legalEntityId: td.legalEntity.id,
            branchId: td.branch.id,
            entryDate: new Date(),
            journalNumber: `JV-DISC-${suffix}`,
            journalType: JournalType.GENERAL,
            sourceType: 'MANUAL',
            sourceId: discVaultId,
            description: 'Vault 1000 + Unmatched Card Clearing 100',
            lines: [
              { accountId: vAcc.id, debit: '1000.0000', credit: '0.0000' },
              { accountId: cAcc.id, debit: '100.0000', credit: '0.0000' }, // Real GL discrepancy on 1106
              { accountId: eqAcc.id, debit: '0.0000', credit: '1100.0000' },
            ],
          },
          tx,
        );
      });

      const runWithVariance = await reconciliationService.runReconciliation(ctxDisc, {
        legalEntityId: td.legalEntity.id,
        idempotencyKey: `p35-disc-${suffix}`,
      });

      const vaultItem = runWithVariance.items.find((i: any) => i.category === ReconciliationCategory.CASH_VAULTS);
      expect(vaultItem.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(parseFloat(vaultItem.variance)).toBeCloseTo(150, 4);

      const cardClearingDisc = runWithVariance.items.find(
        (i: any) => i.category === ReconciliationCategory.CLEARING_ACCOUNTS && i.accountId === discCardAccId,
      );
      expect(cardClearingDisc.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(parseFloat(cardClearingDisc.variance)).toBeCloseTo(-100, 4);

      // Deduplication check: 150 (vault) + 100 (1106 reported once across PAYMENT_GATEWAYS & CLEARING_ACCOUNTS) = 250.0000
      expect(runWithVariance.run.discrepancyCount).toBe(2);
      expect(parseFloat(runWithVariance.run.totalVariance)).toBeCloseTo(250, 4);

      const unresolved = await reconciliationService.getUnresolvedDiscrepancies(ctxDisc, {
        legalEntityId: td.legalEntity.id,
        page: 1,
        limit: 25,
      });
      expect(unresolved.total).toBeGreaterThanOrEqual(2);

      // Confirm NO auto-fix mutated vault balance
      const [vaultAfter] = await dbService.withTenantContext(ctxDisc, async (tx) =>
        tx.select().from(cashVaults).where(eq(cashVaults.id, discVaultId)),
      );
      expect(parseFloat(vaultAfter.balance)).toBeCloseTo(1150, 4);
    });

    it('10. Tenant, Branch, and RLS Isolation on financial_reconciliation_runs & items', async () => {
      // Tenant B cannot see Tenant A's runs via service or RLS
      const tenantBRuns = await reconciliationService.getReconciliationRuns(ctxTenantB, {});
      expect(tenantBRuns.data.length).toBe(0);

      // Direct RLS verification under rc_app_user
      const rlsCount = await dbService.withTenantContext(ctxTenantB, async (tx) => {
        const rows = await tx.select().from(financialReconciliationItems);
        return rows.length;
      });
      expect(rlsCount).toBe(0);

      // Branch-scoped user cannot query whole legal entity or another branch
      await expect(
        reconciliationService.previewReconciliation(ctxBranch1Only, {
          legalEntityId: le1Id,
          branchId: branch2Id,
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        accountingService.getHierarchicalTrialBalance(ctxBranch1Only, {
          legalEntityId: le1Id,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('11. Server-side Pagination & Performance (Isolated Perf Tenant + Non-Operational Account Guard)', async () => {
      // Dedicated isolated performance tenant + non-operational accounts guard
      const suffix = `pf${Date.now().toString(36).slice(-5)}`;
      const tp = await tenantService.onboardTenant({
        code: `p35perf-${suffix}`,
        displayName: `Phase 3.5 Perf ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Perf Test Co',
          commercialName: 'Perf Test',
          vatNumber: '310666666600001',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: { code: 'BR1', name: 'Perf Branch', businessType: 'RESTAURANT' as any },
        initialAdminUser: {
          email: `p35perf-${suffix}@test.local`,
          displayName: 'Perf Admin',
          password: 'Password123!Secure',
        },
      } as any);
      const ctxPerf: TenantContext = {
        tenantId: tp.tenant.id,
        userId: tp.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tp.tenant.id }],
      } as any;

      await dbService.withTenantContext(ctxPerf, async (tx) => {
        const [perfDebitAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: tp.tenant.id,
            legalEntityId: tp.legalEntity.id,
            accountCode: '5991',
            name: 'Perf Test Expense',
            nameAr: 'مصروف اختبار الأداء',
            accountType: AccountType.EXPENSE,
            normalBalance: NormalBalance.DEBIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        const [perfCreditAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId: tp.tenant.id,
            legalEntityId: tp.legalEntity.id,
            accountCode: '4991',
            name: 'Perf Test Revenue',
            nameAr: 'إيراد اختبار الأداء',
            accountType: AccountType.REVENUE,
            normalBalance: NormalBalance.CREDIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();

        // Guard: Ensure performance test accounts are NOT linked to any operational vault, bank, or account mapping
        const linkedVaults = await tx.select().from(cashVaults).where(eq(cashVaults.accountId, perfDebitAcc.id));
        const linkedBanks = await tx.select().from(bankAccounts).where(eq(bankAccounts.accountId, perfDebitAcc.id));
        const linkedMappings = await tx.select().from(accountMappings).where(eq(accountMappings.accountId, perfDebitAcc.id));
        expect(linkedVaults.length).toBe(0);
        expect(linkedBanks.length).toBe(0);
        expect(linkedMappings.length).toBe(0);

        const now = new Date();
        const ts = Date.now();
        const insertedEntries = await tx
          .insert(journalEntries)
          .values(
            Array.from({ length: 60 }, (_, i) => ({
              tenantId: tp.tenant.id,
              legalEntityId: tp.legalEntity.id,
              branchId: tp.branch.id,
              journalNumber: `JV-PERF-${ts}-${i}`,
              journalType: JournalType.GENERAL,
              sourceType: 'PERF_TEST',
              sourceId: tp.legalEntity.id,
              description: `Isolated Perf Entry #${i + 1}`,
              entryDate: now,
              status: 'POSTED',
              debitTotal: '10.0000',
              creditTotal: '10.0000',
              createdBy: ctxPerf.userId,
              postedBy: ctxPerf.userId,
              postedAt: now,
            })),
          )
          .returning({ id: journalEntries.id });

        const linesBatch = insertedEntries.flatMap((je) => [
          {
            tenantId: tp.tenant.id,
            journalEntryId: je.id,
            accountId: perfDebitAcc.id,
            branchId: tp.branch.id,
            debit: '10.0000',
            credit: '0.0000',
            currency: 'SAR',
            description: 'Perf Debit',
          },
          {
            tenantId: tp.tenant.id,
            journalEntryId: je.id,
            accountId: perfCreditAcc.id,
            branchId: tp.branch.id,
            debit: '0.0000',
            credit: '10.0000',
            currency: 'SAR',
            description: 'Perf Credit',
          },
        ]);
        await tx.insert(journalLines).values(linesBatch);
      });

      const t0 = Date.now();
      const page1 = await accountingService.getGeneralLedgerReport(ctxPerf, {
        legalEntityId: tp.legalEntity.id,
        page: 1,
        limit: 25,
      });
      const page2 = await accountingService.getGeneralLedgerReport(ctxPerf, {
        legalEntityId: tp.legalEntity.id,
        page: 2,
        limit: 25,
      });
      const elapsedMs = Date.now() - t0;

      expect(page1.total).toBe(120);
      expect(page1.data.length).toBe(25);
      expect(page2.data.length).toBe(25);
      expect(page1.data[0].lineId).not.toBe(page2.data[0].lineId);
      expect(elapsedMs).toBeLessThan(5000);
    });
  },
);
