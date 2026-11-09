import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateTenantRequestSchema,
  CreateTenantRequest,
  CreateLegalEntityRequestSchema,
  CreateLegalEntityRequest,
  UpdateLegalEntityRequestSchema,
  UpdateLegalEntityRequest,
  CreateBranchRequestSchema,
  CreateBranchRequest,
  UpdateBranchRequestSchema,
  UpdateBranchRequest,
  UpdateTenantSettingsRequestSchema,
  UpdateTenantSettingsRequest,
  RegisterDeviceRequestSchema,
  RegisterDeviceRequest,
  ActivateIndustryPackRequestSchema,
  DeactivateIndustryPackRequestSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('tenants/onboard')
  async onboard(@Body() body: unknown) {
    const validatedDto = CreateTenantRequestSchema.parse(body);
    const result = await this.tenantService.onboardTenant(validatedDto);
    return {
      success: true,
      data: result,
    };
  }

  @Get('tenants/hierarchy')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  async getHierarchy(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getHierarchy(context);
    return {
      success: true,
      data,
    };
  }

  @Get('tenants/settings')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async getTenantSettings(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getTenantSettings(context);
    return {
      success: true,
      data,
    };
  }

  @Patch('tenants/settings')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async updateTenantSettings(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateTenantSettingsRequestSchema.parse(body);
    const data = await this.tenantService.updateTenantSettings(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Get('legal-entities')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('legal_entity.read')
  async listLegalEntities(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.listLegalEntities(context);
    return {
      success: true,
      data,
    };
  }

  @Get('legal-entities/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('legal_entity.read')
  async getLegalEntity(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.tenantService.getLegalEntity(context, id);
    return {
      success: true,
      data,
    };
  }

  @Post('legal-entities')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('legal_entity.create')
  async createLegalEntity(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateLegalEntityRequestSchema.parse(body);
    const data = await this.tenantService.createLegalEntity(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Patch('legal-entities/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('legal_entity.update')
  async updateLegalEntity(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateLegalEntityRequestSchema.parse(body);
    const data = await this.tenantService.updateLegalEntity(context, id, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Get('branches')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('branch.read')
  async listBranches(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId?: string
  ) {
    const data = await this.tenantService.listBranches(context, legalEntityId);
    return {
      success: true,
      data,
    };
  }

  @Get('branches/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('branch.read')
  async getBranch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.tenantService.getBranch(context, id);
    return {
      success: true,
      data,
    };
  }

  @Post('branches')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('branch.create')
  async createBranch(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateBranchRequestSchema.parse(body);
    const data = await this.tenantService.createBranch(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Patch('branches/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('branch.update')
  async updateBranch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateBranchRequestSchema.parse(body);
    const data = await this.tenantService.updateBranch(context, id, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Post('devices/register')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('device.register')
  async registerDevice(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = RegisterDeviceRequestSchema.parse(body);
    const data = await this.tenantService.registerDevice(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  // Multi-Industry SaaS Endpoints
  @Get('tenants/industries')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  async getIndustryPacks(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getTenantIndustryPacks(context);
    return {
      success: true,
      data,
    };
  }

  @Post('tenants/industries/activate')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async activateIndustryPack(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = ActivateIndustryPackRequestSchema.parse(body);
    const data = await this.tenantService.activateIndustryPack(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Post('tenants/industries/deactivate')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async deactivateIndustryPack(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = DeactivateIndustryPackRequestSchema.parse(body);
    const data = await this.tenantService.deactivateIndustryPack(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Get('tenants/subscription')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  async getSubscription(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getTenantSubscription(context);
    return {
      success: true,
      data,
    };
  }
}
