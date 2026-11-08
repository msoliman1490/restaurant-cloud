import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TenantContextService } from '../context/tenant-context.service';
import { CryptoUtil } from '../../modules/iam/crypto.util';
import { users, userMemberships, tenants, membershipScopes, roles, permissions, rolePermissions } from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';
import { TenantStatus, TenantContext } from '@restaurant-cloud/domain-kernel';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly contextService: TenantContextService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token missing');
    }

    const token = authHeader.substring(7);
    const tokenPayload = CryptoUtil.verifyToken<{
      userId: string;
      tenantId: string;
    }>(token);

    if (!tokenPayload) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    const { userId, tenantId } = tokenPayload;

    // Live Re-validation: Check Database directly to prevent stale JWT abuse
    const db = this.dbService.db;

    // 1. Verify Tenant Status
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant || (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.TRIAL)) {
      throw new ForbiddenException(`Tenant is not active. Current status: ${tenant?.status || 'NOT_FOUND'}`);
    }

    // 2. Verify User Status
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is inactive or suspended');
    }

    // 3. Verify User Membership in this Tenant
    const [membership] = await db
      .select()
      .from(userMemberships)
      .where(
        and(
          eq(userMemberships.tenantId, tenantId),
          eq(userMemberships.userId, userId),
          eq(userMemberships.status, 'ACTIVE')
        )
      )
      .limit(1);

    if (!membership) {
      throw new ForbiddenException('User is not an active member of this tenant');
    }

    // 4. Fetch Active Scopes & Permissions for this Membership
    const scopes = await db
      .select()
      .from(membershipScopes)
      .where(eq(membershipScopes.membershipId, membership.id));

    const userPermissions = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, membership.roleId));

    const permissionCodes = userPermissions.map((p) => p.code);

    const tenantContext: TenantContext = {
      tenantId,
      userId,
      scopes: permissionCodes,
    };

    request.tenantContext = tenantContext;
    request.userScopes = scopes;

    return true;
  }
}
