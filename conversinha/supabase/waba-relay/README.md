# waba-relay (Edge Function no Supabase cerebro)

Fronteira de credencial entre o hub WABA e o painel Conversinha (OpenWA).
O OpenWA nunca vê token da Meta: autentica com `x-relay-secret`
(WABA_RELAY_SECRET, mesmo valor no env do projeto Supabase e no
`~/openwa/.env` da VPS) e só enxerga estas rotas:

| Rota | Função |
|---|---|
| `POST /send` | texto, mídia (via link) ou template; enfileira em `waba.outbox` (RPC `enfileirar_mensagem`), cutuca o `waba-outbox-worker` e devolve o status real (`sent` / `skipped` com motivo legível, ex.: janela de 24h) |
| `GET /messages?phone=<meta_phone_number_id>&after=<ISO>` | backlog paginado normalizado (catch-up do engine) |
| `GET /media?id=<message_id>` | URL assinada (1h) da mídia baixada; `pronta:false` enquanto o media-worker não desceu o binário |
| `POST /upload` | corpo binário → Storage `waba-media/outbound/` → link assinado de 7 dias pra usar no /send |

Deploy: via MCP/CLI do Supabase, projeto munzmjcizgtleobrhfsz. Fonte da
verdade do código deployado é o Supabase; esta cópia é espelho de leitura.

Smoke test 12/08/2026 (número cerebro +55 11 98981-5112, piloto):
sem secret → 403; conta travada → skipped legível; janela fechada →
skipped legível; janela aberta → texto sent; imagem recebida → backlog →
download → URL assinada → /upload → reenvio como imagem sent.

Pendências deste lado: push assinado do webhook pro ingress do OpenWA
(mensagem/status/media_ready) + cutucada no media-worker quando chega
mídia (cron atual é horário, minuto 23).
