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
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateChartOfAccountSchema,
  UpdateChartOfAccountSchema,
  CreateJournalEntrySchema,
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
  BankReconciliationSchema,
  CreatePaymentVoucherSchema,
  CreateReceiptVoucherSchema,
  CreateExpenseSchema,
  YearEndClosingSchema,
  FinancialReportQuerySchema,
  VatReturnReportQuerySchema,
  AgingReportQuerySchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/accounting')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

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
  async getAccounts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.getChartOfAccounts(context, legalEntityId);
    return { success: true, data };
  }

  @Get('accounts/hierarchy')
  async getAccountsHierarchy(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
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
  // 2. Account Mappings
  // ==================================================================

  @Get('account-mappings')
  async getAccountMappings(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.getAccountMappings(context, legalEntityId);
    return { success: true, data };
  }

  @Post('account-mappings')
  @RequirePermissions('accounting.coa.manage')
  async setAccountMapping(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = SetAccountMappingSchema.parse(body);
    const data = await this.accountingService.setAccountMapping(context, validatedDto);
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
  async getCostCenters(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
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
  @RequirePermissions('accounting.vault.manage')
  async createCashVault(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateCashVaultSchema.parse(body);
    const data = await this.accountingService.createCashVault(context, validatedDto);
    return { success: true, data };
  }

  @Get('vaults')
  async listCashVaults(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.listCashVaults(context, legalEntityId);
    return { success: true, data };
  }

  @Post('vaults/transfer')
  @RequirePermissions('accounting.vault.manage')
  async transferBetweenVaults(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = VaultTransferSchema.parse(body);
    const data = await this.accountingService.transferBetweenVaults(context, validatedDto);
    return { success: true, data };
  }

  @Post('vaults/count')
  @RequirePermissions('accounting.vault.manage')
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
  @RequirePermissions('accounting.bank.manage')
  async createBankAccount(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateBankAccountSchema.parse(body);
    const data = await this.accountingService.createBankAccount(context, validatedDto);
    return { success: true, data };
  }

  @Get('bank-accounts')
  async listBankAccounts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.listBankAccounts(context, legalEntityId);
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

  // ==================================================================
  // 6. Payment Vouchers (سندات الصرف)
  // ==================================================================

  @Post('payment-vouchers')
  @RequirePermissions('accounting.voucher.manage')
  async createPaymentVoucher(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePaymentVoucherSchema.parse(body);
    const data = await this.accountingService.createPaymentVoucher(context, validatedDto);
    return { success: true, data };
  }

  @Get('payment-vouchers')
  async listPaymentVouchers(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.listPaymentVouchers(context, legalEntityId);
    return { success: true, data };
  }

  // ==================================================================
  // 7. Receipt Vouchers (سندات القبض)
  // ==================================================================

  @Post('receipt-vouchers')
  @RequirePermissions('accounting.voucher.manage')
  async createReceiptVoucher(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateReceiptVoucherSchema.parse(body);
    const data = await this.accountingService.createReceiptVoucher(context, validatedDto);
    return { success: true, data };
  }

  @Get('receipt-vouchers')
  async listReceiptVouchers(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
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
  async listExpenses(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.accountingService.listExpenses(context, legalEntityId);
    return { success: true, data };
  }

  // ==================================================================
  // 9. General Ledger & Journal Entries
  // ==================================================================

  @Post('journal-entries')
  @RequirePermissions('accounting.journal.post')
  async postJournalEntry(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateJournalEntrySchema.parse(body);
    const data = await this.accountingService.postJournalEntry(context, validatedDto);
    return { success: true, data };
  }

  @Get('ledger')
  async getLedger(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string,
    @Query('accountId') accountId?: string
  ) {
    const data = await this.accountingService.getGeneralLedger(context, {
      legalEntityId,
      accountId,
    });
    return { success: true, data };
  }

  @Get('trial-balance')
  async getTrialBalance(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId: string
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
  async getIncomeStatement(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = FinancialReportQuerySchema.parse(query);
    const data = await this.accountingService.getIncomeStatement(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/balance-sheet')
  async getBalanceSheet(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = FinancialReportQuerySchema.parse(query);
    const data = await this.accountingService.getBalanceSheet(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/vat-return')
  async getZatcaVatReturn(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = VatReturnReportQuerySchema.parse(query);
    const data = await this.accountingService.getZatcaVatReturn(context, validatedQuery);
    return { success: true, data };
  }

  @Get('reports/aging')
  async getAgingReport(
    @CurrentContext() context: TenantContext,
    @Query() query: any
  ) {
    const validatedQuery = AgingReportQuerySchema.parse(query);
    const data = await this.accountingService.getAgingReport(context, validatedQuery);
    return { success: true, data };
  }
}
