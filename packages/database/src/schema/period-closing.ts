import { pgTable, uuid, varchar, timestamp, integer, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants, legalEntities } from './tenants.js';
import { fiscalPeriods } from './finance.js';
import { FiscalYearStatus } from '@restaurant-cloud/domain-kernel';

// 1. Fiscal Years (السنوات المالية)
export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    yearCode: varchar('year_code', { length: 30 }).notNull(),
    yearName: varchar('year_name', { length: 100 }).notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default(FiscalYearStatus.OPEN),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fiscal_years_tenant_entity').on(table.tenantId, table.legalEntityId),
    uniqueIndex('idx_fiscal_years_entity_code').on(table.legalEntityId, table.yearCode),
  ]
);

// 2. Fiscal Period Closing & Reopen Logs (سجل عمليات الإقفال وإعادة الفتح غير القابل للتعديل)
export const fiscalPeriodClosingLogs = pgTable(
  'fiscal_period_closing_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    periodId: uuid('period_id').notNull().references(() => fiscalPeriods.id),
    fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
    action: varchar('action', { length: 30 }).notNull(), // PRE_CHECK | CLOSE_STARTED | CLOSED | REOPENED | YEAR_END_CLOSE
    previousStatus: varchar('previous_status', { length: 20 }).notNull(),
    newStatus: varchar('new_status', { length: 20 }).notNull(),
    actorId: uuid('actor_id').notNull(),
    reason: text('reason'),
    blockersCount: integer('blockers_count').notNull().default(0),
    warningsCount: integer('warnings_count').notNull().default(0),
    checksSnapshotJson: jsonb('checks_snapshot_json'),
    trialBalanceSnapshotJson: jsonb('trial_balance_snapshot_json'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fp_closing_logs_tenant_entity').on(table.tenantId, table.legalEntityId, table.createdAt),
    index('idx_fp_closing_logs_period').on(table.periodId, table.createdAt),
    uniqueIndex('idx_fp_closing_logs_idemp').on(table.tenantId, table.idempotencyKey),
  ]
);
