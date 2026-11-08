import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
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
  inventoryBalances,
  inventoryMovements,
  inventoryCostLayers,
  suppliers,
  items,
  chartOfAccounts,
  journalEntries,
  journalLines,
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
  MovementDirection,
  JournalType,
  JournalStatus,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
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

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          orderNumber: dto.orderNumber,
          status: PurchaseOrderStatus.ISSUED,
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
        .values(preparedLines.map((l) => ({ ...l, orderId: po.id })))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PURCHASE_ORDER_ISSUED',
          entityType: 'purchase_order',
          entityId: po.id,
          afterState: { po, lines: createdLines },
        },
        tx
      );

      return { ...po, lines: createdLines };
    });
  }

  async getPurchaseOrders(context: TenantContext, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(purchaseOrders.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(purchaseOrders.legalEntityId, legalEntityId));
      }

      return await tx
        .select()
        .from(purchaseOrders)
        .where(and(...conditions))
        .orderBy(desc(purchaseOrders.createdAt));
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
        const [grnLine] = await tx
          .insert(goodsReceiptLines)
          .values({
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

        // 1. Update PO Line received quantity if linked
        if (line.purchaseOrderLineId) {
          const [poLine] = await tx
            .select()
            .from(purchaseOrderLines)
            .where(eq(purchaseOrderLines.id, line.purchaseOrderLineId))
            .limit(1);

          if (poLine) {
            const currentRec = parseFloat(poLine.receivedQty || '0');
            const newlyRec = parseFloat(line.receivedQty);
            const totalRec = (currentRec + newlyRec).toFixed(4);

            await tx
              .update(purchaseOrderLines)
              .set({ receivedQty: totalRec })
              .where(eq(purchaseOrderLines.id, poLine.id));
          }
        }

        // 2. Atomic Inventory Balance Update (or insert if first receipt)
        const [existingBal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.legalEntityOwnerId, dto.legalEntityId),
              eq(inventoryBalances.warehouseId, dto.warehouseId),
              eq(inventoryBalances.itemId, line.itemId),
              sql`${inventoryBalances.lotId} IS NULL`
            )
          )
          .limit(1);

        const recQty = parseFloat(line.receivedQty);

        if (existingBal) {
          const currentOnHand = parseFloat(existingBal.onHandQty);
          const newOnHand = (currentOnHand + recQty).toFixed(4);

          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              version: existingBal.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventoryBalances.id, existingBal.id),
                eq(inventoryBalances.version, existingBal.version)
              )
            );
        } else {
          await tx.insert(inventoryBalances).values({
            tenantId: context.tenantId,
            legalEntityOwnerId: dto.legalEntityId,
            warehouseId: dto.warehouseId,
            itemId: line.itemId,
            onHandQty: recQty.toFixed(4),
            reservedQty: '0.0000',
            version: 1,
          });
        }

        // 3. FIFO Cost Layer creation
        await tx.insert(inventoryCostLayers).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: line.itemId,
          quantityReceived: line.receivedQty,
          quantityRemaining: line.receivedQty,
          unitCost: line.unitCost,
          sourceType: 'goods_receipt',
          sourceId: grn.id,
        });

        // 4. Record Inventory Movement Ledger Entry
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: line.itemId,
          movementType: MovementType.PURCHASE_RECEIPT,
          direction: MovementDirection.IN,
          quantity: line.receivedQty,
          unitCost: line.unitCost,
          sourceType: 'goods_receipt',
          sourceId: grn.id,
        });
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
        .values(preparedLines.map((l) => ({ ...l, invoiceId: invoice.id })))
        .returning();

      // Update Supplier Balance (AP subledger)
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
      let totalReturnAmount = 0;

      const preparedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const cost = parseFloat(l.unitCost);
        const total = qty * cost;
        totalReturnAmount += total;
        return {
          itemId: l.itemId,
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
        .values(preparedLines.map((l) => ({ ...l, returnId: ret.id })))
        .returning();

      // Adjust supplier balance (debit balance / reduce debt)
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
        .limit(1);

      if (bal) {
        const newBal = Math.max(
          0,
          parseFloat(bal.currentBalance) - totalReturnAmount
        ).toFixed(4);

        await tx
          .update(supplierBalances)
          .set({ currentBalance: newBal, updatedAt: new Date() })
          .where(eq(supplierBalances.id, bal.id));
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

      // 2. Validate AP Balance and guard against overpayment
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
        .limit(1);

      if (bal) {
        const curBal = parseFloat(bal.currentBalance);
        if (paymentAmt > curBal + 0.0001) {
          throw new BadRequestException(
            `Payment amount (${paymentAmt.toFixed(2)}) exceeds outstanding supplier balance (${curBal.toFixed(2)})`
          );
        }
      }

      // 3. If linked to an invoice, validate remaining invoice amount
      let targetInvoice: any = null;
      if (dto.invoiceId) {
        const [inv] = await tx
          .select()
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, dto.invoiceId))
          .limit(1);

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

      // 7. Post Supplier Payment Journal Entry (Dr Accounts Payable, Cr Cash/Bank)
      const accounts = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, dto.legalEntityId)
          )
        );

      const apAccount = accounts.find((a) => a.accountCode === '2100' || a.accountCode === '2010');
      const cashAccount = accounts.find((a) => a.accountCode === '1010' || a.accountCode === '1020') || accounts[0];

      if (apAccount && cashAccount) {
        const jNumber = `JV-PMT-${dto.paymentNumber}`;
        const [existingJV] = await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, context.tenantId),
              eq(journalEntries.journalNumber, jNumber)
            )
          )
          .limit(1);

        if (!existingJV) {
          const [je] = await tx
            .insert(journalEntries)
            .values({
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              journalNumber: jNumber,
              journalType: JournalType.GENERAL,
              status: JournalStatus.POSTED,
              sourceType: 'supplier_payment',
              sourceId: payment.id,
              debitTotal: paymentAmt.toFixed(4),
              creditTotal: paymentAmt.toFixed(4),
              postedAt: new Date(),
              postedBy: context.userId,
            })
            .returning();

          if (je) {
            // Debit Accounts Payable
            await tx.insert(journalLines).values({
              journalEntryId: je.id,
              accountId: apAccount.id,
              debit: paymentAmt.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `AP Settlement to Supplier ${dto.supplierId}`,
            });

            // Credit Cash / Bank
            await tx.insert(journalLines).values({
              journalEntryId: je.id,
              accountId: cashAccount.id,
              debit: '0.0000',
              credit: paymentAmt.toFixed(4),
              currency: 'SAR',
              description: `Cash/Bank Disbursement for Payment ${dto.paymentNumber}`,
            });
          }
        }
      }

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

      // Reversal Journal Entry
      const accounts = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, payment.legalEntityId)
          )
        );

      const apAccount = accounts.find((a) => a.accountCode === '2100' || a.accountCode === '2010');
      const cashAccount = accounts.find((a) => a.accountCode === '1010' || a.accountCode === '1020') || accounts[0];

      if (apAccount && cashAccount) {
        const jNumber = `JV-REV-PMT-${payment.paymentNumber}`;
        const [je] = await tx
          .insert(journalEntries)
          .values({
            tenantId: context.tenantId,
            legalEntityId: payment.legalEntityId,
            journalNumber: jNumber,
            journalType: JournalType.GENERAL,
            status: JournalStatus.POSTED,
            sourceType: 'supplier_payment_cancellation',
            sourceId: payment.id,
            debitTotal: paymentAmt.toFixed(4),
            creditTotal: paymentAmt.toFixed(4),
            postedAt: new Date(),
            postedBy: context.userId,
          })
          .returning();

        if (je) {
          // Debit Cash / Bank (refund disbursement)
          await tx.insert(journalLines).values({
            journalEntryId: je.id,
            accountId: cashAccount.id,
            debit: paymentAmt.toFixed(4),
            credit: '0.0000',
            currency: 'SAR',
            description: `Payment Cancellation Reversal ${payment.paymentNumber}`,
          });

          // Credit Accounts Payable (restore liability)
          await tx.insert(journalLines).values({
            journalEntryId: je.id,
            accountId: apAccount.id,
            debit: '0.0000',
            credit: paymentAmt.toFixed(4),
            currency: 'SAR',
            description: `AP Liability Restitution for ${payment.paymentNumber}`,
          });
        }
      }

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
