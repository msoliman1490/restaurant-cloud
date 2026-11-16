import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CryptoUtil } from './crypto.util';
import { invalidateTenantCache } from '../../common/guards/tenant-context.guard';
import {
  users,
  userMemberships,
  tenants,
  roles,
  membershipScopes,
  permissions,
  rolePermissions,
  authVerificationTokens,
} from '@restaurant-cloud/database';
import {
  LoginRequest,
  CreateUserRequest,
  UpdateUserStatusRequest,
  UpdateUserScopesRequest,
  CreateRoleRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  RequestVerificationRequest,
  VerifyContactRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TenantStatus } from '@restaurant-cloud/domain-kernel';
import { eq, and, or, isNull, desc, gt } from 'drizzle-orm';

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

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked due to too many failed login attempts. Please try again later.'
      );
    }

    // 2. Verify Password
    const isValid = await CryptoUtil.verifyPassword(dto.password, user.passwordHash);
    if (!isValid) {
      const nextAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const shouldLock = nextAttempts >= 5;
      await db
        .update(users)
        .set({
          failedLoginAttempts: nextAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
        })
        .where(eq(users.id, user.id));
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

    // 4. Update last login timestamp & reset failed attempt counter
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
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
        isPlatformAdmin: Boolean(user.isPlatformAdmin),
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
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

  private hashVerificationCode(code: string): string {
    return createHash('sha256').update(code.trim()).digest('hex');
  }

  private isTestEnv(): boolean {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  }

  async requestVerification(dto: RequestVerificationRequest) {
    const db = this.dbService.db;
    const normalizedTarget =
      dto.purpose === 'EMAIL_VERIFY' ? dto.target.trim().toLowerCase() : dto.target.trim();
    const code = String(randomInt(100000, 999999));
    const tokenHash = this.hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const [matchingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        dto.purpose === 'EMAIL_VERIFY'
          ? eq(users.email, normalizedTarget)
          : eq(users.phone, normalizedTarget)
      )
      .limit(1);

    await db.insert(authVerificationTokens).values({
      userId: matchingUser?.id ?? null,
      target: normalizedTarget,
      purpose: dto.purpose,
      tokenHash,
      expiresAt,
    });

    return {
      accepted: true,
      message: 'If the target is eligible, a verification code has been issued.',
      ...(this.isTestEnv() ? { devPreviewCode: code } : {}),
    };
  }

  async verifyContact(dto: VerifyContactRequest) {
    const db = this.dbService.db;
    const normalizedTarget =
      dto.purpose === 'EMAIL_VERIFY' ? dto.target.trim().toLowerCase() : dto.target.trim();

    const [tokenRow] = await db
      .select()
      .from(authVerificationTokens)
      .where(
        and(
          eq(authVerificationTokens.target, normalizedTarget),
          eq(authVerificationTokens.purpose, dto.purpose),
          isNull(authVerificationTokens.consumedAt),
          gt(authVerificationTokens.expiresAt, new Date())
        )
      )
      .orderBy(desc(authVerificationTokens.createdAt))
      .limit(1);

    if (!tokenRow) {
      throw new BadRequestException('Verification code is invalid or expired');
    }

    const candidateHash = Buffer.from(this.hashVerificationCode(dto.code), 'hex');
    const storedHash = Buffer.from(tokenRow.tokenHash, 'hex');
    const isMatch =
      candidateHash.length === storedHash.length &&
      timingSafeEqual(candidateHash, storedHash);

    if (!isMatch) {
      throw new BadRequestException('Verification code is invalid or expired');
    }

    const now = new Date();
    await db
      .update(authVerificationTokens)
      .set({ consumedAt: now })
      .where(eq(authVerificationTokens.id, tokenRow.id));

    if (tokenRow.userId) {
      await db
        .update(users)
        .set(
          dto.purpose === 'EMAIL_VERIFY'
            ? { emailVerifiedAt: now }
            : { phoneVerifiedAt: now }
        )
        .where(eq(users.id, tokenRow.userId));
    }

    return {
      verified: true,
      purpose: dto.purpose,
      target: normalizedTarget,
      verifiedAt: now,
    };
  }

  async forgotPassword(dto: ForgotPasswordRequest) {
    const db = this.dbService.db;
    const email = dto.email.trim().toLowerCase();
    const [user] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let devCode: string | undefined;
    if (user && user.status === 'ACTIVE') {
      const code = String(randomInt(100000, 999999));
      devCode = code;
      await db.insert(authVerificationTokens).values({
        userId: user.id,
        target: email,
        purpose: 'PASSWORD_RESET',
        tokenHash: this.hashVerificationCode(code),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    }

    return {
      accepted: true,
      message: 'If an account matches this email, password reset instructions have been issued.',
      ...(this.isTestEnv() && devCode ? { devPreviewCode: devCode } : {}),
    };
  }

  async resetPassword(dto: ResetPasswordRequest) {
    const db = this.dbService.db;
    const email = dto.email.trim().toLowerCase();

    const [tokenRow] = await db
      .select()
      .from(authVerificationTokens)
      .where(
        and(
          eq(authVerificationTokens.target, email),
          eq(authVerificationTokens.purpose, 'PASSWORD_RESET'),
          isNull(authVerificationTokens.consumedAt),
          gt(authVerificationTokens.expiresAt, new Date())
        )
      )
      .orderBy(desc(authVerificationTokens.createdAt))
      .limit(1);

    if (!tokenRow || !tokenRow.userId) {
      throw new BadRequestException('Reset code is invalid or expired');
    }

    const candidateHash = Buffer.from(this.hashVerificationCode(dto.code), 'hex');
    const storedHash = Buffer.from(tokenRow.tokenHash, 'hex');
    const isMatch =
      candidateHash.length === storedHash.length &&
      timingSafeEqual(candidateHash, storedHash);

    if (!isMatch) {
      throw new BadRequestException('Reset code is invalid or expired');
    }

    const now = new Date();
    const passwordHash = await CryptoUtil.hashPassword(dto.newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(authVerificationTokens)
        .set({ consumedAt: now })
        .where(eq(authVerificationTokens.id, tokenRow.id));

      await tx
        .update(users)
        .set({
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, tokenRow.userId!));
    });

    return {
      reset: true,
      message: 'Password has been updated successfully.',
    };
  }

  async getMe(context: TenantContext) {
    const db = this.dbService.db;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isPlatformAdmin: users.isPlatformAdmin,
        emailVerifiedAt: users.emailVerifiedAt,
        phoneVerifiedAt: users.phoneVerifiedAt,
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

      invalidateTenantCache(context.tenantId, userId);
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

      invalidateTenantCache(context.tenantId, userId);
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
