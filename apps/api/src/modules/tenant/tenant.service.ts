import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
  tenantSubscriptions,
  tenantIndustryPacks,
} from '@restaurant-cloud/database';
import {
  CreateTenantRequest,
  CreateLegalEntityRequest,
  CreateBranchRequest,
  CreateWarehouseRequest,
  RegisterDeviceRequest,
  ActivateIndustryPackRequest,
  DeactivateIndustryPackRequest,
  UpdateSubscriptionPlanRequest,
  UpdateLegalEntityRequest,
  UpdateBranchRequest,
  UpdateTenantSettingsRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  ScopeType,
  BusinessType,
  IndustryType,
  IndustryPackStatus,
  SubscriptionPlanCode,
  SubscriptionStatus,
  INDUSTRY_CAPABILITIES,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql } from 'drizzle-orm';
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
    const newTenantId = randomUUID();

    return await db.transaction(async (tx) => {
      // Set session tenant context for RLS policy enforcement
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${newTenantId}, true);`
      );

      // 1. Create Tenant
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          id: newTenantId,
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

      // 9. Provision SaaS Trial Subscription & Industry Pack
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 14);

      const [subscription] = await tx
        .insert(tenantSubscriptions)
        .values({
          tenantId: newTenant.id,
          planCode: SubscriptionPlanCode.FREE_TRIAL,
          status: SubscriptionStatus.TRIAL,
          maxBranches: 3,
          maxDevices: 5,
          maxUsers: 10,
          trialEndsAt: trialEnds,
        })
        .returning();

      const primaryIndustry = dto.primaryIndustry || IndustryType.RESTAURANT;
      const [primaryPack] = await tx
        .insert(tenantIndustryPacks)
        .values({
          tenantId: newTenant.id,
          industry: primaryIndustry,
          status: IndustryPackStatus.ACTIVE,
          isPrimary: true,
          settings: JSON.stringify({ defaultUom: 'UNIT', currency: 'SAR' }),
        })
        .returning();

      // 10. Record Immutable Audit Log
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
          primaryIndustry,
        }),
      });

      // 11. Generate Initial Authentication Token
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
        subscription,
        activeIndustryPacks: [primaryPack],
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
   * Lists all legal entities for the current tenant
   */
  async listLegalEntities(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(legalEntities)
        .where(eq(legalEntities.tenantId, context.tenantId));
    });
  }

  /**
   * Retrieves a single legal entity by ID
   */
  async getLegalEntity(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [entity] = await tx
        .select()
        .from(legalEntities)
        .where(and(eq(legalEntities.id, id), eq(legalEntities.tenantId, context.tenantId)))
        .limit(1);

      if (!entity) throw new NotFoundException(`Legal entity '${id}' not found`);
      return entity;
    });
  }

  /**
   * Updates a legal entity's details
   */
  async updateLegalEntity(context: TenantContext, id: string, dto: UpdateLegalEntityRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(legalEntities)
        .where(and(eq(legalEntities.id, id), eq(legalEntities.tenantId, context.tenantId)))
        .limit(1);

      if (!existing) throw new NotFoundException(`Legal entity '${id}' not found`);

      const [updated] = await tx
        .update(legalEntities)
        .set(dto)
        .where(and(eq(legalEntities.id, id), eq(legalEntities.tenantId, context.tenantId)))
        .returning();

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'LEGAL_ENTITY_UPDATED',
        entityType: 'legal_entity',
        entityId: id,
        beforeState: existing,
        afterState: updated,
      }, tx);

      return updated;
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
   * Lists operational branches for the tenant, optionally filtered by legalEntityId
   */
  async listBranches(context: TenantContext, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (legalEntityId) {
        return await tx
          .select()
          .from(branches)
          .where(and(eq(branches.tenantId, context.tenantId), eq(branches.legalEntityId, legalEntityId)));
      }
      return await tx
        .select()
        .from(branches)
        .where(eq(branches.tenantId, context.tenantId));
    });
  }

  /**
   * Retrieves a single branch by ID
   */
  async getBranch(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [branch] = await tx
        .select()
        .from(branches)
        .where(and(eq(branches.id, id), eq(branches.tenantId, context.tenantId)))
        .limit(1);

      if (!branch) throw new NotFoundException(`Branch '${id}' not found`);
      return branch;
    });
  }

  /**
   * Updates an existing operational branch
   */
  async updateBranch(context: TenantContext, id: string, dto: UpdateBranchRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(branches)
        .where(and(eq(branches.id, id), eq(branches.tenantId, context.tenantId)))
        .limit(1);

      if (!existing) throw new NotFoundException(`Branch '${id}' not found`);

      const [updated] = await tx
        .update(branches)
        .set(dto)
        .where(and(eq(branches.id, id), eq(branches.tenantId, context.tenantId)))
        .returning();

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'BRANCH_UPDATED',
        entityType: 'branch',
        entityId: id,
        beforeState: existing,
        afterState: updated,
      }, tx);

      return updated;
    });
  }

  /**
   * Retrieves tenant configuration and settings
   */
  async getTenantSettings(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, context.tenantId))
        .limit(1);

      if (!tenant) throw new NotFoundException(`Tenant '${context.tenantId}' not found`);

      const packs = await tx
        .select()
        .from(tenantIndustryPacks)
        .where(eq(tenantIndustryPacks.tenantId, context.tenantId));

      const [subscription] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .limit(1);

      return {
        tenant,
        industryPacks: packs,
        subscription,
      };
    });
  }

  /**
   * Updates tenant configuration and settings
   */
  async updateTenantSettings(context: TenantContext, dto: UpdateTenantSettingsRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, context.tenantId))
        .limit(1);

      if (!existing) throw new NotFoundException(`Tenant '${context.tenantId}' not found`);

      const [updated] = await tx
        .update(tenants)
        .set({
          ...dto,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, context.tenantId))
        .returning();

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'TENANT_SETTINGS_UPDATED',
        entityType: 'tenant',
        entityId: context.tenantId,
        beforeState: existing,
        afterState: updated,
      }, tx);

      return updated;
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

  // ====================================================================
  // SaaS Multi-Industry Control Plane & Entitlements Engine
  // ====================================================================

  /**
   * Activates a new Industry Pack for the tenant without duplicating legal entities or tenants.
   */
  async activateIndustryPack(context: TenantContext, dto: ActivateIndustryPackRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(tenantIndustryPacks)
        .where(
          and(
            eq(tenantIndustryPacks.tenantId, context.tenantId),
            eq(tenantIndustryPacks.industry, dto.industry)
          )
        )
        .limit(1);

      if (existing) {
        if (existing.status === IndustryPackStatus.ACTIVE) {
          return existing; // Idempotent: already active
        }
        // Reactivate previously deactivated pack
        const [reactivated] = await tx
          .update(tenantIndustryPacks)
          .set({
            status: IndustryPackStatus.ACTIVE,
            deactivatedAt: null,
            settings: dto.settings ? JSON.stringify(dto.settings) : existing.settings,
          })
          .where(eq(tenantIndustryPacks.id, existing.id))
          .returning();

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'INDUSTRY_PACK_REACTIVATED',
            entityType: 'industry_pack',
            entityId: existing.id,
            afterState: reactivated,
          },
          tx
        );
        return reactivated;
      }

      // Activate new industry pack
      const [newPack] = await tx
        .insert(tenantIndustryPacks)
        .values({
          tenantId: context.tenantId,
          industry: dto.industry,
          status: IndustryPackStatus.ACTIVE,
          isPrimary: false,
          settings: dto.settings ? JSON.stringify(dto.settings) : null,
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INDUSTRY_PACK_ACTIVATED',
          entityType: 'industry_pack',
          entityId: newPack!.id,
          afterState: newPack,
        },
        tx
      );

      return newPack;
    });
  }

  /**
   * Deactivates an Industry Pack safely without deleting historical tenant records (dining tables, recipes, orders remain safe).
   */
  async deactivateIndustryPack(context: TenantContext, dto: DeactivateIndustryPackRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [pack] = await tx
        .select()
        .from(tenantIndustryPacks)
        .where(
          and(
            eq(tenantIndustryPacks.tenantId, context.tenantId),
            eq(tenantIndustryPacks.industry, dto.industry)
          )
        )
        .limit(1);

      if (!pack) {
        throw new NotFoundException(`Industry pack '${dto.industry}' is not installed for this tenant`);
      }

      const [updated] = await tx
        .update(tenantIndustryPacks)
        .set({
          status: IndustryPackStatus.INACTIVE,
          deactivatedAt: new Date(),
        })
        .where(eq(tenantIndustryPacks.id, pack.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INDUSTRY_PACK_DEACTIVATED',
          entityType: 'industry_pack',
          entityId: pack.id,
          afterState: { updated, reason: dto.reason },
        },
        tx
      );

      return updated;
    });
  }

  /**
   * Retrieves all active industry packs and aggregate capabilities for the tenant.
   */
  async getTenantIndustryPacks(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const packs = await tx
        .select()
        .from(tenantIndustryPacks)
        .where(eq(tenantIndustryPacks.tenantId, context.tenantId));

      const activePacks = packs.filter((p) => p.status === IndustryPackStatus.ACTIVE);
      const capabilities = new Set<string>();

      for (const p of activePacks) {
        const ind = p.industry as IndustryType;
        const caps = INDUSTRY_CAPABILITIES[ind] || [];
        caps.forEach((c) => capabilities.add(c));
      }

      return {
        packs,
        activeIndustries: activePacks.map((p) => p.industry),
        capabilities: Array.from(capabilities),
      };
    });
  }

  /**
   * Retrieves current SaaS Subscription & usage limits for the tenant.
   */
  async getTenantSubscription(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [sub] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .limit(1);

      return sub || null;
    });
  }

  /**
   * Server-side entitlement check verifying tenant holds the required capability or industry.
   */
  async checkEntitlement(tenantId: string, requiredCapabilityOrIndustry: string): Promise<boolean> {
    const packs = await this.dbService.db
      .select()
      .from(tenantIndustryPacks)
      .where(
        and(
          eq(tenantIndustryPacks.tenantId, tenantId),
          eq(tenantIndustryPacks.status, IndustryPackStatus.ACTIVE)
        )
      );

    for (const p of packs) {
      if (p.industry === requiredCapabilityOrIndustry) return true;
      const caps = INDUSTRY_CAPABILITIES[p.industry as IndustryType] || [];
      if (caps.includes(requiredCapabilityOrIndustry)) return true;
    }

    return false;
  }
}
