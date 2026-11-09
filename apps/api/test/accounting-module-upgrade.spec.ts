import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { PartnersService } from '../src/modules/partners/partners.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalType,
  JournalStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  journalEntries,
  journalLines,
  cashVaults,
  bankAccounts,
} from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Accounting Module UX & Functional Upgrade Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let accountingService: AccountingService;
  let partnersService: PartnersService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;

  let rootAssetId: string;
  let bankAccountId: string;
  let vaultAccountId: string;
  let arAccountId: string;
  let salesAccountId: string;
  let discountAccountId: string;
  let vatOutputAccountId: string;

  let testVaultId: string;
  let testBankId: string;
  let testPartnerId: string;

  const tenantCode = `acc-upg-${Date.now().toString(36).slice(-6)}`;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    postingEngine = new PostingEngineService(dbService, auditService);
    accountingService = new AccountingService(dbService, auditService, postingEngine);
    partnersService = new PartnersService(dbService, auditService);

    // 1. Provision Test Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: 'مجموعة التطوير المحاسبي المتقدم',
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الإدارة المالية المتقدمة',
        commercialName: 'الإدارة المالية',
        vatNumber: '31099887700005',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-ACC-01',
        name: 'الفرع المالي التجريبي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `cfo-${tenantCode}@restaurantcloud.sa`,
        displayName: 'المدير المالي التنفيذي',
        password: 'Password123!',
      },
    });

    legalEntityId = tenantResult.legalEntity.id;
    branchId = tenantResult.branch.id;

    tenantContext = {
      tenantId: tenantResult.tenant.id,
      userId: tenantResult.user.id,
      legalEntityId,
      branchId,
      scopes: ['*'],
      permissions: ['*'],
      roles: ['TENANT_OWNER'],
    };

    // 2. Setup Chart of Accounts hierarchy
    // Root Asset Header (Summary, isPostable = false)
    const rootAsset = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '100000',
      name: 'الأصول المتداولة (Parent Group)',
      nameAr: 'الأصول المتداولة',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: false,
    });
    rootAssetId = rootAsset.id;

    // Bank Account (Postable, child of 100000)
    const bank = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111101',
      name: 'البنك الأهلي التجاري',
      nameAr: 'البنك الأهلي التجاري',
      parentId: rootAssetId,
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    bankAccountId = bank.id;

    // Vault Account (Postable, child of 100000)
    const vault = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111201',
      name: 'الخزينة النقدية الرئيسية',
      nameAr: 'الخزينة النقدية الرئيسية',
      parentId: rootAssetId,
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    vaultAccountId = vault.id;

    // AR Control Account (113000)
    const ar = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '113000',
      name: 'مراقبة الذمم المدينة (العملاء)',
      nameAr: 'مراقبة الذمم المدينة',
      parentId: rootAssetId,
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    arAccountId = ar.id;

    // Revenue, Discount, VAT accounts
    const sales = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '411000',
      name: 'إيرادات المبيعات',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    salesAccountId = sales.id;

    const discount = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '412000',
      name: 'خصم مسموح به',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    discountAccountId = discount.id;

    const vat = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '212000',
      name: 'ضريبة القيمة المضافة للمخرجات',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    vatOutputAccountId = vat.id;

    // 3. Vault & Bank entities
    const vaultRecord = await accountingService.createCashVault(tenantContext, {
      legalEntityId,
      branchId,
      code: 'VLT-TEST-01',
      name: 'الخزينة المركزية',
      nameAr: 'الخزينة المركزية',
      accountId: vaultAccountId,
      openingBalance: '50000.0000',
    });
    testVaultId = vaultRecord.id;

    const bankRecord = await accountingService.createBankAccount(tenantContext, {
      legalEntityId,
      code: 'BNK-TEST-01',
      bankName: 'مصرف الراجحي',
      accountNumber: 'SA9980000123456789012399',
      accountId: bankAccountId,
      currency: 'SAR',
      openingBalance: '100000.0000',
    });
    testBankId = bankRecord.id;

    // 4. Partner
    const partner = await partnersService.createPartner(tenantContext, {
      partnerNumber: `BP-ACC-${Date.now().toString().slice(-4)}`,
      partnerType: 'CORPORATE',
      legalNameAr: 'شركة الضيافة والتغذية المحدودة',
      roles: ['CUSTOMER'],
    });
    testPartnerId = partner.id;
  }, 90000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  // ==================================================================
  // Scenario 1: Multi-Line Journal Entry with 4 lines
  // ==================================================================
  it('TEST-01: Posts Multi-Line Balanced Journal Entry (4 lines: Debit Cash, Debit Discount, Credit Sales, Credit VAT)', async () => {
    // 4 Lines:
    // 1. Debit: Vault Cash (9,200 SAR)
    // 2. Debit: Cash Discount (800 SAR)
    // 3. Credit: Sales Revenue (8,695.65 SAR)
    // 4. Credit: VAT Output (1,304.35 SAR)
    // Total Debits = 10,000 | Total Credits = 10,000 (Balanced)
    const jvNumber = `JV-MULTI-${Date.now().toString().slice(-6)}`;
    const result = await accountingService.createJournalEntry(tenantContext, {
      legalEntityId,
      branchId,
      journalNumber: jvNumber,
      journalType: JournalType.GENERAL,
      sourceType: 'MANUAL',
      description: 'قيد مبيعات مركب متعدد الأسطر مع خصم مسموح به وضريبة',
      status: JournalStatus.POSTED,
      lines: [
        {
          accountId: vaultAccountId,
          debit: '9200.0000',
          credit: '0.0000',
          description: 'المبلغ المقبوض نقداً',
        },
        {
          accountId: discountAccountId,
          debit: '800.0000',
          credit: '0.0000',
          description: 'خصم تعجيل دفع تجاري',
        },
        {
          accountId: salesAccountId,
          debit: '0.0000',
          credit: '8695.6522',
          description: 'إيراد المبيعات الخاضع للضريبة',
        },
        {
          accountId: vatOutputAccountId,
          debit: '0.0000',
          credit: '1304.3478',
          description: 'ضريبة القيمة المضافة 15%',
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.status).toBe('POSTED');
    expect(parseFloat(result.debitTotal)).toBeCloseTo(10000, 2);
    expect(parseFloat(result.creditTotal)).toBeCloseTo(10000, 2);

    // Verify 4 lines stored in database
    const lines = await dbService.withTenantContext(tenantContext, async (tx) => {
      return await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, result.id));
    });
    expect(lines.length).toBe(4);
  });

  // ==================================================================
  // Scenario 2: Draft Journal Entry Lifecycle (Create, Update, Delete)
  // ==================================================================
  it('TEST-02: Draft Journal Lifecycle: saves in-progress draft, updates lines, and deletes draft safely', async () => {
    const draftNumber = `DRAFT-JV-${Date.now().toString().slice(-6)}`;

    // 1. Create Draft with temporary unbalanced amounts
    const draft = await accountingService.createJournalEntry(tenantContext, {
      legalEntityId,
      branchId,
      journalNumber: draftNumber,
      journalType: JournalType.GENERAL,
      description: 'مسودة قيد قيد الإعداد',
      status: JournalStatus.DRAFT,
      lines: [
        {
          accountId: bankAccountId,
          debit: '5000.0000',
          credit: '0.0000',
          description: 'سطر مسودة 1',
        },
        {
          accountId: salesAccountId,
          debit: '0.0000',
          credit: '4000.0000', // Unbalanced in draft is allowed
          description: 'سطر مسودة 2',
        },
      ],
    });

    expect(draft.id).toBeDefined();
    expect(draft.status).toBe('DRAFT');

    // 2. Update Draft lines
    const updated = await accountingService.updateDraftJournalEntry(tenantContext, draft.id, {
      description: 'مسودة قيد معدلة بعد المراجعة',
      lines: [
        {
          accountId: bankAccountId,
          debit: '5000.0000',
          credit: '0.0000',
        },
        {
          accountId: salesAccountId,
          debit: '0.0000',
          credit: '5000.0000',
        },
      ],
    });

    expect(updated.description).toBe('مسودة قيد معدلة بعد المراجعة');
    expect(parseFloat(updated.creditTotal)).toBe(5000);

    // 3. Delete Draft
    const deleteRes = await accountingService.deleteDraftJournalEntry(tenantContext, draft.id);
    expect(deleteRes.success).toBe(true);

    // Verify gone
    const inDb = await dbService.withTenantContext(tenantContext, async (tx) => {
      return await tx.select().from(journalEntries).where(eq(journalEntries.id, draft.id)).limit(1);
    });
    expect(inDb.length).toBe(0);
  });

  // ==================================================================
  // Scenario 3: Double-Entry Balance Enforcement
  // ==================================================================
  it('TEST-03: Strictly rejects posting an unbalanced journal entry', async () => {
    const badJvNumber = `JV-UNBAL-${Date.now().toString().slice(-6)}`;

    await expect(
      accountingService.createJournalEntry(tenantContext, {
        legalEntityId,
        branchId,
        journalNumber: badJvNumber,
        journalType: JournalType.GENERAL,
        status: JournalStatus.POSTED,
        lines: [
          {
            accountId: vaultAccountId,
            debit: '1000.0000',
            credit: '0.0000',
          },
          {
            accountId: salesAccountId,
            debit: '0.0000',
            credit: '900.0000', // 100 SAR discrepancy!
          },
        ],
      })
    ).rejects.toThrow(/غير متوازن/);
  });

  // ==================================================================
  // Scenario 4: Rejection of Posting to Summary Group Account (isPostable = false)
  // ==================================================================
  it('TEST-04: Strictly rejects posting directly to group/summary account (isPostable = false)', async () => {
    const jvNumber = `JV-GRP-${Date.now().toString().slice(-6)}`;

    await expect(
      accountingService.createJournalEntry(tenantContext, {
        legalEntityId,
        branchId,
        journalNumber: jvNumber,
        journalType: JournalType.GENERAL,
        status: JournalStatus.POSTED,
        lines: [
          {
            accountId: rootAssetId, // Summary account!
            debit: '1000.0000',
            credit: '0.0000',
          },
          {
            accountId: salesAccountId,
            debit: '0.0000',
            credit: '1000.0000',
          },
        ],
      })
    ).rejects.toThrow(/لا يمكن الترحيل/);
  });

  // ==================================================================
  // Scenario 5: Control Account Guard (AR 113000 requires partnerId)
  // ==================================================================
  it('TEST-05: Strictly requires partnerId when posting to AR Control (113000)', async () => {
    const jvNumber = `JV-AR-NBP-${Date.now().toString().slice(-6)}`;

    // 1. Without partnerId: fails
    await expect(
      accountingService.createJournalEntry(tenantContext, {
        legalEntityId,
        branchId,
        journalNumber: jvNumber,
        journalType: JournalType.GENERAL,
        status: JournalStatus.POSTED,
        lines: [
          {
            accountId: arAccountId, // 113000 AR Control
            debit: '3000.0000',
            credit: '0.0000',
            // No partnerId!
          },
          {
            accountId: salesAccountId,
            debit: '0.0000',
            credit: '3000.0000',
          },
        ],
      })
    ).rejects.toThrow(/محمي ويتطلب تحديد الطرف التجاري/);

    // 2. With partnerId: succeeds
    const successJvNumber = `JV-AR-WBP-${Date.now().toString().slice(-6)}`;
    const ok = await accountingService.createJournalEntry(tenantContext, {
      legalEntityId,
      branchId,
      journalNumber: successJvNumber,
      journalType: JournalType.GENERAL,
      status: JournalStatus.POSTED,
      lines: [
        {
          accountId: arAccountId,
          partnerId: testPartnerId,
          partnerRole: 'CUSTOMER',
          debit: '3000.0000',
          credit: '0.0000',
        },
        {
          accountId: salesAccountId,
          debit: '0.0000',
          credit: '3000.0000',
        },
      ],
    });

    expect(ok).toBeDefined();
    expect(ok.status).toBe('POSTED');
  });

  // ==================================================================
  // Scenario 6: COA Tree Rollup & Hierarchy
  // ==================================================================
  it('TEST-06: COA Hierarchy aggregates balances of child accounts to summary parent node', async () => {
    const hierarchy = await accountingService.getChartOfAccountsHierarchy(tenantContext, legalEntityId);
    expect(hierarchy.length).toBeGreaterThan(0);

    const assetGroupNode = hierarchy.find((n: any) => n.id === rootAssetId);
    expect(assetGroupNode).toBeDefined();
    expect(assetGroupNode.children.length).toBeGreaterThanOrEqual(3);

    // Summary node should have non-zero totalDebit rolled up from its child accounts
    expect(parseFloat(assetGroupNode.totalDebit)).toBeGreaterThan(0);
  });

  // ==================================================================
  // Scenario 7: Rule 12 - Prevent converting summary account with children to postable
  // ==================================================================
  it('TEST-07: [Rule 12] Prevents converting summary account to postable if it has child accounts', async () => {
    await expect(
      accountingService.updateAccount(tenantContext, rootAssetId, {
        isPostable: true,
      })
    ).rejects.toThrow(/لا يمكن تحويل حساب تجميعي إلى حساب قابل للترحيل/);
  });

  // ==================================================================
  // Scenario 8: Rule 13 - Prevent cyclical loop in parent-child relationship
  // ==================================================================
  it('TEST-08: [Rule 13] Prevents assigning child account as parent of its own ancestor (cyclical loop)', async () => {
    // Attempting to make bankAccountId the parent of rootAssetId (when bank is a child of rootAssetId)
    await expect(
      accountingService.updateAccount(tenantContext, rootAssetId, {
        parentId: bankAccountId,
      })
    ).rejects.toThrow(/حلقة دائرية مفرغة/);
  });

  // ==================================================================
  // Scenario 9: Bank and Vault Transfers with Automated Double-Entry
  // ==================================================================
  it('TEST-09: Executes Bank-to-Vault cash transfer with automated balanced journal entry and updated balances', async () => {
    const transferResult = await accountingService.bankTransfer(tenantContext, {
      legalEntityId,
      branchId,
      sourceType: 'BANK',
      sourceId: testBankId,
      destinationType: 'VAULT',
      destinationId: testVaultId,
      amount: '5000.0000',
      notes: 'تغذية صندوق الخزينة المركزية من مصرف الراجحي',
    });

    expect(transferResult.success).toBe(true);
    expect(transferResult.journalNumber).toBeDefined();

    // Verify balances updated in database
    const { bank, vault } = await dbService.withTenantContext(tenantContext, async (tx) => {
      const [b] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, testBankId)).limit(1);
      const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, testVaultId)).limit(1);
      return { bank: b, vault: v };
    });

    expect(parseFloat(bank!.balance)).toBe(95000); // 100,000 - 5,000
    expect(parseFloat(vault!.balance)).toBe(5000); // 0 + 5,000
  });

  // ==================================================================
  // Scenario 10: Inviolable Reversal of Posted Journal Entry
  // ==================================================================
  it('TEST-10: Inviolable reversal: reverses posted entry, marks status REVERSED, and posts inverted entry', async () => {
    // 1. Post a simple entry
    const jv = await accountingService.createJournalEntry(tenantContext, {
      legalEntityId,
      branchId,
      journalNumber: `JV-TOREV-${Date.now().toString().slice(-6)}`,
      journalType: JournalType.GENERAL,
      status: JournalStatus.POSTED,
      lines: [
        { accountId: vaultAccountId, debit: '250.0000', credit: '0.0000' },
        { accountId: salesAccountId, debit: '0.0000', credit: '250.0000' },
      ],
    });

    expect(jv.status).toBe('POSTED');

    // 2. Reverse it
    const rev = await accountingService.reverseJournalEntry(tenantContext, {
      journalEntryId: jv.id,
      reversalReason: 'خطأ إجرائي في قيد الصندوق',
    });

    expect(rev).toBeDefined();
    expect(rev.status).toBe('POSTED');

    // Original entry is now REVERSED
    const orig = await accountingService.getJournalEntryById(tenantContext, jv.id);
    expect(orig.status).toBe('REVERSED');

    // Second reversal attempt is strictly rejected
    await expect(
      accountingService.reverseJournalEntry(tenantContext, {
        journalEntryId: jv.id,
        reversalReason: 'محاولة عكس ثانية غير مسموحة',
      })
    ).rejects.toThrow(/تم عكس هذا القيد مسبقاً/);
  });
});
