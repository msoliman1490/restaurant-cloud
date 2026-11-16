import {
  Injectable,
  OnModuleInit,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CryptoUtil } from '../iam/crypto.util';
import { invalidateTenantCache } from '../../common/guards/tenant-context.guard';
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
  tenantIntegrations,
  notificationLogs,
  webhookReplayNonces,
  salesOrders,
  purchaseOrders,
  supplierInvoices,
  inventoryBalances,
  inventoryCostLayers,
  zatcaEgsCertificates,
  subscriptionPlans,
  saasPolicies,
  pdplConsents,
  onboardingProgress,
  whatsappTemplates,
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
import { eq, and, sql, gte, lte, notInArray } from 'drizzle-orm';
import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const SECRET_CONFIG_KEYS = new Set([
  'accessToken',
  'webhookSecret',
  'apiKey',
  'authToken',
  'secret',
]);

@Injectable()
export class TenantService implements OnModuleInit {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  onModuleInit() {
    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (env === 'staging' || env === 'production') {
      this.getIntegrationEncryptionKey();
    }
  }

  private async generateUniqueTenantCode(displayName: string): Promise<string> {
    const db = this.dbService.db;
    const baseSlug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'org';
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomBytes(2).toString('hex');
      const candidate = `rc-${baseSlug}-${suffix}`;
      const [existing] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.code, candidate))
        .limit(1);
      if (!existing) return candidate;
    }
    return `rc-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Complete Tenant Onboarding Workflow executed inside an atomic transaction.
   * Creates Tenant -> Group -> Legal Entity -> Branch -> Warehouse -> Admin User -> Owner Role.
   */
  async onboardTenant(dto: CreateTenantRequest) {
    const db = this.dbService.db;
    const normalizedEmail = dto.initialAdminUser.email.trim().toLowerCase();

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existingUser) {
      throw new ConflictException(`Email '${normalizedEmail}' is already registered`);
    }

    const tenantCode = dto.code
      ? dto.code.trim().toLowerCase()
      : await this.generateUniqueTenantCode(dto.displayName);

    // Check if tenant code is already taken
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.code, tenantCode))
      .limit(1);

    if (existing) {
      throw new ConflictException(`Tenant code '${tenantCode}' is already registered`);
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
          code: tenantCode,
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

      // 3. Create Primary Legal Entity (including Saudi National Address if provided)
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
          buildingNumber: dto.initialLegalEntity.buildingNumber,
          streetName: dto.initialLegalEntity.streetName,
          district: dto.initialLegalEntity.district,
          city: dto.initialLegalEntity.city,
          postalCode: dto.initialLegalEntity.postalCode,
          additionalNumber: dto.initialLegalEntity.additionalNumber,
          country: dto.initialLegalEntity.countryCode || 'SA',
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

      // 9. Provision SaaS Trial Subscription from Dynamic Plan Catalog & Industry Pack
      const requestedPlanCode = (dto.planCode || 'STARTER').toUpperCase();
      const [planRow] = await tx
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.code, requestedPlanCode))
        .limit(1);

      const trialDays = planRow?.trialDays ?? 14;
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + trialDays);

      const [subscription] = await tx
        .insert(tenantSubscriptions)
        .values({
          tenantId: newTenant.id,
          planCode: planRow?.code ?? SubscriptionPlanCode.FREE_TRIAL,
          status: SubscriptionStatus.TRIAL,
          billingCycle: dto.billingCycle ?? 'MONTHLY',
          autoRenew: true,
          maxBranches: planRow?.maxBranches ?? 3,
          maxDevices: planRow?.maxDevices ?? 5,
          maxUsers: planRow?.maxUsers ?? 10,
          trialEndsAt: trialEnds,
          currentPeriodEnd: trialEnds,
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

      // 9b. Record PDPL & E-Commerce Terms Consents
      if (dto.pdplConsentAccepted !== false || dto.termsAccepted !== false) {
        const activePolicies = await tx.select().from(saasPolicies);
        const pdplPolicy = activePolicies.find(
          (p) => p.policyKey === 'PRIVACY_POLICY' || p.policyKey === 'PDPL_PRIVACY'
        );
        const termsPolicy = activePolicies.find((p) => p.policyKey === 'ECOMMERCE_TERMS');
        if (dto.pdplConsentAccepted !== false) {
          await tx.insert(pdplConsents).values({
            tenantId: newTenant.id,
            userId: adminUser.id,
            consentType: 'PRIVACY_POLICY',
            policyVersion: pdplPolicy?.version ?? '2026.1',
            accepted: true,
          });
        }
        if (dto.termsAccepted !== false) {
          await tx.insert(pdplConsents).values({
            tenantId: newTenant.id,
            userId: adminUser.id,
            consentType: 'ECOMMERCE_TERMS',
            policyVersion: termsPolicy?.version ?? '2026.1',
            accepted: true,
          });
        }
      }

      // 9c. Initialize Resumable Onboarding Progress
      const initialSteps = ['legal_entity', 'branch', 'warehouse', 'industry'];
      const [progress] = await tx
        .insert(onboardingProgress)
        .values({
          tenantId: newTenant.id,
          currentStep: 'tax',
          completedSteps: initialSteps,
          isCompleted: false,
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
          planCode: subscription?.planCode,
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
        onboardingProgress: progress,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          displayName: adminUser.displayName,
          isPlatformAdmin: false,
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
          buildingNumber: dto.buildingNumber || null,
          postalCode: dto.postalCode || null,
          additionalNumber: dto.additionalNumber || null,
          streetName: dto.streetName || null,
          district: dto.district || null,
          city: dto.city || null,
          shortAddress: dto.shortAddress ? dto.shortAddress.toUpperCase() : null,
          country: dto.country || 'المملكة العربية السعودية',
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

      invalidateTenantCache(context.tenantId);
      return updated;
    });
  }

  /**
   * Adds an operational branch under a specific legal entity
   */
  async createBranch(context: TenantContext, dto: CreateBranchRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Enforce Subscription maxBranches limit with row lock
      const [sub] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .for('update')
        .limit(1);

      if (sub) {
        const [cnt] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(branches)
          .where(eq(branches.tenantId, context.tenantId));
        if ((cnt?.total ?? 0) >= sub.maxBranches) {
          throw new BadRequestException(
            `Subscription limit reached: maximum ${sub.maxBranches} branches allowed on plan '${sub.planCode}'`
          );
        }
      }

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

      invalidateTenantCache(context.tenantId);
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

      invalidateTenantCache(context.tenantId);
      return updated;
    });
  }

  /**
   * Registers a POS device under a branch and generates a secure Device Epoch
   */
  async registerDevice(context: TenantContext, dto: RegisterDeviceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Enforce Subscription maxDevices limit with row lock
      const [sub] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .for('update')
        .limit(1);

      if (sub) {
        const [cnt] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(devices)
          .where(eq(devices.tenantId, context.tenantId));
        if ((cnt?.total ?? 0) >= sub.maxDevices) {
          throw new BadRequestException(
            `Subscription limit reached: maximum ${sub.maxDevices} devices allowed on plan '${sub.planCode}'`
          );
        }
      }

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
    const packs = await this.dbService.withTenantContext(
      {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        scopes: ['*'],
      },
      async (tx) =>
        await tx
          .select()
          .from(tenantIndustryPacks)
          .where(
            and(
              eq(tenantIndustryPacks.tenantId, tenantId),
              eq(tenantIndustryPacks.status, IndustryPackStatus.ACTIVE)
            )
          )
    );

    for (const p of packs) {
      if (p.industry === requiredCapabilityOrIndustry) return true;
      const caps = INDUSTRY_CAPABILITIES[p.industry as IndustryType] || [];
      if (caps.includes(requiredCapabilityOrIndustry)) return true;
    }

    return false;
  }

  // ==================================================================
  // Integrations & Notifications (WhatsApp, Webhooks, SMS, Email)
  // ==================================================================

  private deriveKeyAndFingerprint(rawKey: string): { key: Buffer; fingerprint: string } {
    const key = createHash('sha256').update(rawKey).digest();
    const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 8);
    return { key, fingerprint };
  }

  private getIntegrationEncryptionKey(): { key: Buffer; fingerprint: string } {
    const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
    if (!raw || raw.length < 32) {
      throw new Error(
        'INTEGRATION_ENCRYPTION_KEY is required (minimum 32 characters, independent of JWT_SECRET)'
      );
    }
    if (process.env.JWT_SECRET && raw === process.env.JWT_SECRET.trim()) {
      throw new Error('INTEGRATION_ENCRYPTION_KEY must be independent of JWT_SECRET');
    }
    return this.deriveKeyAndFingerprint(raw);
  }

  private getDecryptionCandidateKeys(): Array<{ key: Buffer; fingerprint: string }> {
    const primary = this.getIntegrationEncryptionKey();
    const prevRaw = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS || '';
    const previous = prevRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 32)
      .map((s) => this.deriveKeyAndFingerprint(s));
    return [primary, ...previous];
  }

  private encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const { key, fingerprint } = this.getIntegrationEncryptionKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `__enc:v2:${fingerprint}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  private decryptWithKey(key: Buffer, ivHex: string, tagHex: string, encHex: string): string {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  private decryptSecret(value: string): string {
    if (!value.startsWith('__enc:')) return value;
    const candidates = this.getDecryptionCandidateKeys();

    if (value.startsWith('__enc:v2:')) {
      const parts = value.slice(9).split(':');
      if (parts.length !== 4) throw new Error('Invalid v2 encrypted secret format');
      const [fp, ivHex, tagHex, encHex] = parts;
      const ordered = [
        ...candidates.filter((c) => c.fingerprint === fp),
        ...candidates.filter((c) => c.fingerprint !== fp),
      ];
      for (const candidate of ordered) {
        try {
          return this.decryptWithKey(candidate.key, ivHex!, tagHex!, encHex!);
        } catch {
          // try next rotated key
        }
      }
      throw new Error('Unable to decrypt v2 secret with current or previous integration keys');
    }

    const parts = value.slice(6).split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
    const [ivHex, tagHex, encHex] = parts;
    for (const candidate of candidates) {
      try {
        return this.decryptWithKey(candidate.key, ivHex!, tagHex!, encHex!);
      } catch {
        // try next rotated key
      }
    }
    throw new Error('Unable to decrypt legacy secret with current or previous integration keys');
  }

  private encryptConfigSecrets(
    incoming: Record<string, any>,
    existing: Record<string, any> = {}
  ): Record<string, any> {
    const result: Record<string, any> = { ...existing };
    for (const [k, v] of Object.entries(incoming || {})) {
      if (SECRET_CONFIG_KEYS.has(k)) {
        if (typeof v === 'string' && v.trim().length > 0 && !v.startsWith('****')) {
          result[k] = this.encryptSecret(v.trim());
        }
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  private maskConfigJson(config: Record<string, any> | null | undefined): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(config || {})) {
      if (SECRET_CONFIG_KEYS.has(k) && typeof v === 'string' && v.length > 0) {
        let last4 = '****';
        try {
          const dec = this.decryptSecret(v);
          last4 = dec.length >= 4 ? dec.slice(-4) : '****';
        } catch {
          last4 = '****';
        }
        out[k] = `****${last4}`;
        out[`${k}Configured`] = true;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private signWebhookPayload(secret: string, timestamp: number, payload: Record<string, any>): string {
    const bodyStr = JSON.stringify(payload);
    const sig = createHmac('sha256', secret)
      .update(`${timestamp}.${bodyStr}`)
      .digest('hex');
    return `t=${timestamp},v1=${sig}`;
  }

  async verifyWebhookSignature(
    context: TenantContext,
    dto: {
      channel?: string;
      timestamp: number;
      rawBody: string;
      signatureHeader: string;
      nonce?: string;
      messageId?: string;
    }
  ) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - dto.timestamp) > 300) {
      throw new BadRequestException('Webhook timestamp outside 5-minute replay window');
    }

    const nonce = (dto.nonce || dto.messageId || '').trim();
    if (!nonce) {
      throw new BadRequestException('Webhook nonce or messageId is required for replay protection');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const channel = (dto.channel || 'WEBHOOK').toUpperCase();
      const [integration] = await tx
        .select()
        .from(tenantIntegrations)
        .where(
          and(
            eq(tenantIntegrations.tenantId, context.tenantId),
            eq(tenantIntegrations.channel, channel)
          )
        )
        .limit(1);

      const encSecret = integration?.configJson?.webhookSecret;
      if (!encSecret || typeof encSecret !== 'string') {
        throw new BadRequestException('Webhook secret is not configured for this tenant');
      }
      const secret = this.decryptSecret(encSecret);

      const parts = Object.fromEntries(
        dto.signatureHeader.split(',').map((p) => {
          const [k, v] = p.split('=');
          return [k?.trim(), v?.trim()];
        })
      );
      const receivedHex = parts['v1'];
      if (!receivedHex) {
        return { valid: false, reason: 'Missing v1 signature' };
      }

      const expectedHex = createHmac('sha256', secret)
        .update(`${dto.timestamp}.${dto.rawBody}`)
        .digest('hex');

      const a = Buffer.from(receivedHex, 'hex');
      const b = Buffer.from(expectedHex, 'hex');
      const valid = a.length === b.length && timingSafeEqual(a, b);
      if (!valid) {
        return { valid: false, reason: 'Invalid signature' };
      }

      const inserted = await tx
        .insert(webhookReplayNonces)
        .values({
          tenantId: context.tenantId,
          channel,
          nonce,
          timestampSec: dto.timestamp,
          expiresAt: new Date((dto.timestamp + 3600) * 1000),
        })
        .onConflictDoNothing({
          target: [webhookReplayNonces.tenantId, webhookReplayNonces.nonce],
        })
        .returning({ id: webhookReplayNonces.id });

      if (inserted.length === 0) {
        throw new ConflictException('Webhook replay detected: nonce already used');
      }

      return { valid: true, nonce, recordedId: inserted[0]!.id };
    });
  }

  async rotateIntegrationSecrets(context: TenantContext) {
    const { fingerprint } = this.getIntegrationEncryptionKey();
    return await this.dbService.withTenantContext(context, async (tx) => {
      const rows = await tx
        .select()
        .from(tenantIntegrations)
        .where(eq(tenantIntegrations.tenantId, context.tenantId))
        .for('update');

      let rotatedChannels = 0;
      let rotatedSecrets = 0;

      for (const row of rows) {
        const cfg = { ...(row.configJson || {}) };
        let changed = false;
        for (const [k, v] of Object.entries(cfg)) {
          if (SECRET_CONFIG_KEYS.has(k) && typeof v === 'string' && v.startsWith('__enc:')) {
            const plain = this.decryptSecret(v);
            cfg[k] = this.encryptSecret(plain);
            changed = true;
            rotatedSecrets += 1;
          }
        }
        if (changed) {
          await tx
            .update(tenantIntegrations)
            .set({
              configJson: cfg,
              updatedBy: context.userId,
              updatedAt: new Date(),
            })
            .where(eq(tenantIntegrations.id, row.id));
          rotatedChannels += 1;
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INTEGRATION_KEYS_ROTATED',
          entityType: 'tenant_integration',
          entityId: context.tenantId,
          afterState: { keyFingerprint: fingerprint, rotatedChannels, rotatedSecrets },
        },
        tx
      );

      return { keyFingerprint: fingerprint, rotatedChannels, rotatedSecrets };
    });
  }

  async getTenantIntegrations(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const rows = await tx
        .select()
        .from(tenantIntegrations)
        .where(eq(tenantIntegrations.tenantId, context.tenantId));
      return rows.map((r) => ({
        ...r,
        configJson: this.maskConfigJson(r.configJson),
      }));
    });
  }

  async upsertTenantIntegration(
    context: TenantContext,
    channel: string,
    dto: { provider?: string; isEnabled: boolean; configJson?: Record<string, any> }
  ) {
    const normalizedChannel = channel.toUpperCase();
    if (!['WHATSAPP', 'WEBHOOK', 'SMS', 'EMAIL'].includes(normalizedChannel)) {
      throw new BadRequestException(`Unsupported integration channel: ${channel}`);
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(tenantIntegrations)
        .where(
          and(
            eq(tenantIntegrations.tenantId, context.tenantId),
            eq(tenantIntegrations.channel, normalizedChannel)
          )
        )
        .for('update')
        .limit(1);

      const encryptedConfig = this.encryptConfigSecrets(
        dto.configJson ?? {},
        existing?.configJson ?? {}
      );

      let saved;
      if (existing) {
        const [updated] = await tx
          .update(tenantIntegrations)
          .set({
            provider: dto.provider || existing.provider,
            isEnabled: dto.isEnabled,
            configJson: encryptedConfig,
            updatedBy: context.userId,
            updatedAt: new Date(),
          })
          .where(eq(tenantIntegrations.id, existing.id))
          .returning();
        saved = updated;
      } else {
        const [inserted] = await tx
          .insert(tenantIntegrations)
          .values({
            tenantId: context.tenantId,
            channel: normalizedChannel,
            provider: dto.provider || (normalizedChannel === 'WHATSAPP' ? 'META_CLOUD_API' : 'CUSTOM'),
            isEnabled: dto.isEnabled,
            configJson: encryptedConfig,
            updatedBy: context.userId,
          })
          .returning();
        saved = inserted;
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'INTEGRATION_CONFIG_UPDATED',
          entityType: 'tenant_integration',
          entityId: saved!.id,
          afterState: {
            channel: normalizedChannel,
            isEnabled: dto.isEnabled,
            provider: saved!.provider,
            configKeys: Object.keys(encryptedConfig),
          },
        },
        tx
      );

      return {
        ...saved!,
        configJson: this.maskConfigJson(saved!.configJson),
      };
    });
  }

  async dispatchNotification(
    context: TenantContext,
    dto: {
      channel: string;
      recipient: string;
      eventType: string;
      payload?: Record<string, any>;
      branchId?: string;
      idempotencyKey?: string;
      simulateFailure?: boolean;
    }
  ) {
    const normalizedChannel = dto.channel.toUpperCase();
    if (!['WHATSAPP', 'WEBHOOK', 'SMS', 'EMAIL'].includes(normalizedChannel)) {
      throw new BadRequestException(`Unsupported notification channel: ${dto.channel}`);
    }
    if (!dto.recipient || dto.recipient.trim().length < 2) {
      throw new BadRequestException('Recipient is required');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingLog] = await tx
          .select()
          .from(notificationLogs)
          .where(
            and(
              eq(notificationLogs.tenantId, context.tenantId),
              eq(notificationLogs.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);
        if (existingLog) {
          return existingLog;
        }
      }

      const [integration] = await tx
        .select()
        .from(tenantIntegrations)
        .where(
          and(
            eq(tenantIntegrations.tenantId, context.tenantId),
            eq(tenantIntegrations.channel, normalizedChannel)
          )
        )
        .limit(1);

      const payloadObj: Record<string, any> = { ...(dto.payload ?? {}) };
      if (normalizedChannel === 'WHATSAPP') {
        const lookupKey = String(payloadObj.templateKey || dto.eventType || '').toUpperCase();
        if (lookupKey) {
          const [tpl] = await tx
            .select()
            .from(whatsappTemplates)
            .where(
              and(
                eq(whatsappTemplates.tenantId, context.tenantId),
                eq(whatsappTemplates.templateKey, lookupKey),
                eq(whatsappTemplates.isActive, true)
              )
            )
            .limit(1);
          if (tpl) {
            const vars = (payloadObj.variables ?? payloadObj) as Record<string, unknown>;
            payloadObj.templateKey = tpl.templateKey;
            payloadObj.metaTemplateName = tpl.metaTemplateName;
            payloadObj.languageCode = tpl.languageCode;
            payloadObj.renderedMessage = this.renderWhatsappTemplateText(tpl, vars);
          }
        }
      }
      let signatureHeader: string | null = null;
      if (
        normalizedChannel === 'WEBHOOK' &&
        integration?.configJson?.webhookSecret &&
        typeof integration.configJson.webhookSecret === 'string'
      ) {
        const secret = this.decryptSecret(integration.configJson.webhookSecret);
        signatureHeader = this.signWebhookPayload(secret, Math.floor(Date.now() / 1000), payloadObj);
      }

      let status = 'SENT';
      let errorMessage: string | null = null;
      let nextRetryAt: Date | null = null;

      if (!integration || !integration.isEnabled) {
        status = 'SKIPPED_DISABLED';
        errorMessage = `Channel '${normalizedChannel}' is not enabled for this tenant`;
      } else if (dto.simulateFailure || dto.recipient.startsWith('fail://')) {
        status = 'RETRY_PENDING';
        errorMessage = 'Simulated delivery failure; scheduled for retry';
        nextRetryAt = new Date(Date.now() - 1000); // eligible immediately for worker/manual retry
      }

      const [log] = await tx
        .insert(notificationLogs)
        .values({
          tenantId: context.tenantId,
          branchId: dto.branchId || context.branchId || null,
          channel: normalizedChannel,
          recipient: dto.recipient.trim(),
          eventType: dto.eventType,
          payload: payloadObj,
          status,
          attemptCount: 1,
          maxAttempts: 3,
          nextRetryAt,
          signatureHeader,
          idempotencyKey: dto.idempotencyKey || null,
          errorMessage,
          sentBy: context.userId,
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'NOTIFICATION_DISPATCHED',
          entityType: 'notification_log',
          entityId: log!.id,
          afterState: { channel: normalizedChannel, eventType: dto.eventType, status },
        },
        tx
      );

      return log;
    });
  }

  async retryPendingNotifications(context: TenantContext, forceFail = false) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const now = new Date();
      const due = await tx
        .select()
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.tenantId, context.tenantId),
            eq(notificationLogs.status, 'RETRY_PENDING'),
            lte(notificationLogs.nextRetryAt, now)
          )
        )
        .for('update');

      const updatedRows = [];
      for (const row of due) {
        const nextAttempt = row.attemptCount + 1;
        const failedPermanently = forceFail && nextAttempt >= row.maxAttempts;
        const newStatus = forceFail
          ? failedPermanently
            ? 'FAILED'
            : 'RETRY_PENDING'
          : 'SENT';

        const [updated] = await tx
          .update(notificationLogs)
          .set({
            attemptCount: nextAttempt,
            status: newStatus,
            nextRetryAt: newStatus === 'RETRY_PENDING' ? new Date(Date.now() - 1000) : null,
            errorMessage:
              newStatus === 'SENT'
                ? null
                : `Retry attempt ${nextAttempt}/${row.maxAttempts} failed`,
          })
          .where(eq(notificationLogs.id, row.id))
          .returning();
        if (updated) updatedRows.push(updated);
      }

      return updatedRows;
    });
  }

  async getNotificationLogs(context: TenantContext, limit = 25, offset = 0) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const safeLimit = Math.min(Math.max(1, limit), 100);
      const safeOffset = Math.max(0, offset);
      return await tx
        .select()
        .from(notificationLogs)
        .where(eq(notificationLogs.tenantId, context.tenantId))
        .orderBy(sql`${notificationLogs.createdAt} DESC`)
        .limit(safeLimit)
        .offset(safeOffset);
    });
  }

  // ==================================================================
  // Live Executive Dashboard Summary
  // ==================================================================

  async getDashboardSummary(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const weekStart = new Date(todayStart);
      weekStart.setUTCDate(weekStart.getUTCDate() - 6);

      const excludedStatuses = ['CANCELLED', 'VOIDED', 'DRAFT'];

      const [salesToday] = await tx
        .select({
          orderCount: sql<number>`count(*)::int`,
          totalAmount: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)::text`,
        })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            gte(salesOrders.createdAt, todayStart),
            notInArray(salesOrders.status, excludedStatuses)
          )
        );

      const weeklyRows = await tx
        .select({
          day: sql<string>`to_char(${salesOrders.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
          total: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)::text`,
          orders: sql<number>`count(*)::int`,
        })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            gte(salesOrders.createdAt, weekStart),
            notInArray(salesOrders.status, excludedStatuses)
          )
        )
        .groupBy(sql`to_char(${salesOrders.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

      const [poStats] = await tx
        .select({
          openCount: sql<number>`count(*) filter (where ${purchaseOrders.status} in ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'))::int`,
          totalOpenAmount: sql<string>`coalesce(sum(${purchaseOrders.grandTotal}) filter (where ${purchaseOrders.status} in ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')), 0)::text`,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.tenantId, context.tenantId));

      const [apStats] = await tx
        .select({
          unpaidCount: sql<number>`count(*) filter (where ${supplierInvoices.status} in ('APPROVED', 'PARTIALLY_PAID'))::int`,
          unpaidTotal: sql<string>`coalesce(sum(${supplierInvoices.grandTotal} - ${supplierInvoices.paidAmount}) filter (where ${supplierInvoices.status} in ('APPROVED', 'PARTIALLY_PAID')), 0)::text`,
        })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.tenantId, context.tenantId));

      const [invStats] = await tx
        .select({
          trackedRows: sql<number>`count(*)::int`,
          totalOnHand: sql<string>`coalesce(sum(${inventoryBalances.onHandQty}), 0)::text`,
        })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.tenantId, context.tenantId));

      const [invValueStats] = await tx
        .select({
          totalValue: sql<string>`coalesce(sum(${inventoryCostLayers.quantityRemaining} * ${inventoryCostLayers.unitCost}), 0)::text`,
        })
        .from(inventoryCostLayers)
        .where(eq(inventoryCostLayers.tenantId, context.tenantId));

      const [zatcaStats] = await tx
        .select({
          egsCount: sql<number>`count(*)::int`,
        })
        .from(zatcaEgsCertificates)
        .where(eq(zatcaEgsCertificates.tenantId, context.tenantId));

      return {
        salesToday: {
          orderCount: salesToday?.orderCount || 0,
          totalAmount: parseFloat(salesToday?.totalAmount || '0'),
        },
        weeklySales: weeklyRows.map((r) => ({
          day: r.day,
          total: parseFloat(r.total || '0'),
          orders: r.orders || 0,
        })),
        purchasing: {
          openPoCount: poStats?.openCount || 0,
          openPoAmount: parseFloat(poStats?.totalOpenAmount || '0'),
          unpaidInvoiceCount: apStats?.unpaidCount || 0,
          unpaidInvoiceAmount: parseFloat(apStats?.unpaidTotal || '0'),
        },
        inventory: {
          trackedBalances: invStats?.trackedRows || 0,
          totalOnHandQty: parseFloat(invStats?.totalOnHand || '0'),
          totalInventoryValue: parseFloat(invValueStats?.totalValue || '0'),
        },
        zatca: {
          egsUnitsCount: zatcaStats?.egsCount || 0,
        },
      };
    });
  }

  // ====================================================================
  // WhatsApp Message Templates Management
  // ====================================================================

  private extractTemplateVariables(text: string): string[] {
    const matches = new Set<string>();
    const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) matches.add(m[1]);
    }
    return Array.from(matches);
  }

  private renderWhatsappTemplateText(
    tpl: { headerText?: string | null; bodyText: string; footerText?: string | null },
    variables: Record<string, unknown>
  ): string {
    const substitute = (input: string) =>
      input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
        const val = variables[key];
        return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
      });
    const parts = [
      tpl.headerText ? substitute(tpl.headerText) : '',
      substitute(tpl.bodyText),
      tpl.footerText ? substitute(tpl.footerText) : '',
    ].filter((p) => p.trim().length > 0);
    return parts.join('\n\n');
  }

  async listWhatsappTemplates(context: TenantContext) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const existing = await tx
        .select()
        .from(whatsappTemplates)
        .where(eq(whatsappTemplates.tenantId, context.tenantId))
        .orderBy(sql`${whatsappTemplates.createdAt} ASC`);

      if (existing.length > 0) {
        return existing;
      }

      const defaults = [
        {
          tenantId: context.tenantId,
          templateKey: 'ORDER_CONFIRMATION',
          nameAr: 'تأكيد الطلب',
          nameEn: 'Order Confirmation',
          metaTemplateName: 'rc_order_confirmation_ar',
          languageCode: 'ar',
          category: 'UTILITY',
          headerText: 'تأكيد طلبك #{{order_number}}',
          bodyText:
            'مرحباً {{customer_name}}، تم استلام طلبك رقم {{order_number}} بقيمة {{total_sar}} ر.س بنجاح.',
          footerText: 'شكراً لاختيارك مطعمنا',
          variablesJson: ['order_number', 'customer_name', 'total_sar'],
          isActive: true,
        },
        {
          tenantId: context.tenantId,
          templateKey: 'INVOICE_RECEIPT',
          nameAr: 'إرسال الفاتورة الضريبية',
          nameEn: 'Tax Invoice Receipt',
          metaTemplateName: 'rc_invoice_receipt_ar',
          languageCode: 'ar',
          category: 'UTILITY',
          headerText: 'الفاتورة الضريبية #{{invoice_number}}',
          bodyText:
            'عزيزي {{customer_name}}، إجمالي فاتورتك {{total_sar}} ر.س (شامل ضريبة القيمة المضافة {{vat_sar}} ر.س).',
          footerText: 'متوافق مع هيئة الزكاة والضريبة والجمارك',
          variablesJson: ['invoice_number', 'customer_name', 'total_sar', 'vat_sar'],
          isActive: true,
        },
        {
          tenantId: context.tenantId,
          templateKey: 'DELIVERY_DISPATCHED',
          nameAr: 'خروج طلب التوصيل',
          nameEn: 'Delivery Dispatched',
          metaTemplateName: 'rc_delivery_dispatched_ar',
          languageCode: 'ar',
          category: 'UTILITY',
          headerText: 'طلبك في الطريق إليك',
          bodyText:
            'مرحباً {{customer_name}}، خرج المندوب {{driver_name}} لتوصيل طلبك #{{order_number}}.',
          footerText: 'نتمنى لك وجبة شهية',
          variablesJson: ['customer_name', 'driver_name', 'order_number'],
          isActive: true,
        },
        {
          tenantId: context.tenantId,
          templateKey: 'OTP_VERIFICATION',
          nameAr: 'رمز التحقق الأمني',
          nameEn: 'Security OTP Code',
          metaTemplateName: 'rc_otp_verification_ar',
          languageCode: 'ar',
          category: 'AUTHENTICATION',
          headerText: null,
          bodyText: 'رمز التحقق الخاص بك في Restaurant Cloud هو: {{otp_code}}. صالح لمدة 15 دقيقة.',
          footerText: 'لا تشارك هذا الرمز مع أي شخص',
          variablesJson: ['otp_code'],
          isActive: true,
        },
        {
          tenantId: context.tenantId,
          templateKey: 'SUBSCRIPTION_REMINDER',
          nameAr: 'تذكير الاشتراك السحابي',
          nameEn: 'Subscription Renewal Reminder',
          metaTemplateName: 'rc_subscription_reminder_ar',
          languageCode: 'ar',
          category: 'UTILITY',
          headerText: 'تنبيه تجديد الاشتراك',
          bodyText:
            'مرحباً {{customer_name}}، اشتراك منشأتك في باقة {{plan_name}} يستحق التجديد بتاريخ {{due_date}}.',
          footerText: 'Restaurant Cloud SaaS',
          variablesJson: ['customer_name', 'plan_name', 'due_date'],
          isActive: true,
        },
      ];

      return tx.insert(whatsappTemplates).values(defaults).returning();
    });
  }

  async upsertWhatsappTemplate(
    context: TenantContext,
    dto: {
      id?: string;
      templateKey: string;
      nameAr: string;
      nameEn: string;
      metaTemplateName: string;
      languageCode: string;
      category: 'UTILITY' | 'AUTHENTICATION' | 'MARKETING';
      headerText?: string | null;
      bodyText: string;
      footerText?: string | null;
      isActive?: boolean;
    }
  ) {
    const templateKey = dto.templateKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const languageCode = dto.languageCode.trim().toLowerCase();
    const combinedText = `${dto.headerText || ''} ${dto.bodyText} ${dto.footerText || ''}`;
    const variablesJson = this.extractTemplateVariables(combinedText);

    return this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = dto.id
        ? await tx
            .select()
            .from(whatsappTemplates)
            .where(
              and(
                eq(whatsappTemplates.id, dto.id),
                eq(whatsappTemplates.tenantId, context.tenantId)
              )
            )
            .limit(1)
        : await tx
            .select()
            .from(whatsappTemplates)
            .where(
              and(
                eq(whatsappTemplates.tenantId, context.tenantId),
                eq(whatsappTemplates.templateKey, templateKey),
                eq(whatsappTemplates.languageCode, languageCode)
              )
            )
            .limit(1);

      const values = {
        templateKey,
        nameAr: dto.nameAr.trim(),
        nameEn: dto.nameEn.trim(),
        metaTemplateName: dto.metaTemplateName.trim(),
        languageCode,
        category: dto.category,
        headerText: dto.headerText?.trim() || null,
        bodyText: dto.bodyText.trim(),
        footerText: dto.footerText?.trim() || null,
        variablesJson,
        isActive: dto.isActive ?? true,
        updatedAt: new Date(),
      };

      const [saved] = existing
        ? await tx
            .update(whatsappTemplates)
            .set(values)
            .where(eq(whatsappTemplates.id, existing.id))
            .returning()
        : await tx
            .insert(whatsappTemplates)
            .values({ ...values, tenantId: context.tenantId })
            .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'WHATSAPP_TEMPLATE_SAVED',
          entityType: 'whatsapp_template',
          entityId: saved!.id,
          afterState: { templateKey, languageCode, isActive: values.isActive },
        },
        tx
      );

      return saved;
    });
  }

  async deleteWhatsappTemplate(context: TenantContext, templateId: string) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [deleted] = await tx
        .delete(whatsappTemplates)
        .where(
          and(
            eq(whatsappTemplates.id, templateId),
            eq(whatsappTemplates.tenantId, context.tenantId)
          )
        )
        .returning();

      if (!deleted) {
        throw new NotFoundException('WhatsApp template not found');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'WHATSAPP_TEMPLATE_DELETED',
          entityType: 'whatsapp_template',
          entityId: templateId,
          beforeState: { templateKey: deleted.templateKey },
        },
        tx
      );

      return { deleted: true, id: templateId };
    });
  }

  async previewWhatsappTemplate(
    context: TenantContext,
    dto: { templateId?: string; templateKey?: string; variables?: Record<string, string> }
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [tpl] = dto.templateId
        ? await tx
            .select()
            .from(whatsappTemplates)
            .where(
              and(
                eq(whatsappTemplates.id, dto.templateId),
                eq(whatsappTemplates.tenantId, context.tenantId)
              )
            )
            .limit(1)
        : dto.templateKey
          ? await tx
              .select()
              .from(whatsappTemplates)
              .where(
                and(
                  eq(whatsappTemplates.tenantId, context.tenantId),
                  eq(whatsappTemplates.templateKey, dto.templateKey.toUpperCase())
                )
              )
              .limit(1)
          : [undefined];

      if (!tpl) {
        throw new NotFoundException('WhatsApp template not found');
      }

      return {
        templateKey: tpl.templateKey,
        metaTemplateName: tpl.metaTemplateName,
        renderedMessage: this.renderWhatsappTemplateText(tpl, dto.variables ?? {}),
        variables: tpl.variablesJson,
      };
    });
  }
}
