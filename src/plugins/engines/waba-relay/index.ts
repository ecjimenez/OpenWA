/**
 * WABA Relay Engine Plugin
 * Built-in engine plugin that bridges a WhatsApp Business Cloud API number
 * through an external HTTP hub. The gateway never holds a Meta token — see
 * src/engine/waba-relay/waba-relay.adapter.ts for the trust model.
 */

import { PluginContext, PluginType, IEnginePlugin } from '../../../core/plugins';
import { IWhatsAppEngine } from '../../../engine/interfaces/whatsapp-engine.interface';
import { WabaRelayAdapter } from '../../../engine/waba-relay/waba-relay.adapter';

type WabaRelayConfig = {
  wabaRelay?: {
    hubUrl?: string;
    hubSecret?: string;
    phone?: string;
    displayPhone?: string;
    pushName?: string;
    dataDir?: string;
  };
};

export class WabaRelayPlugin implements IEnginePlugin {
  type = PluginType.ENGINE as const;
  private context?: PluginContext;

  // RegisteredConfig mirrors the Baileys plugin: construction-time config keeps
  // createEngine working even if enablePlugin fails before onLoad runs. The
  // factory constructs every engine plugin variadically with (engineConfig,
  // lidMappingStore); this engine has no LID mapping to do, so only the config
  // parameter is declared.
  constructor(private readonly registeredConfig?: Record<string, unknown>) {}

  onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.log('WABA Relay engine plugin loaded');
    return Promise.resolve();
  }

  onEnable(context: PluginContext): Promise<void> {
    context.logger.log('WABA Relay engine plugin enabled');
    return Promise.resolve();
  }

  onDisable(context: PluginContext): Promise<void> {
    context.logger.log('WABA Relay engine plugin disabled');
    return Promise.resolve();
  }

  createEngine(config: Record<string, unknown>): IWhatsAppEngine {
    const sessionId = config.sessionId as string;
    const dbSessionId = config.dbSessionId as string;

    const engineConfig = (this.context?.config ?? this.registeredConfig ?? {}) as WabaRelayConfig;
    const relay = engineConfig.wabaRelay ?? {};

    // Fail fast at session start: a relay session without hub coordinates can
    // never work, and a late failure would surface as silent send drops.
    if (!relay.hubUrl || !relay.hubSecret || !relay.phone) {
      throw new Error(
        'waba-relay engine requires WABA_RELAY_URL, WABA_RELAY_SECRET and WABA_RELAY_PHONE to be configured',
      );
    }

    return new WabaRelayAdapter({
      sessionId,
      dbSessionId,
      hubUrl: relay.hubUrl.replace(/\/$/, ''),
      hubSecret: relay.hubSecret,
      phone: relay.phone,
      displayPhone: relay.displayPhone ?? relay.phone,
      pushName: relay.pushName ?? 'WABA',
      dataDir: relay.dataDir,
    });
  }

  getFeatures(): string[] {
    return ['text-messages', 'media-messages', 'delivery-status', 'no-qr'];
  }
}
