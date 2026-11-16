import { Module, Global } from '@nestjs/common';
import { OperationsFrameworkService } from './operations-framework.service';
import { DocumentNumberingService } from './document-numbering.service';
import { DocumentNumberingController } from './document-numbering.controller';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../../modules/audit/audit.module';

@Global()
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [DocumentNumberingController],
  providers: [OperationsFrameworkService, DocumentNumberingService],
  exports: [OperationsFrameworkService, DocumentNumberingService],
})
export class OperationsFrameworkModule {}
