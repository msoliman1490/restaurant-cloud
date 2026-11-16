import { Module } from '@nestjs/common';
import { SaasService } from './saas.service';
import { SaasController } from './saas.controller';
import { SuperAdminController } from './super-admin.controller';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';

@Module({
  controllers: [SaasController, SuperAdminController],
  providers: [SaasService, PlatformAdminGuard],
  exports: [SaasService],
})
export class SaasModule {}
