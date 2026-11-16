import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { OfflinePosService } from './offline-pos.service';
import { OfflinePosController } from './offline-pos.controller';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ProductionModule } from '../production/production.module';
import { AccountingModule } from '../accounting/accounting.module';
import { OperationsFrameworkModule } from '../../common/operations/operations-framework.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ProductionModule,
    AccountingModule,
    OperationsFrameworkModule,
  ],
  controllers: [SalesController, OfflinePosController],
  providers: [SalesService, OfflinePosService],
  exports: [SalesService, OfflinePosService],
})
export class SalesModule {}
