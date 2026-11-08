import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ProductionModule } from '../production/production.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ProductionModule,
    AccountingModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
