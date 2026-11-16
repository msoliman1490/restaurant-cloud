import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, users } from './tenants.js';

// Phase 3.5 — Financial Reconciliation & Reporting Engine

export const financialReconciliationRuns = pgTable(
  'financial_reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    runNumber: varchar('run_number', { length: 100 }).notNull(),
    asOfDate: timestamp('as_of_date', { withTimezone: true }).notNull().defaultNow(),
    status: varchar('status', { length: 30 }).notNull().default('COMPLETED'),
    totalChecks: integer('total_checks').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    discrepancyCount: integer('discrepancy_count').notNull().default(0),
    notConfiguredCount: integer('not_configured_count').notNull().default(0),
    totalVariance: numeric('total_variance', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    executedBy: uuid('executed_by').references(() => users.id),
    idempotencyKey: varchar('idempotency_key', { length: 150 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fin_recon_runs_tenant_le').on(table.tenantId, table.legalEntityId, table.createdAt),
    uniqueIndex('idx_fin_recon_runs_idempotency').on(table.tenantId, table.idempotencyKey),
  ]
);

export const financialReconciliationItems = pgTable(
  'financial_reconciliation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => financialReconciliationRuns.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    category: varchar('category', { length: 60 }).notNull(),
    mappingKey: varchar('mapping_key', { length: 80 }),
    accountId: uuid('account_id'),
    accountCode: varchar('account_code', { length: 50 }),
    accountName: varchar('account_name', { length: 255 }),
    entityId: uuid('entity_id'),
    entityName: varchar('entity_name', { length: 255 }).notNull(),
    operationalBalance: numeric('operational_balance', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    glBalance: numeric('gl_balance', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    variance: numeric('variance', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default('MATCHED'),
    varianceSource: text('variance_source'),
    referenceType: varchar('reference_type', { length: 80 }),
    referenceId: uuid('reference_id'),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }).notNull().defaultNow(),
    detailsJson: jsonb('details_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fin_recon_items_run_id').on(table.runId),
    index('idx_fin_recon_items_tenant_cat_status').on(table.tenantId, table.legalEntityId, table.category, table.status),
  ]
);
