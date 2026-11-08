import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantContext;
  }
);
