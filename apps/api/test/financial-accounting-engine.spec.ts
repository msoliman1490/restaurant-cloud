import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { TenantContext, AccountType, NormalBalance, JournalType, DefaultAccountMappingKey } from '@restaurant-cloud/domain-kernel';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Advanced Financial Management & Accounting Engine Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let accountingService: AccountingService;
  let postingEngine: PostingEngineService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;

  // Account IDs
  let bankAccountId: string;
  let vaultAccountId: string;
  let salesAccountId: string;
  let vatOutputAccountId: string;
  let vatInputAccountId: string;
  let arAccountId: string;
  let apAccountId: string;
  let expenseAccountId: string;
  let retainedEarningsAccountId: string;
  let parentAssetAccountId: string;

  // Vault & Bank IDs
  let mainVaultId: string;
  let branchVaultId: string;
  let primaryBankId: string;

  const tenantCode = `fin-test-${Date.now().toString(36)}`;

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

    // 1. Provision Test Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: 'مجموعة الضيافة المالية المتكاملة',
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الضيافة المالية القابضة',
        commercialName: 'الضيافة المالية',
        vatNumber: '300998877665544',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-FIN-01',
        name: 'فرع المالية والتشغيل - الرياض',
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
      legalEntityId,
      branchId,
      userId: tenantResult.user.id,
      scopes: ['*'],
    };
  });

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  // ==================================================================
  // Scenario 1: Chart of Accounts Hierarchy & Parent-Child Integrity
  // ==================================================================
  it('1. should create hierarchical Chart of Accounts (Header vs Postable) and prevent cyclical parents', async () => {
    // 1.1 Create Header Parent Account (isPostable = false)
    const parent = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '1000',
      name: 'الأصول المتداولة (Parent Header)',
      nameAr: 'الأصول المتداولة',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: false,
    });
    parentAssetAccountId = parent.id;
    expect(parent.isPostable).toBe(false);

    // 1.2 Create Child Postable Accounts under 1000
    const vaultAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '1010',
      name: 'الخزينة النقدية الرئيسية',
      accountType: AccountType.ASSET,
      parentId: parentAssetAccountId,
      isPostable: true,
    });
    vaultAccountId = vaultAcc.id;

    const bankAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '1020',
      name: 'حساب البنك الأهلي التجاري',
      accountType: AccountType.ASSET,
      parentId: parentAssetAccountId,
      isPostable: true,
    });
    bankAccountId = bankAcc.id;

    // 1.3 Create Revenue, Expense, Liability, and Equity Accounts
    const salesAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '4010',
      name: 'إيرادات مبيعات الأغذية',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    salesAccountId = salesAcc.id;

    const vatOutAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '2050',
      name: 'ضريبة القيمة المضافة للمخرجات (15%)',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    vatOutputAccountId = vatOutAcc.id;

    const vatInAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '1090',
      name: 'ضريبة القيمة المضافة للمدخلات (15%)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    vatInputAccountId = vatInAcc.id;

    const arAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '1030',
      name: 'الذمم المدينة التجارية (AR)',
      accountType: AccountType.ASSET,
      isPostable: true,
    });
    arAccountId = arAcc.id;

    const apAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '2010',
      name: 'ذمم الموردين الدائنة (AP)',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    apAccountId = apAcc.id;

    const expAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '6010',
      name: 'مصاريف تشغيلية وعمومية',
      accountType: AccountType.EXPENSE,
      isPostable: true,
    });
    expenseAccountId = expAcc.id;

    const retAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '3020',
      name: 'الأرباح المبقاة (Retained Earnings)',
      accountType: AccountType.EQUITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    retainedEarningsAccountId = retAcc.id;

    // 1.4 Prevent cycle: parent pointing to itself
    await expect(
      accountingService.updateAccount(tenantContext, parentAssetAccountId, {
        parentId: parentAssetAccountId,
      })
    ).rejects.toThrow(BadRequestException);

    // 1.5 Prevent deletion of an account with child accounts
    await expect(
      accountingService.deleteAccount(tenantContext, parentAssetAccountId)
    ).rejects.toThrow(BadRequestException);

    // 1.6 Verify full tree retrieval
    const hierarchy = await accountingService.getChartOfAccountsHierarchy(tenantContext, legalEntityId);
    expect(hierarchy.length).toBeGreaterThan(0);
    const parentNode = hierarchy.find((n: any) => n.id === parentAssetAccountId);
    expect(parentNode).toBeDefined();
    expect(parentNode.children.length).toBe(2); // vault and bank
  });

  // ==================================================================
  // Scenario 2: Dynamic Account Mappings (No Hardcoded IDs)
  // ==================================================================
  it('2. should configure and retrieve dynamic Account Mappings', async () => {
    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.SALES,
      accountId: salesAccountId,
      description: 'حساب مبيعات الأغذية والمشروبات التلقائي',
    });

    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
      accountId: vatOutputAccountId,
      description: 'حساب ضريبة المخرجات المستحقة التلقائي',
    });

    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.VAT_INPUT,
      accountId: vatInputAccountId,
      description: 'حساب ضريبة المدخلات القابلة للخصم',
    });

    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.CASH_VAULT,
      accountId: vaultAccountId,
      description: 'خزينة الكاشير الافتراضية',
    });

    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
      accountId: expenseAccountId,
      description: 'المصروفات العامة والتشغيلية',
    });

    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.ROUNDING_DIFFERENCE,
      accountId: expenseAccountId,
      description: 'فروقات تسويات الجرد والتقريب',
    });

    const mappings = await accountingService.getAccountMappings(tenantContext, legalEntityId);
    expect(mappings.length).toBeGreaterThanOrEqual(4);
    expect(mappings.some((m) => m.mappingKey === DefaultAccountMappingKey.SALES)).toBe(true);
  });

  // ==================================================================
  // Scenario 3: Double-Entry Balance & Header Account Rejection
  // ==================================================================
  it('3. should reject unbalanced journal entries and reject posting to header parent accounts', async () => {
    // 3.1 Unbalanced entry should fail
    await expect(
      accountingService.postJournalEntry(tenantContext, {
        legalEntityId,
        journalNumber: 'JV-UNBALANCED-01',
        journalType: JournalType.GENERAL,
        sourceType: 'manual',
        sourceId: legalEntityId,
        lines: [
          { accountId: vaultAccountId, debit: '1000.0000', credit: '0.0000' },
          { accountId: salesAccountId, debit: '0.0000', credit: '900.0000' }, // 100 diff
        ],
      })
    ).rejects.toThrow(BadRequestException);

    // 3.2 Attempting to post directly to header parent account (isPostable=false) should fail
    await expect(
      accountingService.postJournalEntry(tenantContext, {
        legalEntityId,
        journalNumber: 'JV-HEADER-FAIL',
        journalType: JournalType.GENERAL,
        sourceType: 'manual',
        sourceId: legalEntityId,
        lines: [
          { accountId: parentAssetAccountId, debit: '500.0000', credit: '0.0000' },
          { accountId: salesAccountId, debit: '0.0000', credit: '500.0000' },
        ],
      })
    ).rejects.toThrow(BadRequestException);
  });

  // ==================================================================
  // Scenario 4: Successful Balanced Journal Posting
  // ==================================================================
  it('4. should post a valid, balanced multi-line journal entry', async () => {
    const entry = await accountingService.postJournalEntry(tenantContext, {
      legalEntityId,
      branchId,
      journalNumber: 'JV-OPEN-001',
      journalType: JournalType.OPENING,
      sourceType: 'opening_balance',
      sourceId: legalEntityId,
      description: 'قيد إيداع رأس المال الافتتاحي في البنك والخزينة',
      lines: [
        { accountId: bankAccountId, debit: '300000.0000', credit: '0.0000', description: 'إيداع بنكي' },
        { accountId: vaultAccountId, debit: '50000.0000', credit: '0.0000', description: 'إيداع خزينة' },
        { accountId: retainedEarningsAccountId, debit: '0.0000', credit: '350000.0000', description: 'رأس مال وحقوق ملكية' },
      ],
    });

    expect(entry.id).toBeDefined();
    expect(entry.lines.length).toBe(3);
    expect(entry.debitTotal).toBe('350000.0000');
    expect(entry.creditTotal).toBe('350000.0000');
  });

  // ==================================================================
  // Scenario 5: Inviolable Journal Reversal (Immutability Pattern)
  // ==================================================================
  it('5. should enforce immutability: posted journal entries can only be corrected via reversal', async () => {
    const jv = await accountingService.postJournalEntry(tenantContext, {
      legalEntityId,
      journalNumber: 'JV-ERRONEOUS-01',
      journalType: JournalType.GENERAL,
      sourceType: 'manual_error',
      sourceId: legalEntityId,
      description: 'قيد خاطئ مراد إلغاؤه وعكسه',
      lines: [
        { accountId: expenseAccountId, debit: '2500.0000', credit: '0.0000' },
        { accountId: bankAccountId, debit: '0.0000', credit: '2500.0000' },
      ],
    });

    // Reverse the journal entry
    const reversal = await accountingService.reverseJournalEntry(tenantContext, {
      journalEntryId: jv.id,
      reversalReason: 'خطأ في توجيه مركز التكلفة والمبلغ',
      newJournalNumber: 'JV-REV-001',
    });

    expect(reversal.id).toBeDefined();
    expect(reversal.journalType).toBe(JournalType.REVERSAL);

    // Trying to reverse the same entry again must fail
    await expect(
      accountingService.reverseJournalEntry(tenantContext, {
        journalEntryId: jv.id,
        reversalReason: 'محاولة عكس ثانية',
        newJournalNumber: 'JV-REV-002',
      })
    ).rejects.toThrow(BadRequestException);
  });

  // ==================================================================
  // Scenario 6: Fiscal Periods & Closed Period Posting Protection
  // ==================================================================
  it('6. should strictly block journal postings into CLOSED fiscal periods', async () => {
    // 6.1 Create Fiscal Period for last year
    const pastPeriod = await accountingService.createFiscalPeriod(tenantContext, {
      legalEntityId,
      periodName: 'FY-2025-Q4',
      startDate: '2025-10-01T00:00:00.000Z',
      endDate: '2025-12-31T23:59:59.000Z',
    });

    // 6.2 Close the period
    await accountingService.closeFiscalPeriod(tenantContext, {
      periodId: pastPeriod.id,
    });

    // 6.3 Attempt to post entry into the closed period -> Must throw BadRequestException
    await expect(
      accountingService.postJournalEntry(tenantContext, {
        legalEntityId,
        journalNumber: 'JV-CLOSED-PERIOD-ATTEMPT',
        journalType: JournalType.GENERAL,
        sourceType: 'historical',
        sourceId: legalEntityId,
        entryDate: '2025-11-15T10:00:00.000Z',
        lines: [
          { accountId: bankAccountId, debit: '100.0000', credit: '0.0000' },
          { accountId: salesAccountId, debit: '0.0000', credit: '100.0000' },
        ],
      })
    ).rejects.toThrow(BadRequestException);
  });

  // ==================================================================
  // Scenario 7: Cash Vaults, Physical Count & Variance Settlement
  // ==================================================================
  it('7. should manage Cash Vaults, handle count variances, and prevent overdrafts', async () => {
    // 7.1 Create Main and Branch Vaults
    const mainVault = await accountingService.createCashVault(tenantContext, {
      legalEntityId,
      code: 'VLT-MAIN',
      nameAr: 'خزينة الإدارة النقدية',
      accountId: vaultAccountId,
    });
    mainVaultId = mainVault.id;

    const branchVault = await accountingService.createCashVault(tenantContext, {
      legalEntityId,
      branchId,
      code: 'VLT-BR01',
      nameAr: 'صندوق كاشير الفرع 1',
      accountId: vaultAccountId,
    });
    branchVaultId = branchVault.id;

    // 7.2 Initial Count: Set Main Vault to 20,000 SAR
    const countRes = await accountingService.countCashVault(tenantContext, {
      legalEntityId,
      vaultId: mainVaultId,
      actualAmount: '20000.0000',
      notes: 'تسوية رصيد افتتاحي للخزينة',
    });
    expect(countRes.actualBalance).toBe('20000.0000');

    // 7.3 Inter-Vault Transfer: 5,000 from Main to Branch
    const transferRes = await accountingService.transferBetweenVaults(tenantContext, {
      legalEntityId,
      fromVaultId: mainVaultId,
      toVaultId: branchVaultId,
      amount: '5000.0000',
      notes: 'تغذية كاش الكاشير اليومي',
    });
    expect(transferRes.fromBalanceAfter).toBe('15000.0000');
    expect(transferRes.toBalanceAfter).toBe('5000.0000');

    // 7.4 Overdraft Block: Attempting to transfer 25,000 from Branch (which only has 5,000) must fail
    await expect(
      accountingService.transferBetweenVaults(tenantContext, {
        legalEntityId,
        fromVaultId: branchVaultId,
        toVaultId: mainVaultId,
        amount: '25000.0000',
      })
    ).rejects.toThrow(BadRequestException);
  });

  // ==================================================================
  // Scenario 8: Payment Vouchers & Strict Overdraft Prevention
  // ==================================================================
  it('8. should post Payment Vouchers, deduct balance, and strictly prevent vault overdrafts', async () => {
    // 8.1 Branch vault currently has 5,000. Attempt to spend 8,000 -> must fail with Overdraft Error
    await expect(
      accountingService.createPaymentVoucher(tenantContext, {
        legalEntityId,
        branchId,
        voucherNumber: 'PV-FAIL-OVERDRAFT',
        beneficiaryName: 'شركة الإمداد الغذائي',
        sourceType: 'VAULT',
        sourceId: branchVaultId,
        accountId: expenseAccountId,
        amount: '8000.0000',
      })
    ).rejects.toThrow(BadRequestException);

    // 8.2 Valid Payment Voucher: Spend 2,000 from Branch Vault (balance becomes 3,000)
    const pv = await accountingService.createPaymentVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: 'PV-VALID-001',
      beneficiaryName: 'مورد مواد التنظيف والتغليف',
      sourceType: 'VAULT',
      sourceId: branchVaultId,
      accountId: expenseAccountId,
      amount: '2000.0000',
      notes: 'شراء منظفات ومواد تغليف ورقية',
    });

    expect(pv.id).toBeDefined();
    expect(pv.journalEntryId).toBeDefined();

    // Verify vault balance was reduced to 3000
    const vaultsList = await accountingService.listCashVaults(tenantContext, legalEntityId);
    const brVault = vaultsList.find((v) => v.id === branchVaultId);
    expect(brVault?.balance).toBe('3000.0000');
  });

  // ==================================================================
  // Scenario 9: Receipt Vouchers & Customer Collections
  // ==================================================================
  it('9. should post Receipt Vouchers, update vault balance, and generate balanced JV', async () => {
    // Collect 4,500 into Branch Vault (balance increases from 3,000 to 7,500)
    const rv = await accountingService.createReceiptVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: 'RV-VALID-001',
      payerName: 'شركة الإعاشة والضيافة',
      destinationType: 'VAULT',
      destinationId: branchVaultId,
      accountId: arAccountId,
      amount: '4500.0000',
      notes: 'تحصيل دفعة من فاتورة توريد وجبات',
    });

    expect(rv.id).toBeDefined();
    expect(rv.journalEntryId).toBeDefined();

    const vaultsList = await accountingService.listCashVaults(tenantContext, legalEntityId);
    const brVault = vaultsList.find((v) => v.id === branchVaultId);
    expect(brVault?.balance).toBe('7500.0000');
  });

  // ==================================================================
  // Scenario 10: Bank Management & Monthly Bank Reconciliation
  // ==================================================================
  it('10. should manage Bank Accounts and calculate bank reconciliation discrepancies', async () => {
    const bank = await accountingService.createBankAccount(tenantContext, {
      legalEntityId,
      bankName: 'مصرف الراجحي التجاري',
      accountNumber: '998877665544',
      iban: 'SA0380000998877665544',
      accountId: bankAccountId,
    });
    primaryBankId = bank.id;
    expect(primaryBankId).toBeDefined();

    // Bank statement reconciliation test
    const rec = await accountingService.reconcileBankAccount(tenantContext, {
      legalEntityId,
      bankAccountId: primaryBankId,
      statementDate: new Date().toISOString(),
      statementEndingBalance: '0.0000',
    });

    expect(rec.status).toBe('RECONCILED');
    expect(rec.discrepancy).toBe('0.0000');
  });

  // ==================================================================
  // Scenario 11: Operational Auto-Posting Engine (POS Sales Order JV)
  // ==================================================================
  it('11. should generate balanced operational JV for POS sales with 15% VAT', async () => {
    const orderJv = await postingEngine.postSalesOrderJournal(tenantContext, {
      orderId: legalEntityId,
      orderNumber: 'POS-2026-9901',
      legalEntityId,
      branchId,
      subtotal: '1000.0000',
      vatAmount: '150.0000',
      totalAmount: '1150.0000',
      paymentMethod: 'CASH',
      vaultAccountId,
    });

    expect(orderJv.id).toBeDefined();
    expect(orderJv.debitTotal).toBe('1150.0000');
    expect(orderJv.creditTotal).toBe('1150.0000');
  });

  // ==================================================================
  // Scenario 12: Cost Centers Management
  // ==================================================================
  it('12. should create and list Cost Centers hierarchy', async () => {
    const ccParent = await accountingService.createCostCenter(tenantContext, {
      legalEntityId,
      code: 'CC-OPS',
      nameAr: 'قطاع التشغيل والمطاعم',
    });

    const ccChild = await accountingService.createCostCenter(tenantContext, {
      legalEntityId,
      code: 'CC-BR01',
      nameAr: 'مركز تكلفة فرع الرياض',
      parentId: ccParent.id,
    });

    expect(ccParent.id).toBeDefined();
    expect(ccChild.parentId).toBe(ccParent.id);

    const list = await accountingService.getCostCenters(tenantContext, legalEntityId);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  // ==================================================================
  // Scenario 13: Operational Expenses & VAT (15%) Calculation
  // ==================================================================
  it('13. should register operational expenses and calculate 15% VAT accurately', async () => {
    const exp = await accountingService.createExpense(tenantContext, {
      legalEntityId,
      branchId,
      expenseNumber: 'EXP-2026-0045',
      category: 'صيانة دورية',
      accountId: expenseAccountId,
      vendorName: 'مؤسسة التبريد والتهوية',
      subtotal: '2000.0000',
      taxRate: '0.1500',
      notes: 'صيانة ثلاجات ومكيفات المطبخ',
    });

    expect(exp.subtotal).toBe('2000.0000');
    expect(exp.vatAmount).toBe('300.0000');
    expect(exp.totalAmount).toBe('2300.0000');
  });

  // ==================================================================
  // Scenario 14: Trial Balance Mathematical Balance Check
  // ==================================================================
  it('14. should generate Trial Balance with Debit = Credit verification', async () => {
    const tb = await accountingService.getTrialBalance(tenantContext, legalEntityId);

    expect(tb.isBalanced).toBe(true);
    expect(parseFloat(tb.discrepancy)).toBeLessThan(0.0001);
    expect(parseFloat(tb.grandDebitTotal)).toBeGreaterThan(0);
    expect(tb.grandDebitTotal).toBe(tb.grandCreditTotal);
  });

  // ==================================================================
  // Scenario 15: Financial Statements (Income Statement & Balance Sheet)
  // ==================================================================
  it('15. should generate Income Statement and balanced Balance Sheet', async () => {
    const pnl = await accountingService.getIncomeStatement(tenantContext, {
      legalEntityId,
    });
    expect(pnl.totalRevenue).toBeDefined();
    expect(pnl.netProfit).toBeDefined();

    const bs = await accountingService.getBalanceSheet(tenantContext, {
      legalEntityId,
    });
    expect(bs.isBalanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
  });

  // ==================================================================
  // Scenario 16: ZATCA Official 15% VAT Return Reporting
  // ==================================================================
  it('16. should generate official ZATCA VAT Return reporting format', async () => {
    const vatReturn = await accountingService.getZatcaVatReturn(tenantContext, {
      legalEntityId,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z',
    });

    expect(vatReturn.legalEntityId).toBe(legalEntityId);
    expect(parseFloat(vatReturn.totalOutputVat)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(vatReturn.totalInputVat)).toBeGreaterThanOrEqual(0);
    expect(vatReturn.netVatPayableOrRefund).toBeDefined();
  });

  // ==================================================================
  // Scenario 17: Year-End Closing (Rolling Revenues & Expenses to Retained Earnings)
  // ==================================================================
  it('17. should execute Year-End closing entry rolling net profit into Retained Earnings', async () => {
    const closing = await accountingService.closeFiscalYear(tenantContext, {
      legalEntityId,
      closingFiscalYear: '2026',
      retainedEarningsAccountId,
      closingJournalNumber: 'JV-CLOSE-FY2026',
      notes: 'إقفال السنة المالية 2026 وتدوير صافي الأرباح',
    });

    expect(closing.closingFiscalYear).toBe('2026');
    expect(closing.journalEntry).toBeDefined();
    expect(closing.journalEntry.journalType).toBe(JournalType.CLOSING);
  });
});
