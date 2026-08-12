import { Module } from '@nestjs/common';
import { WabaRelayIngressController } from './waba-relay-ingress.controller';
import { WabaRelayIngressService } from './waba-relay-ingress.service';

@Module({
  controllers: [WabaRelayIngressController],
  providers: [WabaRelayIngressService],
})
export class WabaRelayIngressModule {}
