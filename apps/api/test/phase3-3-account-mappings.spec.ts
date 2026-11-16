import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { accountMappings, chartOfAccounts, journalEntries, journalLines } from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Phase 3.3: Central Accounting Mapping & Branch Overrides Spec', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let opsFramework: OperationsFrameworkService;
  let accountingService: AccountingService;
  let financialResourcesService: FinancialResourcesService;
  let accountingController: AccountingController;
  let permissionsGuard: PermissionsGuard;
  let reflector: Reflector;

  let legalEntity1Id: string;
  let legalEntity2Id: string;
  let branch1Id: string;
  let branch2Id: string;
  let branch3Id: string;

  let salesCompanyAccountId: string;
  let salesBranch1AccountId: string;
  let bankAccountId: string;
  let vatAccountId: string;
  let summaryAccountId: string;
  let inactiveAccountId: string;
  let otherEntityAccountId: string;

  let tenantId: string;
  let adminUserId: string;
  const tenantCode = `res-p33-${Date.now().toString(36).slice(-6)}`;

  function createMockExecutionContext(context: TenantContext, handler: Function): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => AccountingController,
      switchToHttp: () => ({
        getRequest: () => ({ tenantContext: context }),
      }),
    } as unknown as ExecutionContext;
  }

  async function verifyGuardAndRun<T>(context: TenantContext, handler: Function, action: () => Promise<T>): Promise<T> {
    const execCtx = createMockExecutionContext(context, handler);
    const canActivate = await Promise.resolve(permissionsGuard.canActivate(execCtx));
    if (!canActivate) {
      throw new ForbiddenException('Access denied by PermissionsGuard');
    }
    return await action();
  }

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
    opsFramework = new OperationsFrameworkService(dbService);
    accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
    financialResourcesService = new FinancialResourcesService(dbService, auditService);

    reflector = new Reflector();
    permissionsGuard = new PermissionsGuard(reflector);
    accountingController = new AccountingController(accountingService, financialResourcesService);

    console.log('[DEBUG] 1. Onboarding tenant...');
    // 1. Onboard Tenant with Legal Entity 1 and Branch 1
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `منشأة الربط المحاسبي المركزي ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة المطاعم المتقدمة ذ.م.م',
        commercialName: 'Advanced Restaurants LLC',
        vatNumber: '310123456700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-01',
        name: 'فرع العليا الرياض',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        displayName: 'مدير المحاسبة والربط',
        password: 'Password123!Secure',
      },
    });

    tenantId = tenantResult.tenant.id;
    adminUserId = tenantResult.user.id;
    legalEntity1Id = tenantResult.legalEntity.id;
    branch1Id = tenantResult.branch.id;
    console.log('[DEBUG] Tenant onboarded:', tenantId);

    const sysCtx: TenantContext = {
      tenantId,
      userId: tenantResult.user.id,
      email: `admin-${tenantCode}@restaurant-cloud.test`,
      role: 'SUPER_ADMIN',
      scopes: ['*'],
    };

    console.log('[DEBUG] 2. Creating Branch 2...');
    // 2. Create Branch 2 under Legal Entity 1
    const b2 = await tenantService.createBranch(sysCtx, {
      legalEntityId: legalEntity1Id,
      name: 'فرع السليمانية الرياض',
      code: `B-SUL-${Date.now().toString().slice(-4)}`,
      businessType: 'RESTAURANT' as any,
      timezone: 'Asia/Riyadh',
    });
    branch2Id = b2.id;
    console.log('[DEBUG] Branch 2 created:', branch2Id);

    console.log('[DEBUG] 3. Creating Entity 2 and Branch 3...');
    // 3. Create Second Legal Entity and Branch 3
    const entity2 = await tenantService.createLegalEntity(sysCtx, {
      legalName: 'الشركة الشقيقة القابضة ذ.م.م',
      commercialName: 'Sister Holding LLC',
      vatNumber: '310999999900003',
      functionalCurrency: 'SAR',
      timezone: 'Asia/Riyadh',
    });
    legalEntity2Id = entity2.id;

    const b3 = await tenantService.createBranch(sysCtx, {
      legalEntityId: legalEntity2Id,
      name: 'فرع جدة التابع للشركة الثانية',
      code: `B-JED-${Date.now().toString().slice(-4)}`,
      businessType: 'RESTAURANT' as any,
      timezone: 'Asia/Riyadh',
    });
    branch3Id = b3.id;
    console.log('[DEBUG] Entity 2 and Branch 3 created');

    console.log('[DEBUG] 4. Creating COA Accounts...');
    // 4. Create COA Accounts for Legal Entity 1
    // Revenue - Company Level Sales
    const salesComp = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '411000',
      name: 'إيرادات المبيعات المركزية للشركة',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    salesCompanyAccountId = salesComp.id;
    console.log('[DEBUG] salesComp created:', salesCompanyAccountId);

    // Revenue - Branch 1 Specific Sales
    const salesBr1 = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '411001',
      name: 'إيرادات مبيعات فرع العليا',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    salesBranch1AccountId = salesBr1.id;
    console.log('[DEBUG] salesBr1 created:', salesBranch1AccountId);

    // Asset - Bank
    const bank = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111100',
      name: 'حساب البنك الجاري',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    bankAccountId = bank.id;
    console.log('[DEBUG] bank created:', bankAccountId);

    // Liability - VAT Output
    const vat = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '211200',
      name: 'ضريبة القيمة المضافة المستحقة',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    vatAccountId = vat.id;
    console.log('[DEBUG] vat created:', vatAccountId);

    // Summary Account (Header) - isPostable = false
    const sumAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '410000',
      name: 'مجموعة حسابات الإيرادات التشغيلية',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: false,
    });
    summaryAccountId = sumAcc.id;
    console.log('[DEBUG] sumAcc created:', summaryAccountId);

    // Inactive Account - status = 'INACTIVE'
    const inactAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '419999',
      name: 'حساب مبيعات موقوف',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    console.log('[DEBUG] inactAcc created:', inactAcc.id);
    await accountingService.updateAccount(sysCtx, inactAcc.id, {
      status: 'INACTIVE',
    });
    inactiveAccountId = inactAcc.id;
    console.log('[DEBUG] inactAcc updated to INACTIVE');

    // Account belonging to Legal Entity 2
    const otherAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity2Id,
      accountCode: '411000',
      name: 'إيرادات مبيعات الشركة الثانية',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });
    otherEntityAccountId = otherAcc.id;

    // Create an Open Fiscal Period covering the entire current year
    await accountingService.createFiscalPeriod(sysCtx, {
      legalEntityId: legalEntity1Id,
      periodName: `FY-${new Date().getFullYear()}`,
      startDate: `${new Date().getFullYear()}-01-01T00:00:00.000Z`,
      endDate: `${new Date().getFullYear()}-12-31T23:59:59.000Z`,
    });

    console.log('[DEBUG] All setup complete in beforeAll!');
  }, 90000);

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  // =========================================================================
  // 1. Account Compatibility & Pre-Save Validation Tests
  // =========================================================================
  describe('1. Account Compatibility & Pre-Save Validation', () => {
    it('1.1 should REJECT mapping an ASSET account to a REVENUE key (SALES)', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      await expect(
        accountingService.setAccountMapping(adminCtx, {
          legalEntityId: legalEntity1Id,
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: bankAccountId, // Bank is ASSET/DEBIT, SALES requires REVENUE/CREDIT
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.2 should REJECT mapping a summary account (isPostable = false)', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      await expect(
        accountingService.setAccountMapping(adminCtx, {
          legalEntityId: legalEntity1Id,
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: summaryAccountId, // isPostable = false
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.3 should REJECT mapping an inactive account (status = INACTIVE)', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      await expect(
        accountingService.setAccountMapping(adminCtx, {
          legalEntityId: legalEntity1Id,
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: inactiveAccountId, // status = INACTIVE
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.4 should REJECT mapping an account belonging to a different legal entity', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      await expect(
        accountingService.setAccountMapping(adminCtx, {
          legalEntityId: legalEntity1Id,
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: otherEntityAccountId, // belongs to legalEntity2
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('1.5 should REJECT creating branch override for a branch belonging to another legal entity', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      await expect(
        accountingService.setAccountMapping(adminCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch3Id, // branch3 belongs to legalEntity2
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: salesCompanyAccountId,
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('1.6 should ACCEPT valid company default mapping and branch override mapping', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage'],
      };

      // Set Company Default
      const companyMapping = await accountingService.setAccountMapping(adminCtx, {
        legalEntityId: legalEntity1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesCompanyAccountId,
        description: 'إيراد المبيعات الافتراضي للشركة',
      });
      expect(companyMapping).toBeDefined();
      expect(companyMapping.mappingKey).toBe('SALES');
      expect(companyMapping.branchId).toBeNull();
      expect(companyMapping.accountId).toBe(salesCompanyAccountId);

      // Set Branch 1 Override
      const branchOverride = await accountingService.setAccountMapping(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesBranch1AccountId,
        description: 'إيراد مبيعات فرع العليا المخصص',
      });
      expect(branchOverride).toBeDefined();
      expect(branchOverride.branchId).toBe(branch1Id);
      expect(branchOverride.accountId).toBe(salesBranch1AccountId);
    });
  });

  // =========================================================================
  // 2. Resolution Priority Hierarchy Tests
  // =========================================================================
  describe('2. Resolution Priority Hierarchy (Branch Override -> Company -> System Default)', () => {
    it('2.1 should resolve to Branch Override when querying for Branch 1', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      const resolved = await accountingService.resolveAccount(viewCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
      });

      expect(resolved.accountId).toBe(salesBranch1AccountId);
      expect(resolved.source).toBe('BRANCH_OVERRIDE');
      expect(resolved.isOverride).toBe(true);
      expect(resolved.branchId).toBe(branch1Id);
      expect(resolved.accountCode).toBe('411001');
    });

    it('2.2 should resolve to Company Default when querying for Branch 2 (without override)', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      const resolved = await accountingService.resolveAccount(viewCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        mappingKey: DefaultAccountMappingKey.SALES,
      });

      expect(resolved.accountId).toBe(salesCompanyAccountId);
      expect(resolved.source).toBe('COMPANY_MAPPING');
      expect(resolved.isOverride).toBe(false);
      expect(resolved.branchId).toBeNull();
      expect(resolved.accountCode).toBe('411000');
    });

    it('2.3 should fall back to System Default when mapping is unconfigured but standard account exists', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      // VAT_OUTPUT mapping is not explicitly set, but COA account 211200 exists
      const resolved = await accountingService.resolveAccount(viewCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
      });

      expect(resolved.accountId).toBe(vatAccountId);
      expect(resolved.source).toBe('SYSTEM_DEFAULT');
      expect(resolved.isOverride).toBe(false);
      expect(resolved.accountCode).toBe('211200');
    });

    it('2.4 should return all effective mappings via getAccountMappings with includeEffective = true', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      const effectiveList = await accountingService.getAccountMappings(
        viewCtx,
        legalEntity1Id,
        branch1Id,
        true
      );

      expect(Array.isArray(effectiveList)).toBe(true);
      const salesMapping = effectiveList.find((m) => m.mappingKey === 'SALES');
      expect(salesMapping).toBeDefined();
      expect(salesMapping?.source).toBe('BRANCH_OVERRIDE');
      expect(salesMapping?.accountId).toBe(salesBranch1AccountId);

      const vatMapping = effectiveList.find((m) => m.mappingKey === 'VAT_OUTPUT');
      expect(vatMapping).toBeDefined();
      expect(vatMapping?.source).toBe('NOT_CONFIGURED');
    });

    it('2.5 should fall back to Company Default after deleting the Branch Override', async () => {
      const manageCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['accounting.mapping.manage', 'accounting.mapping.delete', 'accounting.mapping.view'],
      };

      // Find Branch 1 override
      const rawMappings = await accountingService.getAccountMappings(
        manageCtx,
        legalEntity1Id,
        branch1Id,
        false
      );
      const brOverride = rawMappings.find(
        (m) => m.mappingKey === 'SALES' && m.branchId === branch1Id
      );
      expect(brOverride).toBeDefined();

      // Delete override
      await accountingService.deleteAccountMapping(manageCtx, brOverride!.id);

      // Resolve again for Branch 1
      const resolvedAfterDelete = await accountingService.resolveAccount(manageCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
      });

      // Must now resolve to Company Default
      expect(resolvedAfterDelete.accountId).toBe(salesCompanyAccountId);
      expect(resolvedAfterDelete.source).toBe('COMPANY_MAPPING');
      expect(resolvedAfterDelete.isOverride).toBe(false);
      expect(resolvedAfterDelete.accountCode).toBe('411000');
    });

    it('2.6 should REJECT system default fallback when standard default account does not exist in COA', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      // INVENTORY mapping standard default code is 112000, which has not been created in COA
      await expect(
        accountingService.resolveAccount(viewCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          mappingKey: DefaultAccountMappingKey.INVENTORY,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('2.7 should REJECT system default fallback when standard default account exists but is INACTIVE', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      // Create COGS standard default account 511000 and deactivate it
      const cogsInactive = await accountingService.createAccount(adminCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '511000',
        name: 'تكلفة البضاعة المباعة الافتراضية معطل',
        accountType: AccountType.COGS,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      await accountingService.updateAccount(adminCtx, cogsInactive.id, {
        status: 'INACTIVE',
      });

      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      // Must reject because default account is INACTIVE
      await expect(
        accountingService.resolveAccount(viewCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          mappingKey: DefaultAccountMappingKey.COGS,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('2.8 should REJECT system default fallback when standard default account exists but is non-postable (summary)', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      // Create VAT_INPUT standard default account 114200 as summary account (isPostable = false)
      await accountingService.createAccount(adminCtx, {
        legalEntityId: legalEntity1Id,
        accountCode: '114200',
        name: 'ضريبة المدخلات تجميعي غير قابل للترحيل',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: false,
      });

      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      // Must reject because default account is non-postable header
      await expect(
        accountingService.resolveAccount(viewCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          mappingKey: DefaultAccountMappingKey.VAT_INPUT,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('2.9 should ENFORCE strict legal entity isolation for System Default accounts (no cross-entity bleed)', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'view@test.com',
        role: 'ACCOUNTANT',
        scopes: ['accounting.mapping.view'],
      };

      // vatAccountId (211200) exists in legalEntity1Id, but NOT in legalEntity2Id.
      // Resolving VAT_OUTPUT for legalEntity2Id must reject and NEVER return Entity 1's account!
      await expect(
        accountingService.resolveAccount(viewCtx, {
          legalEntityId: legalEntity2Id,
          mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // 3. Absence of Mapping & Invalid Account Handling in Posting Engine
  // =========================================================================
  describe('3. Absence of Mapping & Posting Engine Rejections', () => {
    it('3.1 should REJECT posting a journal entry when a required mapping key is missing and unresolvable', async () => {
      const postCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      // Try posting standard journal with an unconfigured mappingKey that has no COA account (e.g. AGGREGATOR_COMMISSION)
      await expect(
        postingEngine.postEntry(postCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch2Id,
          journalNumber: `JV-${Date.now()}-MISSING`,
          journalType: 'SALES' as any,
          sourceType: 'POS_ORDER',
          sourceId: 'test-order-missing-key',
          entryDate: new Date(),
          description: 'اختبار رفض الترحيل عند غياب الربط المحاسبي',
          lines: [
            {
              mappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION, // Not mapped and code not in COA
              debit: '50.0000',
              credit: '0.0000',
              description: 'عمولة وسيط التوصيل',
            },
            {
              accountId: bankAccountId,
              debit: '0.0000',
              credit: '50.0000',
              description: 'طرف البنك المقابل',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('3.2 should REJECT creating unbalanced journal entries and prohibit random fallback accounts', async () => {
      const postCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      await expect(
        postingEngine.postEntry(postCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          journalNumber: `JV-${Date.now()}-UNBALANCED`,
          journalType: 'GENERAL' as any,
          sourceType: 'MANUAL',
          sourceId: 'test-unbalanced',
          entryDate: new Date(),
          description: 'محاولة قيد غير متزن',
          lines: [
            {
              mappingKey: DefaultAccountMappingKey.SALES,
              debit: '0.0000',
              credit: '100.0000',
              description: 'مبيعات',
            },
            {
              accountId: bankAccountId,
              debit: '90.0000', // Unbalanced (10 difference)
              credit: '0.0000',
              description: 'طرف البنك المقابل غير متزن',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // 4. Historical Journal Entry Immutability Tests
  // =========================================================================
  describe('4. Historical Journal Entry Immutability', () => {
    it('4.1 should preserve posted journal lines untouched when mapping configuration changes later', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      // 1. Re-set Branch 1 Override to salesBranch1AccountId (411001)
      await accountingService.setAccountMapping(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesBranch1AccountId,
      });

      // 2. Post a journal entry using mappingKey SALES for Branch 1
      const postedResult = await postingEngine.postEntry(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        journalNumber: `JV-${Date.now()}-HIST1`,
        journalType: 'SALES' as any,
        sourceType: 'POS_ORDER',
        sourceId: randomUUID(),
        entryDate: new Date(),
        description: 'قيد مبيعات فرع العليا الأصلي',
        lines: [
          {
            accountId: bankAccountId,
            debit: '200.0000',
            credit: '0.0000',
            description: 'قبض بنكي',
          },
          {
            mappingKey: DefaultAccountMappingKey.SALES,
            debit: '0.0000',
            credit: '200.0000',
            description: 'إيراد مبيعات محدد عبر الربط المحاسبي',
          },
        ],
      });

      expect(postedResult.id).toBeDefined();

      // Verify the posted line used salesBranch1AccountId
      const originalLines = postedResult.lines;
      const creditLine = originalLines.find((l: any) => Number(l.credit) > 0);
      expect(creditLine).toBeDefined();
      expect(creditLine?.accountId).toBe(salesBranch1AccountId);

      // 3. Now change the mapping: update Branch 1 override to point to salesCompanyAccountId (411000)
      await accountingService.setAccountMapping(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesCompanyAccountId,
      });

      // 4. Verify historical posted journal entry lines remain 100% UNCHANGED
      const historicalLinesAfterUpdate = await dbService.withTenantContext(adminCtx, async (tx) => {
        return await tx
          .select()
          .from(journalLines)
          .where(eq(journalLines.journalEntryId, postedResult.id));
      });
      const historicalCreditLine = historicalLinesAfterUpdate.find((l) => Number(l.credit) > 0);
      expect(historicalCreditLine?.accountId).toBe(salesBranch1AccountId); // Preserved!
      expect(historicalCreditLine?.id).toBe(creditLine?.id);

      // 5. Post a new journal entry after the update - it must resolve to the new account
      const secondPostedResult = await postingEngine.postEntry(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        journalNumber: `JV-${Date.now()}-HIST2`,
        journalType: 'SALES' as any,
        sourceType: 'POS_ORDER',
        sourceId: randomUUID(),
        entryDate: new Date(),
        description: 'قيد مبيعات فرع العليا بعد تعديل الربط',
        lines: [
          {
            accountId: bankAccountId,
            debit: '300.0000',
            credit: '0.0000',
            description: 'قبض بنكي ثاني',
          },
          {
            mappingKey: DefaultAccountMappingKey.SALES,
            debit: '0.0000',
            credit: '300.0000',
            description: 'إيراد مبيعات بعد التعديل',
          },
        ],
      });

      const newLines = secondPostedResult.lines;
      const newCreditLine = newLines.find((l: any) => Number(l.credit) > 0);
      expect(newCreditLine?.accountId).toBe(salesCompanyAccountId); // Reflects updated mapping!
    });
  });

  // =========================================================================
  // 5. Granular RBAC Permissions Tests
  // =========================================================================
  describe('5. Granular RBAC Permissions Verification', () => {
    it('5.1 user with view-only should ACCESS GET /account-mappings and be DENIED POST/DELETE', async () => {
      const viewOnlyCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'viewonly@test.com',
        role: 'STAFF',
        scopes: ['accounting.mapping.view'],
      };

      // Can View
      const viewResult = await verifyGuardAndRun(
        viewOnlyCtx,
        accountingController.getAccountMappings,
        () => accountingController.getAccountMappings(viewOnlyCtx, legalEntity1Id, branch1Id, false)
      );
      expect(viewResult.success).toBe(true);

      // Cannot Manage / Save
      await expect(
        verifyGuardAndRun(
          viewOnlyCtx,
          accountingController.setAccountMapping,
          () => accountingController.setAccountMapping(viewOnlyCtx, {
            legalEntityId: legalEntity1Id,
            mappingKey: DefaultAccountMappingKey.SALES,
            accountId: salesCompanyAccountId,
          })
        )
      ).rejects.toThrow(ForbiddenException);

      // Cannot Delete
      await expect(
        verifyGuardAndRun(
          viewOnlyCtx,
          accountingController.deleteAccountMapping,
          () => accountingController.deleteAccountMapping(viewOnlyCtx, 'some-mapping-id')
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('5.2 user with manage permission should ACCESS POST /account-mappings', async () => {
      const manageCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'manage@test.com',
        role: 'MANAGER',
        scopes: ['accounting.mapping.manage', 'accounting.mapping.view'],
      };

      const saveResult = await verifyGuardAndRun(
        manageCtx,
        accountingController.setAccountMapping,
        () => accountingController.setAccountMapping(manageCtx, {
          legalEntityId: legalEntity1Id,
          mappingKey: DefaultAccountMappingKey.SALES,
          accountId: salesCompanyAccountId,
          description: 'حفظ بواسطة مستخدم صلاحية manage',
        })
      );
      expect(saveResult.success).toBe(true);
      expect(saveResult.data.mappingKey).toBe('SALES');
    });

    it('5.3 user with delete permission should ACCESS DELETE /account-mappings/:id', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: adminUserId,
        email: 'admin@test.com',
        role: 'ADMIN',
        scopes: ['*'],
      };

      // Create a temporary branch override
      const tempOverride = await accountingService.setAccountMapping(adminCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch2Id,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesCompanyAccountId,
      });

      const deleteCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'delete@test.com',
        role: 'AUDITOR',
        scopes: ['accounting.mapping.delete', 'accounting.mapping.view'],
      };

      const delResult = await verifyGuardAndRun(
        deleteCtx,
        accountingController.deleteAccountMapping,
        () => accountingController.deleteAccountMapping(deleteCtx, tempOverride.id)
      );
      expect(delResult.success).toBe(true);
      expect(delResult.data.success).toBe(true);
    });

    it('5.4 user without any mapping permissions should be completely BLOCKED from all endpoints', async () => {
      const noPermsCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'unprivileged@test.com',
        role: 'WAITER',
        scopes: ['dining.tables.view'],
      };

      // Blocked from view
      await expect(
        verifyGuardAndRun(
          noPermsCtx,
          accountingController.getAccountMappings,
          () => accountingController.getAccountMappings(noPermsCtx, legalEntity1Id, branch1Id, false)
        )
      ).rejects.toThrow(ForbiddenException);

      // Blocked from manage
      await expect(
        verifyGuardAndRun(
          noPermsCtx,
          accountingController.setAccountMapping,
          () => accountingController.setAccountMapping(noPermsCtx, {
            legalEntityId: legalEntity1Id,
            mappingKey: DefaultAccountMappingKey.SALES,
            accountId: salesCompanyAccountId,
          })
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('5.5 user with accounting.mapping.create only should CREATE new mapping, but be DENIED update and DELETE', async () => {
      const createOnlyCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'creator@test.com',
        role: 'STAFF',
        scopes: ['accounting.mapping.create', 'accounting.mapping.view'],
      };

      // 1. CAN CREATE a new mapping (branch 2 override for SALES)
      const createResult = await verifyGuardAndRun(
        createOnlyCtx,
        accountingController.setAccountMapping,
        () =>
          accountingController.setAccountMapping(createOnlyCtx, {
            legalEntityId: legalEntity1Id,
            branchId: branch2Id,
            mappingKey: DefaultAccountMappingKey.SALES,
            accountId: salesCompanyAccountId,
            description: 'إنشاء بواسطة صلاحية create فقط',
          })
      );
      expect(createResult.success).toBe(true);
      expect(createResult.data.id).toBeDefined();

      // 2. CANNOT UPDATE an existing mapping (SALES company mapping already exists)
      await expect(
        verifyGuardAndRun(
          createOnlyCtx,
          accountingController.setAccountMapping,
          () =>
            accountingController.setAccountMapping(createOnlyCtx, {
              legalEntityId: legalEntity1Id,
              mappingKey: DefaultAccountMappingKey.SALES,
              accountId: salesCompanyAccountId,
              description: 'محاولة تعديل غير مصرح بها',
            })
        )
      ).rejects.toThrow(ForbiddenException);

      // 3. CANNOT DELETE mapping
      await expect(
        verifyGuardAndRun(
          createOnlyCtx,
          accountingController.deleteAccountMapping,
          () => accountingController.deleteAccountMapping(createOnlyCtx, createResult.data.id)
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('5.6 user with accounting.mapping.update only should UPDATE existing mapping, but be DENIED create and DELETE', async () => {
      const updateOnlyCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'updater@test.com',
        role: 'STAFF',
        scopes: ['accounting.mapping.update', 'accounting.mapping.view'],
      };

      // 1. CAN UPDATE an existing mapping (SALES company default mapping already exists)
      const updateResult = await verifyGuardAndRun(
        updateOnlyCtx,
        accountingController.setAccountMapping,
        () =>
          accountingController.setAccountMapping(updateOnlyCtx, {
            legalEntityId: legalEntity1Id,
            mappingKey: DefaultAccountMappingKey.SALES,
            accountId: salesCompanyAccountId,
            description: 'تعديل ناجح بصلاحية update فقط',
          })
      );
      expect(updateResult.success).toBe(true);

      // 2. CANNOT CREATE a new mapping (VAT_OUTPUT company default does not exist as an account_mappings record)
      await expect(
        verifyGuardAndRun(
          updateOnlyCtx,
          accountingController.setAccountMapping,
          () =>
            accountingController.setAccountMapping(updateOnlyCtx, {
              legalEntityId: legalEntity1Id,
              mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
              accountId: vatAccountId,
              description: 'محاولة إنشاء ربط جديد بصلاحية update فقط',
            })
        )
      ).rejects.toThrow(ForbiddenException);

      // 3. CANNOT DELETE
      await expect(
        verifyGuardAndRun(
          updateOnlyCtx,
          accountingController.deleteAccountMapping,
          () => accountingController.deleteAccountMapping(updateOnlyCtx, updateResult.data.id)
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('5.7 user with accounting.mapping.manage should manage mappings but be strictly BOUNDED away from other domains', async () => {
      const manageCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'manager@test.com',
        role: 'MANAGER',
        scopes: ['accounting.mapping.manage', 'accounting.mapping.view'],
      };

      // 1. CAN CREATE new mapping
      const created = await verifyGuardAndRun(
        manageCtx,
        accountingController.setAccountMapping,
        () =>
          accountingController.setAccountMapping(manageCtx, {
            legalEntityId: legalEntity1Id,
            mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
            accountId: vatAccountId,
            description: 'إنشاء بواسطة manage',
          })
      );
      expect(created.success).toBe(true);

      // 2. CAN UPDATE existing mapping
      const updated = await verifyGuardAndRun(
        manageCtx,
        accountingController.setAccountMapping,
        () =>
          accountingController.setAccountMapping(manageCtx, {
            legalEntityId: legalEntity1Id,
            mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
            accountId: vatAccountId,
            description: 'تحديث بواسطة manage',
          })
      );
      expect(updated.success).toBe(true);

      // 3. CAN DELETE mapping
      const deleted = await verifyGuardAndRun(
        manageCtx,
        accountingController.deleteAccountMapping,
        () => accountingController.deleteAccountMapping(manageCtx, created.data.id)
      );
      expect(deleted.success).toBe(true);

      // 4. BOUNDARY CHECK: manage scope DOES NOT grant access to Chart of Accounts administration
      await expect(
        verifyGuardAndRun(
          manageCtx,
          accountingController.deleteAccount,
          () => accountingController.deleteAccount(manageCtx, vatAccountId)
        )
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
