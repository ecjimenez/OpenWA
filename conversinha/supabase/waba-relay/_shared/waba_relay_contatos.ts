// Contatos do gateway do cerebro (cerebro.contatos), expostos ao painel via
// relay. Regra do produto: o contato só fica HABILITADO quando o template de
// abertura foi ENVIADO — que é também a única forma de a Meta deixar a gente
// iniciar conversa. Envio na fila (queued) deixa o contato pendente; o GET
// reconcilia contra o outbox e promove quando o worker despachar.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type PedidoContato = {
  phone?: string; // meta_phone_number_id da sessão (5112)
  wa_id?: string;
  nome?: string;
  flow?: string;
  periodo_dias?: number | null; // null = manual
  template_nome?: string;
  template_idioma?: string;
  template_components?: unknown[];
};

type ContatoRow = {
  id: string;
  wa_id: string;
  nome: string | null;
  flow: string;
  periodo_dias: number | null;
  template_nome: string | null;
  habilitacao_outbox_id: string | null;
  habilitado_em: string | null;
  valido_ate: string | null;
  criado_em: string;
};

function estadoDe(c: ContatoRow): 'pendente' | 'ativo' | 'vencido' {
  if (!c.habilitado_em) return 'pendente';
  if (c.valido_ate && new Date(c.valido_ate).getTime() <= Date.now()) return 'vencido';
  return 'ativo';
}

function validoAte(habilitadoEm: string, periodoDias: number | null): string | null {
  if (!periodoDias) return null;
  return new Date(new Date(habilitadoEm).getTime() + periodoDias * 24 * 3600 * 1000).toISOString();
}

/** Promove contatos pendentes cujo template de habilitação já saiu da fila. */
async function reconciliarPendentes(db: SupabaseClient, contatos: ContatoRow[]): Promise<void> {
  const pendentes = contatos.filter(c => !c.habilitado_em && c.habilitacao_outbox_id);
  for (const c of pendentes) {
    const { data: linha } = await db.schema('waba').from('outbox')
      .select('status, sent_at').eq('id', c.habilitacao_outbox_id!).maybeSingle();
    if (linha?.status !== 'sent' || !linha.sent_at) continue;
    const habilitadoEm = linha.sent_at as string;
    const { error } = await db.schema('cerebro').from('contatos').update({
      habilitado_em: habilitadoEm,
      valido_ate: validoAte(habilitadoEm, c.periodo_dias),
      atualizado_em: new Date().toISOString(),
    }).eq('id', c.id);
    if (error) throw error;
    c.habilitado_em = habilitadoEm;
    c.valido_ate = validoAte(habilitadoEm, c.periodo_dias);
  }
}

export async function listarContatos(db: SupabaseClient) {
  const { data, error } = await db.schema('cerebro').from('contatos')
    .select('*').order('criado_em', { ascending: false });
  if (error) throw error;
  const contatos = (data ?? []) as ContatoRow[];
  await reconciliarPendentes(db, contatos);
  return {
    contatos: contatos.map(c => ({
      id: c.id,
      wa_id: c.wa_id,
      nome: c.nome,
      flow: c.flow,
      periodo_dias: c.periodo_dias,
      template_nome: c.template_nome,
      estado: estadoDe(c),
      habilitado_em: c.habilitado_em,
      valido_ate: c.valido_ate,
      criado_em: c.criado_em,
    })),
  };
}

async function displayDoNumero(db: SupabaseClient, metaPhoneNumberId: string): Promise<string> {
  const { data, error } = await db.schema('waba').from('phone_numbers')
    .select('display_phone_number').eq('meta_phone_number_id', metaPhoneNumberId).maybeSingle();
  if (error) throw error;
  if (!data?.display_phone_number) throw new Error(`contrato: número ${metaPhoneNumberId} não está no registry`);
  return data.display_phone_number as string;
}

async function despacharAgoraContatos(): Promise<void> {
  const base = Deno.env.get('SUPABASE_URL');
  const cronSecret = Deno.env.get('WABA_OUTBOX_CRON_SECRET');
  if (!base || !cronSecret) return;
  try {
    await fetch(`${base}/functions/v1/waba-outbox-worker`, {
      method: 'POST',
      headers: { 'x-cron-secret': cronSecret },
    });
  } catch {
    // o cron cobre; o contato fica pendente e o GET reconcilia
  }
}

export async function criarContato(db: SupabaseClient, pedido: PedidoContato) {
  const waId = (pedido.wa_id ?? '').replace(/\D/g, '');
  if (!pedido.phone || !waId || !pedido.template_nome?.trim()) {
    throw new Error('contrato: phone, wa_id e template_nome são obrigatórios');
  }
  if (pedido.periodo_dias != null && ![30, 60].includes(pedido.periodo_dias)) {
    // 30, 60 ou manual (null) — regra do produto.
    throw new Error('contrato: periodo_dias deve ser 30, 60 ou nulo (manual)');
  }

  const { data: contato, error } = await db.schema('cerebro').from('contatos').insert({
    wa_id: waId,
    nome: pedido.nome ?? null,
    flow: pedido.flow ?? 'livre',
    periodo_dias: pedido.periodo_dias ?? null,
    template_nome: pedido.template_nome.trim(),
  }).select('*').single();
  if (error) {
    if (String(error.message).includes('duplicate')) throw new Error('contrato: wa_id já cadastrado');
    throw error;
  }

  // Habilitação = envio do template de abertura pela fila de sempre.
  const { data: outboxId, error: erroFila } = await db.schema('waba').rpc('enfileirar_mensagem', {
    p_de_numero: await displayDoNumero(db, pedido.phone),
    p_para_wa_id: waId,
    p_idempotency_key: `cerebro:habilitar:${contato.id}`,
    p_send_type: 'template',
    p_template_nome: pedido.template_nome.trim(),
    p_template_idioma: pedido.template_idioma ?? 'pt_BR',
    p_message_type: 'template',
    p_payload: { components: pedido.template_components ?? [] },
  });
  if (erroFila) throw erroFila;

  await db.schema('cerebro').from('contatos')
    .update({ habilitacao_outbox_id: outboxId, atualizado_em: new Date().toISOString() })
    .eq('id', contato.id);

  await despacharAgoraContatos();

  const { data: linha } = await db.schema('waba').from('outbox')
    .select('status, sent_at, error').eq('id', outboxId).maybeSingle();
  if (linha?.status === 'sent' && linha.sent_at) {
    const habilitadoEm = linha.sent_at as string;
    await db.schema('cerebro').from('contatos').update({
      habilitado_em: habilitadoEm,
      valido_ate: validoAte(habilitadoEm, pedido.periodo_dias ?? null),
      atualizado_em: new Date().toISOString(),
    }).eq('id', contato.id);
    return { id: contato.id, estado: 'ativo', template: linha.status };
  }
  return {
    id: contato.id,
    estado: 'pendente',
    template: linha?.status ?? 'queued',
    motivo: (linha?.error as { motivo?: string } | null)?.motivo ?? null,
  };
}

export async function atualizarContato(db: SupabaseClient, pedido: { id?: string; nome?: string; flow?: string; periodo_dias?: number | null }) {
  if (!pedido.id) throw new Error('contrato: id é obrigatório');
  if (pedido.periodo_dias !== undefined && pedido.periodo_dias !== null && ![30, 60].includes(pedido.periodo_dias)) {
    throw new Error('contrato: periodo_dias deve ser 30, 60 ou nulo (manual)');
  }
  const { data: atual, error: erroBusca } = await db.schema('cerebro').from('contatos')
    .select('habilitado_em').eq('id', pedido.id).maybeSingle();
  if (erroBusca) throw erroBusca;
  if (!atual) throw new Error('contrato: contato não encontrado');

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (pedido.nome !== undefined) patch.nome = pedido.nome;
  if (pedido.flow !== undefined) patch.flow = pedido.flow;
  if (pedido.periodo_dias !== undefined) {
    patch.periodo_dias = pedido.periodo_dias;
    // Período novo recalcula a validade a partir da habilitação existente.
    if (atual.habilitado_em) patch.valido_ate = validoAte(atual.habilitado_em as string, pedido.periodo_dias);
  }
  const { error } = await db.schema('cerebro').from('contatos').update(patch).eq('id', pedido.id);
  if (error) throw error;
  return { ok: true };
}

export async function removerContato(db: SupabaseClient, id: string | null) {
  if (!id) throw new Error('contrato: parâmetro id é obrigatório');
  const { error } = await db.schema('cerebro').from('contatos').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}
