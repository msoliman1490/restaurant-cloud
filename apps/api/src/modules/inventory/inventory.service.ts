import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  inventoryBalances,
  inventoryMovements,
  inventoryCostLayers,
  stockTransfers,
  stockTransferLines,
  stockAdjustments,
  stockAdjustmentLines,
  warehouses,
  items,
  unitsOfMeasure,
  legalEntities,
} from '@restaurant-cloud/database';
import {
  CreateStockTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
  CreateStockAdjustmentRequest,
  StockBalanceQuery,
  InventoryMovementQuery,
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  ReceiveStockRequest,
  IssueStockRequest,
  ReverseInventoryMovementRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  TransferStatus,
  MovementType,
  MovementDirection,
  WarehouseType,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class InventoryService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  // ==================================================================
  // 1. Stock Balances
  // ==================================================================

  async getBalances(context: TenantContext, query?: StockBalanceQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(inventoryBalances.tenantId, context.tenantId)];

      if (query?.warehouseId) {
        conditions.push(eq(inventoryBalances.warehouseId, query.warehouseId));
      }

      if (query?.itemId) {
        conditions.push(eq(inventoryBalances.itemId, query.itemId));
      }

      const limit = query?.limit ?? 100;
      const offset = query?.offset ?? 0;

      const rows = await tx
        .select()
        .from(inventoryBalances)
        .where(and(...conditions))
        .orderBy(desc(inventoryBalances.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows;
    });
  }

  async getBalance(
    context: TenantContext,
    warehouseId: string,
    itemId: string,
    lotId?: string
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(inventoryBalances.tenantId, context.tenantId),
        eq(inventoryBalances.warehouseId, warehouseId),
        eq(inventoryBalances.itemId, itemId),
      ];

      if (lotId) {
        conditions.push(eq(inventoryBalances.lotId, lotId));
      } else {
        conditions.push(sql`${inventoryBalances.lotId} IS NULL`);
      }

      const [balance] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(...conditions))
        .limit(1);

      return (
        balance ?? {
          warehouseId,
          itemId,
          lotId: lotId ?? null,
          onHandQty: '0.0000',
          reservedQty: '0.0000',
          version: 1,
        }
      );
    });
  }

  // ==================================================================
  // 2. Stock Movements
  // ==================================================================

  async getMovements(context: TenantContext, query?: InventoryMovementQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(inventoryMovements.tenantId, context.tenantId)];

      if (query?.warehouseId) {
        conditions.push(eq(inventoryMovements.warehouseId, query.warehouseId));
      }

      if (query?.itemId) {
        conditions.push(eq(inventoryMovements.itemId, query.itemId));
      }

      if (query?.movementType) {
        conditions.push(eq(inventoryMovements.movementType, query.movementType));
      }

      if (query?.direction) {
        conditions.push(eq(inventoryMovements.direction, query.direction));
      }

      const limit = query?.limit ?? 100;
      const offset = query?.offset ?? 0;

      return await tx
        .select()
        .from(inventoryMovements)
        .where(and(...conditions))
        .orderBy(desc(inventoryMovements.occurredAt))
        .limit(limit)
        .offset(offset);
    });
  }

  // ==================================================================
  // 3. Stock Transfers Workflow (Draft -> In Transit -> Received)
  // ==================================================================

  async createTransfer(context: TenantContext, dto: CreateStockTransferRequest) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Source and destination warehouses cannot be the same');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate warehouses exist
      const [sourceWh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.sourceWarehouseId)
          )
        )
        .limit(1);

      if (!sourceWh) {
        throw new NotFoundException(`Source warehouse '${dto.sourceWarehouseId}' not found`);
      }

      const [destWh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.destinationWarehouseId)
          )
        )
        .limit(1);

      if (!destWh) {
        throw new NotFoundException(`Destination warehouse '${dto.destinationWarehouseId}' not found`);
      }

      // Check transferNumber uniqueness for legal entity
      const [existingNumber] = await tx
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.tenantId, context.tenantId),
            eq(stockTransfers.legalEntityId, dto.legalEntityId),
            eq(stockTransfers.transferNumber, dto.transferNumber)
          )
        )
        .limit(1);

      if (existingNumber) {
        throw new ConflictException(`Transfer number '${dto.transferNumber}' already exists in this legal entity`);
      }

      // Insert Header
      const [transfer] = await tx
        .insert(stockTransfers)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          transferNumber: dto.transferNumber,
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          status: TransferStatus.DRAFT,
          requestedBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (!transfer) throw new Error('Failed to create stock transfer');

      // Insert Lines
      const lineValues = dto.lines.map((l) => ({
        transferId: transfer.id,
        itemId: l.itemId,
        uomId: l.uomId,
        quantity: l.quantity,
        unitCost: l.unitCost ?? '0.0000',
      }));

      const lines = await tx.insert(stockTransferLines).values(lineValues).returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_CREATED',
          entityType: 'stock_transfer',
          entityId: transfer.id,
          afterState: { transfer, lines },
        },
        tx
      );

      return {
        ...transfer,
        lines,
      };
    });
  }

  async dispatchTransfer(
    context: TenantContext,
    transferId: string,
    dto: DispatchTransferRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.tenantId, context.tenantId),
            eq(stockTransfers.id, transferId)
          )
        )
        .limit(1);

      if (!transfer) {
        throw new NotFoundException(`Stock transfer '${transferId}' not found`);
      }

      if (transfer.status !== TransferStatus.DRAFT) {
        throw new BadRequestException(`Cannot dispatch transfer with status '${transfer.status}'`);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      if (lines.length === 0) {
        throw new BadRequestException('Cannot dispatch transfer with no lines');
      }

      // Deduct stock from source warehouse and record TRANSFER_OUT movements
      for (const line of lines) {
        const [currentBalance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
              eq(inventoryBalances.itemId, line.itemId),
              sql`${inventoryBalances.lotId} IS NULL`
            )
          )
          .limit(1);

        const onHand = parseFloat(currentBalance?.onHandQty ?? '0');
        const transferQty = parseFloat(line.quantity);

        if (onHand < transferQty) {
          throw new BadRequestException(
            `Insufficient stock for item '${line.itemId}' in source warehouse (Available: ${onHand}, Requested: ${transferQty})`
          );
        }

        const newOnHand = (onHand - transferQty).toFixed(4);

        if (currentBalance) {
          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              version: currentBalance.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventoryBalances.id, currentBalance.id),
                eq(inventoryBalances.version, currentBalance.version)
              )
            );
        }

        // Record TRANSFER_OUT movement
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: transfer.legalEntityId,
          warehouseId: transfer.sourceWarehouseId,
          itemId: line.itemId,
          movementType: MovementType.TRANSFER_OUT,
          direction: MovementDirection.OUT,
          quantity: line.quantity,
          unitCost: line.unitCost,
          sourceType: 'stock_transfer',
          sourceId: transfer.id,
        });
      }

      // Update transfer status to IN_TRANSIT
      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.IN_TRANSIT,
          dispatchedBy: context.userId,
          dispatchedAt: new Date(),
          notes: dto.dispatchedNotes ? `${transfer.notes ?? ''}\nDispatch: ${dto.dispatchedNotes}`.trim() : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_DISPATCHED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async receiveTransfer(
    context: TenantContext,
    transferId: string,
    dto: ReceiveTransferRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.tenantId, context.tenantId),
            eq(stockTransfers.id, transferId)
          )
        )
        .limit(1);

      if (!transfer) {
        throw new NotFoundException(`Stock transfer '${transferId}' not found`);
      }

      if (transfer.status !== TransferStatus.IN_TRANSIT) {
        throw new BadRequestException(`Cannot receive transfer with status '${transfer.status}'. Transfer must be IN_TRANSIT.`);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      const receivedMap = new Map(dto.receivedLines.map((r) => [r.itemId, r.receivedQuantity]));

      for (const line of lines) {
        const receivedQtyStr = receivedMap.get(line.itemId) ?? line.quantity;
        const receivedQty = parseFloat(receivedQtyStr);

        // Update receivedQuantity on line
        await tx
          .update(stockTransferLines)
          .set({ receivedQuantity: receivedQtyStr })
          .where(eq(stockTransferLines.id, line.id));

        // Credit destination warehouse balance
        const [destBalance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.destinationWarehouseId),
              eq(inventoryBalances.itemId, line.itemId),
              sql`${inventoryBalances.lotId} IS NULL`
            )
          )
          .limit(1);

        if (destBalance) {
          const currentOnHand = parseFloat(destBalance.onHandQty);
          const newOnHand = (currentOnHand + receivedQty).toFixed(4);

          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              version: destBalance.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventoryBalances.id, destBalance.id),
                eq(inventoryBalances.version, destBalance.version)
              )
            );
        } else {
          await tx.insert(inventoryBalances).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: transfer.legalEntityId,
            warehouseId: transfer.destinationWarehouseId,
            itemId: line.itemId,
            onHandQty: receivedQty.toFixed(4),
            reservedQty: '0.0000',
            version: 1,
          });
        }

        // Record TRANSFER_IN movement
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: transfer.legalEntityId,
          warehouseId: transfer.destinationWarehouseId,
          itemId: line.itemId,
          movementType: MovementType.TRANSFER_IN,
          direction: MovementDirection.IN,
          quantity: receivedQtyStr,
          unitCost: line.unitCost,
          sourceType: 'stock_transfer',
          sourceId: transfer.id,
        });
      }

      // Update transfer status to RECEIVED
      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.RECEIVED,
          receivedBy: context.userId,
          receivedAt: new Date(),
          notes: dto.receivedNotes ? `${transfer.notes ?? ''}\nReceipt: ${dto.receivedNotes}`.trim() : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_RECEIVED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  // ==================================================================
  // 4. Stock Adjustments (Physical count variance, damage, waste)
  // ==================================================================

  async createAdjustment(context: TenantContext, dto: CreateStockAdjustmentRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate warehouse
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.warehouseId)
          )
        )
        .limit(1);

      if (!warehouse) {
        throw new NotFoundException(`Warehouse '${dto.warehouseId}' not found`);
      }

      // Insert Adjustment Header
      const [adjustment] = await tx
        .insert(stockAdjustments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          adjustmentNumber: dto.adjustmentNumber,
          reason: dto.reason,
          notes: dto.notes || null,
          adjustedBy: context.userId,
        })
        .returning();

      if (!adjustment) throw new Error('Failed to create stock adjustment');

      const createdLines = [];

      for (const line of dto.lines) {
        // Fetch current system balance
        const balanceConditions = [
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.warehouseId, dto.warehouseId),
          eq(inventoryBalances.itemId, line.itemId),
        ];

        if (line.lotId) {
          balanceConditions.push(eq(inventoryBalances.lotId, line.lotId));
        } else {
          balanceConditions.push(sql`${inventoryBalances.lotId} IS NULL`);
        }

        const [balance] = await tx
          .select()
          .from(inventoryBalances)
          .where(and(...balanceConditions))
          .limit(1);

        // Fetch item default cost for valuation
        const [item] = await tx
          .select({ defaultCost: items.defaultCost })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        const unitCost = item ? parseFloat(item.defaultCost) : 0;
        const systemQty = balance ? parseFloat(balance.onHandQty) : 0;
        const countedQty = parseFloat(line.countedQuantity);
        const differenceQty = countedQty - systemQty;
        const totalVariance = Math.abs(differenceQty * unitCost);

        const [adjLine] = await tx
          .insert(stockAdjustmentLines)
          .values({
            adjustmentId: adjustment.id,
            itemId: line.itemId,
            lotId: line.lotId || null,
            uomId: line.uomId,
            systemQuantity: systemQty.toFixed(4),
            countedQuantity: countedQty.toFixed(4),
            differenceQuantity: differenceQty.toFixed(4),
            unitCost: unitCost.toFixed(4),
            totalVarianceAmount: totalVariance.toFixed(4),
          })
          .returning();

        createdLines.push(adjLine);

        // Update inventory balance to match counted quantity
        if (balance) {
          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: countedQty.toFixed(4),
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventoryBalances.id, balance.id),
                eq(inventoryBalances.version, balance.version)
              )
            );
        } else {
          await tx.insert(inventoryBalances).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: dto.legalEntityId,
            warehouseId: dto.warehouseId,
            itemId: line.itemId,
            lotId: line.lotId || null,
            onHandQty: countedQty.toFixed(4),
            reservedQty: '0.0000',
            version: 1,
          });
        }

        // Record stock adjustment movement if there is a difference
        if (Math.abs(differenceQty) > 0.00001) {
          await tx.insert(inventoryMovements).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: dto.legalEntityId,
            warehouseId: dto.warehouseId,
            itemId: line.itemId,
            movementType: MovementType.STOCK_ADJUSTMENT,
            direction: differenceQty > 0 ? MovementDirection.IN : MovementDirection.OUT,
            quantity: Math.abs(differenceQty).toFixed(4),
            unitCost: unitCost.toFixed(4),
            sourceType: 'stock_adjustment',
            sourceId: adjustment.id,
          });
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_ADJUSTMENT_POSTED',
          entityType: 'stock_adjustment',
          entityId: adjustment.id,
          afterState: { adjustment, lines: createdLines },
        },
        tx
      );

      return {
        ...adjustment,
        lines: createdLines,
      };
    });
  }

  // ==================================================================
  // 5. FIFO Cost Layers & Valuation Engine
  // ==================================================================

  /**
   * Internal transactional helper: creates a receipt cost layer for FIFO tracking
   */
  async recordCostLayer(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      lotId?: string | null;
      quantity: string;
      unitCost: string;
      sourceType: string;
      sourceId: string;
    }
  ) {
    const [layer] = await tx
      .insert(inventoryCostLayers)
      .values({
        tenantId: data.tenantId,
        legalEntityOwnerId: data.legalEntityOwnerId,
        warehouseId: data.warehouseId,
        itemId: data.itemId,
        lotId: data.lotId || null,
        quantityReceived: data.quantity,
        quantityRemaining: data.quantity,
        unitCost: data.unitCost,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
      })
      .returning();

    return layer;
  }

  /**
   * Internal transactional helper: consumes stock using First-In, First-Out (FIFO)
   * Prevents negative stock at the layer level and returns exact consumed cost.
   */
  async consumeCostLayersFifo(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToConsume: number;
    }
  ): Promise<{ totalCost: number; unitCost: number; exhaustedLayersCount: number }> {
    const layers = await tx
      .select()
      .from(inventoryCostLayers)
      .where(
        and(
          eq(inventoryCostLayers.tenantId, data.tenantId),
          eq(inventoryCostLayers.legalEntityOwnerId, data.legalEntityOwnerId),
          eq(inventoryCostLayers.warehouseId, data.warehouseId),
          eq(inventoryCostLayers.itemId, data.itemId),
          sql`CAST(${inventoryCostLayers.quantityRemaining} AS NUMERIC) > 0`
        )
      )
      .orderBy(asc(inventoryCostLayers.createdAt));

    let remainingQtyToDeduct = data.quantityToConsume;
    let totalCostConsumed = 0;
    let layersCount = 0;

    for (const layer of layers) {
      if (remainingQtyToDeduct <= 0.00001) break;

      const layerRem = parseFloat(layer.quantityRemaining);
      const layerCost = parseFloat(layer.unitCost);

      if (layerRem <= remainingQtyToDeduct) {
        // Exhaust this layer
        totalCostConsumed += layerRem * layerCost;
        remainingQtyToDeduct -= layerRem;
        layersCount++;

        await tx
          .update(inventoryCostLayers)
          .set({ quantityRemaining: '0.0000' })
          .where(eq(inventoryCostLayers.id, layer.id));
      } else {
        // Partially deduct from this layer
        totalCostConsumed += remainingQtyToDeduct * layerCost;
        const newRemaining = (layerRem - remainingQtyToDeduct).toFixed(4);
        remainingQtyToDeduct = 0;
        layersCount++;

        await tx
          .update(inventoryCostLayers)
          .set({ quantityRemaining: newRemaining })
          .where(eq(inventoryCostLayers.id, layer.id));
      }
    }

    if (remainingQtyToDeduct > 0.0001) {
      throw new BadRequestException(
        `Negative Stock Violation: Insufficient FIFO inventory layers for item '${data.itemId}' in warehouse '${data.warehouseId}'. Shortage: ${remainingQtyToDeduct.toFixed(4)} units`
      );
    }

    const effectiveUnitCost =
      data.quantityToConsume > 0 ? totalCostConsumed / data.quantityToConsume : 0;

    return {
      totalCost: totalCostConsumed,
      unitCost: effectiveUnitCost,
      exhaustedLayersCount: layersCount,
    };
  }

  /**
   * Internal transactional helper: consumes stock using Weighted Average Costing (WAC)
   */
  async consumeStockWeightedAverage(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToConsume: number;
    }
  ): Promise<{ totalCost: number; unitCost: number }> {
    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, data.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, data.legalEntityOwnerId),
          eq(inventoryBalances.warehouseId, data.warehouseId),
          eq(inventoryBalances.itemId, data.itemId),
          sql`${inventoryBalances.lotId} IS NULL`
        )
      )
      .limit(1);

    const onHand = balance ? parseFloat(balance.onHandQty) : 0;
    if (onHand < data.quantityToConsume) {
      throw new BadRequestException(
        `Negative Stock Violation (WAC): Insufficient stock for item '${data.itemId}' in warehouse '${data.warehouseId}'. On-hand: ${onHand.toFixed(4)}, requested: ${data.quantityToConsume.toFixed(4)}`
      );
    }

    const [item] = await tx
      .select({ defaultCost: items.defaultCost })
      .from(items)
      .where(and(eq(items.tenantId, data.tenantId), eq(items.id, data.itemId)))
      .limit(1);

    const unitCost = item ? parseFloat(item.defaultCost) : 0;
    const totalCost = data.quantityToConsume * unitCost;

    return { totalCost, unitCost };
  }

  /**
   * Internal transactional helper: consumes stock using the item's configured costing method (FIFO or WAC)
   */
  async consumeStockUnified(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToConsume: number;
    }
  ): Promise<{ totalCost: number; unitCost: number }> {
    const [item] = await tx
      .select({ costingMethod: items.costingMethod })
      .from(items)
      .where(and(eq(items.tenantId, data.tenantId), eq(items.id, data.itemId)))
      .limit(1);

    if (item && item.costingMethod === 'WEIGHTED_AVERAGE') {
      return await this.consumeStockWeightedAverage(tx, data);
    } else {
      const res = await this.consumeCostLayersFifo(tx, data);
      return { totalCost: res.totalCost, unitCost: res.unitCost };
    }
  }

  /**
   * Internal transactional helper: Reserves inventory (e.g. for open orders or preparing kitchen batches)
   * Prevents over-selling by checking (onHand - reserved >= requested).
   */
  async reserveStockTx(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToReserve: number;
    }
  ) {
    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, data.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, data.legalEntityOwnerId),
          eq(inventoryBalances.warehouseId, data.warehouseId),
          eq(inventoryBalances.itemId, data.itemId),
          sql`${inventoryBalances.lotId} IS NULL`
        )
      )
      .limit(1);

    if (!balance) {
      throw new BadRequestException(
        `Negative Stock Violation: No stock balance record found for item '${data.itemId}' in warehouse '${data.warehouseId}'`
      );
    }

    const onHand = parseFloat(balance.onHandQty);
    const reserved = parseFloat(balance.reservedQty);
    const available = onHand - reserved;

    if (available < data.quantityToReserve) {
      throw new BadRequestException(
        `Negative Stock Violation: Insufficient available stock to reserve item '${data.itemId}'. Available: ${available.toFixed(4)}, Requested: ${data.quantityToReserve.toFixed(4)}`
      );
    }

    const newReserved = (reserved + data.quantityToReserve).toFixed(4);

    const [updated] = await tx
      .update(inventoryBalances)
      .set({
        reservedQty: newReserved,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBalances.id, balance.id),
          eq(inventoryBalances.version, balance.version)
        )
      )
      .returning();

    if (!updated) {
      throw new ConflictException(
        `Optimistic lock failure while reserving stock for item '${data.itemId}'. Please retry.`
      );
    }

    return updated;
  }

  /**
   * Internal transactional helper: Releases previously reserved stock (e.g. upon order cancellation)
   */
  async releaseStockTx(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToRelease: number;
    }
  ) {
    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, data.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, data.legalEntityOwnerId),
          eq(inventoryBalances.warehouseId, data.warehouseId),
          eq(inventoryBalances.itemId, data.itemId),
          sql`${inventoryBalances.lotId} IS NULL`
        )
      )
      .limit(1);

    if (!balance) return null;

    const currentReserved = parseFloat(balance.reservedQty);
    const newReserved = Math.max(0, currentReserved - data.quantityToRelease).toFixed(4);

    const [updated] = await tx
      .update(inventoryBalances)
      .set({
        reservedQty: newReserved,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBalances.id, balance.id),
          eq(inventoryBalances.version, balance.version)
        )
      )
      .returning();

    return updated;
  }

  /**
   * Internal transactional helper: Commits previously reserved stock upon order completion / dispatch.
   * Deducts both reservedQty and onHandQty, and records cost layer deduction.
   */
  async commitReservedStockTx(
    tx: any,
    data: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantityToCommit: number;
      sourceType: string;
      sourceId: string;
    }
  ) {
    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, data.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, data.legalEntityOwnerId),
          eq(inventoryBalances.warehouseId, data.warehouseId),
          eq(inventoryBalances.itemId, data.itemId),
          sql`${inventoryBalances.lotId} IS NULL`
        )
      )
      .limit(1);

    if (!balance) {
      throw new BadRequestException(
        `Stock commitment failure: No stock balance record found for item '${data.itemId}'`
      );
    }

    const currentOnHand = parseFloat(balance.onHandQty);
    const currentReserved = parseFloat(balance.reservedQty);

    const newOnHand = Math.max(0, currentOnHand - data.quantityToCommit).toFixed(4);
    const newReserved = Math.max(0, currentReserved - data.quantityToCommit).toFixed(4);

    // 1. Update balances
    const [updated] = await tx
      .update(inventoryBalances)
      .set({
        onHandQty: newOnHand,
        reservedQty: newReserved,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBalances.id, balance.id),
          eq(inventoryBalances.version, balance.version)
        )
      )
      .returning();

    // 2. Consume cost layer (FIFO or WAC)
    const costResult = await this.consumeStockUnified(tx, {
      tenantId: data.tenantId,
      legalEntityOwnerId: data.legalEntityOwnerId,
      warehouseId: data.warehouseId,
      itemId: data.itemId,
      quantityToConsume: data.quantityToCommit,
    });

    // 3. Write movement ledger
    await tx.insert(inventoryMovements).values({
      tenantId: data.tenantId,
      legalEntityOwnerId: data.legalEntityOwnerId,
      warehouseId: data.warehouseId,
      itemId: data.itemId,
      movementType: MovementType.SALE_ISSUE,
      direction: MovementDirection.OUT,
      quantity: data.quantityToCommit.toFixed(4),
      unitCost: costResult.unitCost.toFixed(4),
      sourceType: data.sourceType,
      sourceId: data.sourceId,
    });

    return {
      updatedBalance: updated,
      costConsumed: costResult.totalCost,
      unitCost: costResult.unitCost,
    };
  }

  /**
   * Retrieves valuation report across items and warehouses
   */
  async getInventoryValuation(
    context: TenantContext,
    params?: { warehouseId?: string; legalEntityId?: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(inventoryBalances.tenantId, context.tenantId)];

      if (params?.warehouseId) {
        conditions.push(eq(inventoryBalances.warehouseId, params.warehouseId));
      }

      if (params?.legalEntityId) {
        conditions.push(eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId));
      }

      const rows = await tx
        .select({
          warehouseId: inventoryBalances.warehouseId,
          legalEntityOwnerId: inventoryBalances.legalEntityOwnerId,
          itemId: inventoryBalances.itemId,
          itemSku: items.sku,
          itemNameAr: items.nameAr,
          itemNameEn: items.nameEn,
          defaultCost: items.defaultCost,
          costingMethod: items.costingMethod,
          onHandQty: inventoryBalances.onHandQty,
          reservedQty: inventoryBalances.reservedQty,
        })
        .from(inventoryBalances)
        .innerJoin(items, eq(inventoryBalances.itemId, items.id))
        .where(and(...conditions))
        .orderBy(asc(items.sku));

      let totalValuation = 0;

      const itemsWithValuation = rows.map((r) => {
        const qty = parseFloat(r.onHandQty);
        const cost = parseFloat(r.defaultCost);
        const lineValuation = qty * cost;
        totalValuation += lineValuation;

        return {
          ...r,
          totalValuation: lineValuation.toFixed(4),
        };
      });

      return {
        totalValuation: totalValuation.toFixed(4),
        itemCount: itemsWithValuation.length,
        items: itemsWithValuation,
      };
    });
  }

  // ==================================================================
  // 9. Warehouse Management (Phase A)
  // ==================================================================

  async createWarehouse(context: TenantContext, dto: CreateWarehouseRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const existing = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.code, dto.code.trim().toUpperCase())
          )
        );

      if (existing.length > 0) {
        throw new ConflictException(`كود المستودع (${dto.code.trim().toUpperCase()}) مستخدم بالفعل`);
      }

      const [warehouse] = await tx
        .insert(warehouses)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId || null,
          branchId: dto.branchId || null,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          nameAr: dto.nameAr?.trim() || dto.name.trim(),
          nameEn: dto.nameEn?.trim() || null,
          warehouseType: dto.warehouseType || WarehouseType.BRANCH,
          managerId: dto.managerId || null,
          address: dto.address || null,
          allowReceiving: dto.allowReceiving ?? true,
          allowIssuing: dto.allowIssuing ?? true,
          allowTransfer: dto.allowTransfer ?? true,
          status: 'ACTIVE',
        })
        .returning();

      if (!warehouse) {
        throw new BadRequestException('فشل إنشاء المستودع');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'WAREHOUSE_CREATE',
          entityType: 'WAREHOUSE',
          entityId: warehouse.id,
          afterState: warehouse as unknown as Record<string, unknown>,
        },
        tx
      );

      return warehouse;
    });
  }

  async listWarehouses(
    context: TenantContext,
    params?: { legalEntityId?: string; branchId?: string; warehouseType?: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(warehouses.tenantId, context.tenantId)];

      if (params?.legalEntityId) {
        conditions.push(eq(warehouses.legalEntityId, params.legalEntityId));
      }
      if (params?.branchId) {
        conditions.push(eq(warehouses.branchId, params.branchId));
      }
      if (params?.warehouseType) {
        conditions.push(eq(warehouses.warehouseType, params.warehouseType));
      }

      return await tx
        .select()
        .from(warehouses)
        .where(and(...conditions))
        .orderBy(asc(warehouses.code));
    });
  }

  async getWarehouse(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, id)));

      if (!warehouse) {
        throw new NotFoundException('المستودع المطلوب غير موجود');
      }

      return warehouse;
    });
  }

  async updateWarehouse(context: TenantContext, id: string, dto: UpdateWarehouseRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, id)));

      if (!existing) {
        throw new NotFoundException('المستودع المطلوب غير موجود');
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.nameAr !== undefined) updateData.nameAr = dto.nameAr?.trim() || null;
      if (dto.nameEn !== undefined) updateData.nameEn = dto.nameEn?.trim() || null;
      if (dto.managerId !== undefined) updateData.managerId = dto.managerId;
      if (dto.address !== undefined) updateData.address = dto.address;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.allowReceiving !== undefined) updateData.allowReceiving = dto.allowReceiving;
      if (dto.allowIssuing !== undefined) updateData.allowIssuing = dto.allowIssuing;
      if (dto.allowTransfer !== undefined) updateData.allowTransfer = dto.allowTransfer;

      const [updated] = await tx
        .update(warehouses)
        .set(updateData)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, id)))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل تحديث المستودع');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'WAREHOUSE_UPDATE',
          entityType: 'WAREHOUSE',
          entityId: id,
          beforeState: existing as unknown as Record<string, unknown>,
          afterState: updated as unknown as Record<string, unknown>,
        },
        tx
      );

      return updated;
    });
  }

  // ==================================================================
  // 10. Direct Receiving & Dynamic WAC Recalculation (Phase A)
  // ==================================================================

  async receiveStock(context: TenantContext, dto: ReceiveStockRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Warehouse validation
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.warehouseId)));

      if (!warehouse) {
        throw new NotFoundException('المستودع المحدد غير موجود');
      }
      if (warehouse.status !== 'ACTIVE') {
        throw new BadRequestException('المستودع المحدد غير نشط حالياً');
      }
      if (!warehouse.allowReceiving) {
        throw new BadRequestException('إعدادات هذا المستودع تمنع الاستلام المباشر');
      }

      // 2. Item validation
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.tenantId, context.tenantId), eq(items.id, dto.itemId)));

      if (!item) {
        throw new NotFoundException('الصنف المحدد غير موجود');
      }

      const inQty = parseFloat(dto.quantity);
      const inCost = parseFloat(dto.unitCost);

      if (isNaN(inQty) || inQty <= 0) {
        throw new BadRequestException('كمية الاستلام يجب أن تكون أكبر من الصفر');
      }
      if (isNaN(inCost) || inCost < 0) {
        throw new BadRequestException('سعر وحدة الاستلام يجب أن يكون مساوياً أو أكبر من الصفر');
      }

      // 3. Fetch current balance
      const [currentBalance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, dto.warehouseId),
            eq(inventoryBalances.itemId, dto.itemId)
          )
        );

      const existingOnHand = currentBalance ? parseFloat(currentBalance.onHandQty) : 0;
      const existingWac = currentBalance ? parseFloat(currentBalance.wacCost) : 0;

      // 4. Dynamic WAC recalculation formula:
      // New WAC = (ExistingOnHand * ExistingWAC + InQty * InCost) / (ExistingOnHand + InQty)
      let newWac: number;
      if (existingOnHand <= 0) {
        newWac = inCost;
      } else {
        const totalOldValue = existingOnHand * existingWac;
        const totalIncomingValue = inQty * inCost;
        newWac = (totalOldValue + totalIncomingValue) / (existingOnHand + inQty);
      }

      const newOnHand = existingOnHand + inQty;
      const effectiveLegalEntityId = dto.legalEntityId || warehouse.legalEntityId || (currentBalance?.legalEntityOwnerId);

      if (!effectiveLegalEntityId) {
        throw new BadRequestException('يجب تحديد الشركة المالكة للمخزون');
      }

      let updatedBalance;
      if (currentBalance) {
        [updatedBalance] = await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand.toFixed(4),
            wacCost: newWac.toFixed(4),
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, currentBalance.id))
          .returning();
      } else {
        [updatedBalance] = await tx
          .insert(inventoryBalances)
          .values({
            tenantId: context.tenantId,
            legalEntityOwnerId: effectiveLegalEntityId,
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            onHandQty: newOnHand.toFixed(4),
            reservedQty: '0.0000',
            inTransitQty: '0.0000',
            damagedQty: '0.0000',
            underInspectionQty: '0.0000',
            wacCost: newWac.toFixed(4),
            minStock: '0.0000',
            maxStock: '0.0000',
            reorderPoint: '0.0000',
            version: 1,
            updatedAt: new Date(),
          })
          .returning();
      }

      // 5. Central Movement Ledger entry
      const movementNumber = `MOV-RCV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
      const totalCost = (inQty * inCost).toFixed(4);

      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          tenantId: context.tenantId,
          legalEntityOwnerId: effectiveLegalEntityId,
          warehouseId: dto.warehouseId,
          destinationWarehouseId: dto.warehouseId,
          itemId: dto.itemId,
          movementNumber,
          movementType: dto.movementType || MovementType.PURCHASE_RECEIPT,
          direction: MovementDirection.IN,
          uomId: dto.uomId,
          quantity: inQty.toFixed(4),
          unitCost: inCost.toFixed(4),
          totalCost,
          batchNumber: dto.batchNumber || null,
          sourceType: dto.sourceType || 'PURCHASE_RECEIPT',
          sourceId: dto.sourceId || sql`gen_random_uuid()`,
          sourceDocumentNumber: dto.sourceDocumentNumber || null,
          performedBy: context.userId || null,
          notes: dto.notes || null,
          status: 'COMPLETED',
          isReversed: false,
          occurredAt: new Date(),
        })
        .returning();

      if (!movement) {
        throw new BadRequestException('فشل تسجيل حركة استلام المخزون');
      }

      // 6. Record Cost Layer
      await tx
        .insert(inventoryCostLayers)
        .values({
          tenantId: context.tenantId,
          legalEntityOwnerId: effectiveLegalEntityId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          quantityReceived: inQty.toFixed(4),
          quantityRemaining: inQty.toFixed(4),
          unitCost: inCost.toFixed(4),
          sourceType: dto.sourceType || 'PURCHASE_RECEIPT',
          sourceId: movement.id,
          createdAt: new Date(),
        });

      // 7. Audit log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INVENTORY_RECEIVE',
          entityType: 'INVENTORY_MOVEMENT',
          entityId: movement.id,
          afterState: { movement, balance: updatedBalance },
        },
        tx
      );

      return {
        movement,
        balance: updatedBalance,
      };
    });
  }

  // ==================================================================
  // 11. Direct Issuing & Non-Negative Stock Enforcement (Phase A)
  // ==================================================================

  async issueStock(context: TenantContext, dto: IssueStockRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Warehouse validation
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.warehouseId)));

      if (!warehouse) {
        throw new NotFoundException('المستودع المحدد غير موجود');
      }
      if (warehouse.status !== 'ACTIVE') {
        throw new BadRequestException('المستودع المحدد غير نشط حالياً');
      }
      if (!warehouse.allowIssuing) {
        throw new BadRequestException('إعدادات هذا المستودع تمنع الصرف المباشر');
      }

      // 2. Item validation
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.tenantId, context.tenantId), eq(items.id, dto.itemId)));

      if (!item) {
        throw new NotFoundException('الصنف المحدد غير موجود');
      }

      const issueQty = parseFloat(dto.quantity);
      if (isNaN(issueQty) || issueQty <= 0) {
        throw new BadRequestException('كمية الصرف يجب أن تكون أكبر من الصفر');
      }

      // 3. Current balance and strict availability check
      const [currentBalance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, dto.warehouseId),
            eq(inventoryBalances.itemId, dto.itemId)
          )
        );

      if (!currentBalance) {
        throw new BadRequestException('لا يوجد رصيد مسجل لهذا الصنف في هذا المستودع');
      }

      const onHand = parseFloat(currentBalance.onHandQty);
      const reserved = parseFloat(currentBalance.reservedQty);
      const damaged = parseFloat(currentBalance.damagedQty || '0');
      const inspection = parseFloat(currentBalance.underInspectionQty || '0');
      const availableQty = onHand - reserved - damaged - inspection;

      if (availableQty < issueQty) {
        throw new BadRequestException(
          `الرصيد المتاح غير كافٍ للصرف. المتاح: ${availableQty.toFixed(4)}، المطلوب: ${issueQty.toFixed(4)}`
        );
      }

      // 4. Issue at Current WAC
      const currentWac = parseFloat(currentBalance.wacCost) || parseFloat(item.defaultCost) || 0;
      const newOnHand = onHand - issueQty;
      const totalCost = (issueQty * currentWac).toFixed(4);

      const [updatedBalance] = await tx
        .update(inventoryBalances)
        .set({
          onHandQty: newOnHand.toFixed(4),
          version: sql`${inventoryBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBalances.id, currentBalance.id))
        .returning();

      // 5. Central Movement Ledger entry
      const movementNumber = `MOV-ISS-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          tenantId: context.tenantId,
          legalEntityOwnerId: currentBalance.legalEntityOwnerId,
          warehouseId: dto.warehouseId,
          sourceWarehouseId: dto.warehouseId,
          itemId: dto.itemId,
          movementNumber,
          movementType: dto.movementType || MovementType.INTERNAL_CONSUMPTION,
          direction: MovementDirection.OUT,
          uomId: dto.uomId,
          quantity: issueQty.toFixed(4),
          unitCost: currentWac.toFixed(4),
          totalCost,
          batchNumber: dto.batchNumber || null,
          sourceType: dto.sourceType || 'MANUAL_ISSUE',
          sourceId: dto.sourceId || sql`gen_random_uuid()`,
          sourceDocumentNumber: dto.sourceDocumentNumber || null,
          performedBy: context.userId || null,
          notes: dto.notes || null,
          status: 'COMPLETED',
          isReversed: false,
          occurredAt: new Date(),
        })
        .returning();

      if (!movement) {
        throw new BadRequestException('فشل تسجيل حركة صرف المخزون');
      }

      // 6. Audit log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INVENTORY_ISSUE',
          entityType: 'INVENTORY_MOVEMENT',
          entityId: movement.id,
          afterState: { movement, balance: updatedBalance },
        },
        tx
      );

      return {
        movement,
        balance: updatedBalance,
      };
    });
  }

  // ==================================================================
  // 12. Central Movement Reversal (Phase A)
  // ==================================================================

  async reverseMovement(context: TenantContext, dto: ReverseInventoryMovementRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Fetch original movement
      const [original] = await tx
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, context.tenantId),
            eq(inventoryMovements.id, dto.movementId)
          )
        );

      if (!original) {
        throw new NotFoundException('حركة المخزون المطلوب عكسها غير موجودة');
      }

      if (original.isReversed) {
        throw new ConflictException('تم عكس هذه الحركة مسبقاً، ولا يمكن عكس الحركة أكثر من مرة');
      }

      const moveQty = parseFloat(original.quantity);
      const moveCost = parseFloat(original.unitCost);

      // 2. Fetch current balance
      const [balance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, original.warehouseId),
            eq(inventoryBalances.itemId, original.itemId)
          )
        );

      if (!balance) {
        throw new BadRequestException('لا يوجد رصيد حالي مسجل لهذا الصنف في هذا المستودع');
      }

      let newOnHand: number;
      let newDirection: MovementDirection;

      if (original.direction === MovementDirection.IN) {
        // Reversing an IN movement means deducting stock (OUT)
        const currentOnHand = parseFloat(balance.onHandQty);
        const reserved = parseFloat(balance.reservedQty);
        const damaged = parseFloat(balance.damagedQty || '0');
        const inspection = parseFloat(balance.underInspectionQty || '0');
        const available = currentOnHand - reserved - damaged - inspection;

        if (available < moveQty) {
          throw new BadRequestException(
            `لا يمكن عكس حركة الاستلام لأن الرصيد المتاح (${available.toFixed(4)}) أقل من الكمية المعكوسة (${moveQty.toFixed(4)})`
          );
        }

        newOnHand = currentOnHand - moveQty;
        newDirection = MovementDirection.OUT;
      } else {
        // Reversing an OUT movement means returning stock (IN)
        const currentOnHand = parseFloat(balance.onHandQty);
        newOnHand = currentOnHand + moveQty;
        newDirection = MovementDirection.IN;
      }

      // 3. Update stock balance
      const [updatedBalance] = await tx
        .update(inventoryBalances)
        .set({
          onHandQty: newOnHand.toFixed(4),
          version: sql`${inventoryBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBalances.id, balance.id))
        .returning();

      // 4. Mark original movement as reversed
      await tx
        .update(inventoryMovements)
        .set({
          isReversed: true,
        })
        .where(eq(inventoryMovements.id, original.id));

      // 5. Create inverse reversal movement
      const reversalNumber =
        dto.newMovementNumber ||
        `MOV-REV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

      const [reversalMovement] = await tx
        .insert(inventoryMovements)
        .values({
          tenantId: context.tenantId,
          legalEntityOwnerId: original.legalEntityOwnerId,
          warehouseId: original.warehouseId,
          sourceWarehouseId: newDirection === MovementDirection.OUT ? original.warehouseId : null,
          destinationWarehouseId: newDirection === MovementDirection.IN ? original.warehouseId : null,
          itemId: original.itemId,
          movementNumber: reversalNumber,
          movementType: original.movementType,
          direction: newDirection,
          uomId: original.uomId,
          quantity: moveQty.toFixed(4),
          unitCost: moveCost.toFixed(4),
          totalCost: original.totalCost,
          sourceType: 'REVERSAL',
          sourceId: original.id,
          sourceDocumentNumber: original.movementNumber || original.id,
          performedBy: context.userId || null,
          notes: `عكس الحركة رقم ${original.movementNumber || original.id}: ${dto.reversalReason}`,
          status: 'COMPLETED',
          isReversed: false,
          reversalOfId: original.id,
          occurredAt: new Date(),
        })
        .returning();

      // 6. Audit log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INVENTORY_MOVEMENT_REVERSE',
          entityType: 'INVENTORY_MOVEMENT',
          entityId: original.id,
          afterState: { reversalMovement, balance: updatedBalance },
        },
        tx
      );

      return {
        originalMovementId: original.id,
        reversalMovement,
        balance: updatedBalance,
      };
    });
  }

  // ==================================================================
  // 13. Enhanced Detailed Stock Balances (Phase A)
  // ==================================================================

  async getDetailedBalances(
    context: TenantContext,
    params?: {
      warehouseId?: string;
      itemId?: string;
      legalEntityId?: string;
      stockStatus?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(inventoryBalances.tenantId, context.tenantId)];

      if (params?.warehouseId) {
        conditions.push(eq(inventoryBalances.warehouseId, params.warehouseId));
      }
      if (params?.itemId) {
        conditions.push(eq(inventoryBalances.itemId, params.itemId));
      }
      if (params?.legalEntityId) {
        conditions.push(eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId));
      }

      const rows = await tx
        .select({
          id: inventoryBalances.id,
          tenantId: inventoryBalances.tenantId,
          legalEntityOwnerId: inventoryBalances.legalEntityOwnerId,
          warehouseId: inventoryBalances.warehouseId,
          warehouseCode: warehouses.code,
          warehouseName: warehouses.name,
          warehouseType: warehouses.warehouseType,
          itemId: inventoryBalances.itemId,
          itemSku: items.sku,
          itemNameAr: items.nameAr,
          itemNameEn: items.nameEn,
          itemCostingMethod: items.costingMethod,
          itemDefaultCost: items.defaultCost,
          onHandQty: inventoryBalances.onHandQty,
          reservedQty: inventoryBalances.reservedQty,
          inTransitQty: inventoryBalances.inTransitQty,
          damagedQty: inventoryBalances.damagedQty,
          underInspectionQty: inventoryBalances.underInspectionQty,
          wacCost: inventoryBalances.wacCost,
          minStock: inventoryBalances.minStock,
          maxStock: inventoryBalances.maxStock,
          reorderPoint: inventoryBalances.reorderPoint,
          updatedAt: inventoryBalances.updatedAt,
        })
        .from(inventoryBalances)
        .innerJoin(warehouses, eq(inventoryBalances.warehouseId, warehouses.id))
        .innerJoin(items, eq(inventoryBalances.itemId, items.id))
        .where(and(...conditions))
        .orderBy(desc(inventoryBalances.updatedAt))
        .limit(params?.limit ?? 100)
        .offset(params?.offset ?? 0);

      let grandTotalValuation = 0;
      let totalOnHandCount = 0;

      const enriched = rows.map((r) => {
        const onHand = parseFloat(r.onHandQty || '0');
        const reserved = parseFloat(r.reservedQty || '0');
        const damaged = parseFloat(r.damagedQty || '0');
        const inspection = parseFloat(r.underInspectionQty || '0');
        const inTransit = parseFloat(r.inTransitQty || '0');
        const wac = parseFloat(r.wacCost || '0') || parseFloat(r.itemDefaultCost || '0');
        const min = parseFloat(r.minStock || '0');
        const max = parseFloat(r.maxStock || '0');
        const reorder = parseFloat(r.reorderPoint || '0');

        const available = Math.max(0, onHand - reserved - damaged - inspection);
        const valuation = Math.max(0, onHand - damaged) * wac;

        grandTotalValuation += valuation;
        totalOnHandCount += onHand;

        let status = 'IN_STOCK';
        if (onHand <= 0) {
          status = 'OUT_OF_STOCK';
        } else if (reorder > 0 && onHand <= reorder) {
          status = 'LOW_STOCK';
        } else if (max > 0 && onHand > max) {
          status = 'OVER_STOCKED';
        }

        return {
          ...r,
          availableQty: available.toFixed(4),
          totalValuation: valuation.toFixed(4),
          effectiveWacCost: wac.toFixed(4),
          availabilityStatus: status,
        };
      });

      // Filter by stockStatus if specified
      const filtered = params?.stockStatus
        ? enriched.filter((i) => i.availabilityStatus === params.stockStatus)
        : enriched;

      return {
        summary: {
          totalItems: filtered.length,
          totalValuation: grandTotalValuation.toFixed(4),
          totalOnHandQuantity: totalOnHandCount.toFixed(4),
        },
        items: filtered,
      };
    });
  }
}
