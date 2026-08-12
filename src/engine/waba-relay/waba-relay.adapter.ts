/**
 * WABA Relay engine adapter.
 *
 * Bridges a WhatsApp Business Cloud API number into the gateway WITHOUT ever
 * holding a Meta token: all traffic goes through an external HTTP hub (the
 * "relay") authenticated by a shared secret. Revoking that secret blinds this
 * engine while the Meta credentials, which live only on the hub, stay intact.
 *
 * Session model: one adapter instance = one Cloud API phone number. There is
 * no QR/pairing step — initialize() validates the hub and reports READY.
 *
 * Inbound flow is doorbell-driven: the hub POSTs signed push events to the
 * gateway ingress (see modules/waba-relay-ingress), which only *triggers* a
 * backlog sync here — message data always comes from GET /messages with a
 * persisted cursor, so pushes may be lost, replayed or reordered freely. A
 * slow fallback poll covers hub pushes that never arrive.
 *
 * Everything the Cloud API cannot do (groups, contacts, stickers, polls,
 * reactions, presence, channels, catalog, profile mutations...) refuses with
 * EngineNotSupportedError, the same pattern the Baileys adapter uses.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EngineNotSupportedError } from '../../common/errors/engine-not-supported.error';
import { chatKind } from '../identity/wa-id';
import {
  ChatSummary,
  DeliveryStatus,
  EngineEventCallbacks,
  EngineStatus,
  IncomingMessage,
  IWhatsAppEngine,
  MediaInput,
  MessageResult,
  MessageType,
} from '../interfaces/whatsapp-engine.interface';

export interface WabaRelayAdapterOptions {
  sessionId: string;
  dbSessionId: string;
  /** Base URL of the relay hub (no trailing slash). */
  hubUrl: string;
  /** Shared secret sent as x-relay-secret on every hub call. */
  hubSecret: string;
  /** Cloud API phone_number_id this session speaks for (hub-side routing key). */
  phone: string;
  /** Human phone number shown in the dashboard (digits only or +55... display). */
  displayPhone: string;
  pushName: string;
  /** Directory for the persisted backlog cursor. */
  dataDir?: string;
}

/** Hub wire formats (see the waba-relay Edge Function contract). */
type HubMessage = {
  id: string;
  direcao: 'in' | 'out';
  wamid: string | null;
  tipo: string;
  texto: string | null;
  caption: string | null;
  chat_wa_id: string | null;
  chat_nome: string | null;
  midia: { mime: string | null; status: string } | null;
  responde_a: string | null;
  entrega: string | null;
  criada_em: string;
};

type HubSendResult = {
  outbox_id: string;
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  motivo: string | null;
  message_id: string | null;
};

export type WabaRelayPushEvent = {
  evento: 'mensagem' | 'status' | 'media_ready';
  phone?: string | null;
  wamid?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

const FALLBACK_POLL_MS = 60_000;

/** Media larger than this is surfaced as omitted instead of inlined as base64. */
const MEDIA_INLINE_MAX_BYTES = 6 * 1024 * 1024;

const HUB_TYPE_MAP: Record<string, MessageType> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  sticker: 'sticker',
  location: 'location',
  // Cloud API payloads with no engine-neutral equivalent read as text so the
  // conversation stays legible in the panel.
  interactive: 'text',
  button: 'text',
  template: 'text',
};

const HUB_DELIVERY_MAP: Record<string, DeliveryStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

export class WabaRelayAdapter implements IWhatsAppEngine {
  /**
   * Live adapters by Cloud API phone_number_id — how the ingress controller
   * routes a hub push to the right session without a DB round-trip.
   */
  private static readonly byPhone = new Map<string, WabaRelayAdapter>();

  static findByPhone(phone: string): WabaRelayAdapter | undefined {
    return WabaRelayAdapter.byPhone.get(phone);
  }

  static all(): WabaRelayAdapter[] {
    return [...WabaRelayAdapter.byPhone.values()];
  }

  private callbacks: EngineEventCallbacks = {};
  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private cursor: string | null = null;
  private pollTimer?: NodeJS.Timeout;
  private syncing = false;
  /** A push arrived while a sync was running; run one more pass right after. */
  private syncQueued = false;

  constructor(private readonly opts: WabaRelayAdapterOptions) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async initialize(callbacks: EngineEventCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.setStatus(EngineStatus.INITIALIZING);

    // Validates URL + secret in one shot; a bad secret fails the session
    // loudly here instead of silently dropping every later send.
    await this.hubGet('/chats');

    this.cursor = this.loadCursor();
    WabaRelayAdapter.byPhone.set(this.opts.phone, this);

    this.setStatus(EngineStatus.READY);
    this.callbacks.onReady?.(this.opts.displayPhone, this.opts.pushName);

    // Catch-up runs after READY so a long backlog doesn't trip the engine
    // init timeout; the panel fills in as messages stream through onMessage.
    void this.requestSync();
    this.pollTimer = setInterval(() => void this.requestSync(), FALLBACK_POLL_MS);
  }

  disconnect(): Promise<void> {
    this.teardown();
    this.setStatus(EngineStatus.DISCONNECTED);
    return Promise.resolve();
  }

  logout(): Promise<void> {
    // No credentials live on this side; "logout" just stops the session.
    return this.disconnect();
  }

  destroy(): Promise<void> {
    return this.disconnect();
  }

  forceDestroy(): Promise<void> {
    return this.disconnect();
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async probeLiveness(): Promise<boolean> {
    try {
      await this.hubGet('/chats');
      return true;
    } catch {
      return false;
    }
  }

  getQRCode(): string | null {
    // Cloud API sessions have no QR flow; null makes the QR endpoint 4xx.
    return null;
  }

  requestPairingCode(): Promise<string> {
    return this.unsupported('requestPairingCode');
  }

  getPhoneNumber(): string | null {
    return this.opts.displayPhone;
  }

  getPushName(): string | null {
    return this.opts.pushName;
  }

  // ── Push ingress (called by WabaRelayIngressController) ───────────────

  handlePushEvent(event: WabaRelayPushEvent): void {
    if (event.evento === 'status' && event.wamid && event.status) {
      const mapped = HUB_DELIVERY_MAP[event.status];
      if (mapped) this.callbacks.onMessageAck?.(event.wamid, mapped);
      return;
    }
    // 'mensagem' and 'media_ready' are doorbells: the authoritative data
    // (ids, dedup, media state) comes from the backlog, never from the push.
    void this.requestSync();
  }

  // ── Sending ───────────────────────────────────────────────────────────

  async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {
    return this.hubSend({ tipo: 'text', para: this.waIdOf(chatId), texto: text });
  }

  sendImageMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMedia('image', chatId, media);
  }

  sendVideoMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMedia('video', chatId, media);
  }

  sendAudioMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMedia('audio', chatId, media);
  }

  sendDocumentMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMedia('document', chatId, media);
  }

  replyToMessage(chatId: string, _quotedMsgId: string, text: string): Promise<MessageResult> {
    // The hub does not carry quote context yet; the reply goes as plain text.
    void _quotedMsgId;
    return this.sendTextMessage(chatId, text);
  }

  // ── Chats ─────────────────────────────────────────────────────────────

  async getChats(): Promise<ChatSummary[]> {
    const data = (await this.hubGet('/chats')) as {
      chats: { wa_id: string; nome: string | null; ultima_entrada: string | null; ultima_saida: string | null }[];
    };
    return (data.chats ?? []).map(c => {
      const id = `${c.wa_id}@c.us`;
      const last = c.ultima_entrada ?? c.ultima_saida;
      return {
        id,
        name: c.nome ?? c.wa_id,
        isGroup: false,
        kind: chatKind(id),
        unreadCount: 0,
        timestamp: last ? Math.floor(Date.parse(last) / 1000) : 0,
      };
    });
  }

  sendSeen(): Promise<boolean> {
    // The hub has no read-receipt endpoint; resolving keeps the panel quiet
    // on every chat open instead of flooding it with 501s.
    return Promise.resolve(false);
  }

  sendChatState(): Promise<void> {
    return Promise.resolve();
  }

  setOnlinePresence(): Promise<void> {
    return Promise.resolve();
  }

  // ── Hub client ────────────────────────────────────────────────────────

  private async hubGet(route: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${this.opts.hubUrl}${route}`);
    url.searchParams.set('phone', this.opts.phone);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { 'x-relay-secret': this.opts.hubSecret } });
    if (!res.ok) throw new Error(`waba-relay hub GET ${route}: ${res.status}`);
    return res.json();
  }

  private async hubSend(body: { tipo: string; para: string; [key: string]: unknown }): Promise<MessageResult> {
    const res = await fetch(`${this.opts.hubUrl}/send`, {
      method: 'POST',
      headers: { 'x-relay-secret': this.opts.hubSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ de: this.opts.phone, idempotency_key: crypto.randomUUID(), ...body }),
    });
    if (!res.ok) throw new Error(`waba-relay hub POST /send: ${res.status}`);
    const result = (await res.json()) as HubSendResult;
    if (result.status === 'skipped' || result.status === 'failed') {
      // e.g. "janela de 24h fechada — exige template": the panel must see why.
      throw new Error(result.motivo ?? `hub recusou o envio (${result.status})`);
    }
    return { id: result.message_id ?? result.outbox_id, timestamp: Math.floor(Date.now() / 1000) };
  }

  private async sendMedia(tipo: string, chatId: string, media: MediaInput): Promise<MessageResult> {
    const link = await this.resolveMediaLink(media);
    return this.hubSend({
      tipo,
      para: this.waIdOf(chatId),
      link,
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.filename ? { filename: media.filename } : {}),
    });
  }

  /** URL passes through; Buffer/base64 is uploaded to the hub for a signed link. */
  private async resolveMediaLink(media: MediaInput): Promise<string> {
    if (typeof media.data === 'string' && /^https?:\/\//i.test(media.data)) return media.data;
    const bytes = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data, 'base64');
    const res = await fetch(`${this.opts.hubUrl}/upload`, {
      method: 'POST',
      headers: { 'x-relay-secret': this.opts.hubSecret, 'content-type': media.mimetype },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`waba-relay hub POST /upload: ${res.status}`);
    const uploaded = (await res.json()) as { link: string };
    return uploaded.link;
  }

  // ── Backlog sync ──────────────────────────────────────────────────────

  private async requestSync(): Promise<void> {
    if (this.syncing) {
      this.syncQueued = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncQueued = false;
        await this.syncOnce();
      } while (this.syncQueued);
    } catch (err) {
      this.callbacks.onError?.(`waba-relay sync: ${err instanceof Error ? err.message : 'erro'}`);
    } finally {
      this.syncing = false;
    }
  }

  private async syncOnce(): Promise<void> {
    for (;;) {
      const page = (await this.hubGet('/messages', {
        limit: '200',
        ...(this.cursor ? { after: this.cursor } : {}),
      })) as { mensagens: HubMessage[]; proximo_after: string | null };

      const mensagens = page.mensagens ?? [];
      for (const m of mensagens) {
        const incoming = await this.toIncoming(m);
        if (!incoming) continue;
        // The projector's UNIQUE (sessionId, waMessageId) dedups replays, so
        // emitting the same message twice is harmless by design.
        if (incoming.fromMe) this.callbacks.onMessageCreate?.(incoming);
        else this.callbacks.onMessage?.(incoming);
      }

      if (page.proximo_after) {
        this.cursor = page.proximo_after;
        this.saveCursor(this.cursor);
      }
      if (mensagens.length < 200) return;
    }
  }

  private async toIncoming(m: HubMessage): Promise<IncomingMessage | null> {
    if (!m.chat_wa_id) return null;
    const chatId = `${m.chat_wa_id}@c.us`;
    const selfId = `${this.digits(this.opts.displayPhone)}@c.us`;
    const fromMe = m.direcao === 'out';
    return {
      id: m.wamid ?? m.id,
      from: fromMe ? selfId : chatId,
      to: fromMe ? chatId : selfId,
      chatId,
      body: m.texto ?? m.caption ?? '',
      type: HUB_TYPE_MAP[m.tipo] ?? 'unknown',
      timestamp: Math.floor(Date.parse(m.criada_em) / 1000),
      fromMe,
      isGroup: false,
      kind: chatKind(chatId),
      ...(m.midia ? { media: await this.fetchMedia(m) } : {}),
    };
  }

  /** Inlines downloaded media as base64 (small files) or marks it omitted. */
  private async fetchMedia(m: HubMessage): Promise<IncomingMessage['media']> {
    const mimetype = m.midia?.mime ?? 'application/octet-stream';
    try {
      const info = (await this.hubGet('/media', { id: m.id })) as { pronta: boolean; url: string | null };
      if (!info.pronta || !info.url) return { mimetype, omitted: true, sizeBytes: 0 };
      const res = await fetch(info.url);
      if (!res.ok) return { mimetype, omitted: true, sizeBytes: 0 };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength > MEDIA_INLINE_MAX_BYTES) {
        return { mimetype, omitted: true, sizeBytes: bytes.byteLength };
      }
      return { mimetype, data: bytes.toString('base64'), sizeBytes: bytes.byteLength };
    } catch {
      return { mimetype, omitted: true, sizeBytes: 0 };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status);
  }

  private teardown(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    if (WabaRelayAdapter.byPhone.get(this.opts.phone) === this) {
      WabaRelayAdapter.byPhone.delete(this.opts.phone);
    }
  }

  /** `5511...@c.us` -> `5511...`; bare numbers pass through. */
  private waIdOf(chatId: string): string {
    return this.digits(chatId.split('@')[0]);
  }

  private digits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private cursorFile(): string {
    const dir = this.opts.dataDir ?? './data/waba-relay';
    return path.join(dir, `${this.opts.dbSessionId}.cursor.json`);
  }

  private loadCursor(): string | null {
    try {
      const raw = fs.readFileSync(this.cursorFile(), 'utf8');
      return (JSON.parse(raw) as { after?: string }).after ?? null;
    } catch {
      return null;
    }
  }

  private saveCursor(after: string): void {
    const file = this.cursorFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ after }));
  }

  private unsupported(method: string): Promise<never> {
    return Promise.reject(new EngineNotSupportedError(method));
  }

  // ── Cloud API has no engine-neutral equivalent for everything below ──

  sendLocationMessage(): Promise<never> {
    return this.unsupported('sendLocationMessage');
  }
  sendContactMessage(): Promise<never> {
    return this.unsupported('sendContactMessage');
  }
  sendStickerMessage(): Promise<never> {
    return this.unsupported('sendStickerMessage');
  }
  sendPollMessage(): Promise<never> {
    return this.unsupported('sendPollMessage');
  }
  forwardMessage(): Promise<never> {
    return this.unsupported('forwardMessage');
  }
  reactToMessage(): Promise<never> {
    return this.unsupported('reactToMessage');
  }
  getMessageReactions(): Promise<never> {
    return this.unsupported('getMessageReactions');
  }
  getContacts(): Promise<never> {
    return this.unsupported('getContacts');
  }
  getContactById(): Promise<never> {
    return this.unsupported('getContactById');
  }
  checkNumberExists(): Promise<never> {
    return this.unsupported('checkNumberExists');
  }
  getNumberId(): Promise<never> {
    return this.unsupported('getNumberId');
  }
  resolveContactPhone(): Promise<never> {
    return this.unsupported('resolveContactPhone');
  }
  getGroups(): Promise<never> {
    return this.unsupported('getGroups');
  }
  getGroupInfo(): Promise<never> {
    return this.unsupported('getGroupInfo');
  }
  createGroup(): Promise<never> {
    return this.unsupported('createGroup');
  }
  addParticipants(): Promise<never> {
    return this.unsupported('addParticipants');
  }
  removeParticipants(): Promise<never> {
    return this.unsupported('removeParticipants');
  }
  promoteParticipants(): Promise<never> {
    return this.unsupported('promoteParticipants');
  }
  demoteParticipants(): Promise<never> {
    return this.unsupported('demoteParticipants');
  }
  leaveGroup(): Promise<never> {
    return this.unsupported('leaveGroup');
  }
  setGroupSubject(): Promise<never> {
    return this.unsupported('setGroupSubject');
  }
  setGroupDescription(): Promise<never> {
    return this.unsupported('setGroupDescription');
  }
  getGroupInviteCode(): Promise<never> {
    return this.unsupported('getGroupInviteCode');
  }
  revokeGroupInviteCode(): Promise<never> {
    return this.unsupported('revokeGroupInviteCode');
  }
  joinGroupViaInviteCode(): Promise<never> {
    return this.unsupported('joinGroupViaInviteCode');
  }
  getGroupJoinInfo(): Promise<never> {
    return this.unsupported('getGroupJoinInfo');
  }
  setGroupMessagesAdminsOnly(): Promise<never> {
    return this.unsupported('setGroupMessagesAdminsOnly');
  }
  setGroupInfoAdminsOnly(): Promise<never> {
    return this.unsupported('setGroupInfoAdminsOnly');
  }
  setGroupPicture(): Promise<never> {
    return this.unsupported('setGroupPicture');
  }
  deleteGroupPicture(): Promise<never> {
    return this.unsupported('deleteGroupPicture');
  }
  setGroupMemberAddMode(): Promise<never> {
    return this.unsupported('setGroupMemberAddMode');
  }
  setGroupEphemeral(): Promise<never> {
    return this.unsupported('setGroupEphemeral');
  }
  getGroupMembershipRequests(): Promise<never> {
    return this.unsupported('getGroupMembershipRequests');
  }
  approveGroupMembershipRequests(): Promise<never> {
    return this.unsupported('approveGroupMembershipRequests');
  }
  rejectGroupMembershipRequests(): Promise<never> {
    return this.unsupported('rejectGroupMembershipRequests');
  }
  deleteMessage(): Promise<never> {
    return this.unsupported('deleteMessage');
  }
  editMessage(): Promise<never> {
    return this.unsupported('editMessage');
  }
  starMessage(): Promise<never> {
    return this.unsupported('starMessage');
  }
  votePoll(): Promise<never> {
    return this.unsupported('votePoll');
  }
  pinMessage(): Promise<never> {
    return this.unsupported('pinMessage');
  }
  unpinMessage(): Promise<never> {
    return this.unsupported('unpinMessage');
  }
  getChatHistory(): Promise<never> {
    return this.unsupported('getChatHistory');
  }
  rejectCall(): Promise<never> {
    return this.unsupported('rejectCall');
  }
  createCallLink(): Promise<never> {
    return this.unsupported('createCallLink');
  }
  getProfilePicture(): Promise<never> {
    return this.unsupported('getProfilePicture');
  }
  blockContact(): Promise<never> {
    return this.unsupported('blockContact');
  }
  unblockContact(): Promise<never> {
    return this.unsupported('unblockContact');
  }
  getBlockedContacts(): Promise<never> {
    return this.unsupported('getBlockedContacts');
  }
  upsertContact(): Promise<never> {
    return this.unsupported('upsertContact');
  }
  deleteContact(): Promise<never> {
    return this.unsupported('deleteContact');
  }
  setProfileName(): Promise<never> {
    return this.unsupported('setProfileName');
  }
  setProfileStatus(): Promise<never> {
    return this.unsupported('setProfileStatus');
  }
  setProfilePicture(): Promise<never> {
    return this.unsupported('setProfilePicture');
  }
  deleteProfilePicture(): Promise<never> {
    return this.unsupported('deleteProfilePicture');
  }
  getLabels(): Promise<never> {
    return this.unsupported('getLabels');
  }
  getLabelById(): Promise<never> {
    return this.unsupported('getLabelById');
  }
  getChatLabels(): Promise<never> {
    return this.unsupported('getChatLabels');
  }
  addLabelToChat(): Promise<never> {
    return this.unsupported('addLabelToChat');
  }
  createChannel(): Promise<never> {
    return this.unsupported('createChannel');
  }
  deleteChannel(): Promise<never> {
    return this.unsupported('deleteChannel');
  }
  muteChannel(): Promise<never> {
    return this.unsupported('muteChannel');
  }
  demoteChannelAdmin(): Promise<never> {
    return this.unsupported('demoteChannelAdmin');
  }
  transferChannelOwnership(): Promise<never> {
    return this.unsupported('transferChannelOwnership');
  }
  upsertLabel(): Promise<never> {
    return this.unsupported('upsertLabel');
  }
  deleteLabel(): Promise<never> {
    return this.unsupported('deleteLabel');
  }
  getChatsByLabel(): Promise<never> {
    return this.unsupported('getChatsByLabel');
  }
  removeLabelFromChat(): Promise<never> {
    return this.unsupported('removeLabelFromChat');
  }
  getSubscribedChannels(): Promise<never> {
    return this.unsupported('getSubscribedChannels');
  }
  getChannelById(): Promise<never> {
    return this.unsupported('getChannelById');
  }
  subscribeToChannel(): Promise<never> {
    return this.unsupported('subscribeToChannel');
  }
  unsubscribeFromChannel(): Promise<never> {
    return this.unsupported('unsubscribeFromChannel');
  }
  getChannelMessages(): Promise<never> {
    return this.unsupported('getChannelMessages');
  }
  getContactStatuses(): Promise<never> {
    return this.unsupported('getContactStatuses');
  }
  getContactStatus(): Promise<never> {
    return this.unsupported('getContactStatus');
  }
  postTextStatus(): Promise<never> {
    return this.unsupported('postTextStatus');
  }
  postImageStatus(): Promise<never> {
    return this.unsupported('postImageStatus');
  }
  postVideoStatus(): Promise<never> {
    return this.unsupported('postVideoStatus');
  }
  postVoiceStatus(): Promise<never> {
    return this.unsupported('postVoiceStatus');
  }
  deleteStatus(): Promise<never> {
    return this.unsupported('deleteStatus');
  }
  getCatalog(): Promise<never> {
    return this.unsupported('getCatalog');
  }
  getProducts(): Promise<never> {
    return this.unsupported('getProducts');
  }
  getProduct(): Promise<never> {
    return this.unsupported('getProduct');
  }
  sendProduct(): Promise<never> {
    return this.unsupported('sendProduct');
  }
  sendCatalog(): Promise<never> {
    return this.unsupported('sendCatalog');
  }
  markUnread(): Promise<never> {
    return this.unsupported('markUnread');
  }
  deleteChat(): Promise<never> {
    return this.unsupported('deleteChat');
  }
  archiveChat(): Promise<never> {
    return this.unsupported('archiveChat');
  }
  pinChat(): Promise<never> {
    return this.unsupported('pinChat');
  }
  muteChat(): Promise<never> {
    return this.unsupported('muteChat');
  }
  clearChatMessages(): Promise<never> {
    return this.unsupported('clearChatMessages');
  }
  subscribeToPresence(): Promise<never> {
    return this.unsupported('subscribeToPresence');
  }
}
