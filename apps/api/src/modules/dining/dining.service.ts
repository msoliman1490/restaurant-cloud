import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  diningTables,
  tableSessions,
  orderLineModifiers,
  orderVoids,
  salesOrders,
  orderLines,
} from '@restaurant-cloud/database';
import {
  CreateDiningTable,
  OpenTableSession,
  AddOrderLineModifier,
  VoidOrderLine,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TableStatus } from '@restaurant-cloud/domain-kernel';
import { eq, and, desc, asc } from 'drizzle-orm';

@Injectable()
export class DiningService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  // ==================================================================
  // 1. Dining Tables Management
  // ==================================================================

  async createTable(context: TenantContext, dto: CreateDiningTable) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.branchId, dto.branchId),
            eq(diningTables.tableNumber, dto.tableNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Table number '${dto.tableNumber}' already exists in this branch`
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

      return table;
    });
  }

  async getTablesByBranch(context: TenantContext, branchId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.branchId, branchId)
          )
        )
        .orderBy(asc(diningTables.tableNumber));
    });
  }

  async updateTableStatus(
    context: TenantContext,
    tableId: string,
    status: TableStatus,
    currentOrderId?: string | null
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
            eq(diningTables.id, tableId)
          )
        )
        .returning();

      if (!updated) throw new NotFoundException(`Table '${tableId}' not found`);
      return updated;
    });
  }

  // ==================================================================
  // 2. Table Sessions (Guest Seating & Server Assignment)
  // ==================================================================

  async openTableSession(context: TenantContext, dto: OpenTableSession) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Check table is available
      const [table] = await tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.tableId)
          )
        )
        .limit(1);

      if (!table) throw new NotFoundException(`Table '${dto.tableId}' not found`);

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

      // Mark table as OCCUPIED
      await tx
        .update(diningTables)
        .set({ status: TableStatus.OCCUPIED })
        .where(eq(diningTables.id, dto.tableId));

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
            eq(tableSessions.id, sessionId)
          )
        )
        .limit(1);

      if (!session) throw new NotFoundException(`Session '${sessionId}' not found`);

      const [closed] = await tx
        .update(tableSessions)
        .set({ closedAt: new Date() })
        .where(eq(tableSessions.id, sessionId))
        .returning();

      // Reset table status to AVAILABLE
      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(eq(diningTables.id, session.tableId));

      return closed;
    });
  }

  // ==================================================================
  // 3. Line Modifiers (Add-ons, notes, kitchen instructions)
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

  // ==================================================================
  // 4. Voids & Manager Authorizations
  // ==================================================================

  async recordVoid(context: TenantContext, dto: VoidOrderLine) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Voids require manager approval
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
        tx
      );

      return voidRecord;
    });
  }

  // ==================================================================
  // 5. Bill Splitting Calculator
  // ==================================================================

  calculateSplitBill(totalAmount: number, splitCount: number) {
    if (splitCount <= 0) throw new BadRequestException('Split count must be at least 1');

    const equalAmount = Math.floor((totalAmount / splitCount) * 100) / 100;
    const remainder = Math.round((totalAmount - equalAmount * splitCount) * 100) / 100;

    const shares: number[] = [];
    for (let i = 0; i < splitCount; i++) {
      // Add pennies remainder to the first share
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
