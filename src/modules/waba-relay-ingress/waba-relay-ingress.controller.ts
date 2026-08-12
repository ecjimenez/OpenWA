/**
 * Ingress for hub pushes of the waba-relay engine.
 *
 * The relay hub POSTs JSON events ('mensagem' | 'status' | 'media_ready')
 * signed with HMAC-SHA256 of the raw body in x-hub-signature-256 (the same
 * convention Meta uses). The push is only a doorbell — the adapter re-syncs
 * from the hub backlog — so this endpoint stays deliberately dumb.
 *
 * Raw-body handling mirrors modules/integration/ingress.controller.ts: no DTO
 * binding, the exact signed bytes must reach the verifier.
 */

import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/auth.decorators';
import { WabaRelayIngressService } from './waba-relay-ingress.service';

@ApiTags('waba-relay')
@Controller('waba-relay')
export class WabaRelayIngressController {
  constructor(private readonly ingress: WabaRelayIngressService) {}

  @Public()
  @Post('ingress')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Receive a signed push event from the waba-relay hub',
    description:
      'Authenticity comes from the HMAC-SHA256 body signature (x-hub-signature-256), not from an API key: ' +
      'the caller is the relay hub, not a dashboard user.',
  })
  @ApiResponse({ status: 202, description: 'Event accepted (routing to the session engine is asynchronous).' })
  @ApiResponse({ status: 401, description: 'Missing or invalid body signature.' })
  @ApiResponse({ status: 503, description: 'OPENWA_PUSH_SECRET is not configured (fail closed).' })
  receive(@Req() req: Request & { rawBody?: Buffer }): { aceito: boolean } {
    const header = req.headers['x-hub-signature-256'];
    const provided = Array.isArray(header) ? header[0] : (header ?? '');
    this.ingress.handleSignedPush(req.rawBody?.toString('utf8') ?? '', provided);
    return { aceito: true };
  }
}
