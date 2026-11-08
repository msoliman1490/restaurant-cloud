import { pgTable, uuid, varchar, timestamp, numeric, integer, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, devices } from './tenants.js';
import {
  OrderType,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ShiftStatus,
  ShiftCashTransactionType,
} from '@restaurant-cloud/domain-kernel';

export const posShifts = pgTable(
  'pos_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    deviceId: uuid('device_id').notNull().references(() => devices.id),
    cashierId: uuid('cashier_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingCash: numeric('opening_cash', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    expectedCash: numeric('expected_cash', { precision: 12, scale: 4 }),
    countedCash: numeric('counted_cash', { precision: 12, scale: 4 }),
    variance: numeric('variance', { precision: 12, scale: 4 }),
    status: varchar('status', { length: 30 }).notNull().default(ShiftStatus.OPEN),
    closeJournalEntryId: uuid('close_journal_entry_id'),
  },
  (table) => [
    index('idx_pos_shifts_tenant_id').on(table.tenantId),
    index('idx_pos_shifts_branch_device').on(table.tenantId, table.branchId, table.deviceId, table.status),
  ]
);

export const shiftCashTransactions = pgTable(
  'shift_cash_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    shiftId: uuid('shift_id').notNull().references(() => posShifts.id),
    transactionType: varchar('transaction_type', { length: 30 }).notNull().default(ShiftCashTransactionType.CASH_IN),
    amount: numeric('amount', { precision: 12, scale: 4 }).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    performedBy: uuid('performed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_shift_cash_tenant_id').on(table.tenantId),
    index('idx_shift_cash_shift_id').on(table.shiftId),
  ]
);

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    deviceId: uuid('device_id').notNull().references(() => devices.id),
    shiftId: uuid('shift_id').references(() => posShifts.id),
    tableId: uuid('table_id'),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    orderType: varchar('order_type', { length: 30 }).notNull().default(OrderType.TAKEAWAY),
    channel: varchar('channel', { length: 30 }).notNull().default(OrderChannel.POS),
    status: varchar('status', { length: 30 }).notNull().default(OrderStatus.CONFIRMED),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    subtotal: numeric('subtotal', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    discountTotal: numeric('discount_total', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    taxTotal: numeric('tax_total', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    grandTotal: numeric('grand_total', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_sales_orders_tenant_id').on(table.tenantId),
    uniqueIndex('idx_sales_orders_entity_number').on(table.tenantId, table.legalEntityId, table.orderNumber),
    index('idx_sales_orders_branch_created').on(table.tenantId, table.branchId, table.createdAt),
  ]
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => salesOrders.id),
    itemId: uuid('item_id').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
    uomId: uuid('uom_id').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    lineTotal: numeric('line_total', { precision: 12, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_order_lines_order_id').on(table.orderId),
  ]
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    orderId: uuid('order_id').notNull().references(() => salesOrders.id),
    paymentMethod: varchar('payment_method', { length: 30 }).notNull().default(PaymentMethod.CASH),
    amount: numeric('amount', { precision: 12, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    providerCode: varchar('provider_code', { length: 50 }),
    providerTransactionRef: varchar('provider_transaction_ref', { length: 100 }),
    status: varchar('status', { length: 30 }).notNull().default(PaymentStatus.CAPTURED),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_payments_tenant_id').on(table.tenantId),
    index('idx_payments_order_id').on(table.orderId),
  ]
);

export const egsUnits = pgTable(
  'egs_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    unitIdentifier: varchar('unit_identifier', { length: 100 }).notNull().unique(),
    deviceAssetCode: varchar('device_asset_code', { length: 100 }),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    csidReference: varchar('csid_reference', { length: 255 }),
    icvCurrent: integer('icv_current').notNull().default(0),
    lastHash: varchar('last_hash', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_egs_units_tenant_id').on(table.tenantId),
    index('idx_egs_units_branch_id').on(table.branchId),
  ]
);
