import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { PurchasingService } from './purchasing.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireIdempotencyKey } from '../../common/decorators/require-idempotency.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  OptionalLegalEntityIdPipe,
  RequiredLegalEntityIdPipe,
} from '../../common/pipes/legal-entity-id.pipe';
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
  @RequireIdempotencyKey()
  async createRequest(
    @CurrentContext() context: TenantContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePurchaseRequestSchema.parse(body);
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const data = await this.purchasingService.createPurchaseRequest(context, {
      ...validatedDto,
      saveAsDraft: Boolean(raw.saveAsDraft),
      idempotencyKey: idempotencyKey || (typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : undefined),
    });
    return { success: true, data };
  }

  @Patch('requests/:id/draft')
  @RequirePermissions('purchasing.request.create')
  async updateRequestDraft(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const dto = z
      .object({
        expectedVersion: z.number().int().min(1),
        notes: z.string().max(500).optional(),
        neededByDate: z.string().datetime().nullable().optional(),
        submit: z.boolean().optional(),
        lines: z
          .array(
            z.object({
              itemId: z.string().uuid(),
              uomId: z.string().uuid(),
              requestedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
              estimatedUnitCost: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
              notes: z.string().max(255).optional(),
            })
          )
          .min(1)
          .optional(),
      })
      .parse(body);
    const data = await this.purchasingService.updatePurchaseRequestDraft(context, id, dto);
    return { success: true, data };
  }

  @Get('requests')
  @RequirePermissions('purchasing.read')
  async getRequests(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.purchasingService.getPurchaseRequests(context, {
      legalEntityId,
      warehouseId,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return { success: true, data };
  }

  @Get('requests/:id')
  @RequirePermissions('purchasing.read')
  async getRequestById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.purchasingService.getPurchaseRequestById(context, id);
    return { success: true, data };
  }

  @Post('requests/:id/approve')
  @RequirePermissions('purchasing.approve')
  async approveRequest(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.purchasingService.approvePurchaseRequest(context, id);
    return { success: true, data };
  }

  @Post('requests/:id/reject')
  @RequirePermissions('purchasing.approve')
  async rejectRequest(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: { reason?: string }
  ) {
    const data = await this.purchasingService.rejectPurchaseRequest(
      context,
      id,
      body?.reason || 'Rejected'
    );
    return { success: true, data };
  }

  @Post('requests/:id/convert-to-po')
  @RequirePermissions('purchasing.create')
  async convertRequestToPo(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body()
    body: {
      supplierId: string;
      orderNumber?: string;
      expectedDeliveryDate?: string;
      currency?: string;
      notes?: string;
      submitAsDraft?: boolean;
    }
  ) {
    const data = await this.purchasingService.convertPurchaseRequestToOrder(context, id, body);
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

  @Post('orders/:id/approve')
  @RequirePermissions('purchasing.order.approve')
  async approveOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.purchasingService.approvePurchaseOrder(context, id);
    return { success: true, data };
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('purchasing.order.cancel')
  async cancelOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: { reason?: string }
  ) {
    const data = await this.purchasingService.cancelPurchaseOrder(
      context,
      id,
      body?.reason || 'Cancelled by user'
    );
    return { success: true, data };
  }

  @Get('orders')
  @RequirePermissions('purchasing.read')
  async getOrders(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.purchasingService.getPurchaseOrders(context, legalEntityId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return { success: true, data };
  }

  @Get('receipts')
  @RequirePermissions('purchasing.read')
  async getReceipts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.purchasingService.getGoodsReceipts(context, legalEntityId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return { success: true, data };
  }

  @Get('invoices')
  @RequirePermissions('purchasing.read')
  async getInvoices(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.purchasingService.getSupplierInvoices(context, legalEntityId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return { success: true, data };
  }

  @Get('returns')
  @RequirePermissions('purchasing.read')
  async getReturns(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.purchasingService.getPurchaseReturns(context, legalEntityId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return { success: true, data };
  }

  @Get('payments')
  @RequirePermissions('purchasing.read')
  async getPayments(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string
  ) {
    const data = await this.purchasingService.getSupplierPayments(context, legalEntityId);
    return { success: true, data };
  }

  @Post('receipts')
  @RequirePermissions('purchasing.receipt.create')
  @RequireIdempotencyKey()
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
  @RequireIdempotencyKey()
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
  @RequireIdempotencyKey()
  async createReturn(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreatePurchaseReturnSchema.parse(body);
    const data = await this.purchasingService.createPurchaseReturn(context, validatedDto);
    return { success: true, data };
  }

  @Get('suppliers/:supplierId/balance')
  @RequirePermissions('purchasing.read')
  async getSupplierBalance(
    @CurrentContext() context: TenantContext,
    @Param('supplierId') supplierId: string,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string
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
  @RequireIdempotencyKey()
  async createPayment(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateSupplierPaymentSchema.parse(body);
    const data = await this.purchasingService.createSupplierPayment(context, validatedDto);
    return { success: true, data };
  }
}
