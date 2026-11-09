import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  LoginRequestSchema,
  CreateUserRequestSchema,
  UpdateUserStatusRequestSchema,
  UpdateUserScopesRequestSchema,
  CreateRoleRequestSchema,
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

  @Get('auth/me')
  @UseGuards(TenantContextGuard)
  async getMe(@CurrentContext() context: TenantContext) {
    const data = await this.authService.getMe(context);
    return {
      success: true,
      data,
    };
  }

  @Get('users')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('user.read')
  async listUsers(@CurrentContext() context: TenantContext) {
    const data = await this.authService.listUsers(context);
    return {
      success: true,
      data,
    };
  }

  @Get('users/:id')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('user.read')
  async getUser(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.authService.getUser(context, id);
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

  @Patch('users/:id/status')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('user.update')
  async updateUserStatus(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateUserStatusRequestSchema.parse(body);
    const data = await this.authService.updateUserStatus(context, id, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Put('users/:id/scopes')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('user.update')
  async updateUserScopes(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateUserScopesRequestSchema.parse(body);
    const data = await this.authService.updateUserScopes(context, id, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Get('roles')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('role.read')
  async listRoles(@CurrentContext() context: TenantContext) {
    const data = await this.authService.listRoles(context);
    return {
      success: true,
      data,
    };
  }

  @Post('roles')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('role.create')
  async createRole(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateRoleRequestSchema.parse(body);
    const data = await this.authService.createRole(context, validatedDto);
    return {
      success: true,
      data,
    };
  }

  @Get('permissions')
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('role.read')
  async listPermissions() {
    const data = await this.authService.listPermissions();
    return {
      success: true,
      data,
    };
  }
}
