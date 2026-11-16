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

const TENANT_CACHE_TTL_MS = 30_000;
const TENANT_CACHE_MAX_ENTRIES = 10_000;

interface CachedTenantAuth {
  tenantContext: TenantContext;
  userScopes: unknown[];
  expiresAt: number;
}

const tenantAuthCache = new Map<string, CachedTenantAuth>();

function isCacheBypassed(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

/**
 * Explicitly invalidates cached tenant/user authorization context.
 * - If both tenantId and userId are provided, invalidates that specific entry.
 * - If only tenantId is provided, invalidates all cached entries for that tenant.
 * - If neither is provided, clears the entire cache.
 */
export function invalidateTenantCache(tenantId?: string, userId?: string): void {
  if (!tenantId) {
    tenantAuthCache.clear();
    return;
  }
  if (userId) {
    tenantAuthCache.delete(`${tenantId}:${userId}`);
    return;
  }
  const prefix = `${tenantId}:`;
  for (const key of tenantAuthCache.keys()) {
    if (key.startsWith(prefix)) {
      tenantAuthCache.delete(key);
    }
  }
}

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
    const cacheKey = `${tenantId}:${userId}`;
    const bypassCache = isCacheBypassed();

    if (!bypassCache) {
      const cached = tenantAuthCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        request.tenantContext = cached.tenantContext;
        request.userScopes = cached.userScopes;
        return true;
      }
      if (cached) {
        tenantAuthCache.delete(cacheKey);
      }
    }

    // Live Re-validation: Check Database directly to prevent stale JWT abuse
    const db = this.dbService.db;

    // 1-3. Verify Tenant Status, User Status, and Active Membership in parallel
    const [[tenant], [user], [membership]] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db
        .select()
        .from(userMemberships)
        .where(
          and(
            eq(userMemberships.tenantId, tenantId),
            eq(userMemberships.userId, userId),
            eq(userMemberships.status, 'ACTIVE')
          )
        )
        .limit(1),
    ]);

    if (!tenant || (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.TRIAL)) {
      throw new ForbiddenException(`Tenant is not active. Current status: ${tenant?.status || 'NOT_FOUND'}`);
    }

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is inactive or suspended');
    }

    if (!membership) {
      throw new ForbiddenException('User is not an active member of this tenant');
    }

    // 4-5. Fetch Active Scopes & Permissions for this Membership in parallel
    const [scopes, userPermissions] = await Promise.all([
      db
        .select()
        .from(membershipScopes)
        .where(eq(membershipScopes.membershipId, membership.id)),
      db
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, membership.roleId)),
    ]);

    const permissionCodes = userPermissions.map((p) => p.code);

    const tenantContext: TenantContext = {
      tenantId,
      userId,
      scopes: permissionCodes,
      userScopes: scopes,
    };

    if (!bypassCache) {
      if (tenantAuthCache.size >= TENANT_CACHE_MAX_ENTRIES) {
        const oldestKey = tenantAuthCache.keys().next().value;
        if (oldestKey) {
          tenantAuthCache.delete(oldestKey);
        }
      }
      tenantAuthCache.set(cacheKey, {
        tenantContext,
        userScopes: scopes,
        expiresAt: Date.now() + TENANT_CACHE_TTL_MS,
      });
    }

    request.tenantContext = tenantContext;
    request.userScopes = scopes;

    return true;
  }
}
