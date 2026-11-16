import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyPermissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  OfflinePosService,
  AllocateOfflineLeasesSchema,
  SyncOfflineBatchSchema,
} from './offline-pos.service';

@Controller('api/v1/sales/offline')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class OfflinePosController {
  constructor(private readonly offlinePosService: OfflinePosService) {}

  @Post('leases')
  @RequirePermissions('sales.create')
  async allocateLeases(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const dto = AllocateOfflineLeasesSchema.parse(body);
    const data = await this.offlinePosService.allocateOrRenewLeases(context, dto);
    return { success: true, data };
  }

  @Get('leases')
  @RequireAnyPermissions('sales.create', 'sales.read', 'pos.order.create')
  async listLeases(
    @CurrentContext() context: TenantContext,
    @Query('deviceId') deviceId?: string,
    @Query('branchId') branchId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.offlinePosService.listLeases(context, {
      deviceId,
      branchId,
      warehouseId,
      status,
    });
    return { success: true, data };
  }

  @Post('sync')
  @RequirePermissions('sales.create')
  async syncBatch(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const dto = SyncOfflineBatchSchema.parse(body);
    const data = await this.offlinePosService.syncOfflineBatch(context, dto);
    return { success: true, data };
  }
}
