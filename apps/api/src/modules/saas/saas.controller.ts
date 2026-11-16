import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Headers,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SaasService } from './saas.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

const CheckoutSchema = z.object({
  planCode: z.string().min(2).max(50),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
  provider: z.string().max(40).optional(),
});

const WebhookSchema = z.object({
  providerEventId: z.string().min(3).max(120),
  eventType: z.enum(['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED']),
  checkoutSessionId: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
  provider: z.string().optional(),
  providerTransactionId: z.string().optional(),
  failureReason: z.string().optional(),
});

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

const AutoRenewSchema = z.object({
  autoRenew: z.boolean(),
});

const OnboardingProgressSchema = z.object({
  currentStep: z.string().max(50).optional(),
  completedSteps: z.array(z.string()).optional(),
  isCompleted: z.boolean().optional(),
  skipped: z.boolean().optional(),
});

const PdplRequestSchema = z.object({
  requestType: z.enum(['EXPORT', 'CORRECTION', 'ERASURE']),
  notes: z.string().max(1000).optional(),
});

@Controller('api/v1/saas')
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  @Get('public/plans')
  async listPublicPlans() {
    const data = await this.saasService.listPublicPlans();
    return { success: true, data };
  }

  @Get('public/policies')
  async listPublicPolicies() {
    const data = await this.saasService.listPublicPolicies();
    return { success: true, data };
  }

  @Post('webhooks/payment')
  async handlePaymentWebhook(
    @Headers('x-saas-webhook-signature') signature: string | undefined,
    @Req() req: { rawBody?: string | Buffer },
    @Body() body: unknown
  ) {
    const payload = WebhookSchema.parse(body);
    const rawPayload =
      typeof req?.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req?.rawBody)
          ? req.rawBody.toString('utf8')
          : JSON.stringify(body);
    const data = await this.saasService.handlePaymentWebhook(
      rawPayload,
      signature,
      payload
    );
    return { success: true, data };
  }

  @Get('subscription')
  @UseGuards(TenantContextGuard)
  async getSubscriptionOverview(@CurrentContext() context: TenantContext) {
    const data = await this.saasService.getTenantSubscriptionOverview(context);
    return { success: true, data };
  }

  @Post('billing/checkout')
  @UseGuards(TenantContextGuard)
  async createCheckout(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = CheckoutSchema.parse(body);
    const data = await this.saasService.createHostedCheckout(context, dto);
    return { success: true, data };
  }

  @Post('subscription/cancel')
  @UseGuards(TenantContextGuard)
  async cancelSubscription(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = CancelSchema.parse(body ?? {});
    const data = await this.saasService.cancelSubscription(context, dto.reason);
    return { success: true, data };
  }

  @Patch('subscription/auto-renew')
  @UseGuards(TenantContextGuard)
  async toggleAutoRenew(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = AutoRenewSchema.parse(body);
    const data = await this.saasService.toggleAutoRenew(context, dto.autoRenew);
    return { success: true, data };
  }

  @Get('onboarding')
  @UseGuards(TenantContextGuard)
  async getOnboardingProgress(@CurrentContext() context: TenantContext) {
    const data = await this.saasService.getOnboardingProgress(context);
    return { success: true, data };
  }

  @Patch('onboarding')
  @UseGuards(TenantContextGuard)
  async updateOnboardingProgress(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = OnboardingProgressSchema.parse(body);
    const data = await this.saasService.updateOnboardingProgress(context, dto);
    return { success: true, data };
  }

  @Get('pdpl/consents')
  @UseGuards(TenantContextGuard)
  async listPdplConsents(@CurrentContext() context: TenantContext) {
    const data = await this.saasService.listPdplConsents(context);
    return { success: true, data };
  }

  @Post('pdpl/data-request')
  @UseGuards(TenantContextGuard)
  async submitPdplDataRequest(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = PdplRequestSchema.parse(body);
    const data = await this.saasService.submitPdplDataRequest(context, dto);
    return { success: true, data };
  }
}
