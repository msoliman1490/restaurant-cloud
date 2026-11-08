import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantContextService } from '../../common/context/tenant-context.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TenantContextService],
  exports: [AuthService, TenantContextService],
})
export class IamModule {}
