import { pgTable, uuid, varchar, timestamp, numeric, integer, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, warehouses, devices } from './tenants.js';
import { AccountType, NormalBalance, JournalStatus, JournalType, MovementType, MovementDirection, FiscalPeriodStatus } from '@restaurant-cloud/domain-kernel';

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    accountCode: varchar('account_code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    accountType: varchar('account_type', { length: 30 }).notNull().default(AccountType.ASSET),
    normalBalance: varchar('normal_balance', { length: 10 }).notNull().default(NormalBalance.DEBIT),
    parentId: uuid('parent_id'),
    isPostable: boolean('is_postable').notNull().default(true),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
  },
  (table) => [
    index('idx_coa_tenant_id').on(table.tenantId),
    uniqueIndex('idx_coa_entity_account_code').on(table.legalEntityId, table.accountCode),
  ]
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    journalNumber: varchar('journal_number', { length: 50 }).notNull(),
    journalType: varchar('journal_type', { length: 30 }).notNull().default(JournalType.GENERAL),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    status: varchar('status', { length: 30 }).notNull().default(JournalStatus.POSTED),
    debitTotal: numeric('debit_total', { precision: 14, scale: 4 }).notNull(),
    creditTotal: numeric('credit_total', { precision: 14, scale: 4 }).notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    postedBy: uuid('posted_by'),
  },
  (table) => [
    index('idx_journal_entries_tenant_id').on(table.tenantId),
    uniqueIndex('idx_journal_entries_entity_number').on(table.legalEntityId, table.journalNumber),
  ]
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    branchId: uuid('branch_id').references(() => branches.id),
    debit: numeric('debit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    credit: numeric('credit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    description: varchar('description', { length: 255 }),
  },
  (table) => [
    index('idx_journal_lines_entry_id').on(table.journalEntryId),
    index('idx_journal_lines_account_id').on(table.accountId),
  ]
);

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
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_inventory_balances_tenant_id').on(table.tenantId),
    uniqueIndex('idx_inventory_balances_entity_wh_item_lot').on(
      table.tenantId,
      table.legalEntityOwnerId,
      table.warehouseId,
      table.itemId,
      table.lotId
    ),
  ]
);

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

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityOwnerId: uuid('legal_entity_owner_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull(),
    movementType: varchar('movement_type', { length: 50 }).notNull().default(MovementType.SALE_ISSUE),
    direction: varchar('direction', { length: 10 }).notNull().default(MovementDirection.OUT),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_inventory_movements_tenant_id').on(table.tenantId),
    index('idx_inventory_movements_wh_item_time').on(table.warehouseId, table.itemId, table.occurredAt),
  ]
);

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
