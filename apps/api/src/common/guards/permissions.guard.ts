import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ANY_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    const anyPermissions = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!anyPermissions || anyPermissions.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext = request.tenantContext;

    if (!tenantContext || !tenantContext.scopes) {
      throw new ForbiddenException('No permissions context established for this request');
    }

    const checkPerm = (perm: string, scopes: string[]) => {
      if (scopes.includes('*') || scopes.includes(perm)) {
        return true;
      }
      // Hierarchical RBAC: resource.manage covers all resource.* actions
      // e.g., 'accounting.vault.manage' covers 'accounting.vault.view', 'accounting.vault.count', etc.
      // e.g., 'accounting.mapping.manage' covers 'accounting.mapping.create', 'accounting.mapping.update', etc.
      // e.g., 'device.manage' covers 'device.register', 'device.view', 'device.delete', etc.
      const parts = perm.split('.');
      if (parts.length === 2) {
        const managePerm = `${parts[0]}.manage`;
        if (scopes.includes(managePerm)) {
          return true;
        }
      } else if (parts.length >= 3) {
        const managePerm = `${parts[0]}.${parts[1]}.manage`;
        if (scopes.includes(managePerm)) {
          return true;
        }
      }
      return false;
    };

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasAll = requiredPermissions.every((perm) => checkPerm(perm, tenantContext.scopes));
      if (!hasAll) {
        throw new ForbiddenException(
          `Access denied. Missing required permission: ${requiredPermissions.join(', ')}`
        );
      }
    }

    if (anyPermissions && anyPermissions.length > 0) {
      const hasAny = anyPermissions.some((perm) => checkPerm(perm, tenantContext.scopes));
      if (!hasAny) {
        throw new ForbiddenException(
          `Access denied. Requires at least one of permissions: ${anyPermissions.join(', ')}`
        );
      }
    }

    return true;
  }
}

