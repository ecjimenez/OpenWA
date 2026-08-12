// waba-relay — porta de serviço do hub WABA para o painel Conversinha (OpenWA).
//
// É a fronteira de credencial do desenho aprovado em 12/08/2026: o OpenWA
// NUNCA recebe token da Meta. Ele fala só com esta função, autenticado por um
// secret compartilhado, e tudo que ela permite é: enfileirar envio, ler
// backlog de mensagens, pegar URL assinada de mídia e subir mídia de saída.
// Revogar WABA_RELAY_SECRET cega o painel sem tocar nas credenciais Meta.
//
// Envio herda a fila waba.outbox (idempotência, retry, regra de janela) via
// RPC enfileirar_mensagem; depois cutuca o outbox-worker pra não esperar o
// cron, e devolve o status real da linha — 'skipped' com motivo de janela
// fechada chega legível ao painel em vez de sumir.

import { serviceClient } from '../_shared/supabase.ts';
import { errorMessage, json } from '../_shared/http.ts';
import { igualSeguro } from '../_shared/tempo_constante.ts';
import { enviarViaOutbox, listarChats, listarMensagens, listarTemplates, submeterTemplate, subirMidia, urlDaMidia } from '../_shared/waba_relay_core.ts';

Deno.serve(async (req) => {
  const segredo = Deno.env.get('WABA_RELAY_SECRET');
  // Fail closed: sem segredo configurado ninguém entra, nem por acidente.
  if (!segredo) return json({ error: 'relay não configurado' }, { status: 503 });

  const recebido = req.headers.get('x-relay-secret') ?? '';
  if (!igualSeguro(recebido, segredo)) return json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  // pathname: /waba-relay/<rota>...
  const rota = url.pathname.split('/').filter(Boolean).slice(1).join('/');
  const db = serviceClient();

  try {
    if (req.method === 'POST' && rota === 'send') {
      return json(await enviarViaOutbox(db, await req.json()));
    }
    if (req.method === 'GET' && rota === 'messages') {
      return json(await listarMensagens(db, url.searchParams));
    }
    if (req.method === 'GET' && rota === 'chats') {
      return json(await listarChats(db, url.searchParams));
    }
    if (req.method === 'GET' && rota === 'templates') {
      return json(await listarTemplates(db, url.searchParams));
    }
    if (req.method === 'POST' && rota === 'templates') {
      return json(await submeterTemplate(db, await req.json()));
    }
    if (req.method === 'GET' && rota === 'media') {
      return json(await urlDaMidia(db, url.searchParams.get('id')));
    }
    if (req.method === 'POST' && rota === 'upload') {
      return json(await subirMidia(db, req));
    }
    return json({ error: `rota desconhecida: ${req.method} /${rota}` }, { status: 404 });
  } catch (err) {
    const msg = errorMessage(err);
    // Erros de contrato (payload inválido) voltam 400; o resto é 500.
    const status = msg.startsWith('contrato:') ? 400 : 500;
    console.error('waba-relay', rota, msg);
    return json({ error: msg }, { status });
  }
});
