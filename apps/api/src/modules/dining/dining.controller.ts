import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { DiningService } from './dining.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateDiningTableSchema,
  OpenTableSessionSchema,
  AddOrderLineModifierSchema,
  VoidOrderLineSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TableStatus } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/dining')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class DiningController {
  constructor(private readonly diningService: DiningService) {}

  @Post('tables')
  @RequirePermissions('dining.table.create')
  async createTable(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateDiningTableSchema.parse(body);
    const data = await this.diningService.createTable(context, validatedDto);
    return { success: true, data };
  }

  @Get('branches/:branchId/tables')
  async getTables(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string
  ) {
    const data = await this.diningService.getTablesByBranch(context, branchId);
    return { success: true, data };
  }

  @Patch('tables/:id/status')
  @RequirePermissions('dining.table.update')
  async updateTableStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') tableId: string,
    @Body('status') status: TableStatus,
    @Body('currentOrderId') currentOrderId?: string | null
  ) {
    const data = await this.diningService.updateTableStatus(context, tableId, status, currentOrderId);
    return { success: true, data };
  }

  @Post('sessions/open')
  @RequirePermissions('dining.session.manage')
  async openSession(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = OpenTableSessionSchema.parse(body);
    const data = await this.diningService.openTableSession(context, validatedDto);
    return { success: true, data };
  }

  @Post('sessions/:id/close')
  @RequirePermissions('dining.session.manage')
  async closeSession(
    @CurrentContext() context: TenantContext,
    @Param('id') sessionId: string
  ) {
    const data = await this.diningService.closeTableSession(context, sessionId);
    return { success: true, data };
  }

  @Post('modifiers')
  @RequirePermissions('dining.order.modify')
  async addModifier(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = AddOrderLineModifierSchema.parse(body);
    const data = await this.diningService.addModifier(context, validatedDto);
    return { success: true, data };
  }

  @Post('voids')
  @RequirePermissions('dining.order.void')
  async recordVoid(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = VoidOrderLineSchema.parse(body);
    const data = await this.diningService.recordVoid(context, validatedDto);
    return { success: true, data };
  }

  @Get('split-bill')
  splitBill(
    @Query('totalAmount') totalAmount: string,
    @Query('splitCount') splitCount: string
  ) {
    const total = parseFloat(totalAmount || '0');
    const count = parseInt(splitCount || '1', 10);
    const data = this.diningService.calculateSplitBill(total, count);
    return { success: true, data };
  }
}
