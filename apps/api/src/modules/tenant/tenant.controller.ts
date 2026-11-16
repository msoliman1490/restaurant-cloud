import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { z } from 'zod';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { OptionalLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
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
  @RequirePermissions('tenant.read')
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
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string
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
  @RequirePermissions('tenant.read')
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
  @RequirePermissions('tenant.read')
  async getSubscription(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getTenantSubscription(context);
    return {
      success: true,
      data,
    };
  }

  @Get('tenants/integrations')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async getIntegrations(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getTenantIntegrations(context);
    return { success: true, data };
  }

  @Patch('tenants/integrations/:channel')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async upsertIntegration(
    @CurrentContext() context: TenantContext,
    @Param('channel') channel: string,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        provider: z.string().min(1).max(100).optional(),
        isEnabled: z.boolean(),
        configJson: z.record(z.any()).optional(),
      })
      .parse(body);
    const data = await this.tenantService.upsertTenantIntegration(context, channel, validated);
    return { success: true, data };
  }

  @Post('tenants/notifications/dispatch')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async dispatchNotification(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        channel: z.string().min(1).max(64),
        recipient: z.string().min(1).max(255),
        eventType: z.string().min(1).max(120),
        payload: z.record(z.any()).optional(),
        branchId: z.string().uuid().optional(),
        idempotencyKey: z.string().max(128).optional(),
      })
      .parse(body);
    const data = await this.tenantService.dispatchNotification(context, validated);
    return { success: true, data };
  }

  @Get('tenants/notifications')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async getNotifications(
    @CurrentContext() context: TenantContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.tenantService.getNotificationLogs(
      context,
      limit ? parseInt(limit, 10) : 25,
      offset ? parseInt(offset, 10) : 0
    );
    return { success: true, data };
  }

  @Post('tenants/notifications/retry')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async retryNotifications(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.retryPendingNotifications(context);
    return { success: true, data };
  }

  @Get('tenants/whatsapp-templates')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async listWhatsappTemplates(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.listWhatsappTemplates(context);
    return { success: true, data };
  }

  @Post('tenants/whatsapp-templates')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async upsertWhatsappTemplate(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        id: z.string().uuid().optional(),
        templateKey: z.string().min(2).max(80),
        nameAr: z.string().min(2).max(160),
        nameEn: z.string().min(2).max(160),
        metaTemplateName: z.string().min(2).max(120),
        languageCode: z.string().min(2).max(10).default('ar'),
        category: z.enum(['UTILITY', 'AUTHENTICATION', 'MARKETING']).default('UTILITY'),
        headerText: z.string().max(300).nullable().optional(),
        bodyText: z.string().min(3).max(2000),
        footerText: z.string().max(300).nullable().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(body);
    const data = await this.tenantService.upsertWhatsappTemplate(context, validated);
    return { success: true, data };
  }

  @Delete('tenants/whatsapp-templates/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async deleteWhatsappTemplate(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.tenantService.deleteWhatsappTemplate(context, id);
    return { success: true, data };
  }

  @Post('tenants/whatsapp-templates/preview')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async previewWhatsappTemplate(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        templateId: z.string().uuid().optional(),
        templateKey: z.string().min(2).max(80).optional(),
        variables: z.record(z.string()).optional(),
      })
      .parse(body);
    const data = await this.tenantService.previewWhatsappTemplate(context, validated);
    return { success: true, data };
  }

  @Post('tenants/integrations/webhook/verify')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async verifyWebhook(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validated = z
      .object({
        channel: z.string().min(1).max(64).optional(),
        timestamp: z.number(),
        rawBody: z.string(),
        signatureHeader: z.string().min(1),
        nonce: z.string().max(128).optional(),
        messageId: z.string().max(128).optional(),
      })
      .parse(body);
    const data = await this.tenantService.verifyWebhookSignature(context, validated);
    return { success: true, data };
  }

  @Post('tenants/integrations/rotate-keys')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.update')
  async rotateIntegrationKeys(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.rotateIntegrationSecrets(context);
    return { success: true, data };
  }

  @Get('tenants/dashboard-summary')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('tenant.read')
  async getDashboardSummary(@CurrentContext() context: TenantContext) {
    const data = await this.tenantService.getDashboardSummary(context);
    return { success: true, data };
  }
}
