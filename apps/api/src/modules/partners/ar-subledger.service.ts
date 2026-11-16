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
  arInvoices,
  arInvoiceLines,
  arReceiptAllocations,
  receiptVouchers,
  businessPartners,
  partnerCompanySettings,
  partnerBalances,
  chartOfAccounts,
} from '@restaurant-cloud/database';
import {
  CreateArInvoiceRequest,
  AllocateArReceiptRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, JournalType } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc } from 'drizzle-orm';

@Injectable()
export class ArSubledgerService {
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
   * 1. Create AR Invoice (Sales B2B Tax Invoice, Credit Note, or Debit Note)
   */
  async createInvoice(context: TenantContext, dto: CreateArInvoiceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Uniqueness check for invoiceNumber in this legal entity
      const [existing] = await tx
        .select({ id: arInvoices.id })
        .from(arInvoices)
        .where(
          and(
            eq(arInvoices.legalEntityId, dto.legalEntityId),
            eq(arInvoices.invoiceNumber, dto.invoiceNumber)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`رقم الفاتورة '${dto.invoiceNumber}' مسجل مسبقاً في هذه الشركة`);
      }

      // Compute lines and totals
      let subtotal = 0;
      let totalDiscount = 0;
      let taxableAmount = 0;
      let totalTax = 0;

      const processedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const price = parseFloat(l.unitPrice);
        const disc = parseFloat(l.discountAmount || '0');
        const taxRate = parseFloat(l.taxRate || '0.1500');

        const lineNet = Math.max(0, qty * price - disc);
        const lineTax = lineNet * taxRate;
        const lineTotal = lineNet + lineTax;

        subtotal += qty * price;
        totalDiscount += disc;
        taxableAmount += lineNet;
        totalTax += lineTax;

        return {
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: qty.toFixed(4),
          unitPrice: price.toFixed(4),
          discountAmount: disc.toFixed(4),
          taxRate: taxRate.toFixed(4),
          taxAmount: lineTax.toFixed(4),
          lineTotal: lineTotal.toFixed(4),
          notes: l.notes || null,
        };
      });

      const grandTotal = taxableAmount + totalTax;

      // Insert Header
      const [invoice] = await tx
        .insert(arInvoices)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          partnerId: dto.partnerId,
          invoiceNumber: dto.invoiceNumber,
          invoiceType: dto.invoiceType,
          originalInvoiceId: dto.originalInvoiceId || null,
          originalInvoiceUuid: dto.originalInvoiceUuid || null,
          originalInvoiceNumber: dto.originalInvoiceNumber || null,
          originalInvoiceDate: dto.originalInvoiceDate ? (dto.originalInvoiceDate as any) : null,
          zatcaReasonCode: dto.zatcaReasonCode || null,
          status: 'DRAFT',
          issueDate: dto.issueDate ? (dto.issueDate as any) : (new Date() as any),
          dueDate: dto.dueDate as any,
          currency: dto.currency || 'SAR',
          exchangeRate: dto.exchangeRate || '1.0000',
          subtotal: subtotal.toFixed(4),
          discountAmount: totalDiscount.toFixed(4),
          taxableAmount: taxableAmount.toFixed(4),
          taxAmount: totalTax.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          paidAmount: '0.0000',
          remainingAmount: grandTotal.toFixed(4),
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning();

      if (!invoice) throw new Error('فشل إنشاء ترويسة فاتورة المبيعات');

      // Insert Lines
      for (const line of processedLines) {
        await tx.insert(arInvoiceLines).values({
          tenantId: context.tenantId,
          invoiceId: invoice.id,
          ...line,
        });
      }

      return invoice;
    });
  }

  /**
   * 2. Post AR Invoice: Enforces Credit Limit, Generates GL Double-Entry, Updates Partner Balance
   */
  async postInvoice(context: TenantContext, invoiceId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [invoice] = await tx
        .select()
        .from(arInvoices)
        .where(
          and(
            eq(arInvoices.tenantId, context.tenantId),
            eq(arInvoices.id, invoiceId)
          )
        )
        .limit(1);

      if (!invoice) throw new NotFoundException('فاتورة المبيعات غير موجودة');
      if (invoice.status !== 'DRAFT') {
        throw new BadRequestException('يمكن فقط ترحيل الفواتير التي في حالة مسودة (DRAFT)');
      }

      const grandTotal = parseFloat(invoice.grandTotal);

      // Check Partner Company Settings & Credit Limit
      const [settings] = await tx
        .select()
        .from(partnerCompanySettings)
        .where(
          and(
            eq(partnerCompanySettings.legalEntityId, invoice.legalEntityId),
            eq(partnerCompanySettings.partnerId, invoice.partnerId)
          )
        )
        .limit(1);

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
        .limit(1)
        .for('update');

      const currentBalance = parseFloat(balance?.customerBalance || '0');
      const creditLimit = parseFloat(settings?.creditLimit || '0');

      if (settings?.isCreditBlocked) {
        throw new BadRequestException('تم إيقاف التعامل الائتماني مع هذا العميل');
      }

      if (creditLimit > 0 && currentBalance + grandTotal > creditLimit) {
        throw new BadRequestException(
          `تجاوز حد الائتمان: الرصيد القائم (${currentBalance.toFixed(2)}) + الفاتورة (${grandTotal.toFixed(2)}) يتجاوز الحد المعتمد (${creditLimit.toFixed(2)})`
        );
      }

      // Resolve Standard Chart of Accounts
      const arControlAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '113000');
      const revenueAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '411000');
      const vatAcc = await this.getAccountByCode(tx, context.tenantId, invoice.legalEntityId, '212000');

      // Post Balanced GL Entry via PostingEngineService
      const journalNumber = `JRN-AR-${invoice.invoiceNumber}`;
      const glEntry = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: invoice.legalEntityId,
          branchId: invoice.branchId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AR_INVOICE',
          sourceId: invoice.id,
          description: `استحقاق فاتورة مبيعات آجل رقم ${invoice.invoiceNumber}`,
          lines: [
            {
              accountId: arControlAcc.id,
              partnerId: invoice.partnerId,
              partnerRole: 'CUSTOMER',
              subledgerDocumentType: 'AR_INVOICE',
              subledgerDocumentId: invoice.id,
              debit: invoice.grandTotal,
              credit: 0,
              description: `ذمم مدينة - فاتورة مبيعات ${invoice.invoiceNumber}`,
            },
            {
              accountId: revenueAcc.id,
              debit: 0,
              credit: invoice.taxableAmount,
              description: `إيرادات مبيعات - فاتورة ${invoice.invoiceNumber}`,
            },
            {
              accountId: vatAcc.id,
              debit: 0,
              credit: invoice.taxAmount,
              description: `ضريبة مخرجات مستحقة - فاتورة ${invoice.invoiceNumber}`,
            },
          ],
        },
        tx
      );

      // Update Invoice Status
      const [updatedInvoice] = await tx
        .update(arInvoices)
        .set({
          status: 'POSTED',
          journalEntryId: glEntry.id,
          remainingAmount: invoice.grandTotal,
        })
        .where(eq(arInvoices.id, invoice.id))
        .returning();

      // Upsert Partner Balances
      if (balance) {
        await tx
          .update(partnerBalances)
          .set({
            customerBalance: (currentBalance + grandTotal).toFixed(4),
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
          customerBalance: grandTotal.toFixed(4),
        });
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'AR_INVOICE_POSTED',
          entityType: 'AR_INVOICE',
          entityId: invoice.id,
          afterState: { invoiceNumber: invoice.invoiceNumber, grandTotal },
        },
        tx
      );

      return updatedInvoice;
    });
  }

  /**
   * 3. Allocate Receipt Voucher against AR Invoices: ZERO CASH MOVEMENT
   *    Moves Customer Advances (213000) -> AR Control (113000) + Cash Discounts Allowed (412000).
   */
  async allocateReceipt(context: TenantContext, dto: AllocateArReceiptRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Lock and Verify Receipt Voucher
      const [voucher] = await tx
        .select()
        .from(receiptVouchers)
        .where(
          and(
            eq(receiptVouchers.tenantId, context.tenantId),
            eq(receiptVouchers.legalEntityId, dto.legalEntityId),
            eq(receiptVouchers.id, dto.receiptVoucherId)
          )
        )
        .limit(1);

      if (!voucher) throw new NotFoundException('سند القبض غير موجود أو لا ينتمي لهذه الشركة');
      if (voucher.status !== 'POSTED') {
        throw new BadRequestException('يجب أن يكون سند القبض مرحلاً (POSTED) لإجراء التخصيص');
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
      const arControlAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '113000');
      const advancesAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '213000');
      let discountAcc: any = null;
      if (totalDiscount > 0) {
        discountAcc = await this.getAccountByCode(tx, context.tenantId, dto.legalEntityId, '412000');
      }

      const allocationRecords = [];
      let partnerIdForJournal = voucher.payerId;

      // 2. Loop through invoice allocations
      for (const item of dto.allocations) {
        const [invoice] = await tx
          .select()
          .from(arInvoices)
          .where(
            and(
              eq(arInvoices.tenantId, context.tenantId),
              eq(arInvoices.legalEntityId, dto.legalEntityId),
              eq(arInvoices.id, item.invoiceId)
            )
          )
          .limit(1);

        if (!invoice) throw new NotFoundException(`فاتورة المبيعات ${item.invoiceId} غير موجودة`);
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

        // Insert Allocation Record
        const [allocRecord] = await tx
          .insert(arReceiptAllocations)
          .values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            receiptVoucherId: voucher.id,
            invoiceId: invoice.id,
            allocatedAmount: allocAmt.toFixed(4),
            discountAmount: discAmt.toFixed(4),
            status: 'POSTED',
          })
          .returning();

        allocationRecords.push(allocRecord);

        // Update Invoice Remaining & Status
        await tx
          .update(arInvoices)
          .set({
            paidAmount: newPaid.toFixed(4),
            remainingAmount: newRemaining.toFixed(4),
            status: newStatus,
          })
          .where(eq(arInvoices.id, invoice.id));
      }

      // 3. Decrement voucher unallocated amount
      const newVoucherUnallocated = Math.max(0, availableAmount - totalToAllocate);
      await tx
        .update(receiptVouchers)
        .set({
          unallocatedAmount: newVoucherUnallocated.toFixed(4),
        })
        .where(eq(receiptVouchers.id, voucher.id));

      // 4. Post Allocation GL Entry: STRICT ZERO CASH MOVEMENT
      const journalNumber = `JRN-AL-RV-${voucher.voucherNumber}-${Date.now().toString().slice(-4)}`;
      const glLines: any[] = [
        {
          accountId: advancesAcc.id,
          partnerId: partnerIdForJournal,
          partnerRole: 'CUSTOMER',
          debit: totalToAllocate.toFixed(4),
          credit: 0,
          description: `تسوية دفعات مقدمة - تخصيص سند قبض ${voucher.voucherNumber}`,
        },
      ];

      if (totalDiscount > 0 && discountAcc) {
        glLines.push({
          accountId: discountAcc.id,
          debit: totalDiscount.toFixed(4),
          credit: 0,
          description: `خصم تعجيل دفع مسموح به - تخصيص سند قبض ${voucher.voucherNumber}`,
        });
      }

      glLines.push({
        accountId: arControlAcc.id,
        partnerId: partnerIdForJournal,
        partnerRole: 'CUSTOMER',
        debit: 0,
        credit: (totalToAllocate + totalDiscount).toFixed(4),
        description: `إقفال ذمم مدينة - تخصيص سند قبض ${voucher.voucherNumber}`,
      });

      const allocJournal = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AR_ALLOCATION',
          sourceId: voucher.id,
          description: `تخصيص سند قبض ${voucher.voucherNumber} على فواتير المبيعات`,
          lines: glLines,
        },
        tx
      );

      // Link Journal Entry to Allocations
      for (const rec of allocationRecords) {
        if (!rec) continue;
        await tx
          .update(arReceiptAllocations)
          .set({ journalEntryId: allocJournal.id })
          .where(eq(arReceiptAllocations.id, rec.id));
      }

      // 5. Update partner balances: decrement customer_balance and customer_unallocated_receipts
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
          .limit(1)
          .for('update');

        if (bal) {
          const curBal = parseFloat(bal.customerBalance);
          const curAdv = parseFloat(bal.customerUnallocatedReceipts);
          await tx
            .update(partnerBalances)
            .set({
              customerBalance: Math.max(0, curBal - (totalToAllocate + totalDiscount)).toFixed(4),
              customerUnallocatedReceipts: Math.max(0, curAdv - totalToAllocate).toFixed(4),
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
          action: 'AR_RECEIPT_ALLOCATED',
          entityType: 'RECEIPT_VOUCHER',
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
   * 4. Unmatch / Reverse AR Allocation (Restores invoice & voucher balances without touching cash)
   */
  async unmatchAllocation(context: TenantContext, allocationId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [alloc] = await tx
        .select()
        .from(arReceiptAllocations)
        .where(
          and(
            eq(arReceiptAllocations.tenantId, context.tenantId),
            eq(arReceiptAllocations.id, allocationId)
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
        .from(arInvoices)
        .where(eq(arInvoices.id, alloc.invoiceId))
        .limit(1);

      if (invoice) {
        const newRemaining = parseFloat(invoice.remainingAmount) + totalReversal;
        const newPaid = Math.max(0, parseFloat(invoice.paidAmount) - allocatedAmt);
        await tx
          .update(arInvoices)
          .set({
            remainingAmount: newRemaining.toFixed(4),
            paidAmount: newPaid.toFixed(4),
            status: newRemaining >= parseFloat(invoice.grandTotal) ? 'POSTED' : 'PARTIALLY_PAID',
          })
          .where(eq(arInvoices.id, invoice.id));
      }

      // 2. Restore Voucher Unallocated Amount
      const [voucher] = await tx
        .select()
        .from(receiptVouchers)
        .where(eq(receiptVouchers.id, alloc.receiptVoucherId))
        .limit(1);

      if (voucher) {
        const newUnallocated = parseFloat(voucher.unallocatedAmount || '0') + allocatedAmt;
        await tx
          .update(receiptVouchers)
          .set({
            unallocatedAmount: newUnallocated.toFixed(4),
          })
          .where(eq(receiptVouchers.id, voucher.id));
      }

      // 3. Mark Allocation Reversed
      await tx
        .update(arReceiptAllocations)
        .set({ status: 'REVERSED' })
        .where(eq(arReceiptAllocations.id, alloc.id));

      // 4. Reverse GL Entry
      const arControlAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '113000');
      const advancesAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '213000');

      const lines: any[] = [
        {
          accountId: arControlAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'CUSTOMER',
          debit: totalReversal.toFixed(4),
          credit: 0,
          description: `إعادة فتح ذمة العميل لإلغاء التخصيص`,
        },
        {
          accountId: advancesAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'CUSTOMER',
          debit: 0,
          credit: allocatedAmt.toFixed(4),
          description: `إعادة الرصيد كدفعة مقدمة غير مخصصة`,
        },
      ];

      if (discountAmt > 0) {
        const discountAcc = await this.getAccountByCode(tx, context.tenantId, alloc.legalEntityId, '412000');
        lines.push({
          accountId: discountAcc.id,
          partnerId: invoice?.partnerId || null,
          partnerRole: 'CUSTOMER',
          debit: 0,
          credit: discountAmt.toFixed(4),
          description: `عكس خصم تعجيل الدفع المسموح به`,
        });
      }

      const journalNumber = `REV-AL-AR-${Date.now().toString().slice(-6)}`;
      await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: alloc.legalEntityId,
          journalNumber,
          journalType: JournalType.GENERAL,
          sourceType: 'AR_ALLOCATION_REVERSAL',
          sourceId: alloc.id,
          description: `إلغاء وعكس تخصيص سند قبض ${alloc.receiptVoucherId}`,
          lines,
        },
        tx
      );

      return { success: true, message: 'تم عكس التخصيص وإعادة فتح الفاتورة والسند بنجاح' };
    });
  }
}
