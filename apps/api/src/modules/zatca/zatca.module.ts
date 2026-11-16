import { Module } from '@nestjs/common';
import { ZatcaCryptoService } from './zatca-crypto.service';
import { ZatcaUblService } from './zatca-ubl.service';
import { ZatcaGatewayService } from './zatca-gateway.service';
import { ZatcaV2Service } from './zatca-v2.service';
import { ZatcaController } from './zatca.controller';

@Module({
  controllers: [ZatcaController],
  providers: [
    ZatcaCryptoService,
    ZatcaUblService,
    ZatcaGatewayService,
    ZatcaV2Service,
  ],
  exports: [
    ZatcaCryptoService,
    ZatcaUblService,
    ZatcaGatewayService,
    ZatcaV2Service,
  ],
})
export class ZatcaModule {}
