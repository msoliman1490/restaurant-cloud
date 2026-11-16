import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SalesService } from '../sales/sales.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { DocumentNumberingService } from '../../common/operations/document-numbering.service';
import {
  diningTables,
  tableSessions,
  orderLineModifiers,
  orderVoids,
  salesOrders,
  orderLines,
  kitchenTickets,
  items,
  branches,
} from '@restaurant-cloud/database';
import {
  CreateDiningTable,
  OpenTableSession,
  AddOrderLineModifier,
  VoidOrderLine,
  CreateSalesOrderRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  TableStatus,
  OrderType,
  OrderChannel,
  OrderStatus,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, desc, asc, isNull, inArray } from 'drizzle-orm';

export interface TableOrderLineInput {
  itemId: string;
  quantity: number;
  uomId?: string;
  unitPrice?: number;
  notes?: string;
  modifiers?: Array<{
    modifierNameAr: string;
    modifierNameEn: string;
    priceDelta?: string;
    quantity?: number;
  }>;
}

export interface UpsertTableOrderInput {
  legalEntityId: string;
  branchId: string;
  deviceId: string;
  shiftId?: string;
  station?: string;
  notes?: string;
  idempotencyKey?: string;
  lines: TableOrderLineInput[];
}

export interface CheckoutTableOrderInput {
  legalEntityId: string;
  branchId: string;
  deviceId: string;
  shiftId?: string;
  warehouseId?: string;
  idempotencyKey?: string;
  payments: Array<{
    paymentMethod: string;
    amount: string;
    providerCode?: string;
    providerTransactionRef?: string;
  }>;
}

@Injectable()
export class DiningService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly salesService: SalesService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly documentNumbering: DocumentNumberingService,
  ) {}

  // ==================================================================
  // 1. Dining Tables Management
  // ==================================================================

  async createTable(context: TenantContext, dto: CreateDiningTable) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { branchId: dto.branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, dto.branchId)))
        .limit(1);
      if (!branch) {
        throw new NotFoundException(`Branch '${dto.branchId}' not found`);
      }

      const [existing] = await tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.branchId, dto.branchId),
            eq(diningTables.tableNumber, dto.tableNumber),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Table number '${dto.tableNumber}' already exists in this branch`,
        );
      }

      const [table] = await tx
        .insert(diningTables)
        .values({
          tenantId: context.tenantId,
          branchId: dto.branchId,
          tableNumber: dto.tableNumber,
          section: dto.section || 'MAIN',
          capacity: dto.capacity || 4,
          status: TableStatus.AVAILABLE,
        })
        .returning();

      if (!table) throw new Error('Failed to create dining table');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DINING_TABLE_CREATED',
          entityType: 'dining_table',
          entityId: table.id,
          afterState: table,
        },
        tx,
      );

      return table;
    });
  }

  async getTablesByBranch(context: TenantContext, branchId: string) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const tables = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.branchId, branchId),
          ),
        )
        .orderBy(asc(diningTables.tableNumber));

      const openSessions = await tx
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.branchId, branchId),
            isNull(tableSessions.closedAt),
          ),
        );

      const sessionByTable = new Map(openSessions.map((s) => [s.tableId, s]));

      const orderIds = tables.map((t) => t.currentOrderId).filter(Boolean) as string[];
      const orderMap = new Map<string, any>();
      if (orderIds.length > 0) {
        const orders = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, context.tenantId),
              inArray(salesOrders.id, orderIds),
            ),
          );
        for (const o of orders) {
          orderMap.set(o.id, o);
        }
      }

      return tables.map((t) => {
        const sess = sessionByTable.get(t.id);
        const ord = t.currentOrderId ? orderMap.get(t.currentOrderId) : null;
        return {
          ...t,
          activeSessionId: sess?.id || null,
          guestCount: sess?.guestCount || null,
          openedAt: sess?.openedAt || null,
          activeOrderTotal: ord ? Number(ord.grandTotal) : 0,
          activeOrderNumber: ord?.orderNumber || null,
        };
      });
    });
  }

  async updateTableStatus(
    context: TenantContext,
    tableId: string,
    status: TableStatus,
    currentOrderId?: string | null,
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [updated] = await tx
        .update(diningTables)
        .set({
          status,
          currentOrderId: currentOrderId !== undefined ? currentOrderId : undefined,
        })
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, tableId),
          ),
        )
        .returning();

      if (!updated) throw new NotFoundException(`Table '${tableId}' not found`);
      return updated;
    });
  }

  // ==================================================================
  // 2. Table Sessions (Guest Seating & Concurrency-Safe Open/Close)
  // ==================================================================

  async openTableSession(context: TenantContext, dto: OpenTableSession) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { branchId: dto.branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [table] = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.tableId),
            eq(diningTables.branchId, dto.branchId),
          ),
        )
        .for('update')
        .limit(1);

      if (!table) throw new NotFoundException(`Table '${dto.tableId}' not found in branch`);

      if (table.status === TableStatus.OCCUPIED) {
        throw new ConflictException(`Table '${table.tableNumber}' is already OCCUPIED`);
      }

      const [existingOpenSession] = await tx
        .select({ id: tableSessions.id })
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.tableId, dto.tableId),
            isNull(tableSessions.closedAt),
          ),
        )
        .limit(1);

      if (existingOpenSession) {
        throw new ConflictException(`Table '${table.tableNumber}' already has an open session`);
      }

      const [session] = await tx
        .insert(tableSessions)
        .values({
          tenantId: context.tenantId,
          branchId: dto.branchId,
          tableId: dto.tableId,
          guestCount: dto.guestCount,
          serverUserId: dto.serverUserId || context.userId,
        })
        .returning();

      if (!session) throw new Error('Failed to open table session');

      await tx
        .update(diningTables)
        .set({ status: TableStatus.OCCUPIED })
        .where(eq(diningTables.id, dto.tableId));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'TABLE_SESSION_OPENED',
          entityType: 'table_session',
          entityId: session.id,
          afterState: session,
        },
        tx,
      );

      return session;
    });
  }

  async closeTableSession(context: TenantContext, sessionId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [session] = await tx
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.id, sessionId),
          ),
        )
        .for('update')
        .limit(1);

      if (!session) throw new NotFoundException(`Session '${sessionId}' not found`);
      if (session.closedAt) {
        throw new ConflictException(`Session '${sessionId}' is already closed`);
      }

      if (session.orderId) {
        const [linkedOrder] = await tx
          .select({ id: salesOrders.id, status: salesOrders.status })
          .from(salesOrders)
          .where(eq(salesOrders.id, session.orderId))
          .limit(1);

        if (linkedOrder && linkedOrder.status === 'OPEN') {
          throw new ConflictException('لا يمكن إغلاق الطاولة قبل سداد أو إلغاء الطلب المفتوح');
        }
      }

      const [closed] = await tx
        .update(tableSessions)
        .set({ closedAt: new Date() })
        .where(eq(tableSessions.id, sessionId))
        .returning();

      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(eq(diningTables.id, session.tableId));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'TABLE_SESSION_CLOSED',
          entityType: 'table_session',
          entityId: sessionId,
          afterState: closed,
        },
        tx,
      );

      return closed;
    });
  }

  // ==================================================================
  // 3. Dine-In Orders, Items, Modifiers & Automatic Kitchen Ticket
  // ==================================================================

  async createOrAppendTableOrder(
    context: TenantContext,
    tableId: string,
    dto: UpsertTableOrderInput,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('يجب إضافة صنف واحد على الأقل للطلب');
    }
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingTicket] = await tx
          .select()
          .from(kitchenTickets)
          .where(
            and(
              eq(kitchenTickets.tenantId, context.tenantId),
              eq(kitchenTickets.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (existingTicket) {
          const [existingOrder] = await tx
            .select()
            .from(salesOrders)
            .where(eq(salesOrders.id, existingTicket.orderId))
            .limit(1);
          return { order: existingOrder, kitchenTicket: existingTicket };
        }
      }

      const [table] = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, tableId),
            eq(diningTables.branchId, dto.branchId),
          ),
        )
        .for('update')
        .limit(1);

      if (!table) throw new NotFoundException(`Table '${tableId}' not found`);
      if (table.status !== TableStatus.OCCUPIED) {
        throw new ConflictException('يجب فتح جلسة للطاولة قبل إضافة الطلبات');
      }

      const [activeSession] = await tx
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.tableId, tableId),
            isNull(tableSessions.closedAt),
          ),
        )
        .limit(1);

      let orderId = table.currentOrderId;
      let currentOrder: any = null;

      if (orderId) {
        const [found] = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, orderId))
          .for('update')
          .limit(1);
        if (found && found.status === 'OPEN') {
          currentOrder = found;
        } else {
          orderId = null;
        }
      }

      if (!currentOrder) {
        const alloc = await this.documentNumbering.allocateNextNumber(context, {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          documentType: 'POS_TRANSACTION',
          sourceType: 'sales_orders',
        });
        const orderNumber = alloc.formattedNumber;
        const [created] = await tx
          .insert(salesOrders)
          .values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            branchId: dto.branchId,
            deviceId: dto.deviceId,
            shiftId: dto.shiftId || null,
            tableId,
            orderNumber,
            orderType: OrderType.DINE_IN,
            channel: OrderChannel.POS,
            status: 'OPEN',
            currency: 'SAR',
            subtotal: '0.0000',
            discountTotal: '0.0000',
            taxTotal: '0.0000',
            grandTotal: '0.0000',
            notes: dto.notes || null,
          })
          .returning();
        if (!created) throw new Error('Failed to create dine-in order');
        currentOrder = created;
        orderId = created.id;

        await tx
          .update(diningTables)
          .set({ currentOrderId: orderId })
          .where(eq(diningTables.id, tableId));

        if (activeSession) {
          await tx
            .update(tableSessions)
            .set({ orderId })
            .where(eq(tableSessions.id, activeSession.id));
        }
      }

      const snapshotItems: Array<{
        itemId: string;
        itemName: string;
        quantity: number;
        modifiers: string[];
        notes?: string;
      }> = [];

      for (const line of dto.lines) {
        if (line.quantity <= 0) {
          throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
        }
        const [catalogItem] = await tx
          .select()
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.itemId)))
          .limit(1);

        if (!catalogItem) {
          throw new NotFoundException(`Item '${line.itemId}' not found`);
        }

        const uomId = line.uomId || catalogItem.baseUomId;
        const unitPrice = line.unitPrice !== undefined ? line.unitPrice : Number(catalogItem.defaultPrice);
        const taxRate = Number(catalogItem.taxRate ?? 0.15);

        let modTotal = 0;
        const modNames: string[] = [];
        for (const mod of line.modifiers || []) {
          const delta = Number(mod.priceDelta || 0);
          const mQty = mod.quantity || 1;
          modTotal += delta * mQty;
          modNames.push(mod.modifierNameAr);
        }

        const lineSubtotal = line.quantity * unitPrice + modTotal;
        const lineTax = lineSubtotal * taxRate;
        const lineTotal = lineSubtotal + lineTax;

        const [insertedLine] = await tx
          .insert(orderLines)
          .values({
            orderId: orderId!,
            itemId: catalogItem.id,
            quantity: line.quantity.toFixed(4),
            uomId,
            unitPrice: unitPrice.toFixed(4),
            discountAmount: '0.0000',
            taxAmount: lineTax.toFixed(4),
            lineTotal: lineTotal.toFixed(4),
          })
          .returning();

        if (!insertedLine) throw new Error('Failed to insert order line');
        for (const mod of line.modifiers || []) {
          await tx.insert(orderLineModifiers).values({
            orderLineId: insertedLine.id,
            modifierNameAr: mod.modifierNameAr,
            modifierNameEn: mod.modifierNameEn,
            priceDelta: Number(mod.priceDelta || 0).toFixed(4),
            quantity: mod.quantity || 1,
          });
        }

        snapshotItems.push({
          itemId: catalogItem.id,
          itemName: catalogItem.nameAr,
          quantity: line.quantity,
          modifiers: modNames,
          notes: line.notes,
        });
      }

      // Recalculate order totals from all lines
      const allLines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, orderId!));

      let sumTax = 0;
      let sumGrand = 0;
      for (const l of allLines) {
        sumTax += Number(l.taxAmount);
        sumGrand += Number(l.lineTotal);
      }
      const sumSub = sumGrand - sumTax;

      const [updatedOrder] = await tx
        .update(salesOrders)
        .set({
          subtotal: sumSub.toFixed(4),
          taxTotal: sumTax.toFixed(4),
          grandTotal: sumGrand.toFixed(4),
        })
        .where(eq(salesOrders.id, orderId!))
        .returning();

      // Create Kitchen Ticket for newly added items
      const ticketNum = `KDS-${Date.now().toString(36).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`;
      const [ticket] = await tx
        .insert(kitchenTickets)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          orderId: orderId!,
          tableId,
          ticketNumber: ticketNum,
          station: dto.station || 'MAIN_KITCHEN',
          status: 'PENDING',
          itemsSnapshot: snapshotItems,
          notes: dto.notes || null,
          idempotencyKey: dto.idempotencyKey || null,
          createdBy: context.userId,
        })
        .returning();

      if (!updatedOrder || !ticket) throw new Error('Failed to update dine-in order or create kitchen ticket');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DINE_IN_ORDER_ITEMS_ADDED',
          entityType: 'sales_order',
          entityId: orderId!,
          afterState: { orderNumber: updatedOrder.orderNumber, ticketNumber: ticket.ticketNumber, grandTotal: updatedOrder.grandTotal },
        },
        tx,
      );

      return { order: updatedOrder, kitchenTicket: ticket };
    });
  }

  async getTableOrder(context: TenantContext, tableId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [table] = await tx
        .select()
        .from(diningTables)
        .where(and(eq(diningTables.tenantId, context.tenantId), eq(diningTables.id, tableId)))
        .limit(1);

      if (!table) throw new NotFoundException(`Table '${tableId}' not found`);

      const [session] = await tx
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.tableId, tableId),
            isNull(tableSessions.closedAt),
          ),
        )
        .limit(1);

      if (!table.currentOrderId) {
        return { table, session: session || null, order: null, lines: [], kitchenTickets: [] };
      }

      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, table.currentOrderId))
        .limit(1);

      const lines = await tx
        .select({
          id: orderLines.id,
          itemId: orderLines.itemId,
          uomId: orderLines.uomId,
          quantity: orderLines.quantity,
          unitPrice: orderLines.unitPrice,
          taxAmount: orderLines.taxAmount,
          lineTotal: orderLines.lineTotal,
          itemNameAr: items.nameAr,
          itemSku: items.sku,
        })
        .from(orderLines)
        .leftJoin(items, eq(orderLines.itemId, items.id))
        .where(eq(orderLines.orderId, table.currentOrderId));

      const lineIds = lines.map((l) => l.id);
      const modifiers =
        lineIds.length > 0
          ? await tx.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, lineIds))
          : [];

      const tickets = await tx
        .select()
        .from(kitchenTickets)
        .where(and(eq(kitchenTickets.tenantId, context.tenantId), eq(kitchenTickets.orderId, table.currentOrderId)))
        .orderBy(desc(kitchenTickets.sentAt));

      return {
        table,
        session: session || null,
        order: order || null,
        lines: lines.map((l) => ({
          ...l,
          modifiers: modifiers.filter((m) => m.orderLineId === l.id),
        })),
        kitchenTickets: tickets,
      };
    });
  }

  // ==================================================================
  // 4. Transfer & Merge Tables (Deadlock-Safe FOR UPDATE)
  // ==================================================================

  async transferTable(context: TenantContext, sourceTableId: string, targetTableId: string) {
    if (sourceTableId === targetTableId) {
      throw new BadRequestException('لا يمكن نقل الطاولة إلى نفس الطاولة');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const sortedIds = [sourceTableId, targetTableId].sort();
      const lockedRows = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            inArray(diningTables.id, sortedIds),
          ),
        )
        .for('update');

      const sourceTable = lockedRows.find((t) => t.id === sourceTableId);
      const targetTable = lockedRows.find((t) => t.id === targetTableId);

      if (!sourceTable || !targetTable) {
        throw new NotFoundException('إحدى الطاولتين غير موجودة');
      }
      if (sourceTable.branchId !== targetTable.branchId) {
        throw new BadRequestException('يجب أن تكون الطاولتان في نفس الفرع');
      }
      if (sourceTable.status !== TableStatus.OCCUPIED) {
        throw new ConflictException('طاولة المصدر غير مشغولة');
      }
      if (targetTable.status !== TableStatus.AVAILABLE) {
        throw new ConflictException('الطاولة المستهدفة ليست متاحة للنقل');
      }

      await tx
        .update(tableSessions)
        .set({ tableId: targetTableId })
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.tableId, sourceTableId),
            isNull(tableSessions.closedAt),
          ),
        );

      if (sourceTable.currentOrderId) {
        await tx
          .update(salesOrders)
          .set({ tableId: targetTableId })
          .where(eq(salesOrders.id, sourceTable.currentOrderId));

        await tx
          .update(kitchenTickets)
          .set({ tableId: targetTableId })
          .where(eq(kitchenTickets.orderId, sourceTable.currentOrderId));
      }

      const [updatedTarget] = await tx
        .update(diningTables)
        .set({ status: TableStatus.OCCUPIED, currentOrderId: sourceTable.currentOrderId })
        .where(eq(diningTables.id, targetTableId))
        .returning();

      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(eq(diningTables.id, sourceTableId));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DINING_TABLE_TRANSFERRED',
          entityType: 'dining_table',
          entityId: targetTableId,
          afterState: { fromTableId: sourceTableId, toTableId: targetTableId, orderId: sourceTable.currentOrderId },
        },
        tx,
      );

      return updatedTarget;
    });
  }

  async mergeTables(context: TenantContext, sourceTableId: string, targetTableId: string) {
    if (sourceTableId === targetTableId) {
      throw new BadRequestException('لا يمكن دمج الطاولة مع نفسها');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const sortedIds = [sourceTableId, targetTableId].sort();
      const lockedRows = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            inArray(diningTables.id, sortedIds),
          ),
        )
        .for('update');

      const sourceTable = lockedRows.find((t) => t.id === sourceTableId);
      const targetTable = lockedRows.find((t) => t.id === targetTableId);

      if (!sourceTable || !targetTable) {
        throw new NotFoundException('إحدى الطاولتين غير موجودة');
      }
      if (sourceTable.branchId !== targetTable.branchId) {
        throw new BadRequestException('يجب أن تكون الطاولتان في نفس الفرع');
      }
      if (sourceTable.status !== TableStatus.OCCUPIED || targetTable.status !== TableStatus.OCCUPIED) {
        throw new ConflictException('يجب أن تكون كلتا الطاولتين مشغولتين لإتمام الدمج');
      }
      if (!sourceTable.currentOrderId || !targetTable.currentOrderId) {
        throw new BadRequestException('يجب أن تحتوي كلتا الطاولتين على طلب مفتوح لدمجهما');
      }

      const sourceOrderId = sourceTable.currentOrderId;
      const targetOrderId = targetTable.currentOrderId;

      await tx
        .update(orderLines)
        .set({ orderId: targetOrderId })
        .where(eq(orderLines.orderId, sourceOrderId));

      await tx
        .update(kitchenTickets)
        .set({ orderId: targetOrderId, tableId: targetTableId })
        .where(eq(kitchenTickets.orderId, sourceOrderId));

      await tx
        .update(salesOrders)
        .set({ status: 'MERGED', subtotal: '0.0000', taxTotal: '0.0000', grandTotal: '0.0000' })
        .where(eq(salesOrders.id, sourceOrderId));

      const mergedLines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, targetOrderId));

      let sumTax = 0;
      let sumGrand = 0;
      for (const l of mergedLines) {
        sumTax += Number(l.taxAmount);
        sumGrand += Number(l.lineTotal);
      }

      const [updatedTargetOrder] = await tx
        .update(salesOrders)
        .set({
          subtotal: (sumGrand - sumTax).toFixed(4),
          taxTotal: sumTax.toFixed(4),
          grandTotal: sumGrand.toFixed(4),
        })
        .where(eq(salesOrders.id, targetOrderId))
        .returning();

      if (!updatedTargetOrder) throw new Error('Failed to recalculate merged order');

      await tx
        .update(tableSessions)
        .set({ closedAt: new Date() })
        .where(
          and(
            eq(tableSessions.tenantId, context.tenantId),
            eq(tableSessions.tableId, sourceTableId),
            isNull(tableSessions.closedAt),
          ),
        );

      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(eq(diningTables.id, sourceTableId));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DINING_TABLES_MERGED',
          entityType: 'sales_order',
          entityId: targetOrderId,
          afterState: { sourceTableId, targetTableId, sourceOrderId, newGrandTotal: updatedTargetOrder.grandTotal },
        },
        tx,
      );

      return updatedTargetOrder;
    });
  }

  // ==================================================================
  // 5. Kitchen Display System (KDS) Tickets
  // ==================================================================

  async getKitchenTickets(context: TenantContext, branchId: string, status?: string) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, { branchId });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(kitchenTickets.tenantId, context.tenantId),
        eq(kitchenTickets.branchId, branchId),
      ];
      if (status) {
        conditions.push(eq(kitchenTickets.status, status));
      }

      return await tx
        .select()
        .from(kitchenTickets)
        .where(and(...conditions))
        .orderBy(desc(kitchenTickets.sentAt));
    });
  }

  async updateKitchenTicketStatus(
    context: TenantContext,
    ticketId: string,
    nextStatus: 'IN_PREPARATION' | 'READY' | 'SERVED' | 'CANCELLED',
  ) {
    const allowedTransitions: Record<string, string[]> = {
      PENDING: ['IN_PREPARATION', 'CANCELLED'],
      IN_PREPARATION: ['READY', 'CANCELLED'],
      READY: ['SERVED'],
      SERVED: [],
      CANCELLED: [],
    };

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(kitchenTickets)
        .where(and(eq(kitchenTickets.tenantId, context.tenantId), eq(kitchenTickets.id, ticketId)))
        .for('update')
        .limit(1);

      if (!ticket) throw new NotFoundException(`Kitchen ticket '${ticketId}' not found`);

      const allowed = allowedTransitions[ticket.status] || [];
      if (!allowed.includes(nextStatus)) {
        throw new ConflictException(
          `لا يمكن تغيير حالة تذكرة المطبخ من '${ticket.status}' إلى '${nextStatus}'`,
        );
      }

      const now = new Date();
      const [updated] = await tx
        .update(kitchenTickets)
        .set({
          status: nextStatus,
          startedAt: nextStatus === 'IN_PREPARATION' ? now : ticket.startedAt,
          readyAt: nextStatus === 'READY' ? now : ticket.readyAt,
          servedAt: nextStatus === 'SERVED' ? now : ticket.servedAt,
          updatedAt: now,
        })
        .where(eq(kitchenTickets.id, ticketId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'KITCHEN_TICKET_STATUS_UPDATED',
          entityType: 'kitchen_ticket',
          entityId: ticketId,
          afterState: { from: ticket.status, to: nextStatus },
        },
        tx,
      );

      return updated;
    });
  }

  // ==================================================================
  // 6. Table Checkout & Settlement (Via SalesService -> Inventory + PostingEngine)
  // ==================================================================

  async checkoutTableOrder(
    context: TenantContext,
    tableId: string,
    dto: CheckoutTableOrderInput,
  ) {
    const { draftOrder, draftLines, activeSession } = await this.dbService.withTenantContext(
      context,
      async (tx) => {
        const [table] = await tx
          .select()
          .from(diningTables)
          .where(
            and(
              eq(diningTables.tenantId, context.tenantId),
              eq(diningTables.id, tableId),
              eq(diningTables.branchId, dto.branchId),
            ),
          )
          .for('update')
          .limit(1);

        if (!table) throw new NotFoundException(`Table '${tableId}' not found`);
        if (!table.currentOrderId) {
          throw new BadRequestException('لا يوجد طلب مفتوح على هذه الطاولة لإتمام السداد');
        }

        const [order] = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, table.currentOrderId))
          .for('update')
          .limit(1);

        if (!order || order.status !== 'OPEN') {
          throw new ConflictException('تم سداد أو إغلاق طلب هذه الطاولة مسبقاً');
        }

        const lines = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, order.id));

        if (lines.length === 0) {
          throw new BadRequestException('لا يمكن سداد طلب فارغ بدون أصناف');
        }

        const [session] = await tx
          .select()
          .from(tableSessions)
          .where(
            and(
              eq(tableSessions.tenantId, context.tenantId),
              eq(tableSessions.tableId, tableId),
              isNull(tableSessions.closedAt),
            ),
          )
          .limit(1);

        // Lock draft order against concurrent checkout attempts
        await tx
          .update(salesOrders)
          .set({ status: 'CHECKING_OUT' })
          .where(eq(salesOrders.id, order.id));

        return { draftOrder: order, draftLines: lines, activeSession: session || null };
      },
    );

    if (!dto.warehouseId) {
      throw new BadRequestException('يجب تحديد المستودع لإتمام خصم المخزون والسداد');
    }

    const finalOrderNumber = `POS-${draftOrder.orderNumber}`;
    const salesPayload: CreateSalesOrderRequest = {
      legalEntityId: dto.legalEntityId,
      branchId: dto.branchId,
      deviceId: dto.deviceId,
      shiftId: dto.shiftId,
      warehouseId: dto.warehouseId,
      tableId,
      orderNumber: finalOrderNumber,
      orderType: OrderType.DINE_IN,
      channel: OrderChannel.POS,
      idempotencyKey: dto.idempotencyKey || `checkout-${draftOrder.id}`,
      lines: draftLines.map((l) => ({
        itemId: l.itemId,
        uomId: l.uomId,
        quantity: Number(l.quantity).toFixed(4),
        unitPrice: Number(l.unitPrice).toFixed(4),
        discountAmount: Number(l.discountAmount || 0).toFixed(4),
      })),
      payments: dto.payments.map((p) => ({
        paymentMethod: p.paymentMethod as any,
        amount: p.amount,
        providerCode: p.providerCode,
        providerTransactionRef: p.providerTransactionRef,
      })),
    };

    let settledOrder: any;
    try {
      settledOrder = await this.salesService.createSalesOrder(context, salesPayload);
    } catch (err) {
      await this.dbService.withTenantContext(context, async (tx) => {
        await tx
          .update(salesOrders)
          .set({ status: 'OPEN' })
          .where(and(eq(salesOrders.id, draftOrder.id), eq(salesOrders.status, 'CHECKING_OUT')));
      });
      throw err;
    }

    await this.dbService.withTenantContext(context, async (tx) => {
      await tx
        .update(salesOrders)
        .set({ status: 'CHECKED_OUT' })
        .where(eq(salesOrders.id, draftOrder.id));

      await tx
        .update(kitchenTickets)
        .set({ orderId: settledOrder.id })
        .where(eq(kitchenTickets.orderId, draftOrder.id));

      if (activeSession) {
        await tx
          .update(tableSessions)
          .set({ orderId: settledOrder.id, closedAt: new Date() })
          .where(eq(tableSessions.id, activeSession.id));
      }

      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(eq(diningTables.id, tableId));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DINING_TABLE_CHECKED_OUT',
          entityType: 'sales_order',
          entityId: settledOrder.id,
          afterState: { tableId, draftOrderId: draftOrder.id, settledOrderNumber: settledOrder.orderNumber },
        },
        tx,
      );
    });

    return settledOrder;
  }

  // ==================================================================
  // 7. Line Modifiers, Voids & Split Bill
  // ==================================================================

  async addModifier(context: TenantContext, dto: AddOrderLineModifier) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [modifier] = await tx
        .insert(orderLineModifiers)
        .values({
          orderLineId: dto.orderLineId,
          modifierNameAr: dto.modifierNameAr,
          modifierNameEn: dto.modifierNameEn,
          priceDelta: dto.priceDelta || '0.0000',
          quantity: dto.quantity || 1,
        })
        .returning();

      return modifier;
    });
  }

  async getVoids(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(orderVoids)
        .where(eq(orderVoids.tenantId, context.tenantId))
        .orderBy(desc(orderVoids.voidedAt))
        .limit(50);
    });
  }

  async recordVoid(context: TenantContext, dto: VoidOrderLine) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (!dto.approvedBy) {
        throw new BadRequestException('Order void requires a designated manager approval ID');
      }

      const [voidRecord] = await tx
        .insert(orderVoids)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          orderId: dto.orderId,
          orderLineId: dto.orderLineId || null,
          reason: dto.reason,
          voidAmount: dto.voidAmount,
          voidedBy: context.userId,
          approvedBy: dto.approvedBy,
          notes: dto.notes || null,
        })
        .returning();

      if (!voidRecord) throw new Error('Failed to record order void');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ORDER_VOID_RECORDED',
          entityType: 'order_void',
          entityId: voidRecord.id,
          afterState: voidRecord,
        },
        tx,
      );

      return voidRecord;
    });
  }

  calculateSplitBill(totalAmount: number, splitCount: number) {
    if (splitCount <= 0) throw new BadRequestException('Split count must be at least 1');

    const equalAmount = Math.floor((totalAmount / splitCount) * 100) / 100;
    const remainder = Math.round((totalAmount - equalAmount * splitCount) * 100) / 100;

    const shares: number[] = [];
    for (let i = 0; i < splitCount; i++) {
      if (i === 0) {
        shares.push(Math.round((equalAmount + remainder) * 100) / 100);
      } else {
        shares.push(equalAmount);
      }
    }

    return {
      totalAmount,
      splitCount,
      shares,
    };
  }
}
