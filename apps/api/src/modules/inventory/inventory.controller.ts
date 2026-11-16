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
import { OptionalLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
import {
  CreateStockTransferRequestSchema,
  SubmitStockTransferRequestSchema,
  ApproveStockTransferRequestSchema,
  RejectStockTransferRequestSchema,
  CancelStockTransferRequestSchema,
  CloseStockTransferRequestSchema,
  DispatchTransferRequestSchema,
  ReceiveTransferRequestSchema,
  ResolveTransferDiscrepancyRequestSchema,
  ReverseTransferAfterDispatchSchema,
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
  @RequirePermissions('inventory.read')
  async getBalances(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = StockBalanceQuerySchema.parse(query);
    const data = await this.inventoryService.getBalances(context, validatedQuery);
    return { success: true, data };
  }

  @Get('valuation')
  @RequirePermissions('inventory.read')
  async getValuation(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string
  ) {
    const data = await this.inventoryService.getInventoryValuation(context, {
      warehouseId,
      legalEntityId,
    });
    return { success: true, data };
  }

  @Get('balances/:warehouseId/:itemId')
  @RequirePermissions('inventory.read')
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
  @RequirePermissions('inventory.read')
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
  @RequirePermissions('inventory.transfer.view')
  async getTransfers(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('transferType') transferType?: string,
    @Query('status') status?: TransferStatus,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const data = await this.inventoryService.getTransfers(context, {
      warehouseId,
      legalEntityId,
      transferType,
      status,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data };
  }

  @Get('transfers/reports/reconciliation')
  @RequirePermissions('inventory.transfer.view')
  async getTransferReconciliationReport(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string
  ) {
    const data = await this.inventoryService.getTransferReconciliationReport(context, { legalEntityId });
    return { success: true, data };
  }

  @Get('transfers/:id')
  @RequirePermissions('inventory.transfer.view')
  async getTransferById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.inventoryService.getTransferById(context, id);
    return { success: true, data };
  }

  @Post('transfers/:id/submit')
  @RequirePermissions('inventory.transfer.create')
  async submitTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = body ? SubmitStockTransferRequestSchema.parse(body) : undefined;
    const data = await this.inventoryService.submitTransfer(context, id, validatedDto);
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

  @Post('transfers/:id/cancel')
  @RequirePermissions('inventory.transfer.cancel')
  async cancelTransfer(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = CancelStockTransferRequestSchema.parse(body);
    const data = await this.inventoryService.cancelTransfer(context, id, validatedDto);
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

  @Post('transfers/:id/discrepancies/:discrepancyId/resolve')
  @RequirePermissions('inventory.transfer.discrepancy.resolve')
  async resolveTransferDiscrepancy(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Param('discrepancyId') discrepancyId: string,
    @Body() body: unknown
  ) {
    const validatedDto = ResolveTransferDiscrepancyRequestSchema.parse(body);
    const data = await this.inventoryService.resolveTransferDiscrepancy(
      context,
      id,
      discrepancyId,
      validatedDto
    );
    return { success: true, data };
  }

  @Post('transfers/:id/reverse-after-dispatch')
  @RequirePermissions('inventory.transfer.cancel')
  async reverseTransferAfterDispatch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = ReverseTransferAfterDispatchSchema.parse(body);
    const data = await this.inventoryService.reverseTransferAfterDispatch(context, id, validatedDto);
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
  @RequirePermissions('inventory.read')
  async getStocktakeOrders(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validated = StocktakeOrderQuerySchema.parse(query);
    const data = await this.inventoryService.getStocktakeOrders(context, validated);
    return { success: true, data };
  }

  @Get('stocktakes/:id')
  @RequirePermissions('inventory.read')
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
  @RequirePermissions('inventory.read')
  async getDetailedBalances(
    @CurrentContext() context: TenantContext,
    @Query('warehouseId') warehouseId?: string,
    @Query('itemId') itemId?: string,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
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
  @RequirePermissions('warehouse.read')
  async listWarehouses(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
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
  @RequirePermissions('warehouse.read')
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
