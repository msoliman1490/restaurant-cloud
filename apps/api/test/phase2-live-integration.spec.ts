import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { AuthService } from '../src/modules/iam/auth.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { CryptoUtil } from '../src/modules/iam/crypto.util';
import {
  tenants,
  users,
  roles,
  userMemberships,
  permissions,
  rolePermissions,
  legalEntities,
  branches,
  warehouses,
  devices,
} from '@restaurant-cloud/database';
import { TenantStatus, TenantContext } from '@restaurant-cloud/domain-kernel';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as schema from '@restaurant-cloud/database';

describe('Phase 2: Live Application Integration — Authentication, Tenancy & Permissions', () => {
  let pg: PGlite;
  let authService: AuthService;
  let tenantService: TenantService;
  let dbService: DatabaseService;
  let auditService: AuditService;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const tenantSuspendedId = 'c0000000-0000-0000-0000-000000000003';

  const userAdminId = '11111111-1111-1111-1111-111111111111';
  const userMultiId = '22222222-2222-2222-2222-222222222222';
  const roleOwnerId = '33333333-3333-3333-3333-333333333333';
  const roleCashierId = '44444444-4444-4444-4444-444444444444';

  const entityA1Id = '77777777-7777-7777-7777-777777777777';
  const branchA1Id = '88888888-8888-8888-8888-888888888888';
  const warehouseA1Id = '99999999-9999-9999-9999-999999999999';
  const deviceA1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  beforeAll(async () => {
    pg = new PGlite();
    const db = drizzle(pg, { schema });

    // 1. Create Core Schemas
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        deployment_mode VARCHAR(20) DEFAULT 'SHARED',
        primary_locale VARCHAR(10) DEFAULT 'ar-SA',
        timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        password_hash VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        mfa_required BOOLEAN NOT NULL DEFAULT false,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY,
        tenant_id UUID,
        name VARCHAR(50) NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id UUID PRIMARY KEY,
        code VARCHAR(100) NOT NULL UNIQUE,
        module VARCHAR(50) NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES roles(id),
        permission_id UUID NOT NULL REFERENCES permissions(id)
      );

      CREATE TABLE IF NOT EXISTS user_memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        user_id UUID NOT NULL REFERENCES users(id),
        role_id UUID NOT NULL REFERENCES roles(id),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS legal_entities (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        group_id UUID,
        legal_name VARCHAR(255) NOT NULL,
        commercial_name VARCHAR(255),
        cr_number VARCHAR(50),
        vat_number VARCHAR(15) NOT NULL,
        functional_currency VARCHAR(3) DEFAULT 'SAR',
        timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        business_type VARCHAR(50) DEFAULT 'RESTAURANT',
        is_active BOOLEAN NOT NULL DEFAULT true,
        timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID REFERENCES branches(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        device_code VARCHAR(50) NOT NULL,
        device_type VARCHAR(30) DEFAULT 'POS',
        device_epoch UUID DEFAULT gen_random_uuid() NOT NULL,
        public_key_fingerprint TEXT,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        actor_id UUID,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID NOT NULL,
        before_state JSONB,
        after_state JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Seed Baseline Test Data
    const hashedPassword = await CryptoUtil.hashPassword('StrongPassword123!');

    // Seed Tenants
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name, status) VALUES
        ('${tenantAId}', 'al-nakheel', 'مجموعة النخيل للضيافة', 'ACTIVE'),
        ('${tenantBId}', 'al-madina', 'شركة المدينة للتموين', 'ACTIVE'),
        ('${tenantSuspendedId}', 'suspended-org', 'شركة موقوفة مؤقتاً', 'SUSPENDED');
    `);

    // Seed Users
    await pg.exec(`
      INSERT INTO users (id, email, display_name, password_hash, status) VALUES
        ('${userAdminId}', 'admin@al-nakheel.sa', 'أحمد السعيد', '${hashedPassword}', 'ACTIVE'),
        ('${userMultiId}', 'multi@restaurantcloud.sa', 'سلطان القحطاني', '${hashedPassword}', 'ACTIVE');
    `);

    // Seed Roles & Permissions
    const perm1Id = '55555555-5555-5555-5555-555555555555';
    const perm2Id = '66666666-6666-6666-6666-666666666666';
    await pg.exec(`
      INSERT INTO roles (id, tenant_id, name, is_system) VALUES
        ('${roleOwnerId}', '${tenantAId}', 'OWNER', true),
        ('${roleCashierId}', '${tenantAId}', 'CASHIER', true);

      INSERT INTO permissions (id, code, module, description) VALUES
        ('${perm1Id}', 'pos.order.create', 'sales', 'Create POS orders'),
        ('${perm2Id}', 'inventory.view', 'inventory', 'View inventory balances');

      INSERT INTO role_permissions (role_id, permission_id) VALUES
        ('${roleOwnerId}', '${perm1Id}'),
        ('${roleOwnerId}', '${perm2Id}'),
        ('${roleCashierId}', '${perm1Id}');
    `);

    // Seed Memberships
    await pg.exec(`
      INSERT INTO user_memberships (tenant_id, user_id, role_id, status) VALUES
        ('${tenantAId}', '${userAdminId}', '${roleOwnerId}', 'ACTIVE'),
        ('${tenantAId}', '${userMultiId}', '${roleOwnerId}', 'ACTIVE'),
        ('${tenantBId}', '${userMultiId}', '${roleCashierId}', 'ACTIVE');
    `);

    // Seed Legal Entity, Branch, Warehouse, Device
    await pg.exec(`
      INSERT INTO legal_entities (id, tenant_id, legal_name, vat_number, cr_number) VALUES
        ('${entityA1Id}', '${tenantAId}', 'شركة النخيل لخدمات الإعاشة المحدودة', '300000000000001', '1010123456');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name, business_type) VALUES
        ('${branchA1Id}', '${tenantAId}', '${entityA1Id}', 'BR-01', 'فرع العليا الرياض', 'RESTAURANT');

      INSERT INTO warehouses (id, tenant_id, branch_id, code, name) VALUES
        ('${warehouseA1Id}', '${tenantAId}', '${branchA1Id}', 'WH-01', 'مستودع العليا الرئيسي');

      INSERT INTO devices (id, tenant_id, branch_id, device_code) VALUES
        ('${deviceA1Id}', '${tenantAId}', '${branchA1Id}', 'POS-01');
    `);

    // Setup Services
    dbService = {
      db,
      withTenantContext: async <T>(
        ctx: TenantContext,
        op: (tx: any) => Promise<T>
      ): Promise<T> => {
        return await op(db);
      },
    } as unknown as DatabaseService;

    auditService = new AuditService(dbService);
    authService = new AuthService(dbService, auditService);
    tenantService = new TenantService(dbService, auditService);
  });

  describe('1. Real Authentication Flow (AuthService.login)', () => {
    it('authenticates valid credentials and returns signed JWT with user, activeTenant and permissions', async () => {
      const res = await authService.login({
        email: 'admin@al-nakheel.sa',
        password: 'StrongPassword123!',
      });

      expect(res.token).toBeDefined();
      expect(res.user.email).toBe('admin@al-nakheel.sa');
      expect(res.user.displayName).toBe('أحمد السعيد');
      expect(res.activeTenant.id).toBe(tenantAId);
      expect(res.activeTenant.code).toBe('al-nakheel');
      expect(res.role?.name).toBe('OWNER');
      expect(res.permissions).toContain('pos.order.create');
      expect(res.permissions).toContain('inventory.view');

      // Verify token signature and claims
      const claims = CryptoUtil.verifyToken(res.token);
      expect(claims?.userId).toBe(userAdminId);
      expect(claims?.tenantId).toBe(tenantAId);
    });

    it('rejects invalid password with HTTP 401 Unauthorized', async () => {
      await expect(
        authService.login({
          email: 'admin@al-nakheel.sa',
          password: 'WrongPassword999!',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects non-existent email with HTTP 401 Unauthorized without leaking user existence', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@company.sa',
          password: 'SomePassword123!',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('handles multi-tenant user and selects specific tenant via tenantCode', async () => {
      // Login under Tenant A
      const resA = await authService.login({
        email: 'multi@restaurantcloud.sa',
        password: 'StrongPassword123!',
        tenantCode: 'al-nakheel',
      });
      expect(resA.activeTenant.code).toBe('al-nakheel');
      expect(resA.role?.name).toBe('OWNER');
      expect(resA.availableTenants.length).toBe(2);

      // Login under Tenant B
      const resB = await authService.login({
        email: 'multi@restaurantcloud.sa',
        password: 'StrongPassword123!',
        tenantCode: 'al-madina',
      });
      expect(resB.activeTenant.code).toBe('al-madina');
      expect(resB.role?.name).toBe('CASHIER');
      expect(resB.permissions).toContain('pos.order.create');
      expect(resB.permissions).not.toContain('inventory.view');
    });

    it('rejects access to suspended organization with HTTP 401 Unauthorized', async () => {
      // Connect multi user to suspended tenant
      await pg.exec(`
        INSERT INTO user_memberships (tenant_id, user_id, role_id, status)
        VALUES ('${tenantSuspendedId}', '${userMultiId}', '${roleCashierId}', 'ACTIVE');
      `);

      await expect(
        authService.login({
          email: 'multi@restaurantcloud.sa',
          password: 'StrongPassword123!',
          tenantCode: 'suspended-org',
        })
      ).rejects.toThrow(/Target organization is suspended/);
    });
  });

  describe('2. User Session Verification (AuthService.getMe)', () => {
    it('returns full active session profile and active tenant details', async () => {
      const context: TenantContext = {
        tenantId: tenantAId,
        userId: userAdminId,
        scopes: ['pos.order.create', 'inventory.view'],
      };

      const me = await authService.getMe(context);
      expect(me.user.email).toBe('admin@al-nakheel.sa');
      expect(me.activeTenant?.name).toBe('مجموعة النخيل للضيافة');
      expect(me.role.name).toBe('OWNER');
      expect(me.permissions).toContain('pos.order.create');
    });
  });

  describe('3. Organizational Hierarchy & Branch Scoping', () => {
    it('fetches real hierarchy scoped strictly to active tenant', async () => {
      const context: TenantContext = {
        tenantId: tenantAId,
        userId: userAdminId,
      };

      const hierarchy = await tenantService.getHierarchy(context);

      expect(hierarchy.legalEntities.length).toBe(1);
      expect(hierarchy.legalEntities[0]?.legalName).toBe(
        'شركة النخيل لخدمات الإعاشة المحدودة'
      );
      expect(hierarchy.legalEntities[0]?.vatNumber).toBe('300000000000001');

      expect(hierarchy.branches.length).toBe(1);
      expect(hierarchy.branches[0]?.code).toBe('BR-01');
      expect(hierarchy.branches[0]?.name).toBe('فرع العليا الرياض');

      expect(hierarchy.warehouses.length).toBe(1);
      expect(hierarchy.warehouses[0]?.code).toBe('WH-01');

      expect(hierarchy.devices.length).toBe(1);
      expect(hierarchy.devices[0]?.deviceCode).toBe('POS-01');
    });

    it('ensures Tenant B query returns zero Tenant A branches or entities (RLS isolation)', async () => {
      const contextB: TenantContext = {
        tenantId: tenantBId,
        userId: userMultiId,
      };

      const hierarchyB = await tenantService.getHierarchy(contextB);
      // Tenant B has 0 entities seeded in test
      expect(hierarchyB.legalEntities.length).toBe(0);
      expect(hierarchyB.branches.length).toBe(0);
    });
  });
});
