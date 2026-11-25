import { pgTable, uuid, varchar, timestamp, numeric, integer, boolean, text, uniqueIndex, index, date } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, warehouses } from './tenants.js';
import { items, unitsOfMeasure } from './catalog.js';
import { chartOfAccounts, journalEntries, paymentVouchers, receiptVouchers } from './finance.js';
import { purchaseOrders, goodsReceipts } from './purchasing.js';

// 1. Business Partners (سجل الأطراف الموحد)
export const businessPartners = pgTable(
  'business_partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    partnerNumber: varchar('partner_number', { length: 50 }).notNull(),
    partnerType: varchar('partner_type', { length: 20 }).notNull().default('CORPORATE'), // 'CORPORATE' | 'INDIVIDUAL'
    legalNameAr: varchar('legal_name_ar', { length: 255 }).notNull(),
    legalNameEn: varchar('legal_name_en', { length: 255 }),
    tradeNameAr: varchar('trade_name_ar', { length: 255 }),
    tradeNameEn: varchar('trade_name_en', { length: 255 }),
    taxIdentificationNumber: varchar('tax_identification_number', { length: 15 }),
    commercialRegistrationNumber: varchar('commercial_registration_number', { length: 10 }),
    nationalIdOrIqama: varchar('national_id_or_iqama', { length: 20 }),
    primaryEmail: varchar('primary_email', { length: 255 }),
    primaryPhone: varchar('primary_phone', { length: 50 }),
    website: varchar('website', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    isOnHold: boolean('is_on_hold').notNull().default(false),
    holdReason: text('hold_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_bp_tenant_id').on(table.tenantId),
    uniqueIndex('idx_bp_tenant_number').on(table.tenantId, table.partnerNumber),
    uniqueIndex('idx_bp_tenant_tax_id').on(table.tenantId, table.taxIdentificationNumber),
    uniqueIndex('idx_bp_tenant_crn').on(table.tenantId, table.commercialRegistrationNumber),
    uniqueIndex('uq_bp_tenant_id').on(table.id, table.tenantId),
  ]
);

// 2. Partner Roles (أدوار الأطراف)
export const partnerRoles = pgTable(
  'partner_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
    roleType: varchar('role_type', { length: 30 }).notNull(), // 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | 'BROKER'
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    effectiveFrom: date('effective_from').notNull().defaultNow(),
    effectiveTo: date('effective_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_partner_roles_lookup').on(table.tenantId, table.roleType, table.status),
    uniqueIndex('uq_partner_role_unique').on(table.partnerId, table.roleType),
  ]
);

// 3. Partner Addresses (العناوين الوطنية والتجارية)
export const partnerAddresses = pgTable(
  'partner_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
    addressType: varchar('address_type', { length: 30 }).notNull().default('NATIONAL_ADDRESS'), // 'NATIONAL_ADDRESS' | 'BILLING' | 'SHIPPING' | 'BRANCH_SITE'
    buildingNumber: varchar('building_number', { length: 10 }),
    streetName: varchar('street_name', { length: 255 }),
    districtName: varchar('district_name', { length: 100 }),
    city: varchar('city', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    additionalNumber: varchar('additional_number', { length: 10 }),
    unitNumber: varchar('unit_number', { length: 20 }),
    countryCode: varchar('country_code', { length: 3 }).notNull().default('SA'),
    country: varchar('country', { length: 100 }).notNull().default('المملكة العربية السعودية'),
    shortAddress: varchar('short_address', { length: 20 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_partner_addresses_partner').on(table.partnerId),
  ]
);

// 4. Partner Contacts (جهات الاتصال المعتمدة)
export const partnerContacts = pgTable(
  'partner_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    jobTitle: varchar('job_title', { length: 100 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    isAuthorizedSignatory: boolean('is_authorized_signatory').notNull().default(false),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_partner_contacts_partner').on(table.partnerId),
  ]
);

// 5. Partner Company Settings (إعدادات الطرف المستقلة لكل شركة قانونية)
export const partnerCompanySettings = pgTable(
  'partner_company_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
    defaultCurrency: varchar('default_currency', { length: 3 }).notNull().default('SAR'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    creditLimit: numeric('credit_limit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    isCreditBlocked: boolean('is_credit_blocked').notNull().default(false),
    priceTolerancePct: numeric('price_tolerance_pct', { precision: 5, scale: 4 }).notNull().default('0.0200'),
    arControlAccountId: uuid('ar_control_account_id').references(() => chartOfAccounts.id),
    apControlAccountId: uuid('ap_control_account_id').references(() => chartOfAccounts.id),
    customDiscountPct: numeric('custom_discount_pct', { precision: 5, scale: 4 }).notNull().default('0.0000'),
    priceTierId: uuid('price_tier_id'),
    taxExempt: boolean('tax_exempt').notNull().default(false),
    taxExemptionReason: text('tax_exemption_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_partner_company_unique').on(table.legalEntityId, table.partnerId),
    uniqueIndex('uq_partner_company_ref').on(table.id, table.legalEntityId, table.tenantId),
  ]
);

// 6. Partner Balances (الأرصدة اللحظية المستقلة لكل شركة وعملة)
export const partnerBalances = pgTable(
  'partner_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    customerBalance: numeric('customer_balance', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    customerUnallocatedReceipts: numeric('customer_unallocated_receipts', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    vendorBalance: numeric('vendor_balance', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    vendorUnallocatedPayments: numeric('vendor_unallocated_payments', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    lastTransactionAt: timestamp('last_transaction_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_partner_balance_entity_partner').on(table.legalEntityId, table.partnerId, table.currency),
  ]
);

// 7. AR Invoices (فواتير المبيعات بالدفتر المساعد للعملاء)
export const arInvoices = pgTable(
  'ar_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'restrict' }),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    invoiceType: varchar('invoice_type', { length: 30 }).notNull().default('TAX_INVOICE'), // 'TAX_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
    originalInvoiceId: uuid('original_invoice_id'),
    originalInvoiceUuid: varchar('original_invoice_uuid', { length: 100 }),
    originalInvoiceNumber: varchar('original_invoice_number', { length: 50 }),
    originalInvoiceDate: date('original_invoice_date'),
    zatcaReasonCode: varchar('zatca_reason_code', { length: 10 }),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'), // 'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'
    issueDate: date('issue_date').notNull().defaultNow(),
    dueDate: date('due_date').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxableAmount: numeric('taxable_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    remainingAmount: numeric('remaining_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    zatcaUuid: varchar('zatca_uuid', { length: 100 }),
    zatcaHash: varchar('zatca_hash', { length: 255 }),
    previousInvoiceHash: varchar('previous_invoice_hash', { length: 255 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_ar_invoices_entity_status').on(table.legalEntityId, table.status),
    index('idx_ar_invoices_partner').on(table.partnerId, table.status),
    uniqueIndex('uq_ar_invoices_ref').on(table.id, table.legalEntityId, table.tenantId),
    uniqueIndex('uq_ar_invoices_number').on(table.legalEntityId, table.invoiceNumber),
  ]
);

// 8. AR Invoice Lines
export const arInvoiceLines = pgTable(
  'ar_invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull().references(() => arInvoices.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
    notes: text('notes'),
  },
  (table) => [
    index('idx_ar_inv_lines_invoice').on(table.invoiceId),
  ]
);

// 9. AR Receipt Allocations (تخصيص المقبوضات على الفواتير)
export const arReceiptAllocations = pgTable(
  'ar_receipt_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    receiptVoucherId: uuid('receipt_voucher_id').notNull().references(() => receiptVouchers.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').notNull().references(() => arInvoices.id, { onDelete: 'restrict' }),
    allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 4 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    fxGainLoss: numeric('fx_gain_loss', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    allocationDate: date('allocation_date').notNull().defaultNow(),
    status: varchar('status', { length: 30 }).notNull().default('POSTED'), // 'DRAFT' | 'POSTED' | 'REVERSED'
    reversalOfId: uuid('reversal_of_id'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_ar_alloc_voucher').on(table.receiptVoucherId),
    index('idx_ar_alloc_invoice').on(table.invoiceId),
  ]
);

// 10. AP Invoices (فواتير المشتريات بالدفتر المساعد للموردين)
export const apInvoices = pgTable(
  'ap_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'restrict' }),
    supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 100 }).notNull(),
    internalNumber: varchar('internal_number', { length: 50 }).notNull(),
    invoiceType: varchar('invoice_type', { length: 30 }).notNull().default('STANDARD'), // 'STANDARD' | 'DEBIT_NOTE' | 'CREDIT_NOTE'
    originalInvoiceId: uuid('original_invoice_id'),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'), // 'DRAFT' | 'MATCHED' | 'PRICE_HOLD' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    goodsReceiptId: uuid('goods_receipt_id').references(() => goodsReceipts.id, { onDelete: 'restrict' }),
    matchingStatus: varchar('matching_status', { length: 30 }).notNull().default('UNMATCHED'), // 'UNMATCHED' | 'MATCHED_EXACT' | 'MATCHED_WITH_VARIANCE'
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    priceVarianceAmount: numeric('price_variance_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    remainingAmount: numeric('remaining_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_ap_invoices_entity_status').on(table.legalEntityId, table.status),
    index('idx_ap_invoices_partner').on(table.partnerId, table.status),
    uniqueIndex('uq_ap_invoices_ref').on(table.id, table.legalEntityId, table.tenantId),
    uniqueIndex('uq_ap_invoices_supplier_doc').on(table.legalEntityId, table.partnerId, table.supplierInvoiceNumber),
  ]
);

// 11. AP Invoice Lines
export const apInvoiceLines = pgTable(
  'ap_invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull().references(() => apInvoices.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
    notes: text('notes'),
  },
  (table) => [
    index('idx_ap_inv_lines_invoice').on(table.invoiceId),
  ]
);

// 12. AP Payment Allocations (تخصيص المدفوعات على فواتير المشتريات)
export const apPaymentAllocations = pgTable(
  'ap_payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    paymentVoucherId: uuid('payment_voucher_id').notNull().references(() => paymentVouchers.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').notNull().references(() => apInvoices.id, { onDelete: 'restrict' }),
    allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 4 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    fxGainLoss: numeric('fx_gain_loss', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    allocationDate: date('allocation_date').notNull().defaultNow(),
    status: varchar('status', { length: 30 }).notNull().default('POSTED'),
    reversalOfId: uuid('reversal_of_id'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_ap_alloc_voucher').on(table.paymentVoucherId),
    index('idx_ap_alloc_invoice').on(table.invoiceId),
  ]
);
