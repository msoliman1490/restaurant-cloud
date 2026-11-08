import {
  Controller,
  Post,
  Get,
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
  CreateJournalEntrySchema,
  CreateFiscalPeriodSchema,
  CloseFiscalPeriodSchema,
  ReverseJournalEntrySchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/accounting')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

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
}
