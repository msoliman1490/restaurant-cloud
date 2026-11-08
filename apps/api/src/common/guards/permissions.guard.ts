import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext = request.tenantContext;

    if (!tenantContext || !tenantContext.scopes) {
      throw new ForbiddenException('No permissions context established for this request');
    }

    const hasAll = requiredPermissions.every((perm) =>
      tenantContext.scopes.includes(perm) || tenantContext.scopes.includes('*')
    );

    if (!hasAll) {
      throw new ForbiddenException(
        `Access denied. Missing required permission: ${requiredPermissions.join(', ')}`
      );
    }

    return true;
  }
}
