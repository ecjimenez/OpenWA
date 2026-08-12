import { Module } from '@nestjs/common';
import { WabaRelayIngressController } from './waba-relay-ingress.controller';
import { WabaRelayIngressService } from './waba-relay-ingress.service';
import { WabaRelayTemplatesController } from './waba-relay-templates.controller';
import { WabaRelayTemplatesService } from './waba-relay-templates.service';

@Module({
  controllers: [WabaRelayIngressController, WabaRelayTemplatesController],
  providers: [WabaRelayIngressService, WabaRelayTemplatesService],
})
export class WabaRelayIngressModule {}
