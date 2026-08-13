import { Module } from '@nestjs/common';
import { WabaRelayIngressController } from './waba-relay-ingress.controller';
import { WabaRelayIngressService } from './waba-relay-ingress.service';
import { WabaRelayTemplatesController } from './waba-relay-templates.controller';
import { WabaRelayTemplatesService } from './waba-relay-templates.service';
import { WabaRelayContactsController, WabaRelayContactsService } from './waba-relay-contacts.controller';

@Module({
  controllers: [WabaRelayIngressController, WabaRelayTemplatesController, WabaRelayContactsController],
  providers: [WabaRelayIngressService, WabaRelayTemplatesService, WabaRelayContactsService],
})
export class WabaRelayIngressModule {}
