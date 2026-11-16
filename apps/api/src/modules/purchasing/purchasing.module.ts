import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [DatabaseModule, AuditModule, InventoryModule, AccountingModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
