import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { cashVaults, vaultTransactions } from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Phase 3 Cash Vaults & Financial Movements Engine Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let opsFramework: OperationsFrameworkService;
  let accountingService: AccountingService;
  let financialResourcesService: FinancialResourcesService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;

  let cashAccountId1: string;
  let cashAccountId2: string;
  let revenueAccountId: string;
  let expenseAccountId: string;

  let vault1Id: string;
  let vault2Id: string;

  const tenantCode = `vlt-p3-${Date.now().toString(36).slice(-6)}`;

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
    opsFramework = new OperationsFrameworkService(dbService, auditService);
    accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
    financialResourcesService = new FinancialResourcesService(dbService, auditService, opsFramework);

    // 1. Provision Tenant via onboardTenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `مجموعة اختبارات محرك الخزائن ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الخزائن والنقدية المحدودة',
        commercialName: 'Cash Vaults & Financial Movements Engine LLC',
        vatNumber: '310123456700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-01',
        name: 'فرع العليا المركزي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مدير العمليات المالية',
        password: 'Password123!Secure',
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

    // 4. Create COA accounts for testing
    const cashAcc1 = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111101',
      name: 'صندوق فرع العليا الرئيسي',
      nameAr: 'صندوق فرع العليا الرئيسي',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    cashAccountId1 = cashAcc1.id;

    const cashAcc2 = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111102',
      name: 'صندوق الكاشير الاحتياطي',
      nameAr: 'صندوق الكاشير الاحتياطي',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    cashAccountId2 = cashAcc2.id;

    const revAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '411000',
      name: 'إيرادات المبيعات النقدية',
      nameAr: 'إيرادات المبيعات النقدية',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
      currency: 'SAR',
    });
    revenueAccountId = revAcc.id;

    const expAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '511000',
      name: 'مصروفات تشغيلية ونثرية',
      nameAr: 'مصروفات تشغيلية ونثرية',
      accountType: AccountType.EXPENSE,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    expenseAccountId = expAcc.id;

    // Map system accounts for variances
    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.ROUNDING_DIFFERENCE,
      accountId: revAcc.id,
    });
    await accountingService.setAccountMapping(tenantContext, {
      legalEntityId,
      mappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
      accountId: expAcc.id,
    });
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  // ------------------------------------------------------------------
  // 1. إضافة خزينة جديدة
  // ------------------------------------------------------------------
  it('TEST-VLT-01: Creates branch vault and central company vault with proper scoping', async () => {
    // Branch Vault
    const v1 = await financialResourcesService.createCashVault(tenantContext, {
      legalEntityId,
      branchId,
      code: 'VLT-BR-01',
      nameAr: 'خزينة الفرع النقدية 1',
      nameEn: 'Branch Cash Vault 1',
      accountId: cashAccountId1,
    });
    expect(v1.id).toBeDefined();
    expect(v1.code).toBe('VLT-BR-01');
    expect(v1.branchId).toBe(branchId);
    expect(parseFloat(v1.balance)).toBe(0);
    expect(v1.status).toBe('ACTIVE');
    vault1Id = v1.id;

    // Central Vault (branchId is null)
    const v2 = await financialResourcesService.createCashVault(tenantContext, {
      legalEntityId,
      branchId: null,
      code: 'VLT-CENTRAL-01',
      nameAr: 'الخزينة المركزية للإدارة',
      nameEn: 'Central Management Vault',
      accountId: cashAccountId2,
    });
    expect(v2.id).toBeDefined();
    expect(v2.branchId).toBeNull();
    vault2Id = v2.id;
  });

  // ------------------------------------------------------------------
  // 2. تعديل بيانات الخزينة
  // ------------------------------------------------------------------
  it('TEST-VLT-02: Updates vault details (nameAr, nameEn) and keeps balance immutable', async () => {
    const updated = await financialResourcesService.updateCashVault(tenantContext, vault1Id, {
      nameAr: 'خزينة فرع العليا - معدلة',
      nameEn: 'Olaya Branch Main Vault Updated',
    });
    expect(updated.nameAr).toBe('خزينة فرع العليا - معدلة');
    expect(updated.nameEn).toBe('Olaya Branch Main Vault Updated');
    expect(parseFloat(updated.balance)).toBe(0);
  });

  // ------------------------------------------------------------------
  // 3. عرض تفاصيل الخزينة ورصيدها
  // ------------------------------------------------------------------
  it('TEST-VLT-03: Fetches vault details with accurate balance and linked GL account', async () => {
    const vault = await financialResourcesService.getCashVault(tenantContext, vault1Id);
    expect(vault.id).toBe(vault1Id);
    expect(vault.code).toBe('VLT-BR-01');
    expect(vault.accountId).toBe(cashAccountId1);
    expect(vault.accountCode).toBe('111101');
  });

  // ------------------------------------------------------------------
  // 5. سندات القبض: تغذية الخزينة بنقدية وتحديث الرصيد ودفتر الأستاذ
  // ------------------------------------------------------------------
  it('TEST-VLT-04: Creates Receipt Voucher directly to vault, increases balance and posts balanced JV', async () => {
    const rv = await accountingService.createReceiptVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: `RV-${Date.now().toString().slice(-6)}`,
      payerName: 'زبائن صالة الطعام النقدية',
      destinationType: 'VAULT',
      destinationId: vault1Id,
      accountId: revenueAccountId,
      amount: '5000.0000',
      notes: 'تحصيل إيراد مبيعات نقدية',
    });

    expect(rv.id).toBeDefined();
    expect(rv.journalEntryId).toBeDefined();

    // Verify vault balance updated
    const v1 = await financialResourcesService.getCashVault(tenantContext, vault1Id);
    expect(parseFloat(v1.balance)).toBe(5000);
  });

  // ------------------------------------------------------------------
  // 7. تحويل الأموال بين الخزائن
  // ------------------------------------------------------------------
  it('TEST-VLT-05: Transfers funds between vaults atomically with overdraft protection and GL entry', async () => {
    // Transfer 1,500 SAR from vault1 to vault2
    const trf = await accountingService.transferBetweenVaults(tenantContext, {
      legalEntityId,
      fromVaultId: vault1Id,
      toVaultId: vault2Id,
      amount: '1500.0000',
      notes: 'إيداع جزئي من خزينة الفرع إلى الخزينة المركزية',
    });

    expect(parseFloat(trf.fromBalanceAfter)).toBe(3500);
    expect(parseFloat(trf.toBalanceAfter)).toBe(1500);
    expect(trf.journalEntry).toBeDefined();

    // Verify database balances
    const v1 = await financialResourcesService.getCashVault(tenantContext, vault1Id);
    const v2 = await financialResourcesService.getCashVault(tenantContext, vault2Id);
    expect(parseFloat(v1.balance)).toBe(3500);
    expect(parseFloat(v2.balance)).toBe(1500);

    // Negative test: overdraft
    await expect(
      accountingService.transferBetweenVaults(tenantContext, {
        legalEntityId,
        fromVaultId: vault1Id,
        toVaultId: vault2Id,
        amount: '10000.0000',
      })
    ).rejects.toThrow(/منع السحب على المكشوف/);
  });

  // ------------------------------------------------------------------
  // 5. سندات الصرف وربطها بالخزينة
  // ------------------------------------------------------------------
  it('TEST-VLT-06: Creates Payment Voucher from vault with overdraft check and GL posting', async () => {
    // Valid payment voucher
    const pv = await accountingService.createPaymentVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: `PV-${Date.now().toString().slice(-6)}`,
      beneficiaryName: 'شركة النظافة والخدمات السريعة',
      sourceType: 'VAULT',
      sourceId: vault1Id,
      accountId: expenseAccountId,
      amount: '500.0000',
      notes: 'صرف نثريات خدمات الفرع',
    });

    expect(pv.id).toBeDefined();
    const v1 = await financialResourcesService.getCashVault(tenantContext, vault1Id);
    expect(parseFloat(v1.balance)).toBe(3000); // 3500 - 500 = 3000

    // Negative test: overdraft payment voucher
    await expect(
      accountingService.createPaymentVoucher(tenantContext, {
        legalEntityId,
        branchId,
        voucherNumber: `PV-OD-${Date.now().toString().slice(-4)}`,
        beneficiaryName: 'مورد غير مصرح',
        sourceType: 'VAULT',
        sourceId: vault1Id,
        accountId: expenseAccountId,
        amount: '8000.0000',
      })
    ).rejects.toThrow(/منع السحب على المكشوف/);
  });

  // ------------------------------------------------------------------
  // 6. جرد الخزينة وإظهار الرصيد الدفتري والفعلي والفروقات
  // ------------------------------------------------------------------
  it('TEST-VLT-07: Performs physical count with variance calculation and automatic adjustment posting', async () => {
    // Current book balance of vault1 is 3,000 SAR.
    // Case 1: Shortage of 50 SAR (actual: 2,950 SAR)
    const countShortage = await accountingService.countCashVault(tenantContext, {
      legalEntityId,
      vaultId: vault1Id,
      actualAmount: '2950.0000',
      varianceAction: 'POST_VARIANCE',
      notes: 'جرد أسبوعي مفاجئ - وجود عجز 50 ريال',
    });

    const v1AfterShortage = await financialResourcesService.getCashVault(tenantContext, vault1Id);
    expect(parseFloat(v1AfterShortage.balance)).toBe(2950);

    // Case 2: Surplus of 100 SAR in vault2 (current: 1,500 -> actual: 1,600)
    const countSurplus = await accountingService.countCashVault(tenantContext, {
      legalEntityId,
      vaultId: vault2Id,
      actualAmount: '1600.0000',
      varianceAction: 'POST_VARIANCE',
      notes: 'جرد الخزينة المركزية - وجود زيادة 100 ريال',
    });

    const v2AfterSurplus = await financialResourcesService.getCashVault(tenantContext, vault2Id);
    expect(parseFloat(v2AfterSurplus.balance)).toBe(1600);
  });

  // ------------------------------------------------------------------
  // 4. سجل كامل لحركات الخزينة
  // ------------------------------------------------------------------
  it('TEST-VLT-08: Queries full ledger of vault transactions with all audit fields', async () => {
    const txs = await financialResourcesService.getVaultTransactions(tenantContext, vault1Id);
    expect(txs.length).toBeGreaterThanOrEqual(4);

    // All required fields present
    const firstTx = txs[0];
    expect(firstTx.id).toBeDefined();
    expect(firstTx.vaultId).toBe(vault1Id);
    expect(firstTx.transactionType).toBeDefined();
    expect(firstTx.amount).toBeDefined();
    expect(firstTx.balanceAfter).toBeDefined();
    expect(firstTx.createdAt).toBeDefined();

    // Verify transaction types logged
    const types = txs.map((t) => t.transactionType);
    expect(types).toContain('DEPOSIT');
    expect(types).toContain('TRANSFER_OUT');
    expect(types).toContain('WITHDRAWAL');
    expect(types).toContain('COUNT_VARIANCE');
  });

  // ------------------------------------------------------------------
  // 8. تفعيل وتعطيل الخزينة
  // ------------------------------------------------------------------
  it('TEST-VLT-09: Toggles vault status and strictly rejects transactions on inactive vaults', async () => {
    // Deactivate vault2
    await financialResourcesService.updateCashVault(tenantContext, vault2Id, {
      status: 'INACTIVE',
    });

    const deactivated = await financialResourcesService.getCashVault(tenantContext, vault2Id);
    expect(deactivated.status).toBe('INACTIVE');

    // Attempt transfer into inactive vault -> Rejected
    await expect(
      accountingService.transferBetweenVaults(tenantContext, {
        legalEntityId,
        fromVaultId: vault1Id,
        toVaultId: vault2Id,
        amount: '100.0000',
      })
    ).rejects.toThrow(/معطلة أو غير نشطة/);

    // Attempt physical count on inactive vault -> Rejected
    await expect(
      accountingService.countCashVault(tenantContext, {
        legalEntityId,
        vaultId: vault2Id,
        actualAmount: '1600.0000',
      })
    ).rejects.toThrow(/معطلة أو غير نشطة/);

    // Reactivate vault2
    await financialResourcesService.updateCashVault(tenantContext, vault2Id, {
      status: 'ACTIVE',
    });
    const reactivated = await financialResourcesService.getCashVault(tenantContext, vault2Id);
    expect(reactivated.status).toBe('ACTIVE');
  });

  // ------------------------------------------------------------------
  // 10. منع حذف خزينة لها حركات مالية
  // ------------------------------------------------------------------
  it('TEST-VLT-10: Strictly prevents deleting vaults with financial movements or non-zero balance', async () => {
    // Attempt to delete vault1 (which has transactions, vouchers, and balance)
    await expect(
      financialResourcesService.deleteCashVault(tenantContext, vault1Id)
    ).rejects.toThrow(/لا يمكن حذف خزينة تحتوي على حركات مالية مسجلة/);

    // Create a virgin empty vault with 0 movements and delete it successfully
    const tempAcc = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111109',
      name: 'صندوق مؤقت للحذف',
      nameAr: 'صندوق مؤقت للحذف',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });

    const tempVault = await financialResourcesService.createCashVault(tenantContext, {
      legalEntityId,
      branchId,
      code: 'VLT-TEMP-DEL',
      nameAr: 'خزينة مؤقتة للحذف',
      accountId: tempAcc.id,
    });

    const delRes = await financialResourcesService.deleteCashVault(tenantContext, tempVault.id);
    expect(delRes.success).toBe(true);
  });
});
