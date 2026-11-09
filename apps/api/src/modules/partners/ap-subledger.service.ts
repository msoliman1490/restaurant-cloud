import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import {
  apInvoices,
  apInvoiceLines,
  apPaymentAllocations,
  paymentVouchers,
  goodsReceipts,
  goodsReceiptLines,
  purchaseOrders,
  partnerCompanySettings,
  partnerBalances,
  chartOfAccounts,
} from '@restaurant-cloud/database';
import {
  CreateApInvoiceRequest,
  AllocateApPaymentRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, JournalType } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc } from 'drizzle-orm';

@Injectable()
export class ApSubledgerService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService
  ) {}

  /**
   * Helper: Resolve account by accountCode
   */
  private async getAccountByCode(tx: any, tenantId: string, legalEntityId: string, code: string) {
    const [acc] = await tx
      .select({ id: chartOfAccounts.id, name: chartOfAccounts.name })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.tenantId, tenantId),
          eq(chartOfAccounts.legalEntityId, legalEntityId),
          eq(chartOfAccounts.accountCode, code)
        )
      )
      .limit(1);

    if (!acc) {
      throw new NotFoundException(`الحساب المحاسبي برمز '${code}' غير موجود في دليل الحسابات لهذه الشركة`);
    }
    return acc;
  }

  /**
   * 1. Create AP Invoice (Supplier Bill / Debit / Credit Note)
   */
  async createInvoice(context: TenantContext, dto: CreateApInvoiceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Uniqueness check for supplier invoice number per partner and legal entity
      const [existing] = await tx
        .select({ id: apInvoices.id })
        .from(apInvoices)
        .where(
          and(
            eq(apInvoices.legalEntityId, dto.legalEntityId),
            eq(apInvoices.partnerId, dto.partnerId),
            eq(apInvoices.supplierInvoiceNumber, dto.supplierInvoiceNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`فاتورة المورد '${dto.supplierInvoiceNumber}' مسجلة مسبقاً لهذا الطرف`);
      }

      let subtotal = 0;
      let totalTax = 0;

      const processedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const price = parseFloat(l.unitPrice);
        const taxRate = parseFloat(l.taxRate || '0.1500');

        const lineNet = qty * price;
        const lineTax = lineNet * taxRate;
        const lineTotal = lineNet + lineTax;

        subtotal += lineNet;
        totalTax += lineTax;

        return {
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: qty.toFixed(4),
          unitPrice: price.toFixed(4),
          taxRate: taxRate.toFixed(4),
          taxAmount: lineTax.toFixed(4),
          lineTotal: lineTotal.toFixed(4),
          notes: l.notes || null,
        };
      });

      const grandTotal = subtotal + totalTax;

      const [invoice] = await tx
        .insert(apInvoices)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          warehouseId: dto.warehouseId || null,
          partnerId: dto.partnerId,
          supplierInvoiceNumber: dto.supplierInvoiceNumber,
          internalNumber: dto.internalNumber,
          invoiceType: dto.invoiceType,
          originalInvoiceId: dto.originalInvoiceId || null,
          purchaseOrderId: dto.purchaseOrderId || null,
          goodsReceiptId: dto.goodsReceiptId || null,
          matchingStatus: dto.goodsReceiptId ? 'MATCHED_EXACT' : 'UNMATCHED',
          status: 'DRAFT',
          invoiceDate: dto.invoiceDate as any,
          dueDate: dto.dueDate as any,
          currency: dto.currency || 'SAR',
          exchangeRate: dto.exchangeRate || '1.0000',
          subtotal: subtotal.toFixed(4),
          taxAmount: totalTax.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          paidAmount: '0.0000',
          remainingAmount: grandTotal.toFixed(4),
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning();

      if (!invoice) throw new Error('فشل إنشاء ترويسة فاتورة المشتريات');

      for (const line of processedLines) {
        await tx.insert(apInvoiceLines).values({
          tenantId: context.tenantId,
          invoiceId: invoice.id,
          ...line,
        });
      }

      return invoice;
    });
  }

  /**
   * 2. Post AP Invoice: 3-Way Matching Engine, Clears GRNI (214000), Posts PPV (514000)
   */
  async postInvoice(context: TenantContext, invoiceId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [invoice] = await tx
        .select()
        .from(apInvoices)
        .where(
          and(
            eq(apInvoices.tenantId, context.tenantId),
            eq(apInvoices.id, invoiceId)
          )
        )
        .limit(1);

      if (!invoice) throw new NotFoundException('فاتورة المشتريات غير موجودة');
      if (invoice.status !== 'DRAFT') {
        throw new BadRequestException('يمكن فقط ترحيل الفواتير التي في حالة مسودة (DRAFT)');
      }

      const grandTotal = parseFloat(invoice.grandTotal);
      const subtotal = parseFloat(invoice.subtotal);
      const taxAmount = parseFloat(invoice.taxAmount);

      // Resolve Standard Chart of Accounts
      const apControlAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '211000');
      const inputVatAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '114000');
      let grniAcc: any = null;
      let ppvAcc: any = null;
      let inventoryAcc: any = null;

      let grniAmount = subtotal;
      let ppvAmount = 0;

      // 3-Way Matching Check
      if (invoice.goodsReceiptId) {
        grniAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '214000');

        // Check if Price Variance exists
        const [po] = invoice.purchaseOrderId
          ? await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, invoice.purchaseOrderId)).limit(1)
          : [null];

        const poSubtotal = po ? parseFloat(po.subtotal) : subtotal;
        ppvAmount = subtotal - poSubtotal;

        if (Math.abs(ppvAmount) > 0.0001) {
          ppvAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '514000');
          grniAmount = poSubtotal; // Clear GRNI with the original PO/GRN value
        }
      } else {
        // Direct vendor invoice without prior GRN -> Inventory / General Expense
        inventoryAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '112000');
      }

      // Build GL Double-Entry Lines
      const journalNumber = `JRN-AP-${invoice.internalNumber}`;
      const glLines: any[] = [];

      if (grniAcc) {
        // Clear Goods Received Not Invoiced (214000)
        glLines.push({
          accountId: grniAcc.id,
          debit: grniAmount.toFixed(4),
          credit: 0,
          description: `تصفير بضاعة مستلمة غير مفوترة - فاتورة مورد ${invoice.supplierInvoiceNumber}`,
        });

        // Price Variance if any
        if (Math.abs(ppvAmount) > 0.0001 && ppvAcc) {
          if (ppvAmount > 0) {
            glLines.push({
              accountId: ppvAcc.id,
              debit: ppvAmount.toFixed(4),
              credit: 0,
              description: `فروقات أسعار شراء غير مواتية - فاتورة ${invoice.supplierInvoiceNumber}`,
            });
          } else {
            glLines.push({
              accountId: ppvAcc.id,
              debit: 0,
              credit: Math.abs(ppvAmount).toFixed(4),
              description: `فروقات أسعار شراء مواتية - فاتورة ${invoice.supplierInvoiceNumber}`,
            });
          }
        }
      } else if (inventoryAcc) {
        glLines.push({
          accountId: inventoryAcc.id,
          debit: subtotal.toFixed(4),
          credit: 0,
          description: `مشتريات مواد غذائية - فاتورة مورد ${invoice.supplierInvoiceNumber}`,
        });
      }

      // Input VAT (114000)
      if (taxAmount > 0) {
        glLines.push({
          accountId: inputVatAcc.id,
          debit: taxAmount.toFixed(4),
          credit: 0,
          description: `ضريبة مدخلات قابلة للخصم - فاتورة مورد ${invoice.supplierInvoiceNumber}`,
        });
      }

      // AP Control (211000) - Protected Control Account
      glLines.push({
        accountId: apControlAcc.id,
        partnerId: invoice.partnerId,
        partnerRole: 'VENDOR',
        subledgerDocumentType: 'AP_INVOICE',
        subledgerDocumentId: invoice.id,
        debit: 0,
        credit: grandTotal.toFixed(4),
        description: `ذمم دائنة (موردين) - استحقاق فاتورة ${invoice.supplierInvoiceNumber}`,
      });

      const glEntry = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: invoice.legalEntityId,
          branchId: invoice.branchId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AP_INVOICE',
          sourceId: invoice.id,
          description: `استحقاق فاتورة مشتريات مورد رقم ${invoice.supplierInvoiceNumber}`,
          lines: glLines,
        },
        tx
      );

      // Update Invoice
      const [updated] = await tx
        .update(apInvoices)
        .set({
          status: 'POSTED',
          journalEntryId: glEntry.id,
          remainingAmount: invoice.grandTotal,
          priceVarianceAmount: ppvAmount.toFixed(4),
        })
        .where(eq(apInvoices.id, invoice.id))
        .returning();

      // Upsert Partner Balances (Vendor side)
      const [balance] = await tx
        .select()
        .from(partnerBalances)
        .where(
          and(
            eq(partnerBalances.legalEntityId, invoice.legalEntityId),
            eq(partnerBalances.partnerId, invoice.partnerId),
            eq(partnerBalances.currency, invoice.currency)
          )
        )
        .limit(1);

      if (balance) {
        const curVendorBal = parseFloat(balance.vendorBalance);
        await tx
          .update(partnerBalances)
          .set({
            vendorBalance: (curVendorBal + grandTotal).toFixed(4),
            lastTransactionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(partnerBalances.id, balance.id));
      } else {
        await tx.insert(partnerBalances).values({
          tenantId: context.tenantId,
          legalEntityId: invoice.legalEntityId,
          partnerId: invoice.partnerId,
          currency: invoice.currency,
          vendorBalance: grandTotal.toFixed(4),
        });
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'AP_INVOICE_POSTED',
          entityType: 'AP_INVOICE',
          entityId: invoice.id,
          afterState: { supplierInvoiceNumber: invoice.supplierInvoiceNumber, grandTotal },
        },
        tx
      );

      return updated;
    });
  }

  /**
   * 3. Allocate Payment Voucher against AP Invoices: ZERO CASH MOVEMENT
   *    Moves AP Control (211000) -> Vendor Prepayments (115000) + Cash Discounts Earned (422000).
   */
  async allocatePayment(context: TenantContext, dto: AllocateApPaymentRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Lock and Verify Payment Voucher
      const [voucher] = await tx
        .select()
        .from(paymentVouchers)
        .where(
          and(
            eq(paymentVouchers.tenantId, context.tenantId),
            eq(paymentVouchers.legalEntityId, dto.legalEntityId),
            eq(paymentVouchers.id, dto.paymentVoucherId)
          )
        )
        .limit(1);

      if (!voucher) throw new NotFoundException('سند الصرف غير موجود أو لا ينتمي لهذه الشركة');
      if (voucher.status !== 'POSTED') {
        throw new BadRequestException('يجب أن يكون سند الصرف مرحلاً (POSTED) لإجراء التخصيص');
      }

      const availableAmount = parseFloat(voucher.unallocatedAmount || '0');
      const totalToAllocate = dto.allocations.reduce((sum, a) => sum + parseFloat(a.allocatedAmount), 0);
      const totalDiscount = dto.allocations.reduce((sum, a) => sum + parseFloat(a.discountAmount || '0'), 0);

      if (totalToAllocate > availableAmount) {
        throw new BadRequestException(
          `المبلغ المطلوب تخصيصه (${totalToAllocate.toFixed(2)}) يتجاوز الرصيد غير المخصص بالسند (${availableAmount.toFixed(2)})`
        );
      }

      // Resolve Standard Chart of Accounts
      const apControlAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '211000');
      const prepaymentsAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '115000');
      let earnedDiscountAcc: any = null;
      if (totalDiscount > 0) {
        earnedDiscountAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '422000');
      }

      const allocationRecords = [];
      let partnerIdForJournal = voucher.beneficiaryId;

      // 2. Loop through allocations
      for (const item of dto.allocations) {
        const [invoice] = await tx
          .select()
          .from(apInvoices)
          .where(
            and(
              eq(apInvoices.tenantId, context.tenantId),
              eq(apInvoices.legalEntityId, dto.legalEntityId),
              eq(apInvoices.id, item.invoiceId)
            )
          )
          .limit(1);

        if (!invoice) throw new NotFoundException(`فاتورة المشتريات ${item.invoiceId} غير موجودة`);
        if (invoice.status !== 'POSTED' && invoice.status !== 'PARTIALLY_PAID') {
          throw new BadRequestException(`لا يمكن تخصيص سداد لفاتورة في حالة: ${invoice.status}`);
        }

        partnerIdForJournal = invoice.partnerId;

        const allocAmt = parseFloat(item.allocatedAmount);
        const discAmt = parseFloat(item.discountAmount || '0');
        const totalLineSettlement = allocAmt + discAmt;
        const currentRemaining = parseFloat(invoice.remainingAmount);

        if (totalLineSettlement > currentRemaining + 0.0001) {
          throw new BadRequestException(
            `المبلغ المخصص للفاتورة (${totalLineSettlement.toFixed(2)}) يتجاوز المبلغ المتبقي عليها (${currentRemaining.toFixed(2)})`
          );
        }

        const newRemaining = Math.max(0, currentRemaining - totalLineSettlement);
        const newPaid = parseFloat(invoice.paidAmount) + allocAmt;
        const newStatus = newRemaining <= 0.0001 ? 'PAID' : 'PARTIALLY_PAID';

        const [allocRecord] = await tx
          .insert(apPaymentAllocations)
          .values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            paymentVoucherId: voucher.id,
            invoiceId: invoice.id,
            allocatedAmount: allocAmt.toFixed(4),
            discountAmount: discAmt.toFixed(4),
            status: 'POSTED',
          })
          .returning();

        allocationRecords.push(allocRecord);

        await tx
          .update(apInvoices)
          .set({
            paidAmount: newPaid.toFixed(4),
            remainingAmount: newRemaining.toFixed(4),
            status: newStatus,
          })
          .where(eq(apInvoices.id, invoice.id));
      }

      // 3. Decrement voucher unallocated amount
      const newVoucherUnallocated = Math.max(0, availableAmount - totalToAllocate);
      await tx
        .update(paymentVouchers)
        .set({
          unallocatedAmount: newVoucherUnallocated.toFixed(4),
        })
        .where(eq(paymentVouchers.id, voucher.id));

      // 4. Post Allocation GL Entry: STRICT ZERO CASH MOVEMENT
      const journalNumber = `JRN-AL-PV-${voucher.voucherNumber}-${Date.now().toString().slice(-4)}`;
      const glLines: any[] = [
        {
          accountId: apControlAcc.id,
          partnerId: partnerIdForJournal,
          partnerRole: 'VENDOR',
          debit: (totalToAllocate + totalDiscount).toFixed(4),
          credit: 0,
          description: `إقفال ذمم دائنة (موردين) - تخصيص سند صرف ${voucher.voucherNumber}`,
        },
        {
          accountId: prepaymentsAcc.id,
          partnerId: partnerIdForJournal,
          partnerRole: 'VENDOR',
          debit: 0,
          credit: totalToAllocate.toFixed(4),
          description: `تسوية دفعات مقدمة للموردين - تخصيص سند صرف ${voucher.voucherNumber}`,
        },
      ];

      if (totalDiscount > 0 && earnedDiscountAcc) {
        glLines.push({
          accountId: earnedDiscountAcc.id,
          debit: 0,
          credit: totalDiscount.toFixed(4),
          description: `خصم تعجيل سداد مكتسب - تخصيص سند صرف ${voucher.voucherNumber}`,
        });
      }

      const allocJournal = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AP_ALLOCATION',
          sourceId: voucher.id,
          description: `تخصيص سند صرف ${voucher.voucherNumber} على فواتير المشتريات`,
          lines: glLines,
        },
        tx
      );

      for (const rec of allocationRecords) {
        if (!rec) continue;
        await tx
          .update(apPaymentAllocations)
          .set({ journalEntryId: allocJournal.id })
          .where(eq(apPaymentAllocations.id, rec.id));
      }

      // 5. Update partner balances: decrement vendor_balance and vendor_unallocated_payments
      if (partnerIdForJournal) {
        const [bal] = await tx
          .select()
          .from(partnerBalances)
          .where(
            and(
              eq(partnerBalances.legalEntityId, dto.legalEntityId),
              eq(partnerBalances.partnerId, partnerIdForJournal),
              eq(partnerBalances.currency, voucher.currency)
            )
          )
          .limit(1);

        if (bal) {
          const curBal = parseFloat(bal.vendorBalance);
          const curAdv = parseFloat(bal.vendorUnallocatedPayments);
          await tx
            .update(partnerBalances)
            .set({
              vendorBalance: Math.max(0, curBal - (totalToAllocate + totalDiscount)).toFixed(4),
              vendorUnallocatedPayments: Math.max(0, curAdv - totalToAllocate).toFixed(4),
              lastTransactionAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(partnerBalances.id, bal.id));
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'AP_PAYMENT_ALLOCATED',
          entityType: 'PAYMENT_VOUCHER',
          entityId: voucher.id,
          afterState: { totalToAllocate, totalDiscount, count: dto.allocations.length },
        },
        tx
      );

      return {
        allocations: allocationRecords,
        voucherUnallocatedRemaining: newVoucherUnallocated.toFixed(4),
        journalEntryId: allocJournal.id,
      };
    });
  }

  /**
   * 4. Unmatch / Reverse AP Allocation
   */
  async unmatchAllocation(context: TenantContext, allocationId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [alloc] = await tx
        .select()
        .from(apPaymentAllocations)
        .where(
          and(
            eq(apPaymentAllocations.tenantId, context.tenantId),
            eq(apPaymentAllocations.id, allocationId)
          )
        )
        .limit(1);

      if (!alloc) throw new NotFoundException('سجل التخصيص غير موجود');
      if (alloc.status === 'REVERSED') {
        throw new BadRequestException('تم إلغاء هذا التخصيص مسبقاً');
      }

      const allocatedAmt = parseFloat(alloc.allocatedAmount);
      const discountAmt = parseFloat(alloc.discountAmount || '0');
      const totalReversal = allocatedAmt + discountAmt;

      // 1. Restore Invoice Remaining Amount
      const [invoice] = await tx
        .select()
        .from(apInvoices)
        .where(eq(apInvoices.id, alloc.invoiceId))
        .limit(1);

      if (invoice) {
        const newRemaining = parseFloat(invoice.remainingAmount) + totalReversal;
        const newPaid = Math.max(0, parseFloat(invoice.paidAmount) - allocatedAmt);
        await tx
          .update(apInvoices)
          .set({
            remainingAmount: newRemaining.toFixed(4),
            paidAmount: newPaid.toFixed(4),
            status: newRemaining >= parseFloat(invoice.grandTotal) ? 'POSTED' : 'PARTIALLY_PAID',
          })
          .where(eq(apInvoices.id, invoice.id));
      }

      // 2. Restore Voucher Unallocated Amount
      const [voucher] = await tx
        .select()
        .from(paymentVouchers)
        .where(eq(paymentVouchers.id, alloc.paymentVoucherId))
        .limit(1);

      if (voucher) {
        const newUnallocated = parseFloat(voucher.unallocatedAmount || '0') + allocatedAmt;
        await tx
          .update(paymentVouchers)
          .set({
            unallocatedAmount: newUnallocated.toFixed(4),
          })
          .where(eq(paymentVouchers.id, voucher.id));
      }

      // 3. Mark Allocation Reversed
      await tx
        .update(apPaymentAllocations)
        .set({ status: 'REVERSED' })
        .where(eq(apPaymentAllocations.id, alloc.id));

      // 4. Reverse GL Entry
      const apControlAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '211000');
      const prepaymentsAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '115000');

      const lines: any[] = [
        {
          accountId: prepaymentsAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'VENDOR',
          debit: allocatedAmt.toFixed(4),
          credit: 0,
          description: `إعادة الرصيد كدفعة مقدمة غير مخصصة للمورد`,
        },
        {
          accountId: apControlAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'VENDOR',
          debit: 0,
          credit: totalReversal.toFixed(4),
          description: `إعادة فتح ذمة المورد لإلغاء التخصيص`,
        },
      ];

      if (discountAmt > 0) {
        const discountAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '422000');
        lines.push({
          accountId: discountAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'VENDOR',
          debit: discountAmt.toFixed(4),
          credit: 0,
          description: `عكس خصم تعجيل السداد المكتسب من المورد`,
        });
      }

      const journalNumber = `REV-AL-AP-${Date.now().toString().slice(-6)}`;
      await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: alloc.legalEntityId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AP_ALLOCATION_REVERSAL',
          sourceId: alloc.id,
          description: `إلغاء وعكس تخصيص سند صرف ${alloc.paymentVoucherId}`,
          lines,
        },
        tx
      );

      return { success: true, message: 'تم عكس التخصيص وإعادة فتح الفاتورة والسند بنجاح' };
    });
  }
}
