import { Module } from '@nestjs/common';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [DatabaseModule, AuditModule, AccountingModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
