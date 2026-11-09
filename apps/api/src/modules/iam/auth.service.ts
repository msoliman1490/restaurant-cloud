import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CryptoUtil } from './crypto.util';
import {
  users,
  userMemberships,
  tenants,
  roles,
  membershipScopes,
  permissions,
  rolePermissions,
} from '@restaurant-cloud/database';
import {
  LoginRequest,
  CreateUserRequest,
  UpdateUserStatusRequest,
  UpdateUserScopesRequest,
  CreateRoleRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TenantStatus } from '@restaurant-cloud/domain-kernel';
import { eq, and, or, isNull } from 'drizzle-orm';

@Injectable()
export class AuthService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  async login(dto: LoginRequest) {
    const db = this.dbService.db;

    // 1. Find User by email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email.toLowerCase()))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is suspended');
    }

    // 2. Verify Password
    const isValid = await CryptoUtil.verifyPassword(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 3. Find User Memberships
    const memberships = await db
      .select({
        membershipId: userMemberships.id,
        tenantId: userMemberships.tenantId,
        roleId: userMemberships.roleId,
        tenantCode: tenants.code,
        tenantName: tenants.displayName,
        tenantStatus: tenants.status,
      })
      .from(userMemberships)
      .innerJoin(tenants, eq(userMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(userMemberships.userId, user.id),
          eq(userMemberships.status, 'ACTIVE')
        )
      );

    if (memberships.length === 0) {
      throw new UnauthorizedException('User has no active organization memberships');
    }

    // Filter by tenant code if provided, otherwise select primary active membership
    let selectedMembership = memberships[0]!;
    if (dto.tenantCode) {
      const match = memberships.find((m) => m.tenantCode === dto.tenantCode);
      if (!match) {
        throw new UnauthorizedException(
          `User is not a member of tenant code '${dto.tenantCode}'`
        );
      }
      selectedMembership = match;
    }

    if (
      selectedMembership.tenantStatus !== TenantStatus.ACTIVE &&
      selectedMembership.tenantStatus !== TenantStatus.TRIAL
    ) {
      throw new UnauthorizedException('Target organization is suspended');
    }

    // 4. Update last login timestamp
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // 5. Fetch role and permissions for selected membership
    const [role] = await db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.id, selectedMembership.roleId))
      .limit(1);

    const userPerms = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, selectedMembership.roleId));

    const permissionCodes = userPerms.map((p) => p.code);

    // 6. Generate Signed JWT
    const token = CryptoUtil.signToken({
      userId: user.id,
      tenantId: selectedMembership.tenantId,
      email: user.email,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      role: role ? { id: role.id, name: role.name } : null,
      permissions: permissionCodes,
      activeTenant: {
        id: selectedMembership.tenantId,
        code: selectedMembership.tenantCode,
        name: selectedMembership.tenantName,
      },
      availableTenants: memberships.map((m) => ({
        id: m.tenantId,
        code: m.tenantCode,
        name: m.tenantName,
      })),
    };
  }

  async getMe(context: TenantContext) {
    const db = this.dbService.db;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, context.userId))
      .limit(1);

    if (!user) throw new NotFoundException('User not found');

    const [tenant] = await db
      .select({
        id: tenants.id,
        code: tenants.code,
        name: tenants.displayName,
      })
      .from(tenants)
      .where(eq(tenants.id, context.tenantId))
      .limit(1);

    const memberships = await db
      .select({
        tenantId: userMemberships.tenantId,
        roleId: userMemberships.roleId,
        tenantCode: tenants.code,
        tenantName: tenants.displayName,
      })
      .from(userMemberships)
      .innerJoin(tenants, eq(userMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(userMemberships.userId, user.id),
          eq(userMemberships.status, 'ACTIVE')
        )
      );

    const activeMembership = memberships.find((m) => m.tenantId === context.tenantId);

    let roleName = 'Member';
    if (activeMembership) {
      const [role] = await db
        .select({ name: roles.name })
        .from(roles)
        .where(eq(roles.id, activeMembership.roleId))
        .limit(1);
      if (role) roleName = role.name;
    }

    return {
      user,
      role: { name: roleName },
      activeTenant: tenant,
      permissions: context.scopes || [],
      availableTenants: memberships.map((m) => ({
        id: m.tenantId,
        code: m.tenantCode,
        name: m.tenantName,
      })),
    };
  }

  async createUser(context: TenantContext, dto: CreateUserRequest) {
    const db = this.dbService.db;

    // Check if user exists or create
    let [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email.toLowerCase()))
      .limit(1);

    if (!existingUser) {
      const hashedPassword = await CryptoUtil.hashPassword(dto.password);
      [existingUser] = await db
        .insert(users)
        .values({
          email: dto.email.toLowerCase(),
          displayName: dto.displayName,
          phone: dto.phone,
          passwordHash: hashedPassword,
        })
        .returning();
    }

    if (!existingUser) throw new Error('Failed to create or retrieve user');

    // Check if membership already exists in this tenant
    const [existingMembership] = await db
      .select()
      .from(userMemberships)
      .where(
        and(
          eq(userMemberships.tenantId, context.tenantId),
          eq(userMemberships.userId, existingUser.id)
        )
      )
      .limit(1);

    if (existingMembership) {
      throw new ConflictException(
        `User '${existingUser.email}' is already a member of this organization`
      );
    }

    // Create Membership and Scopes inside atomic Tenant Context transaction
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [membership] = await tx
        .insert(userMemberships)
        .values({
          tenantId: context.tenantId,
          userId: existingUser!.id,
          roleId: dto.roleId,
          status: 'ACTIVE',
        })
        .returning();

      if (!membership) throw new Error('Failed to create membership');

      // Insert Scopes
      if (dto.scopes && dto.scopes.length > 0) {
        for (const scope of dto.scopes) {
          await tx.insert(membershipScopes).values({
            membershipId: membership.id,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            accessMode: 'ALLOW',
          });
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'USER_MEMBER_INVITED',
          entityType: 'user_membership',
          entityId: membership.id,
          afterState: { email: existingUser!.email, roleId: dto.roleId },
        },
        tx
      );

      return {
        userId: existingUser!.id,
        membershipId: membership.id,
        email: existingUser!.email,
        displayName: existingUser!.displayName,
      };
    });
  }

  /**
   * Lists all users and their memberships within the current tenant
   */
  async listUsers(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const members = await tx
        .select({
          membershipId: userMemberships.id,
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          phone: users.phone,
          userStatus: users.status,
          membershipStatus: userMemberships.status,
          roleId: roles.id,
          roleCode: roles.code,
          roleName: roles.name,
          createdAt: userMemberships.createdAt,
        })
        .from(userMemberships)
        .innerJoin(users, eq(userMemberships.userId, users.id))
        .innerJoin(roles, eq(userMemberships.roleId, roles.id))
        .where(eq(userMemberships.tenantId, context.tenantId));

      const result = await Promise.all(
        members.map(async (m) => {
          const scopes = await tx
            .select()
            .from(membershipScopes)
            .where(eq(membershipScopes.membershipId, m.membershipId));
          return {
            ...m,
            scopes,
          };
        })
      );

      return result;
    });
  }

  /**
   * Retrieves single user details within tenant
   */
  async getUser(context: TenantContext, userId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [member] = await tx
        .select({
          membershipId: userMemberships.id,
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          phone: users.phone,
          userStatus: users.status,
          membershipStatus: userMemberships.status,
          roleId: roles.id,
          roleCode: roles.code,
          roleName: roles.name,
          createdAt: userMemberships.createdAt,
        })
        .from(userMemberships)
        .innerJoin(users, eq(userMemberships.userId, users.id))
        .innerJoin(roles, eq(userMemberships.roleId, roles.id))
        .where(
          and(
            eq(userMemberships.tenantId, context.tenantId),
            eq(userMemberships.userId, userId)
          )
        )
        .limit(1);

      if (!member) throw new NotFoundException(`User '${userId}' not found in organization`);

      const scopes = await tx
        .select()
        .from(membershipScopes)
        .where(eq(membershipScopes.membershipId, member.membershipId));

      return {
        ...member,
        scopes,
      };
    });
  }

  /**
   * Updates user membership status (ACTIVE or SUSPENDED)
   */
  async updateUserStatus(context: TenantContext, userId: string, dto: UpdateUserStatusRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(userMemberships)
        .where(
          and(
            eq(userMemberships.tenantId, context.tenantId),
            eq(userMemberships.userId, userId)
          )
        )
        .limit(1);

      if (!existing) throw new NotFoundException(`User '${userId}' not found in organization`);

      const [updated] = await tx
        .update(userMemberships)
        .set({ status: dto.status })
        .where(eq(userMemberships.id, existing.id))
        .returning();

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'USER_STATUS_UPDATED',
        entityType: 'user_membership',
        entityId: existing.id,
        beforeState: { status: existing.status },
        afterState: { status: dto.status },
      }, tx);

      return updated;
    });
  }

  /**
   * Updates user role and branch/entity scopes
   */
  async updateUserScopes(context: TenantContext, userId: string, dto: UpdateUserScopesRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [membership] = await tx
        .select()
        .from(userMemberships)
        .where(
          and(
            eq(userMemberships.tenantId, context.tenantId),
            eq(userMemberships.userId, userId)
          )
        )
        .limit(1);

      if (!membership) throw new NotFoundException(`User '${userId}' not found in organization`);

      // Update role if provided
      if (dto.roleId && dto.roleId !== membership.roleId) {
        await tx
          .update(userMemberships)
          .set({ roleId: dto.roleId })
          .where(eq(userMemberships.id, membership.id));
      }

      // Replace scopes
      await tx
        .delete(membershipScopes)
        .where(eq(membershipScopes.membershipId, membership.id));

      if (dto.scopes && dto.scopes.length > 0) {
        for (const scope of dto.scopes) {
          await tx.insert(membershipScopes).values({
            membershipId: membership.id,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            accessMode: 'ALLOW',
          });
        }
      }

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'USER_SCOPES_UPDATED',
        entityType: 'user_membership',
        entityId: membership.id,
        afterState: dto,
      }, tx);

      return {
        userId,
        membershipId: membership.id,
        roleId: dto.roleId || membership.roleId,
        scopes: dto.scopes,
      };
    });
  }

  /**
   * Lists roles available to this tenant (system roles + tenant custom roles)
   */
  async listRoles(context: TenantContext) {
    const db = this.dbService.db;
    const roleList = await db
      .select()
      .from(roles)
      .where(or(eq(roles.tenantId, context.tenantId), isNull(roles.tenantId)));

    const result = await Promise.all(
      roleList.map(async (r) => {
        const perms = await db
          .select({
            id: permissions.id,
            code: permissions.code,
            resource: permissions.resource,
            action: permissions.action,
            description: permissions.description,
          })
          .from(rolePermissions)
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(eq(rolePermissions.roleId, r.id));

        return {
          ...r,
          permissions: perms,
        };
      })
    );

    return result;
  }

  /**
   * Creates a custom tenant role with specified permissions
   */
  async createRole(context: TenantContext, dto: CreateRoleRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          tenantId: context.tenantId,
          code: dto.code,
          name: dto.name,
          isSystemRole: false,
        })
        .returning();

      if (!role) throw new Error('Failed to create role');

      for (const permId of dto.permissionIds) {
        await tx.insert(rolePermissions).values({
          roleId: role.id,
          permissionId: permId,
        });
      }

      await this.auditService.log({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'ROLE_CREATED',
        entityType: 'role',
        entityId: role.id,
        afterState: dto,
      }, tx);

      return role;
    });
  }

  /**
   * Lists all available system permissions
   */
  async listPermissions() {
    const db = this.dbService.db;
    return await db.select().from(permissions);
  }
}
