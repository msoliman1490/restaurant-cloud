import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import {
  purchaseRequests,
  purchaseRequestLines,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceipts,
  goodsReceiptLines,
  supplierInvoices,
  supplierInvoiceLines,
  purchaseReturns,
  purchaseReturnLines,
  supplierBalances,
  supplierPayments,
  items,
} from '@restaurant-cloud/database';
import {
  CreatePurchaseRequest,
  CreatePurchaseOrder,
  CreateGoodsReceipt,
  CreateSupplierInvoice,
  CreatePurchaseReturn,
  CreateSupplierPaymentRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  PurchaseRequestStatus,
  PurchaseOrderStatus,
  GoodsReceiptStatus,
  SupplierInvoiceStatus,
  PurchaseReturnStatus,
  MovementType,
  JournalType,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly postingEngineService: PostingEngineService
  ) {}

  // ==================================================================
  // 1. Purchase Requests
  // ==================================================================

  async createPurchaseRequest(context: TenantContext, dto: CreatePurchaseRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: purchaseRequests.id })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.tenantId, context.tenantId),
            eq(purchaseRequests.legalEntityId, dto.legalEntityId),
            eq(purchaseRequests.requestNumber, dto.requestNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Purchase request '${dto.requestNumber}' already exists`);
      }

      const [pr] = await tx
        .insert(purchaseRequests)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          requestNumber: dto.requestNumber,
          status: PurchaseRequestStatus.SUBMITTED,
          requestedBy: context.userId,
          neededByDate: dto.neededByDate ? new Date(dto.neededByDate) : null,
          notes: dto.notes || null,
        })
        .returning();

      if (!pr) throw new Error('Failed to create purchase request');

      const lines = await tx
        .insert(purchaseRequestLines)
        .values(
          dto.lines.map((l) => ({
            tenantId: context.tenantId,
            requestId: pr.id,
            itemId: l.itemId,
            uomId: l.uomId,
            requestedQty: l.requestedQty,
            estimatedUnitCost: l.estimatedUnitCost || '0.0000',
            notes: l.notes || null,
          }))
        )
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_REQUEST_CREATED',
          entityType: 'purchase_request',
          entityId: pr.id,
          afterState: { pr, lines },
        },
        tx
      );

      return { ...pr, lines };
    });
  }

  async getPurchaseRequests(
    context: TenantContext,
    params: {
      legalEntityId?: string;
      warehouseId?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const page = Math.max(1, Number.isFinite(params.page) ? Number(params.page) : 1);
      const limit = Math.min(100, Math.max(1, Number.isFinite(params.limit) ? Number(params.limit) : 20));
      const offset = (page - 1) * limit;

      const conditions = [eq(purchaseRequests.tenantId, context.tenantId)];
      if (params.legalEntityId) {
        conditions.push(eq(purchaseRequests.legalEntityId, params.legalEntityId));
      }
      if (params.warehouseId) {
        conditions.push(eq(purchaseRequests.warehouseId, params.warehouseId));
      }
      if (params.status) {
        conditions.push(eq(purchaseRequests.status, params.status));
      }

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseRequests)
        .where(and(...conditions));

      const rows = await tx
        .select()
        .from(purchaseRequests)
        .where(and(...conditions))
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(limit)
        .offset(offset);

      const total = countRow?.count ?? 0;
      return {
        items: rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async getPurchaseRequestById(context: TenantContext, requestId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [pr] = await tx
        .select()
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.tenantId, context.tenantId),
            eq(purchaseRequests.id, requestId)
          )
        )
        .limit(1);

      if (!pr) {
        throw new NotFoundException(`Purchase request '${requestId}' not found`);
      }

      const lines = await tx
        .select()
        .from(purchaseRequestLines)
        .where(
          and(
            eq(purchaseRequestLines.tenantId, context.tenantId),
            eq(purchaseRequestLines.requestId, pr.id)
          )
        );

      return {
        ...pr,
        lines,
        approvalMetadata: {
          status: pr.status,
          requestedBy: pr.requestedBy,
          approvedBy: pr.approvedBy,
          createdAt: pr.createdAt,
        },
      };
    });
  }

  async approvePurchaseRequest(context: TenantContext, requestId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [pr] = await tx
        .select()
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.tenantId, context.tenantId),
            eq(purchaseRequests.id, requestId)
          )
        )
        .for('update')
        .limit(1);

      if (!pr) {
        throw new NotFoundException(`Purchase request '${requestId}' not found`);
      }

      if (
        pr.status !== PurchaseRequestStatus.DRAFT &&
        pr.status !== PurchaseRequestStatus.SUBMITTED
      ) {
        throw new ConflictException(
          `Purchase request '${pr.requestNumber}' cannot be approved from status '${pr.status}'`
        );
      }

      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          status: PurchaseRequestStatus.APPROVED,
          approvedBy: context.userId,
          version: (pr.version ?? 1) + 1,
        })
        .where(eq(purchaseRequests.id, pr.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_REQUEST_APPROVED',
          entityType: 'purchase_request',
          entityId: pr.id,
          beforeState: { status: pr.status, approvedBy: pr.approvedBy },
          afterState: { status: PurchaseRequestStatus.APPROVED, approvedBy: context.userId },
        },
        tx
      );

      return updated;
    });
  }

  async rejectPurchaseRequest(context: TenantContext, requestId: string, reason: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [pr] = await tx
        .select()
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.tenantId, context.tenantId),
            eq(purchaseRequests.id, requestId)
          )
        )
        .for('update')
        .limit(1);

      if (!pr) {
        throw new NotFoundException(`Purchase request '${requestId}' not found`);
      }

      if (
        pr.status !== PurchaseRequestStatus.DRAFT &&
        pr.status !== PurchaseRequestStatus.SUBMITTED
      ) {
        throw new ConflictException(
          `Purchase request '${pr.requestNumber}' cannot be rejected from status '${pr.status}'`
        );
      }

      const cleanReason = reason?.trim() || 'Rejected';
      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          status: PurchaseRequestStatus.REJECTED,
          approvedBy: context.userId,
          notes: `[REJECTED: ${cleanReason}] ${pr.notes || ''}`.trim(),
        })
        .where(eq(purchaseRequests.id, pr.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_REQUEST_REJECTED',
          entityType: 'purchase_request',
          entityId: pr.id,
          beforeState: { status: pr.status },
          afterState: { status: PurchaseRequestStatus.REJECTED, reason: cleanReason, rejectedBy: context.userId },
        },
        tx
      );

      return updated;
    });
  }

  async convertPurchaseRequestToOrder(
    context: TenantContext,
    requestId: string,
    dto: {
      supplierId: string;
      orderNumber?: string;
      expectedDeliveryDate?: string;
      currency?: string;
      notes?: string;
      submitAsDraft?: boolean;
    }
  ) {
    if (!dto?.supplierId) {
      throw new BadRequestException('supplierId is required to convert a purchase request to PO');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [pr] = await tx
        .select()
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.tenantId, context.tenantId),
            eq(purchaseRequests.id, requestId)
          )
        )
        .for('update')
        .limit(1);

      if (!pr) {
        throw new NotFoundException(`Purchase request '${requestId}' not found`);
      }

      if (pr.status === 'CONVERTED_TO_PO') {
        throw new ConflictException(
          `Purchase request '${pr.requestNumber}' has already been converted to a purchase order`
        );
      }

      if (pr.status !== PurchaseRequestStatus.APPROVED) {
        throw new ConflictException(
          `Purchase request '${pr.requestNumber}' must be APPROVED before converting to PO (current status: '${pr.status}')`
        );
      }

      const prLines = await tx
        .select()
        .from(purchaseRequestLines)
        .where(
          and(
            eq(purchaseRequestLines.tenantId, context.tenantId),
            eq(purchaseRequestLines.requestId, pr.id)
          )
        );

      if (prLines.length === 0) {
        throw new BadRequestException(`Purchase request '${pr.requestNumber}' has no lines to convert`);
      }

      const orderNumber =
        dto.orderNumber?.trim() ||
        `PO-${pr.requestNumber}-${Date.now().toString(36).toUpperCase()}`;

      const [existingPo] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, context.tenantId),
            eq(purchaseOrders.legalEntityId, pr.legalEntityId),
            eq(purchaseOrders.orderNumber, orderNumber)
          )
        )
        .limit(1);

      if (existingPo) {
        throw new ConflictException(`Purchase order '${orderNumber}' already exists`);
      }

      let subtotal = 0;
      let taxTotal = 0;
      const defaultTaxRate = 0.15;

      const preparedLines = prLines.map((line) => {
        const qty = parseFloat(line.requestedQty);
        const price = parseFloat(line.estimatedUnitCost || '0');
        const lineSub = qty * price;
        const lineTax = lineSub * defaultTaxRate;
        const lineTotal = lineSub + lineTax;
        subtotal += lineSub;
        taxTotal += lineTax;

        return {
          itemId: line.itemId,
          uomId: line.uomId,
          orderedQty: line.requestedQty,
          unitPrice: price.toFixed(4),
          taxRate: defaultTaxRate.toFixed(4),
          lineTotal: lineTotal.toFixed(4),
        };
      });

      const grandTotal = subtotal + taxTotal;
      const poStatus = dto.submitAsDraft
        ? PurchaseOrderStatus.DRAFT
        : PurchaseOrderStatus.ISSUED;

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: pr.legalEntityId,
          supplierId: dto.supplierId,
          warehouseId: pr.warehouseId,
          orderNumber,
          status: poStatus,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : pr.neededByDate,
          subtotal: subtotal.toFixed(4),
          taxAmount: taxTotal.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          currency: dto.currency || 'SAR',
          notes: dto.notes || `Converted from PR ${pr.requestNumber}`,
          issuedBy: dto.submitAsDraft ? null : context.userId,
        })
        .returning();

      if (!po) throw new Error('Failed to create purchase order from purchase request');

      const createdPoLines = await tx
        .insert(purchaseOrderLines)
        .values(
          preparedLines.map((l) => ({
            ...l,
            tenantId: context.tenantId,
            orderId: po.id,
          }))
        )
        .returning();

      const [updatedPr] = await tx
        .update(purchaseRequests)
        .set({
          status: 'CONVERTED_TO_PO',
          notes: `[CONVERTED_TO_PO: ${po.orderNumber}] ${pr.notes || ''}`.trim(),
        })
        .where(eq(purchaseRequests.id, pr.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_REQUEST_CONVERTED_TO_PO',
          entityType: 'purchase_request',
          entityId: pr.id,
          beforeState: { status: pr.status },
          afterState: {
            status: 'CONVERTED_TO_PO',
            purchaseOrderId: po.id,
            orderNumber: po.orderNumber,
          },
        },
        tx
      );

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: dto.submitAsDraft ? 'PURCHASE_ORDER_CREATED_DRAFT' : 'PURCHASE_ORDER_ISSUED',
          entityType: 'purchase_order',
          entityId: po.id,
          afterState: { po, lines: createdPoLines, sourceRequestId: pr.id },
        },
        tx
      );

      return {
        purchaseRequest: updatedPr,
        purchaseOrder: { ...po, lines: createdPoLines },
      };
    });
  }

  // ==================================================================
  // 2. Purchase Orders
  // ==================================================================

  async createPurchaseOrder(context: TenantContext, dto: CreatePurchaseOrder) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, context.tenantId),
            eq(purchaseOrders.legalEntityId, dto.legalEntityId),
            eq(purchaseOrders.orderNumber, dto.orderNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Purchase order '${dto.orderNumber}' already exists`);
      }

      // Calculate totals
      let subtotal = 0;
      let taxTotal = 0;

      const preparedLines = dto.lines.map((line) => {
        const qty = parseFloat(line.orderedQty);
        const price = parseFloat(line.unitPrice);
        const rate = parseFloat(line.taxRate || '0.1500');
        const lineSubtotal = qty * price;
        const lineTax = lineSubtotal * rate;
        const lineTotal = lineSubtotal + lineTax;

        subtotal += lineSubtotal;
        taxTotal += lineTax;

        return {
          itemId: line.itemId,
          uomId: line.uomId,
          orderedQty: line.orderedQty,
          receivedQty: '0.0000',
          invoicedQty: '0.0000',
          unitPrice: line.unitPrice,
          taxRate: line.taxRate || '0.1500',
          lineTotal: lineTotal.toFixed(4),
        };
      });

      const grandTotal = subtotal + taxTotal;

      const initialStatus = dto.submitAsDraft
        ? PurchaseOrderStatus.DRAFT
        : PurchaseOrderStatus.ISSUED;

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          orderNumber: dto.orderNumber,
          status: initialStatus,
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
          subtotal: subtotal.toFixed(4),
          taxAmount: taxTotal.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          currency: dto.currency || 'SAR',
          notes: dto.notes || null,
          issuedBy: context.userId,
        })
        .returning();

      if (!po) throw new Error('Failed to create purchase order');

      const createdLines = await tx
        .insert(purchaseOrderLines)
        .values(preparedLines.map((l) => ({ ...l, tenantId: context.tenantId, orderId: po.id })))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: dto.submitAsDraft ? 'PURCHASE_ORDER_CREATED_DRAFT' : 'PURCHASE_ORDER_ISSUED',
          entityType: 'purchase_order',
          entityId: po.id,
          afterState: { po, lines: createdLines },
        },
        tx
      );

      return { ...po, lines: createdLines };
    });
  }

  async approvePurchaseOrder(context: TenantContext, orderId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, context.tenantId),
            eq(purchaseOrders.id, orderId)
          )
        )
        .for('update')
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order '${orderId}' not found`);
      }
      if (po.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException(
          `Purchase order '${po.orderNumber}' cannot be approved from status '${po.status}'`
        );
      }

      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          status: PurchaseOrderStatus.ISSUED,
          issuedBy: context.userId,
          version: (po.version ?? 1) + 1,
        })
        .where(eq(purchaseOrders.id, po.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_ORDER_APPROVED',
          entityType: 'purchase_order',
          entityId: po.id,
          beforeState: { status: po.status },
          afterState: { status: PurchaseOrderStatus.ISSUED },
        },
        tx
      );

      return updated;
    });
  }

  async cancelPurchaseOrder(context: TenantContext, orderId: string, reason: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, context.tenantId),
            eq(purchaseOrders.id, orderId)
          )
        )
        .for('update')
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order '${orderId}' not found`);
      }
      if (
        po.status === PurchaseOrderStatus.COMPLETED ||
        po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
        po.status === PurchaseOrderStatus.CANCELLED
      ) {
        throw new ConflictException(
          `Purchase order '${po.orderNumber}' cannot be cancelled from status '${po.status}'`
        );
      }

      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          status: PurchaseOrderStatus.CANCELLED,
          notes: `[CANCELLED: ${reason}] ${po.notes || ''}`.trim(),
        })
        .where(eq(purchaseOrders.id, po.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_ORDER_CANCELLED',
          entityType: 'purchase_order',
          entityId: po.id,
          beforeState: { status: po.status },
          afterState: { status: PurchaseOrderStatus.CANCELLED, reason },
        },
        tx
      );

      return updated;
    });
  }

  private async paginateTable<T extends Record<string, any>>(
    tx: any,
    table: any,
    conditions: any[],
    orderByCol: any,
    pagination?: { page?: number; limit?: number },
    defaultUnpaginatedLimit?: number
  ) {
    if (!pagination) {
      const q = tx
        .select()
        .from(table)
        .where(and(...conditions))
        .orderBy(desc(orderByCol));
      return defaultUnpaginatedLimit ? await q.limit(defaultUnpaginatedLimit) : await q;
    }

    const page = Math.max(1, Number.isFinite(pagination.page) ? Number(pagination.page) : 1);
    const limit = Math.min(100, Math.max(1, Number.isFinite(pagination.limit) ? Number(pagination.limit) : 20));
    const offset = (page - 1) * limit;

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(and(...conditions));

    const items = await tx
      .select()
      .from(table)
      .where(and(...conditions))
      .orderBy(desc(orderByCol))
      .limit(limit)
      .offset(offset);

    const total = countRow?.count ?? 0;
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPurchaseOrders(
    context: TenantContext,
    legalEntityId?: string,
    pagination?: { page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(purchaseOrders.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(purchaseOrders.legalEntityId, legalEntityId));
      }
      return await this.paginateTable(tx, purchaseOrders, conditions, purchaseOrders.createdAt, pagination);
    });
  }

  async getGoodsReceipts(
    context: TenantContext,
    legalEntityId?: string,
    pagination?: { page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(goodsReceipts.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(goodsReceipts.legalEntityId, legalEntityId));
      }
      return await this.paginateTable(tx, goodsReceipts, conditions, goodsReceipts.receivedAt, pagination, 100);
    });
  }

  async getSupplierInvoices(
    context: TenantContext,
    legalEntityId?: string,
    pagination?: { page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(supplierInvoices.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(supplierInvoices.legalEntityId, legalEntityId));
      }
      return await this.paginateTable(tx, supplierInvoices, conditions, supplierInvoices.createdAt, pagination, 100);
    });
  }

  async getPurchaseReturns(
    context: TenantContext,
    legalEntityId?: string,
    pagination?: { page?: number; limit?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(purchaseReturns.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(purchaseReturns.legalEntityId, legalEntityId));
      }
      return await this.paginateTable(tx, purchaseReturns, conditions, purchaseReturns.id, pagination, 100);
    });
  }

  async getSupplierPayments(context: TenantContext, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(supplierPayments.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(supplierPayments.legalEntityId, legalEntityId));
      }
      return await tx
        .select()
        .from(supplierPayments)
        .where(and(...conditions))
        .orderBy(desc(supplierPayments.createdAt))
        .limit(100);
    });
  }

  // ==================================================================
  // 3. Goods Receipts (GRN) — Integrates with Inventory & FIFO Layers
  // ==================================================================

  async receiveGoods(context: TenantContext, dto: CreateGoodsReceipt) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.tenantId, context.tenantId),
            eq(goodsReceipts.legalEntityId, dto.legalEntityId),
            eq(goodsReceipts.receiptNumber, dto.receiptNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Goods receipt '${dto.receiptNumber}' already exists`);
      }

      if (dto.purchaseOrderId) {
        const [po] = await tx
          .select()
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.tenantId, context.tenantId),
              eq(purchaseOrders.id, dto.purchaseOrderId)
            )
          )
          .for('update')
          .limit(1);

        if (!po) {
          throw new NotFoundException(`Purchase order '${dto.purchaseOrderId}' not found`);
        }
        if (po.legalEntityId !== dto.legalEntityId) {
          throw new BadRequestException('Purchase order belongs to a different legal entity');
        }
        if (
          po.status !== PurchaseOrderStatus.ISSUED &&
          po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
        ) {
          throw new BadRequestException(
            `Cannot receive goods for purchase order in status '${po.status}'`
          );
        }
      }

      const [grn] = await tx
        .insert(goodsReceipts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          purchaseOrderId: dto.purchaseOrderId || null,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          receiptNumber: dto.receiptNumber,
          deliveryNoteNumber: dto.deliveryNoteNumber || null,
          status: GoodsReceiptStatus.RECEIVED,
          receivedBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (!grn) throw new Error('Failed to create goods receipt');

      const createdLines = [];

      for (const line of dto.lines) {
        const recQty = parseFloat(line.receivedQty);
        if (isNaN(recQty) || recQty <= 0) {
          throw new BadRequestException('Received quantity must be greater than zero');
        }

        // 1. Validate & Update PO Line received quantity if linked (with row lock & over-receipt guard)
        if (line.purchaseOrderLineId) {
          const [poLine] = await tx
            .select()
            .from(purchaseOrderLines)
            .where(eq(purchaseOrderLines.id, line.purchaseOrderLineId))
            .for('update')
            .limit(1);

          if (!poLine) {
            throw new NotFoundException(`Purchase order line '${line.purchaseOrderLineId}' not found`);
          }
          if (dto.purchaseOrderId && poLine.orderId !== dto.purchaseOrderId) {
            throw new BadRequestException('PO line does not belong to the specified purchase order');
          }

          const currentRec = parseFloat(poLine.receivedQty || '0');
          const ordered = parseFloat(poLine.orderedQty);
          if (currentRec + recQty > ordered + 0.0001) {
            throw new BadRequestException(
              `Over-receipt not allowed: ordered ${ordered.toFixed(4)}, already received ${currentRec.toFixed(4)}, attempted ${recQty.toFixed(4)}`
            );
          }

          const totalRec = (currentRec + recQty).toFixed(4);

          await tx
            .update(purchaseOrderLines)
            .set({ receivedQty: totalRec })
            .where(eq(purchaseOrderLines.id, poLine.id));
        }

        const [grnLine] = await tx
          .insert(goodsReceiptLines)
          .values({
            tenantId: context.tenantId,
            receiptId: grn.id,
            purchaseOrderLineId: line.purchaseOrderLineId || null,
            itemId: line.itemId,
            uomId: line.uomId,
            receivedQty: line.receivedQty,
            unitCost: line.unitCost,
            lotNumber: line.lotNumber || null,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
          })
          .returning();

        createdLines.push(grnLine);

        // 2. Delegate stock receipt, FIFO cost layer, weighted avg cost & ledger movement to InventoryService
        await this.inventoryService.receiveStock(
          context,
          {
            legalEntityId: dto.legalEntityId,
            warehouseId: dto.warehouseId,
            itemId: line.itemId,
            uomId: line.uomId,
            quantity: line.receivedQty,
            unitCost: line.unitCost,
            movementType: MovementType.PURCHASE_RECEIPT,
            sourceType: 'GOODS_RECEIPT',
            sourceId: grn.id,
            sourceDocumentNumber: dto.receiptNumber,
            batchNumber: line.lotNumber,
            notes: dto.notes,
          },
          tx
        );
      }

      // Update PO Status if linked
      if (dto.purchaseOrderId) {
        const poLines = await tx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.orderId, dto.purchaseOrderId));

        const allCompleted = poLines.every(
          (l) => parseFloat(l.receivedQty) >= parseFloat(l.orderedQty)
        );

        await tx
          .update(purchaseOrders)
          .set({
            status: allCompleted
              ? PurchaseOrderStatus.COMPLETED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          })
          .where(eq(purchaseOrders.id, dto.purchaseOrderId));
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'GOODS_RECEIPT_POSTED',
          entityType: 'goods_receipt',
          entityId: grn.id,
          afterState: { grn, lines: createdLines },
        },
        tx
      );

      return { ...grn, lines: createdLines };
    });
  }

  // ==================================================================
  // 4. Supplier Invoices (3-Way Matching & AP Balance)
  // ==================================================================

  async createSupplierInvoice(context: TenantContext, dto: CreateSupplierInvoice) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Check duplicate invoice number from this supplier
      const [existing] = await tx
        .select({ id: supplierInvoices.id })
        .from(supplierInvoices)
        .where(
          and(
            eq(supplierInvoices.tenantId, context.tenantId),
            eq(supplierInvoices.supplierId, dto.supplierId),
            eq(supplierInvoices.invoiceNumber, dto.invoiceNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Invoice '${dto.invoiceNumber}' from this supplier is already registered`
        );
      }

      // 3-Way Matching Validation (PO + GRN + Invoice)
      let lockedPoLines: any[] = [];
      if (dto.purchaseOrderId) {
        const [po] = await tx
          .select()
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.tenantId, context.tenantId),
              eq(purchaseOrders.id, dto.purchaseOrderId)
            )
          )
          .for('update')
          .limit(1);

        if (!po) {
          throw new NotFoundException(`Purchase order '${dto.purchaseOrderId}' not found`);
        }
        if (po.legalEntityId !== dto.legalEntityId || po.supplierId !== dto.supplierId) {
          throw new BadRequestException('Purchase order does not match supplier or legal entity');
        }
        if (po.status === PurchaseOrderStatus.DRAFT || po.status === PurchaseOrderStatus.CANCELLED) {
          throw new BadRequestException(`Cannot invoice purchase order in status '${po.status}'`);
        }

        lockedPoLines = await tx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.orderId, po.id))
          .for('update');
      }

      if (dto.goodsReceiptId) {
        const [grn] = await tx
          .select()
          .from(goodsReceipts)
          .where(
            and(
              eq(goodsReceipts.tenantId, context.tenantId),
              eq(goodsReceipts.id, dto.goodsReceiptId)
            )
          )
          .for('update')
          .limit(1);

        if (!grn) {
          throw new NotFoundException(`Goods receipt '${dto.goodsReceiptId}' not found`);
        }
        if (grn.legalEntityId !== dto.legalEntityId || grn.supplierId !== dto.supplierId) {
          throw new BadRequestException('Goods receipt does not match supplier or legal entity');
        }
        if (dto.purchaseOrderId && grn.purchaseOrderId && grn.purchaseOrderId !== dto.purchaseOrderId) {
          throw new BadRequestException('Goods receipt does not belong to the specified purchase order');
        }

        const grnLines = await tx
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.receiptId, grn.id));

        const priorInvoices = await tx
          .select({ id: supplierInvoices.id })
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.tenantId, context.tenantId),
              eq(supplierInvoices.goodsReceiptId, grn.id)
            )
          );

        const priorInvoicedByItem = new Map<string, number>();
        if (priorInvoices.length > 0) {
          const priorLines = await tx
            .select()
            .from(supplierInvoiceLines)
            .where(inArray(supplierInvoiceLines.invoiceId, priorInvoices.map((i) => i.id)));
          for (const pl of priorLines) {
            priorInvoicedByItem.set(
              pl.itemId,
              (priorInvoicedByItem.get(pl.itemId) || 0) + parseFloat(pl.quantity)
            );
          }
        }

        for (const invLine of dto.lines) {
          const matchingGrnLines = grnLines.filter((gl) => gl.itemId === invLine.itemId);
          if (matchingGrnLines.length === 0) {
            throw new BadRequestException(
              `3-Way Match failed: item '${invLine.itemId}' was not received on GRN '${grn.receiptNumber}'`
            );
          }
          const totalReceivedForItem = matchingGrnLines.reduce(
            (sum, gl) => sum + parseFloat(gl.receivedQty),
            0
          );
          const alreadyInvoiced = priorInvoicedByItem.get(invLine.itemId) || 0;
          const newInvQty = parseFloat(invLine.quantity);
          if (alreadyInvoiced + newInvQty > totalReceivedForItem + 0.0001) {
            throw new BadRequestException(
              `3-Way Match failed: invoiced qty (${(alreadyInvoiced + newInvQty).toFixed(4)}) exceeds received qty (${totalReceivedForItem.toFixed(4)}) for item '${invLine.itemId}'`
            );
          }

          if (!dto.allowVarianceOverride) {
            const firstGrnLine = matchingGrnLines[0]!;
            const grnUnitCost = parseFloat(firstGrnLine.unitCost);
            const invPrice = parseFloat(invLine.unitPrice);
            const tolerance = Math.max(0.01, grnUnitCost * 0.02);
            if (Math.abs(invPrice - grnUnitCost) > tolerance) {
              throw new BadRequestException(
                `3-Way Match price variance: invoice price (${invPrice.toFixed(4)}) differs from GRN cost (${grnUnitCost.toFixed(4)}) beyond tolerance`
              );
            }
          }
        }
      }

      if (lockedPoLines.length > 0) {
        for (const invLine of dto.lines) {
          const poLine = lockedPoLines.find((pl) => pl.itemId === invLine.itemId);
          if (!poLine) {
            throw new BadRequestException(
              `3-Way Match failed: item '${invLine.itemId}' is not on the purchase order`
            );
          }
          const newInvoiced = parseFloat(poLine.invoicedQty || '0') + parseFloat(invLine.quantity);
          const ordered = parseFloat(poLine.orderedQty);
          if (newInvoiced > ordered + 0.0001) {
            throw new BadRequestException(
              `3-Way Match failed: invoiced qty (${newInvoiced.toFixed(4)}) exceeds PO ordered qty (${ordered.toFixed(4)})`
            );
          }
          await tx
            .update(purchaseOrderLines)
            .set({ invoicedQty: newInvoiced.toFixed(4) })
            .where(eq(purchaseOrderLines.id, poLine.id));
        }
      }

      let subtotal = 0;
      let taxTotal = 0;

      const preparedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const price = parseFloat(l.unitPrice);
        const rate = parseFloat(l.taxRate || '0.1500');
        const lineSub = qty * price;
        const lineTax = lineSub * rate;
        const lineTot = lineSub + lineTax;

        subtotal += lineSub;
        taxTotal += lineTax;

        return {
          itemId: l.itemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate || '0.1500',
          lineTotal: lineTot.toFixed(4),
        };
      });

      const grandTotal = subtotal + taxTotal;

      const [invoice] = await tx
        .insert(supplierInvoices)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          purchaseOrderId: dto.purchaseOrderId || null,
          goodsReceiptId: dto.goodsReceiptId || null,
          invoiceNumber: dto.invoiceNumber,
          status: SupplierInvoiceStatus.APPROVED,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate: new Date(dto.dueDate),
          subtotal: subtotal.toFixed(4),
          taxAmount: taxTotal.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          paidAmount: '0.0000',
          currency: dto.currency || 'SAR',
          notes: dto.notes || null,
        })
        .returning();

      if (!invoice) throw new Error('Failed to create supplier invoice');

      const createdLines = await tx
        .insert(supplierInvoiceLines)
        .values(preparedLines.map((l) => ({ ...l, tenantId: context.tenantId, invoiceId: invoice.id })))
        .returning();

      // Update Supplier Balance (AP subledger) with row lock
      const [existingBal] = await tx
        .select()
        .from(supplierBalances)
        .where(
          and(
            eq(supplierBalances.tenantId, context.tenantId),
            eq(supplierBalances.legalEntityId, dto.legalEntityId),
            eq(supplierBalances.supplierId, dto.supplierId)
          )
        )
        .for('update')
        .limit(1);

      if (existingBal) {
        const newBal = (parseFloat(existingBal.currentBalance) + grandTotal).toFixed(4);
        const newInvoiced = (parseFloat(existingBal.totalInvoiced) + grandTotal).toFixed(4);

        await tx
          .update(supplierBalances)
          .set({
            currentBalance: newBal,
            totalInvoiced: newInvoiced,
            updatedAt: new Date(),
          })
          .where(eq(supplierBalances.id, existingBal.id));
      } else {
        await tx.insert(supplierBalances).values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          currentBalance: grandTotal.toFixed(4),
          totalInvoiced: grandTotal.toFixed(4),
          totalPaid: '0.0000',
        });
      }

      // Post Supplier Invoice Journal Entry via PostingEngine (Dr Inventory, Dr VAT Input, Cr Accounts Payable)
      const invoiceJournalLines: any[] = [
        {
          mappingKey: DefaultAccountMappingKey.INVENTORY,
          debit: subtotal.toFixed(4),
          credit: '0.0000',
          currency: dto.currency || 'SAR',
          description: `Supplier Invoice ${dto.invoiceNumber} Inventory`,
        },
      ];
      if (taxTotal > 0.0001) {
        invoiceJournalLines.push({
          mappingKey: DefaultAccountMappingKey.VAT_INPUT,
          debit: taxTotal.toFixed(4),
          credit: '0.0000',
          currency: dto.currency || 'SAR',
          description: `Supplier Invoice ${dto.invoiceNumber} VAT Input`,
        });
      }
      invoiceJournalLines.push({
        mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
        partnerRole: 'SUPPLIER',
        subledgerDocumentType: 'SUPPLIER_INVOICE',
        subledgerDocumentId: invoice.id,
        debit: '0.0000',
        credit: grandTotal.toFixed(4),
        currency: dto.currency || 'SAR',
        description: `AP Liability for Invoice ${dto.invoiceNumber}`,
      });

      await this.postingEngineService.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          journalNumber: `JV-PINV-${dto.invoiceNumber}`,
          journalType: JournalType.GENERAL,
          sourceType: 'supplier_invoice',
          sourceId: invoice.id,
          description: `Supplier Invoice ${dto.invoiceNumber}`,
          entryDate: new Date(dto.invoiceDate),
          lines: invoiceJournalLines,
        },
        tx
      );

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SUPPLIER_INVOICE_RECORDED',
          entityType: 'supplier_invoice',
          entityId: invoice.id,
          afterState: { invoice, lines: createdLines },
        },
        tx
      );

      return { ...invoice, lines: createdLines };
    });
  }

  // ==================================================================
  // 5. Purchase Returns
  // ==================================================================

  async createPurchaseReturn(context: TenantContext, dto: CreatePurchaseReturn) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existingReturn] = await tx
        .select({ id: purchaseReturns.id })
        .from(purchaseReturns)
        .where(
          and(
            eq(purchaseReturns.tenantId, context.tenantId),
            eq(purchaseReturns.legalEntityId, dto.legalEntityId),
            eq(purchaseReturns.returnNumber, dto.returnNumber)
          )
        )
        .limit(1);

      if (existingReturn) {
        throw new ConflictException(`Purchase return '${dto.returnNumber}' already exists`);
      }

      let resolvedWarehouseId = dto.warehouseId || null;

      if (dto.goodsReceiptId) {
        const [grn] = await tx
          .select()
          .from(goodsReceipts)
          .where(
            and(
              eq(goodsReceipts.tenantId, context.tenantId),
              eq(goodsReceipts.id, dto.goodsReceiptId)
            )
          )
          .for('update')
          .limit(1);

        if (!grn) {
          throw new NotFoundException(`Goods receipt '${dto.goodsReceiptId}' not found`);
        }
        if (grn.legalEntityId !== dto.legalEntityId || grn.supplierId !== dto.supplierId) {
          throw new BadRequestException('Goods receipt does not match supplier or legal entity');
        }

        if (!resolvedWarehouseId) {
          resolvedWarehouseId = grn.warehouseId;
        }

        const grnLines = await tx
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.receiptId, grn.id));

        const priorReturns = await tx
          .select({ id: purchaseReturns.id })
          .from(purchaseReturns)
          .where(
            and(
              eq(purchaseReturns.tenantId, context.tenantId),
              eq(purchaseReturns.goodsReceiptId, grn.id)
            )
          );

        const priorReturnedByItem = new Map<string, number>();
        if (priorReturns.length > 0) {
          const priorRetLines = await tx
            .select()
            .from(purchaseReturnLines)
            .where(inArray(purchaseReturnLines.returnId, priorReturns.map((r) => r.id)));
          for (const prl of priorRetLines) {
            priorReturnedByItem.set(
              prl.itemId,
              (priorReturnedByItem.get(prl.itemId) || 0) + parseFloat(prl.quantity)
            );
          }
        }

        for (const retLine of dto.lines) {
          const totalReceivedForItem = grnLines
            .filter((gl) => gl.itemId === retLine.itemId)
            .reduce((sum, gl) => sum + parseFloat(gl.receivedQty), 0);
          if (totalReceivedForItem <= 0) {
            throw new BadRequestException(
              `Item '${retLine.itemId}' was not received on GRN '${grn.receiptNumber}'`
            );
          }
          const alreadyReturned = priorReturnedByItem.get(retLine.itemId) || 0;
          const attemptQty = parseFloat(retLine.quantity);
          if (alreadyReturned + attemptQty > totalReceivedForItem + 0.0001) {
            throw new BadRequestException(
              `Return qty (${(alreadyReturned + attemptQty).toFixed(4)}) exceeds received qty (${totalReceivedForItem.toFixed(4)}) for item '${retLine.itemId}'`
            );
          }
        }
      }

      if (!resolvedWarehouseId) {
        throw new BadRequestException('warehouseId or goodsReceiptId is required to process purchase return');
      }

      let totalReturnAmount = 0;

      const preparedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const cost = parseFloat(l.unitCost);
        const total = qty * cost;
        totalReturnAmount += total;
        return {
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: total.toFixed(4),
        };
      });

      const [ret] = await tx
        .insert(purchaseReturns)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          goodsReceiptId: dto.goodsReceiptId || null,
          returnNumber: dto.returnNumber,
          status: PurchaseReturnStatus.COMPLETED,
          reason: dto.reason,
          totalAmount: totalReturnAmount.toFixed(4),
          returnedBy: context.userId,
        })
        .returning();

      if (!ret) throw new Error('Failed to create purchase return');

      const createdLines = await tx
        .insert(purchaseReturnLines)
        .values(
          preparedLines.map((l) => ({
            tenantId: context.tenantId,
            returnId: ret.id,
            itemId: l.itemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
          }))
        )
        .returning();

      // Deduct returned stock via InventoryService
      for (const l of preparedLines) {
        let uomId = l.uomId;
        if (!uomId) {
          const [item] = await tx
            .select({ baseUomId: items.baseUomId })
            .from(items)
            .where(and(eq(items.tenantId, context.tenantId), eq(items.id, l.itemId)))
            .limit(1);
          if (!item) {
            throw new NotFoundException(`Item '${l.itemId}' not found`);
          }
          uomId = item.baseUomId;
        }

        await this.inventoryService.issueStock(
          context,
          {
            legalEntityId: dto.legalEntityId,
            warehouseId: resolvedWarehouseId,
            itemId: l.itemId,
            uomId,
            quantity: l.quantity,
            movementType: MovementType.SUPPLIER_RETURN,
            sourceType: 'PURCHASE_RETURN',
            sourceId: ret.id,
            sourceDocumentNumber: dto.returnNumber,
            notes: dto.reason,
          },
          tx
        );
      }

      // Adjust supplier balance (debit balance / reduce debt) with row lock
      const [bal] = await tx
        .select()
        .from(supplierBalances)
        .where(
          and(
            eq(supplierBalances.tenantId, context.tenantId),
            eq(supplierBalances.legalEntityId, dto.legalEntityId),
            eq(supplierBalances.supplierId, dto.supplierId)
          )
        )
        .for('update')
        .limit(1);

      if (bal) {
        const newBal = (parseFloat(bal.currentBalance) - totalReturnAmount).toFixed(4);

        await tx
          .update(supplierBalances)
          .set({ currentBalance: newBal, updatedAt: new Date() })
          .where(eq(supplierBalances.id, bal.id));
      } else if (totalReturnAmount > 0.0001) {
        await tx.insert(supplierBalances).values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          currentBalance: (-totalReturnAmount).toFixed(4),
          totalInvoiced: '0.0000',
          totalPaid: '0.0000',
        });
      }

      // Post Purchase Return Journal Entry via PostingEngine (Dr Accounts Payable, Cr Inventory)
      if (totalReturnAmount > 0.0001) {
        await this.postingEngineService.postEntry(
          context,
          {
            legalEntityId: dto.legalEntityId,
            journalNumber: `JV-PRET-${dto.returnNumber}`,
            journalType: JournalType.GENERAL,
            sourceType: 'purchase_return',
            sourceId: ret.id,
            description: `Purchase Return ${dto.returnNumber}: ${dto.reason}`,
            lines: [
              {
                mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
                partnerRole: 'SUPPLIER',
                subledgerDocumentType: 'PURCHASE_RETURN',
                subledgerDocumentId: ret.id,
                debit: totalReturnAmount.toFixed(4),
                credit: '0.0000',
                currency: 'SAR',
                description: `AP Debit for Purchase Return ${dto.returnNumber}`,
              },
              {
                mappingKey: DefaultAccountMappingKey.INVENTORY,
                debit: '0.0000',
                credit: totalReturnAmount.toFixed(4),
                currency: 'SAR',
                description: `Inventory Return Credit ${dto.returnNumber}`,
              },
            ],
          },
          tx
        );
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_RETURN_POSTED',
          entityType: 'purchase_return',
          entityId: ret.id,
          afterState: { ret, lines: createdLines },
        },
        tx
      );

      return { ...ret, lines: createdLines };
    });
  }

  async getSupplierBalance(
    context: TenantContext,
    legalEntityId: string,
    supplierId: string
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [bal] = await tx
        .select()
        .from(supplierBalances)
        .where(
          and(
            eq(supplierBalances.tenantId, context.tenantId),
            eq(supplierBalances.legalEntityId, legalEntityId),
            eq(supplierBalances.supplierId, supplierId)
          )
        )
        .limit(1);

      return (
        bal ?? {
          legalEntityId,
          supplierId,
          currentBalance: '0.0000',
          totalInvoiced: '0.0000',
          totalPaid: '0.0000',
        }
      );
    });
  }

  // ==================================================================
  // 6. Supplier Payments (AP Settlement & Cash/Bank Outflow)
  // ==================================================================

  async createSupplierPayment(context: TenantContext, dto: CreateSupplierPaymentRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Check duplicate payment number
      const [existing] = await tx
        .select({ id: supplierPayments.id })
        .from(supplierPayments)
        .where(
          and(
            eq(supplierPayments.tenantId, context.tenantId),
            eq(supplierPayments.legalEntityId, dto.legalEntityId),
            eq(supplierPayments.paymentNumber, dto.paymentNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Supplier payment number '${dto.paymentNumber}' already exists`
        );
      }

      const paymentAmt = parseFloat(dto.amount);
      if (paymentAmt <= 0) {
        throw new BadRequestException('Payment amount must be greater than zero');
      }

      // 2. Validate AP Balance and guard against overpayment (with row lock)
      const [bal] = await tx
        .select()
        .from(supplierBalances)
        .where(
          and(
            eq(supplierBalances.tenantId, context.tenantId),
            eq(supplierBalances.legalEntityId, dto.legalEntityId),
            eq(supplierBalances.supplierId, dto.supplierId)
          )
        )
        .for('update')
        .limit(1);

      if (bal) {
        const curBal = parseFloat(bal.currentBalance);
        if (paymentAmt > curBal + 0.0001) {
          throw new BadRequestException(
            `Payment amount (${paymentAmt.toFixed(2)}) exceeds outstanding supplier balance (${curBal.toFixed(2)})`
          );
        }
      }

      // 3. If linked to an invoice, lock and validate remaining invoice amount
      let targetInvoice: any = null;
      if (dto.invoiceId) {
        const [inv] = await tx
          .select()
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.tenantId, context.tenantId),
              eq(supplierInvoices.id, dto.invoiceId)
            )
          )
          .for('update')
          .limit(1);

        if (!inv) {
          throw new NotFoundException(`Supplier invoice '${dto.invoiceId}' not found`);
        }

        if (inv) {
          targetInvoice = inv;
          const prevPaid = parseFloat(inv.paidAmount || '0');
          const invGrandTotal = parseFloat(inv.grandTotal);
          const remainingDue = invGrandTotal - prevPaid;
          if (paymentAmt > remainingDue + 0.0001) {
            throw new BadRequestException(
              `Payment amount (${paymentAmt.toFixed(2)}) exceeds remaining unpaid invoice amount (${remainingDue.toFixed(2)})`
            );
          }
        }
      }

      // 4. Insert payment record
      const [payment] = await tx
        .insert(supplierPayments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          invoiceId: dto.invoiceId || null,
          paymentNumber: dto.paymentNumber,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber || null,
          notes: dto.notes || null,
          paidBy: context.userId,
        })
        .returning();

      if (!payment) throw new Error('Failed to record supplier payment');

      // 5. Atomically update Supplier AP Balance
      if (bal) {
        const curBal = parseFloat(bal.currentBalance);
        const curPaid = parseFloat(bal.totalPaid);

        const newBal = Math.max(0, curBal - paymentAmt).toFixed(4);
        const newPaid = (curPaid + paymentAmt).toFixed(4);

        await tx
          .update(supplierBalances)
          .set({
            currentBalance: newBal,
            totalPaid: newPaid,
            updatedAt: new Date(),
          })
          .where(eq(supplierBalances.id, bal.id));
      }

      // 6. If linked to an invoice, update paidAmount and status
      if (targetInvoice) {
        const prevPaid = parseFloat(targetInvoice.paidAmount || '0');
        const totalPaidForInv = prevPaid + paymentAmt;
        const invGrandTotal = parseFloat(targetInvoice.grandTotal);
        const newStatus =
          totalPaidForInv >= invGrandTotal - 0.0001
            ? SupplierInvoiceStatus.PAID
            : SupplierInvoiceStatus.PARTIALLY_PAID;

        await tx
          .update(supplierInvoices)
          .set({
            paidAmount: totalPaidForInv.toFixed(4),
            status: newStatus,
          })
          .where(eq(supplierInvoices.id, targetInvoice.id));
      }

      // 7. Post Supplier Payment Journal Entry via PostingEngine (Dr Accounts Payable, Cr Cash/Bank)
      const cashOrBankKey =
        dto.paymentMethod === 'CASH'
          ? DefaultAccountMappingKey.CASH_VAULT
          : DefaultAccountMappingKey.BANK;

      await this.postingEngineService.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          journalNumber: `JV-PMT-${dto.paymentNumber}`,
          journalType: JournalType.GENERAL,
          sourceType: 'supplier_payment',
          sourceId: payment.id,
          description: `Supplier Payment ${dto.paymentNumber}`,
          lines: [
            {
              mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
              partnerRole: 'SUPPLIER',
              subledgerDocumentType: 'SUPPLIER_PAYMENT',
              subledgerDocumentId: payment.id,
              debit: paymentAmt.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `AP Settlement to Supplier ${dto.supplierId}`,
            },
            {
              mappingKey: cashOrBankKey,
              debit: '0.0000',
              credit: paymentAmt.toFixed(4),
              currency: 'SAR',
              description: `Cash/Bank Disbursement for Payment ${dto.paymentNumber}`,
            },
          ],
        },
        tx
      );

      // 8. Audit Log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SUPPLIER_PAYMENT_RECORDED',
          entityType: 'supplier_payment',
          entityId: payment.id,
          afterState: payment,
        },
        tx
      );

      return payment;
    });
  }

  async cancelSupplierPayment(
    context: TenantContext,
    paymentId: string,
    reason: string
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [payment] = await tx
        .select()
        .from(supplierPayments)
        .where(
          and(
            eq(supplierPayments.tenantId, context.tenantId),
            eq(supplierPayments.id, paymentId)
          )
        )
        .for('update')
        .limit(1);

      if (!payment) {
        throw new NotFoundException(`Supplier payment '${paymentId}' not found`);
      }

      // Financial Integrity Checks: Prevent double cancellation & reject already reconciled payments
      if (payment.notes && payment.notes.includes('[CANCELLED')) {
        throw new BadRequestException(`Supplier payment '${payment.paymentNumber}' has already been cancelled`);
      }

      if (
        payment.notes &&
        (payment.notes.includes('[BANK_RECONCILED]') || payment.notes.includes('[CLEARED]'))
      ) {
        throw new BadRequestException(
          `Cannot cancel supplier payment '${payment.paymentNumber}': payment has already been cleared or reconciled in bank statements. Please reverse bank reconciliation before voiding payment.`
        );
      }

      const paymentAmt = parseFloat(payment.amount);

      // Revert Supplier AP Balance
      const [bal] = await tx
        .select()
        .from(supplierBalances)
        .where(
          and(
            eq(supplierBalances.tenantId, context.tenantId),
            eq(supplierBalances.legalEntityId, payment.legalEntityId),
            eq(supplierBalances.supplierId, payment.supplierId)
          )
        )
        .limit(1);

      if (bal) {
        const curBal = parseFloat(bal.currentBalance);
        const curPaid = parseFloat(bal.totalPaid);

        await tx
          .update(supplierBalances)
          .set({
            currentBalance: (curBal + paymentAmt).toFixed(4),
            totalPaid: Math.max(0, curPaid - paymentAmt).toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(supplierBalances.id, bal.id));
      }

      // Revert Invoice paidAmount and status
      if (payment.invoiceId) {
        const [inv] = await tx
          .select()
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, payment.invoiceId))
          .limit(1);

        if (inv) {
          const curInvPaid = parseFloat(inv.paidAmount || '0');
          const newInvPaid = Math.max(0, curInvPaid - paymentAmt);
          const newStatus =
            newInvPaid <= 0
              ? SupplierInvoiceStatus.APPROVED
              : SupplierInvoiceStatus.PARTIALLY_PAID;

          await tx
            .update(supplierInvoices)
            .set({
              paidAmount: newInvPaid.toFixed(4),
              status: newStatus,
            })
            .where(eq(supplierInvoices.id, inv.id));
        }
      }

      // Reversal Journal Entry via PostingEngine
      const cashOrBankKey =
        payment.paymentMethod === 'CASH'
          ? DefaultAccountMappingKey.CASH_VAULT
          : DefaultAccountMappingKey.BANK;

      await this.postingEngineService.postEntry(
        context,
        {
          legalEntityId: payment.legalEntityId,
          journalNumber: `JV-REV-PMT-${payment.paymentNumber}`,
          journalType: JournalType.GENERAL,
          sourceType: 'supplier_payment_cancellation',
          sourceId: payment.id,
          description: `Payment Cancellation Reversal ${payment.paymentNumber}`,
          lines: [
            {
              mappingKey: cashOrBankKey,
              debit: paymentAmt.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `Payment Cancellation Reversal ${payment.paymentNumber}`,
            },
            {
              mappingKey: DefaultAccountMappingKey.ACCOUNTS_PAYABLE,
              partnerRole: 'SUPPLIER',
              subledgerDocumentType: 'SUPPLIER_PAYMENT_CANCELLATION',
              subledgerDocumentId: payment.id,
              debit: '0.0000',
              credit: paymentAmt.toFixed(4),
              currency: 'SAR',
              description: `AP Liability Restitution for ${payment.paymentNumber}`,
            },
          ],
        },
        tx
      );

      // Mark payment notes with cancellation reason
      const [updatedPayment] = await tx
        .update(supplierPayments)
        .set({
          notes: `[CANCELLED: ${reason}] ${payment.notes || ''}`.trim(),
        })
        .where(eq(supplierPayments.id, payment.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SUPPLIER_PAYMENT_CANCELLED',
          entityType: 'supplier_payment',
          entityId: payment.id,
          afterState: { updatedPayment, reason },
        },
        tx
      );

      return updatedPayment;
    });
  }
}
