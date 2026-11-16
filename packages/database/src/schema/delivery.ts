import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches } from './tenants.js';
import { employees } from './hr.js';
import { salesOrders } from './sales.js';
import { cashVaults } from './finance.js';

export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 150 }).notNull(),
    nameEn: varchar('name_en', { length: 150 }),
    deliveryFee: numeric('delivery_fee', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    estimatedMinutes: integer('estimated_minutes').notNull().default(45),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_delivery_zones_tenant').on(table.tenantId),
    index('idx_delivery_zones_branch').on(table.tenantId, table.branchId),
    uniqueIndex('idx_delivery_zones_branch_code').on(table.tenantId, table.branchId, table.code),
  ],
);

export const deliveryDrivers = pgTable(
  'delivery_drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').references(() => employees.id),
    driverCode: varchar('driver_code', { length: 50 }).notNull(),
    fullNameAr: varchar('full_name_ar', { length: 200 }).notNull(),
    fullNameEn: varchar('full_name_en', { length: 200 }),
    phone: varchar('phone', { length: 50 }).notNull(),
    vehicleType: varchar('vehicle_type', { length: 30 }).notNull().default('MOTORBIKE'), // MOTORBIKE | CAR | BICYCLE | VAN
    plateNumber: varchar('plate_number', { length: 50 }),
    availabilityStatus: varchar('availability_status', { length: 30 }).notNull().default('AVAILABLE'), // AVAILABLE | ON_DELIVERY | OFFLINE
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_delivery_drivers_tenant').on(table.tenantId),
    index('idx_delivery_drivers_branch_status').on(table.tenantId, table.branchId, table.availabilityStatus),
    uniqueIndex('idx_delivery_drivers_tenant_code').on(table.tenantId, table.driverCode),
  ],
);

export const deliveryOrders = pgTable(
  'delivery_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    salesOrderId: uuid('sales_order_id').notNull().references(() => salesOrders.id),
    zoneId: uuid('zone_id').references(() => deliveryZones.id),
    driverId: uuid('driver_id').references(() => deliveryDrivers.id),
    channel: varchar('channel', { length: 30 }).notNull().default('IN_HOUSE'), // IN_HOUSE | AGGREGATOR | WEB | CALL_CENTER
    aggregatorName: varchar('aggregator_name', { length: 80 }),
    externalReference: varchar('external_reference', { length: 120 }),
    customerName: varchar('customer_name', { length: 150 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 50 }).notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryFee: numeric('delivery_fee', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    codAmount: numeric('cod_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    codCollected: boolean('cod_collected').notNull().default(false),
    codSettled: boolean('cod_settled').notNull().default(false),
    settlementId: uuid('settlement_id'),
    status: varchar('status', { length: 30 }).notNull().default('PENDING_ASSIGNMENT'), // PENDING_ASSIGNMENT | ASSIGNED | PICKED_UP | OUT_FOR_DELIVERY | DELIVERED | FAILED_RETURNED | CANCELLED
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_delivery_orders_tenant').on(table.tenantId),
    index('idx_delivery_orders_branch_status').on(table.tenantId, table.branchId, table.status),
    index('idx_delivery_orders_driver').on(table.tenantId, table.driverId, table.status),
    uniqueIndex('idx_delivery_orders_sales_order').on(table.tenantId, table.salesOrderId),
  ],
);

export const deliveryDriverSettlements = pgTable(
  'delivery_driver_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    driverId: uuid('driver_id').notNull().references(() => deliveryDrivers.id),
    cashVaultId: uuid('cash_vault_id').notNull().references(() => cashVaults.id),
    settlementNumber: varchar('settlement_number', { length: 60 }).notNull(),
    expectedCodAmount: numeric('expected_cod_amount', { precision: 12, scale: 4 }).notNull(),
    settledAmount: numeric('settled_amount', { precision: 12, scale: 4 }).notNull(),
    varianceAmount: numeric('variance_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    journalEntryId: uuid('journal_entry_id'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    settledBy: uuid('settled_by').notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_delivery_settlements_tenant').on(table.tenantId),
    index('idx_delivery_settlements_driver').on(table.tenantId, table.driverId),
    uniqueIndex('idx_delivery_settlements_idempotency').on(table.tenantId, table.idempotencyKey),
  ],
);
