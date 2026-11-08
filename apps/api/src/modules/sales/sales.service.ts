import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { ProductionService } from '../production/production.service';
import { AccountingService } from '../accounting/accounting.service';
import {
  salesOrders,
  orderLines,
  payments,
  posShifts,
  shiftCashTransactions,
  diningTables,
  orderLineModifiers,
  orderVoids,
  chartOfAccounts,
} from '@restaurant-cloud/database';
import {
  OpenShiftRequest,
  ClosePosShiftRequest,
  ShiftCashTransactionRequest,
  CreateSalesOrderRequest,
  TransferTableOrderRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  OrderStatus,
  OrderType,
  ShiftStatus,
  ShiftCashTransactionType,
  PaymentStatus,
  PaymentMethod,
  TableStatus,
  JournalType,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, or, inArray, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class SalesService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly productionService: ProductionService,
    private readonly accountingService: AccountingService
  ) {}

  // ==================================================================
  // 1. POS Shift Management & Cash Reconciliation
  // ==================================================================

  async openShift(context: TenantContext, dto: OpenShiftRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Check if cashier or device already has an OPEN shift
      const [activeShift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.tenantId, context.tenantId),
            eq(posShifts.deviceId, dto.deviceId),
            eq(posShifts.status, ShiftStatus.OPEN)
          )
        )
        .limit(1);

      if (activeShift) {
        throw new ConflictException(
          `This POS device already has an active open shift (#${activeShift.id})`
        );
      }

      const [shift] = await tx
        .insert(posShifts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          deviceId: dto.deviceId,
          cashierId: context.userId,
          openingCash: dto.openingCash,
          status: ShiftStatus.OPEN,
        })
        .returning();

      if (!shift) throw new Error('Failed to open POS shift');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'POS_SHIFT_OPENED',
          entityType: 'pos_shift',
          entityId: shift.id,
          afterState: shift,
        },
        tx
      );

      return shift;
    });
  }

  async getActiveShift(context: TenantContext, deviceId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.tenantId, context.tenantId),
            eq(posShifts.deviceId, deviceId),
            eq(posShifts.status, ShiftStatus.OPEN)
          )
        )
        .limit(1);

      return shift || null;
    });
  }

  async recordShiftCashTransaction(
    context: TenantContext,
    dto: ShiftCashTransactionRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, dto.shiftId))
        )
        .limit(1);

      if (!shift || shift.status !== ShiftStatus.OPEN) {
        throw new BadRequestException('Cash transactions can only be recorded on active open shifts');
      }

      const [txRecord] = await tx
        .insert(shiftCashTransactions)
        .values({
          tenantId: context.tenantId,
          shiftId: dto.shiftId,
          transactionType: dto.transactionType,
          amount: dto.amount,
          reason: dto.reason,
          performedBy: context.userId,
        })
        .returning();

      if (!txRecord) throw new Error('Failed to record cash transaction');

      return txRecord;
    });
  }

  async closeShift(context: TenantContext, dto: ClosePosShiftRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, dto.shiftId))
        )
        .limit(1);

      if (!shift || shift.status !== ShiftStatus.OPEN) {
        throw new BadRequestException('Shift is not currently open');
      }

      // Compute Cash In / Out transactions for this shift
      const cashTxs = await tx
        .select()
        .from(shiftCashTransactions)
        .where(
          and(
            eq(shiftCashTransactions.tenantId, context.tenantId),
            eq(shiftCashTransactions.shiftId, shift.id)
          )
        );

      let cashIns = 0;
      let cashOuts = 0;
      for (const t of cashTxs) {
        const val = parseFloat(t.amount);
        if (t.transactionType === ShiftCashTransactionType.CASH_IN) {
          cashIns += val;
        } else {
          cashOuts += val;
        }
      }

      // Compute cash collected from sales orders in this shift
      const ordersInShift = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.shiftId, shift.id),
            inArray(salesOrders.status, [
              OrderStatus.COMPLETED,
              OrderStatus.PAID,
              OrderStatus.PARTIALLY_REFUNDED,
              OrderStatus.REFUNDED,
            ])
          )
        );

      let cashSales = 0;
      for (const ord of ordersInShift) {
        const cashPmts = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, context.tenantId),
              eq(payments.orderId, ord.id),
              eq(payments.paymentMethod, PaymentMethod.CASH),
              inArray(payments.status, [PaymentStatus.CAPTURED, PaymentStatus.REFUNDED])
            )
          );

        for (const p of cashPmts) {
          cashSales += parseFloat(p.amount);
        }
      }

      const openingCash = parseFloat(shift.openingCash);
      const expectedCash = openingCash + cashIns - cashOuts + cashSales;
      const countedCash = parseFloat(dto.countedCash);
      const variance = countedCash - expectedCash;

      const [closedShift] = await tx
        .update(posShifts)
        .set({
          closedAt: new Date(),
          countedCash: countedCash.toFixed(4),
          expectedCash: expectedCash.toFixed(4),
          variance: variance.toFixed(4),
          status: ShiftStatus.CLOSED,
        })
        .where(eq(posShifts.id, shift.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'POS_SHIFT_CLOSED',
          entityType: 'pos_shift',
          entityId: shift.id,
          afterState: closedShift,
        },
        tx
      );

      return closedShift;
    });
  }

  // ==================================================================
  // 2. Sales Order Lifecycle (BOM Consumption, Multi-Tender, RLS & Ledger)
  // ==================================================================

  async createSalesOrder(context: TenantContext, dto: CreateSalesOrderRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Idempotency Check: prevent duplicate orders
      if (dto.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, context.tenantId),
              eq(salesOrders.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);

        if (existing) {
          if (existing.orderNumber !== dto.orderNumber) {
            throw new ConflictException(
              `Idempotency key '${dto.idempotencyKey}' already used for a different request payload`
            );
          }
          // Idempotent duplicate request: return existing order
          return existing;
        }
      }

      // Check unique order number in legal entity
      const [existingNumber] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.legalEntityId, dto.legalEntityId),
            eq(salesOrders.orderNumber, dto.orderNumber)
          )
        )
        .limit(1);

      if (existingNumber) {
        throw new ConflictException(
          `Sales order number '${dto.orderNumber}' already exists`
        );
      }

      // 2. Compute Lines, Tax and Grand Total
      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;

      const preparedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const unitPrice = parseFloat(l.unitPrice);
        const discount = parseFloat(l.discountAmount || '0.0000');
        const lineNet = Math.max(0, qty * unitPrice - discount);
        const lineTax = lineNet * 0.15; // 15% Saudi Standard VAT
        const lineTotal = lineNet + lineTax;

        subtotal += lineNet;
        totalTax += lineTax;
        totalDiscount += discount;

        return {
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountAmount: discount.toFixed(4),
          taxAmount: lineTax.toFixed(4),
          lineTotal: lineTotal.toFixed(4),
          modifiers: l.modifiers || [],
        };
      });

      const grandTotal = subtotal + totalTax;

      const paidTotal = dto.payments?.reduce((acc, p) => acc + parseFloat(p.amount), 0) || 0;
      const initialStatus =
        paidTotal >= grandTotal - 0.0001
          ? OrderStatus.PAID
          : OrderStatus.CONFIRMED;

      // 3. Insert Header
      const [order] = await tx
        .insert(salesOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          deviceId: dto.deviceId,
          shiftId: dto.shiftId || null,
          tableId: dto.tableId || null,
          orderNumber: dto.orderNumber,
          orderType: dto.orderType,
          channel: dto.channel,
          status: initialStatus,
          currency: 'SAR',
          subtotal: subtotal.toFixed(4),
          discountTotal: totalDiscount.toFixed(4),
          taxTotal: totalTax.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          idempotencyKey: dto.idempotencyKey || null,
          notes: dto.notes || null,
        })
        .returning();

      if (!order) throw new Error('Failed to create sales order');

      // 4. Insert Order Lines and Modifiers + Recipe BOM Stock Consumption
      let totalConsumedCost = 0;

      for (const pl of preparedLines) {
        const [line] = await tx
          .insert(orderLines)
          .values({
            orderId: order.id,
            itemId: pl.itemId,
            uomId: pl.uomId,
            quantity: pl.quantity,
            unitPrice: pl.unitPrice,
            discountAmount: pl.discountAmount,
            taxAmount: pl.taxAmount,
            lineTotal: pl.lineTotal,
          })
          .returning();

        if (!line) throw new Error('Failed to create order line');

        // Modifiers if present
        if (pl.modifiers && pl.modifiers.length > 0) {
          await tx.insert(orderLineModifiers).values(
            pl.modifiers.map((m) => ({
              orderLineId: line.id,
              modifierNameAr: m.modifierNameAr,
              modifierNameEn: m.modifierNameEn || '',
              priceDelta: m.priceDelta,
              quantity: m.quantity,
            }))
          );
        }

        // Automatic Recipe / Stock Deduction
        const consumption = await this.productionService.consumeForSaleTx(tx, {
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: pl.itemId,
          quantitySold: parseFloat(pl.quantity),
          orderId: order.id,
        });

        totalConsumedCost += consumption.totalCost;
      }

      // 5. Record Payments
      if (dto.payments && dto.payments.length > 0) {
        for (const pmt of dto.payments) {
          await tx.insert(payments).values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            orderId: order.id,
            paymentMethod: pmt.paymentMethod,
            amount: pmt.amount,
            currency: 'SAR',
            providerCode: pmt.providerCode || null,
            providerTransactionRef: pmt.providerTransactionRef || null,
            status: PaymentStatus.CAPTURED,
            idempotencyKey: pmt.idempotencyKey || null,
          });
        }
      }

      // 6. Update Table Status if Dine-in
      if (dto.tableId) {
        await tx
          .update(diningTables)
          .set({
            status: TableStatus.OCCUPIED,
            currentOrderId: order.id,
          })
          .where(
            and(
              eq(diningTables.tenantId, context.tenantId),
              eq(diningTables.id, dto.tableId)
            )
          );
      }

      // 7. Post Accounting Journal Entry (Automated Sales & Tax Posting)
      const accounts = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId)
          )
        );

      const cashAccount = accounts.find((a) => a.accountCode === '1010' || a.accountCode === '1020') || accounts[0];
      const salesAccount = accounts.find((a) => a.accountCode === '4010') || accounts[0];
      const vatAccount = accounts.find((a) => a.accountCode === '2050') || accounts[0];

      if (cashAccount && salesAccount && vatAccount && grandTotal > 0) {
        const jNumber = `JV-SALE-${order.orderNumber}`;
        const [existingJV] = await tx
          .select({ id: chartOfAccounts.id })
          .from(chartOfAccounts)
          .where(eq(chartOfAccounts.accountCode, jNumber))
          .limit(1);

        if (!existingJV) {
          await this.accountingService.postJournalEntry(context, {
            legalEntityId: dto.legalEntityId,
            journalNumber: jNumber,
            journalType: JournalType.SALES,
            sourceType: 'sales_order',
            sourceId: order.id,
            lines: [
              {
                accountId: cashAccount.id,
                branchId: dto.branchId,
                debit: grandTotal.toFixed(4),
                credit: '0.0000',
                currency: 'SAR',
                description: `POS Sales Payment for Order ${order.orderNumber}`,
              },
              {
                accountId: salesAccount.id,
                branchId: dto.branchId,
                debit: '0.0000',
                credit: subtotal.toFixed(4),
                currency: 'SAR',
                description: `Sales Revenue for Order ${order.orderNumber}`,
              },
              {
                accountId: vatAccount.id,
                branchId: dto.branchId,
                debit: '0.0000',
                credit: totalTax.toFixed(4),
                currency: 'SAR',
                description: `15% VAT Output for Order ${order.orderNumber}`,
              },
            ],
          });
        }
      }

      // 8. Audit Log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SALES_ORDER_CREATED',
          entityType: 'sales_order',
          entityId: order.id,
          afterState: { order, totalConsumedCost },
        },
        tx
      );

      return {
        ...order,
        totalConsumedCost: totalConsumedCost.toFixed(4),
      };
    });
  }

  // ==================================================================
  // 3. Table Transfer & Voids
  // ==================================================================

  async transferTableOrder(context: TenantContext, dto: TransferTableOrderRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Free source table
      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.fromTableId)
          )
        );

      // Occupy destination table
      await tx
        .update(diningTables)
        .set({ status: TableStatus.OCCUPIED, currentOrderId: dto.orderId })
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.toTableId)
          )
        );

      // Update order table reference
      await tx
        .update(salesOrders)
        .set({ tableId: dto.toTableId })
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, dto.orderId)
          )
        );

      return { success: true, orderId: dto.orderId, newTableId: dto.toTableId };
    });
  }

  async voidSalesOrder(
    context: TenantContext,
    orderId: string,
    reason: string,
    approvedBy: string
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, orderId)
          )
        )
        .limit(1);

      if (!order) throw new NotFoundException(`Order '${orderId}' not found`);

      // Update order status to CANCELLED
      await tx
        .update(salesOrders)
        .set({ status: OrderStatus.CANCELLED })
        .where(eq(salesOrders.id, order.id));

      // Free dining table if linked
      if (order.tableId) {
        await tx
          .update(diningTables)
          .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
          .where(
            and(
              eq(diningTables.tenantId, context.tenantId),
              eq(diningTables.id, order.tableId)
            )
          );
      }

      // Record manager void
      const [voidRecord] = await tx
        .insert(orderVoids)
        .values({
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          orderId: order.id,
          reason,
          voidAmount: order.grandTotal,
          voidedBy: context.userId,
          approvedBy,
        })
        .returning();

      return voidRecord;
    });
  }

  async refundSalesOrder(
    context: TenantContext,
    orderId: string,
    dto: {
      refundAmount: string;
      reason: string;
      approvedBy: string;
      paymentMethod?: string;
      restockInventory?: boolean;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, orderId)
          )
        )
        .limit(1);

      if (!order) throw new NotFoundException(`Sales order '${orderId}' not found`);

      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        throw new BadRequestException(`Order is already ${order.status}`);
      }

      const refundAmt = parseFloat(dto.refundAmount);
      const grandTotal = parseFloat(order.grandTotal);
      if (refundAmt <= 0) {
        throw new BadRequestException('Refund amount must be greater than zero');
      }
      if (refundAmt > grandTotal) {
        throw new BadRequestException(
          `Refund amount (${refundAmt.toFixed(2)}) cannot exceed order grand total (${grandTotal.toFixed(2)})`
        );
      }

      // Query existing payments for this order to handle tender refunds & split payments
      const orderPayments = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, context.tenantId),
            eq(payments.orderId, order.id)
          )
        );

      // Calculate net available refundable amount per payment method
      const tenderBalances = new Map<string, { netPaid: number; sample?: typeof orderPayments[0] }>();
      for (const p of orderPayments) {
        const amt = parseFloat(p.amount);
        const existing = tenderBalances.get(p.paymentMethod);
        if (!existing) {
          tenderBalances.set(p.paymentMethod, { netPaid: amt, sample: p });
        } else {
          existing.netPaid += amt;
        }
      }

      // Allocate refund amount across payment tenders
      const refundAllocations: Array<{ method: string; amount: number; sample?: typeof orderPayments[0] }> = [];
      let unallocated = refundAmt;

      if (dto.paymentMethod && tenderBalances.has(dto.paymentMethod)) {
        const info = tenderBalances.get(dto.paymentMethod)!;
        const avail = Math.max(0, info.netPaid);
        const take = Math.min(unallocated, avail);
        if (take > 0) {
          refundAllocations.push({
            method: dto.paymentMethod,
            amount: take,
            sample: info.sample,
          });
          unallocated -= take;
        }
      }

      // Allocate remaining refund across available original tenders
      for (const [method, info] of tenderBalances.entries()) {
        if (unallocated <= 0.0001) break;
        if (dto.paymentMethod && method === dto.paymentMethod) continue;
        const avail = Math.max(0, info.netPaid);
        const take = Math.min(unallocated, avail);
        if (take > 0) {
          refundAllocations.push({
            method,
            amount: take,
            sample: info.sample,
          });
          unallocated -= take;
        }
      }

      // If no recorded payments exist or all exhausted, fallback to CASH
      if (unallocated > 0.0001) {
        refundAllocations.push({
          method: dto.paymentMethod || PaymentMethod.CASH,
          amount: unallocated,
          sample: orderPayments[0],
        });
      }

      // Insert refund records in payments table (negative amount, REFUNDED status)
      for (const alloc of refundAllocations) {
        await tx.insert(payments).values({
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          orderId: order.id,
          paymentMethod: alloc.method,
          amount: (-alloc.amount).toFixed(4),
          currency: 'SAR',
          providerCode: alloc.sample?.providerCode || null,
          providerTransactionRef: alloc.sample?.providerTransactionRef
            ? `REF-${alloc.sample.providerTransactionRef}`
            : null,
          status: PaymentStatus.REFUNDED,
        });
      }

      const isFullRefund = refundAmt >= grandTotal - 0.0001;
      const newStatus = isFullRefund ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED;

      const [updatedOrder] = await tx
        .update(salesOrders)
        .set({ status: newStatus })
        .where(eq(salesOrders.id, order.id))
        .returning();

      // Post Reversing / Refund Journal Entry matching tender disbursements
      const accounts = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, order.legalEntityId)
          )
        );

      const cashAccount = accounts.find((a) => a.accountCode === '1010') || accounts[0];
      const bankAccount = accounts.find((a) => a.accountCode === '1020') || cashAccount;
      const salesAccount = accounts.find((a) => a.accountCode === '4010') || accounts[0];
      const vatAccount = accounts.find((a) => a.accountCode === '2050') || accounts[0];

      if (cashAccount && salesAccount && vatAccount) {
        const netRefund = refundAmt / 1.15;
        const vatRefund = refundAmt - netRefund;
        const jNumber = `JV-REFUND-${order.orderNumber}`;

        const defaultCreditAccount = cashAccount || salesAccount;
        const journalCreditLines = refundAllocations.map((alloc) => {
          const acc = alloc.method === PaymentMethod.CASH ? cashAccount : bankAccount;
          const targetAcc = acc || defaultCreditAccount;
          return {
            accountId: targetAcc.id,
            branchId: order.branchId,
            debit: '0.0000',
            credit: alloc.amount.toFixed(4),
            currency: 'SAR',
            description: `Refund Disbursement (${alloc.method}) for Order ${order.orderNumber}`,
          };
        });

        await this.accountingService.postJournalEntry(context, {
          legalEntityId: order.legalEntityId,
          journalNumber: jNumber,
          journalType: JournalType.SALES,
          sourceType: 'sales_refund',
          sourceId: order.id,
          lines: [
            {
              accountId: salesAccount.id,
              branchId: order.branchId,
              debit: netRefund.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `Sales Revenue Refund for Order ${order.orderNumber} - ${dto.reason}`,
            },
            {
              accountId: vatAccount.id,
              branchId: order.branchId,
              debit: vatRefund.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `15% VAT Output Reversal for Order ${order.orderNumber}`,
            },
            ...journalCreditLines,
          ],
        });
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SALES_ORDER_REFUNDED',
          entityType: 'sales_order',
          entityId: order.id,
          afterState: { updatedOrder, dto },
        },
        tx
      );

      return updatedOrder;
    });
  }

  async getSalesOrders(context: TenantContext, branchId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(salesOrders.tenantId, context.tenantId)];
      if (branchId) {
        conditions.push(eq(salesOrders.branchId, branchId));
      }

      return await tx
        .select()
        .from(salesOrders)
        .where(and(...conditions))
        .orderBy(desc(salesOrders.createdAt))
        .limit(100);
    });
  }
}
