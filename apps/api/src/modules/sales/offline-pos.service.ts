import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { eq, and, sql, ne, inArray } from 'drizzle-orm';
import {
  offlineQuotaLeases,
  inventoryBalances,
  salesOrders,
  devices,
  warehouses,
  recipes,
  recipeIngredients,
} from '@restaurant-cloud/database';
import {
  TenantContext,
  OrderType,
  OrderChannel,
  PaymentMethod,
  RecipeStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  OrderLineInputSchema,
  PaymentInputSchema,
  CreateSalesOrderRequest,
} from '@restaurant-cloud/shared-contracts';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { SalesService } from './sales.service';

export const AllocateOfflineLeaseItemSchema = z.object({
  itemId: z.string().uuid(),
  requestedQty: z.union([
    z.number().positive(),
    z.string().regex(/^\d+(\.\d{1,4})?$/),
  ]),
});

export const AllocateOfflineLeasesSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceEpoch: z.string().uuid(),
  validUntil: z.string().datetime().optional(),
  items: z.array(AllocateOfflineLeaseItemSchema).min(1).max(200),
});
export type AllocateOfflineLeasesDto = z.infer<typeof AllocateOfflineLeasesSchema>;

export const OfflineOrderSyncItemSchema = z.object({
  clientTransactionId: z.string().min(1).max(255),
  idempotencyKey: z.string().min(1).max(255).optional(),
  deviceId: z.string().uuid(),
  deviceEpoch: z.string().uuid(),
  seq: z.number().int().positive(),
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  tableId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  orderNumber: z.string().min(2).max(50),
  orderType: z.nativeEnum(OrderType).default(OrderType.TAKEAWAY),
  channel: z.nativeEnum(OrderChannel).default(OrderChannel.POS),
  invoiceType: z.enum(['STANDARD', 'SIMPLIFIED']).default('SIMPLIFIED'),
  offlineCreatedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(OrderLineInputSchema).min(1),
  payments: z.array(PaymentInputSchema).optional(),
});
export type OfflineOrderSyncItem = z.infer<typeof OfflineOrderSyncItemSchema>;

export const SyncOfflineBatchSchema = z.object({
  orders: z.array(OfflineOrderSyncItemSchema).min(1).max(100),
});
export type SyncOfflineBatchDto = z.infer<typeof SyncOfflineBatchSchema>;

export type OfflineSyncStatus = 'SYNCED' | 'ALREADY_SYNCED' | 'CONFLICT' | 'FAILED';

export interface OfflineOrderSyncResult {
  clientTransactionId: string;
  idempotencyKey: string;
  seq: number;
  status: OfflineSyncStatus;
  orderId?: string;
  orderNumber?: string;
  grandTotal?: string;
  reasonCode?: string;
  message?: string;
}

export interface OfflineBatchSyncResponse {
  summary: {
    total: number;
    synced: number;
    alreadySynced: number;
    conflict: number;
    failed: number;
  };
  results: OfflineOrderSyncResult[];
}

const APPROVED_OFFLINE_PAYMENT_METHODS = new Set<PaymentMethod>([
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.MADA,
  PaymentMethod.VISA_MC,
  PaymentMethod.APPLE_PAY,
  PaymentMethod.POINTS,
  PaymentMethod.CREDIT,
  PaymentMethod.SPLIT,
]);

@Injectable()
export class OfflinePosService {
  private readonly warehouseLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly salesService: SalesService,
  ) {}

  private getHmacSecret(): string {
    return (
      process.env.OFFLINE_LEASE_HMAC_SECRET ||
      process.env.JWT_SECRET ||
      'restaurant-cloud-offline-lease-hmac-dev-key'
    );
  }

  private signLeasePayload(payload: {
    tenantId: string;
    legalEntityId: string;
    warehouseId: string;
    itemId: string;
    deviceId: string;
    deviceEpoch: string;
    allocatedQty: string;
    validUntilIso: string;
  }): string {
    const canonical = [
      payload.tenantId,
      payload.legalEntityId,
      payload.warehouseId,
      payload.itemId,
      payload.deviceId,
      payload.deviceEpoch,
      Number(payload.allocatedQty).toFixed(4),
      new Date(payload.validUntilIso).toISOString(),
    ].join('|');

    return createHmac('sha256', this.getHmacSecret())
      .update(canonical)
      .digest('hex');
  }

  private verifyLeaseSignature(lease: {
    tenantId: string;
    legalEntityId: string;
    warehouseId: string;
    itemId: string;
    deviceId: string;
    deviceEpoch: string;
    allocatedQty: string;
    validUntil: Date;
    signature: string;
  }): boolean {
    const expected = this.signLeasePayload({
      tenantId: lease.tenantId,
      legalEntityId: lease.legalEntityId,
      warehouseId: lease.warehouseId,
      itemId: lease.itemId,
      deviceId: lease.deviceId,
      deviceEpoch: lease.deviceEpoch,
      allocatedQty: lease.allocatedQty,
      validUntilIso: lease.validUntil.toISOString(),
    });

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(lease.signature || '', 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private async withWarehouseLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.warehouseLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.warehouseLocks.set(key, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.warehouseLocks.get(key) === chained) {
        this.warehouseLocks.delete(key);
      }
    }
  }

  /**
   * Computes available stock for an item in a warehouse with FOR UPDATE row locks.
   * Supports both direct inventory items and recipe-backed prepared items.
   */
  private async getLockedAvailableStock(
    tx: any,
    params: {
      tenantId: string;
      legalEntityId: string;
      warehouseId: string;
      itemId: string;
    },
  ): Promise<{ availableQty: number; hasRecord: boolean }> {
    const [bal] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, params.tenantId),
          eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
          eq(inventoryBalances.warehouseId, params.warehouseId),
          eq(inventoryBalances.itemId, params.itemId),
          sql`${inventoryBalances.lotId} IS NULL`,
        ),
      )
      .for('update')
      .limit(1);

    if (bal) {
      const onHand = parseFloat(bal.onHandQty);
      const reserved = parseFloat(bal.reservedQty || '0');
      return {
        availableQty: Math.max(0, onHand - reserved),
        hasRecord: true,
      };
    }

    // Check if item is a recipe-backed menu item
    const [recipe] = await tx
      .select()
      .from(recipes)
      .where(
        and(
          eq(recipes.tenantId, params.tenantId),
          eq(recipes.legalEntityId, params.legalEntityId),
          eq(recipes.outputItemId, params.itemId),
          eq(recipes.isCurrent, true),
          eq(recipes.status, RecipeStatus.ACTIVE),
        ),
      )
      .limit(1);

    if (!recipe) {
      return { availableQty: 0, hasRecord: false };
    }

    const ingredients = await tx
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipe.id));

    if (ingredients.length === 0) {
      return { availableQty: 0, hasRecord: false };
    }

    const sortedIngs = [...ingredients].sort((a, b) =>
      a.ingredientItemId.localeCompare(b.ingredientItemId),
    );
    const yieldQty = parseFloat(recipe.yieldQuantity || '1.0');
    let maxProducible = Infinity;

    for (const ing of sortedIngs) {
      const [ingBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, params.tenantId),
            eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
            eq(inventoryBalances.warehouseId, params.warehouseId),
            eq(inventoryBalances.itemId, ing.ingredientItemId),
            sql`${inventoryBalances.lotId} IS NULL`,
          ),
        )
        .for('update')
        .limit(1);

      if (!ingBal) {
        return { availableQty: 0, hasRecord: true };
      }

      const ingAvail = Math.max(
        0,
        parseFloat(ingBal.onHandQty) - parseFloat(ingBal.reservedQty || '0'),
      );
      const wasteFactor = 1 + parseFloat(ing.wastePercentage || '0') / 100;
      const perUnitNeeded = (parseFloat(ing.quantity) * wasteFactor) / yieldQty;
      if (perUnitNeeded > 0) {
        maxProducible = Math.min(maxProducible, ingAvail / perUnitNeeded);
      }
    }

    return {
      availableQty: Number.isFinite(maxProducible) ? Math.max(0, maxProducible) : 0,
      hasRecord: true,
    };
  }

  /**
   * Allocates or renews offline stock quota leases with HMAC signature and FOR UPDATE locks.
   * Supports unlimited offline duration via explicit validUntil renewal (defaults to far-future if omitted).
   */
  async allocateOrRenewLeases(
    context: TenantContext,
    dto: AllocateOfflineLeasesDto,
  ) {
    // Default to 100 years in the future when validUntil is omitted (unlimited offline duration until explicit renewal/revocation)
    const validUntil = dto.validUntil
      ? new Date(dto.validUntil)
      : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('تاريخ انتهاء صلاحية الحصة (validUntil) يجب أن يكون في المستقبل');
    }

    return await this.withWarehouseLock(
      `${context.tenantId}:${dto.warehouseId}`,
      async () => {
        return await this.dbService.withTenantContext(context, async (tx) => {
          const [device] = await tx
            .select({
              id: devices.id,
              legalEntityId: devices.legalEntityId,
              branchId: devices.branchId,
            })
            .from(devices)
            .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.deviceId)))
            .limit(1);

          if (!device) {
            throw new NotFoundException(`جهاز نقاط البيع '${dto.deviceId}' غير موجود`);
          }
          if (device.legalEntityId !== dto.legalEntityId) {
            throw new BadRequestException('جهاز نقاط البيع لا ينتمي إلى المنشأة القانونية المحددة');
          }
          if (dto.branchId && device.branchId !== dto.branchId) {
            throw new BadRequestException('جهاز نقاط البيع لا ينتمي إلى الفرع المحدد');
          }

          const effectiveBranchId = dto.branchId || device.branchId;
          if (context.userScopes) {
            this.opsFramework.verifyScope(context, context.userScopes, {
              legalEntityId: dto.legalEntityId,
              branchId: effectiveBranchId,
            });
          }

          const [wh] = await tx
            .select({ id: warehouses.id, legalEntityId: warehouses.legalEntityId })
            .from(warehouses)
            .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.warehouseId)))
            .limit(1);

          if (!wh) {
            throw new NotFoundException(`المستودع '${dto.warehouseId}' غير موجود`);
          }
          if (wh.legalEntityId && wh.legalEntityId !== dto.legalEntityId) {
            throw new BadRequestException('المستودع لا ينتمي إلى المنشأة القانونية المحددة');
          }

          // Deduplicate and sort items by itemId to prevent deadlocks
          const itemQtyMap = new Map<string, number>();
          for (const item of dto.items) {
            const qty = typeof item.requestedQty === 'string'
              ? parseFloat(item.requestedQty)
              : item.requestedQty;
            if (!Number.isFinite(qty) || qty <= 0) {
              throw new BadRequestException(`الكمية المطلوبة للمنتج '${item.itemId}' غير صالحة`);
            }
            itemQtyMap.set(item.itemId, (itemQtyMap.get(item.itemId) || 0) + qty);
          }

          const sortedItemIds = Array.from(itemQtyMap.keys()).sort();
          const now = new Date();
          const allocatedLeases = [];

          for (const itemId of sortedItemIds) {
            const requestedQty = itemQtyMap.get(itemId)!;

            // 1. Lock inventory_balances row
            const { availableQty, hasRecord } = await this.getLockedAvailableStock(tx, {
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              warehouseId: dto.warehouseId,
              itemId,
            });

            if (!hasRecord) {
              throw new ConflictException(
                `لا يوجد رصيد مخزون للمنتج '${itemId}' في المستودع '${dto.warehouseId}'`,
              );
            }

            // 2. Lock active offline_quota_leases rows for this warehouse + item
            const activeLeases = await tx
              .select()
              .from(offlineQuotaLeases)
              .where(
                and(
                  eq(offlineQuotaLeases.tenantId, context.tenantId),
                  eq(offlineQuotaLeases.legalEntityId, dto.legalEntityId),
                  eq(offlineQuotaLeases.warehouseId, dto.warehouseId),
                  eq(offlineQuotaLeases.itemId, itemId),
                  eq(offlineQuotaLeases.status, 'ACTIVE'),
                ),
              )
              .for('update');

            // Shared local stock model: account for unconsumed quotas held by other active devices/epochs
            let otherActiveReserved = 0;
            let existingSameEpoch: (typeof activeLeases)[number] | undefined;

            for (const lease of activeLeases) {
              if (lease.deviceId === dto.deviceId && lease.deviceEpoch === dto.deviceEpoch) {
                existingSameEpoch = lease;
              } else if (lease.validUntil > now) {
                const remaining = Math.max(
                  0,
                  parseFloat(lease.allocatedQty) - parseFloat(lease.consumedQty),
                );
                otherActiveReserved += remaining;
              }
            }

            const maxAllocatable = Math.max(0, availableQty - otherActiveReserved);
            if (requestedQty > maxAllocatable + 1e-6) {
              throw new ConflictException(
                `الكمية المطلوبة (${requestedQty}) للمنتج '${itemId}' تتجاوز الرصيد المتاح للحصة (${maxAllocatable.toFixed(4)})`,
              );
            }

            const allocatedQtyStr = requestedQty.toFixed(4);
            const signature = this.signLeasePayload({
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              warehouseId: dto.warehouseId,
              itemId,
              deviceId: dto.deviceId,
              deviceEpoch: dto.deviceEpoch,
              allocatedQty: allocatedQtyStr,
              validUntilIso: validUntil.toISOString(),
            });

            if (existingSameEpoch) {
              const alreadyConsumed = parseFloat(existingSameEpoch.consumedQty);
              if (requestedQty < alreadyConsumed - 1e-6) {
                throw new ConflictException(
                  `لا يمكن تقليص الحصة إلى (${requestedQty}) أقل من الكمية المستهلكة بالفعل (${alreadyConsumed})`,
                );
              }

              const [updated] = await tx
                .update(offlineQuotaLeases)
                .set({
                  allocatedQty: allocatedQtyStr,
                  validUntil,
                  signature,
                  status: 'ACTIVE',
                })
                .where(eq(offlineQuotaLeases.id, existingSameEpoch.id))
                .returning();

              allocatedLeases.push(updated);
            } else {
              // Supersede any older active epoch leases for the same device + warehouse + item
              await tx
                .update(offlineQuotaLeases)
                .set({ status: 'SUPERSEDED' })
                .where(
                  and(
                    eq(offlineQuotaLeases.tenantId, context.tenantId),
                    eq(offlineQuotaLeases.warehouseId, dto.warehouseId),
                    eq(offlineQuotaLeases.itemId, itemId),
                    eq(offlineQuotaLeases.deviceId, dto.deviceId),
                    eq(offlineQuotaLeases.status, 'ACTIVE'),
                    ne(offlineQuotaLeases.deviceEpoch, dto.deviceEpoch),
                  ),
                );

              const [inserted] = await tx
                .insert(offlineQuotaLeases)
                .values({
                  tenantId: context.tenantId,
                  legalEntityId: dto.legalEntityId,
                  warehouseId: dto.warehouseId,
                  itemId,
                  deviceId: dto.deviceId,
                  deviceEpoch: dto.deviceEpoch,
                  allocatedQty: allocatedQtyStr,
                  consumedQty: '0.0000',
                  lastReceivedSeq: 0,
                  validUntil,
                  signature,
                  status: 'ACTIVE',
                })
                .returning();

              allocatedLeases.push(inserted);
            }
          }

          await this.auditService.log(
            {
              tenantId: context.tenantId,
              actorId: context.userId,
              action: 'OFFLINE_QUOTA_LEASE_ALLOCATED',
              entityType: 'offline_quota_lease',
              entityId: dto.deviceId,
              afterState: {
                deviceId: dto.deviceId,
                deviceEpoch: dto.deviceEpoch,
                warehouseId: dto.warehouseId,
                validUntil: validUntil.toISOString(),
                itemCount: allocatedLeases.length,
              },
            },
            tx,
          );

          return allocatedLeases;
        });
      },
    );
  }

  /**
   * Lists active offline quota leases for a device and/or branch.
   */
  async listLeases(
    context: TenantContext,
    filters: {
      deviceId?: string;
      branchId?: string;
      warehouseId?: string;
      status?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(offlineQuotaLeases.tenantId, context.tenantId)];

      if (filters.deviceId) {
        conditions.push(eq(offlineQuotaLeases.deviceId, filters.deviceId));
      }
      if (filters.warehouseId) {
        conditions.push(eq(offlineQuotaLeases.warehouseId, filters.warehouseId));
      }
      const targetStatus = filters.status || 'ACTIVE';
      if (targetStatus !== 'ALL') {
        conditions.push(eq(offlineQuotaLeases.status, targetStatus));
      }

      if (filters.branchId) {
        const branchDevices = await tx
          .select({ id: devices.id })
          .from(devices)
          .where(
            and(
              eq(devices.tenantId, context.tenantId),
              eq(devices.branchId, filters.branchId),
            ),
          );
        const deviceIds = branchDevices.map((d) => d.id);
        if (deviceIds.length === 0) {
          return [];
        }
        conditions.push(inArray(offlineQuotaLeases.deviceId, deviceIds));
      }

      const rows = await tx
        .select()
        .from(offlineQuotaLeases)
        .where(and(...conditions));

      return rows;
    });
  }

  /**
   * Idempotent batch synchronization of offline POS orders.
   * Conflict policy = PREVENT:
   * - Never silently overwrites stock balances or creates duplicate invoices.
   * - Never treats an offline transaction as financially posted until SalesService.createSalesOrder succeeds.
   * - Repeated sync of the same idempotencyKey returns ALREADY_SYNCED without duplicates.
   */
  async syncOfflineBatch(
    context: TenantContext,
    dto: SyncOfflineBatchDto,
  ): Promise<OfflineBatchSyncResponse> {
    const results: OfflineOrderSyncResult[] = [];

    // Process in deterministic sequence order per device
    const orderedBatch = [...dto.orders].sort((a, b) => a.seq - b.seq);

    for (const item of orderedBatch) {
      const result = await this.syncSingleOfflineOrder(context, item);
      results.push(result);
    }

    const summary = {
      total: results.length,
      synced: results.filter((r) => r.status === 'SYNCED').length,
      alreadySynced: results.filter((r) => r.status === 'ALREADY_SYNCED').length,
      conflict: results.filter((r) => r.status === 'CONFLICT').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
    };

    return { summary, results };
  }

  private async syncSingleOfflineOrder(
    context: TenantContext,
    item: OfflineOrderSyncItem,
  ): Promise<OfflineOrderSyncResult> {
    const idempotencyKey = item.idempotencyKey || item.clientTransactionId;

    return await this.withWarehouseLock(
      `${context.tenantId}:${item.warehouseId}`,
      async () => {
        // 1. Idempotency check BEFORE any lease or stock mutation
        const existingOrder = await this.dbService.withTenantContext(
          context,
          async (tx) => {
            const [existing] = await tx
              .select({
                id: salesOrders.id,
                orderNumber: salesOrders.orderNumber,
                grandTotal: salesOrders.grandTotal,
              })
              .from(salesOrders)
              .where(
                and(
                  eq(salesOrders.tenantId, context.tenantId),
                  eq(salesOrders.idempotencyKey, idempotencyKey),
                ),
              )
              .limit(1);
            return existing;
          },
        );

        if (existingOrder) {
          return {
            clientTransactionId: item.clientTransactionId,
            idempotencyKey,
            seq: item.seq,
            status: 'ALREADY_SYNCED',
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            grandTotal: existingOrder.grandTotal,
          };
        }

        // 2. Scope & business rules validation
        try {
          if (context.userScopes) {
            this.opsFramework.verifyScope(context, context.userScopes, {
              legalEntityId: item.legalEntityId,
              branchId: item.branchId,
            });
          }
        } catch (err: any) {
          return {
            clientTransactionId: item.clientTransactionId,
            idempotencyKey,
            seq: item.seq,
            status: 'FAILED',
            reasonCode: 'SCOPE_FORBIDDEN',
            message: err?.message || 'غير مصرح بالوصول إلى الفرع أو المنشأة',
          };
        }

        if (item.invoiceType === 'STANDARD' && !item.customerId) {
          return {
            clientTransactionId: item.clientTransactionId,
            idempotencyKey,
            seq: item.seq,
            status: 'CONFLICT',
            reasonCode: 'STANDARD_INVOICE_REQUIRES_CUSTOMER',
            message: 'الفاتورة الضريبية القياسية (STANDARD) تتطلب تحديد العميل',
          };
        }

        if (item.payments) {
          for (const pmt of item.payments) {
            if (!APPROVED_OFFLINE_PAYMENT_METHODS.has(pmt.paymentMethod)) {
              return {
                clientTransactionId: item.clientTransactionId,
                idempotencyKey,
                seq: item.seq,
                status: 'FAILED',
                reasonCode: 'UNAPPROVED_PAYMENT_METHOD',
                message: `طريقة الدفع '${pmt.paymentMethod}' غير معتمدة للمزامنة دون اتصال`,
              };
            }
          }
        }

        // Aggregate required quantities per itemId
        const qtyByItem = new Map<string, number>();
        for (const line of item.lines) {
          const q = parseFloat(line.quantity);
          if (!Number.isFinite(q) || q <= 0) {
            return {
              clientTransactionId: item.clientTransactionId,
              idempotencyKey,
              seq: item.seq,
              status: 'FAILED',
              reasonCode: 'INVALID_QUANTITY',
              message: `الكمية غير صالحة للمنتج '${line.itemId}'`,
            };
          }
          qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) || 0) + q);
        }

        const sortedItemIds = Array.from(qtyByItem.keys()).sort();

        // 3. Validate quota leases, seq ordering, and server stock balances (Conflict Policy = PREVENT)
        const validationResult = await this.dbService.withTenantContext(
          context,
          async (tx) => {
            const now = new Date();

            for (const itemId of sortedItemIds) {
              const requiredQty = qtyByItem.get(itemId)!;

              const [lease] = await tx
                .select()
                .from(offlineQuotaLeases)
                .where(
                  and(
                    eq(offlineQuotaLeases.tenantId, context.tenantId),
                    eq(offlineQuotaLeases.legalEntityId, item.legalEntityId),
                    eq(offlineQuotaLeases.warehouseId, item.warehouseId),
                    eq(offlineQuotaLeases.itemId, itemId),
                    eq(offlineQuotaLeases.deviceId, item.deviceId),
                    eq(offlineQuotaLeases.deviceEpoch, item.deviceEpoch),
                    eq(offlineQuotaLeases.status, 'ACTIVE'),
                  ),
                )
                .for('update')
                .limit(1);

              if (!lease) {
                return {
                  ok: false as const,
                  reasonCode: 'LEASE_NOT_FOUND',
                  message: `لا توجد حصة نشطة (Quota Lease) للمنتج '${itemId}' على هذا الجهاز`,
                };
              }

              if (!this.verifyLeaseSignature(lease)) {
                return {
                  ok: false as const,
                  reasonCode: 'LEASE_INVALID_SIGNATURE',
                  message: `توقيع الحصة غير صالح للمنتج '${itemId}'`,
                };
              }

              if (lease.validUntil <= now) {
                return {
                  ok: false as const,
                  reasonCode: 'LEASE_EXPIRED',
                  message: `انتهت صلاحية الحصة للمنتج '${itemId}'`,
                };
              }

              if (item.seq <= lease.lastReceivedSeq) {
                return {
                  ok: false as const,
                  reasonCode: 'SEQ_CONFLICT',
                  message: `تعارض في تسلسل العمليات (seq=${item.seq} <= lastReceivedSeq=${lease.lastReceivedSeq})`,
                };
              }

              const remainingQuota =
                parseFloat(lease.allocatedQty) - parseFloat(lease.consumedQty);
              if (requiredQty > remainingQuota + 1e-6) {
                return {
                  ok: false as const,
                  reasonCode: 'QUOTA_EXCEEDED',
                  message: `الكمية المطلوبة (${requiredQty}) تتجاوز المتبقي من الحصة (${remainingQuota.toFixed(4)}) للمنتج '${itemId}'`,
                };
              }

              // Prevent overselling actual server stock
              const { availableQty, hasRecord } = await this.getLockedAvailableStock(
                tx,
                {
                  tenantId: context.tenantId,
                  legalEntityId: item.legalEntityId,
                  warehouseId: item.warehouseId,
                  itemId,
                },
              );

              if (!hasRecord || availableQty + 1e-6 < requiredQty) {
                return {
                  ok: false as const,
                  reasonCode: 'INSUFFICIENT_STOCK',
                  message: `الرصيد الفعلي في المستودع غير كافٍ للمنتج '${itemId}': المطلوب ${requiredQty}، المتاح ${availableQty.toFixed(4)}`,
                };
              }
            }

            return { ok: true as const };
          },
        );

        if (!validationResult.ok) {
          return {
            clientTransactionId: item.clientTransactionId,
            idempotencyKey,
            seq: item.seq,
            status: 'CONFLICT',
            reasonCode: validationResult.reasonCode,
            message: validationResult.message,
          };
        }

        // 4. Invoke SalesService.createSalesOrder (atomic GL posting + inventory deduction)
        // Offline transactions are NEVER considered financially posted until this succeeds.
        const offlineTag = `[OFFLINE:${item.invoiceType}:SEQ=${item.seq}]`;
        const mergedNotes = item.notes ? `${offlineTag} ${item.notes}` : offlineTag;

        const createDto: CreateSalesOrderRequest = {
          legalEntityId: item.legalEntityId,
          branchId: item.branchId,
          deviceId: item.deviceId,
          warehouseId: item.warehouseId,
          customerId: item.customerId,
          shiftId: item.shiftId,
          tableId: item.tableId,
          orderNumber: item.orderNumber,
          orderType: item.orderType,
          channel: item.channel,
          idempotencyKey,
          notes: mergedNotes,
          lines: item.lines,
          payments: item.payments,
        };

        let createdOrder: any;
        try {
          createdOrder = await this.salesService.createSalesOrder(context, createDto);
        } catch (err: any) {
          const isConflict = err instanceof ConflictException;
          return {
            clientTransactionId: item.clientTransactionId,
            idempotencyKey,
            seq: item.seq,
            status: isConflict ? 'CONFLICT' : 'FAILED',
            reasonCode: isConflict ? 'SALES_ORDER_CONFLICT' : 'SALES_ORDER_ERROR',
            message: err?.message || 'فشل ترحيل فاتورة المبيعات على الخادم',
          };
        }

        // 5. Advance lease consumedQty and lastReceivedSeq ONLY after createSalesOrder succeeded
        await this.dbService.withTenantContext(context, async (tx) => {
          for (const itemId of sortedItemIds) {
            const requiredQty = qtyByItem.get(itemId)!;
            const [lease] = await tx
              .select()
              .from(offlineQuotaLeases)
              .where(
                and(
                  eq(offlineQuotaLeases.tenantId, context.tenantId),
                  eq(offlineQuotaLeases.legalEntityId, item.legalEntityId),
                  eq(offlineQuotaLeases.warehouseId, item.warehouseId),
                  eq(offlineQuotaLeases.itemId, itemId),
                  eq(offlineQuotaLeases.deviceId, item.deviceId),
                  eq(offlineQuotaLeases.deviceEpoch, item.deviceEpoch),
                  eq(offlineQuotaLeases.status, 'ACTIVE'),
                ),
              )
              .for('update')
              .limit(1);

            if (lease) {
              const newConsumed = (
                parseFloat(lease.consumedQty) + requiredQty
              ).toFixed(4);
              await tx
                .update(offlineQuotaLeases)
                .set({
                  consumedQty: newConsumed,
                  lastReceivedSeq: Math.max(lease.lastReceivedSeq, item.seq),
                })
                .where(eq(offlineQuotaLeases.id, lease.id));
            }
          }

          await this.auditService.log(
            {
              tenantId: context.tenantId,
              actorId: context.userId,
              action: 'OFFLINE_ORDER_SYNCED',
              entityType: 'sales_order',
              entityId: createdOrder.id,
              afterState: {
                clientTransactionId: item.clientTransactionId,
                idempotencyKey,
                deviceId: item.deviceId,
                deviceEpoch: item.deviceEpoch,
                seq: item.seq,
                invoiceType: item.invoiceType,
                orderNumber: createdOrder.orderNumber,
              },
            },
            tx,
          );
        });

        return {
          clientTransactionId: item.clientTransactionId,
          idempotencyKey,
          seq: item.seq,
          status: 'SYNCED',
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          grandTotal: createdOrder.grandTotal,
        };
      },
    );
  }
}
