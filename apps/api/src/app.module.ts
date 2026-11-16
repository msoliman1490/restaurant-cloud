import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
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
import { PartnersModule } from './modules/partners/partners.module';
import { OperationsFrameworkModule } from './common/operations/operations-framework.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ZatcaModule } from './modules/zatca/zatca.module';
import { HrModule } from './modules/hr/hr.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { SaasModule } from './modules/saas/saas.module';

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
    PartnersModule,
    SettlementsModule,
    ZatcaModule,
    HrModule,
    DeliveryModule,
    SaasModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
