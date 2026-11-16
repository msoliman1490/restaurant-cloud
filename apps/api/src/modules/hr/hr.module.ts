import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { TenantModule } from '../tenant/tenant.module';
import { AccountingModule } from '../accounting/accounting.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [DatabaseModule, AuditModule, TenantModule, AccountingModule, MediaModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
