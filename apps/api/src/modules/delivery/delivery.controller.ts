import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  DeliveryService,
} from './delivery.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

const CreateDeliveryZoneSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string().min(1).max(64),
  nameAr: z.string().min(1).max(200),
  nameEn: z.string().max(200).optional(),
  deliveryFee: z.union([z.number(), z.string()]).optional(),
  minOrderAmount: z.union([z.number(), z.string()]).optional(),
  estimatedMinutes: z.number().int().positive().optional(),
});

const CreateDeliveryDriverSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
  driverCode: z.string().min(1).max(64),
  fullNameAr: z.string().min(1).max(200),
  fullNameEn: z.string().max(200).optional(),
  phone: z.string().min(1).max(40),
  vehicleType: z.enum(['MOTORBIKE', 'CAR', 'BICYCLE', 'VAN']).optional(),
  plateNumber: z.string().max(40).optional(),
});

const UpdateDriverStatusSchema = z.object({
  availabilityStatus: z.enum(['AVAILABLE', 'ON_DELIVERY', 'OFFLINE']).optional(),
  isActive: z.boolean().optional(),
});

const CreateDeliveryOrderSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  channel: z.enum(['IN_HOUSE', 'AGGREGATOR', 'WEB', 'CALL_CENTER']).optional(),
  aggregatorName: z.string().max(120).optional(),
  externalReference: z.string().max(120).optional(),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(1).max(40),
  deliveryAddress: z.string().min(1).max(500),
  deliveryFee: z.union([z.number(), z.string()]).optional(),
  codAmount: z.union([z.number(), z.string()]).optional(),
  notes: z.string().max(1000).optional(),
});

const AssignDriverSchema = z.object({
  driverId: z.string().uuid(),
});

const UpdateOrderStatusSchema = z.object({
  status: z.string().min(1).max(50),
  failedReason: z.string().max(500).optional(),
  codCollected: z.boolean().optional(),
});

const SettleDriverCodSchema = z.object({
  driverId: z.string().uuid(),
  cashVaultId: z.string().uuid(),
  settledAmount: z.union([z.number(), z.string()]),
  clearingAccountId: z.string().uuid().optional(),
  varianceAccountId: z.string().uuid().optional(),
  deliveryOrderIds: z.array(z.string().uuid()).optional(),
  idempotencyKey: z.string().max(128).optional(),
  notes: z.string().max(1000).optional(),
});

@Controller('api/v1/delivery')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post('zones')
  @RequirePermissions('delivery.manage')
  async createZone(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateDeliveryZoneSchema.parse(body);
    return await this.deliveryService.createZone(context, dto);
  }

  @Get('zones')
  @RequirePermissions('delivery.view')
  async listZones(@CurrentContext() context: TenantContext, @Query('branchId') branchId?: string) {
    return await this.deliveryService.listZones(context, branchId);
  }

  @Post('drivers')
  @RequirePermissions('delivery.manage')
  async createDriver(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateDeliveryDriverSchema.parse(body);
    return await this.deliveryService.createDriver(context, dto);
  }

  @Get('drivers')
  @RequirePermissions('delivery.view')
  async listDrivers(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string,
    @Query('availabilityStatus') availabilityStatus?: string,
  ) {
    return await this.deliveryService.listDrivers(context, { branchId, availabilityStatus });
  }

  @Patch('drivers/:id/status')
  @RequirePermissions('delivery.manage')
  async updateDriverStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = UpdateDriverStatusSchema.parse(body);
    return await this.deliveryService.updateDriverStatus(context, id, dto);
  }

  @Post('orders')
  @RequirePermissions('delivery.dispatch')
  async createDeliveryOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const dto = CreateDeliveryOrderSchema.parse(body);
    return await this.deliveryService.createDeliveryOrder(context, dto);
  }

  @Get('orders')
  @RequirePermissions('delivery.view')
  async listDeliveryOrders(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string,
    @Query('driverId') driverId?: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return await this.deliveryService.listDeliveryOrders(context, {
      branchId,
      driverId,
      status,
      channel,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('orders/:id/assign')
  @RequirePermissions('delivery.dispatch')
  async assignDriver(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = AssignDriverSchema.parse(body);
    return await this.deliveryService.assignDriver(context, id, parsed.driverId);
  }

  @Patch('orders/:id/status')
  @RequirePermissions('delivery.dispatch')
  async updateOrderStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = UpdateOrderStatusSchema.parse(body);
    return await this.deliveryService.updateOrderStatus(context, id, dto);
  }

  @Post('settlements/cod')
  @RequirePermissions('delivery.settle')
  async settleDriverCod(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = SettleDriverCodSchema.parse(body);
    return await this.deliveryService.settleDriverCod(context, dto);
  }

  @Get('settlements/cod')
  @RequirePermissions('delivery.view')
  async listSettlements(
    @CurrentContext() context: TenantContext,
    @Query('driverId') driverId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return await this.deliveryService.listSettlements(context, driverId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
