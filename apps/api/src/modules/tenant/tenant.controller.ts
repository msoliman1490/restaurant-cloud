import {
  Controller,
  Post,
  Get,
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
  CreateBranchRequestSchema,
  CreateBranchRequest,
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
