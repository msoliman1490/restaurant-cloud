import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  OptionalLegalEntityIdPipe,
  RequiredLegalEntityIdPipe,
} from '../../common/pipes/legal-entity-id.pipe';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import {
  CreateSettlementProviderSchema,
  UpdateSettlementProviderSchema,
  ImportSettlementStatementSchema,
  ResolveSettlementDiscrepancySchema,
  PostSettlementBatchSchema,
} from '@restaurant-cloud/shared-contracts';

@Controller('api/v1/settlements')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Get('providers')
  @RequirePermissions('accounting.bank.view')
  listProviders(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string
  ) {
    return this.settlementsService.listProviders(context, { legalEntityId, category, isActive });
  }

  @Post('providers')
  @RequirePermissions('accounting.bank.manage')
  createProvider(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const parsed = CreateSettlementProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.settlementsService.createProvider(context, parsed.data);
  }

  @Patch('providers/:id')
  @RequirePermissions('accounting.bank.manage')
  updateProvider(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const parsed = UpdateSettlementProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.settlementsService.updateProvider(context, id, parsed.data);
  }

  @Post('providers/seed-defaults')
  @RequirePermissions('accounting.bank.manage')
  seedDefaults(
    @CurrentContext() context: TenantContext,
    @Body('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    if (!legalEntityId) {
      throw new BadRequestException('legalEntityId مطلوب');
    }
    return this.settlementsService.seedDefaultProviders(context, legalEntityId);
  }

  @Post('import')
  @RequirePermissions('accounting.bank.manage')
  importStatement(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const parsed = ImportSettlementStatementSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.settlementsService.importStatement(context, parsed.data);
  }

  @Get('batches')
  @RequirePermissions('accounting.bank.view')
  listBatches(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('providerId') providerId?: string,
    @Query('settlementType') settlementType?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.settlementsService.listBatches(context, {
      legalEntityId,
      branchId,
      providerId,
      settlementType,
      status,
      dateFrom,
      dateTo,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('batches/:id')
  @RequirePermissions('accounting.bank.view')
  getBatchDetails(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('matchStatus') matchStatus?: string
  ) {
    return this.settlementsService.getBatchDetails(context, id, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      matchStatus,
    });
  }

  @Post('batches/:id/post')
  @RequirePermissions('accounting.journal.post')
  postBatch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const parsed = PostSettlementBatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.settlementsService.postSettlementBatch(context, id, parsed.data);
  }

  @Get('discrepancies')
  @RequirePermissions('accounting.bank.view')
  listDiscrepancies(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.settlementsService.listDiscrepancies(context, {
      legalEntityId,
      batchId,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @Patch('discrepancies/:id/resolve')
  @RequirePermissions('accounting.bank.manage')
  resolveDiscrepancy(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const parsed = ResolveSettlementDiscrepancySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.settlementsService.resolveDiscrepancy(context, id, parsed.data);
  }

  @Get('summary')
  @RequirePermissions('accounting.bank.view')
  getSummary(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    if (!legalEntityId) {
      throw new BadRequestException('legalEntityId مطلوب');
    }
    return this.settlementsService.getReconciliationSummary(context, legalEntityId);
  }
}
