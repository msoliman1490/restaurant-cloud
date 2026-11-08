import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  LoginRequestSchema,
  CreateUserRequestSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  async login(@Body() body: unknown) {
    const validatedDto = LoginRequestSchema.parse(body);
    const data = await this.authService.login(validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Post('users')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('user.create')
  async createUser(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateUserRequestSchema.parse(body);
    const data = await this.authService.createUser(context, validatedDto);
    return {
      success: true,
      data,
    };
  }
}
