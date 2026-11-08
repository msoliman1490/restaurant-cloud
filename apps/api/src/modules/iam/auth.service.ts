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
} from '@restaurant-cloud/shared-contracts';
import { TenantContext, TenantStatus } from '@restaurant-cloud/domain-kernel';
import { eq, and } from 'drizzle-orm';

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

    // 5. Generate Signed JWT
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
}
