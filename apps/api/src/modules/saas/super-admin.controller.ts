import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SaasService } from './saas.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { SubscriptionStatus, TenantContext } from '@restaurant-cloud/domain-kernel';

const AdminUpdateSubscriptionSchema = z.object({
  planCode: z.string().min(2).max(50).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  maxBranches: z.number().int().min(1).max(1000).optional(),
  maxDevices: z.number().int().min(1).max(5000).optional(),
  maxUsers: z.number().int().min(1).max(5000).optional(),
  extendDays: z.number().int().min(1).max(3650).optional(),
  reason: z.string().max(500).optional(),
});

const UpsertPlanSchema = z.object({
  code: z.string().min(2).max(50),
  nameAr: z.string().min(2).max(120),
  nameEn: z.string().min(2).max(120),
  descriptionAr: z.string().optional(),
  descriptionEn: z.string().optional(),
  monthlyPriceSar: z.number().min(0),
  annualPriceSar: z.number().min(0),
  trialDays: z.number().int().min(0).max(365),
  maxBranches: z.number().int().min(1),
  maxDevices: z.number().int().min(1),
  maxUsers: z.number().int().min(1),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const UpsertPolicySchema = z.object({
  policyKey: z.string().min(2).max(80),
  version: z.string().min(1).max(30),
  titleAr: z.string().min(2).max(200),
  titleEn: z.string().min(2).max(200),
  contentAr: z.string().min(5),
  contentEn: z.string().min(5),
});

@Controller('api/v1/super-admin')
@UseGuards(TenantContextGuard, PlatformAdminGuard)
export class SuperAdminController {
  constructor(private readonly saasService: SaasService) {}

  @Get('overview')
  async getOverview() {
    const data = await this.saasService.getSuperAdminOverview();
    return { success: true, data };
  }

  @Get('tenants')
  async listTenants() {
    const data = await this.saasService.listAllTenants();
    return { success: true, data };
  }

  @Patch('tenants/:id/subscription')
  async updateTenantSubscription(
    @Param('id') tenantId: string,
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = AdminUpdateSubscriptionSchema.parse(body);
    const data = await this.saasService.updateTenantSubscriptionByAdmin(
      tenantId,
      context.userId,
      dto
    );
    return { success: true, data };
  }

  @Get('plans')
  async listPlans() {
    const data = await this.saasService.listAllPlans();
    return { success: true, data };
  }

  @Post('plans')
  async upsertPlan(@Body() body: unknown) {
    const dto = UpsertPlanSchema.parse(body);
    const data = await this.saasService.upsertPlan(dto);
    return { success: true, data };
  }

  @Get('invoices')
  async listInvoices() {
    const data = await this.saasService.listAllInvoices();
    return { success: true, data };
  }

  @Get('policies')
  async listPolicies() {
    const data = await this.saasService.listAllPolicies();
    return { success: true, data };
  }

  @Post('policies')
  async upsertPolicy(@Body() body: unknown) {
    const dto = UpsertPolicySchema.parse(body);
    const data = await this.saasService.upsertPolicy(dto);
    return { success: true, data };
  }

  @Get('audit-logs')
  async listAuditLogs() {
    const data = await this.saasService.listPlatformAuditLogs();
    return { success: true, data };
  }
}
