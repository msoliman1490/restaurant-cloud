import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateStockTransferRequestSchema,
  ApproveStockTransferRequestSchema,
  RejectStockTransferRequestSchema,
  CloseStockTransferRequestSchema,
  DispatchTransferRequestSchema,
  ReceiveTransferRequestSchema,
  CreateStockAdjustmentRequestSchema,
  CreateStocktakeOrderRequestSchema,
  RecordStocktakeCountRequestSchema,
  ApproveStocktakeOrderRequestSchema,
  RejectStocktakeOrderRequestSchema,
  StocktakeOrderQuerySchema,
  StockBalanceQuerySchema,
  InventoryMovementQuerySchema,
  CreateWarehouseRequestSchema,
  UpdateWarehouseRequestSchema,
  ReceiveStockRequestSchema,
  IssueStockRequestSchema,
  ReverseInventoryMovementSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TransferStatus, StocktakeStatus } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/inventory')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ==================================================================
  // Stock Balances
  // ==================================================================

  @Get('balances')
  async getBalances(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = StockBalanceQuerySchema.parse(query);
    const data = await this.inventoryService.getBalances(context, validatedQuery);
    return { success: true, data };
  }

  @Get('valuation')
  async getValuation(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('legalEntityId') legalEntityId?: string
  ) {
    const data = await this.inventoryService.getInventoryValuation(context, {
      warehouseId,
      legalEntityId,
    });
    return { success: true, data };
  }

  @Get('balances/:warehouseId/:itemId')
  async getBalance(
    @CurrentContext() context: TenantContext,
    @Param('warehouseId') warehouseId: string,
    @Param('itemId') itemId: string,
    @Query('lotId') lotId?: string
  ) {
    const data = await this.inventoryService.getBalance(context, warehouseId, itemId, lotId);
    return { success: true, data };
  }

  // ==================================================================
  // Stock Movements
  // ==================================================================

  @Get('movements')
  async getMovements(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = InventoryMovementQuerySchema.parse(query);
    const data = await this.inventoryService.getMovements(context, validatedQuery);
    return { success: true, data };
  }

  // ==================================================================
  // Stock Transfers
  // ==================================================================

  @Post('transfers')
  @RequirePermissions('inventory.transfer.create')
  async createTransfer(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateStockTransferRequestSchema.parse(body);
    const data = await this.inventoryService.createTransfer(context, validatedDto);
    return { success: true, data };
  }

  @Get('transfers')
  async getTransfers(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: TransferStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.inventoryService.getTransfers(context, {
      warehouseId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data };
  }

  @Get('transfers/:id')
  async getTransferById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.inventoryService.getTransferById(context, id);
    return { success: true, data };
  }

  @Post('transfers/:id/approve')
  @RequirePermissions('inventory.transfer.approve')
  async approveTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = body ? ApproveStockTransferRequestSchema.parse(body) : undefined;
    const data = await this.inventoryService.approveTransfer(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('transfers/:id/reject')
  @RequirePermissions('inventory.transfer.approve')
  async rejectTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = RejectStockTransferRequestSchema.parse(body);
    const data = await this.inventoryService.rejectTransfer(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('transfers/:id/dispatch')
  @RequirePermissions('inventory.transfer.dispatch')
  async dispatchTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = DispatchTransferRequestSchema.parse(body);
    const data = await this.inventoryService.dispatchTransfer(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('transfers/:id/receive')
  @RequirePermissions('inventory.transfer.receive')
  async receiveTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = ReceiveTransferRequestSchema.parse(body);
    const data = await this.inventoryService.receiveTransfer(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('transfers/:id/close')
  @RequirePermissions('inventory.transfer.close')
  async closeTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = body ? CloseStockTransferRequestSchema.parse(body) : undefined;
    const data = await this.inventoryService.closeTransfer(context, id, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // Stocktake & Inventory Counting (Phase B)
  // ==================================================================

  @Post('stocktakes')
  @RequirePermissions('inventory.stocktake.create')
  async createStocktakeOrder(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateStocktakeOrderRequestSchema.parse(body);
    const data = await this.inventoryService.createStocktakeOrder(context, validatedDto);
    return { success: true, data };
  }

  @Get('stocktakes')
  async getStocktakeOrders(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validated = StocktakeOrderQuerySchema.parse(query);
    const data = await this.inventoryService.getStocktakeOrders(context, validated);
    return { success: true, data };
  }

  @Get('stocktakes/:id')
  async getStocktakeOrderById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.inventoryService.getStocktakeOrderById(context, id);
    return { success: true, data };
  }

  @Post('stocktakes/:id/start')
  @RequirePermissions('inventory.stocktake.start')
  async startStocktake(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.inventoryService.startStocktake(context, id);
    return { success: true, data };
  }

  @Post('stocktakes/:id/count')
  @RequirePermissions('inventory.stocktake.count')
  async recordStocktakeCounts(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = RecordStocktakeCountRequestSchema.parse(body);
    const data = await this.inventoryService.recordStocktakeCounts(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('stocktakes/:id/approve')
  @RequirePermissions('inventory.stocktake.approve')
  async approveStocktakeVariance(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = body ? ApproveStocktakeOrderRequestSchema.parse(body) : undefined;
    const data = await this.inventoryService.approveStocktakeVariance(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('stocktakes/:id/reject')
  @RequirePermissions('inventory.stocktake.approve')
  async rejectStocktakeVariance(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = RejectStocktakeOrderRequestSchema.parse(body);
    const data = await this.inventoryService.rejectStocktakeVariance(context, id, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // Stock Adjustments
  // ==================================================================

  @Post('adjustments')
  @RequirePermissions('inventory.adjustment.create')
  async createAdjustment(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateStockAdjustmentRequestSchema.parse(body);
    const data = await this.inventoryService.createAdjustment(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // Detailed Balances (Phase A)
  // ==================================================================

  @Get('balances/detailed')
  async getDetailedBalances(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('itemId') itemId?: string,
    @Query('legalEntityId') legalEntityId?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.inventoryService.getDetailedBalances(context, {
      warehouseId,
      itemId,
      legalEntityId,
      stockStatus,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data };
  }

  // ==================================================================
  // Warehouse Management Endpoints (Phase A)
  // ==================================================================

  @Post('warehouses')
  @RequirePermissions('inventory.warehouse.manage')
  async createWarehouse(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateWarehouseRequestSchema.parse(body);
    const data = await this.inventoryService.createWarehouse(context, validatedDto);
    return { success: true, data };
  }

  @Get('warehouses')
  async listWarehouses(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('warehouseType') warehouseType?: string
  ) {
    const data = await this.inventoryService.listWarehouses(context, {
      legalEntityId,
      branchId,
      warehouseType,
    });
    return { success: true, data };
  }

  @Get('warehouses/:id')
  async getWarehouse(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.inventoryService.getWarehouse(context, id);
    return { success: true, data };
  }

  @Put('warehouses/:id')
  @RequirePermissions('inventory.warehouse.manage')
  async updateWarehouse(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateWarehouseRequestSchema.parse(body);
    const data = await this.inventoryService.updateWarehouse(context, id, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // Direct Stock Receiving & Issuing (Phase A)
  // ==================================================================

  @Post('receive')
  @RequirePermissions('inventory.stock.receive')
  async receiveStock(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = ReceiveStockRequestSchema.parse(body);
    const data = await this.inventoryService.receiveStock(context, validatedDto);
    return { success: true, data };
  }

  @Post('issue')
  @RequirePermissions('inventory.stock.issue')
  async issueStock(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = IssueStockRequestSchema.parse(body);
    const data = await this.inventoryService.issueStock(context, validatedDto);
    return { success: true, data };
  }

  // ==================================================================
  // Movement Reversal (Phase A)
  // ==================================================================

  @Post('movements/reverse')
  @RequirePermissions('inventory.movement.reverse')
  async reverseMovement(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = ReverseInventoryMovementSchema.parse(body);
    const data = await this.inventoryService.reverseMovement(context, validatedDto);
    return { success: true, data };
  }
}
