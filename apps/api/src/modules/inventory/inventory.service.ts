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
  stocktakeOrders,
  stocktakeLines,
  warehouses,
  items,
  unitsOfMeasure,
  legalEntities,
} from '@restaurant-cloud/database';
import {
  CreateStockTransferRequest,
  ApproveStockTransferRequest,
  RejectStockTransferRequest,
  CloseStockTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
  CreateStockAdjustmentRequest,
  CreateStocktakeOrderRequest,
  RecordStocktakeCountRequest,
  ApproveStocktakeOrderRequest,
  RejectStocktakeOrderRequest,
  StocktakeOrderQuery,
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
  CostingMethod,
  StocktakeType,
  StocktakeFrequency,
  StocktakeStatus,
  AdjustmentReason,
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

  async getCostLayers(
    context: TenantContext,
    params: { warehouseId: string; itemId: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(inventoryCostLayers)
        .where(
          and(
            eq(inventoryCostLayers.tenantId, context.tenantId),
            eq(inventoryCostLayers.warehouseId, params.warehouseId),
            eq(inventoryCostLayers.itemId, params.itemId)
          )
        )
        .orderBy(asc(inventoryCostLayers.createdAt));
    });
  }

  // ==================================================================
  // 3. Stock Transfers Workflow (Phase B: Draft -> Approved -> In Transit -> Received / Partial / Closed)
  // ==================================================================

  async createTransfer(context: TenantContext, dto: CreateStockTransferRequest) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('المستودع المصدر والمستودع الوجهة لا يمكن أن يكونا متطابقين');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate source warehouse
      const [sourceWh] = await tx
        .select()
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.sourceWarehouseId)
          )
        )
        .limit(1);

      if (!sourceWh) {
        throw new NotFoundException(`المستودع المصدر '${dto.sourceWarehouseId}' غير موجود`);
      }
      if (sourceWh.status !== 'ACTIVE') {
        throw new BadRequestException('المستودع المصدر غير نشط حالياً');
      }
      if (!sourceWh.allowTransfer) {
        throw new BadRequestException('إعدادات المستودع المصدر تمنع مناقلة المخزون');
      }

      // Validate destination warehouse
      const [destWh] = await tx
        .select()
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.destinationWarehouseId)
          )
        )
        .limit(1);

      if (!destWh) {
        throw new NotFoundException(`مستودع الوجهة '${dto.destinationWarehouseId}' غير موجود`);
      }
      if (destWh.status !== 'ACTIVE') {
        throw new BadRequestException('مستودع الوجهة غير نشط حالياً');
      }
      if (!destWh.allowTransfer && !destWh.allowReceiving) {
        throw new BadRequestException('إعدادات مستودع الوجهة تمنع استقبال المناقلات');
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
        throw new ConflictException(`رقم المناقلة '${dto.transferNumber}' مسجل مسبقاً في هذه المنشأة`);
      }

      // Validate available stock for each line at source
      for (const line of dto.lines) {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, dto.sourceWarehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .limit(1);

        const onHand = bal ? parseFloat(bal.onHandQty) : 0;
        const reserved = bal ? parseFloat(bal.reservedQty) : 0;
        const damaged = bal ? parseFloat(bal.damagedQty || '0') : 0;
        const inspection = bal ? parseFloat(bal.underInspectionQty || '0') : 0;
        const available = onHand - reserved - damaged - inspection;
        const reqQty = parseFloat(line.quantity);

        if (available < reqQty) {
          throw new BadRequestException(
            `الرصيد المتاح للصنف '${line.itemId}' في المستودع المصدر غير كافٍ لإنشاء المناقلة. المتاح: ${available.toFixed(4)}، المطلوب: ${reqQty.toFixed(4)}`
          );
        }
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

      if (!transfer) throw new Error('فشل إنشاء طلب مناقلة المخزون');

      // Insert Lines
      const lineValues = dto.lines.map((l) => ({
        transferId: transfer.id,
        itemId: l.itemId,
        uomId: l.uomId,
        quantity: l.quantity,
        dispatchedQuantity: '0.0000',
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

  async getTransfers(
    context: TenantContext,
    query?: {
      warehouseId?: string;
      status?: TransferStatus;
      limit?: number;
      offset?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(stockTransfers.tenantId, context.tenantId)];

      if (query?.warehouseId) {
        conditions.push(
          sql`(${stockTransfers.sourceWarehouseId} = ${query.warehouseId} OR ${stockTransfers.destinationWarehouseId} = ${query.warehouseId})`
        );
      }

      if (query?.status) {
        conditions.push(eq(stockTransfers.status, query.status));
      }

      const limit = query?.limit ?? 50;
      const offset = query?.offset ?? 0;

      return await tx
        .select()
        .from(stockTransfers)
        .where(and(...conditions))
        .orderBy(desc(stockTransfers.requestedAt))
        .limit(limit)
        .offset(offset);
    });
  }

  async getTransferById(context: TenantContext, transferId: string) {
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
        throw new NotFoundException(`طلب المناقلة رقم '${transferId}' غير موجود`);
      }

      const lines = await tx
        .select({
          id: stockTransferLines.id,
          transferId: stockTransferLines.transferId,
          itemId: stockTransferLines.itemId,
          uomId: stockTransferLines.uomId,
          quantity: stockTransferLines.quantity,
          dispatchedQuantity: stockTransferLines.dispatchedQuantity,
          receivedQuantity: stockTransferLines.receivedQuantity,
          damagedQuantity: stockTransferLines.damagedQuantity,
          lostQuantity: stockTransferLines.lostQuantity,
          varianceNotes: stockTransferLines.varianceNotes,
          unitCost: stockTransferLines.unitCost,
          itemName: items.nameAr,
          itemSku: items.sku,
          uomName: unitsOfMeasure.nameAr,
        })
        .from(stockTransferLines)
        .innerJoin(items, eq(stockTransferLines.itemId, items.id))
        .innerJoin(unitsOfMeasure, eq(stockTransferLines.uomId, unitsOfMeasure.id))
        .where(eq(stockTransferLines.transferId, transferId));

      return {
        ...transfer,
        lines,
      };
    });
  }

  async approveTransfer(
    context: TenantContext,
    transferId: string,
    dto?: ApproveStockTransferRequest
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
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (transfer.status !== TransferStatus.DRAFT && transfer.status !== TransferStatus.SUBMITTED) {
        throw new BadRequestException(`لا يمكن اعتماد مناقلة بحالة '${transfer.status}'. الاعتماد متاح فقط لحالات المسودة والتقديم.`);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      if (lines.length === 0) {
        throw new BadRequestException('لا يمكن اعتماد طلب مناقلة لا يحتوي على أصناف');
      }

      // Reserve required stock in source warehouse with row locking
      for (const line of lines) {
        const [balance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .for('update');

        const onHand = balance ? parseFloat(balance.onHandQty) : 0;
        const currentReserved = balance ? parseFloat(balance.reservedQty) : 0;
        const currentDamaged = balance ? parseFloat(balance.damagedQty || '0') : 0;
        const currentInspection = balance ? parseFloat(balance.underInspectionQty || '0') : 0;
        const available = onHand - currentReserved - currentDamaged - currentInspection;
        const requestedQty = parseFloat(line.quantity);

        if (!balance || available < requestedQty) {
          throw new BadRequestException(
            `الرصيد المتاح للصنف '${line.itemId}' في المستودع المصدر غير كافٍ لحجز المناقلة. المتاح: ${available.toFixed(4)}، المطلوب: ${requestedQty.toFixed(4)}`
          );
        }

        const newReserved = (currentReserved + requestedQty).toFixed(4);
        await tx
          .update(inventoryBalances)
          .set({
            reservedQty: newReserved,
            version: balance.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, balance.id));
      }

      // Update transfer status to APPROVED
      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.APPROVED,
          approvedBy: context.userId,
          approvedAt: new Date(),
          notes: dto?.approvalNotes
            ? `${transfer.notes ?? ''}\nملاحظة الاعتماد: ${dto.approvalNotes}`.trim()
            : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل تحديث المناقلة');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_APPROVED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async rejectTransfer(
    context: TenantContext,
    transferId: string,
    dto: RejectStockTransferRequest
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
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (
        transfer.status === TransferStatus.IN_TRANSIT ||
        transfer.status === TransferStatus.RECEIVED ||
        transfer.status === TransferStatus.CLOSED
      ) {
        throw new BadRequestException(`لا يمكن رفض مناقلة بحالة '${transfer.status}'`);
      }

      // If it was APPROVED, release the reserved stock at source
      if (transfer.status === TransferStatus.APPROVED) {
        const lines = await tx
          .select()
          .from(stockTransferLines)
          .where(eq(stockTransferLines.transferId, transferId));

        for (const line of lines) {
          const [balance] = await tx
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, context.tenantId),
                eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
                eq(inventoryBalances.itemId, line.itemId)
              )
            )
            .for('update');

          if (balance) {
            const currentReserved = parseFloat(balance.reservedQty);
            const lineQty = parseFloat(line.quantity);
            const newReserved = Math.max(0, currentReserved - lineQty).toFixed(4);

            await tx
              .update(inventoryBalances)
              .set({
                reservedQty: newReserved,
                version: balance.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(inventoryBalances.id, balance.id));
          }
        }
      }

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.REJECTED,
          rejectedBy: context.userId,
          rejectedAt: new Date(),
          rejectionReason: dto.rejectionReason,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل رفض المناقلة');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_REJECTED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
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
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (transfer.status !== TransferStatus.APPROVED && transfer.status !== TransferStatus.DRAFT) {
        throw new BadRequestException(`لا يمكن شحن المناقلة بحالتها الحالية '${transfer.status}'. يجب أن تكون معتمدة (APPROVED) أولاً.`);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      if (lines.length === 0) {
        throw new BadRequestException('لا يمكن شحن طلب مناقلة فارغ من الأصناف');
      }

      let totalShipped = 0;
      const dispatchMap = new Map(
        dto.dispatchedLines?.map((d) => [d.itemId, parseFloat(d.dispatchedQuantity)]) ?? []
      );

      // Deduct stock from source warehouse, clear reservation, increment in-transit, and record TRANSFER_OUT
      for (const line of lines) {
        const reqQty = parseFloat(line.quantity);
        const dispatchedQty = dispatchMap.has(line.itemId)
          ? dispatchMap.get(line.itemId)!
          : reqQty;

        if (isNaN(dispatchedQty) || dispatchedQty <= 0) {
          throw new BadRequestException(`كمية الشحن للصنف '${line.itemId}' غير صالحة`);
        }

        const [currentBalance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .for('update');

        if (!currentBalance) {
          throw new BadRequestException(`لا يوجد رصيد مسجل للصنف '${line.itemId}' في المستودع المصدر`);
        }

        const onHand = parseFloat(currentBalance.onHandQty);
        const reserved = parseFloat(currentBalance.reservedQty);
        const inTransit = parseFloat(currentBalance.inTransitQty || '0');

        if (onHand < dispatchedQty) {
          throw new BadRequestException(
            `الرصيد الفعلي غير كافٍ لشحن الصنف '${line.itemId}'. الفعلي: ${onHand.toFixed(4)}، المطلوب شحنه: ${dispatchedQty.toFixed(4)}`
          );
        }

        // Release reservation (if it was approved)
        const newReserved = transfer.status === TransferStatus.APPROVED
          ? Math.max(0, reserved - reqQty).toFixed(4)
          : reserved.toFixed(4);
        const newOnHand = (onHand - dispatchedQty).toFixed(4);
        const newInTransit = (inTransit + dispatchedQty).toFixed(4);

        await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            reservedQty: newReserved,
            inTransitQty: newInTransit,
            version: currentBalance.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, currentBalance.id));

        // Costing: Consume FIFO layers if item uses FIFO, otherwise use current WAC
        const [item] = await tx
          .select({ costingMethod: items.costingMethod, defaultCost: items.defaultCost })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        let effectiveUnitCost: number;
        let totalCostNum: number;

        if (item && item.costingMethod === CostingMethod.FIFO) {
          const fifoRes = await this.consumeCostLayersFifo(tx, {
            tenantId: context.tenantId,
            legalEntityOwnerId: transfer.legalEntityId,
            warehouseId: transfer.sourceWarehouseId,
            itemId: line.itemId,
            quantityToConsume: dispatchedQty,
          });
          effectiveUnitCost = fifoRes.unitCost;
          totalCostNum = fifoRes.totalCost;
        } else {
          effectiveUnitCost = parseFloat(currentBalance.wacCost) || parseFloat(item?.defaultCost || '0');
          totalCostNum = dispatchedQty * effectiveUnitCost;
        }

        // Record TRANSFER_OUT movement
        const movNumber = `MOV-TR-OUT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: transfer.legalEntityId,
          warehouseId: transfer.sourceWarehouseId,
          sourceWarehouseId: transfer.sourceWarehouseId,
          destinationWarehouseId: transfer.destinationWarehouseId,
          itemId: line.itemId,
          movementNumber: movNumber,
          movementType: MovementType.TRANSFER_OUT,
          direction: MovementDirection.OUT,
          uomId: line.uomId,
          quantity: dispatchedQty.toFixed(4),
          unitCost: effectiveUnitCost.toFixed(4),
          totalCost: totalCostNum.toFixed(4),
          sourceType: 'STOCK_TRANSFER',
          sourceId: transfer.id,
          sourceDocumentNumber: transfer.transferNumber,
          performedBy: context.userId || null,
          status: 'COMPLETED',
          notes: `شحن مناقلة رقم ${transfer.transferNumber} إلى المستودع الوجهة`,
        });

        // Update dispatchedQuantity on line
        await tx
          .update(stockTransferLines)
          .set({
            dispatchedQuantity: dispatchedQty.toFixed(4),
            unitCost: effectiveUnitCost.toFixed(4),
          })
          .where(eq(stockTransferLines.id, line.id));

        totalShipped += dispatchedQty;
      }

      // Update transfer status to IN_TRANSIT
      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.IN_TRANSIT,
          dispatchedBy: context.userId,
          dispatchedAt: new Date(),
          totalShippedQty: totalShipped.toFixed(4),
          notes: dto.dispatchedNotes
            ? `${transfer.notes ?? ''}\nملاحظة الشحن: ${dto.dispatchedNotes}`.trim()
            : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل شحن المناقلة');
      }

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
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (
        transfer.status !== TransferStatus.IN_TRANSIT &&
        transfer.status !== TransferStatus.PARTIALLY_RECEIVED
      ) {
        throw new BadRequestException(
          `لا يمكن استلام مناقلة بحالة '${transfer.status}'. يجب أن تكون الشحنة تحت النقل (IN_TRANSIT أو PARTIALLY_RECEIVED).`
        );
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      const receivedMap = new Map(dto.receivedLines.map((r) => [r.itemId, r]));

      let totalReceived = parseFloat(transfer.totalReceivedQty || '0');
      let totalDamaged = parseFloat(transfer.totalDamagedQty || '0');
      let totalLost = parseFloat(transfer.totalLostQty || '0');

      for (const line of lines) {
        const rItem = receivedMap.get(line.itemId);
        if (!rItem) continue;

        const dispatchedQty = parseFloat(line.dispatchedQuantity) > 0
          ? parseFloat(line.dispatchedQuantity)
          : parseFloat(line.quantity);

        const currentLineReceived = parseFloat(line.receivedQuantity || '0');
        const incomingReceivedQty = parseFloat(rItem.receivedQuantity);
        const incomingDamagedQty = parseFloat(rItem.damagedQuantity || '0');
        const incomingLostQty = parseFloat(rItem.lostQuantity || '0');
        const totalAccountedForThisBatch = incomingReceivedQty + incomingDamagedQty + incomingLostQty;

        // Prevent over-receiving: cannot exceed dispatched quantity
        if (currentLineReceived + totalAccountedForThisBatch > dispatchedQty + 0.0001) {
          throw new BadRequestException(
            `الكمية المستلمة مع التوالف والمفقودات (${(currentLineReceived + totalAccountedForThisBatch).toFixed(4)}) تتجاوز الكمية المشحونة (${dispatchedQty.toFixed(4)}) للصنف '${line.itemId}'`
          );
        }

        // 1. Decrement in_transit_qty at source warehouse
        const [sourceBal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .for('update');

        if (sourceBal) {
          const currentInTransit = parseFloat(sourceBal.inTransitQty || '0');
          const newInTransit = Math.max(0, currentInTransit - totalAccountedForThisBatch).toFixed(4);

          await tx
            .update(inventoryBalances)
            .set({
              inTransitQty: newInTransit,
              version: sourceBal.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(inventoryBalances.id, sourceBal.id));
        }

        // 2. Increment stock at destination warehouse
        const [destBalance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.destinationWarehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .for('update');

        const inCost = parseFloat(line.unitCost);
        const newLineReceived = currentLineReceived + incomingReceivedQty;
        const currentLineDamaged = parseFloat(line.damagedQuantity || '0') + incomingDamagedQty;
        const currentLineLost = parseFloat(line.lostQuantity || '0') + incomingLostQty;

        if (destBalance) {
          const currentOnHand = parseFloat(destBalance.onHandQty);
          const currentWac = parseFloat(destBalance.wacCost);
          const destDamaged = parseFloat(destBalance.damagedQty || '0');

          // Recalculate WAC on destination warehouse
          let newWac: number;
          if (currentOnHand + incomingReceivedQty <= 0) {
            newWac = inCost;
          } else {
            const oldVal = currentOnHand * currentWac;
            const incomingVal = incomingReceivedQty * inCost;
            newWac = (oldVal + incomingVal) / (currentOnHand + incomingReceivedQty);
          }

          const newOnHand = (currentOnHand + incomingReceivedQty).toFixed(4);
          const newDestDamaged = (destDamaged + incomingDamagedQty).toFixed(4);

          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              damagedQty: newDestDamaged,
              wacCost: newWac.toFixed(4),
              version: destBalance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(inventoryBalances.id, destBalance.id));
        } else {
          await tx.insert(inventoryBalances).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: transfer.legalEntityId,
            warehouseId: transfer.destinationWarehouseId,
            itemId: line.itemId,
            onHandQty: incomingReceivedQty.toFixed(4),
            reservedQty: '0.0000',
            damagedQty: incomingDamagedQty.toFixed(4),
            inTransitQty: '0.0000',
            wacCost: inCost.toFixed(4),
            version: 1,
          });
        }

        // 3. FIFO Layer creation at destination warehouse
        const [item] = await tx
          .select({ costingMethod: items.costingMethod })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        if (item && item.costingMethod === CostingMethod.FIFO && incomingReceivedQty > 0) {
          await tx.insert(inventoryCostLayers).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: transfer.legalEntityId,
            warehouseId: transfer.destinationWarehouseId,
            itemId: line.itemId,
            quantityReceived: incomingReceivedQty.toFixed(4),
            quantityRemaining: incomingReceivedQty.toFixed(4),
            unitCost: inCost.toFixed(4),
            sourceType: 'TRANSFER_RECEIPT',
            sourceId: transfer.id,
            createdAt: new Date(),
          });
        }

        // 4. Record TRANSFER_IN movement
        const movNumber = `MOV-TR-IN-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: transfer.legalEntityId,
          warehouseId: transfer.destinationWarehouseId,
          sourceWarehouseId: transfer.sourceWarehouseId,
          destinationWarehouseId: transfer.destinationWarehouseId,
          itemId: line.itemId,
          movementNumber: movNumber,
          movementType: MovementType.TRANSFER_IN,
          direction: MovementDirection.IN,
          uomId: line.uomId,
          quantity: incomingReceivedQty.toFixed(4),
          unitCost: inCost.toFixed(4),
          totalCost: (incomingReceivedQty * inCost).toFixed(4),
          sourceType: 'STOCK_TRANSFER',
          sourceId: transfer.id,
          sourceDocumentNumber: transfer.transferNumber,
          performedBy: context.userId || null,
          status: 'COMPLETED',
          notes: incomingDamagedQty > 0 || incomingLostQty > 0
            ? `استلام مناقلة رقم ${transfer.transferNumber} مع تسجيل فروقات (تالف: ${incomingDamagedQty}, مفقود: ${incomingLostQty})`
            : `استلام مناقلة رقم ${transfer.transferNumber}`,
        });

        // 5. Update line status
        await tx
          .update(stockTransferLines)
          .set({
            receivedQuantity: newLineReceived.toFixed(4),
            damagedQuantity: currentLineDamaged.toFixed(4),
            lostQuantity: currentLineLost.toFixed(4),
            varianceNotes: rItem.varianceNotes || line.varianceNotes || null,
          })
          .where(eq(stockTransferLines.id, line.id));

        totalReceived += incomingReceivedQty;
        totalDamaged += incomingDamagedQty;
        totalLost += incomingLostQty;
      }

      // Check if all lines are fully accounted for
      const totalShipped = parseFloat(transfer.totalShippedQty || '0');
      const isFullyAccounted = (totalReceived + totalDamaged + totalLost) >= (totalShipped - 0.0001);
      const newStatus = isFullyAccounted ? TransferStatus.RECEIVED : TransferStatus.PARTIALLY_RECEIVED;

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: newStatus,
          receivedBy: context.userId,
          receivedAt: new Date(),
          totalReceivedQty: totalReceived.toFixed(4),
          totalDamagedQty: totalDamaged.toFixed(4),
          totalLostQty: totalLost.toFixed(4),
          notes: dto.receivedNotes
            ? `${transfer.notes ?? ''}\nملاحظة الاستلام: ${dto.receivedNotes}`.trim()
            : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل استلام المناقلة');
      }

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

  async closeTransfer(
    context: TenantContext,
    transferId: string,
    dto?: CloseStockTransferRequest
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
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (
        transfer.status !== TransferStatus.PARTIALLY_RECEIVED &&
        transfer.status !== TransferStatus.IN_TRANSIT
      ) {
        throw new BadRequestException(
          `لا يمكن إغلاق مناقلة بحالة '${transfer.status}'. الإغلاق متاح للمناقلات المستلمة جزئياً أو التي تحت النقل.`
        );
      }

      // Clear any remaining in-transit quantities at source warehouse for unreceived lines
      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      for (const line of lines) {
        const dispatched = parseFloat(line.dispatchedQuantity);
        const received = parseFloat(line.receivedQuantity || '0');
        const damaged = parseFloat(line.damagedQuantity || '0');
        const lost = parseFloat(line.lostQuantity || '0');
        const unreceivedRemaining = Math.max(0, dispatched - received - damaged - lost);

        if (unreceivedRemaining > 0.0001) {
          const [sourceBal] = await tx
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, context.tenantId),
                eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
                eq(inventoryBalances.itemId, line.itemId)
              )
            )
            .for('update');

          if (sourceBal) {
            const currentInTransit = parseFloat(sourceBal.inTransitQty || '0');
            const newInTransit = Math.max(0, currentInTransit - unreceivedRemaining).toFixed(4);

            await tx
              .update(inventoryBalances)
              .set({
                inTransitQty: newInTransit,
                version: sourceBal.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(inventoryBalances.id, sourceBal.id));
          }
        }
      }

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.CLOSED,
          closedBy: context.userId,
          closedAt: new Date(),
          notes: dto?.closingNotes
            ? `${transfer.notes ?? ''}\nملاحظة الإغلاق: ${dto.closingNotes}`.trim()
            : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      if (!updated) {
        throw new BadRequestException('فشل إغلاق المناقلة');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_CLOSED',
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
  // 4. Stocktake & Physical Inventory Counting Engine (Phase B)
  // ==================================================================

  async createStocktakeOrder(
    context: TenantContext,
    dto: CreateStocktakeOrderRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate warehouse
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, context.tenantId),
            eq(warehouses.id, dto.warehouseId)
          )
        )
        .limit(1);

      if (!warehouse) {
        throw new NotFoundException(`المستودع '${dto.warehouseId}' غير موجود`);
      }
      if (warehouse.status !== 'ACTIVE') {
        throw new BadRequestException('المستودع المحدد غير نشط حالياً');
      }

      // Check orderNumber uniqueness for legal entity
      const [existing] = await tx
        .select({ id: stocktakeOrders.id })
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.legalEntityId, dto.legalEntityId),
            eq(stocktakeOrders.orderNumber, dto.orderNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`أمر الجرد رقم '${dto.orderNumber}' مسجل مسبقاً في هذه المنشأة`);
      }

      const [order] = await tx
        .insert(stocktakeOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          orderNumber: dto.orderNumber,
          stocktakeType: dto.stocktakeType || StocktakeType.FULL,
          countFrequency: dto.countFrequency || StocktakeFrequency.PERIODIC,
          freezeMovements: dto.freezeMovements || false,
          status: StocktakeStatus.DRAFT,
          createdBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (!order) {
        throw new BadRequestException('فشل إنشاء أمر الجرد');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCKTAKE_ORDER_CREATED',
          entityType: 'stocktake_order',
          entityId: order.id,
          afterState: order,
        },
        tx
      );

      return order;
    });
  }

  async startStocktake(context: TenantContext, orderId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.id, orderId)
          )
        )
        .for('update');

      if (!order) {
        throw new NotFoundException(`أمر الجرد '${orderId}' غير موجود`);
      }

      if (order.status !== StocktakeStatus.DRAFT) {
        throw new BadRequestException(`لا يمكن بدء جرد بحالة '${order.status}'. يجب أن يكون في حالة مسودة (DRAFT).`);
      }

      // Take System Snapshot of current inventory balances in the warehouse
      const balances = await tx
        .select({
          itemId: inventoryBalances.itemId,
          onHandQty: inventoryBalances.onHandQty,
          wacCost: inventoryBalances.wacCost,
          baseUomId: items.baseUomId,
          defaultCost: items.defaultCost,
        })
        .from(inventoryBalances)
        .innerJoin(items, eq(inventoryBalances.itemId, items.id))
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, order.warehouseId)
          )
        );

      if (balances.length === 0) {
        // Fallback: fetch all active inventory items if warehouse balance table is empty
        const allItems = await tx
          .select({
            itemId: items.id,
            baseUomId: items.baseUomId,
            defaultCost: items.defaultCost,
          })
          .from(items)
          .where(
            and(
              eq(items.tenantId, context.tenantId),
              eq(items.legalEntityOwnerId, order.legalEntityId)
            )
          );

        for (const it of allItems) {
          await tx.insert(stocktakeLines).values({
            tenantId: context.tenantId,
            stocktakeId: order.id,
            itemId: it.itemId,
            uomId: it.baseUomId,
            systemQuantity: '0.0000',
            countedQuantity: null,
            differenceQuantity: '0.0000',
            unitCost: it.defaultCost,
            varianceAmount: '0.0000',
          });
        }
      } else {
        for (const bal of balances) {
          const unitCost = parseFloat(bal.wacCost) > 0 ? bal.wacCost : bal.defaultCost;
          await tx.insert(stocktakeLines).values({
            tenantId: context.tenantId,
            stocktakeId: order.id,
            itemId: bal.itemId,
            uomId: bal.baseUomId,
            systemQuantity: bal.onHandQty,
            countedQuantity: null,
            differenceQuantity: '0.0000',
            unitCost,
            varianceAmount: '0.0000',
          });
        }
      }

      const [updated] = await tx
        .update(stocktakeOrders)
        .set({
          status: StocktakeStatus.IN_PROGRESS,
          startedBy: context.userId,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stocktakeOrders.id, orderId))
        .returning();

      if (!order) {
        throw new BadRequestException('فشل إنشاء أمر الجرد');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCKTAKE_STARTED',
          entityType: 'stocktake_order',
          entityId: orderId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async recordStocktakeCounts(
    context: TenantContext,
    orderId: string,
    dto: RecordStocktakeCountRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.id, orderId)
          )
        )
        .for('update');

      if (!order) {
        throw new NotFoundException(`أمر الجرد '${orderId}' غير موجود`);
      }

      if (
        order.status !== StocktakeStatus.IN_PROGRESS &&
        order.status !== StocktakeStatus.COUNTED
      ) {
        throw new BadRequestException(
          `لا يمكن تسجيل أعداد الجرد بحالة '${order.status}'. يجب أن يكون الجرد قيد التنفيذ (IN_PROGRESS).`
        );
      }

      for (const count of dto.counts) {
        const [line] = await tx
          .select()
          .from(stocktakeLines)
          .where(
            and(
              eq(stocktakeLines.tenantId, context.tenantId),
              eq(stocktakeLines.stocktakeId, orderId),
              eq(stocktakeLines.itemId, count.itemId)
            )
          )
          .for('update');

        if (!line) continue;

        const systemQty = parseFloat(line.systemQuantity);
        const countedQty = parseFloat(count.countedQuantity);
        const diffQty = countedQty - systemQty;
        const unitCost = parseFloat(line.unitCost);
        const varianceVal = diffQty * unitCost;

        await tx
          .update(stocktakeLines)
          .set({
            countedQuantity: countedQty.toFixed(4),
            differenceQuantity: diffQty.toFixed(4),
            varianceAmount: varianceVal.toFixed(4),
            notes: count.notes || null,
          })
          .where(eq(stocktakeLines.id, line.id));
      }

      const [updated] = await tx
        .update(stocktakeOrders)
        .set({
          status: StocktakeStatus.COUNTED,
          countedBy: context.userId,
          countedAt: new Date(),
          notes: dto.notes ? `${order.notes ?? ''}\nملاحظة العد: ${dto.notes}`.trim() : order.notes,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeOrders.id, orderId))
        .returning();

      if (!order) {
        throw new BadRequestException('فشل إنشاء أمر الجرد');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCKTAKE_COUNTS_RECORDED',
          entityType: 'stocktake_order',
          entityId: orderId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async approveStocktakeVariance(
    context: TenantContext,
    orderId: string,
    dto?: ApproveStocktakeOrderRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.id, orderId)
          )
        )
        .for('update');

      if (!order) {
        throw new NotFoundException(`أمر الجرد '${orderId}' غير موجود`);
      }

      if (order.status !== StocktakeStatus.COUNTED) {
        throw new BadRequestException(
          `لا يمكن اعتماد تسوية جرد بحالة '${order.status}'. يجب تسجيل الأعداد أولاً (COUNTED).`
        );
      }

      const lines = await tx
        .select()
        .from(stocktakeLines)
        .where(
          and(
            eq(stocktakeLines.tenantId, context.tenantId),
            eq(stocktakeLines.stocktakeId, orderId)
          )
        );

      // Create master stockAdjustment record
      const adjNumber = `ADJ-STK-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
      const [adjustment] = await tx
        .insert(stockAdjustments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          warehouseId: order.warehouseId,
          adjustmentNumber: adjNumber,
          reason: AdjustmentReason.PHYSICAL_COUNT,
          notes: `تسوية معتمدة ناتجة عن أمر الجرد رقم ${order.orderNumber}`,
          adjustedBy: context.userId,
        })
        .returning();

      if (!adjustment) {
        throw new BadRequestException('فشل إنشاء تسوية الجرد');
      }

      // Process variances for each line
      for (const line of lines) {
        const diffQty = parseFloat(line.differenceQuantity);
        if (Math.abs(diffQty) <= 0.00001) continue;

        const [balance] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, order.warehouseId),
              eq(inventoryBalances.itemId, line.itemId)
            )
          )
          .for('update');

        const [item] = await tx
          .select({ costingMethod: items.costingMethod })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        const countedQty = parseFloat(line.countedQuantity!);
        const unitCost = parseFloat(line.unitCost);

        if (balance) {
          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: countedQty.toFixed(4),
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(inventoryBalances.id, balance.id));
        } else {
          await tx.insert(inventoryBalances).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: order.legalEntityId,
            warehouseId: order.warehouseId,
            itemId: line.itemId,
            onHandQty: countedQty.toFixed(4),
            reservedQty: '0.0000',
            version: 1,
          });
        }

        // Insert stockAdjustmentLines
        await tx.insert(stockAdjustmentLines).values({
          adjustmentId: adjustment.id,
          itemId: line.itemId,
          uomId: line.uomId,
          systemQuantity: line.systemQuantity,
          countedQuantity: line.countedQuantity!,
          differenceQuantity: line.differenceQuantity,
          unitCost: line.unitCost,
          totalVarianceAmount: Math.abs(parseFloat(line.varianceAmount)).toFixed(4),
        });

        // Insert inventoryMovements
        const direction = diffQty > 0 ? MovementDirection.IN : MovementDirection.OUT;
        const movNumber = `MOV-ADJ-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: order.legalEntityId,
          warehouseId: order.warehouseId,
          itemId: line.itemId,
          movementNumber: movNumber,
          movementType: MovementType.STOCK_ADJUSTMENT,
          direction,
          uomId: line.uomId,
          quantity: Math.abs(diffQty).toFixed(4),
          unitCost: line.unitCost,
          totalCost: Math.abs(parseFloat(line.varianceAmount)).toFixed(4),
          sourceType: 'STOCKTAKE_ADJUSTMENT',
          sourceId: order.id,
          sourceDocumentNumber: order.orderNumber,
          performedBy: context.userId || null,
          status: 'COMPLETED',
          notes: diffQty > 0
            ? `تسوية زيادة مخزنية ناتجة عن جرد ${order.orderNumber}`
            : `تسوية عجز مخزني ناتج عن جرد ${order.orderNumber}`,
        });

        // FIFO layer handling for adjustments
        if (item && item.costingMethod === CostingMethod.FIFO) {
          if (diffQty > 0) {
            // Surplus: Create a cost layer for the found stock
            await tx.insert(inventoryCostLayers).values({
              tenantId: context.tenantId,
              legalEntityOwnerId: order.legalEntityId,
              warehouseId: order.warehouseId,
              itemId: line.itemId,
              quantityReceived: diffQty.toFixed(4),
              quantityRemaining: diffQty.toFixed(4),
              unitCost: line.unitCost,
              sourceType: 'STOCKTAKE_SURPLUS',
              sourceId: order.id,
              createdAt: new Date(),
            });
          } else if (diffQty < 0) {
            // Shortage: Consume from cost layers
            await this.consumeCostLayersFifo(tx, {
              tenantId: context.tenantId,
              legalEntityOwnerId: order.legalEntityId,
              warehouseId: order.warehouseId,
              itemId: line.itemId,
              quantityToConsume: Math.abs(diffQty),
            });
          }
        }
      }

      // Update stocktake order status to APPROVED
      const [updated] = await tx
        .update(stocktakeOrders)
        .set({
          status: StocktakeStatus.APPROVED,
          approvedBy: context.userId,
          approvedAt: new Date(),
          adjustmentId: adjustment.id,
          notes: dto?.approvalNotes
            ? `${order.notes ?? ''}\nملاحظة اعتماد التسوية: ${dto.approvalNotes}`.trim()
            : order.notes,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeOrders.id, orderId))
        .returning();

      if (!order) {
        throw new BadRequestException('فشل إنشاء أمر الجرد');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCKTAKE_VARIANCE_APPROVED',
          entityType: 'stocktake_order',
          entityId: orderId,
          afterState: { order: updated, adjustment },
        },
        tx
      );

      return {
        order: updated,
        adjustment,
      };
    });
  }

  async rejectStocktakeVariance(
    context: TenantContext,
    orderId: string,
    dto: RejectStocktakeOrderRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.id, orderId)
          )
        )
        .for('update');

      if (!order) {
        throw new NotFoundException(`أمر الجرد '${orderId}' غير موجود`);
      }

      if (order.status !== StocktakeStatus.COUNTED) {
        throw new BadRequestException(
          `لا يمكن رفض تسوية جرد بحالة '${order.status}'. الرفض متاح فقط لحالة (COUNTED).`
        );
      }

      const [updated] = await tx
        .update(stocktakeOrders)
        .set({
          status: StocktakeStatus.REJECTED,
          rejectedBy: context.userId,
          rejectedAt: new Date(),
          rejectionReason: dto.rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeOrders.id, orderId))
        .returning();

      if (!order) {
        throw new BadRequestException('فشل إنشاء أمر الجرد');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCKTAKE_VARIANCE_REJECTED',
          entityType: 'stocktake_order',
          entityId: orderId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async getStocktakeOrders(
    context: TenantContext,
    query?: StocktakeOrderQuery
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(stocktakeOrders.tenantId, context.tenantId)];

      if (query?.warehouseId) {
        conditions.push(eq(stocktakeOrders.warehouseId, query.warehouseId));
      }

      if (query?.status) {
        conditions.push(eq(stocktakeOrders.status, query.status));
      }

      const limit = query?.limit ?? 50;
      const offset = query?.offset ?? 0;

      return await tx
        .select()
        .from(stocktakeOrders)
        .where(and(...conditions))
        .orderBy(desc(stocktakeOrders.createdAt))
        .limit(limit)
        .offset(offset);
    });
  }

  async getStocktakeOrderById(context: TenantContext, orderId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(stocktakeOrders)
        .where(
          and(
            eq(stocktakeOrders.tenantId, context.tenantId),
            eq(stocktakeOrders.id, orderId)
          )
        )
        .limit(1);

      if (!order) {
        throw new NotFoundException(`أمر الجرد '${orderId}' غير موجود`);
      }

      const lines = await tx
        .select({
          id: stocktakeLines.id,
          stocktakeId: stocktakeLines.stocktakeId,
          itemId: stocktakeLines.itemId,
          uomId: stocktakeLines.uomId,
          systemQuantity: stocktakeLines.systemQuantity,
          countedQuantity: stocktakeLines.countedQuantity,
          differenceQuantity: stocktakeLines.differenceQuantity,
          unitCost: stocktakeLines.unitCost,
          varianceAmount: stocktakeLines.varianceAmount,
          notes: stocktakeLines.notes,
          itemName: items.nameAr,
          itemSku: items.sku,
          uomName: unitsOfMeasure.nameAr,
        })
        .from(stocktakeLines)
        .innerJoin(items, eq(stocktakeLines.itemId, items.id))
        .innerJoin(unitsOfMeasure, eq(stocktakeLines.uomId, unitsOfMeasure.id))
        .where(eq(stocktakeLines.stocktakeId, orderId));

      return {
        ...order,
        lines,
      };
    });
  }

  // ==================================================================
  // 4.5 Direct Stock Adjustments (Physical count variance, damage, waste)
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
      .orderBy(asc(inventoryCostLayers.createdAt))
      .for('update');

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

      // 2.5 Idempotency protection: return existing movement if sourceDocumentNumber is re-submitted
      if (dto.sourceDocumentNumber) {
        const [existing] = await tx
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, context.tenantId),
              eq(inventoryMovements.warehouseId, dto.warehouseId),
              eq(inventoryMovements.itemId, dto.itemId),
              eq(inventoryMovements.sourceDocumentNumber, dto.sourceDocumentNumber),
              eq(inventoryMovements.direction, MovementDirection.IN)
            )
          );

        if (existing) {
          const [currentBal] = await tx
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, context.tenantId),
                eq(inventoryBalances.warehouseId, dto.warehouseId),
                eq(inventoryBalances.itemId, dto.itemId)
              )
            );
          return { movement: existing, balance: currentBal };
        }
      }

      // 3. Fetch current balance with row-level lock
      const [currentBalance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, dto.warehouseId),
            eq(inventoryBalances.itemId, dto.itemId)
          )
        )
        .for('update');

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

      // 2.5 Idempotency protection: return existing movement if sourceDocumentNumber is re-submitted
      if (dto.sourceDocumentNumber) {
        const [existing] = await tx
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, context.tenantId),
              eq(inventoryMovements.warehouseId, dto.warehouseId),
              eq(inventoryMovements.itemId, dto.itemId),
              eq(inventoryMovements.sourceDocumentNumber, dto.sourceDocumentNumber),
              eq(inventoryMovements.direction, MovementDirection.OUT)
            )
          );

        if (existing) {
          const [currentBal] = await tx
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, context.tenantId),
                eq(inventoryBalances.warehouseId, dto.warehouseId),
                eq(inventoryBalances.itemId, dto.itemId)
              )
            );
          return { movement: existing, balance: currentBal };
        }
      }

      // 3. Current balance and strict availability check with row-level lock
      const [currentBalance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, dto.warehouseId),
            eq(inventoryBalances.itemId, dto.itemId)
          )
        )
        .for('update');

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

      // 4. Calculate cost: FIFO layer depletion vs. Weighted Average Cost
      let effectiveUnitCost: number;
      let totalCostNum: number;

      if (item.costingMethod === CostingMethod.FIFO) {
        const fifoResult = await this.consumeCostLayersFifo(tx, {
          tenantId: context.tenantId,
          legalEntityOwnerId: currentBalance.legalEntityOwnerId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          quantityToConsume: issueQty,
        });
        effectiveUnitCost = fifoResult.unitCost;
        totalCostNum = fifoResult.totalCost;
      } else {
        const currentWac = parseFloat(currentBalance.wacCost) || parseFloat(item.defaultCost) || 0;
        effectiveUnitCost = currentWac;
        totalCostNum = issueQty * currentWac;
      }

      const newOnHand = onHand - issueQty;
      const totalCost = totalCostNum.toFixed(4);

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
          unitCost: effectiveUnitCost.toFixed(4),
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
      // 1. Fetch original movement with row-level lock to prevent concurrent double reversal
      const [original] = await tx
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, context.tenantId),
            eq(inventoryMovements.id, dto.movementId)
          )
        )
        .for('update');

      if (!original) {
        throw new NotFoundException('حركة المخزون المطلوب عكسها غير موجودة');
      }

      if (original.isReversed) {
        throw new ConflictException('تم عكس هذه الحركة مسبقاً، ولا يمكن عكس الحركة أكثر من مرة');
      }

      const moveQty = parseFloat(original.quantity);
      const moveCost = parseFloat(original.unitCost);

      // 2. Fetch current balance with row-level lock
      const [balance] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.warehouseId, original.warehouseId),
            eq(inventoryBalances.itemId, original.itemId)
          )
        )
        .for('update');

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
          uomId: original.uomId ?? null,
          quantity: moveQty.toFixed(4),
          unitCost: moveCost.toFixed(4),
          totalCost: original.totalCost ?? '0.0000',
          sourceType: 'REVERSAL',
          sourceId: original.id,
          sourceDocumentNumber: original.movementNumber || original.id || null,
          performedBy: context.userId ?? null,
          notes: `عكس الحركة رقم ${original.movementNumber || original.id}: ${dto.reversalReason}`,
          status: 'COMPLETED',
          isReversed: false,
          reversalOfId: original.id,
          occurredAt: new Date(),
        })
        .returning();

      // 5.5 Handle FIFO Cost Layers for reversal if item uses FIFO
      const [revItem] = await tx
        .select({ costingMethod: items.costingMethod })
        .from(items)
        .where(and(eq(items.tenantId, context.tenantId), eq(items.id, original.itemId)))
        .limit(1);

      if (revItem && revItem.costingMethod === CostingMethod.FIFO) {
        if (original.direction === MovementDirection.OUT) {
          // Reversing an OUT movement restores stock: re-insert cost layer
          await tx
            .insert(inventoryCostLayers)
            .values({
              tenantId: context.tenantId,
              legalEntityOwnerId: original.legalEntityOwnerId,
              warehouseId: original.warehouseId,
              itemId: original.itemId,
              quantityReceived: original.quantity,
              quantityRemaining: original.quantity,
              unitCost: original.unitCost,
              sourceType: 'REVERSAL_RETURN',
              sourceId: original.id,
              createdAt: new Date(),
            });
        } else if (original.direction === MovementDirection.IN) {
          // Reversing an IN movement deducts stock: consume from layers
          await this.consumeCostLayersFifo(tx, {
            tenantId: context.tenantId,
            legalEntityOwnerId: original.legalEntityOwnerId,
            warehouseId: original.warehouseId,
            itemId: original.itemId,
            quantityToConsume: moveQty,
          });
        }
      }

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
