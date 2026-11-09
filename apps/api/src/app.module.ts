import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { IamModule } from './modules/iam/iam.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { ProductionModule } from './modules/production/production.module';
import { DiningModule } from './modules/dining/dining.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { SalesModule } from './modules/sales/sales.module';
import { MediaModule } from './modules/media/media.module';
import { OperationsFrameworkModule } from './common/operations/operations-framework.module';
import { TenantContextService } from './common/context/tenant-context.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    OperationsFrameworkModule,
    IamModule,
    TenantModule,
    CatalogModule,
    MediaModule,
    InventoryModule,
    PurchasingModule,
    ProductionModule,
    DiningModule,
    AccountingModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService, TenantContextService],
})
export class AppModule {}
