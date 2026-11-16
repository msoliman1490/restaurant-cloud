import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import {
  deliveryZones,
  deliveryDrivers,
  deliveryOrders,
  deliveryDriverSettlements,
  branches,
  employees,
  salesOrders,
  cashVaults,
  vaultTransactions,
} from '@restaurant-cloud/database';
import { TenantContext, JournalType, DefaultAccountMappingKey } from '@restaurant-cloud/domain-kernel';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';

function resolvePagination(
  opts?: { page?: number; limit?: number; offset?: number },
  defaultLimit = 100,
  maxLimit = 200,
): { limit: number; offset: number } {
  const rawLimit = opts?.limit;
  const limit =
    rawLimit !== undefined && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), maxLimit)
      : defaultLimit;
  const offset =
    opts?.offset !== undefined && Number.isFinite(opts.offset)
      ? Math.max(Math.floor(opts.offset), 0)
      : opts?.page !== undefined && Number.isFinite(opts.page)
        ? (Math.max(Math.floor(opts.page), 1) - 1) * limit
        : 0;
  return { limit, offset };
}

export interface CreateDeliveryZoneDto {
  legalEntityId: string;
  branchId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  deliveryFee?: number | string;
  minOrderAmount?: number | string;
  estimatedMinutes?: number;
}

export interface CreateDeliveryDriverDto {
  legalEntityId: string;
  branchId: string;
  employeeId?: string;
  driverCode: string;
  fullNameAr: string;
  fullNameEn?: string;
  phone: string;
  vehicleType?: 'MOTORBIKE' | 'CAR' | 'BICYCLE' | 'VAN';
  plateNumber?: string;
}

export interface CreateDeliveryOrderDto {
  legalEntityId: string;
  branchId: string;
  salesOrderId: string;
  zoneId?: string;
  driverId?: string;
  channel?: 'IN_HOUSE' | 'AGGREGATOR' | 'WEB' | 'CALL_CENTER';
  aggregatorName?: string;
  externalReference?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryFee?: number | string;
  codAmount?: number | string;
  notes?: string;
}

export interface SettleDriverCodDto {
  driverId: string;
  cashVaultId: string;
  settledAmount: number | string;
  clearingAccountId?: string;
  varianceAccountId?: string;
  deliveryOrderIds?: string[];
  idempotencyKey?: string;
  notes?: string;
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING_ASSIGNMENT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  PICKED_UP: ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_RETURNED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED_RETURNED'],
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  private async assertBranchBelongsToEntity(
    tx: any,
    tenantId: string,
    legalEntityId: string,
    branchId: string,
  ) {
    const [branch] = await tx
      .select({ id: branches.id, legalEntityId: branches.legalEntityId })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
      .limit(1);

    if (!branch) {
      throw new NotFoundException('الفرع غير موجود');
    }
    if (branch.legalEntityId !== legalEntityId) {
      throw new BadRequestException('الفرع لا ينتمي إلى المنشأة القانونية المحددة');
    }
  }

  // ==================== DELIVERY ZONES ====================

  async createZone(context: TenantContext, dto: CreateDeliveryZoneDto) {
    if (!dto.code?.trim() || !dto.nameAr?.trim()) {
      throw new BadRequestException('رمز المنطقة والاسم العربي مطلوبان');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.assertBranchBelongsToEntity(tx, context.tenantId, dto.legalEntityId, dto.branchId);

      const [existing] = await tx
        .select({ id: deliveryZones.id })
        .from(deliveryZones)
        .where(
          and(
            eq(deliveryZones.tenantId, context.tenantId),
            eq(deliveryZones.branchId, dto.branchId),
            eq(deliveryZones.code, dto.code.trim()),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`رمز منطقة التوصيل مستخدم مسبقاً في هذا الفرع: ${dto.code}`);
      }

      const [created] = await tx
        .insert(deliveryZones)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          code: dto.code.trim(),
          nameAr: dto.nameAr.trim(),
          nameEn: dto.nameEn?.trim() || null,
          deliveryFee: Number(dto.deliveryFee || 0).toFixed(4),
          minOrderAmount: Number(dto.minOrderAmount || 0).toFixed(4),
          estimatedMinutes: dto.estimatedMinutes ?? 45,
          isActive: true,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر إنشاء منطقة التوصيل');
      }

      return created;
    });
  }

  async listZones(context: TenantContext, branchId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(deliveryZones.tenantId, context.tenantId)];
      if (branchId) {
        conditions.push(eq(deliveryZones.branchId, branchId));
      }
      return await tx
        .select()
        .from(deliveryZones)
        .where(and(...conditions))
        .orderBy(deliveryZones.code);
    });
  }

  // ==================== DELIVERY DRIVERS ====================

  async createDriver(context: TenantContext, dto: CreateDeliveryDriverDto) {
    if (!dto.driverCode?.trim() || !dto.fullNameAr?.trim() || !dto.phone?.trim()) {
      throw new BadRequestException('كود السائق والاسم ورقم الجوال مطلوبان');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.assertBranchBelongsToEntity(tx, context.tenantId, dto.legalEntityId, dto.branchId);

      const [dup] = await tx
        .select({ id: deliveryDrivers.id })
        .from(deliveryDrivers)
        .where(
          and(
            eq(deliveryDrivers.tenantId, context.tenantId),
            eq(deliveryDrivers.driverCode, dto.driverCode.trim()),
          ),
        )
        .limit(1);

      if (dup) {
        throw new ConflictException(`كود السائق مستخدم مسبقاً: ${dto.driverCode}`);
      }

      if (dto.employeeId) {
        const [emp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)))
          .limit(1);
        if (!emp) {
          throw new NotFoundException('الموظف المرتبط غير موجود');
        }
      }

      const [created] = await tx
        .insert(deliveryDrivers)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          employeeId: dto.employeeId || null,
          driverCode: dto.driverCode.trim(),
          fullNameAr: dto.fullNameAr.trim(),
          fullNameEn: dto.fullNameEn?.trim() || null,
          phone: dto.phone.trim(),
          vehicleType: dto.vehicleType || 'MOTORBIKE',
          plateNumber: dto.plateNumber?.trim() || null,
          availabilityStatus: 'AVAILABLE',
          isActive: true,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر تسجيل السائق');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DELIVERY_DRIVER_CREATED',
          entityType: 'delivery_driver',
          entityId: created.id,
          afterState: { driverCode: created.driverCode, branchId: created.branchId },
        },
        tx,
      );

      return created;
    });
  }

  async listDrivers(
    context: TenantContext,
    query: { branchId?: string; availabilityStatus?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(deliveryDrivers.tenantId, context.tenantId)];
      if (query.branchId) {
        conditions.push(eq(deliveryDrivers.branchId, query.branchId));
      }
      if (query.availabilityStatus) {
        conditions.push(eq(deliveryDrivers.availabilityStatus, query.availabilityStatus));
      }
      return await tx
        .select()
        .from(deliveryDrivers)
        .where(and(...conditions))
        .orderBy(deliveryDrivers.driverCode);
    });
  }

  async updateDriverStatus(
    context: TenantContext,
    driverId: string,
    dto: { availabilityStatus?: 'AVAILABLE' | 'ON_DELIVERY' | 'OFFLINE'; isActive?: boolean },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(deliveryDrivers)
        .where(and(eq(deliveryDrivers.id, driverId), eq(deliveryDrivers.tenantId, context.tenantId)))
        .limit(1);
      if (!existing) {
        throw new NotFoundException('السائق غير موجود');
      }

      const [updated] = await tx
        .update(deliveryDrivers)
        .set({
          ...(dto.availabilityStatus !== undefined ? { availabilityStatus: dto.availabilityStatus } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(deliveryDrivers.id, driverId))
        .returning();

      return updated;
    });
  }

  // ==================== DELIVERY ORDERS & DISPATCH ====================

  async createDeliveryOrder(context: TenantContext, dto: CreateDeliveryOrderDto) {
    if (!dto.customerName?.trim() || !dto.customerPhone?.trim() || !dto.deliveryAddress?.trim()) {
      throw new BadRequestException('بيانات العميل وعنوان التوصيل مطلوبة');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.assertBranchBelongsToEntity(tx, context.tenantId, dto.legalEntityId, dto.branchId);

      const [order] = await tx
        .select({ id: salesOrders.id, branchId: salesOrders.branchId, legalEntityId: salesOrders.legalEntityId })
        .from(salesOrders)
        .where(and(eq(salesOrders.id, dto.salesOrderId), eq(salesOrders.tenantId, context.tenantId)))
        .limit(1);

      if (!order) {
        throw new NotFoundException('طلب المبيعات غير موجود');
      }
      if (order.branchId !== dto.branchId || order.legalEntityId !== dto.legalEntityId) {
        throw new BadRequestException('طلب المبيعات لا يطابق الفرع أو المنشأة القانونية');
      }

      const [dup] = await tx
        .select({ id: deliveryOrders.id })
        .from(deliveryOrders)
        .where(and(eq(deliveryOrders.tenantId, context.tenantId), eq(deliveryOrders.salesOrderId, dto.salesOrderId)))
        .limit(1);
      if (dup) {
        throw new ConflictException('يوجد سجل توصيل مسبق لهذا الطلب');
      }

      let fee = Number(dto.deliveryFee ?? 0);
      if (dto.zoneId) {
        const [zone] = await tx
          .select()
          .from(deliveryZones)
          .where(and(eq(deliveryZones.id, dto.zoneId), eq(deliveryZones.tenantId, context.tenantId)))
          .limit(1);
        if (!zone || zone.branchId !== dto.branchId) {
          throw new BadRequestException('منطقة التوصيل غير صالحة لهذا الفرع');
        }
        if (dto.deliveryFee === undefined) {
          fee = Number(zone.deliveryFee);
        }
      }

      let initialStatus = 'PENDING_ASSIGNMENT';
      let assignedAt: Date | null = null;
      if (dto.driverId) {
        const [driver] = await tx
          .select()
          .from(deliveryDrivers)
          .where(and(eq(deliveryDrivers.id, dto.driverId), eq(deliveryDrivers.tenantId, context.tenantId)))
          .limit(1);
        if (!driver || !driver.isActive || driver.branchId !== dto.branchId) {
          throw new BadRequestException('السائق غير متاح أو لا يتبع نفس الفرع');
        }
        initialStatus = 'ASSIGNED';
        assignedAt = new Date();
        await tx
          .update(deliveryDrivers)
          .set({ availabilityStatus: 'ON_DELIVERY', updatedAt: new Date() })
          .where(eq(deliveryDrivers.id, driver.id));
      }

      const [created] = await tx
        .insert(deliveryOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          salesOrderId: dto.salesOrderId,
          zoneId: dto.zoneId || null,
          driverId: dto.driverId || null,
          channel: dto.channel || 'IN_HOUSE',
          aggregatorName: dto.aggregatorName?.trim() || null,
          externalReference: dto.externalReference?.trim() || null,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          deliveryAddress: dto.deliveryAddress.trim(),
          deliveryFee: fee.toFixed(4),
          codAmount: Number(dto.codAmount ?? 0).toFixed(4),
          status: initialStatus,
          assignedAt,
          notes: dto.notes || null,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر إنشاء طلب التوصيل');
      }

      return created;
    });
  }

  async listDeliveryOrders(
    context: TenantContext,
    query: {
      branchId?: string;
      driverId?: string;
      status?: string;
      channel?: string;
      page?: number;
      limit?: number;
      offset?: number;
    },
  ) {
    const { limit, offset } = resolvePagination(query, 200, 200);
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(deliveryOrders.tenantId, context.tenantId)];
      if (query.branchId) conditions.push(eq(deliveryOrders.branchId, query.branchId));
      if (query.driverId) conditions.push(eq(deliveryOrders.driverId, query.driverId));
      if (query.status) conditions.push(eq(deliveryOrders.status, query.status));
      if (query.channel) conditions.push(eq(deliveryOrders.channel, query.channel));

      return await tx
        .select()
        .from(deliveryOrders)
        .where(and(...conditions))
        .orderBy(desc(deliveryOrders.createdAt))
        .limit(limit)
        .offset(offset);
    });
  }

  async assignDriver(context: TenantContext, orderId: string, driverId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(deliveryOrders)
        .where(and(eq(deliveryOrders.id, orderId), eq(deliveryOrders.tenantId, context.tenantId)))
        .limit(1);
      if (!order) {
        throw new NotFoundException('طلب التوصيل غير موجود');
      }
      if (!['PENDING_ASSIGNMENT', 'ASSIGNED'].includes(order.status)) {
        throw new BadRequestException(`لا يمكن إسناد سائق في الحالة الحالية: ${order.status}`);
      }

      const [driver] = await tx
        .select()
        .from(deliveryDrivers)
        .where(and(eq(deliveryDrivers.id, driverId), eq(deliveryDrivers.tenantId, context.tenantId)))
        .limit(1);
      if (!driver || !driver.isActive) {
        throw new NotFoundException('السائق غير موجود أو غير نشط');
      }
      if (driver.branchId !== order.branchId) {
        throw new BadRequestException('السائق لا يتبع فرع طلب التوصيل');
      }

      const now = new Date();
      const [updated] = await tx
        .update(deliveryOrders)
        .set({
          driverId: driver.id,
          status: 'ASSIGNED',
          assignedAt: now,
          updatedAt: now,
        })
        .where(eq(deliveryOrders.id, orderId))
        .returning();

      await tx
        .update(deliveryDrivers)
        .set({ availabilityStatus: 'ON_DELIVERY', updatedAt: now })
        .where(eq(deliveryDrivers.id, driver.id));

      return updated;
    });
  }

  async updateOrderStatus(
    context: TenantContext,
    orderId: string,
    dto: { status: string; failedReason?: string; codCollected?: boolean },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(deliveryOrders)
        .where(and(eq(deliveryOrders.id, orderId), eq(deliveryOrders.tenantId, context.tenantId)))
        .limit(1);
      if (!order) {
        throw new NotFoundException('طلب التوصيل غير موجود');
      }

      const allowed = VALID_STATUS_TRANSITIONS[order.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`انتقال حالة غير مسموح من ${order.status} إلى ${dto.status}`);
      }

      const now = new Date();
      const isCodOrder = Number(order.codAmount) > 0;
      const patch: Record<string, unknown> = {
        status: dto.status,
        updatedAt: now,
      };
      if (dto.status === 'PICKED_UP') patch.pickedUpAt = now;
      if (dto.status === 'DELIVERED') {
        patch.deliveredAt = now;
        if (isCodOrder) {
          patch.codCollected = dto.codCollected ?? true;
        }
      }
      if (dto.status === 'FAILED_RETURNED') {
        patch.failedReason = dto.failedReason || 'لم يتم التسليم';
      }

      const [updated] = await tx
        .update(deliveryOrders)
        .set(patch)
        .where(eq(deliveryOrders.id, orderId))
        .returning();

      if (order.driverId && ['DELIVERED', 'FAILED_RETURNED', 'CANCELLED'].includes(dto.status)) {
        const [activeCountRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(deliveryOrders)
          .where(
            and(
              eq(deliveryOrders.tenantId, context.tenantId),
              eq(deliveryOrders.driverId, order.driverId),
              inArray(deliveryOrders.status, ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']),
            ),
          );
        if ((activeCountRow?.count ?? 0) === 0) {
          await tx
            .update(deliveryDrivers)
            .set({ availabilityStatus: 'AVAILABLE', updatedAt: now })
            .where(eq(deliveryDrivers.id, order.driverId));
        }
      }

      return updated;
    });
  }

  // ==================== DRIVER COD CASH SETTLEMENT ====================

  async settleDriverCod(context: TenantContext, dto: SettleDriverCodDto) {
    const settledAmount = Number(dto.settledAmount);
    if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
      throw new BadRequestException('المبلغ المسوّى يجب أن يكون أكبر من صفر');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingSettlement] = await tx
          .select()
          .from(deliveryDriverSettlements)
          .where(
            and(
              eq(deliveryDriverSettlements.tenantId, context.tenantId),
              eq(deliveryDriverSettlements.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (existingSettlement) {
          return existingSettlement;
        }
      }

      const [driver] = await tx
        .select()
        .from(deliveryDrivers)
        .where(and(eq(deliveryDrivers.id, dto.driverId), eq(deliveryDrivers.tenantId, context.tenantId)))
        .limit(1);
      if (!driver) {
        throw new NotFoundException('السائق غير موجود');
      }

      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(
          and(
            eq(cashVaults.id, dto.cashVaultId),
            eq(cashVaults.tenantId, context.tenantId),
            eq(cashVaults.legalEntityId, driver.legalEntityId),
          ),
        )
        .limit(1)
        .for('update');
      if (!vault || vault.status !== 'ACTIVE') {
        throw new NotFoundException('خزينة النقدية غير موجودة أو غير نشطة لهذه المنشأة');
      }

      const orderConditions = [
        eq(deliveryOrders.tenantId, context.tenantId),
        eq(deliveryOrders.driverId, driver.id),
        eq(deliveryOrders.status, 'DELIVERED'),
        eq(deliveryOrders.codCollected, true),
        eq(deliveryOrders.codSettled, false),
      ];
      if (dto.deliveryOrderIds && dto.deliveryOrderIds.length > 0) {
        orderConditions.push(inArray(deliveryOrders.id, dto.deliveryOrderIds));
      }

      const pendingOrders = await tx
        .select()
        .from(deliveryOrders)
        .where(and(...orderConditions))
        .for('update');

      const codOrders = pendingOrders.filter((o) => Number(o.codAmount) > 0);
      if (codOrders.length === 0) {
        throw new BadRequestException('لا توجد طلبات تحصيل نقدي (COD) مفتوحة للتسوية لهذا السائق');
      }

      const expectedCod = codOrders.reduce((acc, o) => acc + Number(o.codAmount), 0);
      const variance = Number((settledAmount - expectedCod).toFixed(4));
      const settlementNumber = `COD-SET-${Date.now().toString().slice(-6)}`;

      const lines: Array<{
        accountId?: string;
        mappingKey?: string;
        branchId?: string | null;
        debit: string;
        credit: string;
        description: string;
      }> = [
        {
          accountId: vault.accountId,
          branchId: driver.branchId,
          debit: settledAmount.toFixed(4),
          credit: '0.0000',
          description: `توريد نقدية توصيل (COD) من السائق ${driver.fullNameAr} إلى ${vault.nameAr}`,
        },
        {
          ...(dto.clearingAccountId
            ? { accountId: dto.clearingAccountId }
            : { mappingKey: DefaultAccountMappingKey.CASH_IN_TRANSIT }),
          branchId: driver.branchId,
          debit: '0.0000',
          credit: expectedCod.toFixed(4),
          description: `إقفال عهدة تحصيل السائق ${driver.driverCode}`,
        },
      ];

      if (Math.abs(variance) > 0.0001) {
        if (variance < 0) {
          lines.push({
            ...(dto.varianceAccountId
              ? { accountId: dto.varianceAccountId }
              : { mappingKey: 'CASH_OVER_SHORT' }),
            branchId: driver.branchId,
            debit: Math.abs(variance).toFixed(4),
            credit: '0.0000',
            description: `عجز تسوية نقدية سائق ${driver.driverCode}`,
          });
        } else {
          lines.push({
            ...(dto.varianceAccountId
              ? { accountId: dto.varianceAccountId }
              : { mappingKey: 'CASH_OVER_SHORT' }),
            branchId: driver.branchId,
            debit: '0.0000',
            credit: variance.toFixed(4),
            description: `زيادة تسوية نقدية سائق ${driver.driverCode}`,
          });
        }
      }

      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: driver.legalEntityId,
          branchId: driver.branchId,
          journalNumber: `JV-${settlementNumber}`,
          journalType: JournalType.GENERAL,
          sourceType: 'delivery_cod_settlement',
          sourceId: driver.id,
          description: `تسوية تحصيل نقدي للسائق ${driver.fullNameAr} (${settlementNumber})`,
          lines,
        },
        tx,
      );

      const [settlement] = await tx
        .insert(deliveryDriverSettlements)
        .values({
          tenantId: context.tenantId,
          legalEntityId: driver.legalEntityId,
          branchId: driver.branchId,
          driverId: driver.id,
          cashVaultId: vault.id,
          settlementNumber,
          expectedCodAmount: expectedCod.toFixed(4),
          settledAmount: settledAmount.toFixed(4),
          varianceAmount: variance.toFixed(4),
          journalEntryId: jv.id,
          idempotencyKey: dto.idempotencyKey || null,
          settledBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (!settlement) {
        throw new BadRequestException('تعذر حفظ تسوية السائق');
      }

      const newVaultBalance = Number(vault.balance) + settledAmount;
      await tx
        .update(cashVaults)
        .set({ balance: newVaultBalance.toFixed(4) })
        .where(eq(cashVaults.id, vault.id));

      await tx.insert(vaultTransactions).values({
        tenantId: context.tenantId,
        vaultId: vault.id,
        transactionType: 'DEPOSIT',
        amount: settledAmount.toFixed(4),
        balanceAfter: newVaultBalance.toFixed(4),
        sourceDocumentType: 'DELIVERY_COD_SETTLEMENT',
        sourceDocumentId: settlement.id,
        notes: `توريد تحصيل توصيل (COD) - ${settlementNumber}`,
        performedBy: context.userId,
      });

      await tx
        .update(deliveryOrders)
        .set({
          codSettled: true,
          settlementId: settlement.id,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            deliveryOrders.id,
            codOrders.map((o) => o.id),
          ),
        );

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DELIVERY_COD_SETTLED',
          entityType: 'delivery_driver_settlement',
          entityId: settlement.id,
          afterState: {
            driverId: driver.id,
            expectedCodAmount: settlement.expectedCodAmount,
            settledAmount: settlement.settledAmount,
            varianceAmount: settlement.varianceAmount,
            journalEntryId: jv.id,
          },
        },
        tx,
      );

      return settlement;
    });
  }

  async listSettlements(
    context: TenantContext,
    driverId?: string,
    pagination?: { page?: number; limit?: number; offset?: number },
  ) {
    const { limit, offset } = resolvePagination(pagination, 100, 200);
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(deliveryDriverSettlements.tenantId, context.tenantId)];
      if (driverId) {
        conditions.push(eq(deliveryDriverSettlements.driverId, driverId));
      }
      return await tx
        .select()
        .from(deliveryDriverSettlements)
        .where(and(...conditions))
        .orderBy(desc(deliveryDriverSettlements.settledAt))
        .limit(limit)
        .offset(offset);
    });
  }
}
