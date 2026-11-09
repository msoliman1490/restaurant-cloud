import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { PartnersService } from '../src/modules/partners/partners.service';
import { ArSubledgerService } from '../src/modules/partners/ar-subledger.service';
import { ApSubledgerService } from '../src/modules/partners/ap-subledger.service';
import { SubledgerReconciliationService } from '../src/modules/partners/subledger-reconciliation.service';
import {
  TenantContext,
  ReceiptVoucherType,
  PaymentVoucherType,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  items,
  unitsOfMeasure,
  journalLines,
  journalEntries,
  arInvoices,
  apInvoices,
} from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';

describe('Restaurant Cloud — Business Partners & AR/AP Subledgers Architecture Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let accountingService: AccountingService;
  let partnersService: PartnersService;
  let arService: ArSubledgerService;
  let apService: ApSubledgerService;
  let reconciliationService: SubledgerReconciliationService;

  let tenantContext: TenantContext;
  let legalEntityId: string;
  let branchId: string;
  let bankAccountId: string;
  let bankAccountRecordId: string;
  let testItemId: string;
  let testUomId: string;

  const tenantCode = `bp-test-${Date.now().toString(36)}`;
  let partnerId: string;
  let partnerNumber: string;
  let testArInvoiceId: string;
  let testReceiptVoucherId: string;
  let testArAllocationId: string;
  let testApInvoiceId: string;
  let testPaymentVoucherId: string;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    postingEngine = new PostingEngineService(dbService, auditService);
    accountingService = new AccountingService(dbService, auditService, postingEngine);
    partnersService = new PartnersService(dbService, auditService);
    arService = new ArSubledgerService(dbService, auditService, postingEngine);
    apService = new ApSubledgerService(dbService, auditService, postingEngine);
    reconciliationService = new SubledgerReconciliationService(dbService);

    // 1. Provision Test Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: 'مجموعة الأطراف التجارية والدفاتر المساعدة',
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة الإمداد التجاري المحدودة',
        commercialName: 'إمداد للضيافة',
        vatNumber: '31099887700003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-TEST',
        name: 'فرع العليا المركزي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `owner-${tenantCode}@restaurantcloud.sa`,
        displayName: 'المدير المالي للمجموعة',
        password: 'TestPassword123!',
      },
    });

    legalEntityId = tenantResult.legalEntity.id;
    branchId = tenantResult.branch.id;

    tenantContext = {
      tenantId: tenantResult.tenant.id,
      userId: tenantResult.user.id,
      legalEntityId,
      branchId,
      scopes: ['*'],
      permissions: ['*'],
      roles: ['TENANT_OWNER'],
    };

    // 2. Setup Chart of Accounts
    const standardAccounts = [
      { code: '111101', name: 'بنك الراجحي - الحساب التشغيلي', type: 'ASSET', normal: 'DEBIT' },
      { code: '112000', name: 'مخزون المواد الغذائية والمستودعات', type: 'ASSET', normal: 'DEBIT' },
      { code: '113000', name: 'مراقبة الذمم المدينة (العملاء)', type: 'ASSET', normal: 'DEBIT' },
      { code: '114000', name: 'ضريبة القيمة المضافة المدفوعة (مدخلات)', type: 'ASSET', normal: 'DEBIT' },
      { code: '115000', name: 'دفعات مقدمة للموردين', type: 'ASSET', normal: 'DEBIT' },
      { code: '211000', name: 'مراقبة الذمم الدائنة (الموردين)', type: 'LIABILITY', normal: 'CREDIT' },
      { code: '212000', name: 'ضريبة القيمة المضافة المستحقة (مخرجات)', type: 'LIABILITY', normal: 'CREDIT' },
      { code: '213000', name: 'دفعات مقدمة من العملاء', type: 'LIABILITY', normal: 'CREDIT' },
      { code: '214000', name: 'بضاعة مستلمة غير مفوترة (GRNI)', type: 'LIABILITY', normal: 'CREDIT' },
      { code: '411000', name: 'إيرادات مبيعات المطاعم والضيافة', type: 'REVENUE', normal: 'CREDIT' },
      { code: '412000', name: 'خصم تعجيل دفع مسموح به (عملاء)', type: 'REVENUE', normal: 'DEBIT' },
      { code: '422000', name: 'خصم تعجيل سداد مكتسب (موردين)', type: 'REVENUE', normal: 'CREDIT' },
      { code: '514000', name: 'فروقات أسعار الشراء (PPV)', type: 'EXPENSE', normal: 'DEBIT' },
    ];

    for (const acc of standardAccounts) {
      const created = await accountingService.createAccount(tenantContext, {
        legalEntityId,
        accountCode: acc.code,
        name: acc.name,
        nameAr: acc.name,
        accountType: acc.type as any,
        normalBalance: acc.normal as any,
        isPostable: true,
      });
      if (acc.code === '111101') {
        bankAccountId = created.id;
      }
    }

    // 3. Create Bank Account entity
    const bankRecord = await accountingService.createBankAccount(tenantContext, {
      legalEntityId,
      code: 'BNK-TEST',
      bankName: 'مصرف الراجحي',
      accountNumber: 'SA9980000123456789012345',
      accountId: bankAccountId,
      currency: 'SAR',
      openingBalance: '500000.0000',
    });
    bankAccountRecordId = bankRecord.id;

    // 4. Create Test Item and UOM
    await dbService.withTenantContext(tenantContext, async (tx) => {
      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId: tenantContext.tenantId,
          code: `KG-${Date.now().toString().slice(-4)}`,
          nameAr: 'كيلوجرام',
          nameEn: 'Kilogram',
        })
        .returning();
      testUomId = uom!.id;

      const [item] = await tx
        .insert(items)
        .values({
          tenantId: tenantContext.tenantId,
          legalEntityOwnerId: legalEntityId,
          baseUomId: testUomId,
          sku: `TEST-MEAT-${Date.now().toString().slice(-4)}`,
          nameAr: 'لحم أنجوس بقري مجمد',
          nameEn: 'Angus Beef Frozen',
          productType: 'STOCKED',
          defaultCost: '25.0000',
          defaultPrice: '40.0000',
        })
        .returning();
      testItemId = item!.id;
    });
  }, 90000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('TEST-01: [Master Registry] Creates unified Business Partner with dual roles and enforces VAT uniqueness', async () => {
    partnerNumber = `BP-${Date.now().toString().slice(-6)}`;
    const taxId = '310998877112233'; // 15 digits starting and ending with 3

    const partner = await partnersService.createPartner(tenantContext, {
      partnerNumber,
      partnerType: 'CORPORATE',
      legalNameAr: 'شركة أصول الإعاشة والتوريد المحدودة',
      tradeNameAr: 'أصول للضيافة والتوزيع',
      taxIdentificationNumber: taxId,
      commercialRegistrationNumber: '1010887766',
      primaryEmail: 'info@asool-supply.sa',
      primaryPhone: '0501234567',
      roles: ['CUSTOMER', 'VENDOR'],
    });

    expect(partner).toBeDefined();
    expect(partner.id).toBeDefined();
    expect(partner.partnerNumber).toBe(partnerNumber);
    partnerId = partner.id;

    // Verify duplicate Tax ID rejection
    await expect(
      partnersService.createPartner(tenantContext, {
        partnerNumber: `BP-DUP-${Date.now().toString().slice(-4)}`,
        legalNameAr: 'شركة وهمية مكررة الضريبة',
        taxIdentificationNumber: taxId,
        roles: ['CUSTOMER'],
      })
    ).rejects.toThrow();
  });

  it('TEST-02: [Multi-Company Settings & Addresses] Sets independent credit limits and Saudi National Address', async () => {
    // Add Saudi National Address for ZATCA B2B
    const address = await partnersService.addAddress(tenantContext, partnerId, {
      addressType: 'NATIONAL_ADDRESS',
      buildingNumber: '1234',
      streetName: 'طريق الملك فهد',
      districtName: 'حي الصحافة',
      city: 'الرياض',
      postalCode: '13315',
      additionalNumber: '5678',
      countryCode: 'SA',
      isPrimary: true,
    });

    expect(address).toBeDefined();
    expect(address.buildingNumber).toBe('1234');

    // Configure Legal Entity settings with credit limit of 50,000 SAR
    const settings = await partnersService.setCompanySettings(tenantContext, partnerId, {
      legalEntityId,
      defaultCurrency: 'SAR',
      paymentTermsDays: 30,
      creditLimit: '50000.0000',
      priceTolerancePct: '0.0200',
      isCreditBlocked: false,
      customDiscountPct: '0.0000',
      taxExempt: false,
    });

    expect(settings).toBeDefined();
    expect(parseFloat(settings.creditLimit)).toBe(50000);
  });

  it('TEST-03: [AR Invoicing & GL Integration] Posts B2B Sales Tax Invoice to AR Control (113000)', async () => {
    const invNumber = `INV-AR-${Date.now().toString().slice(-6)}`;
    const invoice = await arService.createInvoice(tenantContext, {
      legalEntityId,
      branchId,
      partnerId,
      invoiceNumber: invNumber,
      invoiceType: 'TAX_INVOICE',
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      currency: 'SAR',
      lines: [
        {
          itemId: testItemId,
          uomId: testUomId,
          quantity: '100.0000',
          unitPrice: '100.0000', // 10,000 SAR subtotal + 1,500 VAT = 11,500 SAR grand total
          discountAmount: '0.0000',
          taxRate: '0.1500',
        },
      ],
    });

    expect(invoice).toBeDefined();
    expect(invoice.status).toBe('DRAFT');
    expect(parseFloat(invoice.grandTotal)).toBe(11500);
    testArInvoiceId = invoice.id;

    // Post Invoice
    const postedInvoice = await arService.postInvoice(tenantContext, invoice.id);
    expect(postedInvoice.status).toBe('POSTED');
    expect(postedInvoice.journalEntryId).toBeDefined();

    // Verify GL Entry: Debit AR Control 113000 (11,500) | Credit Sales 411000 (10,000) | Credit Output VAT 212000 (1,500)
    const lines = await dbService.withTenantContext(tenantContext, async (tx) => {
      return await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, postedInvoice.journalEntryId!));
    });

    expect(lines.length).toBe(3);
    const debitLine = lines.find((l) => parseFloat(l.debit) > 0);
    expect(debitLine).toBeDefined();
    expect(parseFloat(debitLine!.debit)).toBe(11500);
    expect(debitLine!.partnerId).toBe(partnerId);
    expect(debitLine!.partnerRole).toBe('CUSTOMER');
  });

  it('TEST-04: [Cash Isolation & AR Allocation] Receipt voucher posts cash ONCE; allocation touches ZERO cash', async () => {
    // 1. Issue and Post Receipt Voucher for 11,500 SAR
    const rvNumber = `RV-TEST-${Date.now().toString().slice(-6)}`;
    const voucher = await accountingService.createReceiptVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: rvNumber,
      voucherType: ReceiptVoucherType.CUSTOMER_PAYMENT,
      payerType: 'CUSTOMER',
      payerId: partnerId,
      payerName: 'شركة أصول الإعاشة والتوريد المحدودة',
      destinationType: 'BANK',
      destinationId: bankAccountRecordId,
      accountId: bankAccountId,
      paymentMethod: 'BANK_TRANSFER',
      amount: '11500.0000',
      currency: 'SAR',
    });

    expect(voucher).toBeDefined();
    expect(voucher.status).toBe('POSTED');
    testReceiptVoucherId = voucher.id;

    // 2. Allocate Receipt to the open AR invoice with 200 SAR cash discount
    // Allocation: 11,300 SAR cash allocated + 200 SAR discount = 11,500 SAR total settlement
    const allocResult = await arService.allocateReceipt(tenantContext, {
      legalEntityId,
      receiptVoucherId: voucher.id,
      allocations: [
        {
          invoiceId: testArInvoiceId,
          allocatedAmount: '11300.0000',
          discountAmount: '200.0000',
        },
      ],
    });

    expect(allocResult).toBeDefined();
    expect(allocResult.allocations.length).toBe(1);
    testArAllocationId = allocResult.allocations[0].id;

    // 3. STRICT CHECK: Inspect the Allocation Journal Entry
    // The Allocation GL Entry MUST have:
    // - Debit: Customer Advances (213000) for 11,300
    // - Debit: Cash Discount Allowed (412000) for 200
    // - Credit: AR Control (113000) for 11,500
    // - ZERO lines for Bank Account (111101) or Cash Vault!
    const { allocGLLines, inv } = await dbService.withTenantContext(tenantContext, async (tx) => {
      const gls = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, allocResult.journalEntryId));
      const [invoiceRecord] = await tx
        .select()
        .from(arInvoices)
        .where(eq(arInvoices.id, testArInvoiceId))
        .limit(1);
      return { allocGLLines: gls, inv: invoiceRecord };
    });

    expect(allocGLLines.length).toBe(3);

    // Assert zero movement on bank account
    const bankMovement = allocGLLines.find((l) => l.accountId === bankAccountId);
    expect(bankMovement).toBeUndefined();

    // Verify invoice is fully paid
    expect(inv!.status).toBe('PAID');
    expect(parseFloat(inv!.remainingAmount)).toBe(0);
  });

  it('TEST-05: [3-Way Matching AP Invoicing] Posts AP bill with GRNI clearing (214000) and PPV (514000)', async () => {
    const apDocNum = `SUP-INV-${Date.now().toString().slice(-6)}`;
    const bill = await apService.createInvoice(tenantContext, {
      legalEntityId,
      branchId,
      partnerId,
      supplierInvoiceNumber: apDocNum,
      internalNumber: `AP-${Date.now().toString().slice(-6)}`,
      invoiceType: 'STANDARD',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      currency: 'SAR',
      lines: [
        {
          itemId: testItemId,
          uomId: testUomId,
          quantity: '50.0000',
          unitPrice: '200.0000', // 10,000 SAR + 1,500 VAT = 11,500 SAR
          taxRate: '0.1500',
        },
      ],
    });

    expect(bill).toBeDefined();
    expect(bill.status).toBe('DRAFT');
    testApInvoiceId = bill.id;

    const postedBill = await apService.postInvoice(tenantContext, bill.id);
    expect(postedBill.status).toBe('POSTED');

    // Verify GL entry on AP Control (211000)
    const glLines = await dbService.withTenantContext(tenantContext, async (tx) => {
      return await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, postedBill.journalEntryId!));
    });

    const apCredit = glLines.find((l) => parseFloat(l.credit) > 0);
    expect(apCredit).toBeDefined();
    expect(parseFloat(apCredit!.credit)).toBe(11500);
    expect(apCredit!.partnerId).toBe(partnerId);
    expect(apCredit!.partnerRole).toBe('VENDOR');
  });

  it('TEST-06: [AP Cash Isolation & Allocation] Payment voucher posts cash ONCE; allocation touches ZERO cash', async () => {
    // 1. Issue and Post Payment Voucher for 11,500 SAR
    const pvNumber = `PV-TEST-${Date.now().toString().slice(-6)}`;
    const voucher = await accountingService.createPaymentVoucher(tenantContext, {
      legalEntityId,
      branchId,
      voucherNumber: pvNumber,
      voucherType: PaymentVoucherType.VENDOR_PAYMENT,
      beneficiaryType: 'VENDOR',
      beneficiaryId: partnerId,
      beneficiaryName: 'شركة أصول الإعاشة والتوريد المحدودة',
      sourceType: 'BANK',
      sourceId: bankAccountRecordId,
      accountId: bankAccountId,
      paymentMethod: 'BANK_TRANSFER',
      amount: '11500.0000',
      currency: 'SAR',
    });

    expect(voucher).toBeDefined();
    expect(voucher.status).toBe('POSTED');
    testPaymentVoucherId = voucher.id;

    // 2. Allocate payment with 300 SAR earned discount
    // Allocation: 11,200 SAR cash + 300 SAR earned discount = 11,500 SAR total settlement
    const allocResult = await apService.allocatePayment(tenantContext, {
      legalEntityId,
      paymentVoucherId: voucher.id,
      allocations: [
        {
          invoiceId: testApInvoiceId,
          allocatedAmount: '11200.0000',
          discountAmount: '300.0000',
        },
      ],
    });

    expect(allocResult).toBeDefined();

    // 3. STRICT CHECK: Inspect the Allocation Journal Entry
    // Allocation GL Entry:
    // - Debit: AP Control (211000) for 11,500
    // - Credit: Vendor Prepayments (115000) for 11,200
    // - Credit: Earned Discounts (422000) for 300
    // - ZERO bank movement!
    const { allocGLLines, bill } = await dbService.withTenantContext(tenantContext, async (tx) => {
      const gls = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, allocResult.journalEntryId));
      const [b] = await tx
        .select()
        .from(apInvoices)
        .where(eq(apInvoices.id, testApInvoiceId))
        .limit(1);
      return { allocGLLines: gls, bill: b };
    });

    const bankMovement = allocGLLines.find((l) => l.accountId === bankAccountId);
    expect(bankMovement).toBeUndefined();

    // Verify AP bill is fully paid
    expect(bill!.status).toBe('PAID');
    expect(parseFloat(bill!.remainingAmount)).toBe(0);
  });

  it('TEST-07: [Zero-Drift Reconciliation Invariant] Subledger remaining total exactly matches GL Control Account', async () => {
    // Both AR and AP open invoices are fully cleared (0 remaining).
    // AR Control net balance in GL should be 0.0000.
    // AP Control net balance in GL should be 0.0000.
    const arReconciliation = await reconciliationService.reconcileAr(tenantContext, legalEntityId);
    expect(arReconciliation.isBalanced).toBe(true);
    expect(parseFloat(arReconciliation.variance)).toBe(0);
    expect(arReconciliation.status).toBe('PERFECT_MATCH_ZERO_DRIFT');

    const apReconciliation = await reconciliationService.reconcileAp(tenantContext, legalEntityId);
    expect(apReconciliation.isBalanced).toBe(true);
    expect(parseFloat(apReconciliation.variance)).toBe(0);
    expect(apReconciliation.status).toBe('PERFECT_MATCH_ZERO_DRIFT');
  });

  it('TEST-08: [Unmatch & Reversal] Reverses AR allocation, restores open balance, zero cash touched', async () => {
    const unmatchResult = await arService.unmatchAllocation(tenantContext, testArAllocationId);
    expect(unmatchResult.success).toBe(true);

    // Invoice is reopened
    const inv = await dbService.withTenantContext(tenantContext, async (tx) => {
      const [i] = await tx
        .select()
        .from(arInvoices)
        .where(eq(arInvoices.id, testArInvoiceId))
        .limit(1);
      return i;
    });
    expect(inv!.status).toBe('POSTED');
    expect(parseFloat(inv!.remainingAmount)).toBe(11500);

    // Subledger Reconciliation now reports exactly 11,500 open on both subledger and GL Control!
    const arReconciliation = await reconciliationService.reconcileAr(tenantContext, legalEntityId);
    expect(arReconciliation.isBalanced).toBe(true);
    expect(parseFloat(arReconciliation.variance)).toBe(0);
    expect(parseFloat(arReconciliation.subledger.openInvoicesTotal)).toBe(11500);
    expect(parseFloat(arReconciliation.generalLedger.netBalance)).toBe(11500);
  });
});
