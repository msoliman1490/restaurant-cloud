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
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Cash Vaults 9 Independent Granular Permissions & Scoping Spec', { timeout: 120000 }, () => {
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

  let cashAcc1Id: string;
  let cashAcc2Id: string;
  let revAccId: string;
  let expAccId: string;

  let vaultBranch1Id: string;
  let vaultBranch2Id: string;

  let tenantId: string;
  const tenantCode = `vlt-perm-${Date.now().toString(36).slice(-6)}`;

  // Helper to execute controller route through PermissionsGuard
  function createMockExecutionContext(tenantContext: TenantContext, handler: Function): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => AccountingController,
      switchToHttp: () => ({
        getRequest: () => ({ tenantContext }),
      }),
    } as unknown as ExecutionContext;
  }

  function verifyGuardAndRun<T>(
    tenantContext: TenantContext,
    handler: Function,
    action: () => Promise<T>
  ): Promise<T> {
    const mockContext = createMockExecutionContext(tenantContext, handler);
    const canActivate = permissionsGuard.canActivate(mockContext);
    if (!canActivate) {
      throw new ForbiddenException('Forbidden');
    }
    return action();
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
      displayName: `مجموعة اختبارات صلاحيات الخزائن ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'الشركة الأولى للتجارة',
        commercialName: 'First Trading Company LLC',
        vatNumber: '310111111100003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-OLAYA',
        name: 'فرع العليا',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurantcloud.sa`,
        displayName: 'مدير النظام المالي',
        password: 'Password123!Secure',
      },
    });

    tenantId = tenantResult.tenant.id;
    legalEntity1Id = tenantResult.legalEntity.id;
    branch1Id = tenantResult.branch.id;

    const rootContext: TenantContext = {
      tenantId,
      userId: tenantResult.user.id,
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      scopes: ['*'],
      permissions: ['*'],
      roles: ['TENANT_OWNER'],
    };

    // 2. Provision Second Branch under Legal Entity 1
    const br2 = await tenantService.createBranch(
      rootContext,
      {
        legalEntityId: legalEntity1Id,
        name: 'فرع الروضة',
        code: `BR-RAWDA-${Date.now().toString().slice(-4)}`,
      }
    );
    branch2Id = br2.id;

    // 3. Provision Second Legal Entity (Cross-Entity test)
    const ent2 = await tenantService.createLegalEntity(
      rootContext,
      {
        legalName: 'الشركة الثانية للخدمات المحدودة',
        commercialName: 'Second Services Company LLC',
        vatNumber: '310222222200003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      }
    );
    legalEntity2Id = ent2.id;

    // 4. Create COA accounts
    const c1 = await accountingService.createAccount(rootContext, {
      legalEntityId: legalEntity1Id,
      accountCode: '111110',
      name: 'صندوق فرع العليا',
      nameAr: 'صندوق فرع العليا',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    cashAcc1Id = c1.id;

    const c2 = await accountingService.createAccount(rootContext, {
      legalEntityId: legalEntity1Id,
      accountCode: '111120',
      name: 'صندوق فرع الروضة',
      nameAr: 'صندوق فرع الروضة',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    cashAcc2Id = c2.id;

    const rev = await accountingService.createAccount(rootContext, {
      legalEntityId: legalEntity1Id,
      accountCode: '411000',
      name: 'إيرادات المبيعات',
      nameAr: 'إيرادات المبيعات',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
      currency: 'SAR',
    });
    revAccId = rev.id;

    const exp = await accountingService.createAccount(rootContext, {
      legalEntityId: legalEntity1Id,
      accountCode: '511000',
      name: 'مصروفات الصيانة والتشغيل',
      nameAr: 'مصروفات الصيانة والتشغيل',
      accountType: AccountType.EXPENSE,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
      currency: 'SAR',
    });
    expAccId = exp.id;

    await accountingService.setAccountMapping(rootContext, {
      legalEntityId: legalEntity1Id,
      mappingKey: DefaultAccountMappingKey.ROUNDING_DIFFERENCE,
      accountId: revAccId,
    });
    await accountingService.setAccountMapping(rootContext, {
      legalEntityId: legalEntity1Id,
      mappingKey: DefaultAccountMappingKey.GENERAL_EXPENSE,
      accountId: expAccId,
    });

    // 5. Initial Vaults for branch 1 and branch 2
    const v1 = await financialResourcesService.createCashVault(rootContext, {
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      code: 'VLT-OLAYA-01',
      nameAr: 'خزينة فرع العليا الرئيسية',
      accountId: cashAcc1Id,
    });
    vaultBranch1Id = v1.id;

    const v2 = await financialResourcesService.createCashVault(rootContext, {
      legalEntityId: legalEntity1Id,
      branchId: branch2Id,
      code: 'VLT-RAWDA-01',
      nameAr: 'خزينة فرع الروضة الرئيسية',
      accountId: cashAcc2Id,
    });
    vaultBranch2Id = v2.id;

    // Seed initial balance in vault 1 via Receipt Voucher (4,000 SAR)
    await accountingService.createReceiptVoucher(rootContext, {
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      voucherNumber: `RV-INIT-${Date.now().toString().slice(-4)}`,
      payerName: 'رصيد افتتاحي أولي',
      destinationType: 'VAULT',
      destinationId: vaultBranch1Id,
      accountId: revAccId,
      amount: '4000.0000',
    });
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  // ==================================================================
  // 1. مستخدم لديه view فقط
  // ==================================================================
  it('TEST-PERM-01: User with accounting.vault.view ONLY can read details/ledger but cannot mutate', async () => {
    const viewUserContext: TenantContext = {
      tenantId,
      userId: '11111111-1111-1111-1111-111111111111',
      scopes: ['accounting.vault.view'],
    };

    // 1. CAN view list
    const listRes = await verifyGuardAndRun(viewUserContext, accountingController.listCashVaults, () =>
      accountingController.listCashVaults(viewUserContext, legalEntity1Id)
    );
    expect(listRes.success).toBe(true);
    expect(listRes.data.length).toBeGreaterThan(0);

    // 2. CAN view single details
    const getRes = await verifyGuardAndRun(viewUserContext, accountingController.getCashVault, () =>
      accountingController.getCashVault(viewUserContext, vaultBranch1Id)
    );
    expect(getRes.success).toBe(true);
    expect(getRes.data.code).toBe('VLT-OLAYA-01');

    // 3. CAN view transactions ledger
    const txRes = await verifyGuardAndRun(viewUserContext, accountingController.getVaultTransactions, () =>
      accountingController.getVaultTransactions(viewUserContext, vaultBranch1Id)
    );
    expect(txRes.success).toBe(true);
    expect(txRes.data.length).toBeGreaterThan(0);

    // 4. CANNOT create vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(viewUserContext, accountingController.createCashVault, () =>
        accountingController.createCashVault(viewUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 5. CANNOT update vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(viewUserContext, accountingController.updateCashVault, () =>
        accountingController.updateCashVault(viewUserContext, vaultBranch1Id, {})
      )
    ).toThrow(ForbiddenException);

    // 6. CANNOT transfer (Denied 403)
    expect(() =>
      verifyGuardAndRun(viewUserContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(viewUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 7. CANNOT count (Denied 403)
    expect(() =>
      verifyGuardAndRun(viewUserContext, accountingController.countCashVault, () =>
        accountingController.countCashVault(viewUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 8. CANNOT disburse (Denied 403)
    expect(() =>
      verifyGuardAndRun(viewUserContext, accountingController.createPaymentVoucher, () =>
        accountingController.createPaymentVoucher(viewUserContext, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 2. مستخدم لديه create فقط
  // ==================================================================
  it('TEST-PERM-02: User with accounting.vault.create ONLY can create vaults but cannot update or transact', async () => {
    const createUserContext: TenantContext = {
      tenantId,
      userId: '22222222-2222-2222-2222-222222222222',
      scopes: ['accounting.vault.create'],
    };

    // 1. CAN create vault
    const created = await verifyGuardAndRun(createUserContext, accountingController.createCashVault, () =>
      accountingController.createCashVault(createUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        code: `VLT-NEW-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة جديدة بالصلاحية المستقلة',
        accountId: cashAcc1Id,
      })
    );
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();

    // 2. CANNOT update vault
    expect(() =>
      verifyGuardAndRun(createUserContext, accountingController.updateCashVault, () =>
        accountingController.updateCashVault(createUserContext, created.data.id, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT transfer
    expect(() =>
      verifyGuardAndRun(createUserContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(createUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 4. CANNOT delete
    expect(() =>
      verifyGuardAndRun(createUserContext, accountingController.deleteCashVault, () =>
        accountingController.deleteCashVault(createUserContext, created.data.id)
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 3. مستخدم لديه disburse فقط
  // ==================================================================
  it('TEST-PERM-03: User with accounting.vault.disburse ONLY can issue payment vouchers within balance and scope', async () => {
    const disburseUserContext: TenantContext = {
      tenantId,
      userId: '33333333-3333-3333-3333-333333333333',
      scopes: ['accounting.vault.disburse'],
    };

    // 1. CAN issue payment voucher
    const pv = await verifyGuardAndRun(disburseUserContext, accountingController.createPaymentVoucher, () =>
      accountingController.createPaymentVoucher(disburseUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        voucherNumber: `PV-PERM-${Date.now().toString().slice(-4)}`,
        beneficiaryName: 'شركة المستلزمات اليومية',
        sourceType: 'VAULT',
        sourceId: vaultBranch1Id,
        accountId: expAccId,
        amount: '200.0000',
        notes: 'صرف مصرح لصاحب الصلاحية',
      })
    );
    expect(pv.success).toBe(true);
    expect(pv.data.id).toBeDefined();

    // 2. CANNOT issue receipt voucher (Denied 403)
    expect(() =>
      verifyGuardAndRun(disburseUserContext, accountingController.createReceiptVoucher, () =>
        accountingController.createReceiptVoucher(disburseUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT transfer funds (Denied 403)
    expect(() =>
      verifyGuardAndRun(disburseUserContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(disburseUserContext, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 4. مستخدم لديه receipt فقط
  // ==================================================================
  it('TEST-PERM-04: User with accounting.vault.receipt ONLY can issue receipt vouchers but cannot disburse', async () => {
    const receiptUserContext: TenantContext = {
      tenantId,
      userId: '44444444-4444-4444-4444-444444444444',
      scopes: ['accounting.vault.receipt'],
    };

    // 1. CAN issue receipt voucher
    const rv = await verifyGuardAndRun(receiptUserContext, accountingController.createReceiptVoucher, () =>
      accountingController.createReceiptVoucher(receiptUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        voucherNumber: `RV-PERM-${Date.now().toString().slice(-4)}`,
        payerName: 'عميل نقدي معتمد',
        destinationType: 'VAULT',
        destinationId: vaultBranch1Id,
        accountId: revAccId,
        amount: '350.0000',
        notes: 'قبض نقدي لمأمور التحصيل',
      })
    );
    expect(rv.success).toBe(true);
    expect(rv.data.id).toBeDefined();

    // 2. CANNOT issue payment voucher (Denied 403)
    expect(() =>
      verifyGuardAndRun(receiptUserContext, accountingController.createPaymentVoucher, () =>
        accountingController.createPaymentVoucher(receiptUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT update vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(receiptUserContext, accountingController.updateCashVault, () =>
        accountingController.updateCashVault(receiptUserContext, vaultBranch1Id, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 5. مستخدم لديه transfer فقط
  // ==================================================================
  it('TEST-PERM-05: User with accounting.vault.transfer ONLY can transfer funds but cannot disburse or create', async () => {
    const transferUserContext: TenantContext = {
      tenantId,
      userId: '55555555-5555-5555-5555-555555555555',
      scopes: ['accounting.vault.transfer'],
    };

    // 1. CAN transfer funds between vaults
    const trf = await verifyGuardAndRun(transferUserContext, accountingController.transferBetweenVaults, () =>
      accountingController.transferBetweenVaults(transferUserContext, {
        legalEntityId: legalEntity1Id,
        fromVaultId: vaultBranch1Id,
        toVaultId: vaultBranch2Id,
        amount: '500.0000',
        notes: 'تحويل بين الفرعين من قبل أمين التحويل',
      })
    );
    expect(trf.success).toBe(true);
    expect(trf.data.journalEntry).toBeDefined();

    // 2. CANNOT create new vaults (Denied 403)
    expect(() =>
      verifyGuardAndRun(transferUserContext, accountingController.createCashVault, () =>
        accountingController.createCashVault(transferUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT count vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(transferUserContext, accountingController.countCashVault, () =>
        accountingController.countCashVault(transferUserContext, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 6. مستخدم لديه count فقط
  // ==================================================================
  it('TEST-PERM-06: User with accounting.vault.count ONLY can audit/count but cannot manage or transfer', async () => {
    const countUserContext: TenantContext = {
      tenantId,
      userId: '66666666-6666-6666-6666-666666666666',
      scopes: ['accounting.vault.count'],
    };

    // 1. CAN execute physical count
    const countRes = await verifyGuardAndRun(countUserContext, accountingController.countCashVault, () =>
      accountingController.countCashVault(countUserContext, {
        legalEntityId: legalEntity1Id,
        vaultId: vaultBranch2Id,
        actualAmount: '500.0000',
        varianceAction: 'POST_VARIANCE',
        notes: 'جرد مطابق من قبل مدقق الجرد',
      })
    );
    expect(countRes.success).toBe(true);

    // 2. CANNOT transfer funds (Denied 403)
    expect(() =>
      verifyGuardAndRun(countUserContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(countUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT update vault metadata (Denied 403)
    expect(() =>
      verifyGuardAndRun(countUserContext, accountingController.updateCashVault, () =>
        accountingController.updateCashVault(countUserContext, vaultBranch2Id, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 7. مستخدم لديه update فقط
  // ==================================================================
  it('TEST-PERM-07: User with accounting.vault.update ONLY can update settings and toggle status', async () => {
    const updateUserContext: TenantContext = {
      tenantId,
      userId: '77777777-7777-7777-7777-777777777777',
      scopes: ['accounting.vault.update'],
    };

    // 1. CAN update vault details
    const upd = await verifyGuardAndRun(updateUserContext, accountingController.updateCashVault, () =>
      accountingController.updateCashVault(updateUserContext, vaultBranch1Id, {
        nameAr: 'خزينة فرع العليا - بعد التدقيق',
      })
    );
    expect(upd.success).toBe(true);
    expect(upd.data.nameAr).toBe('خزينة فرع العليا - بعد التدقيق');

    // 2. CANNOT create vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(updateUserContext, accountingController.createCashVault, () =>
        accountingController.createCashVault(updateUserContext, {})
      )
    ).toThrow(ForbiddenException);

    // 3. CANNOT delete vault (Denied 403)
    expect(() =>
      verifyGuardAndRun(updateUserContext, accountingController.deleteCashVault, () =>
        accountingController.deleteCashVault(updateUserContext, vaultBranch1Id)
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 8. مستخدم لديه delete فقط
  // ==================================================================
  it('TEST-PERM-08: User with accounting.vault.delete ONLY cannot delete active vault with movements, but can delete unused vault', async () => {
    const deleteUserContext: TenantContext = {
      tenantId,
      userId: '88888888-8888-8888-8888-888888888888',
      scopes: ['accounting.vault.delete', 'accounting.vault.create'], // Temporary create permission to provision virgin vault
    };

    // 1. CANNOT delete vault with movements (Rejected with BadRequestException: لا يمكن حذف خزينة تحتوي على حركات مالية)
    await expect(
      verifyGuardAndRun(deleteUserContext, accountingController.deleteCashVault, () =>
        accountingController.deleteCashVault(deleteUserContext, vaultBranch1Id)
      )
    ).rejects.toThrow(/لا يمكن حذف خزينة تحتوي على حركات مالية مسجلة/);

    // 2. Create a clean unused vault with 0 movements
    const unusedVault = await verifyGuardAndRun(deleteUserContext, accountingController.createCashVault, () =>
      accountingController.createCashVault(deleteUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        code: `VLT-EMPTY-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة عذراء للاختبار',
        accountId: cashAcc1Id,
      })
    );

    // Pure delete user (delete ONLY)
    const pureDeleteContext: TenantContext = {
      tenantId,
      userId: '88888888-8888-8888-8888-888888888888',
      scopes: ['accounting.vault.delete'],
    };

    // 3. CAN delete the clean unused vault
    const delRes = await verifyGuardAndRun(pureDeleteContext, accountingController.deleteCashVault, () =>
      accountingController.deleteCashVault(pureDeleteContext, unusedVault.data.id)
    );
    expect(delRes.success).toBe(true);

    // 4. CANNOT transfer (Denied 403)
    expect(() =>
      verifyGuardAndRun(pureDeleteContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(pureDeleteContext, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 9. اختبار صلاحية manage وتوريثها لجميع العمليات هرمياً
  // ==================================================================
  it('TEST-PERM-09: User with accounting.vault.manage inherits access to ALL vault operations seamlessly', async () => {
    const manageUserContext: TenantContext = {
      tenantId,
      userId: '99999999-9999-9999-9999-999999999999',
      scopes: ['accounting.vault.manage'],
    };

    // 1. Can view
    const listRes = await verifyGuardAndRun(manageUserContext, accountingController.listCashVaults, () =>
      accountingController.listCashVaults(manageUserContext, legalEntity1Id)
    );
    expect(listRes.success).toBe(true);

    // 2. Can create
    const created = await verifyGuardAndRun(manageUserContext, accountingController.createCashVault, () =>
      accountingController.createCashVault(manageUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        code: `VLT-MNG-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة المدير المالي',
        accountId: cashAcc1Id,
      })
    );
    expect(created.success).toBe(true);

    // 3. Can update
    const updated = await verifyGuardAndRun(manageUserContext, accountingController.updateCashVault, () =>
      accountingController.updateCashVault(manageUserContext, created.data.id, {
        nameAr: 'خزينة المدير المالي - نشطة',
      })
    );
    expect(updated.success).toBe(true);

    // 4. Can transfer
    const trf = await verifyGuardAndRun(manageUserContext, accountingController.transferBetweenVaults, () =>
      accountingController.transferBetweenVaults(manageUserContext, {
        legalEntityId: legalEntity1Id,
        fromVaultId: vaultBranch1Id,
        toVaultId: created.data.id,
        amount: '100.0000',
        notes: 'تحويل بصلاحية manage الشاملة',
      })
    );
    expect(trf.success).toBe(true);

    // 5. Can count
    const countRes = await verifyGuardAndRun(manageUserContext, accountingController.countCashVault, () =>
      accountingController.countCashVault(manageUserContext, {
        legalEntityId: legalEntity1Id,
        vaultId: created.data.id,
        actualAmount: '100.0000',
        varianceAction: 'POST_VARIANCE',
      })
    );
    expect(countRes.success).toBe(true);

    // 6. Can disburse (via voucher manage fallback)
    const pv = await verifyGuardAndRun(manageUserContext, accountingController.createPaymentVoucher, () =>
      accountingController.createPaymentVoucher(manageUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        voucherNumber: `PV-MNG-${Date.now().toString().slice(-4)}`,
        beneficiaryName: 'مصاريف إدارة الخزائن',
        sourceType: 'VAULT',
        sourceId: created.data.id,
        accountId: expAccId,
        amount: '50.0000',
      })
    );
    expect(pv.success).toBe(true);

    // 7. Can receipt
    const rv = await verifyGuardAndRun(manageUserContext, accountingController.createReceiptVoucher, () =>
      accountingController.createReceiptVoucher(manageUserContext, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        voucherNumber: `RV-MNG-${Date.now().toString().slice(-4)}`,
        payerName: 'إيداع إداري',
        destinationType: 'VAULT',
        destinationId: created.data.id,
        accountId: revAccId,
        amount: '50.0000',
      })
    );
    expect(rv.success).toBe(true);
  });

  // ==================================================================
  // 10. اختبار الرفض عند غياب الصلاحيات بالكامل
  // ==================================================================
  it('TEST-PERM-10: Rejects all vault operations with ForbiddenException when user has unrelated or empty scopes', async () => {
    const unauthorizedContext: TenantContext = {
      tenantId,
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      scopes: ['item.view', 'sales.order.create'], // Irrelevant scopes
    };

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.listCashVaults, () =>
        accountingController.listCashVaults(unauthorizedContext, legalEntity1Id)
      )
    ).toThrow(ForbiddenException);

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.createCashVault, () =>
        accountingController.createCashVault(unauthorizedContext, {})
      )
    ).toThrow(ForbiddenException);

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.updateCashVault, () =>
        accountingController.updateCashVault(unauthorizedContext, vaultBranch1Id, {})
      )
    ).toThrow(ForbiddenException);

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.deleteCashVault, () =>
        accountingController.deleteCashVault(unauthorizedContext, vaultBranch1Id)
      )
    ).toThrow(ForbiddenException);

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.transferBetweenVaults, () =>
        accountingController.transferBetweenVaults(unauthorizedContext, {})
      )
    ).toThrow(ForbiddenException);

    expect(() =>
      verifyGuardAndRun(unauthorizedContext, accountingController.countCashVault, () =>
        accountingController.countCashVault(unauthorizedContext, {})
      )
    ).toThrow(ForbiddenException);
  });

  // ==================================================================
  // 11. منع تجاوز صلاحيات الفرع والشركة القانونية (Cross-Branch & Cross-Entity Scope Verification)
  // ==================================================================
  it('TEST-PERM-11: Strictly prevents cross-branch and cross-legal-entity operations', async () => {
    // User scoped specifically to Branch 1 ONLY
    const branch1ScopedContext: TenantContext = {
      tenantId,
      userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      scopes: ['accounting.vault.manage'], // Has permission, but scoped to Branch 1!
      userScopes: [
        {
          id: 'scope-1',
          userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          tenantId,
          scopeType: 'BRANCH',
          scopeEntityId: branch1Id,
        },
      ],
    };

    // 1. Operating on Branch 1 vault -> ALLOWED
    const allowedRes = await financialResourcesService.getCashVault(branch1ScopedContext, vaultBranch1Id);
    expect(allowedRes.id).toBe(vaultBranch1Id);

    // 2. Attempting to operate on Branch 2 vault -> REJECTED with ForbiddenException (Scope violation)
    await expect(
      financialResourcesService.getCashVault(branch1ScopedContext, vaultBranch2Id)
    ).rejects.toThrow(/العملية خارج نطاق الفرع المصرح لك بالوصول إليه/);

    // 3. Attempting to transfer FROM Branch 2 vault -> REJECTED with ForbiddenException
    await expect(
      accountingService.transferBetweenVaults(branch1ScopedContext, {
        legalEntityId: legalEntity1Id,
        fromVaultId: vaultBranch2Id,
        toVaultId: vaultBranch1Id,
        amount: '10.0000',
      })
    ).rejects.toThrow(/العملية خارج نطاق الفرع المصرح لك بالوصول إليه/);

    // 4. Attempting to perform physical count on Branch 2 vault -> REJECTED with ForbiddenException
    await expect(
      accountingService.countCashVault(branch1ScopedContext, {
        legalEntityId: legalEntity1Id,
        vaultId: vaultBranch2Id,
        actualAmount: '100.0000',
      })
    ).rejects.toThrow(/العملية خارج نطاق الفرع المصرح لك بالوصول إليه/);

    // 5. Cross-Legal-Entity attack: User scoped to Legal Entity 1 attempting to create vault in Legal Entity 2
    const entity1ScopedContext: TenantContext = {
      tenantId,
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      scopes: ['accounting.vault.manage'],
      userScopes: [
        {
          id: 'scope-2',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          tenantId,
          scopeType: 'LEGAL_ENTITY',
          scopeEntityId: legalEntity1Id,
        },
      ],
    };

    await expect(
      financialResourcesService.createCashVault(entity1ScopedContext, {
        legalEntityId: legalEntity2Id, // Target foreign entity
        branchId: null,
        code: 'VLT-FOREIGN',
        nameAr: 'محاولة اختراق كيان قانوني آخر',
        accountId: cashAcc1Id,
      })
    ).rejects.toThrow(/العملية خارج نطاق (الشركة|المنشأة) القانونية المصرح لك بالوصول إليها/);
  });
});
