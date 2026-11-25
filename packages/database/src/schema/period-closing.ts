import { pgTable, uuid, varchar, timestamp, integer, text, jsonb, numeric, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, legalEntities, branches } from './tenants.js';
import { fiscalPeriods, chartOfAccounts, journalEntries } from './finance.js';
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
    previousFiscalYearId: uuid('previous_fiscal_year_id'),
    closingJournalEntryId: uuid('closing_journal_entry_id').references(() => journalEntries.id),
    reopenReversalJournalEntryId: uuid('reopen_reversal_journal_entry_id').references(() => journalEntries.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by'),
    reopenReason: text('reopen_reason'),
    closingIdempotencyKey: varchar('closing_idempotency_key', { length: 255 }),
    closingTrialBalanceSnapshotJson: jsonb('closing_trial_balance_snapshot_json'),
    openingCarryForwardCompletedAt: timestamp('opening_carry_forward_completed_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fiscal_years_tenant_entity').on(table.tenantId, table.legalEntityId),
    uniqueIndex('idx_fiscal_years_entity_code').on(table.legalEntityId, table.yearCode),
    uniqueIndex('uq_fiscal_years_prev_year')
      .on(table.legalEntityId, table.previousFiscalYearId)
      .where(sql`${table.previousFiscalYearId} IS NOT NULL`),
    uniqueIndex('uq_fiscal_years_closing_idemp')
      .on(table.tenantId, table.closingIdempotencyKey)
      .where(sql`${table.closingIdempotencyKey} IS NOT NULL`),
  ]
);

// 2. Fiscal Period & Fiscal Year Closing / Reopen Logs (سجل عمليات الإقفال وإعادة الفتح غير القابل للتعديل)
export const fiscalPeriodClosingLogs = pgTable(
  'fiscal_period_closing_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    periodId: uuid('period_id').references(() => fiscalPeriods.id),
    fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
    action: varchar('action', { length: 30 }).notNull(), // PRE_CHECK | CLOSE_STARTED | CLOSED | REOPENED | YEAR_END_CLOSE | YEAR_END_REOPENED | NEXT_YEAR_OPENED
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
    index('idx_fp_closing_logs_year').on(table.fiscalYearId, table.createdAt),
    uniqueIndex('idx_fp_closing_logs_idemp').on(table.tenantId, table.idempotencyKey),
  ]
);

// 3. Fiscal Year Opening Balances (الأرصدة الافتتاحية الموثقة للحسابات الدائمة — Continuous GL بدون ازدواجية قيود)
export const fiscalYearOpeningBalances = pgTable(
  'fiscal_year_opening_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id),
    sourceFiscalYearId: uuid('source_fiscal_year_id').references(() => fiscalYears.id),
    accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
    branchId: uuid('branch_id').references(() => branches.id),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    openingDebit: numeric('opening_debit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    openingCredit: numeric('opening_credit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    netBalance: numeric('net_balance', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | SUPERSEDED
    openingJournalEntryId: uuid('opening_journal_entry_id').references(() => journalEntries.id),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fy_opening_bal_tenant_year').on(table.tenantId, table.legalEntityId, table.fiscalYearId),
    uniqueIndex('uq_fy_opening_bal_active')
      .on(
        table.legalEntityId,
        table.fiscalYearId,
        table.accountId,
        sql`COALESCE(${table.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.currency
      )
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);

// 4. Fiscal Year Opening Subledger & Reconciliation Snapshots (لقطات مطابقة العملاء والموردين والمخزون)
export const fiscalYearOpeningSnapshots = pgTable(
  'fiscal_year_opening_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id),
    sourceFiscalYearId: uuid('source_fiscal_year_id').references(() => fiscalYears.id),
    snapshotType: varchar('snapshot_type', { length: 40 }).notNull(), // TRIAL_BALANCE_SUMMARY | AR_CUSTOMERS | AP_SUPPLIERS | INVENTORY_VALUATION
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | SUPERSEDED
    totalDebit: numeric('total_debit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    totalCredit: numeric('total_credit', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    isBalanced: boolean('is_balanced').notNull().default(true),
    payloadJson: jsonb('payload_json').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fy_opening_snap_tenant_year').on(table.tenantId, table.legalEntityId, table.fiscalYearId),
    uniqueIndex('uq_fy_opening_snap_active')
      .on(table.legalEntityId, table.fiscalYearId, table.snapshotType)
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);
