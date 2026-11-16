import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { users } from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

/**
 * Strictly separates SaaS Platform Super Admins from Tenant Owners/Managers.
 * Must be paired with TenantContextGuard so request.tenantContext.userId is JWT-verified.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly dbService: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext | undefined = request.tenantContext;
    if (!tenantContext?.userId) {
      throw new ForbiddenException('Platform admin authentication required');
    }

    const [user] = await this.dbService.db
      .select({
        id: users.id,
        status: users.status,
        isPlatformAdmin: users.isPlatformAdmin,
      })
      .from(users)
      .where(eq(users.id, tenantContext.userId))
      .limit(1);

    if (!user || user.status !== 'ACTIVE' || !user.isPlatformAdmin) {
      throw new ForbiddenException('Super Admin privileges required');
    }

    return true;
  }
}
