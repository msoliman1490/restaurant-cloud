import { pgTable, uuid, varchar, timestamp, numeric, boolean, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, warehouses } from './tenants.js';
import { items, unitsOfMeasure } from './catalog.js';
import {
  TransferStatus,
  TransferType,
  TransferDiscrepancyType,
  TransferDiscrepancyStatus,
  AdjustmentReason,
  StocktakeType,
  StocktakeFrequency,
  StocktakeStatus,
} from '@restaurant-cloud/domain-kernel';

// 1. Storage Locations within Warehouses (Aisles, Shelves, Cold Rooms)
export const storageLocations = pgTable(
  'storage_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_storage_locations_tenant_id').on(table.tenantId),
    index('idx_storage_locations_warehouse_id').on(table.warehouseId),
    uniqueIndex('idx_storage_locations_wh_code').on(table.warehouseId, table.code),
  ]
);

// 2. Stock Transfers Header
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    transferType: varchar('transfer_type', { length: 30 }).notNull().default(TransferType.SAME_BRANCH),
    sourceLegalEntityId: uuid('source_legal_entity_id').references(() => legalEntities.id),
    destinationLegalEntityId: uuid('destination_legal_entity_id').references(() => legalEntities.id),
    sourceBranchId: uuid('source_branch_id').references(() => branches.id),
    destinationBranchId: uuid('destination_branch_id').references(() => branches.id),
    transferNumber: varchar('transfer_number', { length: 50 }).notNull(),
    sourceWarehouseId: uuid('source_warehouse_id').notNull().references(() => warehouses.id),
    destinationWarehouseId: uuid('destination_warehouse_id').notNull().references(() => warehouses.id),
    status: varchar('status', { length: 30 }).notNull().default(TransferStatus.DRAFT),
    requestedBy: uuid('requested_by'),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    dispatchedBy: uuid('dispatched_by'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    receivedBy: uuid('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    totalShippedQty: numeric('total_shipped_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalReceivedQty: numeric('total_received_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalDamagedQty: numeric('total_damaged_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalLostQty: numeric('total_lost_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalOverageQty: numeric('total_overage_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalTransferCost: numeric('total_transfer_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    dispatchIdempotencyKey: varchar('dispatch_idempotency_key', { length: 128 }),
    receiveIdempotencyKey: varchar('receive_idempotency_key', { length: 128 }),
    dispatchJournalEntryId: uuid('dispatch_journal_entry_id'),
    receiveJournalEntryId: uuid('receive_journal_entry_id'),
    destJournalEntryId: uuid('dest_journal_entry_id'),
    notes: text('notes'),
  },
  (table) => [
    index('idx_transfers_tenant_id').on(table.tenantId),
    index('idx_transfers_source_wh').on(table.sourceWarehouseId),
    index('idx_transfers_destination_wh').on(table.destinationWarehouseId),
    index('idx_transfers_type_status').on(table.tenantId, table.transferType, table.status),
    uniqueIndex('idx_transfers_entity_number').on(table.legalEntityId, table.transferNumber),
    uniqueIndex('idx_transfers_idempotency').on(table.tenantId, table.idempotencyKey),
  ]
);

// 3. Stock Transfer Lines
export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id').notNull().references(() => stockTransfers.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    baseQuantity: numeric('base_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    dispatchedQuantity: numeric('dispatched_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    receivedQuantity: numeric('received_quantity', { precision: 14, scale: 4 }),
    damagedQuantity: numeric('damaged_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    lostQuantity: numeric('lost_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    overageQuantity: numeric('overage_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    varianceNotes: text('variance_notes'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    transferPrice: numeric('transfer_price', { precision: 14, scale: 4 }),
    totalCost: numeric('total_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    fifoLayersJson: jsonb('fifo_layers_json'),
  },
  (table) => [
    index('idx_transfer_lines_transfer_id').on(table.transferId),
    index('idx_transfer_lines_item_id').on(table.itemId),
  ]
);

// 3b. Stock Transfer Discrepancies
export const stockTransferDiscrepancies = pgTable(
  'stock_transfer_discrepancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    transferId: uuid('transfer_id').notNull().references(() => stockTransfers.id),
    lineId: uuid('line_id').notNull().references(() => stockTransferLines.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    discrepancyType: varchar('discrepancy_type', { length: 30 }).notNull().default(TransferDiscrepancyType.SHORTAGE),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalValue: numeric('total_value', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default(TransferDiscrepancyStatus.OPEN),
    notes: text('notes'),
    resolutionNotes: text('resolution_notes'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    journalEntryId: uuid('journal_entry_id'),
    movementId: uuid('movement_id'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_transfer_discrepancies_tenant').on(table.tenantId),
    index('idx_transfer_discrepancies_transfer').on(table.transferId),
    index('idx_transfer_discrepancies_status').on(table.tenantId, table.status),
  ]
);

// 4. Stock Adjustments (Physical inventory counting variance, damages, expiries)
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    adjustmentNumber: varchar('adjustment_number', { length: 50 }).notNull(),
    reason: varchar('reason', { length: 50 }).notNull().default(AdjustmentReason.PHYSICAL_COUNT),
    notes: text('notes'),
    adjustedBy: uuid('adjusted_by'),
    adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_adjustments_tenant_id').on(table.tenantId),
    index('idx_adjustments_warehouse_id').on(table.warehouseId),
    uniqueIndex('idx_adjustments_entity_number').on(table.legalEntityId, table.adjustmentNumber),
  ]
);

// 5. Stock Adjustment Lines
export const stockAdjustmentLines = pgTable(
  'stock_adjustment_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adjustmentId: uuid('adjustment_id').notNull().references(() => stockAdjustments.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    lotId: uuid('lot_id'),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    systemQuantity: numeric('system_quantity', { precision: 14, scale: 4 }).notNull(),
    countedQuantity: numeric('counted_quantity', { precision: 14, scale: 4 }).notNull(),
    differenceQuantity: numeric('difference_quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    totalVarianceAmount: numeric('total_variance_amount', { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_adjustment_lines_adjustment_id').on(table.adjustmentId),
    index('idx_adjustment_lines_item_id').on(table.itemId),
  ]
);

// 6. Stocktake Orders (Physical Stock Counting Engine: Full, Partial, Periodic, Surprise)
export const stocktakeOrders = pgTable(
  'stocktake_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    stocktakeType: varchar('stocktake_type', { length: 30 }).notNull().default(StocktakeType.FULL),
    countFrequency: varchar('count_frequency', { length: 30 }).notNull().default(StocktakeFrequency.PERIODIC),
    status: varchar('status', { length: 30 }).notNull().default(StocktakeStatus.DRAFT),
    freezeMovements: boolean('freeze_movements').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    startedBy: uuid('started_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    countedBy: uuid('counted_by'),
    countedAt: timestamp('counted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    adjustmentId: uuid('adjustment_id').references(() => stockAdjustments.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stocktake_orders_tenant_id').on(table.tenantId),
    index('idx_stocktake_orders_warehouse_id').on(table.warehouseId),
    uniqueIndex('idx_stocktake_orders_entity_number').on(table.legalEntityId, table.orderNumber),
  ]
);

// 7. Stocktake Lines
export const stocktakeLines = pgTable(
  'stocktake_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    stocktakeId: uuid('stocktake_id').notNull().references(() => stocktakeOrders.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    systemQuantity: numeric('system_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    countedQuantity: numeric('counted_quantity', { precision: 14, scale: 4 }),
    differenceQuantity: numeric('difference_quantity', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    varianceAmount: numeric('variance_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stocktake_lines_tenant_id').on(table.tenantId),
    index('idx_stocktake_lines_stocktake_id').on(table.stocktakeId),
    index('idx_stocktake_lines_item_id').on(table.itemId),
  ]
);
