import { pgTable, uuid, varchar, timestamp, numeric, integer, boolean, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, warehouses, devices } from './tenants.js';
import {
  AccountType,
  NormalBalance,
  JournalStatus,
  JournalType,
  MovementType,
  MovementDirection,
  FiscalPeriodStatus,
  VoucherStatus,
  PaymentVoucherType,
  ReceiptVoucherType,
} from '@restaurant-cloud/domain-kernel';

// 1. Chart of Accounts (COA)
export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    accountCode: varchar('account_code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    nameAr: varchar('name_ar', { length: 255 }),
    nameEn: varchar('name_en', { length: 255 }),
    description: text('description'),
    accountType: varchar('account_type', { length: 30 }).notNull().default(AccountType.ASSET),
    normalBalance: varchar('normal_balance', { length: 10 }).notNull().default(NormalBalance.DEBIT),
    parentId: uuid('parent_id'),
    level: integer('level').notNull().default(1),
    isPostable: boolean('is_postable').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_coa_tenant_id').on(table.tenantId),
    index('idx_coa_parent_id').on(table.parentId),
    uniqueIndex('idx_coa_entity_account_code').on(table.legalEntityId, table.accountCode),
  ]
);

// 2. Cost Centers & Financial Dimensions
export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }),
    parentId: uuid('parent_id'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cost_centers_tenant_id').on(table.tenantId),
    uniqueIndex('idx_cost_centers_entity_code').on(table.legalEntityId, table.code),
  ]
);

// 3. Fiscal Periods
export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    periodName: varchar('period_name', { length: 50 }).notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default(FiscalPeriodStatus.OPEN),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fiscal_periods_tenant_id').on(table.tenantId),
    uniqueIndex('idx_fiscal_periods_entity_name').on(table.legalEntityId, table.periodName),
  ]
);

// 4. General Ledger Header (Journal Entries)
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    journalNumber: varchar('journal_number', { length: 50 }).notNull(),
    journalType: varchar('journal_type', { length: 30 }).notNull().default(JournalType.GENERAL),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    status: varchar('status', { length: 30 }).notNull().default(JournalStatus.POSTED),
    approvalStatus: varchar('approval_status', { length: 30 }).notNull().default('APPROVED'),
    debitTotal: numeric('debit_total', { precision: 14, scale: 4 }).notNull(),
    creditTotal: numeric('credit_total', { precision: 14, scale: 4 }).notNull(),
    description: text('description'),
    notes: text('notes'),
    documentDate: timestamp('document_date', { withTimezone: true }).defaultNow(),
    entryDate: timestamp('entry_date', { withTimezone: true }).defaultNow(),
    fiscalPeriodId: uuid('fiscal_period_id').references(() => fiscalPeriods.id),
    reversalOfId: uuid('reversal_of_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    postedBy: uuid('posted_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_journal_entries_tenant_id').on(table.tenantId),
    uniqueIndex('idx_journal_entries_entity_number').on(table.legalEntityId, table.journalNumber),
    index('idx_journal_entries_period').on(table.fiscalPeriodId),
  ]
);

// 5. General Ledger Lines (Journal Lines)
export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    branchId: uuid('branch_id').references(() => branches.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    debit: numeric('debit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    credit: numeric('credit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    description: varchar('description', { length: 255 }),
  },
  (table) => [
    index('idx_journal_lines_entry_id').on(table.journalEntryId),
    index('idx_journal_lines_account_id').on(table.accountId),
    index('idx_journal_lines_cost_center').on(table.costCenterId),
  ]
);

// 6. Configurable Default Account Mappings
export const accountMappings = pgTable(
  'account_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    mappingKey: varchar('mapping_key', { length: 50 }).notNull(),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    description: varchar('description', { length: 255 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_account_mappings_tenant_id').on(table.tenantId),
    uniqueIndex('idx_account_mappings_entity_key').on(table.legalEntityId, table.mappingKey),
  ]
);

// 7. Cash Vaults & Safes
export const cashVaults = pgTable(
  'cash_vaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    custodianId: uuid('custodian_id'),
    balance: numeric('balance', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cash_vaults_tenant_id').on(table.tenantId),
    uniqueIndex('idx_cash_vaults_entity_code').on(table.legalEntityId, table.code),
  ]
);

// 8. Bank Accounts
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    bankName: varchar('bank_name', { length: 255 }).notNull(),
    accountNumber: varchar('account_number', { length: 100 }).notNull(),
    iban: varchar('iban', { length: 50 }),
    swiftCode: varchar('swift_code', { length: 50 }),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    balance: numeric('balance', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_bank_accounts_tenant_id').on(table.tenantId),
    uniqueIndex('idx_bank_accounts_entity_acc_num').on(table.legalEntityId, table.accountNumber),
  ]
);

// 9. Payment Vouchers (سندات الصرف)
export const paymentVouchers = pgTable(
  'payment_vouchers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    voucherNumber: varchar('voucher_number', { length: 50 }).notNull(),
    voucherDate: timestamp('voucher_date', { withTimezone: true }).notNull().defaultNow(),
    voucherType: varchar('voucher_type', { length: 50 }).notNull().default(PaymentVoucherType.VENDOR_PAYMENT),
    beneficiaryType: varchar('beneficiary_type', { length: 50 }).default('VENDOR'),
    beneficiaryId: uuid('beneficiary_id'),
    beneficiaryName: varchar('beneficiary_name', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 20 }).notNull().default('VAULT'), // 'VAULT' | 'BANK'
    sourceId: uuid('source_id').notNull(),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id), // Debit account
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    paymentMethod: varchar('payment_method', { length: 30 }).notNull().default('CASH'),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
    status: varchar('status', { length: 30 }).notNull().default(VoucherStatus.POSTED),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_payment_vouchers_tenant_id').on(table.tenantId),
    uniqueIndex('idx_payment_vouchers_entity_number').on(table.legalEntityId, table.voucherNumber),
  ]
);

// 10. Receipt Vouchers (سندات القبض)
export const receiptVouchers = pgTable(
  'receipt_vouchers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    voucherNumber: varchar('voucher_number', { length: 50 }).notNull(),
    voucherDate: timestamp('voucher_date', { withTimezone: true }).notNull().defaultNow(),
    voucherType: varchar('voucher_type', { length: 50 }).notNull().default(ReceiptVoucherType.CUSTOMER_PAYMENT),
    payerType: varchar('payer_type', { length: 50 }).default('CUSTOMER'),
    payerId: uuid('payer_id'),
    payerName: varchar('payer_name', { length: 255 }).notNull(),
    destinationType: varchar('destination_type', { length: 20 }).notNull().default('VAULT'), // 'VAULT' | 'BANK'
    destinationId: uuid('destination_id').notNull(),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id), // Credit account
    paymentMethod: varchar('payment_method', { length: 30 }).notNull().default('CASH'),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
    status: varchar('status', { length: 30 }).notNull().default(VoucherStatus.POSTED),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_receipt_vouchers_tenant_id').on(table.tenantId),
    uniqueIndex('idx_receipt_vouchers_entity_number').on(table.legalEntityId, table.voucherNumber),
  ]
);

// 11. Expenses (إدارة المصروفات التشغيلية)
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    expenseNumber: varchar('expense_number', { length: 50 }).notNull(),
    expenseDate: timestamp('expense_date', { withTimezone: true }).notNull().defaultNow(),
    category: varchar('category', { length: 100 }).notNull(),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    vendorName: varchar('vendor_name', { length: 255 }),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 4 }).notNull(),
    paymentVoucherId: uuid('payment_voucher_id').references(() => paymentVouchers.id),
    status: varchar('status', { length: 30 }).notNull().default('APPROVED'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_expenses_tenant_id').on(table.tenantId),
    uniqueIndex('idx_expenses_entity_number').on(table.legalEntityId, table.expenseNumber),
  ]
);

// 12. Vault Transactions (سجل حركات الخزائن)
export const vaultTransactions = pgTable(
  'vault_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    vaultId: uuid('vault_id').notNull().references(() => cashVaults.id),
    transactionType: varchar('transaction_type', { length: 50 }).notNull(), // 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COUNT_VARIANCE'
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 14, scale: 4 }).notNull(),
    sourceDocumentType: varchar('source_document_type', { length: 50 }),
    sourceDocumentId: uuid('source_document_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    performedBy: uuid('performed_by'),
  },
  (table) => [
    index('idx_vault_tx_tenant_id').on(table.tenantId),
    index('idx_vault_tx_vault_id').on(table.vaultId),
  ]
);

// 13. Bank Reconciliations (مطابقة وتسوية البنوك)
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
    statementDate: timestamp('statement_date', { withTimezone: true }).notNull(),
    statementEndingBalance: numeric('statement_ending_balance', { precision: 14, scale: 4 }).notNull(),
    bookEndingBalance: numeric('book_ending_balance', { precision: 14, scale: 4 }).notNull(),
    reconciledBalance: numeric('reconciled_balance', { precision: 14, scale: 4 }).notNull(),
    discrepancy: numeric('discrepancy', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default('COMPLETED'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull().defaultNow(),
    reconciledBy: uuid('reconciled_by'),
  },
  (table) => [
    index('idx_bank_rec_tenant_id').on(table.tenantId),
    index('idx_bank_rec_acc_id').on(table.bankAccountId),
  ]
);

// 14. Inventory Balances (Advanced WMS)
export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityOwnerId: uuid('legal_entity_owner_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull(),
    lotId: uuid('lot_id'),
    onHandQty: numeric('on_hand_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    reservedQty: numeric('reserved_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    inTransitQty: numeric('in_transit_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    damagedQty: numeric('damaged_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    underInspectionQty: numeric('under_inspection_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    wacCost: numeric('wac_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    minStock: numeric('min_stock', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    maxStock: numeric('max_stock', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    reorderPoint: numeric('reorder_point', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_inventory_balances_tenant_id').on(table.tenantId),
    index('idx_inventory_balances_warehouse_id').on(table.warehouseId),
    index('idx_inventory_balances_item_id').on(table.itemId),
    uniqueIndex('idx_inventory_balances_entity_wh_item_lot').on(
      table.tenantId,
      table.legalEntityOwnerId,
      table.warehouseId,
      table.itemId,
      table.lotId
    ),
  ]
);

// 15. Inventory Cost Layers (Existing)
export const inventoryCostLayers = pgTable(
  'inventory_cost_layers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityOwnerId: uuid('legal_entity_owner_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull(),
    lotId: uuid('lot_id'),
    quantityReceived: numeric('quantity_received', { precision: 14, scale: 4 }).notNull(),
    quantityRemaining: numeric('quantity_remaining', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cost_layers_tenant_id').on(table.tenantId),
    index('idx_cost_layers_lookup').on(
      table.tenantId,
      table.legalEntityOwnerId,
      table.warehouseId,
      table.itemId,
      table.createdAt
    ),
  ]
);

// 16. Central Inventory Movements (Central Transaction Ledger)
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityOwnerId: uuid('legal_entity_owner_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull(),
    movementNumber: varchar('movement_number', { length: 50 }),
    movementType: varchar('movement_type', { length: 50 }).notNull().default(MovementType.SALE_ISSUE),
    direction: varchar('direction', { length: 10 }).notNull().default(MovementDirection.OUT),
    uomId: uuid('uom_id'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalCost: numeric('total_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    sourceWarehouseId: uuid('source_warehouse_id'),
    destinationWarehouseId: uuid('destination_warehouse_id'),
    branchId: uuid('branch_id'),
    batchNumber: varchar('batch_number', { length: 100 }),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceDocumentNumber: varchar('source_document_number', { length: 100 }),
    performedBy: uuid('performed_by'),
    approvedBy: uuid('approved_by'),
    notes: text('notes'),
    status: varchar('status', { length: 30 }).notNull().default('COMPLETED'),
    isReversed: boolean('is_reversed').notNull().default(false),
    reversalOfId: uuid('reversal_of_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_inventory_movements_tenant_id').on(table.tenantId),
    index('idx_inventory_movements_wh_item_time').on(table.warehouseId, table.itemId, table.occurredAt),
    index('idx_inventory_movements_movement_num').on(table.movementNumber),
  ]
);

// 17. Offline Quota Leases (Existing)
export const offlineQuotaLeases = pgTable(
  'offline_quota_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull(),
    deviceId: uuid('device_id').notNull().references(() => devices.id),
    deviceEpoch: uuid('device_epoch').notNull(),
    allocatedQty: numeric('allocated_qty', { precision: 14, scale: 4 }).notNull(),
    consumedQty: numeric('consumed_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    lastReceivedSeq: integer('last_received_seq').notNull().default(0),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    signature: varchar('signature', { length: 512 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
  },
  (table) => [
    index('idx_offline_quota_tenant_id').on(table.tenantId),
    index('idx_offline_quota_device_item_epoch').on(table.deviceId, table.warehouseId, table.itemId, table.deviceEpoch, table.status),
  ]
);
