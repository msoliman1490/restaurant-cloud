import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { PartnersService } from './partners.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { OptionalLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateBusinessPartnerSchema,
  CreatePartnerAddressSchema,
  CreatePartnerContactSchema,
  SetPartnerCompanySettingsSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/partners')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Post()
  @RequirePermissions('partner.create')
  async createPartner(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateBusinessPartnerSchema.parse(body);
    const data = await this.partnersService.createPartner(context, dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('partner.view')
  async listPartners(
    @CurrentContext() context: TenantContext,
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.partnersService.listPartners(context, {
      role,
      search,
      status,
      sortBy,
      sortDir,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data };
  }

  @Get(':id/statement')
  @RequirePermissions('partner.view')
  async getPartnerStatement(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Query('role') role?: 'CUSTOMER' | 'VENDOR'
  ) {
    const data = await this.partnersService.getPartnerStatement(context, partnerId, role);
    return { success: true, data };
  }

  @Post(':id/roles')
  @RequirePermissions('partner.edit')
  async addPartnerRole(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Body('roleType') roleType: 'CUSTOMER' | 'VENDOR'
  ) {
    const data = await this.partnersService.addPartnerRole(context, partnerId, roleType);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermissions('partner.view')
  async getPartner(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string
  ) {
    const data = await this.partnersService.getPartner(context, partnerId, legalEntityId);
    return { success: true, data };
  }

  @Post(':id/addresses')
  @RequirePermissions('partner.edit')
  async addAddress(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Body() body: unknown
  ) {
    const dto = CreatePartnerAddressSchema.parse(body);
    const data = await this.partnersService.addAddress(context, partnerId, dto);
    return { success: true, data };
  }

  @Post(':id/contacts')
  @RequirePermissions('partner.edit')
  async addContact(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Body() body: unknown
  ) {
    const dto = CreatePartnerContactSchema.parse(body);
    const data = await this.partnersService.addContact(context, partnerId, dto);
    return { success: true, data };
  }

  @Put(':id/company-settings')
  @RequirePermissions('partner.edit')
  async setCompanySettings(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Body() body: unknown
  ) {
    const dto = SetPartnerCompanySettingsSchema.parse(body);
    const data = await this.partnersService.setCompanySettings(context, partnerId, dto);
    return { success: true, data };
  }

  @Patch(':id/hold')
  @RequirePermissions('partner.block')
  async toggleHold(
    @CurrentContext() context: TenantContext,
    @Param('id') partnerId: string,
    @Body('isHold') isHold: boolean,
    @Body('reason') reason?: string
  ) {
    const data = await this.partnersService.toggleHold(context, partnerId, isHold, reason);
    return { success: true, data };
  }
}
