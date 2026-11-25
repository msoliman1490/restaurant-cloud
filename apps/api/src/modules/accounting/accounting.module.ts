import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { PostingEngineService } from './posting-engine.service';
import { FinancialResourcesService } from './financial-resources.service';
import { ReconciliationService } from './reconciliation.service';
import { PeriodClosingService } from './period-closing.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { OperationsFrameworkModule } from '../../common/operations/operations-framework.module';

@Module({
  imports: [DatabaseModule, AuditModule, OperationsFrameworkModule],
  controllers: [AccountingController],
  providers: [AccountingService, PostingEngineService, FinancialResourcesService, ReconciliationService, PeriodClosingService],
  exports: [AccountingService, PostingEngineService, FinancialResourcesService, ReconciliationService, PeriodClosingService],
})
export class AccountingModule {}
