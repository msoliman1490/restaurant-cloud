import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  OpenShiftSchema,
  ClosePosShiftSchema,
  ShiftCashTransactionSchema,
  CreateSalesOrderSchema,
  TransferTableOrderSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

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

  @Get('shifts/active/:deviceId')
  async getActiveShift(
    @CurrentContext() context: TenantContext,
    @Param('deviceId') deviceId: string
  ) {
    const data = await this.salesService.getActiveShift(context, deviceId);
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
  async createSalesOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = CreateSalesOrderSchema.parse(body);
    const data = await this.salesService.createSalesOrder(context, dto);
    return { success: true, data };
  }

  @Get('orders')
  async getSalesOrders(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string
  ) {
    const data = await this.salesService.getSalesOrders(context, branchId);
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
    @Body('reason') reason: string,
    @Body('approvedBy') approvedBy: string
  ) {
    const data = await this.salesService.voidSalesOrder(context, id, reason || 'CUSTOMER_CANCELLED', approvedBy || context.userId);
    return { success: true, data };
  }
}
