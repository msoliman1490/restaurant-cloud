import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { z } from 'zod';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, RequireAnyPermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  OptionalLegalEntityIdPipe,
  RequiredLegalEntityIdPipe,
} from '../../common/pipes/legal-entity-id.pipe';
import {
  CreateChartOfAccountSchema,
  UpdateChartOfAccountSchema,
  CreateJournalEntrySchema,
  UpdateDraftJournalEntrySchema,
  QueryJournalEntriesSchema,
  BankTransferSchema,
  CreateFiscalPeriodSchema,
  CloseFiscalPeriodSchema,
  ReverseJournalEntrySchema,
  CreateCostCenterSchema,
  UpdateCostCenterSchema,
  SetAccountMappingSchema,
  CreateCashVaultSchema,
  UpdateCashVaultSchema,
  VaultTransferSchema,
  VaultPhysicalCountSchema,
  CreateBankAccountSchema,
  UpdateBankAccountSchema,
  SetBankAccountBranchAccessSchema,
  BankReconciliationSchema,
  CreatePaymentMethodSchema,
  UpdatePaymentMethodSchema,
  CreatePosDeviceSchema,
  UpdatePosDeviceSchema,
  CreatePaymentTerminalSchema,
  UpdatePaymentTerminalSchema,
  CreatePaymentVoucherSchema,
  CreateReceiptVoucherSchema,
  CreateExpenseSchema,
  YearEndClosingSchema,
  FinancialReportQuerySchema,
  VatReturnReportQuerySchema,
  AgingReportQuerySchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, ReconciliationCategory } from '@restaurant-cloud/domain-kernel';
import { FinancialResourcesService } from './financial-resources.service';
import { ReconciliationService } from './reconciliation.service';
import { PeriodClosingService } from './period-closing.service';

@Controller('api/v1/accounting')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class AccountingController {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly financialResourcesService: FinancialResourcesService,
    private readonly reconciliationService: ReconciliationService,
    private readonly periodClosingService: PeriodClosingService
  ) {}

  // ==================================================================
  // 1. Chart of Accounts (COA)
  // ==================================================================

  @Post('accounts')
  @RequirePermissions('accounting.coa.manage')
  async createAccount(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateChartOfAccountSchema.parse(body);
    const data = await this.accountingService.createAccount(context, validatedDto);
    return { success: true, data };
  }

  @Get('accounts')
  @RequirePermissions('accounting.read')
  async getAccounts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.getChartOfAccounts(context, legalEntityId);
    return { success: true, data };
  }

  @Get('accounts/next-code')
  @RequirePermissions('accounting.read')
  async getNextAccountCode(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('parentId') parentId?: string,
    @Query('accountType') accountType?: string
  ) {
    const data = await this.accountingService.getNextAccountCode(context, {
      legalEntityId,
      parentId: parentId || undefined,
      accountType: accountType || undefined,
    });
    return { success: true, data };
  }

  @Get('accounts/hierarchy')
  @RequirePermissions('accounting.read')
  async getAccountsHierarchy(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.getChartOfAccountsHierarchy(context, legalEntityId);
    return { success: true, data };
  }

  @Put('accounts/:id')
  @RequirePermissions('accounting.coa.manage')
  async updateAccount(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateChartOfAccountSchema.parse(body);
    const data = await this.accountingService.updateAccount(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('accounts/:id')
  @RequirePermissions('accounting.coa.manage')
  async deleteAccount(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.accountingService.deleteAccount(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // 2. Account Mappings & Branch Overrides (Phase 3.3)
  // ==================================================================

  @Get('account-mappings')
  @RequirePermissions('accounting.mapping.view')
  async getAccountMappings(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
    @Query('includeEffective') includeEffective?: string
  ) {
    const data = await this.accountingService.getAccountMappings(
      context,
      legalEntityId,
      branchId,
      includeEffective === 'true'
    );
    return { success: true, data };
  }

  @Get('account-mappings/resolve')
  @RequirePermissions('accounting.mapping.view')
  async resolveAccountMapping(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('mappingKey') mappingKey: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.accountingService.resolveAccount(context, {
      legalEntityId,
      branchId: branchId || null,
      mappingKey,
    });
    return { success: true, data };
  }

  @Post('account-mappings')
  @RequireAnyPermissions('accounting.mapping.create', 'accounting.mapping.update', 'accounting.mapping.manage')
  async setAccountMapping(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = SetAccountMappingSchema.parse(body);
    const data = await this.accountingService.setAccountMapping(context, validatedDto);
    return { success: true, data };
  }

  @Delete('account-mappings/:id')
  @RequirePermissions('accounting.mapping.delete')
  async deleteAccountMapping(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.accountingService.deleteAccountMapping(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // 3. Cost Centers
  // ==================================================================

  @Post('cost-centers')
  @RequirePermissions('accounting.coa.manage')
  async createCostCenter(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateCostCenterSchema.parse(body);
    const data = await this.accountingService.createCostCenter(context, validatedDto);
    return { success: true, data };
  }

  @Get('cost-centers')
  @RequirePermissions('accounting.read')
  async getCostCenters(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.getCostCenters(context, legalEntityId);
    return { success: true, data };
  }

  @Put('cost-centers/:id')
  @RequirePermissions('accounting.coa.manage')
  async updateCostCenter(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateCostCenterSchema.parse(body);
    const data = await this.accountingService.updateCostCenter(context, id, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // 4. Cash Vaults & Safes
  // ==================================================================

  @Post('vaults')
  @RequirePermissions('accounting.vault.create')
  async createCashVault(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateCashVaultSchema.parse(body);
    const data = await this.financialResourcesService.createCashVault(context, validatedDto);
    return { success: true, data };
  }

  @Get('vaults')
  @RequirePermissions('accounting.vault.view')
  async listCashVaults(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.financialResourcesService.listCashVaults(context, legalEntityId, branchId);
    return { success: true, data };
  }

  @Get('vaults/:id')
  @RequirePermissions('accounting.vault.view')
  async getCashVault(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.getCashVault(context, id);
    return { success: true, data };
  }

  @Get('vaults/:id/transactions')
  @RequirePermissions('accounting.vault.view')
  async getVaultTransactions(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.getVaultTransactions(context, id);
    return { success: true, data };
  }

  @Put('vaults/:id')
  @RequirePermissions('accounting.vault.update')
  async updateCashVault(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateCashVaultSchema.parse(body);
    const data = await this.financialResourcesService.updateCashVault(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('vaults/:id')
  @RequirePermissions('accounting.vault.delete')
  async deleteCashVault(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.deleteCashVault(context, id);
    return { success: true, data };
  }

  @Post('vaults/transfer')
  @RequirePermissions('accounting.vault.transfer')
  async transferBetweenVaults(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = VaultTransferSchema.parse(body);
    const data = await this.accountingService.transferBetweenVaults(context, validatedDto);
    return { success: true, data };
  }

  @Post('vaults/count')
  @RequirePermissions('accounting.vault.count')
  async countCashVault(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = VaultPhysicalCountSchema.parse(body);
    const data = await this.accountingService.countCashVault(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // 5. Bank Accounts & Reconciliations
  // ==================================================================

  @Post('bank-accounts')
  @RequirePermissions('accounting.bank.create')
  async createBankAccount(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateBankAccountSchema.parse(body);
    const data = await this.financialResourcesService.createBankAccount(context, validatedDto);
    return { success: true, data };
  }

  @Get('bank-accounts')
  @RequirePermissions('accounting.bank.view')
  async listBankAccounts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.financialResourcesService.listBankAccounts(context, legalEntityId, branchId);
    return { success: true, data };
  }

  @Get('bank-accounts/:id')
  @RequirePermissions('accounting.bank.view')
  async getBankAccount(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.getBankAccount(context, id);
    return { success: true, data };
  }

  @Get('bank-accounts/:id/transactions')
  @RequirePermissions('accounting.bank.view')
  async getBankAccountTransactions(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.getBankAccountTransactions(context, id);
    return { success: true, data };
  }

  @Put('bank-accounts/:id')
  @RequirePermissions('accounting.bank.update')
  async updateBankAccount(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateBankAccountSchema.parse(body);
    const data = await this.financialResourcesService.updateBankAccount(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('bank-accounts/:id')
  @RequirePermissions('accounting.bank.delete')
  async deleteBankAccount(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.deleteBankAccount(context, id);
    return { success: true, data };
  }

  @Post('bank-accounts/branch-access')
  @RequirePermissions('accounting.bank.access')
  async setBankAccountBranchAccess(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = SetBankAccountBranchAccessSchema.parse(body);
    const data = await this.financialResourcesService.setBankAccountBranchAccess(context, validatedDto);
    return { success: true, data };
  }

  @Post('bank-accounts/reconcile')
  @RequirePermissions('accounting.bank.manage')
  async reconcileBankAccount(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = BankReconciliationSchema.parse(body);
    const data = await this.accountingService.reconcileBankAccount(context, validatedDto);
    return { success: true, data };
  }

  @Post('bank-accounts/transfer')
  @RequirePermissions('accounting.bank.manage')
  async transferFunds(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = BankTransferSchema.parse(body);
    const data = await this.accountingService.bankTransfer(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // 6. Payment Methods (Saudi Market Standard)
  // ==================================================================

  @Get('payment-methods')
  @RequirePermissions('accounting.payment_method.view')
  async listPaymentMethods(@CurrentContext() context: TenantContext) {
    const data = await this.financialResourcesService.listPaymentMethods(context);
    return { success: true, data };
  }

  @Post('payment-methods')
  @RequirePermissions('accounting.payment_method.manage')
  async createPaymentMethod(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePaymentMethodSchema.parse(body);
    const data = await this.financialResourcesService.createPaymentMethod(context, validatedDto);
    return { success: true, data };
  }

  @Put('payment-methods/:id')
  @RequirePermissions('accounting.payment_method.manage')
  async updatePaymentMethod(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdatePaymentMethodSchema.parse(body);
    const data = await this.financialResourcesService.updatePaymentMethod(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('payment-methods/:id')
  @RequirePermissions('accounting.payment_method.manage')
  async deletePaymentMethod(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.deletePaymentMethod(context, id);
    return { success: true, data };
  }

  @Post('payment-methods/seed-defaults')
  @RequirePermissions('accounting.payment_method.manage')
  async seedDefaultPaymentMethods(@CurrentContext() context: TenantContext) {
    const data = await this.financialResourcesService.seedDefaultPaymentMethods(context);
    return { success: true, data };
  }

  // ==================================================================
  // 7. POS Devices Management
  // ==================================================================

  @Get('pos-devices')
  @RequirePermissions('device.view')
  async listPosDevices(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.financialResourcesService.listPosDevices(context, legalEntityId, branchId);
    return { success: true, data };
  }

  @Post('pos-devices')
  @RequirePermissions('device.register')
  async createPosDevice(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePosDeviceSchema.parse(body);
    const data = await this.financialResourcesService.createPosDevice(context, validatedDto);
    return { success: true, data };
  }

  @Put('pos-devices/:id')
  @RequirePermissions('device.update')
  async updatePosDevice(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdatePosDeviceSchema.parse(body);
    const data = await this.financialResourcesService.updatePosDevice(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('pos-devices/:id')
  @RequirePermissions('device.delete')
  async deletePosDevice(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.deletePosDevice(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // 8. Payment Terminals Management (EDC Terminals)
  // ==================================================================

  @Get('payment-terminals')
  @RequirePermissions('terminal.view')
  async listPaymentTerminals(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.financialResourcesService.listPaymentTerminals(context, legalEntityId, branchId);
    return { success: true, data };
  }

  @Post('payment-terminals')
  @RequirePermissions('terminal.register')
  async createPaymentTerminal(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePaymentTerminalSchema.parse(body);
    const data = await this.financialResourcesService.createPaymentTerminal(context, validatedDto);
    return { success: true, data };
  }

  @Put('payment-terminals/:id')
  @RequirePermissions('terminal.update')
  async updatePaymentTerminal(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdatePaymentTerminalSchema.parse(body);
    const data = await this.financialResourcesService.updatePaymentTerminal(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('payment-terminals/:id')
  @RequirePermissions('terminal.delete')
  async deletePaymentTerminal(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.financialResourcesService.deletePaymentTerminal(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // 6. Payment Vouchers (سندات الصرف)
  // ==================================================================

  @Post('payment-vouchers')
  @RequirePermissions('accounting.vault.disburse')
  async createPaymentVoucher(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePaymentVoucherSchema.parse(body);
    const data = await this.accountingService.createPaymentVoucher(context, validatedDto);
    return { success: true, data };
  }

  @Get('payment-vouchers')
  @RequirePermissions('accounting.read')
  async listPaymentVouchers(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.listPaymentVouchers(context, legalEntityId);
    return { success: true, data };
  }

  // ==================================================================
  // 7. Receipt Vouchers (سندات القبض)
  // ==================================================================

  @Post('receipt-vouchers')
  @RequirePermissions('accounting.vault.receipt')
  async createReceiptVoucher(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateReceiptVoucherSchema.parse(body);
    const data = await this.accountingService.createReceiptVoucher(context, validatedDto);
    return { success: true, data };
  }

  @Get('receipt-vouchers')
  @RequirePermissions('accounting.read')
  async listReceiptVouchers(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.listReceiptVouchers(context, legalEntityId);
    return { success: true, data };
  }

  // ==================================================================
  // 8. Expenses (المصروفات التشغيلية)
  // ==================================================================

  @Post('expenses')
  @RequirePermissions('accounting.expense.manage')
  async createExpense(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateExpenseSchema.parse(body);
    const data = await this.accountingService.createExpense(context, validatedDto);
    return { success: true, data };
  }

  @Get('expenses')
  @RequirePermissions('accounting.read')
  async listExpenses(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.listExpenses(context, legalEntityId);
    return { success: true, data };
  }

  // ==================================================================
  // 9. General Ledger & Journal Entries
  // ==================================================================

  @Get('journal-entries')
  @RequirePermissions('accounting.read')
  async listJournalEntries(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = QueryJournalEntriesSchema.parse(query);
    const data = await this.accountingService.listJournalEntries(context, validatedQuery);
    return { success: true, data };
  }

  @Get('journal-entries/:id')
  @RequirePermissions('accounting.read')
  async getJournalEntry(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.accountingService.getJournalEntryById(context, id);
    return { success: true, data };
  }

  @Post('journal-entries')
  @RequirePermissions('accounting.journal.post')
  async createJournalEntry(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateJournalEntrySchema.parse(body);
    const data = await this.accountingService.createJournalEntry(context, validatedDto);
    return { success: true, data };
  }

  @Put('journal-entries/:id')
  @RequirePermissions('accounting.journal.post')
  async updateDraftJournalEntry(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateDraftJournalEntrySchema.parse(body);
    const data = await this.accountingService.updateDraftJournalEntry(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('journal-entries/:id')
  @RequirePermissions('accounting.journal.post')
  async deleteDraftJournalEntry(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.accountingService.deleteDraftJournalEntry(context, id);
    return { success: true, data };
  }

  @Post('journal-entries/:id/post')
  @RequirePermissions('accounting.journal.post')
  async postDraftJournalEntry(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.accountingService.postDraftJournalEntry(context, id);
    return { success: true, data };
  }

  @Get('ledger')
  @RequirePermissions('accounting.read')
  async getLedger(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('accountId') accountId?: string
  ) {
    const data = await this.accountingService.getGeneralLedger(context, {
      legalEntityId,
      accountId,
    });
    return { success: true, data };
  }

  @Get('trial-balance')
  @RequirePermissions('accounting.read')
  async getTrialBalance(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.accountingService.getTrialBalance(context, legalEntityId);
    return { success: true, data };
  }

  @Post('journal-entries/reverse')
  @RequirePermissions('accounting.journal.reverse')
  async reverseJournalEntry(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = ReverseJournalEntrySchema.parse(body);
    const data = await this.accountingService.reverseJournalEntry(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // 10. Fiscal Periods & Year-End Closing
  // ==================================================================

  @Post('fiscal-periods')
  @RequirePermissions('accounting.period.manage')
  async createFiscalPeriod(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateFiscalPeriodSchema.parse(body);
    const data = await this.accountingService.createFiscalPeriod(context, validatedDto);
    return { success: true, data };
  }

  @Post('fiscal-periods/close')
  @RequirePermissions('accounting.period.manage')
  async closeFiscalPeriod(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CloseFiscalPeriodSchema.parse(body);
    const data = await this.accountingService.closeFiscalPeriod(context, validatedDto);
    return { success: true, data };
  }

  @Post('fiscal-periods/year-end-close')
  @RequirePermissions('accounting.period.manage')
  async closeFiscalYear(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = YearEndClosingSchema.parse(body);
    const data = await this.accountingService.closeFiscalYear(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // 11. Financial Statements & Reports
  // ==================================================================

  @Get('reports/income-statement')
  @RequirePermissions('accounting.read')
  async getIncomeStatement(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = FinancialReportQuerySchema.parse(query);
    const data = await this.accountingService.getIncomeStatement(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/balance-sheet')
  @RequirePermissions('accounting.read')
  async getBalanceSheet(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = FinancialReportQuerySchema.parse(query);
    const data = await this.accountingService.getBalanceSheet(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/vat-return')
  @RequirePermissions('accounting.read')
  async getZatcaVatReturn(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = VatReturnReportQuerySchema.parse(query);
    const data = await this.accountingService.getZatcaVatReturn(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/aging')
  @RequirePermissions('accounting.read')
  async getAgingReport(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = AgingReportQuerySchema.parse(query);
    const data = await this.accountingService.getAgingReport(context, validatedQuery);
    return { success: true, data };
  }

  // ==================================================================
  // 10. Phase 3.5 — Financial Reconciliation & Hierarchical Reporting
  // ==================================================================

  @Get('reports/trial-balance-hierarchy')
  @RequireAnyPermissions('accounting.reports.view', 'accounting.ledger.view', 'accounting.manage')
  async getHierarchicalTrialBalance(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('accountType') accountType?: string,
    @Query('search') search?: string,
    @Query('includeZeroBalances') includeZeroBalances?: string
  ) {
    const data = await this.accountingService.getHierarchicalTrialBalance(context, {
      legalEntityId,
      branchId: branchId || undefined,
      fiscalPeriodId: fiscalPeriodId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accountId: accountId || undefined,
      accountType: accountType || undefined,
      search: search || undefined,
      includeZeroBalances: includeZeroBalances !== 'false',
    });
    return { success: true, data };
  }

  @Get('reports/general-ledger')
  @RequireAnyPermissions('accounting.reports.view', 'accounting.ledger.view', 'accounting.manage')
  async getGeneralLedgerReport(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
    @Query('accountId') accountId?: string,
    @Query('journalType') journalType?: string,
    @Query('sourceType') sourceType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.accountingService.getGeneralLedgerReport(context, {
      legalEntityId,
      branchId: branchId || undefined,
      accountId: accountId || undefined,
      journalType: journalType || undefined,
      sourceType: sourceType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return { success: true, data };
  }

  @Get('reports/account-statement')
  @RequireAnyPermissions('accounting.reports.view', 'accounting.ledger.view', 'accounting.manage')
  async getAccountStatement(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('accountId') accountId: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.accountingService.getAccountStatement(context, {
      legalEntityId,
      accountId,
      branchId: branchId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return { success: true, data };
  }

  @Get('reports/drill-down/:journalEntryId')
  @RequireAnyPermissions('accounting.reports.view', 'accounting.ledger.view', 'accounting.manage')
  async getJournalSourceDetails(
    @CurrentContext() context: TenantContext,
    @Param('journalEntryId') journalEntryId: string
  ) {
    const data = await this.accountingService.getJournalSourceDetails(context, journalEntryId);
    return { success: true, data };
  }

  @Get('reconciliation/live')
  @RequireAnyPermissions('accounting.reconciliation.view', 'accounting.reports.view', 'accounting.manage')
  async previewReconciliation(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('category') category?: ReconciliationCategory
  ) {
    const data = await this.reconciliationService.previewReconciliation(context, {
      legalEntityId,
      branchId: branchId || undefined,
      asOfDate: asOfDate || undefined,
      category: category || undefined,
    });
    return { success: true, data };
  }

  @Post('reconciliation/runs')
  @RequireAnyPermissions('accounting.reconciliation.manage', 'accounting.manage')
  async runReconciliation(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        legalEntityId: z.string().uuid(),
        branchId: z.string().uuid().optional(),
        asOfDate: z.string().optional(),
        category: z.string().optional(),
        idempotencyKey: z.string().max(128).optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(body);
    const data = await this.reconciliationService.runReconciliation(context, {
      ...validated,
      category: validated.category as ReconciliationCategory | undefined,
    });
    return { success: true, data };
  }

  @Get('reconciliation/runs')
  @RequireAnyPermissions('accounting.reconciliation.view', 'accounting.reports.view', 'accounting.manage')
  async getReconciliationRuns(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.reconciliationService.getReconciliationRuns(context, {
      legalEntityId: legalEntityId || undefined,
      branchId: branchId || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return { success: true, data };
  }

  @Get('reconciliation/items')
  @RequireAnyPermissions('accounting.reconciliation.view', 'accounting.reports.view', 'accounting.manage')
  async getReconciliationItems(
    @CurrentContext() context: TenantContext,
    @Query('runId') runId?: string,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.reconciliationService.getReconciliationItems(context, {
      runId: runId || undefined,
      legalEntityId: legalEntityId || undefined,
      category: category || undefined,
      status: status || undefined,
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  @Get('reconciliation/discrepancies')
  @RequireAnyPermissions('accounting.reconciliation.view', 'accounting.reports.view', 'accounting.manage')
  async getUnresolvedDiscrepancies(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.reconciliationService.getUnresolvedDiscrepancies(context, {
      legalEntityId,
      branchId: branchId || undefined,
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  // ==================================================================
  // Phase 3.6 — Financial Period Closing Engine
  // ==================================================================

  @Post('fiscal-years')
  @RequirePermissions('accounting.period.manage')
  async createFiscalYear(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        legalEntityId: z.string().uuid(),
        yearCode: z.string().min(1).max(32),
        yearName: z.string().min(1).max(120),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
        generateMonthlyPeriods: z.boolean().optional(),
      })
      .parse(body);
    const data = await this.periodClosingService.createFiscalYear(context, validated);
    return { success: true, data };
  }

  @Get('fiscal-years')
  @RequireAnyPermissions('accounting.period.view', 'accounting.period.manage', 'accounting.reports.view')
  async listFiscalYears(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.periodClosingService.listFiscalYears(context, {
      legalEntityId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  @Get('fiscal-periods')
  @RequireAnyPermissions('accounting.period.view', 'accounting.period.manage', 'accounting.reports.view')
  async listFiscalPeriods(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('fiscalYearId') fiscalYearId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.periodClosingService.listFiscalPeriods(context, {
      legalEntityId,
      fiscalYearId: fiscalYearId || undefined,
      status: status || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  @Get('fiscal-periods/closing-logs')
  @RequireAnyPermissions('accounting.period.view', 'accounting.period.manage', 'accounting.reports.view')
  async getPeriodClosingLogs(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('periodId') periodId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.periodClosingService.getClosingLogs(context, {
      legalEntityId,
      periodId: periodId || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  @Post('fiscal-periods/:id/pre-check')
  @RequireAnyPermissions('accounting.period.manage', 'accounting.period.close')
  async preCheckFiscalPeriod(
    @CurrentContext() context: TenantContext,
    @Param('id') periodId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.periodClosingService.runPreClosingChecks(context, periodId, branchId || undefined);
    return { success: true, data };
  }

  @Post('fiscal-periods/:id/close')
  @RequireAnyPermissions('accounting.period.close', 'accounting.period.manage')
  async closePeriodWithChecks(
    @CurrentContext() context: TenantContext,
    @Param('id') periodId: string,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        branchId: z.string().uuid().optional(),
        notes: z.string().max(1000).optional(),
        idempotencyKey: z.string().max(128).optional(),
      })
      .optional()
      .default({})
      .parse(body);
    const data = await this.periodClosingService.closeFiscalPeriod(context, {
      periodId,
      branchId: validated.branchId,
      notes: validated.notes,
      idempotencyKey: validated.idempotencyKey,
    });
    return { success: true, data };
  }

  @Post('fiscal-periods/:id/reopen')
  @RequirePermissions('accounting.period.reopen')
  async reopenFiscalPeriod(
    @CurrentContext() context: TenantContext,
    @Param('id') periodId: string,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().max(128).optional(),
      })
      .parse(body);
    const data = await this.periodClosingService.reopenFiscalPeriod(context, {
      periodId,
      reason: validated.reason,
      idempotencyKey: validated.idempotencyKey,
    });
    return { success: true, data };
  }

  @Get('fiscal-periods/:id/pending-items')
  @RequireAnyPermissions('accounting.period.view', 'accounting.period.manage', 'accounting.reports.view')
  async getPendingPeriodItems(
    @CurrentContext() context: TenantContext,
    @Param('id') periodId: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.periodClosingService.getPendingItemsReport(context, periodId, {
      type: type || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    return { success: true, data };
  }

  @Get('fiscal-periods/:id/final-trial-balance')
  @RequireAnyPermissions('accounting.period.view', 'accounting.period.manage', 'accounting.reports.view')
  async getPeriodFinalTrialBalance(
    @CurrentContext() context: TenantContext,
    @Param('id') periodId: string,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.periodClosingService.getFinalTrialBalanceReport(context, periodId, branchId || undefined);
    return { success: true, data };
  }
}
