import { Module } from '@nestjs/common';
import { DiningController } from './dining.controller';
import { DiningService } from './dining.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { TenantModule } from '../tenant/tenant.module';
import { IndustryEntitlementGuard } from '../../common/guards/industry-entitlement.guard';

@Module({
  imports: [DatabaseModule, AuditModule, TenantModule],
  controllers: [DiningController],
  providers: [DiningService, IndustryEntitlementGuard],
  exports: [DiningService],
})
export class DiningModule {}
