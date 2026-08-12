/**
 * Capability service for hub pushes of the waba-relay engine: verifies the
 * HMAC body signature and routes the event to the live adapter. The
 * controller stays a thin orchestrator, per the repo's controller guard.
 */

import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { constantTimeEqual } from '../../common/security/constantTimeEqual';
import { WabaRelayAdapter, WabaRelayPushEvent } from '../../engine/waba-relay/waba-relay.adapter';

@Injectable()
export class WabaRelayIngressService {
  constructor(private readonly configService: ConfigService) {}

  handleSignedPush(rawBody: string, signatureHeader: string): void {
    const secret = this.configService.get<string>('engine.wabaRelay.pushSecret');
    // Fail closed: without a secret there is no way to tell the hub from a forger.
    if (!secret) throw new ServiceUnavailableException('push secret não configurado');

    if (!signatureHeader.startsWith('sha256=')) throw new UnauthorizedException('assinatura ausente');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!constantTimeEqual(signatureHeader.slice('sha256='.length), expected)) {
      throw new UnauthorizedException('assinatura inválida');
    }

    const event = JSON.parse(rawBody) as WabaRelayPushEvent;
    const adapter = event.phone ? WabaRelayAdapter.findByPhone(String(event.phone)) : undefined;
    if (adapter) {
      adapter.handlePushEvent(event);
      return;
    }
    // media_ready carries no phone; an event for an unknown phone is also
    // harmless — every live relay session re-syncs and dedups by design.
    for (const live of WabaRelayAdapter.all()) live.handlePushEvent(event);
  }
}
