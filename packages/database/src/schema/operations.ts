import { pgTable, uuid, varchar, timestamp, text, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities } from './tenants.js';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    scope: varchar('scope', { length: 50 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('PROCESSING'), // PROCESSING, COMPLETED, FAILED
    responseSnapshot: text('response_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_idempotency_tenant_scope_key').on(table.tenantId, table.scope, table.idempotencyKey),
    index('idx_idempotency_tenant_id').on(table.tenantId),
  ]
);

export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    documentType: varchar('document_type', { length: 50 }).notNull(),
    periodKey: varchar('period_key', { length: 20 }).notNull(), // e.g. '2026' or 'GLOBAL'
    prefix: varchar('prefix', { length: 20 }).notNull(),
    currentValue: integer('current_value').notNull().default(0),
    padding: integer('padding').notNull().default(6),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_sequence_entity_type_period').on(table.legalEntityId, table.documentType, table.periodKey),
    index('idx_document_sequences_legal_entity_id').on(table.legalEntityId),
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    beforeState: text('before_state'),
    afterState: text('after_state'),
    correlationId: varchar('correlation_id', { length: 100 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_tenant_time').on(table.tenantId, table.occurredAt),
    index('idx_audit_logs_tenant_entity').on(table.tenantId, table.entityType, table.entityId),
  ]
);
