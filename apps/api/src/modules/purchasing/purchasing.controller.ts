import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreatePurchaseRequestSchema,
  CreatePurchaseOrderSchema,
  CreateGoodsReceiptSchema,
  CreateSupplierInvoiceSchema,
  CreatePurchaseReturnSchema,
  CreateSupplierPaymentSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/purchasing')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Post('requests')
  @RequirePermissions('purchasing.request.create')
  async createRequest(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePurchaseRequestSchema.parse(body);
    const data = await this.purchasingService.createPurchaseRequest(context, validatedDto);
    return { success: true, data };
  }

  @Post('orders')
  @RequirePermissions('purchasing.order.create')
  async createOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePurchaseOrderSchema.parse(body);
    const data = await this.purchasingService.createPurchaseOrder(context, validatedDto);
    return { success: true, data };
  }

  @Get('orders')
  async getOrders(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId?: string
  ) {
    const data = await this.purchasingService.getPurchaseOrders(context, legalEntityId);
    return { success: true, data };
  }

  @Post('receipts')
  @RequirePermissions('purchasing.receipt.create')
  async receiveGoods(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateGoodsReceiptSchema.parse(body);
    const data = await this.purchasingService.receiveGoods(context, validatedDto);
    return { success: true, data };
  }

  @Post('invoices')
  @RequirePermissions('purchasing.invoice.create')
  async createInvoice(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateSupplierInvoiceSchema.parse(body);
    const data = await this.purchasingService.createSupplierInvoice(context, validatedDto);
    return { success: true, data };
  }

  @Post('returns')
  @RequirePermissions('purchasing.return.create')
  async createReturn(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePurchaseReturnSchema.parse(body);
    const data = await this.purchasingService.createPurchaseReturn(context, validatedDto);
    return { success: true, data };
  }

  @Get('suppliers/:supplierId/balance')
  async getSupplierBalance(
    @CurrentContext() context: TenantContext,
    @Param('supplierId') supplierId: string,
    @Query('legalEntityId') legalEntityId: string
  ) {
    const data = await this.purchasingService.getSupplierBalance(
      context,
      legalEntityId,
      supplierId
    );
    return { success: true, data };
  }

  @Post('payments')
  @RequirePermissions('purchasing.payment.create')
  async createPayment(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateSupplierPaymentSchema.parse(body);
    const data = await this.purchasingService.createSupplierPayment(context, validatedDto);
    return { success: true, data };
  }
}
