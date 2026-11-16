import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, RequireAnyPermissions } from '../../common/decorators/permissions.decorator';
import { RequireIdempotencyKey } from '../../common/decorators/require-idempotency.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { OptionalLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
import {
  OpenShiftSchema,
  ClosePosShiftSchema,
  ShiftCashTransactionSchema,
  CreateSalesOrderSchema,
  TransferTableOrderSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

const VoidSalesOrderSchema = z.object({
  reason: z.string().min(1).default('CUSTOMER_CANCELLED'),
  approvedBy: z.string().uuid().optional(),
  restockInventory: z.boolean().optional().default(true),
});

const RefundSalesOrderSchema = z.object({
  reason: z.string().min(1),
  restockInventory: z.boolean().optional().default(true),
  idempotencyKey: z.string().min(1),
  refundAmount: z.string().optional(),
  approvedBy: z.string().uuid().optional(),
  refundMethod: z.string().min(1).optional(),
  refundLines: z
    .array(
      z.object({
        orderLineId: z.string().uuid().optional(),
        itemId: z.string().uuid().optional(),
        quantity: z.union([z.number().positive(), z.string().min(1)]),
        unitPrice: z.union([z.number().nonnegative(), z.string()]).optional(),
      }),
    )
    .optional(),
});

@Controller('api/v1/sales')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // ==================================================================
  // POS Shifts
  // ==================================================================

  @Post('shifts/open')
  @RequirePermissions('pos.shift.open')
  async openShift(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = OpenShiftSchema.parse(body);
    const data = await this.salesService.openShift(context, dto);
    return { success: true, data };
  }

  @Get('shifts')
  @RequireAnyPermissions('pos.shift.view', 'pos.shift.open', 'pos.shift.close', 'accounting.view')
  async listShifts(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('deviceId') deviceId?: string,
    @Query('cashierId') cashierId?: string,
    @Query('cashVaultId') cashVaultId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.salesService.listShifts(context, {
      legalEntityId,
      branchId,
      deviceId,
      cashierId,
      cashVaultId,
      status,
      fromDate,
      toDate,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, data };
  }

  @Get('shifts/active/:deviceId')
  @RequireAnyPermissions('pos.shift.view', 'pos.shift.open', 'pos.shift.close')
  async getActiveShift(
    @CurrentContext() context: TenantContext,
    @Param('deviceId') deviceId: string
  ) {
    const data = await this.salesService.getActiveShift(context, deviceId);
    return { success: true, data };
  }

  @Get('shifts/:id/summary')
  @RequireAnyPermissions('pos.shift.view', 'pos.shift.open', 'pos.shift.close', 'accounting.view')
  async getShiftSummary(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.salesService.getShiftSummary(context, id);
    return { success: true, data };
  }

  @Post('shifts/cash-transaction')
  @RequirePermissions('pos.cash.transact')
  async recordCashTransaction(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = ShiftCashTransactionSchema.parse(body);
    const data = await this.salesService.recordShiftCashTransaction(context, dto);
    return { success: true, data };
  }

  @Post('shifts/close')
  @RequirePermissions('pos.shift.close')
  async closeShift(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = ClosePosShiftSchema.parse(body);
    const data = await this.salesService.closeShift(context, dto);
    return { success: true, data };
  }

  // ==================================================================
  // Sales Orders & POS Payments
  // ==================================================================

  @Post('orders')
  @RequirePermissions('pos.order.create')
  @RequireIdempotencyKey()
  async createSalesOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = CreateSalesOrderSchema.parse(body);
    const data = await this.salesService.createSalesOrder(context, dto);
    return { success: true, data };
  }

  @Get('orders')
  @RequirePermissions('sales.read')
  async getSalesOrders(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.salesService.getSalesOrders(context, branchId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, data };
  }

  @Post('orders/transfer-table')
  @RequirePermissions('pos.table.transfer')
  async transferTableOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = TransferTableOrderSchema.parse(body);
    const data = await this.salesService.transferTableOrder(context, dto);
    return { success: true, data };
  }

  @Post('orders/:id/void')
  @RequirePermissions('pos.order.void')
  async voidSalesOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const dto = VoidSalesOrderSchema.parse(body);
    const data = await this.salesService.voidSalesOrder(
      context,
      id,
      dto.reason,
      dto.approvedBy || context.userId,
      dto.restockInventory,
    );
    return { success: true, data };
  }

  @Post('orders/:id/refund')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('sales.refund')
  @RequireIdempotencyKey()
  async refundSalesOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const dto = RefundSalesOrderSchema.parse(body);
    const data = await this.salesService.refundSalesOrder(context, id, {
      refundAmount: dto.refundAmount,
      reason: dto.reason,
      approvedBy: dto.approvedBy || context.userId,
      paymentMethod: dto.refundMethod,
      refundMethod: dto.refundMethod,
      restockInventory: dto.restockInventory,
      idempotencyKey: dto.idempotencyKey,
      refundLines: dto.refundLines,
    });
    return { success: true, data };
  }
}
