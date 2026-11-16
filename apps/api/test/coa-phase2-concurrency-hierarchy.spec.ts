import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalType,
} from '@restaurant-cloud/domain-kernel';
import { chartOfAccounts } from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Phase 2 COA Concurrency, Hierarchy & Contra Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let accountingService: AccountingService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;

  let rootAssetId: string;
  let currentAssetsId: string;
  let cashAndBanksId: string;

  const tenantCode = `coa-p2-${Date.now().toString(36).slice(-6)}`;

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

    // 1. Create Isolated Test Tenant & Entity
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: 'مجموعة اختبارات دليل الحسابات التزامنية',
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة اختبارات دليل الحسابات',
        commercialName: 'COA Phase 2 Concurrency Test Group',
        vatNumber: '311999888700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'HO-01',
        name: 'الفرع المالي التجريبي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مراقب دليل الحسابات',
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

    // 2. Setup Baseline Root Hierarchy: 100000 -> 110000 -> 111000
    const rootAsset = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '100000',
      name: 'الأصول',
      nameAr: 'الأصول',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      level: 1,
      isPostable: false,
    });
    rootAssetId = rootAsset.id;

    const currentAssets = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '110000',
      name: 'الأصول المتداولة',
      nameAr: 'الأصول المتداولة',
      parentId: rootAssetId,
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      level: 2,
      isPostable: false,
    });
    currentAssetsId = currentAssets.id;

    const cashAndBanks = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      accountCode: '111000',
      name: 'النقد وما في حكمه',
      nameAr: 'النقد وما في حكمه',
      parentId: currentAssetsId,
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      level: 3,
      isPostable: true,
    });
    cashAndBanksId = cashAndBanks.id;
  }, 90000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  // ==================================================================
  // TEST 1: Strict Concurrency & Unique Allocation Under Same Parent
  // ==================================================================
  it('TEST-P2-01: Handles concurrent account creation under same parent without collision', async () => {
    // Both calls request auto-allocation under cashAndBanksId (111000) simultaneously
    const [acc1, acc2] = await Promise.all([
      accountingService.createAccount(tenantContext, {
        legalEntityId,
        parentId: cashAndBanksId,
        name: 'الصندوق الرئيسي',
        nameAr: 'الصندوق الرئيسي',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
      }),
      accountingService.createAccount(tenantContext, {
        legalEntityId,
        parentId: cashAndBanksId,
        name: 'البنك التشغيلي',
        nameAr: 'البنك التشغيلي',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
      }),
    ]);

    expect(acc1.id).toBeDefined();
    expect(acc2.id).toBeDefined();
    expect(acc1.accountCode).not.toBe(acc2.accountCode);

    // Verify sequential code allocation (111100 and 111200)
    const codes = [acc1.accountCode, acc2.accountCode].sort();
    expect(codes).toEqual(['111100', '111200']);

    // Verify parent (111000) was automatically switched to isPostable = false
    const accounts = await accountingService.getChartOfAccounts(tenantContext, legalEntityId);
    const parent = accounts.find((a) => a.id === cashAndBanksId);
    expect(parent).toBeDefined();
    expect(parent?.isPostable).toBe(false);
  });

  // ==================================================================
  // TEST 2: Strict Prevention of Duplicate Account Codes
  // ==================================================================
  it('TEST-P2-02: Strictly prevents duplicate account codes via application check and DB unique index', async () => {
    await expect(
      accountingService.createAccount(tenantContext, {
        legalEntityId,
        parentId: cashAndBanksId,
        accountCode: '111100', // Already created in TEST-P2-01
        name: 'حساب مكرر غير نظامي',
        nameAr: 'حساب مكرر غير نظامي',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
      })
    ).rejects.toThrow('مسجل مسبقاً في هذه المنشأة القانونية');
  });

  // ==================================================================
  // TEST 3: Strict Account Type & Normal Balance Inheritance
  // ==================================================================
  it('TEST-P2-03: Strictly enforces AccountType inheritance from parent (prevents EXPENSE under ASSET)', async () => {
    // Attempt to pass accountType: EXPENSE under an ASSET parent
    const child = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      parentId: cashAndBanksId,
      name: 'حساب مصرفي مع تلاعب بالنوع',
      nameAr: 'حساب مصرفي مع تلاعب بالنوع',
      accountType: AccountType.EXPENSE, // Should be overridden by parent's ASSET
      normalBalance: NormalBalance.DEBIT,
    });

    expect(child.accountType).toBe(AccountType.ASSET);
    expect(child.normalBalance).toBe(NormalBalance.DEBIT);
    expect(child.level).toBe(4);
  });

  // ==================================================================
  // TEST 4: Contra Account (Reverses Normal Balance Legally)
  // ==================================================================
  it('TEST-P2-04: Creates Contra Asset account with inverted normal balance (CREDIT)', async () => {
    // Creating Contra Asset (like allowance for doubtful accounts or accumulated depreciation)
    const contraAccount = await accountingService.createAccount(tenantContext, {
      legalEntityId,
      parentId: cashAndBanksId,
      name: 'مخصص هبوط أرصدة (حساب مقابل)',
      nameAr: 'مخصص هبوط أرصدة (حساب مقابل)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.CREDIT, // Explicit contra reversal
    });

    expect(contraAccount.accountType).toBe(AccountType.ASSET);
    expect(contraAccount.normalBalance).toBe(NormalBalance.CREDIT);
    expect(contraAccount.isPostable).toBe(true);
  });

  // ==================================================================
  // TEST 5: Strict Backend Rejection of Posting to Summary Parent Node
  // ==================================================================
  it('TEST-P2-05: Strictly rejects posting journal entries directly to summary parent accounts', async () => {
    // cashAndBanksId (111000) now has children, isPostable = false
    await expect(
      postingEngine.postEntry(tenantContext, {
        legalEntityId,
        branchId,
        journalNumber: `JRN-P2-SUM-${Date.now()}`,
        journalType: JournalType.GENERAL,
        sourceType: 'MANUAL',
        description: 'قيد تجريبي لحساب أب تجميعي',
        lines: [
          {
            accountId: cashAndBanksId, // Summary account!
            debit: '100.0000',
            credit: '0.0000',
          },
          {
            accountId: rootAssetId,
            debit: '0.0000',
            credit: '100.0000',
          },
        ],
      })
    ).rejects.toThrow('تجميعي');
  });

  // ==================================================================
  // TEST 6: Next-Code Preview API Endpoint Verification
  // ==================================================================
  it('TEST-P2-06: getNextAccountCode returns accurate sequential code preview and inherited properties', async () => {
    const preview = await accountingService.getNextAccountCode(tenantContext, {
      legalEntityId,
      parentId: cashAndBanksId,
    });

    expect(preview.accountType).toBe(AccountType.ASSET);
    expect(preview.normalBalance).toBe(NormalBalance.DEBIT);
    expect(preview.level).toBe(4);
    // Should be next sequential 6-digit code after 111100, 111200, 111300...
    expect(preview.nextCode).toMatch(/^111\d00$/);
  });

  // ==================================================================
  // TEST 7: Sub-Bank Account Creation with Nullable/Optional Fields (User Scenario)
  // ==================================================================
  it('TEST-P2-07: Successfully creates sub-bank account 111102 with nameEn: null and parent 111100 through validation schema', async () => {
    // 1. Get or create Parent Account: 111100 - الحسابات البنكية الجارية
    const coaList = await accountingService.getChartOfAccounts(tenantContext, legalEntityId);
    let parentBank = coaList.find((a) => a.accountCode === '111100');
    if (!parentBank) {
      parentBank = await accountingService.createAccount(tenantContext, {
        legalEntityId,
        parentId: cashAndBanksId,
        accountCode: '111100',
        name: 'الحسابات البنكية الجارية',
        nameAr: 'الحسابات البنكية الجارية',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: false,
      });
    }

    expect(parentBank.id).toBeDefined();
    expect(parentBank.accountCode).toBe('111100');

    // 2. Validate payload matching the exact user UI submission
    const rawPayload = {
      legalEntityId,
      accountCode: '111102',
      name: 'بنك الراجحي',
      nameAr: 'بنك الراجحي',
      nameEn: null, // previously failed with invalid_type
      description: '',
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      parentId: parentBank.id,
      isPostable: true,
    };

    // Import and parse through CreateChartOfAccountSchema
    const { CreateChartOfAccountSchema } = await import('@restaurant-cloud/shared-contracts');
    const validatedDto = CreateChartOfAccountSchema.parse(rawPayload);

    expect(validatedDto.nameEn).toBeNull();
    expect(validatedDto.description).toBeNull();

    // 3. Create account through accountingService
    const childBank = await accountingService.createAccount(tenantContext, validatedDto as any);

    expect(childBank.id).toBeDefined();
    expect(childBank.accountCode).toBe('111102');
    expect(childBank.nameAr).toBe('بنك الراجحي');
    expect(childBank.parentId).toBe(parentBank.id);
    expect(childBank.accountType).toBe(AccountType.ASSET);
    expect(childBank.normalBalance).toBe(NormalBalance.DEBIT);
    expect(childBank.isPostable).toBe(true);
    expect(childBank.level).toBe(parentBank.level + 1);
  });

  // ==================================================================
  // TEST 8: Rejection on Duplicate Account Code
  // ==================================================================
  it('TEST-P2-08: Strictly rejects duplicate account code 111102 within same legal entity', async () => {
    await expect(
      accountingService.createAccount(tenantContext, {
        legalEntityId,
        accountCode: '111102', // Already created in TEST-P2-07!
        name: 'بنك الراجحي المكرر',
        nameAr: 'بنك الراجحي المكرر',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      })
    ).rejects.toThrow('مسجل مسبقاً');
  });

  // ==================================================================
  // TEST 9: Rejection on Non-existent Parent ID
  // ==================================================================
  it('TEST-P2-09: Strictly rejects creation when specified parentId does not exist', async () => {
    const fakeParentId = '99999999-9999-9999-9999-999999999999';
    await expect(
      accountingService.createAccount(tenantContext, {
        legalEntityId,
        parentId: fakeParentId,
        accountCode: '111199',
        name: 'حساب وهمي بأب غير موجود',
        nameAr: 'حساب وهمي بأب غير موجود',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      })
    ).rejects.toThrow('غير موجود');
  });

  // ==================================================================
  // TEST 10: Schema Normalization of Empty Strings and Nulls
  // ==================================================================
  it('TEST-P2-10: Schema gracefully handles empty string parentId, nameEn, description', async () => {
    const { CreateChartOfAccountSchema } = await import('@restaurant-cloud/shared-contracts');

    const parsed = CreateChartOfAccountSchema.parse({
      legalEntityId,
      accountCode: '111198',
      name: 'حساب تجريبي تطبيقي',
      nameAr: 'حساب تجريبي تطبيقي',
      nameEn: '',
      description: '',
      parentId: '', // Empty string from <option value="">
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      isPostable: true,
    });

    expect(parsed.nameEn).toBeNull();
    expect(parsed.description).toBeNull();
    expect(parsed.parentId).toBeNull();
  });
});
