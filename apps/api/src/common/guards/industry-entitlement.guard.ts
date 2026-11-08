import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_CAPABILITY_KEY,
  REQUIRE_INDUSTRY_KEY,
} from '../decorators/industry-entitlement.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { TenantService } from '../../modules/tenant/tenant.service';

@Injectable()
export class IndustryEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantService: TenantService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCapability = this.reflector.getAllAndOverride<string>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()]
    );

    const requiredIndustry = this.reflector.getAllAndOverride<string>(
      REQUIRE_INDUSTRY_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredCapability && !requiredIndustry) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext = request.tenantContext;

    if (!tenantContext || !tenantContext.tenantId) {
      throw new ForbiddenException('No tenant context established for entitlement check');
    }

    const targetCheck = requiredCapability || requiredIndustry!;
    const hasEntitlement = await this.tenantService.checkEntitlement(
      tenantContext.tenantId,
      targetCheck
    );

    if (!hasEntitlement) {
      throw new ForbiddenException(
        `Access denied. Your active industry subscription does not include capability: '${targetCheck}'. Please activate the required Industry Pack in Settings.`
      );
    }

    return true;
  }
}
