import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { AuthService } from '../src/modules/iam/auth.service';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import path from 'path';
import fs from 'fs';

describe('Restaurant Cloud — Phase 1: Core Foundation Live Staging Verification', { timeout: 20000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let authService: AuthService;

  // Track created tenant for cleanup or context
  let tenantContext: TenantContext;
  let adminUserId: string;
  let adminToken: string;
  let primaryEntityId: string;
  let secondEntityId: string;
  let primaryBranchId: string;
  let secondBranchId: string;
  let managerUserId: string;
  let customRoleId: string;

  const testTenantCode = `tc-${Date.now().toString(36)}`;
  const adminEmail = `admin-${Date.now().toString(36)}@rc-staging.local`;

  beforeAll(async () => {
    // 1. Ensure .env is loaded
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    authService = new AuthService(dbService, auditService);
  });

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  describe('1. Tenant Onboarding & Legal Entity Hierarchy', () => {
    it('should successfully onboard a new tenant, initial company, branch, and admin user', async () => {
      const result = await tenantService.onboardTenant({
        code: testTenantCode,
        displayName: 'مجموعة مطاعم السحاب التجريبية',
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة السحاب للمأكولات السريعة المحدودة',
          vatNumber: '310000000000003',
          crNumber: '1010998877',
          functionalCurrency: 'SAR',
        },
        initialAdminUser: {
          displayName: 'المدير التنفيذي',
          email: adminEmail,
          phone: '0501234567',
          password: 'SuperSecurePassword123!',
        },
      });

      expect(result).toBeDefined();
      expect(result.tenant.id).toBeDefined();
      expect(result.tenant.code).toBe(testTenantCode);
      expect(result.legalEntity.legalName).toBe('شركة السحاب للمأكولات السريعة المحدودة');
      expect(result.branch.code).toBe('BR-01');
      expect(result.user.email).toBe(adminEmail.toLowerCase());
      expect(result.token).toBeDefined();

      // Establish tenant context for subsequent steps
      tenantContext = {
        tenantId: result.tenant.id,
        userId: result.user.id,
        scopes: ['*'],
      };
      adminUserId = result.user.id;
      adminToken = result.token;
      primaryEntityId = result.legalEntity.id;
      primaryBranchId = result.branch.id;
    });

    it('should reject duplicate tenant code onboarding', async () => {
      await expect(
        tenantService.onboardTenant({
          code: testTenantCode,
          displayName: 'مجموعة مكررة',
          deploymentMode: 'SHARED' as any,
          primaryLocale: 'ar-SA',
          timezone: 'Asia/Riyadh',
          primaryIndustry: 'RESTAURANT' as any,
          initialLegalEntity: {
            legalName: 'شركة مكررة',
            vatNumber: '310000000000003',
            functionalCurrency: 'SAR',
          },
          initialAdminUser: {
            displayName: 'مستخدم مكرر',
            email: `dup-${Date.now()}@rc.local`,
            password: 'Password123!',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('2. Authentication & JWT Session Verification', () => {
    it('should authenticate admin user with valid credentials and return JWT with permissions', async () => {
      const loginResult = await authService.login({
        email: adminEmail,
        password: 'SuperSecurePassword123!',
        tenantCode: testTenantCode,
      });

      expect(loginResult.token).toBeDefined();
      expect(loginResult.user.email).toBe(adminEmail.toLowerCase());
      expect(loginResult.activeTenant.id).toBe(tenantContext.tenantId);
      expect(loginResult.permissions).toContain('*');
    });

    it('should reject login with wrong password', async () => {
      await expect(
        authService.login({
          email: adminEmail,
          password: 'IncorrectPassword!',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject login with non-existent email', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@rc-staging.local',
          password: 'AnyPassword123!',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should fetch user context profile via getMe()', async () => {
      const me = await authService.getMe(tenantContext);
      expect(me.user.id).toBe(adminUserId);
      expect(me.user.email).toBe(adminEmail.toLowerCase());
      expect(me.activeTenant?.id).toBe(tenantContext.tenantId);
    });
  });

  describe('3. Companies (Legal Entities) Management', () => {
    it('should create an additional legal entity under the tenant', async () => {
      const newEntity = await tenantService.createLegalEntity(tenantContext, {
        legalName: 'شركة السحاب للمقاهي والمخبوزات ذ.م.م',
        commercialName: 'كافيه كلاود',
        vatNumber: '320000000000003',
        crNumber: '1010554433',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      });

      expect(newEntity).toBeDefined();
      expect(newEntity.id).toBeDefined();
      expect(newEntity.legalName).toBe('شركة السحاب للمقاهي والمخبوزات ذ.م.م');
      expect(newEntity.vatNumber).toBe('320000000000003');
      secondEntityId = newEntity.id;
    });

    it('should list all legal entities belonging to this tenant', async () => {
      const entities = await tenantService.listLegalEntities(tenantContext);
      expect(entities.length).toBe(2);
      const vatNumbers = entities.map((e) => e.vatNumber);
      expect(vatNumbers).toContain('310000000000003');
      expect(vatNumbers).toContain('320000000000003');
    });

    it('should retrieve a single legal entity by ID', async () => {
      const entity = await tenantService.getLegalEntity(tenantContext, primaryEntityId);
      expect(entity.id).toBe(primaryEntityId);
      expect(entity.vatNumber).toBe('310000000000003');
    });

    it('should update a legal entity details', async () => {
      const updated = await tenantService.updateLegalEntity(tenantContext, secondEntityId, {
        commercialName: 'سلسلة مقاهي السحاب المتميزة',
      });

      expect(updated.commercialName).toBe('سلسلة مقاهي السحاب المتميزة');
    });
  });

  describe('4. Branches Management', () => {
    it('should create an operational branch under the second legal entity', async () => {
      const newBranch = await tenantService.createBranch(tenantContext, {
        legalEntityId: secondEntityId,
        code: 'BR-OLAYA',
        name: 'فرع العليا - الرياض',
        businessType: 'CAFE' as any,
        timezone: 'Asia/Riyadh',
      });

      expect(newBranch).toBeDefined();
      expect(newBranch.code).toBe('BR-OLAYA');
      expect(newBranch.legalEntityId).toBe(secondEntityId);
      secondBranchId = newBranch.id;
    });

    it('should list all branches and filter by legal entity', async () => {
      const allBranches = await tenantService.listBranches(tenantContext);
      expect(allBranches.length).toBe(2);

      const entity2Branches = await tenantService.listBranches(tenantContext, secondEntityId);
      expect(entity2Branches.length).toBe(1);
      expect(entity2Branches[0].code).toBe('BR-OLAYA');
    });

    it('should retrieve single branch details', async () => {
      const branch = await tenantService.getBranch(tenantContext, secondBranchId);
      expect(branch.name).toBe('فرع العليا - الرياض');
      expect(branch.businessType).toBe('CAFE');
    });

    it('should update an existing branch', async () => {
      const updated = await tenantService.updateBranch(tenantContext, secondBranchId, {
        name: 'فرع العليا درايف ثرو',
      });
      expect(updated.name).toBe('فرع العليا درايف ثرو');
    });
  });

  describe('5. Users, Roles & Membership Scoping', () => {
    it('should list available roles including system roles', async () => {
      const roles = await authService.listRoles(tenantContext);
      expect(roles.length).toBeGreaterThanOrEqual(4);
      const roleCodes = roles.map((r) => r.code);
      expect(roleCodes).toContain('SUPER_ADMIN');
      expect(roleCodes).toContain('COMPANY_ADMIN');
      expect(roleCodes).toContain('BRANCH_MANAGER');
      expect(roleCodes).toContain('EMPLOYEE');
    });

    it('should create a custom role with specific permission IDs', async () => {
      const perms = await authService.listPermissions();
      expect(perms.length).toBeGreaterThan(0);

      const selectedPerms = perms
        .filter((p) => p.code === 'branch.read' || p.code === 'user.read')
        .map((p) => p.id);

      const customRole = await authService.createRole(tenantContext, {
        code: `SUPERVISOR_${Date.now().toString(36).toUpperCase()}`,
        name: 'مشرف تشغيل الفرع',
        permissionIds: selectedPerms,
      });

      expect(customRole.id).toBeDefined();
      customRoleId = customRole.id;
    });

    it('should create and invite a new user assigned to a role with branch scope', async () => {
      const managerEmail = `manager-${Date.now().toString(36)}@rc-staging.local`;
      const allRoles = await authService.listRoles(tenantContext);
      const branchManagerRole = allRoles.find((r) => r.code === 'BRANCH_MANAGER');
      expect(branchManagerRole).toBeDefined();

      const newUser = await authService.createUser(tenantContext, {
        displayName: 'سارة خالد - مديرة فرع',
        email: managerEmail,
        phone: '0559988776',
        password: 'BranchManagerPass2026!',
        roleId: branchManagerRole!.id,
        scopes: [
          {
            scopeType: 'BRANCH' as any,
            scopeId: secondBranchId,
          },
        ],
      });

      expect(newUser.userId).toBeDefined();
      expect(newUser.email).toBe(managerEmail.toLowerCase());
      managerUserId = newUser.userId;

      // Verify user appears in listUsers() with their scope
      const usersList = await authService.listUsers(tenantContext);
      const found = usersList.find((u) => u.userId === managerUserId);
      expect(found).toBeDefined();
      expect(found!.scopes.length).toBe(1);
      expect(found!.scopes[0].scopeId).toBe(secondBranchId);
    });

    it('should suspend and re-activate user membership', async () => {
      // 1. Suspend
      const suspended = await authService.updateUserStatus(tenantContext, managerUserId, {
        status: 'SUSPENDED',
      });
      expect(suspended.status).toBe('SUSPENDED');

      // 2. Verify suspended user is rejected on login
      const manager = await authService.getUser(tenantContext, managerUserId);
      await expect(
        authService.login({
          email: manager.email,
          password: 'BranchManagerPass2026!',
        })
      ).rejects.toThrow(UnauthorizedException);

      // 3. Reactivate
      const reactivated = await authService.updateUserStatus(tenantContext, managerUserId, {
        status: 'ACTIVE',
      });
      expect(reactivated.status).toBe('ACTIVE');

      // 4. Verify user can now log in
      const loginRes = await authService.login({
        email: manager.email,
        password: 'BranchManagerPass2026!',
      });
      expect(loginRes.token).toBeDefined();
    });

    it('should update user scopes and reassign role', async () => {
      const updatedScopes = await authService.updateUserScopes(tenantContext, managerUserId, {
        roleId: customRoleId,
        scopes: [
          { scopeType: 'BRANCH' as any, scopeId: primaryBranchId },
          { scopeType: 'BRANCH' as any, scopeId: secondBranchId },
        ],
      });

      expect(updatedScopes.roleId).toBe(customRoleId);
      expect(updatedScopes.scopes.length).toBe(2);
    });
  });

  describe('6. System & Tenant Settings Management', () => {
    it('should fetch complete tenant settings, industry packs, and subscription', async () => {
      const settings = await tenantService.getTenantSettings(tenantContext);
      expect(settings.tenant.id).toBe(tenantContext.tenantId);
      expect(settings.tenant.code).toBe(testTenantCode);
      expect(settings.subscription).toBeDefined();
      expect(settings.industryPacks.length).toBeGreaterThan(0);
    });

    it('should update tenant display name and timezone', async () => {
      const updated = await tenantService.updateTenantSettings(tenantContext, {
        displayName: 'مجموعة مطاعم السحاب الدولية المحدثة',
        timezone: 'Asia/Riyadh',
      });

      expect(updated.displayName).toBe('مجموعة مطاعم السحاب الدولية المحدثة');
    });
  });

  describe('7. Immutable Audit Logs & DB Trigger Verification', () => {
    it('should query recorded audit events matching actions taken above', async () => {
      const auditResult = await auditService.queryLogs(tenantContext, {
        page: 1,
        limit: 50,
      });

      expect(auditResult.total).toBeGreaterThan(0);
      const actionTypes = auditResult.items.map((i) => i.action);

      expect(actionTypes).toContain('TENANT_ONBOARDED');
      expect(actionTypes).toContain('LEGAL_ENTITY_CREATED');
      expect(actionTypes).toContain('BRANCH_CREATED');
      expect(actionTypes).toContain('USER_MEMBER_INVITED');
      expect(actionTypes).toContain('TENANT_SETTINGS_UPDATED');
    });

    it('should filter audit logs by entityType and action', async () => {
      const filtered = await auditService.queryLogs(tenantContext, {
        entityType: 'legal_entity',
        action: 'LEGAL_ENTITY_CREATED',
        page: 1,
        limit: 10,
      });

      expect(filtered.items.length).toBeGreaterThan(0);
      filtered.items.forEach((item) => {
        expect(item.entityType).toBe('legal_entity');
        expect(item.action).toBe('LEGAL_ENTITY_CREATED');
      });
    });

    it('SECURITY TEST: DB trigger strictly blocks UPDATE on audit_logs table for rc_app_user', async () => {
      const sql = postgres(process.env.DATABASE_URL!);
      try {
        let errorCaught = false;
        try {
          await sql`
            UPDATE audit_logs 
            SET action = 'TAMPERED_ACTION' 
            WHERE tenant_id = ${tenantContext.tenantId}::uuid;
          `;
        } catch (err: any) {
          errorCaught = true;
          // Either permission denied (REVOKE UPDATE) or trigger exception
          expect(err.message).toMatch(/(permission denied|cannot be modified|Security Violation)/i);
        }
        expect(errorCaught).toBe(true);
      } finally {
        await sql.end();
      }
    });

    it('SECURITY TEST: DB trigger strictly blocks DELETE on audit_logs table for rc_app_user', async () => {
      const sql = postgres(process.env.DATABASE_URL!);
      try {
        let errorCaught = false;
        try {
          await sql`
            DELETE FROM audit_logs 
            WHERE tenant_id = ${tenantContext.tenantId}::uuid;
          `;
        } catch (err: any) {
          errorCaught = true;
          expect(err.message).toMatch(/(permission denied|cannot be modified|Security Violation)/i);
        }
        expect(errorCaught).toBe(true);
      } finally {
        await sql.end();
      }
    });
  });

  describe('8. Database Role Hardening & Cross-Tenant RLS Verification', () => {
    it('SECURITY TEST: rc_app_user is strictly blocked from executing DDL statements', async () => {
      const sql = postgres(process.env.DATABASE_URL!);
      try {
        let ddlBlocked = false;
        try {
          await sql`CREATE TABLE public.unauthorized_test_table (id serial primary key);`;
        } catch (err: any) {
          ddlBlocked = true;
          expect(err.message).toMatch(/permission denied for schema public/i);
        }
        expect(ddlBlocked).toBe(true);
      } finally {
        await sql.end();
      }
    });

    it('SECURITY TEST: rc_app_user is strictly blocked from connecting to production database restaurant_cloud', async () => {
      const prodUrl = process.env.DATABASE_URL!.replace(
        'restaurant_cloud_staging',
        'restaurant_cloud'
      );
      const sqlProd = postgres(prodUrl, { connect_timeout: 5 });
      try {
        let blocked = false;
        try {
          await sqlProd`SELECT current_database();`;
        } catch (err: any) {
          blocked = true;
          expect(err.message).toMatch(/permission denied for database "restaurant_cloud"/i);
        }
        expect(blocked).toBe(true);
      } finally {
        await sqlProd.end().catch(() => {});
      }
    });

    it('SECURITY TEST: Cross-Tenant Row Level Security blocks reading another tenant data', async () => {
      // Create a foreign context with a random fake UUID
      const foreignContext: TenantContext = {
        tenantId: '00000000-0000-0000-0000-000000000999',
        userId: '00000000-0000-0000-0000-000000000998',
        scopes: ['*'],
      };

      // Under foreignContext, RLS policy enforces tenant_id = foreignContext.tenantId
      // Attempting to list legal entities MUST return 0 entities (invisible due to RLS)
      const foreignEntities = await tenantService.listLegalEntities(foreignContext);
      expect(foreignEntities.length).toBe(0);

      // Attempting to get our primaryEntityId under foreignContext MUST fail with NotFoundException
      await expect(
        tenantService.getLegalEntity(foreignContext, primaryEntityId)
      ).rejects.toThrow(NotFoundException);
    });
  });
});
