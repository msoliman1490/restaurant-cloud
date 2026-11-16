import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiningService } from './dining.service';
import { z } from 'zod';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { IndustryEntitlementGuard } from '../../common/guards/industry-entitlement.guard';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireCapability } from '../../common/decorators/industry-entitlement.decorator';
import { TenantContext, TableStatus } from '@restaurant-cloud/domain-kernel';
import {
  CreateDiningTableSchema,
  OpenTableSessionSchema,
  AddOrderLineModifierSchema,
  VoidOrderLineSchema,
} from '@restaurant-cloud/shared-contracts';

@Controller('api/v1/dining')
@UseGuards(TenantContextGuard, PermissionsGuard, IndustryEntitlementGuard)
@RequireCapability('dining.tables')
export class DiningController {
  constructor(private readonly diningService: DiningService) {}

  @Post('tables')
  @RequirePermissions('dining.table.create')
  async createTable(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validatedDto = CreateDiningTableSchema.parse(body);
    const data = await this.diningService.createTable(context, validatedDto);
    return { success: true, data };
  }

  @Get('branches/:branchId/tables')
  @RequirePermissions('dining.table.view')
  async getTables(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string,
  ) {
    const data = await this.diningService.getTablesByBranch(context, branchId);
    return { success: true, data };
  }

  @Patch('tables/:id/status')
  @RequirePermissions('dining.table.update')
  async updateTableStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') tableId: string,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        status: z.nativeEnum(TableStatus),
        currentOrderId: z.string().uuid().nullable().optional(),
      })
      .parse(body);
    const data = await this.diningService.updateTableStatus(
      context,
      tableId,
      validated.status,
      validated.currentOrderId,
    );
    return { success: true, data };
  }

  @Post('sessions/open')
  @RequirePermissions('dining.session.manage')
  async openSession(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validatedDto = OpenTableSessionSchema.parse(body);
    const data = await this.diningService.openTableSession(context, validatedDto);
    return { success: true, data };
  }

  @Post('sessions/:id/close')
  @RequirePermissions('dining.session.manage')
  async closeSession(
    @CurrentContext() context: TenantContext,
    @Param('id') sessionId: string,
  ) {
    const data = await this.diningService.closeTableSession(context, sessionId);
    return { success: true, data };
  }

  @Get('tables/:id/order')
  @RequirePermissions('dining.table.view')
  async getTableOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') tableId: string,
  ) {
    const data = await this.diningService.getTableOrder(context, tableId);
    return { success: true, data };
  }

  @Post('tables/:id/order')
  @RequirePermissions('dining.order.manage')
  async upsertTableOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') tableId: string,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        legalEntityId: z.string().uuid(),
        branchId: z.string().uuid(),
        deviceId: z.string().uuid(),
        shiftId: z.string().uuid().optional(),
        station: z.string().max(100).optional(),
        notes: z.string().max(1000).optional(),
        idempotencyKey: z.string().max(128).optional(),
        lines: z
          .array(
            z.object({
              itemId: z.string().uuid(),
              quantity: z.number().positive(),
              uomId: z.string().uuid().optional(),
              unitPrice: z.number().nonnegative().optional(),
              notes: z.string().max(500).optional(),
              modifiers: z
                .array(
                  z.object({
                    modifierNameAr: z.string().min(1).max(200),
                    modifierNameEn: z.string().min(1).max(200),
                    priceDelta: z.string().optional(),
                    quantity: z.number().positive().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .min(1),
      })
      .parse(body);
    const data = await this.diningService.createOrAppendTableOrder(context, tableId, validated);
    return { success: true, data };
  }

  @Post('tables/:id/checkout')
  @RequirePermissions('dining.order.checkout')
  async checkoutTableOrder(
    @CurrentContext() context: TenantContext,
    @Param('id') tableId: string,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        legalEntityId: z.string().uuid(),
        branchId: z.string().uuid(),
        deviceId: z.string().uuid(),
        shiftId: z.string().uuid().optional(),
        warehouseId: z.string().uuid().optional(),
        idempotencyKey: z.string().max(128).optional(),
        payments: z
          .array(
            z.object({
              paymentMethod: z.string().min(1).max(64),
              amount: z.string().min(1),
              providerCode: z.string().max(64).optional(),
              providerTransactionRef: z.string().max(128).optional(),
            }),
          )
          .min(1),
      })
      .parse(body);
    const data = await this.diningService.checkoutTableOrder(context, tableId, validated);
    return { success: true, data };
  }

  @Post('tables/transfer')
  @RequirePermissions('dining.table.transfer')
  async transferTable(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        sourceTableId: z.string().uuid(),
        targetTableId: z.string().uuid(),
      })
      .parse(body);
    const data = await this.diningService.transferTable(
      context,
      validated.sourceTableId,
      validated.targetTableId,
    );
    return { success: true, data };
  }

  @Post('tables/merge')
  @RequirePermissions('dining.table.merge')
  async mergeTables(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        sourceTableId: z.string().uuid(),
        targetTableId: z.string().uuid(),
      })
      .parse(body);
    const data = await this.diningService.mergeTables(
      context,
      validated.sourceTableId,
      validated.targetTableId,
    );
    return { success: true, data };
  }

  @Get('branches/:branchId/kitchen-tickets')
  @RequirePermissions('dining.kitchen.view')
  async getKitchenTickets(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string,
    @Query('status') status?: string,
  ) {
    const data = await this.diningService.getKitchenTickets(context, branchId, status);
    return { success: true, data };
  }

  @Patch('kitchen-tickets/:id/status')
  @RequirePermissions('dining.kitchen.manage')
  async updateKitchenTicketStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') ticketId: string,
    @Body() body: unknown,
  ) {
    const validated = z
      .object({
        status: z.enum(['IN_PREPARATION', 'READY', 'SERVED', 'CANCELLED']),
      })
      .parse(body);
    const data = await this.diningService.updateKitchenTicketStatus(context, ticketId, validated.status);
    return { success: true, data };
  }

  @Post('modifiers')
  @RequirePermissions('dining.order.manage')
  async addModifier(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validatedDto = AddOrderLineModifierSchema.parse(body);
    const data = await this.diningService.addModifier(context, validatedDto);
    return { success: true, data };
  }

  @Get('voids')
  @RequirePermissions('dining.void.view')
  async getVoids(@CurrentContext() context: TenantContext) {
    const data = await this.diningService.getVoids(context);
    return { success: true, data };
  }

  @Post('voids')
  @RequirePermissions('dining.void.create')
  async recordVoid(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validatedDto = VoidOrderLineSchema.parse(body);
    const data = await this.diningService.recordVoid(context, validatedDto);
    return { success: true, data };
  }

  @Get('split-bill')
  @RequirePermissions('dining.read')
  calculateSplitBill(
    @Query('totalAmount') totalAmount: string,
    @Query('splitCount') splitCount: string,
  ) {
    const data = this.diningService.calculateSplitBill(
      parseFloat(totalAmount),
      parseInt(splitCount, 10),
    );
    return { success: true, data };
  }
}
