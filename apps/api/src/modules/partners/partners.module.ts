import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { SubledgerController } from './subledger.controller';
import { PartnersService } from './partners.service';
import { ArSubledgerService } from './ar-subledger.service';
import { ApSubledgerService } from './ap-subledger.service';
import { SubledgerReconciliationService } from './subledger-reconciliation.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [DatabaseModule, AuditModule, AccountingModule],
  controllers: [PartnersController, SubledgerController],
  providers: [
    PartnersService,
    ArSubledgerService,
    ApSubledgerService,
    SubledgerReconciliationService,
  ],
  exports: [
    PartnersService,
    ArSubledgerService,
    ApSubledgerService,
    SubledgerReconciliationService,
  ],
})
export class PartnersModule {}
