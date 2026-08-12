// Regras do relay, isoladas da rota pra ficarem testáveis: montagem de
// payload, resolução de número, backlog e mídia.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'waba-media';

/** Mesmo teto do waba-media-worker: o bucket recusa acima disso. */
const UPLOAD_MAX_BYTES = 64 * 1024 * 1024;

/** Backlog: teto por página. O engine pagina com `after`. */
const LIMITE_MAX = 200;

const TIPOS_MIDIA = ['image', 'video', 'audio', 'document'] as const;

export type PedidoEnvio = {
  /** meta_phone_number_id do número remetente (sessão no painel). */
  de?: string;
  /** wa_id do destinatário (ex.: 5511999999999). */
  para?: string;
  tipo?: string;
  texto?: string;
  /** URL pública (ex.: assinada do /upload) de onde a Meta baixa a mídia. */
  link?: string;
  caption?: string;
  filename?: string;
  idempotency_key?: string;
  /** Template pra responder fora da janela de 24h. */
  template?: { nome?: string; idioma?: string; components?: unknown[] };
};

async function displayDe(db: SupabaseClient, metaPhoneNumberId: string): Promise<string> {
  const { data, error } = await db.schema('waba').from('phone_numbers')
    .select('display_phone_number, active')
    .eq('meta_phone_number_id', metaPhoneNumberId).maybeSingle();
  if (error) throw error;
  if (!data?.display_phone_number) throw new Error(`contrato: número ${metaPhoneNumberId} não está no registry`);
  if (!data.active) throw new Error(`contrato: número ${metaPhoneNumberId} está inativo`);
  return data.display_phone_number as string;
}

function payloadDe(p: PedidoEnvio): { message_type: string; payload: Record<string, unknown> } {
  if (p.tipo === 'text') {
    if (!p.texto?.trim()) throw new Error('contrato: envio de texto sem texto');
    return { message_type: 'text', payload: { body: p.texto } };
  }
  if ((TIPOS_MIDIA as readonly string[]).includes(p.tipo ?? '')) {
    if (!p.link) throw new Error(`contrato: envio de ${p.tipo} sem link — use /upload antes`);
    return {
      message_type: p.tipo!,
      payload: {
        link: p.link,
        // Áudio na Cloud API não aceita caption; os demais aceitam.
        ...(p.caption && p.tipo !== 'audio' ? { caption: p.caption } : {}),
        ...(p.filename && p.tipo === 'document' ? { filename: p.filename } : {}),
      },
    };
  }
  throw new Error(`contrato: tipo ${p.tipo ?? '(vazio)'} não suportado`);
}

/** Cutuca o outbox-worker pra despachar agora, sem esperar o cron. Best-effort. */
async function despacharAgora(): Promise<void> {
  const base = Deno.env.get('SUPABASE_URL');
  const cronSecret = Deno.env.get('WABA_OUTBOX_CRON_SECRET');
  if (!base || !cronSecret) return;
  try {
    await fetch(`${base}/functions/v1/waba-outbox-worker`, {
      method: 'POST',
      headers: { 'x-cron-secret': cronSecret },
    });
  } catch {
    // O cron do minuto seguinte cobre; o status volta como 'queued'.
  }
}

export async function enviarViaOutbox(db: SupabaseClient, pedido: PedidoEnvio) {
  if (!pedido.de || !pedido.para) throw new Error('contrato: campos de/para são obrigatórios');
  const deNumero = await displayDe(db, pedido.de);

  const ehTemplate = Boolean(pedido.template?.nome);
  const { message_type, payload } = ehTemplate
    ? { message_type: 'template', payload: { components: pedido.template?.components ?? [] } }
    : payloadDe(pedido);

  const { data: outboxId, error } = await db.schema('waba').rpc('enfileirar_mensagem', {
    p_de_numero: deNumero,
    p_para_wa_id: pedido.para,
    p_idempotency_key: pedido.idempotency_key ?? crypto.randomUUID(),
    p_send_type: ehTemplate ? 'template' : 'freeform',
    ...(ehTemplate ? { p_template_nome: pedido.template!.nome, p_template_idioma: pedido.template!.idioma ?? 'pt_BR' } : {}),
    p_message_type: message_type,
    p_payload: payload,
  });
  if (error) throw error;

  await despacharAgora();

  const { data: linha } = await db.schema('waba').from('outbox')
    .select('id, status, error, result_message_id').eq('id', outboxId).maybeSingle();
  return {
    outbox_id: outboxId,
    status: linha?.status ?? 'queued',
    motivo: (linha?.error as { motivo?: string } | null)?.motivo ?? null,
    message_id: linha?.result_message_id ?? null,
  };
}

export async function listarMensagens(db: SupabaseClient, params: URLSearchParams) {
  const metaPhone = params.get('phone');
  if (!metaPhone) throw new Error('contrato: parâmetro phone (meta_phone_number_id) é obrigatório');

  const { data: phone, error: erroPhone } = await db.schema('waba').from('phone_numbers')
    .select('id').eq('meta_phone_number_id', metaPhone).maybeSingle();
  if (erroPhone) throw erroPhone;
  if (!phone?.id) throw new Error(`contrato: número ${metaPhone} não está no registry`);

  const limite = Math.min(Number(params.get('limit') ?? 100) || 100, LIMITE_MAX);
  let query = db.schema('waba').from('messages')
    .select('id, direction, wamid, type, text_body, caption, media_id, media_mime, media_download_status, context_wamid, delivery_status, created_at, contacts(wa_id, profile_name)')
    .eq('phone_number_id', phone.id)
    .order('created_at', { ascending: true })
    .limit(limite);
  const after = params.get('after');
  if (after) query = query.gt('created_at', after);

  const { data, error } = await query;
  if (error) throw error;

  const mensagens = (data ?? []).map((m) => {
    const contato = m.contacts as unknown as { wa_id?: string; profile_name?: string } | null;
    return {
      id: m.id,
      direcao: m.direction,
      wamid: m.wamid,
      tipo: m.type,
      texto: m.text_body,
      caption: m.caption,
      chat_wa_id: contato?.wa_id ?? null,
      chat_nome: contato?.profile_name ?? null,
      // Só há mídia quando há media_id — media_download_status tem default
      // 'pending' na coluna e apareceria em mensagem de texto puro.
      midia: m.media_id ? { mime: m.media_mime, status: m.media_download_status } : null,
      responde_a: m.context_wamid,
      entrega: m.delivery_status,
      criada_em: m.created_at,
    };
  });
  return { mensagens, proximo_after: mensagens.at(-1)?.criada_em ?? after ?? null };
}

export async function urlDaMidia(db: SupabaseClient, messageId: string | null) {
  if (!messageId) throw new Error('contrato: parâmetro id é obrigatório');
  const { data, error } = await db.schema('waba').from('messages')
    .select('media_id, media_path, media_mime, media_download_status').eq('id', messageId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('contrato: mensagem não encontrada');
  if (!data.media_id && !data.media_path) {
    return { pronta: false, status: 'sem_midia', url: null, mime: null };
  }
  if (data.media_download_status !== 'downloaded' || !data.media_path) {
    // O painel mostra "baixando…" e tenta de novo; não é erro de servidor.
    return { pronta: false, status: data.media_download_status ?? 'pending', url: null, mime: data.media_mime };
  }
  const { data: assinada, error: erroUrl } = await db.storage.from(BUCKET)
    .createSignedUrl(data.media_path as string, 3600);
  if (erroUrl) throw erroUrl;
  return { pronta: true, status: 'downloaded', url: assinada.signedUrl, mime: data.media_mime };
}

const EXTENSAO: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'application/pdf': 'pdf',
};

/**
 * Sobe mídia de SAÍDA e devolve URL assinada de 7 dias — a Meta baixa por
 * esse link na hora do envio, então a vida útil só precisa cobrir a fila.
 */
export async function subirMidia(db: SupabaseClient, req: Request) {
  const mime = (req.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
  const binario = new Uint8Array(await req.arrayBuffer());
  if (binario.byteLength === 0) throw new Error('contrato: corpo vazio');
  if (binario.byteLength > UPLOAD_MAX_BYTES) throw new Error('contrato: mídia excede 64MB');

  const dia = new Date().toISOString().slice(0, 10);
  const caminho = `outbound/${dia}/${crypto.randomUUID()}.${EXTENSAO[mime] ?? 'bin'}`;
  const { error } = await db.storage.from(BUCKET).upload(caminho, binario, { contentType: mime });
  if (error) throw error;

  const { data: assinada, error: erroUrl } = await db.storage.from(BUCKET)
    .createSignedUrl(caminho, 7 * 24 * 3600);
  if (erroUrl) throw erroUrl;
  return { path: caminho, link: assinada.signedUrl, mime };
}
