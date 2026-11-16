import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import {
  cashVaults,
  bankAccounts,
  bankAccountBranchAccess,
  paymentMethods,
  paymentTerminals,
  devices,
  chartOfAccounts,
  branches,
  legalEntities,
  vaultTransactions,
  paymentVouchers,
  receiptVouchers,
  bankReconciliations,
  users,
} from '@restaurant-cloud/database';
import {
  TenantContext,
  AccountType,
} from '@restaurant-cloud/domain-kernel';
import {
  CreateCashVaultRequest,
  UpdateCashVaultRequest,
  CreateBankAccountRequest,
  UpdateBankAccountRequest,
  SetBankAccountBranchAccessRequest,
  CreatePaymentMethodRequest,
  UpdatePaymentMethodRequest,
  CreatePosDeviceRequest,
  UpdatePosDeviceRequest,
  CreatePaymentTerminalRequest,
  UpdatePaymentTerminalRequest,
} from '@restaurant-cloud/shared-contracts';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';

@Injectable()
export class FinancialResourcesService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly opsFramework: OperationsFrameworkService
  ) {}

  // ====================================================================
  // A. Cash Vaults Management
  // ====================================================================

  async createCashVault(context: TenantContext, dto: CreateCashVaultRequest) {
    if (context.userScopes) {
      if (!dto.branchId) {
        const getScopeEntityId = (s: any) => s.scopeEntityId || s.scopeId;
        const hasEntityOrGlobal = context.userScopes.some(
          (s: any) =>
            s.scopeType === 'GLOBAL' ||
            s.scopeType === 'TENANT' ||
            (s.scopeType === 'LEGAL_ENTITY' && getScopeEntityId(s) === dto.legalEntityId)
        );
        if (!hasEntityOrGlobal) {
          const isBranchScoped = context.userScopes.some((s: any) => s.scopeType === 'BRANCH');
          if (isBranchScoped) {
            throw new ForbiddenException(
              'المستخدم المقيد بفرع لا يملك صلاحية إنشاء أو إدارة الخزائن المركزية على مستوى الشركة'
            );
          }
        }
      }
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId || undefined,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Verify legal entity exists
      const [le] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.id, dto.legalEntityId)))
        .limit(1);
      if (!le) throw new NotFoundException('الشركة القانونية غير موجودة');

      // 2. If branch is specified, verify branch belongs to this legal entity
      if (dto.branchId) {
        const [branch] = await tx
          .select({ id: branches.id, legalEntityId: branches.legalEntityId })
          .from(branches)
          .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, dto.branchId)))
          .limit(1);
        if (!branch) throw new NotFoundException('الفرع المحدد غير موجود');
        if (branch.legalEntityId !== dto.legalEntityId) {
          throw new BadRequestException('الفرع المحدد لا يتبع الشركة القانونية المختارة');
        }
      }

      // 3. Verify account exists in same legal entity and is postable
      const [acc] = await tx
        .select({ id: chartOfAccounts.id, isPostable: chartOfAccounts.isPostable, accountType: chartOfAccounts.accountType })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
            eq(chartOfAccounts.id, dto.accountId)
          )
        )
        .limit(1);
      if (!acc) throw new NotFoundException('حساب الأستاذ العام المحدد غير موجود في هذه الشركة');
      if (!acc.isPostable) throw new BadRequestException('لا يمكن ربط الخزينة بحساب رئيسي تجميعي غير قابل للترحيل');

      // 4. Check unique code inside legal entity
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
      if (existing) throw new ConflictException(`رمز الخزينة '${dto.code}' مسجل مسبقاً في هذه الشركة`);

      // 5. Insert vault
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
          status: 'ACTIVE',
        })
        .returning();

      return vault;
    });
  }

  async listCashVaults(context: TenantContext, legalEntityId: string, branchId?: string) {
    if (context.userScopes && branchId) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId, branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(cashVaults.tenantId, context.tenantId),
        eq(cashVaults.legalEntityId, legalEntityId),
      ];

      if (branchId) {
        // Return branch vaults AND central vaults (branchId is null) available to the company
        conditions.push(sql`(${cashVaults.branchId} = ${branchId} OR ${cashVaults.branchId} IS NULL)`);
      }

      return await tx
        .select({
          id: cashVaults.id,
          code: cashVaults.code,
          nameAr: cashVaults.nameAr,
          nameEn: cashVaults.nameEn,
          branchId: cashVaults.branchId,
          branchName: branches.name,
          accountId: cashVaults.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          balance: cashVaults.balance,
          status: cashVaults.status,
          createdAt: cashVaults.createdAt,
        })
        .from(cashVaults)
        .innerJoin(chartOfAccounts, eq(cashVaults.accountId, chartOfAccounts.id))
        .leftJoin(branches, eq(cashVaults.branchId, branches.id))
        .where(and(...conditions))
        .orderBy(asc(cashVaults.code));
    });
  }

  async getCashVault(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [vault] = await tx
        .select({
          id: cashVaults.id,
          legalEntityId: cashVaults.legalEntityId,
          code: cashVaults.code,
          nameAr: cashVaults.nameAr,
          nameEn: cashVaults.nameEn,
          branchId: cashVaults.branchId,
          branchName: branches.name,
          accountId: cashVaults.accountId,
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.name,
          custodianId: cashVaults.custodianId,
          balance: cashVaults.balance,
          status: cashVaults.status,
          createdAt: cashVaults.createdAt,
        })
        .from(cashVaults)
        .innerJoin(chartOfAccounts, eq(cashVaults.accountId, chartOfAccounts.id))
        .leftJoin(branches, eq(cashVaults.branchId, branches.id))
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, id)))
        .limit(1);

      if (!vault) throw new NotFoundException('الخزينة غير موجودة');

      if (context.userScopes && vault.branchId) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: vault.legalEntityId,
          branchId: vault.branchId,
        });
      }

      return vault;
    });
  }

  async updateCashVault(context: TenantContext, id: string, dto: UpdateCashVaultRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, id)))
        .limit(1);

      if (!vault) throw new NotFoundException('الخزينة غير موجودة');

      if (context.userScopes && vault.branchId) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: vault.legalEntityId,
          branchId: vault.branchId,
        });
      }

      const updates: any = {};
      if (dto.nameAr) updates.nameAr = dto.nameAr;
      if (dto.nameEn !== undefined) updates.nameEn = dto.nameEn;
      if (dto.custodianId !== undefined) updates.custodianId = dto.custodianId;
      if (dto.status) updates.status = dto.status;

      const [updated] = await tx
        .update(cashVaults)
        .set(updates)
        .where(eq(cashVaults.id, id))
        .returning();

      return updated;
    });
  }

  async getVaultTransactions(context: TenantContext, vaultId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, vaultId)))
        .limit(1);

      if (!vault) throw new NotFoundException('الخزينة غير موجودة');

      if (context.userScopes && vault.branchId) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: vault.legalEntityId,
          branchId: vault.branchId,
        });
      }

      const rows = await tx
        .select({
          id: vaultTransactions.id,
          vaultId: vaultTransactions.vaultId,
          transactionType: vaultTransactions.transactionType,
          amount: vaultTransactions.amount,
          balanceAfter: vaultTransactions.balanceAfter,
          sourceDocumentType: vaultTransactions.sourceDocumentType,
          sourceDocumentId: vaultTransactions.sourceDocumentId,
          notes: vaultTransactions.notes,
          createdAt: vaultTransactions.createdAt,
          performedBy: vaultTransactions.performedBy,
          performedByName: users.displayName,
          performedByEmail: users.email,
        })
        .from(vaultTransactions)
        .leftJoin(users, eq(vaultTransactions.performedBy, users.id))
        .where(and(eq(vaultTransactions.tenantId, context.tenantId), eq(vaultTransactions.vaultId, vaultId)))
        .orderBy(desc(vaultTransactions.createdAt));

      return rows;
    });
  }

  async deleteCashVault(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, id)))
        .limit(1);

      if (!vault) throw new NotFoundException('الخزينة غير موجودة');

      // Rule 1: Prohibit deleting vaults with financial movements
      const [hasTx] = await tx
        .select({ id: vaultTransactions.id })
        .from(vaultTransactions)
        .where(eq(vaultTransactions.vaultId, id))
        .limit(1);

      if (hasTx) {
        throw new BadRequestException('لا يمكن حذف خزينة تحتوي على حركات مالية مسجلة. يمكنك تعطيل حالتها فقط.');
      }

      // Rule 2: Strict non-zero balance prevention
      if (parseFloat(vault.balance) !== 0) {
        throw new BadRequestException(
          `لا يمكن حذف خزينة رصيدها غير صفري (الرصيد الحالي: ${parseFloat(vault.balance).toFixed(4)} SAR). يجب تسوية الرصيد أولاً.`
        );
      }

      // Rule 3: Payment vouchers check
      const [hasPaymentVoucher] = await tx
        .select({ id: paymentVouchers.id })
        .from(paymentVouchers)
        .where(and(eq(paymentVouchers.sourceType, 'VAULT'), eq(paymentVouchers.sourceId, id)))
        .limit(1);

      if (hasPaymentVoucher) {
        throw new BadRequestException('لا يمكن حذف خزينة مرتبطة بسندات صرف. يمكنك تعطيل حالتها فقط.');
      }

      // Rule 4: Receipt vouchers check
      const [hasReceiptVoucher] = await tx
        .select({ id: receiptVouchers.id })
        .from(receiptVouchers)
        .where(and(eq(receiptVouchers.destinationType, 'VAULT'), eq(receiptVouchers.destinationId, id)))
        .limit(1);

      if (hasReceiptVoucher) {
        throw new BadRequestException('لا يمكن حذف خزينة مرتبطة بسندات قبض وإيداع. يمكنك تعطيل حالتها فقط.');
      }

      // Rule 5: Linked POS devices check
      const [hasDevice] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.cashVaultId, id))
        .limit(1);

      if (hasDevice) {
        throw new BadRequestException('لا يمكن حذف خزينة مرتبطة بأجهزة نقاط البيع POS. قم بفك الارتباط أولاً.');
      }

      await tx.delete(cashVaults).where(eq(cashVaults.id, id));
      return { success: true, message: 'تم حذف الخزينة بنجاح' };
    });
  }

  // ====================================================================
  // B. Bank Accounts & Branch Access Management
  // ====================================================================

  async createBankAccount(context: TenantContext, dto: CreateBankAccountRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId: dto.legalEntityId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Check unique account number in legal entity
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

      if (existing) {
        throw new ConflictException(`رقم الحساب البنكي '${dto.accountNumber}' مسجل مسبقاً في هذه الشركة`);
      }

      // 2. Verify account exists in COA
      const [acc] = await tx
        .select({ id: chartOfAccounts.id, isPostable: chartOfAccounts.isPostable })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId),
            eq(chartOfAccounts.id, dto.accountId)
          )
        )
        .limit(1);

      if (!acc) throw new NotFoundException('حساب الأستاذ العام المحدد غير موجود');
      if (!acc.isPostable) throw new BadRequestException('لا يمكن ربط الحساب البنكي بحساب رئيسي تجميعي');

      // 3. Create bank account
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
          balance: '0.0000',
          status: 'ACTIVE',
        })
        .returning();

      if (!bank) throw new Error('فشل إنشاء الحساب البنكي');

      // 4. If initial branch access list is provided, grant access
      if (dto.authorizedBranchIds && dto.authorizedBranchIds.length > 0) {
        const accessRecords = dto.authorizedBranchIds.map((bId) => ({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          bankAccountId: bank.id,
          branchId: bId,
          isActive: true,
        }));
        await tx.insert(bankAccountBranchAccess).values(accessRecords).onConflictDoNothing();
      }

      return bank;
    });
  }

  async listBankAccounts(context: TenantContext, legalEntityId: string, branchId?: string) {
    if (context.userScopes && branchId) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId, branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // If branchId is specified, filter bank accounts that are authorized for this branch OR have no branch restrictions
      const banks = await tx
        .select({
          id: bankAccounts.id,
          legalEntityId: bankAccounts.legalEntityId,
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
          createdAt: bankAccounts.createdAt,
        })
        .from(bankAccounts)
        .innerJoin(chartOfAccounts, eq(bankAccounts.accountId, chartOfAccounts.id))
        .where(
          and(
            eq(bankAccounts.tenantId, context.tenantId),
            eq(bankAccounts.legalEntityId, legalEntityId)
          )
        )
        .orderBy(asc(bankAccounts.bankName));

      // Get branch access mappings for all banks in this legal entity
      const accessList = await tx
        .select({
          bankAccountId: bankAccountBranchAccess.bankAccountId,
          branchId: bankAccountBranchAccess.branchId,
          branchName: branches.name,
          isActive: bankAccountBranchAccess.isActive,
        })
        .from(bankAccountBranchAccess)
        .innerJoin(branches, eq(bankAccountBranchAccess.branchId, branches.id))
        .where(
          and(
            eq(bankAccountBranchAccess.tenantId, context.tenantId),
            eq(bankAccountBranchAccess.legalEntityId, legalEntityId)
          )
        );

      // Group access mappings by bank account
      const accessMap = new Map<string, any[]>();
      for (const item of accessList) {
        const arr = accessMap.get(item.bankAccountId) || [];
        arr.push(item);
        accessMap.set(item.bankAccountId, arr);
      }

      const enriched = banks.map((b) => {
        const authorizedBranches = accessMap.get(b.id) || [];
        const isAuthorizedForBranch = branchId
          ? authorizedBranches.length === 0 || authorizedBranches.some((ab) => ab.branchId === branchId && ab.isActive)
          : true;
        return {
          ...b,
          authorizedBranches,
          isAuthorizedForBranch,
        };
      });

      if (branchId) {
        return enriched.filter((b) => b.isAuthorizedForBranch);
      }
      return enriched;
    });
  }

  async getBankAccount(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, id)))
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');

      const authorizedBranches = await tx
        .select({
          branchId: bankAccountBranchAccess.branchId,
          branchName: branches.name,
          branchCode: branches.code,
          isActive: bankAccountBranchAccess.isActive,
        })
        .from(bankAccountBranchAccess)
        .innerJoin(branches, eq(bankAccountBranchAccess.branchId, branches.id))
        .where(and(eq(bankAccountBranchAccess.tenantId, context.tenantId), eq(bankAccountBranchAccess.bankAccountId, id)));

      return { ...bank, authorizedBranches };
    });
  }

  async updateBankAccount(context: TenantContext, id: string, dto: UpdateBankAccountRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, id)))
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId: bank.legalEntityId });
      }

      const updates: any = {};
      if (dto.bankName) updates.bankName = dto.bankName;
      if (dto.iban !== undefined) updates.iban = dto.iban;
      if (dto.swiftCode !== undefined) updates.swiftCode = dto.swiftCode;
      if (dto.status) updates.status = dto.status;

      const [updated] = await tx
        .update(bankAccounts)
        .set(updates)
        .where(eq(bankAccounts.id, id))
        .returning();

      return updated;
    });
  }

  async setBankAccountBranchAccess(context: TenantContext, dto: SetBankAccountBranchAccessRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId: dto.legalEntityId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Verify bank account exists in this legal entity
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.tenantId, context.tenantId),
            eq(bankAccounts.legalEntityId, dto.legalEntityId),
            eq(bankAccounts.id, dto.bankAccountId)
          )
        )
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود في هذه الشركة');

      // 2. Verify all branches belong to the same legal entity
      if (dto.branchIds.length > 0) {
        const branchCheck = await tx
          .select({ id: branches.id, legalEntityId: branches.legalEntityId })
          .from(branches)
          .where(and(eq(branches.tenantId, context.tenantId), inArray(branches.id, dto.branchIds)));

        if (branchCheck.length !== dto.branchIds.length) {
          throw new BadRequestException('بعض الفروع المحددة غير موجودة');
        }

        const foreignBranch = branchCheck.find((b) => b.legalEntityId !== dto.legalEntityId);
        if (foreignBranch) {
          throw new ForbiddenException('لا يمكن منح صلاحية حساب بنكي لفرع يتبع شركة قانونية أخرى');
        }
      }

      // 3. Replace access mappings atomically
      await tx
        .delete(bankAccountBranchAccess)
        .where(
          and(
            eq(bankAccountBranchAccess.tenantId, context.tenantId),
            eq(bankAccountBranchAccess.bankAccountId, dto.bankAccountId)
          )
        );

      if (dto.branchIds.length > 0) {
        const records = dto.branchIds.map((bId) => ({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          bankAccountId: dto.bankAccountId,
          branchId: bId,
          isActive: true,
        }));
        await tx.insert(bankAccountBranchAccess).values(records);
      }

      return {
        bankAccountId: dto.bankAccountId,
        authorizedBranchIds: dto.branchIds,
        message: 'تم تحديث صلاحيات الفروع للحساب البنكي بنجاح',
      };
    });
  }

  async deleteBankAccount(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, id)))
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: bank.legalEntityId,
        });
      }

      if (Number(bank.balance) !== 0) {
        throw new BadRequestException('لا يمكن حذف حساب بنكي رصيده لا يساوي صفراً');
      }

      const [hasPayment] = await tx
        .select({ id: paymentVouchers.id })
        .from(paymentVouchers)
        .where(
          and(
            eq(paymentVouchers.tenantId, context.tenantId),
            eq(paymentVouchers.sourceType, 'BANK'),
            eq(paymentVouchers.sourceId, id)
          )
        )
        .limit(1);

      if (hasPayment) {
        throw new BadRequestException('لا يمكن حذف الحساب البنكي لوجود سندات صرف مرتبطة به');
      }

      const [hasReceipt] = await tx
        .select({ id: receiptVouchers.id })
        .from(receiptVouchers)
        .where(
          and(
            eq(receiptVouchers.tenantId, context.tenantId),
            eq(receiptVouchers.destinationType, 'BANK'),
            eq(receiptVouchers.destinationId, id)
          )
        )
        .limit(1);

      if (hasReceipt) {
        throw new BadRequestException('لا يمكن حذف الحساب البنكي لوجود سندات قبض مرتبطة به');
      }

      const [hasRecon] = await tx
        .select({ id: bankReconciliations.id })
        .from(bankReconciliations)
        .where(
          and(
            eq(bankReconciliations.tenantId, context.tenantId),
            eq(bankReconciliations.bankAccountId, id)
          )
        )
        .limit(1);

      if (hasRecon) {
        throw new BadRequestException('لا يمكن حذف الحساب البنكي لوجود تسويات بنكية مرتبطة به');
      }

      await tx
        .delete(bankAccountBranchAccess)
        .where(
          and(
            eq(bankAccountBranchAccess.tenantId, context.tenantId),
            eq(bankAccountBranchAccess.bankAccountId, id)
          )
        );

      await tx.delete(bankAccounts).where(eq(bankAccounts.id, id));

      return { success: true, message: 'تم حذف الحساب البنكي بنجاح' };
    });
  }

  async getBankAccountTransactions(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.tenantId, context.tenantId), eq(bankAccounts.id, id)))
        .limit(1);

      if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: bank.legalEntityId,
        });
      }

      const payments = await tx
        .select({
          id: paymentVouchers.id,
          date: paymentVouchers.voucherDate,
          voucherNumber: paymentVouchers.voucherNumber,
          amount: paymentVouchers.amount,
          description: paymentVouchers.notes,
          status: paymentVouchers.status,
          createdAt: paymentVouchers.createdAt,
        })
        .from(paymentVouchers)
        .where(
          and(
            eq(paymentVouchers.tenantId, context.tenantId),
            eq(paymentVouchers.sourceType, 'BANK'),
            eq(paymentVouchers.sourceId, id)
          )
        );

      const receipts = await tx
        .select({
          id: receiptVouchers.id,
          date: receiptVouchers.voucherDate,
          voucherNumber: receiptVouchers.voucherNumber,
          amount: receiptVouchers.amount,
          description: receiptVouchers.notes,
          status: receiptVouchers.status,
          createdAt: receiptVouchers.createdAt,
        })
        .from(receiptVouchers)
        .where(
          and(
            eq(receiptVouchers.tenantId, context.tenantId),
            eq(receiptVouchers.destinationType, 'BANK'),
            eq(receiptVouchers.destinationId, id)
          )
        );

      const transactions = [
        ...payments.map((p) => ({
          ...p,
          type: 'PAYMENT',
          direction: 'OUT',
        })),
        ...receipts.map((r) => ({
          ...r,
          type: 'RECEIPT',
          direction: 'IN',
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        bankAccount: bank,
        transactions,
      };
    });
  }

  // ====================================================================
  // C. Payment Methods Management (Saudi Market Standard)
  // ====================================================================

  async seedDefaultPaymentMethods(context: TenantContext) {
    const defaults = [
      { code: 'CASH', nameAr: 'نقداً', nameEn: 'Cash', type: 'CASH', displayOrder: 1, requiresTerminal: false, requiresReference: false },
      { code: 'MADA', nameAr: 'مدى', nameEn: 'Mada Debit Card', type: 'CARD', displayOrder: 2, requiresTerminal: true, requiresReference: false },
      { code: 'VISA_MC', nameAr: 'فيزا / ماستركارد', nameEn: 'Visa / Mastercard', type: 'CARD', displayOrder: 3, requiresTerminal: true, requiresReference: false },
      { code: 'APPLE_PAY', nameAr: 'أبل باي', nameEn: 'Apple Pay', type: 'WALLET', displayOrder: 4, requiresTerminal: true, requiresReference: false },
      { code: 'STC_PAY', nameAr: 'إس تي سي باي', nameEn: 'STC Pay', type: 'WALLET', displayOrder: 5, requiresTerminal: false, requiresReference: true },
      { code: 'BANK_TRANSFER', nameAr: 'تحويل بنكي', nameEn: 'Bank Transfer', type: 'BANK_TRANSFER', displayOrder: 6, requiresTerminal: false, requiresReference: true },
      { code: 'DELIVERY_AGGREGATOR', nameAr: 'تطبيقات التوصيل', nameEn: 'Delivery Aggregators', type: 'AGGREGATOR', displayOrder: 7, requiresTerminal: false, requiresReference: true },
    ];

    return await this.dbService.withTenantContext(context, async (tx) => {
      const inserted: any[] = [];
      for (const d of defaults) {
        const [row] = await tx
          .insert(paymentMethods)
          .values({
            tenantId: context.tenantId,
            ...d,
            isActive: true,
          })
          .onConflictDoNothing()
          .returning();

        if (row) inserted.push(row);
      }
      return inserted;
    });
  }

  async listPaymentMethods(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      let list = await tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.tenantId, context.tenantId))
        .orderBy(asc(paymentMethods.displayOrder), asc(paymentMethods.code));

      // Auto-seed defaults if list is completely empty for this tenant
      if (list.length === 0) {
        await this.seedDefaultPaymentMethods(context);
        list = await tx
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.tenantId, context.tenantId))
          .orderBy(asc(paymentMethods.displayOrder), asc(paymentMethods.code));
      }

      return list;
    });
  }

  async createPaymentMethod(context: TenantContext, dto: CreatePaymentMethodRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.code, dto.code)))
        .limit(1);

      if (existing) {
        throw new ConflictException(`طريقة الدفع '${dto.code}' مسجلة مسبقاً في هذا المستأجر`);
      }

      const [method] = await tx
        .insert(paymentMethods)
        .values({
          tenantId: context.tenantId,
          code: dto.code.toUpperCase(),
          nameAr: dto.nameAr,
          nameEn: dto.nameEn || null,
          type: dto.type,
          displayOrder: dto.displayOrder ?? 0,
          isActive: dto.isActive ?? true,
          requiresTerminal: dto.requiresTerminal ?? false,
          requiresReference: dto.requiresReference ?? false,
        })
        .returning();

      return method;
    });
  }

  async updatePaymentMethod(context: TenantContext, id: string, dto: UpdatePaymentMethodRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const updates: any = { updatedAt: new Date() };
      if (dto.nameAr) updates.nameAr = dto.nameAr;
      if (dto.nameEn !== undefined) updates.nameEn = dto.nameEn;
      if (dto.type) updates.type = dto.type;
      if (dto.displayOrder !== undefined) updates.displayOrder = dto.displayOrder;
      if (dto.isActive !== undefined) updates.isActive = dto.isActive;
      if (dto.requiresTerminal !== undefined) updates.requiresTerminal = dto.requiresTerminal;
      if (dto.requiresReference !== undefined) updates.requiresReference = dto.requiresReference;

      const [updated] = await tx
        .update(paymentMethods)
        .set(updates)
        .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.id, id)))
        .returning();

      if (!updated) throw new NotFoundException('طريقة الدفع غير موجودة');
      return updated;
    });
  }

  async deletePaymentMethod(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [deleted] = await tx
        .delete(paymentMethods)
        .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.id, id)))
        .returning({ id: paymentMethods.id });

      if (!deleted) throw new NotFoundException('طريقة الدفع غير موجودة');
      return { success: true, message: 'تم حذف طريقة الدفع بنجاح' };
    });
  }

  // ====================================================================
  // D. POS Devices Management
  // ====================================================================

  async createPosDevice(context: TenantContext, dto: CreatePosDeviceRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Verify branch belongs to legal entity
      const [branch] = await tx
        .select({ id: branches.id, legalEntityId: branches.legalEntityId })
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, dto.branchId)))
        .limit(1);

      if (!branch) throw new NotFoundException('الفرع المحدد غير موجود');
      if (branch.legalEntityId !== dto.legalEntityId) {
        throw new ForbiddenException('الفرع المحدد لا يتبع الشركة القانونية المختارة');
      }

      // 2. If cashVaultId is specified, verify vault belongs to this legal entity and branch
      if (dto.cashVaultId) {
        const [vault] = await tx
          .select({ id: cashVaults.id, legalEntityId: cashVaults.legalEntityId, branchId: cashVaults.branchId })
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.cashVaultId)))
          .limit(1);

        if (!vault) throw new NotFoundException('الخزينة المحددة غير موجودة');
        if (vault.legalEntityId !== dto.legalEntityId) {
          throw new ForbiddenException('الخزينة المحددة تتبع شركة قانونية أخرى');
        }
        if (vault.branchId && vault.branchId !== dto.branchId) {
          throw new ForbiddenException('الخزينة المحددة مرتبطة بفرع آخر');
        }
      }

      // 3. Check unique device code per branch
      const [existing] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, context.tenantId),
            eq(devices.branchId, dto.branchId),
            eq(devices.deviceCode, dto.deviceCode)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`رمز الجهاز '${dto.deviceCode}' مسجل مسبقاً في هذا الفرع`);
      }

      // 4. Insert device
      const [device] = await tx
        .insert(devices)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          deviceCode: dto.deviceCode,
          name: dto.name || `جهاز POS - ${dto.deviceCode}`,
          deviceType: dto.deviceType || 'POS',
          cashVaultId: dto.cashVaultId || null,
          ipAddress: dto.ipAddress || null,
          status: 'ACTIVE',
        })
        .returning();

      return device;
    });
  }

  async listPosDevices(context: TenantContext, legalEntityId: string, branchId?: string) {
    if (context.userScopes && branchId) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId, branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(devices.tenantId, context.tenantId),
        eq(devices.legalEntityId, legalEntityId),
      ];

      if (branchId) {
        conditions.push(eq(devices.branchId, branchId));
      }

      return await tx
        .select({
          id: devices.id,
          deviceCode: devices.deviceCode,
          name: devices.name,
          deviceType: devices.deviceType,
          legalEntityId: devices.legalEntityId,
          branchId: devices.branchId,
          branchName: branches.name,
          cashVaultId: devices.cashVaultId,
          vaultName: cashVaults.nameAr,
          vaultCode: cashVaults.code,
          ipAddress: devices.ipAddress,
          status: devices.status,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
        })
        .from(devices)
        .innerJoin(branches, eq(devices.branchId, branches.id))
        .leftJoin(cashVaults, eq(devices.cashVaultId, cashVaults.id))
        .where(and(...conditions))
        .orderBy(asc(devices.deviceCode));
    });
  }

  async updatePosDevice(context: TenantContext, id: string, dto: UpdatePosDeviceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [device] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, id)))
        .limit(1);

      if (!device) throw new NotFoundException('جهاز نقطة البيع غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: device.legalEntityId || undefined,
          branchId: device.branchId,
        });
      }

      const updates: any = {};
      if (dto.name !== undefined) updates.name = dto.name;
      if (dto.ipAddress !== undefined) updates.ipAddress = dto.ipAddress;
      if (dto.status) updates.status = dto.status;

      if (dto.cashVaultId !== undefined) {
        if (dto.cashVaultId) {
          const [vault] = await tx
            .select()
            .from(cashVaults)
            .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, dto.cashVaultId)))
            .limit(1);

          if (!vault) throw new NotFoundException('الخزينة المحددة غير موجودة');
          if (device.legalEntityId && vault.legalEntityId !== device.legalEntityId) {
            throw new ForbiddenException('الخزينة المحددة تتبع شركة قانونية أخرى');
          }
          if (vault.branchId && vault.branchId !== device.branchId) {
            throw new ForbiddenException('الخزينة المحددة تتبع فرعاً آخر');
          }
        }
        updates.cashVaultId = dto.cashVaultId || null;
      }

      const [updated] = await tx
        .update(devices)
        .set(updates)
        .where(eq(devices.id, id))
        .returning();

      return updated;
    });
  }

  async deletePosDevice(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [device] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, id)))
        .limit(1);

      if (!device) throw new NotFoundException('جهاز نقطة البيع غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: device.legalEntityId || undefined,
          branchId: device.branchId,
        });
      }

      await tx.delete(devices).where(eq(devices.id, id));
      return { success: true, message: 'تم حذف جهاز نقطة البيع بنجاح' };
    });
  }

  // ====================================================================
  // E. Payment Terminals Management (EDC Terminals)
  // ====================================================================

  async createPaymentTerminal(context: TenantContext, dto: CreatePaymentTerminalRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Verify branch belongs to legal entity
      const [branch] = await tx
        .select({ id: branches.id, legalEntityId: branches.legalEntityId })
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, dto.branchId)))
        .limit(1);

      if (!branch) throw new NotFoundException('الفرع المحدد غير موجود');
      if (branch.legalEntityId !== dto.legalEntityId) {
        throw new ForbiddenException('الفرع المحدد لا يتبع الشركة القانونية المختارة');
      }

      // 2. Check unique terminal code in legal entity
      const [existing] = await tx
        .select({ id: paymentTerminals.id })
        .from(paymentTerminals)
        .where(
          and(
            eq(paymentTerminals.tenantId, context.tenantId),
            eq(paymentTerminals.legalEntityId, dto.legalEntityId),
            eq(paymentTerminals.terminalCode, dto.terminalCode)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`رمز جهاز الدفع '${dto.terminalCode}' مسجل مسبقاً في هذه الشركة`);
      }

      // 3. If linkedPosDeviceId specified, verify POS device belongs to same branch
      if (dto.linkedPosDeviceId) {
        const [dev] = await tx
          .select({ id: devices.id, branchId: devices.branchId })
          .from(devices)
          .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.linkedPosDeviceId)))
          .limit(1);

        if (!dev) throw new NotFoundException('جهاز POS المرتبط غير موجود');
        if (dev.branchId !== dto.branchId) {
          throw new ForbiddenException('جهاز POS المرتبط يتبع فرعاً مختلفاً عن فرع جهاز الدفع');
        }
      }

      // 4. Insert payment terminal
      const [terminal] = await tx
        .insert(paymentTerminals)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          terminalCode: dto.terminalCode,
          name: dto.name,
          provider: dto.provider || 'GEIDEA',
          model: dto.model || null,
          serialNumber: dto.serialNumber || null,
          ipAddress: dto.ipAddress || null,
          linkedPosDeviceId: dto.linkedPosDeviceId || null,
          clearingAccountId: dto.clearingAccountId || null,
          status: 'ACTIVE',
        })
        .returning();

      return terminal;
    });
  }

  async listPaymentTerminals(context: TenantContext, legalEntityId: string, branchId?: string) {
    if (context.userScopes && branchId) {
      this.opsFramework.verifyScope(context, context.userScopes, { legalEntityId, branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(paymentTerminals.tenantId, context.tenantId),
        eq(paymentTerminals.legalEntityId, legalEntityId),
      ];

      if (branchId) {
        conditions.push(eq(paymentTerminals.branchId, branchId));
      }

      return await tx
        .select({
          id: paymentTerminals.id,
          terminalCode: paymentTerminals.terminalCode,
          name: paymentTerminals.name,
          provider: paymentTerminals.provider,
          model: paymentTerminals.model,
          serialNumber: paymentTerminals.serialNumber,
          ipAddress: paymentTerminals.ipAddress,
          legalEntityId: paymentTerminals.legalEntityId,
          branchId: paymentTerminals.branchId,
          branchName: branches.name,
          linkedPosDeviceId: paymentTerminals.linkedPosDeviceId,
          linkedPosDeviceName: devices.name,
          linkedPosDeviceCode: devices.deviceCode,
          clearingAccountId: paymentTerminals.clearingAccountId,
          clearingAccountCode: chartOfAccounts.accountCode,
          clearingAccountName: chartOfAccounts.name,
          status: paymentTerminals.status,
          createdAt: paymentTerminals.createdAt,
        })
        .from(paymentTerminals)
        .innerJoin(branches, eq(paymentTerminals.branchId, branches.id))
        .leftJoin(devices, eq(paymentTerminals.linkedPosDeviceId, devices.id))
        .leftJoin(chartOfAccounts, eq(paymentTerminals.clearingAccountId, chartOfAccounts.id))
        .where(and(...conditions))
        .orderBy(asc(paymentTerminals.terminalCode));
    });
  }

  async updatePaymentTerminal(context: TenantContext, id: string, dto: UpdatePaymentTerminalRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [term] = await tx
        .select()
        .from(paymentTerminals)
        .where(and(eq(paymentTerminals.tenantId, context.tenantId), eq(paymentTerminals.id, id)))
        .limit(1);

      if (!term) throw new NotFoundException('جهاز الدفع الإلكتروني غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: term.legalEntityId,
          branchId: term.branchId,
        });
      }

      const updates: any = { updatedAt: new Date() };
      if (dto.name) updates.name = dto.name;
      if (dto.provider) updates.provider = dto.provider;
      if (dto.model !== undefined) updates.model = dto.model;
      if (dto.serialNumber !== undefined) updates.serialNumber = dto.serialNumber;
      if (dto.ipAddress !== undefined) updates.ipAddress = dto.ipAddress;
      if (dto.status) updates.status = dto.status;
      if (dto.linkedPosDeviceId !== undefined) updates.linkedPosDeviceId = dto.linkedPosDeviceId || null;
      if (dto.clearingAccountId !== undefined) updates.clearingAccountId = dto.clearingAccountId || null;

      const [updated] = await tx
        .update(paymentTerminals)
        .set(updates)
        .where(eq(paymentTerminals.id, id))
        .returning();

      return updated;
    });
  }

  async deletePaymentTerminal(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [term] = await tx
        .select()
        .from(paymentTerminals)
        .where(and(eq(paymentTerminals.tenantId, context.tenantId), eq(paymentTerminals.id, id)))
        .limit(1);

      if (!term) throw new NotFoundException('جهاز الدفع الإلكتروني غير موجود');

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: term.legalEntityId,
          branchId: term.branchId,
        });
      }

      await tx.delete(paymentTerminals).where(eq(paymentTerminals.id, id));
      return { success: true, message: 'تم حذف جهاز الدفع الإلكتروني بنجاح' };
    });
  }
}
