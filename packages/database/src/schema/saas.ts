import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users, tenantSubscriptions } from './tenants.js';

// 1. Dynamic SaaS Subscription Plans (managed by Super Admin)
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameAr: varchar('name_ar', { length: 120 }).notNull(),
  nameEn: varchar('name_en', { length: 120 }).notNull(),
  descriptionAr: text('description_ar'),
  descriptionEn: text('description_en'),
  monthlyPriceSar: numeric('monthly_price_sar', { precision: 12, scale: 2 }).notNull().default('0.00'),
  annualPriceSar: numeric('annual_price_sar', { precision: 12, scale: 2 }).notNull().default('0.00'),
  trialDays: integer('trial_days').notNull().default(14),
  maxBranches: integer('max_branches').notNull().default(3),
  maxDevices: integer('max_devices').notNull().default(5),
  maxUsers: integer('max_users').notNull().default(10),
  featuresJson: jsonb('features_json').$type<string[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  isPublic: boolean('is_public').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 2. SaaS Platform Policies (PDPL, E-Commerce Terms, Trial/Grace Rules)
export const saasPolicies = pgTable('saas_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  policyKey: varchar('policy_key', { length: 80 }).notNull().unique(),
  titleAr: varchar('title_ar', { length: 200 }).notNull(),
  titleEn: varchar('title_en', { length: 200 }).notNull(),
  contentAr: text('content_ar').notNull(),
  contentEn: text('content_en').notNull(),
  configJson: jsonb('config_json').$type<Record<string, any>>().notNull().default({}),
  version: varchar('version', { length: 30 }).notNull().default('1.0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 3. Single-use Time-Limited Verification & Password Reset Tokens
export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    target: varchar('target', { length: 255 }).notNull(), // email or phone
    purpose: varchar('purpose', { length: 40 }).notNull(), // EMAIL_VERIFY | PHONE_VERIFY | PASSWORD_RESET
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_auth_verif_target_purpose').on(table.target, table.purpose),
    index('idx_auth_verif_token_hash').on(table.tokenHash),
  ],
);

// 4. SaaS Subscription Invoices (Tenant-Isolated via RLS)
export const saasInvoices = pgTable(
  'saas_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    subscriptionId: uuid('subscription_id').notNull().references(() => tenantSubscriptions.id),
    invoiceNumber: varchar('invoice_number', { length: 60 }).notNull().unique(),
    planCode: varchar('plan_code', { length: 50 }).notNull(),
    billingCycle: varchar('billing_cycle', { length: 20 }).notNull().default('MONTHLY'),
    subtotalSar: numeric('subtotal_sar', { precision: 12, scale: 2 }).notNull(),
    vatSar: numeric('vat_sar', { precision: 12, scale: 2 }).notNull(),
    totalSar: numeric('total_sar', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    status: varchar('status', { length: 30 }).notNull().default('PENDING'), // PENDING | PAID | FAILED | PAST_DUE | VOID
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    idempotencyKey: varchar('idempotency_key', { length: 150 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_saas_invoices_tenant_id').on(table.tenantId),
    uniqueIndex('idx_saas_invoices_tenant_idemp').on(table.tenantId, table.idempotencyKey),
  ],
);

// 5. SaaS Payments (No raw card storage; stores hosted checkout / tokenized provider refs only)
export const saasPayments = pgTable(
  'saas_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull().references(() => saasInvoices.id),
    provider: varchar('provider', { length: 40 }).notNull().default('HOSTED_CHECKOUT'),
    providerPaymentRef: varchar('provider_payment_ref', { length: 150 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 150 }),
    amountSar: numeric('amount_sar', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('PENDING'), // PENDING | SUCCEEDED | FAILED
    failureReason: text('failure_reason'),
    rawMetadata: jsonb('raw_metadata').$type<Record<string, any>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_saas_payments_tenant_id').on(table.tenantId),
    uniqueIndex('idx_saas_payments_provider_event').on(table.provider, table.providerEventId),
  ],
);

// 6. Saudi PDPL & E-Commerce Consents (Tenant-Isolated via RLS)
export const pdplConsents = pgTable(
  'pdpl_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').references(() => users.id),
    consentType: varchar('consent_type', { length: 50 }).notNull(), // PRIVACY_POLICY | ECOMMERCE_TERMS | DATA_PROCESSING | MARKETING
    policyVersion: varchar('policy_version', { length: 30 }).notNull().default('1.0'),
    accepted: boolean('accepted').notNull().default(true),
    purpose: text('purpose'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_pdpl_consents_tenant_id').on(table.tenantId)],
);

// 7. Tenant Resumable Onboarding Progress
export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    completedSteps: jsonb('completed_steps').$type<string[]>().notNull().default([]),
    currentStep: varchar('current_step', { length: 50 }).notNull().default('legal_entity'),
    isCompleted: boolean('is_completed').notNull().default(false),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idx_onboarding_progress_tenant_id').on(table.tenantId)],
);
