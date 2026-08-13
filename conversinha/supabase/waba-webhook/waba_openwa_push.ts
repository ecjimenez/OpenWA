// Push assinado pro ingress do painel Conversinha (OpenWA na VPS cerebro).
// (Espelho: vive em _shared do waba-webhook E do waba-media-worker no Supabase.)
//
// Best-effort POR DESENHO: o painel fora do ar não pode derrubar webhook nem
// worker — a consistência vem do backlog do waba-relay (GET /messages), que o
// engine consulta ao iniciar e a cada reconexão. O push só compra latência.
//
// Assinatura HMAC-SHA256 do corpo com OPENWA_PUSH_SECRET, no header
// x-hub-signature-256 (mesma convenção da Meta) — o engine valida antes de
// aceitar; sem isso qualquer um com a URL injetaria mensagem falsa no painel.
//
// Sem OPENWA_INGRESS_URL/OPENWA_PUSH_SECRET no env, vira no-op silencioso —
// é o estado até o engine waba-relay existir no fork.

const TIMEOUT_MS = 5000;

export type EventoOpenWA = Record<string, unknown> & {
  evento: 'mensagem' | 'status' | 'media_ready';
};

/** Nunca lança. */
export async function avisarOpenWA(evento: EventoOpenWA): Promise<void> {
  try {
    const url = Deno.env.get('OPENWA_INGRESS_URL');
    const segredo = Deno.env.get('OPENWA_PUSH_SECRET');
    if (!url || !segredo) return;

    const corpo = JSON.stringify(evento);
    const chave = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(segredo),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const assinado = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo));
    const hex = Array.from(new Uint8Array(assinado)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
    await fetch(url, {
      method: 'POST',
      signal: controle.signal,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${hex}` },
      body: corpo,
    });
    clearTimeout(timer);
  } catch {
    // silêncio proposital — catch-up via backlog cobre
  }
}

/**
 * Cutuca o waba-media-worker quando chega mídia — o cron horário é lento
 * demais pro painel. Fire-and-forget: não espera o worker terminar o lote
 * (isso levaria segundos e estouraria o timeout da Meta no webhook).
 */
export function cutucarMediaWorker(): void {
  try {
    const base = Deno.env.get('SUPABASE_URL');
    const cronSecret = Deno.env.get('WABA_MEDIA_CRON_SECRET');
    if (!base || !cronSecret) return;

    const pendente = fetch(`${base}/functions/v1/waba-media-worker`, {
      method: 'POST',
      headers: { 'x-cron-secret': cronSecret },
    }).catch(() => {});
    // Mantém a promise viva após a resposta do webhook, quando o runtime suporta.
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil?.(pendente);
  } catch {
    // o cron do min 23 cobre
  }
}
