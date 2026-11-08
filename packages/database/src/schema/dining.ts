import { pgTable, uuid, varchar, timestamp, numeric, integer, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches } from './tenants.js';
import { salesOrders, orderLines } from './sales.js';
import { TableStatus } from '@restaurant-cloud/domain-kernel';

// 1. Dining Tables
export const diningTables = pgTable(
  'dining_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    tableNumber: varchar('table_number', { length: 20 }).notNull(),
    section: varchar('section', { length: 50 }).notNull().default('MAIN'), // MAIN, PATIO, FAMILY, VIP
    capacity: integer('capacity').notNull().default(4),
    status: varchar('status', { length: 30 }).notNull().default(TableStatus.AVAILABLE),
    currentOrderId: uuid('current_order_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_dining_tables_tenant_id').on(table.tenantId),
    uniqueIndex('idx_dining_tables_branch_number').on(table.branchId, table.tableNumber),
  ]
);

// 2. Table Sessions
export const tableSessions = pgTable(
  'table_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    tableId: uuid('table_id').notNull().references(() => diningTables.id),
    orderId: uuid('order_id').references(() => salesOrders.id),
    guestCount: integer('guest_count').notNull().default(1),
    serverUserId: uuid('server_user_id'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_table_sessions_tenant_id').on(table.tenantId),
    index('idx_table_sessions_table_id').on(table.tableId),
  ]
);

// 3. Order Line Modifiers (Add-ons, exclusions, sauces)
export const orderLineModifiers = pgTable(
  'order_line_modifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderLineId: uuid('order_line_id').notNull().references(() => orderLines.id),
    modifierNameAr: varchar('modifier_name_ar', { length: 100 }).notNull(),
    modifierNameEn: varchar('modifier_name_en', { length: 100 }).notNull(),
    priceDelta: numeric('price_delta', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    quantity: integer('quantity').notNull().default(1),
  },
  (table) => [
    index('idx_order_line_modifiers_line_id').on(table.orderLineId),
  ]
);

// 4. Order Voids and Refunds
export const orderVoids = pgTable(
  'order_voids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    orderId: uuid('order_id').notNull().references(() => salesOrders.id),
    orderLineId: uuid('order_line_id').references(() => orderLines.id),
    reason: varchar('reason', { length: 100 }).notNull(), // CUSTOMER_CANCELLED, WRONG_ITEM, QUALITY_ISSUE
    notes: text('notes'),
    voidAmount: numeric('void_amount', { precision: 12, scale: 4 }).notNull(),
    voidedBy: uuid('voided_by').notNull(),
    approvedBy: uuid('approved_by').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_order_voids_tenant_id').on(table.tenantId),
    index('idx_order_voids_order_id').on(table.orderId),
  ]
);
