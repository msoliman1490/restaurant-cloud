import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CryptoUtil } from '../iam/crypto.util';
import {
  tenants,
  groups,
  legalEntities,
  branches,
  warehouses,
  devices,
  users,
  roles,
  permissions,
  rolePermissions,
  userMemberships,
  membershipScopes,
  auditLogs,
} from '@restaurant-cloud/database';
import {
  CreateTenantRequest,
  CreateLegalEntityRequest,
  CreateBranchRequest,
  CreateWarehouseRequest,
  RegisterDeviceRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, ScopeType, BusinessType } from '@restaurant-cloud/domain-kernel';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

@Injectable()
export class TenantService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Complete Tenant Onboarding Workflow executed inside an atomic transaction.
   * Creates Tenant -> Group -> Legal Entity -> Branch -> Warehouse -> Admin User -> Owner Role.
   */
  async onboardTenant(dto: CreateTenantRequest) {
    const db = this.dbService.db;

    // Check if tenant code is already taken
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.code, dto.code))
      .limit(1);

    if (existing) {
      throw new ConflictException(`Tenant code '${dto.code}' is already registered`);
    }

    const hashedPassword = await CryptoUtil.hashPassword(dto.initialAdminUser.password);

    return await db.transaction(async (tx) => {
      // 1. Create Tenant
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          code: dto.code,
          displayName: dto.displayName,
          deploymentMode: dto.deploymentMode,
          primaryLocale: dto.primaryLocale,
          timezone: dto.timezone,
        })
        .returning();

      if (!newTenant) throw new Error('Failed to create tenant record');

      // 2. Create Default Group
      const [newGroup] = await tx
        .insert(groups)
        .values({
          tenantId: newTenant.id,
          name: `${dto.displayName} - المجموعة الرئيسية`,
          reportingCurrency: 'SAR',
        })
        .returning();

      if (!newGroup) throw new Error('Failed to create default group');

      // 3. Create Primary Legal Entity
      const [newLegalEntity] = await tx
        .insert(legalEntities)
        .values({
          tenantId: newTenant.id,
          groupId: newGroup.id,
          legalName: dto.initialLegalEntity.legalName,
          vatNumber: dto.initialLegalEntity.vatNumber,
          crNumber: dto.initialLegalEntity.crNumber,
          functionalCurrency: dto.initialLegalEntity.functionalCurrency,
          timezone: dto.timezone,
        })
        .returning();

      if (!newLegalEntity) throw new Error('Failed to create legal entity');

      // 4. Create Initial Operational Branch
      const [newBranch] = await tx
        .insert(branches)
        .values({
          tenantId: newTenant.id,
          legalEntityId: newLegalEntity.id,
          code: 'BR-01',
          name: 'الفرع الرئيسي',
          businessType: BusinessType.RESTAURANT,
          timezone: dto.timezone,
        })
        .returning();

      if (!newBranch) throw new Error('Failed to create branch');

      // 5. Create Default Warehouse
      const [newWarehouse] = await tx
        .insert(warehouses)
        .values({
          tenantId: newTenant.id,
          branchId: newBranch.id,
          code: 'WH-01',
          name: 'المستودع الرئيسي',
        })
        .returning();

      if (!newWarehouse) throw new Error('Failed to create warehouse');

      // 6. Create Initial Admin User
      const [adminUser] = await tx
        .insert(users)
        .values({
          email: dto.initialAdminUser.email.toLowerCase(),
          displayName: dto.initialAdminUser.displayName,
          phone: dto.initialAdminUser.phone,
          passwordHash: hashedPassword,
        })
        .returning();

      if (!adminUser) throw new Error('Failed to create admin user');

      // 7. Create Tenant Owner Role with Wildcard Permissions
      const [ownerRole] = await tx
        .insert(roles)
        .values({
          tenantId: newTenant.id,
          code: 'TENANT_OWNER',
          name: 'مالك المنشأة (Owner)',
          isSystemRole: true,
        })
        .returning();

      if (!ownerRole) throw new Error('Failed to create owner role');

      // Ensure Wildcard Permission exists
      let [wildcardPerm] = await tx
        .select()
        .from(permissions)
        .where(eq(permissions.code, '*'))
        .limit(1);

      if (!wildcardPerm) {
        [wildcardPerm] = await tx
          .insert(permissions)
          .values({
            code: '*',
            resource: 'all',
            action: 'all',
            description: 'Full Superadmin Permissions',
          })
          .returning();
      }

      await tx.insert(rolePermissions).values({
        roleId: ownerRole.id,
        permissionId: wildcardPerm!.id,
      });

      // 8. Assign User Membership & Tenant Scope
      const [membership] = await tx
        .insert(userMemberships)
        .values({
          tenantId: newTenant.id,
          userId: adminUser.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
        })
        .returning();

      if (!membership) throw new Error('Failed to create membership');

      await tx.insert(membershipScopes).values({
        membershipId: membership.id,
        scopeType: ScopeType.TENANT,
        scopeId: newTenant.id,
        accessMode: 'ALLOW',
      });

      // 9. Record Immutable Audit Log
      await tx.insert(auditLogs).values({
        tenantId: newTenant.id,
        actorId: adminUser.id,
        action: 'TENANT_ONBOARDED',
        entityType: 'tenant',
        entityId: newTenant.id,
        afterState: JSON.stringify({
          tenantCode: newTenant.code,
          legalEntity: newLegalEntity.legalName,
          adminEmail: adminUser.email,
        }),
      });

      // 10. Generate Initial Authentication Token
      const token = CryptoUtil.signToken({
        userId: adminUser.id,
        tenantId: newTenant.id,
        email: adminUser.email,
        role: 'TENANT_OWNER',
      });

      return {
        tenant: newTenant,
        legalEntity: newLegalEntity,
        branch: newBranch,
        warehouse: newWarehouse,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          displayName: adminUser.displayName,
        },
        token,
      };
    });
  }

  /**
   * Adds an independent legal entity under the tenant
   */
  async createLegalEntity(context: TenantContext, dto: CreateLegalEntityRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [entity] = await tx
        .insert(legalEntities)
        .values({
          tenantId: context.tenantId,
          groupId: dto.groupId,
          legalName: dto.legalName,
          commercialName: dto.commercialName,
          crNumber: dto.crNumber,
          vatNumber: dto.vatNumber,
          functionalCurrency: dto.functionalCurrency,
          timezone: dto.timezone,
        })
        .returning();

      if (!entity) throw new Error('Failed to create legal entity');

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'LEGAL_ENTITY_CREATED',
        entityType: 'legal_entity',
        entityId: entity.id,
        afterState: dto,
      }, tx);

      return entity;
    });
  }

  /**
   * Adds an operational branch under a specific legal entity
   */
  async createBranch(context: TenantContext, dto: CreateBranchRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [branch] = await tx
        .insert(branches)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          code: dto.code,
          name: dto.name,
          businessType: dto.businessType,
          timezone: dto.timezone,
        })
        .returning();

      if (!branch) throw new Error('Failed to create branch');

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'BRANCH_CREATED',
        entityType: 'branch',
        entityId: branch.id,
        afterState: dto,
      }, tx);

      return branch;
    });
  }

  /**
   * Registers a POS device under a branch and generates a secure Device Epoch
   */
  async registerDevice(context: TenantContext, dto: RegisterDeviceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const deviceEpoch = randomUUID();

      const [device] = await tx
        .insert(devices)
        .values({
          tenantId: context.tenantId,
          branchId: dto.branchId,
          deviceCode: dto.deviceCode,
          deviceType: dto.deviceType,
          deviceEpoch,
          publicKeyFingerprint: dto.publicKeyFingerprint,
          status: 'ACTIVE',
        })
        .returning();

      if (!device) throw new Error('Failed to register device');

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'DEVICE_REGISTERED',
        entityType: 'device',
        entityId: device.id,
        afterState: { ...dto, deviceEpoch },
      }, tx);

      return device;
    });
  }

  /**
   * Returns full organization hierarchy (Legal Entities, Branches, Warehouses, Devices)
   * executed inside tenant context to respect Row Level Security.
   */
  async getHierarchy(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const allEntities = await tx
        .select()
        .from(legalEntities)
        .where(eq(legalEntities.tenantId, context.tenantId));

      const allBranches = await tx
        .select()
        .from(branches)
        .where(eq(branches.tenantId, context.tenantId));

      const allWarehouses = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.tenantId, context.tenantId));

      const allDevices = await tx
        .select()
        .from(devices)
        .where(eq(devices.tenantId, context.tenantId));

      return {
        legalEntities: allEntities,
        branches: allBranches,
        warehouses: allWarehouses,
        devices: allDevices,
      };
    });
  }
}
