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
} from '@restaurant-cloud/database';
import {
  CreateStockTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
  CreateStockAdjustmentRequest,
  StockBalanceQuery,
  InventoryMovementQuery,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  TransferStatus,
  MovementType,
  MovementDirection,
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
}
