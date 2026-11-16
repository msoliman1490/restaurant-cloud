import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, users } from './tenants.js';
import { bankAccounts, chartOfAccounts, journalEntries } from './finance.js';
import { payments, salesOrders } from './sales.js';

// 1. Settlement Providers (Payment Gateways & Delivery Aggregators per Legal Entity)
export const settlementProviders = pgTable(
  'settlement_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 150 }).notNull(),
    nameEn: varchar('name_en', { length: 150 }).notNull(),
    category: varchar('category', { length: 30 }).notNull(), // PAYMENT_GATEWAY | DELIVERY_AGGREGATOR
    matchingStrategy: varchar('matching_strategy', { length: 50 }).notNull().default('REFERENCE_AND_AMOUNT'),
    clearingMappingKey: varchar('clearing_mapping_key', { length: 60 }).notNull(),
    feeMappingKey: varchar('fee_mapping_key', { length: 60 }).notNull(),
    defaultFeeRate: numeric('default_fee_rate', { precision: 7, scale: 4 }).notNull().default('0.0000'),
    vatOnFeeApplicable: boolean('vat_on_fee_applicable').notNull().default(true),
    defaultBankAccountId: uuid('default_bank_account_id').references(() => bankAccounts.id),
    isActive: boolean('is_active').notNull().default(true),
    configJson: jsonb('config_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settlement_providers_tenant').on(table.tenantId),
    uniqueIndex('idx_settlement_providers_entity_code').on(table.tenantId, table.legalEntityId, table.code),
  ]
);

// 2. Settlement Import Files (Idempotency & Audit of Imported CSV / Excel / API Statements)
export const settlementImportFiles = pgTable(
  'settlement_import_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    providerId: uuid('provider_id').notNull().references(() => settlementProviders.id),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileHash: varchar('file_hash', { length: 128 }).notNull(),
    format: varchar('format', { length: 20 }).notNull().default('CSV'), // CSV | EXCEL | JSON_API
    status: varchar('status', { length: 30 }).notNull().default('PROCESSING'), // PROCESSING | COMPLETED | FAILED
    totalRows: integer('total_rows').notNull().default(0),
    matchedRows: integer('matched_rows').notNull().default(0),
    discrepancyRows: integer('discrepancy_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    errorsJson: jsonb('errors_json'),
    importedBy: uuid('imported_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_settlement_import_tenant').on(table.tenantId),
    uniqueIndex('idx_settlement_import_unique_hash').on(table.tenantId, table.legalEntityId, table.providerId, table.fileHash),
  ]
);

// 3. Settlement Batches
export const settlementBatches = pgTable(
  'settlement_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    providerId: uuid('provider_id').notNull().references(() => settlementProviders.id),
    importFileId: uuid('import_file_id').references(() => settlementImportFiles.id),
    batchNumber: varchar('batch_number', { length: 80 }).notNull(),
    settlementType: varchar('settlement_type', { length: 30 }).notNull(), // PAYMENT_GATEWAY | DELIVERY_AGGREGATOR
    settlementDate: timestamp('settlement_date', { withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
    grossAmount: numeric('gross_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    cancelledAmount: numeric('cancelled_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    restaurantDiscountAmount: numeric('restaurant_discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    platformDiscountAmount: numeric('platform_discount_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    deliveryFeeAmount: numeric('delivery_fee_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    feeAmount: numeric('fee_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    feeTaxAmount: numeric('fee_tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    withheldAmount: numeric('withheld_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    netExpectedAmount: numeric('net_expected_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    bankReceivedAmount: numeric('bank_received_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    varianceAmount: numeric('variance_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    hasValidTaxInvoice: boolean('has_valid_tax_invoice').notNull().default(false),
    taxInvoiceNumber: varchar('tax_invoice_number', { length: 100 }),
    isVatRecoverable: boolean('is_vat_recoverable').notNull().default(false),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    bankReference: varchar('bank_reference', { length: 120 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    postedBy: uuid('posted_by').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settlement_batches_tenant').on(table.tenantId),
    index('idx_settlement_batches_entity_status').on(table.tenantId, table.legalEntityId, table.status),
    index('idx_settlement_batches_provider_date').on(table.providerId, table.settlementDate),
    uniqueIndex('idx_settlement_batches_entity_num').on(table.tenantId, table.legalEntityId, table.batchNumber),
    uniqueIndex('idx_settlement_batches_idempotency').on(table.tenantId, table.idempotencyKey),
  ]
);

// 4. Settlement Batch Lines (Gateway / Aggregator Statement Lines)
export const settlementBatchLines = pgTable(
  'settlement_batch_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    batchId: uuid('batch_id').notNull().references(() => settlementBatches.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id').notNull().references(() => settlementProviders.id),
    lineNumber: integer('line_number').notNull(),
    externalRef: varchar('external_ref', { length: 150 }),
    orderNumber: varchar('order_number', { length: 100 }),
    paymentMethod: varchar('payment_method', { length: 50 }),
    transactionDate: timestamp('transaction_date', { withTimezone: true }),
    grossAmount: numeric('gross_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    discountRestaurant: numeric('discount_restaurant', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    discountPlatform: numeric('discount_platform', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    deliveryFee: numeric('delivery_fee', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    feeAmount: numeric('fee_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    feeTaxAmount: numeric('fee_tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    withheldAmount: numeric('withheld_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    netAmount: numeric('net_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    matchedPaymentId: uuid('matched_payment_id').references(() => payments.id),
    matchedOrderId: uuid('matched_order_id').references(() => salesOrders.id),
    systemAmount: numeric('system_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    settledAmount: numeric('settled_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    matchStatus: varchar('match_status', { length: 40 }).notNull().default('MATCHED'),
    rawRowJson: jsonb('raw_row_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settlement_lines_tenant').on(table.tenantId),
    index('idx_settlement_lines_batch').on(table.batchId),
    index('idx_settlement_lines_ext_ref').on(table.tenantId, table.externalRef),
    index('idx_settlement_lines_payment').on(table.matchedPaymentId),
    index('idx_settlement_lines_order').on(table.matchedOrderId),
  ]
);

// 5. Settlement Discrepancies & Suspense Items
export const settlementDiscrepancies = pgTable(
  'settlement_discrepancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    batchId: uuid('batch_id').notNull().references(() => settlementBatches.id, { onDelete: 'cascade' }),
    batchLineId: uuid('batch_line_id').references(() => settlementBatchLines.id, { onDelete: 'set null' }),
    discrepancyType: varchar('discrepancy_type', { length: 50 }).notNull(),
    sourceSystem: varchar('source_system', { length: 40 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    description: text('description').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('OPEN'),
    resolutionNotes: text('resolution_notes'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settlement_disc_tenant_batch').on(table.tenantId, table.batchId),
    index('idx_settlement_disc_status').on(table.tenantId, table.status),
  ]
);

// 6. Bank Settlement Transactions (Explicit Bank Transfer Proof Records)
export const bankSettlementTransactions = pgTable(
  'bank_settlement_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    batchId: uuid('batch_id').notNull().references(() => settlementBatches.id),
    bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
    bankReference: varchar('bank_reference', { length: 120 }).notNull(),
    receivedAmount: numeric('received_amount', { precision: 14, scale: 4 }).notNull(),
    receivedDate: timestamp('received_date', { withTimezone: true }).notNull().defaultNow(),
    journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_bank_settlement_tenant').on(table.tenantId),
    uniqueIndex('idx_bank_settlement_batch_unique').on(table.batchId),
  ]
);
