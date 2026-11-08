import { pgTable, uuid, varchar, timestamp, numeric, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, warehouses } from './tenants.js';
import { items, unitsOfMeasure, suppliers } from './catalog.js';
import {
  PurchaseRequestStatus,
  PurchaseOrderStatus,
  GoodsReceiptStatus,
  SupplierInvoiceStatus,
  PurchaseReturnStatus,
  SupplierPaymentMethod,
} from '@restaurant-cloud/domain-kernel';

// 1. Purchase Requests
export const purchaseRequests = pgTable(
  'purchase_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    requestNumber: varchar('request_number', { length: 50 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(PurchaseRequestStatus.DRAFT),
    requestedBy: uuid('requested_by'),
    approvedBy: uuid('approved_by'),
    neededByDate: timestamp('needed_by_date', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_purchase_requests_tenant_id').on(table.tenantId),
    uniqueIndex('idx_purchase_requests_entity_number').on(table.legalEntityId, table.requestNumber),
  ]
);

export const purchaseRequestLines = pgTable(
  'purchase_request_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => purchaseRequests.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    requestedQty: numeric('requested_qty', { precision: 14, scale: 4 }).notNull(),
    estimatedUnitCost: numeric('estimated_unit_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    notes: text('notes'),
  },
  (table) => [
    index('idx_purchase_req_lines_request_id').on(table.requestId),
  ]
);

// 2. Purchase Orders
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(PurchaseOrderStatus.DRAFT),
    orderDate: timestamp('order_date', { withTimezone: true }).notNull().defaultNow(),
    expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true }),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    notes: text('notes'),
    issuedBy: uuid('issued_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_purchase_orders_tenant_id').on(table.tenantId),
    index('idx_purchase_orders_supplier_id').on(table.supplierId),
    uniqueIndex('idx_purchase_orders_entity_number').on(table.legalEntityId, table.orderNumber),
  ]
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => purchaseOrders.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    orderedQty: numeric('ordered_qty', { precision: 14, scale: 4 }).notNull(),
    receivedQty: numeric('received_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    invoicedQty: numeric('invoiced_qty', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'),
    lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_po_lines_order_id').on(table.orderId),
    index('idx_po_lines_item_id').on(table.itemId),
  ]
);

// 3. Goods Receipts (GRN)
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    receiptNumber: varchar('receipt_number', { length: 50 }).notNull(),
    deliveryNoteNumber: varchar('delivery_note_number', { length: 100 }),
    status: varchar('status', { length: 30 }).notNull().default(GoodsReceiptStatus.RECEIVED),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by'),
    notes: text('notes'),
  },
  (table) => [
    index('idx_goods_receipts_tenant_id').on(table.tenantId),
    index('idx_goods_receipts_warehouse_id').on(table.warehouseId),
    uniqueIndex('idx_goods_receipts_entity_number').on(table.legalEntityId, table.receiptNumber),
  ]
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id').notNull().references(() => goodsReceipts.id),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    receivedQty: numeric('received_qty', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    lotNumber: varchar('lot_number', { length: 100 }),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
  },
  (table) => [
    index('idx_gr_lines_receipt_id').on(table.receiptId),
    index('idx_gr_lines_item_id').on(table.itemId),
  ]
);

// 4. Supplier Invoices (3-Way Matching: PO -> GRN -> Invoice)
export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
    goodsReceiptId: uuid('goods_receipt_id').references(() => goodsReceipts.id),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(SupplierInvoiceStatus.DRAFT),
    invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 14, scale: 4 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_supplier_invoices_tenant_id').on(table.tenantId),
    uniqueIndex('idx_supplier_invoices_supplier_number').on(table.tenantId, table.supplierId, table.invoiceNumber),
  ]
);

export const supplierInvoiceLines = pgTable(
  'supplier_invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => supplierInvoices.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'),
    lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_supplier_inv_lines_invoice_id').on(table.invoiceId),
  ]
);

// 5. Purchase Returns
export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    goodsReceiptId: uuid('goods_receipt_id').references(() => goodsReceipts.id),
    returnNumber: varchar('return_number', { length: 50 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(PurchaseReturnStatus.DRAFT),
    reason: varchar('reason', { length: 255 }).notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }).notNull().defaultNow(),
    returnedBy: uuid('returned_by'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 4 }).notNull().default('0.0000'),
  },
  (table) => [
    index('idx_purchase_returns_tenant_id').on(table.tenantId),
    uniqueIndex('idx_purchase_returns_entity_number').on(table.legalEntityId, table.returnNumber),
  ]
);

export const purchaseReturnLines = pgTable(
  'purchase_return_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id').notNull().references(() => purchaseReturns.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_purchase_return_lines_return_id').on(table.returnId),
  ]
);

// 6. Supplier Balances / Account
export const supplierBalances = pgTable(
  'supplier_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    currentBalance: numeric('current_balance', { precision: 14, scale: 4 }).notNull().default('0.0000'), // positive = we owe supplier
    totalInvoiced: numeric('total_invoiced', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalPaid: numeric('total_paid', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_supplier_balances_tenant_id').on(table.tenantId),
    uniqueIndex('idx_supplier_balances_entity_supplier').on(table.legalEntityId, table.supplierId),
  ]
);

// 7. Supplier Payments
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    invoiceId: uuid('invoice_id').references(() => supplierInvoices.id),
    paymentNumber: varchar('payment_number', { length: 50 }).notNull(),
    paymentDate: timestamp('payment_date', { withTimezone: true }).notNull().defaultNow(),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    paymentMethod: varchar('payment_method', { length: 30 }).notNull().default(SupplierPaymentMethod.BANK_TRANSFER),
    referenceNumber: varchar('reference_number', { length: 100 }),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id'),
    paidBy: uuid('paid_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_supplier_payments_tenant_id').on(table.tenantId),
    index('idx_supplier_payments_supplier_id').on(table.supplierId),
    uniqueIndex('idx_supplier_payments_entity_number').on(table.legalEntityId, table.paymentNumber),
  ]
);
