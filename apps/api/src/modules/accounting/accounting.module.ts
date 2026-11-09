import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { PostingEngineService } from './posting-engine.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [AccountingController],
  providers: [AccountingService, PostingEngineService],
  exports: [AccountingService, PostingEngineService],
})
export class AccountingModule {}
