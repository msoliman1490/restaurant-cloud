import { Module, Global } from '@nestjs/common';
import { OperationsFrameworkService } from './operations-framework.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../../modules/audit/audit.module';

@Global()
@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [OperationsFrameworkService],
  exports: [OperationsFrameworkService],
})
export class OperationsFrameworkModule {}
