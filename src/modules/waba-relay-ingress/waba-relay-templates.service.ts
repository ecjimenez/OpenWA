/**
 * Capability service for Meta templates of waba-relay sessions: list, submit
 * for Meta review, and send an approved template (the only outbound path when
 * the 24h customer-service window is closed). Resolves the live engine via
 * EngineRegistry and refuses politely when the session is not a relay one.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { HubTemplate, SubmitTemplateInput, WabaRelayAdapter } from '../../engine/waba-relay/waba-relay.adapter';
import { MessageResult } from '../../engine/interfaces/whatsapp-engine.interface';

@Injectable()
export class WabaRelayTemplatesService {
  constructor(private readonly engines: EngineRegistry) {}

  private adapterOf(sessionId: string): WabaRelayAdapter {
    const engine = this.engines.get(sessionId);
    if (!engine) throw new NotFoundException('Sessão não está em execução');
    if (!(engine instanceof WabaRelayAdapter)) {
      throw new BadRequestException('Templates Meta só existem em sessões waba-relay');
    }
    return engine;
  }

  listTemplates(sessionId: string): Promise<HubTemplate[]> {
    return this.adapterOf(sessionId).listTemplates();
  }

  submitTemplate(sessionId: string, input: SubmitTemplateInput): Promise<unknown> {
    return this.adapterOf(sessionId).submitTemplate(input);
  }

  deleteTemplate(sessionId: string, nome: string): Promise<unknown> {
    return this.adapterOf(sessionId).deleteTemplate(nome);
  }

  sendTemplate(
    sessionId: string,
    chatId: string,
    nome: string,
    idioma?: string,
    components?: unknown[],
  ): Promise<MessageResult> {
    return this.adapterOf(sessionId).sendTemplate(chatId, nome, idioma, components);
  }
}
