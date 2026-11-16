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
import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { bankAccounts, paymentMethods, devices, paymentTerminals, cashVaults } from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Phase 3.2 Continuation: Financial Resources & Granular RBAC Spec', { timeout: 120000 }, () => {
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

  let bankCoaId: string;
  let clearingCoaId: string;
  let vault1Id: string;
  let vault2Id: string;

  let bankAccountId: string;
  let posDeviceId: string;
  let terminalId: string;

  let tenantId: string;
  const tenantCode = `res-p32-${Date.now().toString(36).slice(-6)}`;

  function createMockExecutionContext(context: TenantContext, handler: Function): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => AccountingController,
      switchToHttp: () => ({
        getRequest: () => ({ tenantContext: context }),
      }),
    } as unknown as ExecutionContext;
  }

  async function verifyGuardAndRun<T>(
    context: TenantContext,
    handler: Function,
    action: () => Promise<T>
  ): Promise<T> {
    const mockContext = createMockExecutionContext(context, handler);
    const canActivate = permissionsGuard.canActivate(mockContext);
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
    opsFramework = new OperationsFrameworkService(dbService, auditService);
    accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
    financialResourcesService = new FinancialResourcesService(dbService, auditService, opsFramework);
    accountingController = new AccountingController(accountingService, financialResourcesService);

    reflector = new Reflector();
    permissionsGuard = new PermissionsGuard(reflector);

    // 1. Provision Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `Phase 3.2 Resources Tenant ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الموارد والتشغيل ذ.م.م',
        commercialName: 'Financial Resources LLC',
        vatNumber: '310123456700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-01',
        name: 'فرع العليا الرئيسي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        displayName: 'مدير العمليات المالية',
        password: 'Password123!Secure',
      },
    });

    tenantId = tenantResult.tenant.id;
    legalEntity1Id = tenantResult.legalEntity.id;
    branch1Id = tenantResult.branch.id;

    const sysCtx: TenantContext = {
      tenantId,
      userId: tenantResult.user.id,
      email: `admin-${tenantCode}@restaurant-cloud.test`,
      role: 'SUPER_ADMIN',
      scopes: ['*'],
    };

    // 2. Create Second Legal Entity
    const entity2 = await tenantService.createLegalEntity(sysCtx, {
      legalName: 'الشركة الشقيقة للتجزئة ذ.م.م',
      commercialName: 'Sister Retail LLC',
      vatNumber: '310999999900003',
      functionalCurrency: 'SAR',
      timezone: 'Asia/Riyadh',
    });
    legalEntity2Id = entity2.id;

    // 3. Create Second Branch under Legal Entity 2
    const b2 = await tenantService.createBranch(sysCtx, {
      legalEntityId: legalEntity2Id,
      name: 'فرع جدة التابع للشركة الثانية',
      code: `B-JEDDAH-${Date.now().toString().slice(-4)}`,
    });
    branch2Id = b2.id;

    // 4. Create COA accounts
    const bankCoa = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111101',
      name: 'حساب بنك الراجحي الرئيسي',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    bankCoaId = bankCoa.id;

    const clearingCoa = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111901',
      name: 'وسيط تسوية نقاط البيع والشبكة',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    clearingCoaId = clearingCoa.id;

    const cashCoa = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111201',
      name: 'صندوق فرع العليا',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    const cashCoa2 = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity2Id,
      accountCode: '111202',
      name: 'صندوق فرع جدة للشركة الثانية',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    // 5. Create Cash Vaults
    const vault1 = await financialResourcesService.createCashVault(sysCtx, {
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      code: 'VLT-OLAYA-01',
      nameAr: 'خزينة فرع العليا',
      type: 'BRANCH_VAULT',
      accountId: cashCoa.id,
      currency: 'SAR',
      ceilingAmount: 50000,
    });
    vault1Id = vault1.id;

    const vault2 = await financialResourcesService.createCashVault(sysCtx, {
      legalEntityId: legalEntity2Id,
      branchId: branch2Id,
      code: 'VLT-JEDDAH-02',
      nameAr: 'خزينة فرع جدة',
      type: 'BRANCH_VAULT',
      accountId: cashCoa2.id,
      currency: 'SAR',
      ceilingAmount: 50000,
    });
    vault2Id = vault2.id;
  }, 60000);

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  // ====================================================================
  // TEST SUITE 1: Bank Accounts & Multi-Branch Access Control
  // ====================================================================
  describe('1. Bank Accounts (`bank_accounts` & `bank_account_branch_access`)', () => {
    it('1.1 should create a bank account tied strictly to Legal Entity 1', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['accounting.bank.create'],
      };

      const res = await verifyGuardAndRun(adminCtx, accountingController.createBankAccount, () =>
        accountingController.createBankAccount(adminCtx, {
          legalEntityId: legalEntity1Id,
          bankName: 'مصرف الراجحي',
          accountNumber: 'SA9980000123456789012345',
          iban: 'SA9980000123456789012345',
          currency: 'SAR',
          accountId: bankCoaId,
        })
      );

      expect(res.success).toBe(true);
      expect(res.data.id).toBeDefined();
      expect(res.data.legalEntityId).toBe(legalEntity1Id);
      expect(res.data.balance).toBe('0.0000');
      bankAccountId = res.data.id;
    });

    it('1.2 should prevent duplicate account number in the same legal entity', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['accounting.bank.create'],
      };

      await expect(
        verifyGuardAndRun(adminCtx, accountingController.createBankAccount, () =>
          accountingController.createBankAccount(adminCtx, {
            legalEntityId: legalEntity1Id,
            bankName: 'مصرف الراجحي مكرر',
            accountNumber: 'SA9980000123456789012345',
            iban: 'SA9980000123456789012345',
            currency: 'SAR',
            accountId: bankCoaId,
          })
        )
      ).rejects.toThrow();
    });

    it('1.3 should list bank accounts and retrieve account details & transaction history', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000002',
        email: 'viewer@test.com',
        scopes: ['accounting.bank.view'],
      };

      const listRes = await verifyGuardAndRun(viewCtx, accountingController.listBankAccounts, () =>
        accountingController.listBankAccounts(viewCtx, legalEntity1Id)
      );
      expect(listRes.success).toBe(true);
      expect(listRes.data.length).toBeGreaterThanOrEqual(1);

      const txRes = await verifyGuardAndRun(viewCtx, accountingController.getBankAccountTransactions, () =>
        accountingController.getBankAccountTransactions(viewCtx, bankAccountId)
      );
      expect(txRes.success).toBe(true);
      expect(txRes.data.bankAccount.id).toBe(bankAccountId);
      expect(Array.isArray(txRes.data.transactions)).toBe(true);
      expect(txRes.data.transactions.length).toBe(0);
    });

    it('1.4 should configure multi-branch access for branches of the same legal entity', async () => {
      const accessCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000003',
        email: 'manager@test.com',
        scopes: ['accounting.bank.access'],
      };

      const res = await verifyGuardAndRun(accessCtx, accountingController.setBankAccountBranchAccess, () =>
        accountingController.setBankAccountBranchAccess(accessCtx, {
          legalEntityId: legalEntity1Id,
          bankAccountId,
          branchIds: [branch1Id],
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.authorizedBranchIds).toContain(branch1Id);
    });

    it('1.5 should REJECT granting branch access to a branch belonging to a different legal entity', async () => {
      const accessCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000003',
        email: 'manager@test.com',
        scopes: ['accounting.bank.access'],
      };

      await expect(
        verifyGuardAndRun(accessCtx, accountingController.setBankAccountBranchAccess, () =>
          accountingController.setBankAccountBranchAccess(accessCtx, {
            legalEntityId: legalEntity1Id,
            bankAccountId,
            branchIds: [branch2Id], // branch2Id belongs to legalEntity2Id!
          })
        )
      ).rejects.toThrow(/(شركة قانونية أخرى|Forbidden)/i);
    });

    it('1.6 should update bank account details (name, status)', async () => {
      const updateCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000004',
        email: 'updater@test.com',
        scopes: ['accounting.bank.update'],
      };

      const res = await verifyGuardAndRun(updateCtx, accountingController.updateBankAccount, () =>
        accountingController.updateBankAccount(updateCtx, bankAccountId, {
          bankName: 'مصرف الراجحي - الحساب التجاري المحدث',
          status: 'ACTIVE',
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.bankName).toBe('مصرف الراجحي - الحساب التجاري المحدث');
    });

    it('1.7 should prevent deleting a bank account if balance is not zero', async () => {
      const sysCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['*'],
      };

      // Artificially simulate a non-zero balance
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx.update(bankAccounts).set({ balance: '500.0000' }).where(eq(bankAccounts.id, bankAccountId));
      });

      const delCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000005',
        email: 'deleter@test.com',
        scopes: ['accounting.bank.delete'],
      };

      await expect(
        verifyGuardAndRun(delCtx, accountingController.deleteBankAccount, () =>
          accountingController.deleteBankAccount(delCtx, bankAccountId)
        )
      ).rejects.toThrow(/لا يمكن حذف حساب بنكي رصيده لا يساوي صفراً/);

      // Revert balance to 0.0000
      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx.update(bankAccounts).set({ balance: '0.0000' }).where(eq(bankAccounts.id, bankAccountId));
      });
    });

    it('1.8 should successfully delete an unused bank account with 0 balance and no movements', async () => {
      const delCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000005',
        email: 'deleter@test.com',
        scopes: ['accounting.bank.delete'],
      };

      const res = await verifyGuardAndRun(delCtx, accountingController.deleteBankAccount, () =>
        accountingController.deleteBankAccount(delCtx, bankAccountId)
      );
      expect(res.success).toBe(true);

      // Verify deletion in database
      const sysCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['*'],
      };
      const check = await dbService.withTenantContext(sysCtx, async (tx) => {
        return await tx.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
      });
      expect(check.length).toBe(0);
    });
  });

  // ====================================================================
  // TEST SUITE 2: Payment Methods Management
  // ====================================================================
  describe('2. Payment Methods (`payment_methods`)', () => {
    it('2.1 should auto-seed default Saudi payment methods', async () => {
      const adminCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['accounting.payment_method.manage'],
      };

      const seedRes = await verifyGuardAndRun(adminCtx, accountingController.seedDefaultPaymentMethods, () =>
        accountingController.seedDefaultPaymentMethods(adminCtx)
      );
      expect(seedRes.success).toBe(true);
      expect(seedRes.data.length).toBeGreaterThanOrEqual(6);

      const codes = seedRes.data.map((m: any) => m.code);
      expect(codes).toContain('CASH');
      expect(codes).toContain('MADA');
      expect(codes).toContain('VISA_MC');
      expect(codes).toContain('APPLE_PAY');
      expect(codes).toContain('STC_PAY');
      expect(codes).toContain('BANK_TRANSFER');
    });

    it('2.2 should list payment methods with view permission', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000002',
        email: 'viewer@test.com',
        scopes: ['accounting.payment_method.view'],
      };

      const listRes = await verifyGuardAndRun(viewCtx, accountingController.listPaymentMethods, () =>
        accountingController.listPaymentMethods(viewCtx)
      );
      expect(listRes.success).toBe(true);
      expect(listRes.data.length).toBeGreaterThanOrEqual(6);
    });

    it('2.3 should create and manage custom payment method (e.g. TAMARA)', async () => {
      const manageCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['accounting.payment_method.manage'],
      };

      const createRes = await verifyGuardAndRun(manageCtx, accountingController.createPaymentMethod, () =>
        accountingController.createPaymentMethod(manageCtx, {
          code: 'TAMARA',
          nameAr: 'تمارا - تقسيط',
          nameEn: 'Tamara Buy Now Pay Later',
          type: 'WALLET',
          requiresTerminal: false,
          requiresReference: true,
          displayOrder: 8,
        })
      );
      expect(createRes.success).toBe(true);
      expect(createRes.data.code).toBe('TAMARA');
      const customId = createRes.data.id;

      // Update
      const updateRes = await verifyGuardAndRun(manageCtx, accountingController.updatePaymentMethod, () =>
        accountingController.updatePaymentMethod(manageCtx, customId, {
          isActive: false,
          displayOrder: 10,
        })
      );
      expect(updateRes.success).toBe(true);
      expect(updateRes.data.isActive).toBe(false);

      // Delete
      const delRes = await verifyGuardAndRun(manageCtx, accountingController.deletePaymentMethod, () =>
        accountingController.deletePaymentMethod(manageCtx, customId)
      );
      expect(delRes.success).toBe(true);
    });
  });

  // ====================================================================
  // TEST SUITE 3: POS Devices Management
  // ====================================================================
  describe('3. POS Devices (`devices`)', () => {
    it('3.1 should register POS device linked to Legal Entity 1, Branch 1, and Vault 1', async () => {
      const regCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['device.register'],
      };

      const res = await verifyGuardAndRun(regCtx, accountingController.createPosDevice, () =>
        accountingController.createPosDevice(regCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceCode: 'POS-OLAYA-01',
          name: 'نقطة بيع الكاشير الرئيسي 1',
          deviceType: 'POS',
          cashVaultId: vault1Id,
          ipAddress: '192.168.1.101',
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.id).toBeDefined();
      expect(res.data.deviceCode).toBe('POS-OLAYA-01');
      posDeviceId = res.data.id;
    });

    it('3.2 should REJECT linking POS device to a Cash Vault from a different legal entity', async () => {
      const regCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['device.register'],
      };

      await expect(
        verifyGuardAndRun(regCtx, accountingController.createPosDevice, () =>
          accountingController.createPosDevice(regCtx, {
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            deviceCode: 'POS-OLAYA-02',
            name: 'نقطة بيع الكاشير 2',
            deviceType: 'POS',
            cashVaultId: vault2Id, // vault2Id belongs to legalEntity2Id!
          })
        )
      ).rejects.toThrow(/الخزينة المحددة تتبع شركة قانونية أخرى/);
    });

    it('3.3 should list POS devices scoped to legal entity and branch', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000002',
        email: 'viewer@test.com',
        scopes: ['device.view'],
      };

      const listRes = await verifyGuardAndRun(viewCtx, accountingController.listPosDevices, () =>
        accountingController.listPosDevices(viewCtx, legalEntity1Id, branch1Id)
      );
      expect(listRes.success).toBe(true);
      expect(listRes.data.length).toBeGreaterThanOrEqual(1);
      expect(listRes.data[0].deviceCode).toBe('POS-OLAYA-01');
      expect(listRes.data[0].vaultName).toBe('خزينة فرع العليا');
    });

    it('3.4 should update POS device details (IP address, status)', async () => {
      const updCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000004',
        email: 'updater@test.com',
        scopes: ['device.update'],
      };

      const res = await verifyGuardAndRun(updCtx, accountingController.updatePosDevice, () =>
        accountingController.updatePosDevice(updCtx, posDeviceId, {
          name: 'نقطة بيع الكاشير الرئيسي - محدثة',
          ipAddress: '192.168.1.150',
          status: 'ACTIVE',
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.name).toBe('نقطة بيع الكاشير الرئيسي - محدثة');
      expect(res.data.ipAddress).toBe('192.168.1.150');
    });
  });

  // ====================================================================
  // TEST SUITE 4: Payment Terminals Management (EDC Terminals)
  // ====================================================================
  describe('4. Payment Terminals (`payment_terminals`)', () => {
    it('4.1 should register EDC terminal linked to branch, clearing account, and POS device', async () => {
      const regCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['terminal.register'],
      };

      const res = await verifyGuardAndRun(regCtx, accountingController.createPaymentTerminal, () =>
        accountingController.createPaymentTerminal(regCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          terminalCode: 'EDC-GEIDEA-01',
          name: 'جهاز شبكة مدى جيديا - كاشير 1',
          provider: 'GEIDEA',
          model: 'Smart POS V2',
          serialNumber: 'SN-GD-998811',
          ipAddress: '192.168.1.201',
          linkedPosDeviceId: posDeviceId,
          clearingAccountId: clearingCoaId,
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.id).toBeDefined();
      expect(res.data.terminalCode).toBe('EDC-GEIDEA-01');
      expect(res.data.provider).toBe('GEIDEA');
      terminalId = res.data.id;
    });

    it('4.2 should REJECT registering EDC terminal with POS device from a different branch', async () => {
      const regCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'admin@test.com',
        scopes: ['terminal.register'],
      };

      await expect(
        verifyGuardAndRun(regCtx, accountingController.createPaymentTerminal, () =>
          accountingController.createPaymentTerminal(regCtx, {
            legalEntityId: legalEntity2Id,
            branchId: branch2Id, // branch 2
            terminalCode: 'EDC-NEARPAY-02',
            name: 'جهاز شبكة فرع جدة',
            provider: 'NEARPAY',
            linkedPosDeviceId: posDeviceId, // posDeviceId is from branch 1!
          })
        )
      ).rejects.toThrow(/جهاز POS المرتبط يتبع فرعاً مختلفاً عن فرع جهاز الدفع/);
    });

    it('4.3 should list payment terminals with joined branch, device, and clearing account', async () => {
      const viewCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000002',
        email: 'viewer@test.com',
        scopes: ['terminal.view'],
      };

      const listRes = await verifyGuardAndRun(viewCtx, accountingController.listPaymentTerminals, () =>
        accountingController.listPaymentTerminals(viewCtx, legalEntity1Id, branch1Id)
      );
      expect(listRes.success).toBe(true);
      expect(listRes.data.length).toBeGreaterThanOrEqual(1);
      const term = listRes.data.find((t: any) => t.id === terminalId);
      expect(term).toBeDefined();
      expect(term.terminalCode).toBe('EDC-GEIDEA-01');
      expect(term.linkedPosDeviceCode).toBe('POS-OLAYA-01');
      expect(term.clearingAccountCode).toBe('111901');
    });

    it('4.4 should update payment terminal provider and settings', async () => {
      const updCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000004',
        email: 'updater@test.com',
        scopes: ['terminal.update'],
      };

      const res = await verifyGuardAndRun(updCtx, accountingController.updatePaymentTerminal, () =>
        accountingController.updatePaymentTerminal(updCtx, terminalId, {
          name: 'جهاز شبكة مدى جيديا - محدث',
          serialNumber: 'SN-GD-998811-V2',
          status: 'ACTIVE',
        })
      );
      expect(res.success).toBe(true);
      expect(res.data.name).toBe('جهاز شبكة مدى جيديا - محدث');
      expect(res.data.serialNumber).toBe('SN-GD-998811-V2');
    });

    it('4.5 should delete payment terminal', async () => {
      const delCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000005',
        email: 'deleter@test.com',
        scopes: ['terminal.delete'],
      };

      const res = await verifyGuardAndRun(delCtx, accountingController.deletePaymentTerminal, () =>
        accountingController.deletePaymentTerminal(delCtx, terminalId)
      );
      expect(res.success).toBe(true);
    });

    it('4.6 should delete POS device', async () => {
      const delCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000005',
        email: 'deleter@test.com',
        scopes: ['device.delete'],
      };

      const res = await verifyGuardAndRun(delCtx, accountingController.deletePosDevice, () =>
        accountingController.deletePosDevice(delCtx, posDeviceId)
      );
      expect(res.success).toBe(true);
    });
  });

  // ====================================================================
  // TEST SUITE 5: Independent Granular Permissions & Hierarchical Scoping
  // ====================================================================
  describe('5. Granular RBAC Permissions Enforcements', () => {
    it('5.1 should REJECT creating bank account if user only has `accounting.bank.view`', async () => {
      const viewOnlyCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000099',
        email: 'readonly@test.com',
        scopes: ['accounting.bank.view'],
      };

      await expect(
        verifyGuardAndRun(viewOnlyCtx, accountingController.createBankAccount, () =>
          accountingController.createBankAccount(viewOnlyCtx, {
            legalEntityId: legalEntity1Id,
            bankName: 'بنك تجريبي',
            accountNumber: 'SA0000000000000000000000',
            iban: 'SA0000000000000000000000',
            currency: 'SAR',
            accountId: bankCoaId,
          })
        )
      ).rejects.toThrow(/(Access denied|Missing required permission)/);
    });

    it('5.2 should REJECT registering POS device if user only has `device.view`', async () => {
      const viewOnlyCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000099',
        email: 'readonly@test.com',
        scopes: ['device.view'],
      };

      await expect(
        verifyGuardAndRun(viewOnlyCtx, accountingController.createPosDevice, () =>
          accountingController.createPosDevice(viewOnlyCtx, {
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            deviceCode: 'POS-TEST-UNAUTH',
            name: 'جهاز غير مصرح به',
          })
        )
      ).rejects.toThrow(/(Access denied|Missing required permission)/);
    });

    it('5.3 should REJECT registering payment terminal if user only has `terminal.view`', async () => {
      const viewOnlyCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000099',
        email: 'readonly@test.com',
        scopes: ['terminal.view'],
      };

      await expect(
        verifyGuardAndRun(viewOnlyCtx, accountingController.createPaymentTerminal, () =>
          accountingController.createPaymentTerminal(viewOnlyCtx, {
            legalEntityId: legalEntity1Id,
            branchId: branch1Id,
            terminalCode: 'EDC-UNAUTH-01',
            name: 'جهاز شبكة غير مصرح به',
            provider: 'GEIDEA',
          })
        )
      ).rejects.toThrow(/(Access denied|Missing required permission)/);
    });

    it('5.4 should ALLOW bank, device, and terminal actions if user has hierarchical `.manage` permission', async () => {
      const manageCtx: TenantContext = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000088',
        email: 'manager@test.com',
        scopes: ['accounting.bank.manage', 'device.manage', 'terminal.manage'],
      };

      // 1. Bank list allowed via accounting.bank.manage
      const bRes = await verifyGuardAndRun(manageCtx, accountingController.listBankAccounts, () =>
        accountingController.listBankAccounts(manageCtx, legalEntity1Id)
      );
      expect(bRes.success).toBe(true);

      // 2. POS list allowed via device.manage
      const dRes = await verifyGuardAndRun(manageCtx, accountingController.listPosDevices, () =>
        accountingController.listPosDevices(manageCtx, legalEntity1Id)
      );
      expect(dRes.success).toBe(true);

      // 3. Terminal list allowed via terminal.manage
      const tRes = await verifyGuardAndRun(manageCtx, accountingController.listPaymentTerminals, () =>
        accountingController.listPaymentTerminals(manageCtx, legalEntity1Id)
      );
      expect(tRes.success).toBe(true);
    });
  });
});
