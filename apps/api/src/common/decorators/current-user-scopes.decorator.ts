import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserScopeRecord } from '../operations/operations-framework.service';

export const CurrentUserScopes = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserScopeRecord[] => {
    const request = ctx.switchToHttp().getRequest();
    return request.userScopes || [];
  }
);
