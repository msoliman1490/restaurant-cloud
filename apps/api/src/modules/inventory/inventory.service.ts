import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { DocumentNumberingService } from '../../common/operations/document-numbering.service';
import {
  inventoryBalances,
  inventoryMovements,
  inventoryCostLayers,
  stockTransfers,
  stockTransferLines,
  stockTransferDiscrepancies,
  stockAdjustments,
  stockAdjustmentLines,
  stocktakeOrders,
  stocktakeLines,
  warehouses,
  branches,
  items,
  unitsOfMeasure,
  uomConversions,
  legalEntities,
  journalEntries,
} from '@restaurant-cloud/database';
import {
  CreateStockTransferRequest,
  SubmitStockTransferRequest,
  ApproveStockTransferRequest,
  RejectStockTransferRequest,
  CancelStockTransferRequest,
  CloseStockTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
  ResolveTransferDiscrepancyRequest,
  ReverseTransferAfterDispatchRequest,
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
  TransferType,
  TransferDiscrepancyType,
  TransferDiscrepancyStatus,
  JournalType,
  DefaultAccountMappingKey,
  MovementType,
  MovementDirection,
  WarehouseType,
  CostingMethod,
  StocktakeType,
  StocktakeFrequency,
  StocktakeStatus,
  AdjustmentReason,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc, inArray } from 'drizzle-orm';

@Injectable()
export class InventoryService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly documentNumbering: DocumentNumberingService
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

  // ==================================================================
  // 2. Stock Transfers (Phase 3.4D: Inter-Branch & Inter-Company)
  // ==================================================================

  private async resolveUomMultiplier(
    tx: any,
    tenantId: string,
    fromUomId: string,
    toUomId: string
  ): Promise<number> {
    if (fromUomId === toUomId) return 1;
    const [direct] = await tx
      .select({ multiplier: uomConversions.multiplier })
      .from(uomConversions)
      .where(
        and(
          eq(uomConversions.tenantId, tenantId),
          eq(uomConversions.fromUomId, fromUomId),
          eq(uomConversions.toUomId, toUomId)
        )
      )
      .limit(1);
    if (direct) return parseFloat(direct.multiplier);

    const [inverse] = await tx
      .select({ multiplier: uomConversions.multiplier })
      .from(uomConversions)
      .where(
        and(
          eq(uomConversions.tenantId, tenantId),
          eq(uomConversions.fromUomId, toUomId),
          eq(uomConversions.toUomId, fromUomId)
        )
      )
      .limit(1);
    if (inverse && parseFloat(inverse.multiplier) > 0) {
      return 1 / parseFloat(inverse.multiplier);
    }

    throw new BadRequestException(
      `لا يوجد معامل تحويل معرف بين وحدة القياس '${fromUomId}' والوحدة الأساسية '${toUomId}'`
    );
  }

  private verifyTransferScope(
    context: TenantContext,
    sourceWh: { legalEntityId: string | null; branchId: string | null },
    destWh: { legalEntityId: string | null; branchId: string | null }
  ) {
    if (!sourceWh.legalEntityId || !destWh.legalEntityId) {
      throw new BadRequestException('يجب ربط المستودع المصدر والوجهة بمنشأة قانونية صالحة');
    }
    this.opsFramework.verifyScope(context, context.userScopes, {
      legalEntityId: sourceWh.legalEntityId,
      branchId: sourceWh.branchId ?? undefined,
    });
    if (
      destWh.legalEntityId !== sourceWh.legalEntityId ||
      destWh.branchId !== sourceWh.branchId
    ) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: destWh.legalEntityId,
        branchId: destWh.branchId ?? undefined,
      });
    }
  }

  async createTransfer(context: TenantContext, dto: CreateStockTransferRequest) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('المستودع المصدر والمستودع الوجهة لا يمكن أن يكونا متطابقين');
    }

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        documentType: 'STOCK_TRANSFER',
        sourceType: 'stock_transfers',
      },
      async (allocatedTransferNumber) => {
        return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingIdem] = await tx
          .select()
          .from(stockTransfers)
          .where(
            and(
              eq(stockTransfers.tenantId, context.tenantId),
              eq(stockTransfers.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);
        if (existingIdem) {
          const existingLines = await tx
            .select()
            .from(stockTransferLines)
            .where(eq(stockTransferLines.transferId, existingIdem.id));
          return { ...existingIdem, lines: existingLines };
        }
      }

      const [sourceWh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.sourceWarehouseId)))
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

      const [destWh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.destinationWarehouseId)))
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

      // Enforce scope on both source and destination (especially CROSS_LEGAL_ENTITY)
      this.verifyTransferScope(context, sourceWh, destWh);
      if (dto.legalEntityId !== sourceWh.legalEntityId) {
        throw new BadRequestException('المنشأة القانونية المحددة لا تطابق منشأة المستودع المصدر');
      }

      // Classify transfer type strictly
      const transferType =
        sourceWh.legalEntityId !== destWh.legalEntityId
          ? TransferType.CROSS_LEGAL_ENTITY
          : sourceWh.branchId !== destWh.branchId
            ? TransferType.SAME_LEGAL_ENTITY
            : TransferType.SAME_BRANCH;

      const preparedLines: Array<{
        itemId: string;
        uomId: string;
        quantity: string;
        baseQuantity: string;
        unitCost: string;
        transferPrice: string | null;
      }> = [];

      for (const line of dto.lines) {
        const [item] = await tx
          .select({ id: items.id, baseUomId: items.baseUomId, defaultCost: items.defaultCost })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);
        if (!item) {
          throw new NotFoundException(`الصنف '${line.itemId}' غير موجود`);
        }

        const multiplier = await this.resolveUomMultiplier(tx, context.tenantId, line.uomId, item.baseUomId);
        const reqQty = parseFloat(line.quantity);
        if (isNaN(reqQty) || reqQty <= 0) {
          throw new BadRequestException(`الكمية المطلوبة للصنف '${line.itemId}' يجب أن تكون أكبر من صفر`);
        }
        const baseQty = reqQty * multiplier;

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

        if (available < baseQty) {
          throw new BadRequestException(
            `الرصيد المتاح للصنف '${line.itemId}' في المستودع المصدر غير كافٍ لإنشاء المناقلة. المتاح: ${available.toFixed(4)}، المطلوب (بالوحدة الأساسية): ${baseQty.toFixed(4)}`
          );
        }

        const estCost = bal && parseFloat(bal.wacCost) > 0 ? bal.wacCost : (line.unitCost ?? item.defaultCost ?? '0.0000');
        if (
          transferType === TransferType.CROSS_LEGAL_ENTITY &&
          line.transferPrice !== undefined &&
          line.transferPrice !== null &&
          line.transferPrice !== ''
        ) {
          const tp = parseFloat(line.transferPrice);
          const estNum = parseFloat(estCost);
          if (isNaN(tp) || tp < 0 || isNaN(estNum) || estNum <= 0 || Math.abs(tp - estNum) > 0.0001) {
            throw new BadRequestException(
              'غير مسموح باستخدام سعر تحويل (transferPrice) مختلف عن التكلفة الفعلية في التحويلات بين المنشآت القانونية في الإصدار الحالي لحين اعتماد دورة الفوترة البينية (Intercompany Invoice).'
            );
          }
        }
        preparedLines.push({
          itemId: line.itemId,
          uomId: line.uomId,
          quantity: line.quantity,
          baseQuantity: baseQty.toFixed(4),
          unitCost: estCost,
          transferPrice: line.transferPrice ?? null,
        });
      }

      const [transfer] = await tx
        .insert(stockTransfers)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          transferType,
          sourceLegalEntityId: sourceWh.legalEntityId,
          destinationLegalEntityId: destWh.legalEntityId,
          sourceBranchId: sourceWh.branchId,
          destinationBranchId: destWh.branchId,
          transferNumber: allocatedTransferNumber,
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          status: TransferStatus.DRAFT,
          requestedBy: context.userId,
          idempotencyKey: dto.idempotencyKey ?? null,
          notes: dto.notes || null,
        })
        .returning();

      if (!transfer) throw new Error('فشل إنشاء طلب مناقلة المخزون');

      const lineValues = preparedLines.map((l) => ({
        transferId: transfer.id,
        itemId: l.itemId,
        uomId: l.uomId,
        quantity: l.quantity,
        baseQuantity: l.baseQuantity,
        dispatchedQuantity: '0.0000',
        unitCost: l.unitCost,
        transferPrice: l.transferPrice,
        totalCost: '0.0000',
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

      return { ...transfer, lines };
        });
      }
    );
  }

  async submitTransfer(
    context: TenantContext,
    transferId: string,
    dto?: SubmitStockTransferRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }
      if (transfer.status !== TransferStatus.DRAFT) {
        throw new BadRequestException(`يمكن تقديم المناقلات في حالة المسودة (DRAFT) فقط`);
      }

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.SUBMITTED,
          submittedBy: context.userId,
          submittedAt: new Date(),
          notes: dto?.submissionNotes
            ? `${transfer.notes ?? ''}\nملاحظة التقديم: ${dto.submissionNotes}`.trim()
            : transfer.notes,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_SUBMITTED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async getTransfers(
    context: TenantContext,
    query?: {
      warehouseId?: string;
      legalEntityId?: string;
      transferType?: string;
      status?: TransferStatus;
      search?: string;
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
      if (query?.legalEntityId) {
        conditions.push(
          sql`(${stockTransfers.sourceLegalEntityId} = ${query.legalEntityId} OR ${stockTransfers.destinationLegalEntityId} = ${query.legalEntityId} OR ${stockTransfers.legalEntityId} = ${query.legalEntityId})`
        );
      }
      if (query?.transferType) {
        conditions.push(eq(stockTransfers.transferType, query.transferType));
      }
      if (query?.status) {
        conditions.push(eq(stockTransfers.status, query.status));
      }
      if (query?.search) {
        const pattern = `%${query.search}%`;
        conditions.push(sql`${stockTransfers.transferNumber} ILIKE ${pattern}`);
      }

      const limit = Math.min(query?.limit ?? 50, 200);
      const offset = query?.offset ?? 0;

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockTransfers)
        .where(and(...conditions));

      const rows = await tx
        .select()
        .from(stockTransfers)
        .where(and(...conditions))
        .orderBy(desc(stockTransfers.requestedAt))
        .limit(limit)
        .offset(offset);

      return {
        items: rows,
        total: countRow?.count ?? 0,
        limit,
        offset,
      };
    });
  }

  async getTransferById(context: TenantContext, transferId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
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
          baseQuantity: stockTransferLines.baseQuantity,
          dispatchedQuantity: stockTransferLines.dispatchedQuantity,
          receivedQuantity: stockTransferLines.receivedQuantity,
          damagedQuantity: stockTransferLines.damagedQuantity,
          lostQuantity: stockTransferLines.lostQuantity,
          overageQuantity: stockTransferLines.overageQuantity,
          varianceNotes: stockTransferLines.varianceNotes,
          unitCost: stockTransferLines.unitCost,
          transferPrice: stockTransferLines.transferPrice,
          totalCost: stockTransferLines.totalCost,
          fifoLayersJson: stockTransferLines.fifoLayersJson,
          itemName: items.nameAr,
          itemSku: items.sku,
          uomName: unitsOfMeasure.nameAr,
        })
        .from(stockTransferLines)
        .innerJoin(items, eq(stockTransferLines.itemId, items.id))
        .innerJoin(unitsOfMeasure, eq(stockTransferLines.uomId, unitsOfMeasure.id))
        .where(eq(stockTransferLines.transferId, transferId));

      const discrepancies = await tx
        .select()
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.tenantId, context.tenantId),
            eq(stockTransferDiscrepancies.transferId, transferId)
          )
        )
        .orderBy(desc(stockTransferDiscrepancies.createdAt));

      const journalIds = [
        transfer.dispatchJournalEntryId,
        transfer.receiveJournalEntryId,
        transfer.destJournalEntryId,
        ...discrepancies.map((d) => d.journalEntryId),
      ].filter((id): id is string => Boolean(id));

      const linkedJournals =
        journalIds.length > 0
          ? await tx
              .select()
              .from(journalEntries)
              .where(
                and(
                  eq(journalEntries.tenantId, context.tenantId),
                  inArray(journalEntries.id, journalIds)
                )
              )
          : [];

      return {
        ...transfer,
        lines,
        discrepancies,
        linkedJournals,
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
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (transfer.status !== TransferStatus.DRAFT && transfer.status !== TransferStatus.SUBMITTED) {
        throw new BadRequestException(`لا يمكن اعتماد مناقلة بحالة '${transfer.status}'. الاعتماد متاح فقط لحالات المسودة والتقديم.`);
      }

      const [sourceWh] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, transfer.sourceWarehouseId))
        .limit(1);
      const [destWh] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, transfer.destinationWarehouseId))
        .limit(1);
      if (sourceWh && destWh) {
        this.verifyTransferScope(context, sourceWh, destWh);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      if (lines.length === 0) {
        throw new BadRequestException('لا يمكن اعتماد طلب مناقلة لا يحتوي على أصناف');
      }

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
        const requestedQty = parseFloat(line.baseQuantity || line.quantity);

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
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (
        transfer.status !== TransferStatus.DRAFT &&
        transfer.status !== TransferStatus.SUBMITTED &&
        transfer.status !== TransferStatus.APPROVED
      ) {
        throw new BadRequestException(`لا يمكن رفض مناقلة بحالة '${transfer.status}'`);
      }

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
            const lineQty = parseFloat(line.baseQuantity || line.quantity);
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

  async cancelTransfer(
    context: TenantContext,
    transferId: string,
    dto: CancelStockTransferRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (
        transfer.status !== TransferStatus.DRAFT &&
        transfer.status !== TransferStatus.SUBMITTED &&
        transfer.status !== TransferStatus.APPROVED
      ) {
        throw new BadRequestException(
          `لا يمكن إلغاء المناقلة بعد الشحن (الحالة الحالية: '${transfer.status}'). يجب استخدام إجراء العكس الموثق (reverse-after-dispatch).`
        );
      }

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
            const lineQty = parseFloat(line.baseQuantity || line.quantity);
            await tx
              .update(inventoryBalances)
              .set({
                reservedQty: Math.max(0, currentReserved - lineQty).toFixed(4),
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
          status: TransferStatus.CANCELLED,
          cancelledBy: context.userId,
          cancelledAt: new Date(),
          cancellationReason: dto.cancellationReason,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_CANCELLED',
          entityType: 'stock_transfer',
          entityId: transferId,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  private async addDestinationStock(
    tx: any,
    context: TenantContext,
    params: {
      legalEntityId: string;
      warehouseId: string;
      sourceWarehouseId: string;
      itemId: string;
      uomId: string;
      qty: number;
      unitCost: number;
      fifoLayers?: Array<{ sourceLayerId: string; quantity: number; unitCost: number }> | null;
      totalDispatchedQty?: number;
      transferId: string;
      transferNumber: string;
      movementType: MovementType;
      notes: string;
    }
  ) {
    const [destBalance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.warehouseId, params.warehouseId),
          eq(inventoryBalances.itemId, params.itemId)
        )
      )
      .for('update');

    const totalCostIncoming = params.qty * params.unitCost;
    if (destBalance) {
      const prevQty = parseFloat(destBalance.onHandQty);
      const prevWac = parseFloat(destBalance.wacCost);
      const newQty = prevQty + params.qty;
      const newWac = newQty > 0 ? (prevQty * prevWac + totalCostIncoming) / newQty : params.unitCost;

      await tx
        .update(inventoryBalances)
        .set({
          onHandQty: newQty.toFixed(4),
          wacCost: newWac.toFixed(4),
          version: destBalance.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBalances.id, destBalance.id));
    } else {
      await tx.insert(inventoryBalances).values({
        tenantId: context.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        itemId: params.itemId,
        onHandQty: params.qty.toFixed(4),
        reservedQty: '0.0000',
        damagedQty: '0.0000',
        inTransitQty: '0.0000',
        wacCost: params.unitCost.toFixed(4),
        version: 1,
      });
    }

    // Preserve FIFO cost layers proportionally if source was FIFO, else create single layer
    if (params.fifoLayers && params.fifoLayers.length > 0 && (params.totalDispatchedQty ?? 0) > 0) {
      const ratio = Math.min(1, params.qty / params.totalDispatchedQty!);
      let allocated = 0;
      for (let i = 0; i < params.fifoLayers.length; i++) {
        const layer = params.fifoLayers[i]!;
        const layerQty =
          i === params.fifoLayers.length - 1
            ? Math.max(0, params.qty - allocated)
            : Number((layer.quantity * ratio).toFixed(4));
        if (layerQty > 0.00001) {
          allocated += layerQty;
          await tx.insert(inventoryCostLayers).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: params.legalEntityId,
            warehouseId: params.warehouseId,
            itemId: params.itemId,
            quantityReceived: layerQty.toFixed(4),
            quantityRemaining: layerQty.toFixed(4),
            unitCost: layer.unitCost.toFixed(4),
            sourceType: 'TRANSFER_RECEIPT',
            sourceId: params.transferId,
            createdAt: new Date(),
          });
        }
      }
    } else {
      await tx.insert(inventoryCostLayers).values({
        tenantId: context.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        itemId: params.itemId,
        quantityReceived: params.qty.toFixed(4),
        quantityRemaining: params.qty.toFixed(4),
        unitCost: params.unitCost.toFixed(4),
        sourceType: 'TRANSFER_RECEIPT',
        sourceId: params.transferId,
        createdAt: new Date(),
      });
    }

    const movNumber = `MOV-TR-IN-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const [mov] = await tx
      .insert(inventoryMovements)
      .values({
        tenantId: context.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        sourceWarehouseId: params.sourceWarehouseId,
        destinationWarehouseId: params.warehouseId,
        itemId: params.itemId,
        movementNumber: movNumber,
        movementType: params.movementType,
        direction: MovementDirection.IN,
        uomId: params.uomId,
        quantity: params.qty.toFixed(4),
        unitCost: params.unitCost.toFixed(4),
        totalCost: totalCostIncoming.toFixed(4),
        sourceType: 'STOCK_TRANSFER',
        sourceId: params.transferId,
        sourceDocumentNumber: params.transferNumber,
        performedBy: context.userId || null,
        status: 'COMPLETED',
        notes: params.notes,
      })
      .returning();

    return mov;
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

      if (dto.idempotencyKey && transfer.dispatchIdempotencyKey === dto.idempotencyKey) {
        const existingLines = await tx
          .select()
          .from(stockTransferLines)
          .where(eq(stockTransferLines.transferId, transferId));
        return { ...transfer, lines: existingLines };
      }

      if (transfer.status !== TransferStatus.APPROVED && transfer.status !== TransferStatus.DRAFT) {
        throw new BadRequestException(`لا يمكن شحن المناقلة بحالتها الحالية '${transfer.status}'. يجب أن تكون معتمدة (APPROVED) أولاً.`);
      }

      const [sourceWh] = await tx.select().from(warehouses).where(eq(warehouses.id, transfer.sourceWarehouseId)).limit(1);
      const [destWh] = await tx.select().from(warehouses).where(eq(warehouses.id, transfer.destinationWarehouseId)).limit(1);
      if (sourceWh && destWh) {
        this.verifyTransferScope(context, sourceWh, destWh);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      if (lines.length === 0) {
        throw new BadRequestException('لا يمكن شحن طلب مناقلة فارغ من الأصناف');
      }

      let totalShipped = 0;
      let totalTransferCost = 0;
      const dispatchMap = new Map(
        dto.dispatchedLines?.map((d) => [d.itemId, parseFloat(d.dispatchedQuantity)]) ?? []
      );

      for (const line of lines) {
        const reqUomQty = parseFloat(line.quantity);
        const baseReqQty = parseFloat(line.baseQuantity || line.quantity);
        const uomFactor = reqUomQty > 0 ? baseReqQty / reqUomQty : 1;
        const dispatchedUomQty = dispatchMap.has(line.itemId) ? dispatchMap.get(line.itemId)! : reqUomQty;
        const dispatchedQty = dispatchedUomQty * uomFactor;

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

        const newReserved = transfer.status === TransferStatus.APPROVED
          ? Math.max(0, reserved - baseReqQty).toFixed(4)
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

        const [item] = await tx
          .select({ costingMethod: items.costingMethod, defaultCost: items.defaultCost })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        const sourceLeId = transfer.sourceLegalEntityId || transfer.legalEntityId;
        let effectiveUnitCost: number;
        let totalCostNum: number;
        let fifoLayersJson: Array<{ sourceLayerId: string; quantity: number; unitCost: number }> | null = null;

        if (item && item.costingMethod === CostingMethod.FIFO) {
          const fifoRes = await this.consumeCostLayersFifo(tx, {
            tenantId: context.tenantId,
            legalEntityOwnerId: sourceLeId,
            warehouseId: transfer.sourceWarehouseId,
            itemId: line.itemId,
            quantityToConsume: dispatchedQty,
          });
          effectiveUnitCost = fifoRes.unitCost;
          totalCostNum = fifoRes.totalCost;
          fifoLayersJson = fifoRes.consumedLayers;
        } else {
          effectiveUnitCost = parseFloat(currentBalance.wacCost) || parseFloat(item?.defaultCost || '0');
          totalCostNum = dispatchedQty * effectiveUnitCost;
        }

        const movNumber = `MOV-TR-OUT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: sourceLeId,
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

        await tx
          .update(stockTransferLines)
          .set({
            dispatchedQuantity: dispatchedQty.toFixed(4),
            unitCost: effectiveUnitCost.toFixed(4),
            totalCost: totalCostNum.toFixed(4),
            fifoLayersJson,
          })
          .where(eq(stockTransferLines.id, line.id));

        totalShipped += dispatchedQty;
        totalTransferCost += totalCostNum;
      }

      let dispatchJournalEntryId: string | null = null;
      if (transfer.transferType !== TransferType.SAME_BRANCH && totalTransferCost > 0.0001) {
        const sourceLeId = transfer.sourceLegalEntityId || transfer.legalEntityId;
        const postedJournal = await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: sourceLeId,
            branchId: transfer.sourceBranchId ?? undefined,
            journalNumber: `JV-TR-DISP-${transfer.transferNumber}-${Date.now().toString(36).toUpperCase()}`,
            journalType: JournalType.INVENTORY,
            sourceType: 'STOCK_TRANSFER_DISPATCH',
            sourceId: transfer.id,
            description: `شحن مخزون في الطريق للمناقلة ${transfer.transferNumber}`,
            lines: [
              {
                mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
                branchId: transfer.sourceBranchId ?? undefined,
                debit: totalTransferCost.toFixed(4),
                credit: '0.0000',
                description: `مخزون في الطريق - مناقلة ${transfer.transferNumber}`,
              },
              {
                mappingKey: DefaultAccountMappingKey.INVENTORY,
                branchId: transfer.sourceBranchId ?? undefined,
                debit: '0.0000',
                credit: totalTransferCost.toFixed(4),
                description: `صرف مخزون من المستودع المصدر - مناقلة ${transfer.transferNumber}`,
              },
            ],
          },
          tx
        );
        dispatchJournalEntryId = postedJournal.id;
      }

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.IN_TRANSIT,
          dispatchedBy: context.userId,
          dispatchedAt: new Date(),
          totalShippedQty: totalShipped.toFixed(4),
          totalTransferCost: totalTransferCost.toFixed(4),
          dispatchIdempotencyKey: dto.idempotencyKey ?? null,
          dispatchJournalEntryId,
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

      if (dto.idempotencyKey && transfer.receiveIdempotencyKey === dto.idempotencyKey) {
        return transfer;
      }

      if (
        transfer.status !== TransferStatus.IN_TRANSIT &&
        transfer.status !== TransferStatus.PARTIALLY_RECEIVED &&
        transfer.status !== TransferStatus.DISCREPANCY
      ) {
        throw new BadRequestException(
          `لا يمكن استلام مناقلة بحالة '${transfer.status}'. يجب أن تكون الشحنة تحت النقل (IN_TRANSIT أو PARTIALLY_RECEIVED).`
        );
      }

      const [sourceWh] = await tx.select().from(warehouses).where(eq(warehouses.id, transfer.sourceWarehouseId)).limit(1);
      const [destWh] = await tx.select().from(warehouses).where(eq(warehouses.id, transfer.destinationWarehouseId)).limit(1);
      if (sourceWh && destWh) {
        this.verifyTransferScope(context, sourceWh, destWh);
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      const sourceLeId = transfer.sourceLegalEntityId || transfer.legalEntityId;
      const destLeId = transfer.destinationLegalEntityId || transfer.legalEntityId;

      if (dto.rejectAll) {
        for (const line of lines) {
          const dispatchedQty = parseFloat(line.dispatchedQuantity) || parseFloat(line.baseQuantity || line.quantity);
          const alreadyAccounted =
            parseFloat(line.receivedQuantity || '0') +
            parseFloat(line.damagedQuantity || '0') +
            parseFloat(line.lostQuantity || '0');
          const remaining = Math.max(0, dispatchedQty - alreadyAccounted);
          if (remaining > 0.0001) {
            const unitCost = parseFloat(line.unitCost);
            await tx.insert(stockTransferDiscrepancies).values({
              tenantId: context.tenantId,
              legalEntityId: sourceLeId,
              transferId: transfer.id,
              lineId: line.id,
              itemId: line.itemId,
              discrepancyType: TransferDiscrepancyType.FULL_REJECTION,
              quantity: remaining.toFixed(4),
              unitCost: unitCost.toFixed(4),
              totalValue: (remaining * unitCost).toFixed(4),
              status: TransferDiscrepancyStatus.OPEN,
              notes: dto.receivedNotes || 'رفض كامل الشحنة عند الاستلام',
              createdBy: context.userId,
            });
          }
        }

        const [rejectedTransfer] = await tx
          .update(stockTransfers)
          .set({
            status: TransferStatus.DISCREPANCY,
            receiveIdempotencyKey: dto.idempotencyKey ?? null,
            notes: dto.receivedNotes
              ? `${transfer.notes ?? ''}\nرفض كامل الشحنة: ${dto.receivedNotes}`.trim()
              : transfer.notes,
          })
          .where(eq(stockTransfers.id, transferId))
          .returning();

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'STOCK_TRANSFER_FULL_REJECTION',
            entityType: 'stock_transfer',
            entityId: transferId,
            afterState: rejectedTransfer,
          },
          tx
        );

        return rejectedTransfer;
      }

      const receivedMap = new Map(dto.receivedLines.map((r) => [r.itemId, r]));

      let totalReceived = parseFloat(transfer.totalReceivedQty || '0');
      let totalDamaged = parseFloat(transfer.totalDamagedQty || '0');
      let totalLost = parseFloat(transfer.totalLostQty || '0');
      let totalOverage = parseFloat(transfer.totalOverageQty || '0');
      let batchReceivedValue = 0;
      let batchAffiliateValue = 0;
      let hasDiscrepancyInBatch = false;

      for (const line of lines) {
        const rItem = receivedMap.get(line.itemId);
        if (!rItem) continue;

        const reqUomQty = parseFloat(line.quantity);
        const baseReqQty = parseFloat(line.baseQuantity || line.quantity);
        const uomFactor = reqUomQty > 0 ? baseReqQty / reqUomQty : 1;

        const dispatchedQty = parseFloat(line.dispatchedQuantity) > 0
          ? parseFloat(line.dispatchedQuantity)
          : baseReqQty;

        const currentLineReceived = parseFloat(line.receivedQuantity || '0');
        const currentLineDamaged = parseFloat(line.damagedQuantity || '0');
        const currentLineLost = parseFloat(line.lostQuantity || '0');
        const currentLineOverage = parseFloat(line.overageQuantity || '0');

        const incomingReceivedQty = parseFloat(rItem.receivedQuantity) * uomFactor;
        const incomingDamagedQty = parseFloat(rItem.damagedQuantity || '0') * uomFactor;
        const incomingLostQty = parseFloat(rItem.lostQuantity || '0') * uomFactor;
        const incomingOverageQty = parseFloat(rItem.overageQuantity || '0') * uomFactor;
        const totalAccountedForThisBatch = incomingReceivedQty + incomingDamagedQty + incomingLostQty;

        const prevAccounted = currentLineReceived + currentLineDamaged + currentLineLost;
        if (prevAccounted + totalAccountedForThisBatch > dispatchedQty + 0.0001) {
          throw new BadRequestException(
            `الكمية المستلمة مع التوالف والمفقودات (${(prevAccounted + totalAccountedForThisBatch).toFixed(4)}) تتجاوز الكمية المشحونة (${dispatchedQty.toFixed(4)}) للصنف '${line.itemId}'`
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

        const lineUnitCost = parseFloat(line.unitCost);
        const lineTotalCost = parseFloat(line.totalCost || '0');
        const affiliateUnitPrice = line.transferPrice ? parseFloat(line.transferPrice) : lineUnitCost;

        if (
          transfer.transferType === TransferType.CROSS_LEGAL_ENTITY &&
          line.transferPrice !== null &&
          line.transferPrice !== undefined &&
          line.transferPrice !== ''
        ) {
          if (
            isNaN(affiliateUnitPrice) ||
            affiliateUnitPrice < 0 ||
            isNaN(lineUnitCost) ||
            lineUnitCost <= 0 ||
            Math.abs(affiliateUnitPrice - lineUnitCost) > 0.0001
          ) {
            throw new BadRequestException(
              'غير مسموح باستخدام سعر تحويل (transferPrice) مختلف عن التكلفة الفعلية في التحويلات بين المنشآت القانونية في الإصدار الحالي لحين اعتماد دورة الفوترة البينية (Intercompany Invoice).'
            );
          }
        }

        // 2. Add received stock to destination warehouse (preserving FIFO layers & recalculating WAC)
        if (incomingReceivedQty > 0) {
          const isFinalFullReceipt =
            lineTotalCost > 0 &&
            Math.abs(currentLineReceived + incomingReceivedQty - dispatchedQty) < 0.0001 &&
            currentLineDamaged < 0.0001 &&
            currentLineLost < 0.0001 &&
            incomingDamagedQty < 0.0001 &&
            incomingLostQty < 0.0001;
          const lineReceivedValue = isFinalFullReceipt
            ? Math.max(0, lineTotalCost - currentLineReceived * lineUnitCost)
            : incomingReceivedQty * lineUnitCost;
          const lineAffiliateValue =
            transfer.transferType === TransferType.CROSS_LEGAL_ENTITY
              ? lineReceivedValue
              : incomingReceivedQty * affiliateUnitPrice;
          batchReceivedValue += lineReceivedValue;
          batchAffiliateValue += lineAffiliateValue;

          await this.addDestinationStock(tx, context, {
            legalEntityId: destLeId,
            warehouseId: transfer.destinationWarehouseId,
            sourceWarehouseId: transfer.sourceWarehouseId,
            itemId: line.itemId,
            uomId: line.uomId,
            qty: incomingReceivedQty,
            unitCost: transfer.transferType === TransferType.CROSS_LEGAL_ENTITY ? affiliateUnitPrice : lineUnitCost,
            fifoLayers: (line.fifoLayersJson as Array<{ sourceLayerId: string; quantity: number; unitCost: number }>) ?? null,
            totalDispatchedQty: dispatchedQty,
            transferId: transfer.id,
            transferNumber: transfer.transferNumber,
            movementType: MovementType.TRANSFER_IN,
            notes: `استلام مناقلة رقم ${transfer.transferNumber}`,
          });
        }

        // 3. Log Discrepancies (DAMAGE, LOSS, OVERAGE)
        const discrepancyItems: Array<{ type: TransferDiscrepancyType; qty: number }> = [
          { type: TransferDiscrepancyType.DAMAGE, qty: incomingDamagedQty },
          { type: TransferDiscrepancyType.LOSS, qty: incomingLostQty },
          { type: TransferDiscrepancyType.OVERAGE, qty: incomingOverageQty },
        ];
        for (const d of discrepancyItems) {
          if (d.qty > 0.0001) {
            hasDiscrepancyInBatch = true;
            await tx.insert(stockTransferDiscrepancies).values({
              tenantId: context.tenantId,
              legalEntityId: sourceLeId,
              transferId: transfer.id,
              lineId: line.id,
              itemId: line.itemId,
              discrepancyType: d.type,
              quantity: d.qty.toFixed(4),
              unitCost: lineUnitCost.toFixed(4),
              totalValue: (d.qty * lineUnitCost).toFixed(4),
              status: TransferDiscrepancyStatus.OPEN,
              notes: rItem.varianceNotes || dto.receivedNotes || `فرق استلام (${d.type})`,
              createdBy: context.userId,
            });
          }
        }

        await tx
          .update(stockTransferLines)
          .set({
            receivedQuantity: (currentLineReceived + incomingReceivedQty).toFixed(4),
            damagedQuantity: (currentLineDamaged + incomingDamagedQty).toFixed(4),
            lostQuantity: (currentLineLost + incomingLostQty).toFixed(4),
            overageQuantity: (currentLineOverage + incomingOverageQty).toFixed(4),
            varianceNotes: rItem.varianceNotes || line.varianceNotes || null,
          })
          .where(eq(stockTransferLines.id, line.id));

        totalReceived += incomingReceivedQty;
        totalDamaged += incomingDamagedQty;
        totalLost += incomingLostQty;
        totalOverage += incomingOverageQty;
      }

      // 4. GL Posting via PostingEngineService
      let receiveJournalEntryId = transfer.receiveJournalEntryId;
      let destJournalEntryId = transfer.destJournalEntryId;
      const suffix = Date.now().toString(36).toUpperCase();

      if (batchReceivedValue > 0.0001) {
        if (transfer.transferType === TransferType.SAME_LEGAL_ENTITY) {
          const jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: sourceLeId,
              branchId: transfer.destinationBranchId ?? undefined,
              journalNumber: `JV-TR-RCV-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_RECEIVE',
              sourceId: transfer.id,
              description: `استلام مناقلة بين الفروع ${transfer.transferNumber}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.INTER_BRANCH_CLEARING,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: batchReceivedValue.toFixed(4),
                  credit: '0.0000',
                  description: `تسوية شحنة صادرة - مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: '0.0000',
                  credit: batchReceivedValue.toFixed(4),
                  description: `إقفال مخزون في الطريق - مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: batchReceivedValue.toFixed(4),
                  credit: '0.0000',
                  description: `إضافة مخزون للفرع الوجهة - مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.INTER_BRANCH_CLEARING,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: '0.0000',
                  credit: batchReceivedValue.toFixed(4),
                  description: `تسوية شحنة واردة - مناقلة ${transfer.transferNumber}`,
                },
              ],
            },
            tx
          );
          receiveJournalEntryId = jv.id;
        } else if (transfer.transferType === TransferType.CROSS_LEGAL_ENTITY) {
          const sourceLines: any[] = [
            {
              mappingKey: DefaultAccountMappingKey.DUE_FROM_AFFILIATE,
              branchId: transfer.sourceBranchId ?? undefined,
              debit: batchAffiliateValue.toFixed(4),
              credit: '0.0000',
              description: `مستحق من منشأة شقيقة - مناقلة ${transfer.transferNumber}`,
            },
            {
              mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
              branchId: transfer.sourceBranchId ?? undefined,
              debit: '0.0000',
              credit: batchReceivedValue.toFixed(4),
              description: `إقفال مخزون في الطريق - مناقلة ${transfer.transferNumber}`,
            },
          ];
          const diff = batchAffiliateValue - batchReceivedValue;
          if (Math.abs(diff) > 0.0001) {
            sourceLines.push({
              mappingKey: DefaultAccountMappingKey.INTER_BRANCH_CLEARING,
              branchId: transfer.sourceBranchId ?? undefined,
              debit: diff < 0 ? Math.abs(diff).toFixed(4) : '0.0000',
              credit: diff > 0 ? diff.toFixed(4) : '0.0000',
              description: `فرق تسعير تحويلي بين المنشآت - مناقلة ${transfer.transferNumber}`,
            });
          }

          const srcJv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: sourceLeId,
              branchId: transfer.sourceBranchId ?? undefined,
              journalNumber: `JV-TR-IC-SRC-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_INTERCOMPANY_SOURCE',
              sourceId: transfer.id,
              description: `تسجيل ذمم مدينة على منشأة شقيقة - مناقلة ${transfer.transferNumber}`,
              lines: sourceLines,
            },
            tx
          );
          receiveJournalEntryId = srcJv.id;

          const dstJv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: destLeId,
              branchId: transfer.destinationBranchId ?? undefined,
              journalNumber: `JV-TR-IC-DST-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_INTERCOMPANY_DEST',
              sourceId: transfer.id,
              description: `استلام مخزون من منشأة شقيقة - مناقلة ${transfer.transferNumber}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: batchAffiliateValue.toFixed(4),
                  credit: '0.0000',
                  description: `مخزون وارد من منشأة شقيقة - مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.DUE_TO_AFFILIATE,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: '0.0000',
                  credit: batchAffiliateValue.toFixed(4),
                  description: `مستحق لمنشأة شقيقة - مناقلة ${transfer.transferNumber}`,
                },
              ],
            },
            tx
          );
          destJournalEntryId = dstJv.id;
        }
      }

      const [openDiscCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.transferId, transferId),
            inArray(stockTransferDiscrepancies.status, [
              TransferDiscrepancyStatus.OPEN,
              TransferDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      const totalShipped = parseFloat(transfer.totalShippedQty || '0');
      const isFullyAccounted = (totalReceived + totalDamaged + totalLost) >= (totalShipped - 0.0001);
      const newStatus =
        hasDiscrepancyInBatch || (openDiscCount?.count ?? 0) > 0
          ? TransferStatus.DISCREPANCY
          : isFullyAccounted
            ? TransferStatus.RECEIVED
            : TransferStatus.PARTIALLY_RECEIVED;

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: newStatus,
          receivedBy: context.userId,
          receivedAt: new Date(),
          totalReceivedQty: totalReceived.toFixed(4),
          totalDamagedQty: totalDamaged.toFixed(4),
          totalLostQty: totalLost.toFixed(4),
          totalOverageQty: totalOverage.toFixed(4),
          receiveIdempotencyKey: dto.idempotencyKey ?? null,
          receiveJournalEntryId,
          destJournalEntryId,
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

  async resolveTransferDiscrepancy(
    context: TenantContext,
    transferId: string,
    discrepancyId: string,
    dto: ResolveTransferDiscrepancyRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      const [disc] = await tx
        .select()
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.tenantId, context.tenantId),
            eq(stockTransferDiscrepancies.transferId, transferId),
            eq(stockTransferDiscrepancies.id, discrepancyId)
          )
        )
        .for('update');

      if (!disc) {
        throw new NotFoundException(`فرق الاستلام '${discrepancyId}' غير موجود`);
      }
      if (disc.status !== TransferDiscrepancyStatus.OPEN && disc.status !== TransferDiscrepancyStatus.UNDER_REVIEW) {
        throw new BadRequestException(`فرق الاستلام تمت معالجته مسبقاً بحالة '${disc.status}'`);
      }

      const [line] = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.id, disc.lineId))
        .limit(1);

      const qty = parseFloat(disc.quantity);
      const unitCost = parseFloat(disc.unitCost);
      const totalValue = parseFloat(disc.totalValue);
      const sourceLeId = transfer.sourceLegalEntityId || transfer.legalEntityId;
      const destLeId = transfer.destinationLegalEntityId || transfer.legalEntityId;
      const suffix = Date.now().toString(36).toUpperCase();

      let journalEntryId: string | null = null;
      let movementId: string | null = null;

      if (dto.resolution === 'RESOLVED_LOSS') {
        const creditMapping =
          transfer.transferType === TransferType.SAME_BRANCH
            ? DefaultAccountMappingKey.INVENTORY
            : DefaultAccountMappingKey.INVENTORY_IN_TRANSIT;

        if (totalValue > 0.0001) {
          const jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: sourceLeId,
              branchId: transfer.sourceBranchId ?? undefined,
              journalNumber: `JV-TR-LOSS-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_DISCREPANCY_LOSS',
              sourceId: disc.id,
              description: `تسوية عجز/تلف مناقلة ${transfer.transferNumber}: ${dto.resolutionNotes}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: totalValue.toFixed(4),
                  credit: '0.0000',
                  description: `خسارة وتلف مخزون مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: creditMapping,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: '0.0000',
                  credit: totalValue.toFixed(4),
                  description: `إقفال رصيد العجز/التلف مناقلة ${transfer.transferNumber}`,
                },
              ],
            },
            tx
          );
          journalEntryId = jv.id;
        }

        const [mov] = await tx
          .insert(inventoryMovements)
          .values({
            tenantId: context.tenantId,
            legalEntityOwnerId: sourceLeId,
            warehouseId: transfer.sourceWarehouseId,
            itemId: disc.itemId,
            movementNumber: `MOV-TR-LOSS-${suffix}`,
            movementType: MovementType.STOCK_ADJUSTMENT,
            direction: MovementDirection.OUT,
            uomId: line?.uomId ?? disc.itemId,
            quantity: qty.toFixed(4),
            unitCost: unitCost.toFixed(4),
            totalCost: totalValue.toFixed(4),
            sourceType: 'STOCK_TRANSFER_DISCREPANCY',
            sourceId: disc.id,
            sourceDocumentNumber: transfer.transferNumber,
            performedBy: context.userId || null,
            status: 'COMPLETED',
            notes: `اعتماد عجز/تلف مناقلة ${transfer.transferNumber}: ${dto.resolutionNotes}`,
          })
          .returning();
        movementId = mov?.id ?? null;
      } else if (dto.resolution === 'RESOLVED_GAIN') {
        if (line) {
          const mov = await this.addDestinationStock(tx, context, {
            legalEntityId: destLeId,
            warehouseId: transfer.destinationWarehouseId,
            sourceWarehouseId: transfer.sourceWarehouseId,
            itemId: disc.itemId,
            uomId: line.uomId,
            qty,
            unitCost,
            transferId: transfer.id,
            transferNumber: transfer.transferNumber,
            movementType: MovementType.TRANSFER_IN,
            notes: `اعتماد زيادة استلام مناقلة ${transfer.transferNumber}: ${dto.resolutionNotes}`,
          });
          movementId = mov?.id ?? null;
        }

        if (totalValue > 0.0001) {
          const jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: destLeId,
              branchId: transfer.destinationBranchId ?? undefined,
              journalNumber: `JV-TR-GAIN-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_DISCREPANCY_GAIN',
              sourceId: disc.id,
              description: `تسوية فائض استلام مناقلة ${transfer.transferNumber}: ${dto.resolutionNotes}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: totalValue.toFixed(4),
                  credit: '0.0000',
                  description: `إضافة فائض مخزون مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY_GAIN,
                  branchId: transfer.destinationBranchId ?? undefined,
                  debit: '0.0000',
                  credit: totalValue.toFixed(4),
                  description: `إيراد فائض استلام مناقلة ${transfer.transferNumber}`,
                },
              ],
            },
            tx
          );
          journalEntryId = jv.id;
        }
      } else if (dto.resolution === 'RESOLVED_RETURNED') {
        const [sourceBal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.warehouseId, transfer.sourceWarehouseId),
              eq(inventoryBalances.itemId, disc.itemId)
            )
          )
          .for('update');

        if (sourceBal) {
          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: (parseFloat(sourceBal.onHandQty) + qty).toFixed(4),
              inTransitQty: Math.max(0, parseFloat(sourceBal.inTransitQty || '0') - qty).toFixed(4),
              version: sourceBal.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(inventoryBalances.id, sourceBal.id));
        }

        await tx.insert(inventoryCostLayers).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: sourceLeId,
          warehouseId: transfer.sourceWarehouseId,
          itemId: disc.itemId,
          quantityReceived: qty.toFixed(4),
          quantityRemaining: qty.toFixed(4),
          unitCost: unitCost.toFixed(4),
          sourceType: 'TRANSFER_RETURN',
          sourceId: transfer.id,
          createdAt: new Date(),
        });

        const [mov] = await tx
          .insert(inventoryMovements)
          .values({
            tenantId: context.tenantId,
            legalEntityOwnerId: sourceLeId,
            warehouseId: transfer.sourceWarehouseId,
            itemId: disc.itemId,
            movementNumber: `MOV-TR-RET-${suffix}`,
            movementType: MovementType.TRANSFER_IN,
            direction: MovementDirection.IN,
            uomId: line?.uomId ?? disc.itemId,
            quantity: qty.toFixed(4),
            unitCost: unitCost.toFixed(4),
            totalCost: totalValue.toFixed(4),
            sourceType: 'STOCK_TRANSFER_DISCREPANCY',
            sourceId: disc.id,
            sourceDocumentNumber: transfer.transferNumber,
            performedBy: context.userId || null,
            status: 'COMPLETED',
            notes: `إرجاع كمية مرفوضة/تالفة للمستودع المصدر: ${dto.resolutionNotes}`,
          })
          .returning();
        movementId = mov?.id ?? null;

        if (transfer.transferType !== TransferType.SAME_BRANCH && totalValue > 0.0001) {
          const jv = await this.postingEngine.postEntry(
            context,
            {
              legalEntityId: sourceLeId,
              branchId: transfer.sourceBranchId ?? undefined,
              journalNumber: `JV-TR-RET-${transfer.transferNumber}-${suffix}`,
              journalType: JournalType.INVENTORY,
              sourceType: 'STOCK_TRANSFER_RETURN',
              sourceId: disc.id,
              description: `إرجاع مخزون من الطريق للمستودع المصدر - مناقلة ${transfer.transferNumber}`,
              lines: [
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: totalValue.toFixed(4),
                  credit: '0.0000',
                  description: `استعادة مخزون مرتجع - مناقلة ${transfer.transferNumber}`,
                },
                {
                  mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
                  branchId: transfer.sourceBranchId ?? undefined,
                  debit: '0.0000',
                  credit: totalValue.toFixed(4),
                  description: `عكس مخزون في الطريق - مناقلة ${transfer.transferNumber}`,
                },
              ],
            },
            tx
          );
          journalEntryId = jv.id;
        }
      } else {
        throw new BadRequestException(`نوع تسوية الفرق غير صالح: '${dto.resolution}'`);
      }

      const [resolvedDisc] = await tx
        .update(stockTransferDiscrepancies)
        .set({
          status: dto.resolution,
          resolutionNotes: dto.resolutionNotes,
          resolvedBy: context.userId,
          resolvedAt: new Date(),
          journalEntryId,
          movementId,
        })
        .where(eq(stockTransferDiscrepancies.id, discrepancyId))
        .returning();

      const [remainingOpen] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.transferId, transferId),
            inArray(stockTransferDiscrepancies.status, [
              TransferDiscrepancyStatus.OPEN,
              TransferDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      if ((remainingOpen?.count ?? 0) === 0 && transfer.status === TransferStatus.DISCREPANCY) {
        const totalShipped = parseFloat(transfer.totalShippedQty || '0');
        const totalAcc =
          parseFloat(transfer.totalReceivedQty || '0') +
          parseFloat(transfer.totalDamagedQty || '0') +
          parseFloat(transfer.totalLostQty || '0');
        const nextStatus =
          totalAcc >= totalShipped - 0.0001 ? TransferStatus.RECEIVED : TransferStatus.PARTIALLY_RECEIVED;
        await tx
          .update(stockTransfers)
          .set({ status: nextStatus })
          .where(eq(stockTransfers.id, transferId));
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_DISCREPANCY_RESOLVED',
          entityType: 'stock_transfer_discrepancy',
          entityId: discrepancyId,
          afterState: resolvedDisc,
        },
        tx
      );

      return resolvedDisc;
    });
  }

  async reverseTransferAfterDispatch(
    context: TenantContext,
    transferId: string,
    dto: ReverseTransferAfterDispatchRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.id, transferId)))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`طلب المناقلة '${transferId}' غير موجود`);
      }

      if (transfer.status !== TransferStatus.IN_TRANSIT && transfer.status !== TransferStatus.DISCREPANCY) {
        throw new BadRequestException(
          `العكس الموثق بعد الشحن متاح فقط لحالات IN_TRANSIT أو DISCREPANCY (الحالة الحالية: '${transfer.status}')`
        );
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      const sourceLeId = transfer.sourceLegalEntityId || transfer.legalEntityId;
      const suffix = Date.now().toString(36).toUpperCase();
      let totalReversedValue = 0;

      for (const line of lines) {
        const dispatched = parseFloat(line.dispatchedQuantity);
        const accounted =
          parseFloat(line.receivedQuantity || '0') +
          parseFloat(line.damagedQuantity || '0') +
          parseFloat(line.lostQuantity || '0');
        const remainingInTransit = Math.max(0, dispatched - accounted);
        if (remainingInTransit <= 0.0001) continue;

        const unitCost = parseFloat(line.unitCost);
        totalReversedValue += remainingInTransit * unitCost;

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
          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: (parseFloat(sourceBal.onHandQty) + remainingInTransit).toFixed(4),
              inTransitQty: Math.max(0, parseFloat(sourceBal.inTransitQty || '0') - remainingInTransit).toFixed(4),
              version: sourceBal.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(inventoryBalances.id, sourceBal.id));
        }

        await tx.insert(inventoryCostLayers).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: sourceLeId,
          warehouseId: transfer.sourceWarehouseId,
          itemId: line.itemId,
          quantityReceived: remainingInTransit.toFixed(4),
          quantityRemaining: remainingInTransit.toFixed(4),
          unitCost: unitCost.toFixed(4),
          sourceType: 'TRANSFER_REVERSAL',
          sourceId: transfer.id,
          createdAt: new Date(),
        });

        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: sourceLeId,
          warehouseId: transfer.sourceWarehouseId,
          itemId: line.itemId,
          movementNumber: `MOV-TR-REV-${suffix}-${Math.floor(100 + Math.random() * 900)}`,
          movementType: MovementType.TRANSFER_IN,
          direction: MovementDirection.IN,
          uomId: line.uomId,
          quantity: remainingInTransit.toFixed(4),
          unitCost: unitCost.toFixed(4),
          totalCost: (remainingInTransit * unitCost).toFixed(4),
          sourceType: 'STOCK_TRANSFER_REVERSAL',
          sourceId: transfer.id,
          sourceDocumentNumber: transfer.transferNumber,
          performedBy: context.userId || null,
          status: 'COMPLETED',
          notes: `عكس موثق بعد الشحن لمناقلة ${transfer.transferNumber}: ${dto.reversalReason}`,
        });
      }

      if (transfer.transferType !== TransferType.SAME_BRANCH && totalReversedValue > 0.0001) {
        await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: sourceLeId,
            branchId: transfer.sourceBranchId ?? undefined,
            journalNumber: `JV-TR-REV-${transfer.transferNumber}-${suffix}`,
            journalType: JournalType.INVENTORY,
            sourceType: 'STOCK_TRANSFER_REVERSAL',
            sourceId: transfer.id,
            description: `قيد عكس مناقلة بعد الشحن ${transfer.transferNumber}: ${dto.reversalReason}`,
            lines: [
              {
                mappingKey: DefaultAccountMappingKey.INVENTORY,
                branchId: transfer.sourceBranchId ?? undefined,
                debit: totalReversedValue.toFixed(4),
                credit: '0.0000',
                description: `استعادة مخزون معكوس - مناقلة ${transfer.transferNumber}`,
              },
              {
                mappingKey: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT,
                branchId: transfer.sourceBranchId ?? undefined,
                debit: '0.0000',
                credit: totalReversedValue.toFixed(4),
                description: `إقفال مخزون في الطريق بالرجوع - مناقلة ${transfer.transferNumber}`,
              },
            ],
          },
          tx
        );
      }

      await tx
        .update(stockTransferDiscrepancies)
        .set({
          status: TransferDiscrepancyStatus.RESOLVED_RETURNED,
          resolutionNotes: dto.reversalReason,
          resolvedBy: context.userId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(stockTransferDiscrepancies.transferId, transferId),
            inArray(stockTransferDiscrepancies.status, [
              TransferDiscrepancyStatus.OPEN,
              TransferDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      const [updated] = await tx
        .update(stockTransfers)
        .set({
          status: TransferStatus.CANCELLED,
          cancelledBy: context.userId,
          cancelledAt: new Date(),
          cancellationReason: dto.reversalReason,
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'STOCK_TRANSFER_REVERSED_AFTER_DISPATCH',
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
        transfer.status !== TransferStatus.RECEIVED &&
        transfer.status !== TransferStatus.COMPLETED &&
        transfer.status !== TransferStatus.PARTIALLY_RECEIVED
      ) {
        throw new BadRequestException(
          `لا يمكن إغلاق مناقلة بحالة '${transfer.status}'. يجب استلام الشحنة ومعالجة كافة الفروقات أولاً.`
        );
      }

      const [openDisc] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.transferId, transferId),
            inArray(stockTransferDiscrepancies.status, [
              TransferDiscrepancyStatus.OPEN,
              TransferDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      if ((openDisc?.count ?? 0) > 0) {
        throw new BadRequestException(
          `لا يمكن إغلاق المناقلة لوجود ${openDisc?.count} فروقات مفتوحة لم تتم تسويتها بعد.`
        );
      }

      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, transferId));

      for (const line of lines) {
        const dispatched = parseFloat(line.dispatchedQuantity);
        const received = parseFloat(line.receivedQuantity || '0');
        const damaged = parseFloat(line.damagedQuantity || '0');
        const lost = parseFloat(line.lostQuantity || '0');
        const unreceivedRemaining = dispatched - received - damaged - lost;

        if (unreceivedRemaining > 0.0001) {
          throw new BadRequestException(
            `لا يمكن إغلاق المناقلة لوجود كمية في الطريق (${unreceivedRemaining.toFixed(4)}) للصنف '${line.itemId}' لم يتم استلامها أو عكسها.`
          );
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

  async getTransferReconciliationReport(
    context: TenantContext,
    query?: { legalEntityId?: string }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(stockTransfers.tenantId, context.tenantId)];
      if (query?.legalEntityId) {
        conditions.push(
          sql`(${stockTransfers.sourceLegalEntityId} = ${query.legalEntityId} OR ${stockTransfers.destinationLegalEntityId} = ${query.legalEntityId})`
        );
      }

      const inTransitTransfers = await tx
        .select()
        .from(stockTransfers)
        .where(
          and(
            ...conditions,
            inArray(stockTransfers.status, [
              TransferStatus.IN_TRANSIT,
              TransferStatus.PARTIALLY_RECEIVED,
              TransferStatus.DISCREPANCY,
            ])
          )
        )
        .orderBy(desc(stockTransfers.dispatchedAt));

      const openDiscrepancies = await tx
        .select()
        .from(stockTransferDiscrepancies)
        .where(
          and(
            eq(stockTransferDiscrepancies.tenantId, context.tenantId),
            inArray(stockTransferDiscrepancies.status, [
              TransferDiscrepancyStatus.OPEN,
              TransferDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        )
        .orderBy(desc(stockTransferDiscrepancies.createdAt));

      let totalInTransitQty = 0;
      let totalInTransitValue = 0;
      for (const tr of inTransitTransfers) {
        const shipped = parseFloat(tr.totalShippedQty || '0');
        const accounted =
          parseFloat(tr.totalReceivedQty || '0') +
          parseFloat(tr.totalDamagedQty || '0') +
          parseFloat(tr.totalLostQty || '0');
        const remQty = Math.max(0, shipped - accounted);
        const totalCost = parseFloat(tr.totalTransferCost || '0');
        const remVal = shipped > 0 ? (remQty / shipped) * totalCost : 0;
        totalInTransitQty += remQty;
        totalInTransitValue += remVal;
      }

      const openDiscrepanciesValue = openDiscrepancies.reduce(
        (sum, d) => sum + parseFloat(d.totalValue || '0'),
        0
      );

      return {
        summary: {
          inTransitCount: inTransitTransfers.length,
          totalInTransitQty: totalInTransitQty.toFixed(4),
          totalInTransitValue: totalInTransitValue.toFixed(4),
          openDiscrepanciesCount: openDiscrepancies.length,
          openDiscrepanciesValue: openDiscrepanciesValue.toFixed(4),
        },
        inTransitTransfers,
        openDiscrepancies,
      };
    });
  }

  // ==================================================================
  // 4. Stocktake & Physical Inventory Counting Engine (Phase B)
  // ==================================================================

  async createStocktakeOrder(
    context: TenantContext,
    dto: CreateStocktakeOrderRequest
  ) {
    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        documentType: 'STOCK_ADJUSTMENT',
        sourceType: 'stocktake_orders',
      },
      async (allocatedOrderNumber) => {
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

          const [order] = await tx
            .insert(stocktakeOrders)
            .values({
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              warehouseId: dto.warehouseId,
              orderNumber: allocatedOrderNumber,
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
    );
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
    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: dto.legalEntityId,
        documentType: 'STOCK_ADJUSTMENT',
        sourceType: 'stock_adjustments',
      },
      async (allocatedAdjustmentNumber) => {
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
              adjustmentNumber: allocatedAdjustmentNumber,
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
    );
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
  ): Promise<{
    totalCost: number;
    unitCost: number;
    exhaustedLayersCount: number;
    consumedLayers: Array<{ sourceLayerId: string; quantity: number; unitCost: number }>;
  }> {
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
    const consumedLayers: Array<{ sourceLayerId: string; quantity: number; unitCost: number }> = [];

    for (const layer of layers) {
      if (remainingQtyToDeduct <= 0.00001) break;

      const layerRem = parseFloat(layer.quantityRemaining);
      const layerCost = parseFloat(layer.unitCost);

      if (layerRem <= remainingQtyToDeduct) {
        // Exhaust this layer
        totalCostConsumed += layerRem * layerCost;
        remainingQtyToDeduct -= layerRem;
        layersCount++;
        consumedLayers.push({ sourceLayerId: layer.id, quantity: layerRem, unitCost: layerCost });

        await tx
          .update(inventoryCostLayers)
          .set({ quantityRemaining: '0.0000' })
          .where(eq(inventoryCostLayers.id, layer.id));
      } else {
        // Partially deduct from this layer
        totalCostConsumed += remainingQtyToDeduct * layerCost;
        consumedLayers.push({
          sourceLayerId: layer.id,
          quantity: remainingQtyToDeduct,
          unitCost: layerCost,
        });
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
      consumedLayers,
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

  async receiveStock(context: TenantContext, dto: ReceiveStockRequest, externalTx?: any) {
    const run = async (tx: any) => {
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
    };
    return externalTx ? await run(externalTx) : await this.dbService.withTenantContext(context, run);
  }

  // ==================================================================
  // 11. Direct Issuing & Non-Negative Stock Enforcement (Phase A)
  // ==================================================================

  async issueStock(context: TenantContext, dto: IssueStockRequest, externalTx?: any) {
    const run = async (tx: any, allocatedDeliveryNumber?: string) => {
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
      const movementNumber =
        allocatedDeliveryNumber ||
        `MOV-ISS-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

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
          sourceDocumentNumber: allocatedDeliveryNumber || dto.sourceDocumentNumber || null,
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
    };
    if (externalTx) {
      return await run(externalTx);
    }

    const [whMeta] = await this.dbService.withTenantContext(context, async (tx) =>
      tx
        .select({ legalEntityId: warehouses.legalEntityId, branchId: warehouses.branchId })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.warehouseId)))
        .limit(1)
    );

    if (!whMeta || !whMeta.legalEntityId) {
      throw new NotFoundException('المستودع المحدد غير موجود أو غير مرتبط بمنشأة قانونية');
    }

    return await this.documentNumbering.withAllocatedNumber(
      context,
      {
        legalEntityId: whMeta.legalEntityId,
        branchId: whMeta.branchId,
        documentType: 'DELIVERY_NOTE',
        sourceType: 'inventory_movements',
      },
      async (allocatedDeliveryNumber) => {
        return await this.dbService.withTenantContext(context, (tx) =>
          run(tx, allocatedDeliveryNumber)
        );
      },
      (r: any) => r.movement.id
    );
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
