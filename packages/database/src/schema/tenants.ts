import { pgTable, uuid, varchar, timestamp, text, boolean, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
import { TenantStatus, DeploymentMode, BusinessType, ScopeType } from '@restaurant-cloud/domain-kernel';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default(TenantStatus.ACTIVE),
  deploymentMode: varchar('deployment_mode', { length: 30 }).notNull().default(DeploymentMode.SHARED),
  primaryLocale: varchar('primary_locale', { length: 10 }).notNull().default('ar-SA'),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Riyadh'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 255 }).notNull(),
    reportingCurrency: varchar('reporting_currency', { length: 3 }).notNull().default('SAR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_groups_tenant_id').on(table.tenantId),
  ]
);

export const legalEntities = pgTable(
  'legal_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    groupId: uuid('group_id').references(() => groups.id),
    legalName: varchar('legal_name', { length: 255 }).notNull(),
    commercialName: varchar('commercial_name', { length: 255 }),
    crNumber: varchar('cr_number', { length: 50 }),
    vatNumber: varchar('vat_number', { length: 50 }).notNull(),
    functionalCurrency: varchar('functional_currency', { length: 3 }).notNull().default('SAR'),
    timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Riyadh'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_legal_entities_tenant_id').on(table.tenantId),
    uniqueIndex('idx_legal_entities_tenant_vat').on(table.tenantId, table.vatNumber),
  ]
);

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    businessType: varchar('business_type', { length: 30 }).notNull().default(BusinessType.RESTAURANT),
    timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Riyadh'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_branches_tenant_id').on(table.tenantId),
    index('idx_branches_legal_entity_id').on(table.legalEntityId),
    uniqueIndex('idx_branches_entity_code').on(table.tenantId, table.legalEntityId, table.code),
  ]
);

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_warehouses_tenant_id').on(table.tenantId),
    index('idx_warehouses_branch_id').on(table.branchId),
    uniqueIndex('idx_warehouses_tenant_code').on(table.tenantId, table.code),
  ]
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    deviceCode: varchar('device_code', { length: 50 }).notNull(),
    deviceType: varchar('device_type', { length: 30 }).notNull().default('POS'),
    deviceEpoch: uuid('device_epoch').defaultRandom().notNull(),
    publicKeyFingerprint: text('public_key_fingerprint'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_devices_tenant_id').on(table.tenantId),
    index('idx_devices_branch_id').on(table.branchId),
    uniqueIndex('idx_devices_branch_code').on(table.tenantId, table.branchId, table.deviceCode),
  ]
);

// Identity & Access Management (IAM)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  phone: varchar('phone', { length: 30 }),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
  mfaRequired: boolean('mfa_required').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id), // null for global default roles
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    isSystemRole: boolean('is_system_role').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_roles_tenant_id').on(table.tenantId),
  ]
);

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).notNull().unique(), // e.g. "sales.order.create", "inventory.movement.post"
  resource: varchar('resource', { length: 50 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
  ]
);

export const userMemberships = pgTable(
  'user_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_user_membership_tenant_user_role').on(table.tenantId, table.userId, table.roleId),
    index('idx_user_memberships_tenant_id').on(table.tenantId),
    index('idx_user_memberships_user_id').on(table.userId),
  ]
);

export const membershipScopes = pgTable(
  'membership_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id').notNull().references(() => userMemberships.id),
    scopeType: varchar('scope_type', { length: 30 }).notNull().default(ScopeType.BRANCH),
    scopeId: uuid('scope_id').notNull(),
    accessMode: varchar('access_mode', { length: 10 }).notNull().default('ALLOW'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_membership_scopes_membership_id').on(table.membershipId),
  ]
);
