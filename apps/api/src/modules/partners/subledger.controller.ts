import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArSubledgerService } from './ar-subledger.service';
import { ApSubledgerService } from './ap-subledger.service';
import { SubledgerReconciliationService } from './subledger-reconciliation.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequiredLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateArInvoiceSchema,
  AllocateArReceiptSchema,
  CreateApInvoiceSchema,
  AllocateApPaymentSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/subledger')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class SubledgerController {
  constructor(
    private readonly arService: ArSubledgerService,
    private readonly apService: ApSubledgerService,
    private readonly reconciliationService: SubledgerReconciliationService
  ) {}

  // ==========================================
  // AR Subledger (الذمم المدينة للعملاء)
  // ==========================================

  @Post('ar/invoices')
  @RequirePermissions('ar.invoice.create')
  async createArInvoice(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateArInvoiceSchema.parse(body);
    const data = await this.arService.createInvoice(context, dto);
    return { success: true, data };
  }

  @Post('ar/invoices/:id/post')
  @RequirePermissions('ar.invoice.post')
  async postArInvoice(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    const data = await this.arService.postInvoice(context, id);
    return { success: true, data };
  }

  @Post('ar/allocations')
  @RequirePermissions('ar.receipt.allocate')
  async allocateArReceipt(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = AllocateArReceiptSchema.parse(body);
    const data = await this.arService.allocateReceipt(context, dto);
    return { success: true, data };
  }

  @Post('ar/allocations/:id/unmatch')
  @RequirePermissions('ar.receipt.unmatch')
  async unmatchArAllocation(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    const data = await this.arService.unmatchAllocation(context, id);
    return { success: true, data };
  }

  // ==========================================
  // AP Subledger (الذمم الدائنة للموردين)
  // ==========================================

  @Post('ap/invoices')
  @RequirePermissions('ap.invoice.create')
  async createApInvoice(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateApInvoiceSchema.parse(body);
    const data = await this.apService.createInvoice(context, dto);
    return { success: true, data };
  }

  @Post('ap/invoices/:id/post')
  @RequirePermissions('ap.invoice.post')
  async postApInvoice(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    const data = await this.apService.postInvoice(context, id);
    return { success: true, data };
  }

  @Post('ap/allocations')
  @RequirePermissions('ap.payment.allocate')
  async allocateApPayment(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = AllocateApPaymentSchema.parse(body);
    const data = await this.apService.allocatePayment(context, dto);
    return { success: true, data };
  }

  @Post('ap/allocations/:id/unmatch')
  @RequirePermissions('ap.payment.allocate')
  async unmatchApAllocation(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    const data = await this.apService.unmatchAllocation(context, id);
    return { success: true, data };
  }

  // ==========================================
  // Subledger to GL Reconciliation (المطابقة الفورية)
  // ==========================================

  @Get('reconciliation/ar')
  @RequirePermissions('reconciliation.ar_ap.view')
  async reconcileAr(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.reconciliationService.reconcileAr(context, legalEntityId);
    return { success: true, data };
  }

  @Get('reconciliation/ap')
  @RequirePermissions('reconciliation.ar_ap.view')
  async reconcileAp(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
  ) {
    const data = await this.reconciliationService.reconcileAp(context, legalEntityId);
    return { success: true, data };
  }
}
