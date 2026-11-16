import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { TenantModule } from '../tenant/tenant.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { IndustryEntitlementGuard } from '../../common/guards/industry-entitlement.guard';

@Module({
  imports: [DatabaseModule, AuditModule, TenantModule, AccountingModule, InventoryModule],
  controllers: [ProductionController],
  providers: [ProductionService, IndustryEntitlementGuard],
  exports: [ProductionService],
})
export class ProductionModule {}
