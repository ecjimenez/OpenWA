# Engine waba-relay no fork do OpenWA — mapa de integração

Levantamento do código (12/08/2026, upstream v0.18.0) que guia a implementação
do engine. Fork: `ecjimenez/OpenWA`, branch `engine-waba-relay`, clone local
em `~/Apps/openwa-fork`.

## Fatos decisivos

1. **Engine é GLOBAL no upstream** (`ENGINE_TYPE` no env, lido uma vez no boot
   em `src/engine/engine.factory.ts:35`; sessão não tem coluna de engine).
   Pra WABA conviver com números de QR no mesmo painel é preciso trabalho
   novo: coluna `engine` na sessão + `EngineCreateOptions.engine` + factory
   escolhendo o plugin por sessão + dashboard oferecendo a escolha no
   "criar sessão".

2. **Ingress já existe** (`src/modules/integration/`, rota pública
   `/ingress/:pluginId/:instanceId/*path`): HMAC-SHA256 com contentTemplate,
   comparação em tempo constante, dedup, rate-limit e fila. O push do hub
   (header `x-hub-signature-256`, corpo JSON) encaixa no scheme `hmac-sha256`.
   `ALLOW_UNSIGNED_INGRESS` não é necessário.

3. **Sem classe base**: adapters implementam `IWhatsAppEngine` direto
   (~120 métodos obrigatórios; só `probeLiveness?` é opcional). Padrão do
   Baileys pra recusar: `private unsupported(m){ return Promise.reject(new
   EngineNotSupportedError(m)) }` → HTTP 501. No waba-relay ~90% dos métodos
   são `unsupported()`.

## Caminho mínimo (checklist da integração)

- `src/config/env.validation.ts:71` → somar `'waba-relay'` ao enum de ENGINE_TYPE
- `src/config/configuration.ts:~193` → namespace `engine.wabaRelay` ({hubUrl, hubSecret, pushSecret, phone})
- Adapter em `src/engine/waba-relay/` (FORA de `src/engine/adapters/` — o
  parity spec varre aquele diretório e exigiria atribuição por engine)
- Plugin em `src/plugins/engines/waba-relay/{index.ts,manifest.json}` espelhando baileys
- Registro: terceiro `registerBuiltInPlugin` em `engine.factory.ts:65-80`
- NÃO tocar em `engine-capability-matrix.ts` (snapshot declarado wwjs/baileys;
  specs de paridade amarram contagens ao docs/29)

## Contratos que o adapter precisa honrar

- **Sem QR**: `initialize(callbacks)` → ao confirmar o hub, chamar
  `callbacks.onReady(phone, pushName)`; `getStatus()` → `EngineStatus.READY`.
  `getQRCode()` → `null` (síncrono); `requestPairingCode` → unsupported (501).
- **Mensagem recebida**: mapear evento do hub pra `IncomingMessage`
  (10 campos obrigatórios: id, from, to, chatId, body, type, timestamp,
  fromMe, isGroup, kind) e chamar `callbacks.onMessage(msg)` — persistência,
  webhook e WebSocket vêm do wiring existente
  (`session-engine-event-wiring.ts:142` → `message-projector.service.ts`).
- **Identidade neutra**: JIDs sempre `<fone>@c.us` / `<id>@g.us`; nunca
  `@s.whatsapp.net` nem sufixo `:device` (helpers em `src/engine/identity/wa-id.ts`).
- **Status de entrega**: evento `status` do hub → `callbacks.onMessageAck(wamid, DeliveryStatus)`.
- **Envio**: sendText/Image/Video/Audio/Document/reply → `POST /send` do hub;
  `status: skipped` com motivo (janela de 24h) deve virar erro legível pro painel.
- **Catch-up**: no `initialize`, varrer `GET /messages?after=<cursor persistido>`
  e emitir via `onMessage`/`onHistoryMessages`; cursor avança com `proximo_after`.

## VPS

O clone `~/openwa` na cerebro já aponta pro fork (`ecjimenez/OpenWA`).
Deploy da integração = `git fetch && git checkout <branch/tag> && docker
compose build && docker compose up -d`, mais `OPENWA_INGRESS_URL` no env do
Supabase pra ligar o push (hoje é no-op).

---

## RESULTADO (12/08/2026, noite)

Implementado e EM PRODUÇÃO: fork `ecjimenez/OpenWA`, branch `engine-waba-relay`,
commit `d444d3b8` (40 arquivos, +1360). Divisão real do trabalho: Codex (via
Octopus develop) entregou o engine-por-sessão completo; adapter, plugin,
config, ingress e allowlists de guard foram feitos à mão contra este mapa.

Prova de vida: sessão "cerebro" criada com `{"engine":"waba-relay"}` ficou
READY em 11s sem QR; backlog inteiro apareceu no painel (chat "ej 🐙" com
histórico dos dois sentidos); envio painel→relay→Meta entregue no celular.
Ingress público responde 401 sem assinatura. Migration roda no boot.

Detalhes de deploy que valem ouro:
- compose upstream NÃO repassa env vars novas: `docker-compose.override.yml`
  na VPS encaminha WABA_RELAY_*/OPENWA_PUSH_SECRET pro container.
- clone raso da VPS não enxerga branch nova sem consertar o refspec:
  `git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.
- Guards do repo que um engine novo obrigatoriamente toca: enum de
  ENGINE_TYPE em env.validation, allowlist EXPECTED_PUBLIC_CONTROLLERS +
  PUBLIC_PATHS (swagger.config e spec). A capability matrix NÃO se toca.

## FASE 4 (12/08, noite): 5112 mudo + templates Meta no painel

1. **Respostas automáticas do 5112 mortas**: a WABA do cerebro tem DOIS apps
   Meta inscritos — o novo (waba-webhook) e o antigo (cerebro-webhook, gateway
   v44 com gatekeeper). O gate `NUMEROS_MUDOS` no cerebro-webhook silencia o
   5112 (sem resposta/reação/visto azul; entrada segue logada). Magic words
   morrem nesse número; escolha/jijiflix estavam dormentes.
2. **Templates**: relay `GET/POST /templates` (lista da conta; submissão à
   Meta via Graph com `error_user_msg` legível) → adapter
   `listTemplates/submitTemplate/sendTemplate` → rotas autenticadas
   `/api/waba-relay/sessions/:id/{templates,send-template}` → modal
   "Templates WABA" no Chats (enviar aprovado com variáveis {{n}} + submeter
   novo). Commit `67bd04a8`, deployado e testado (17 templates, 17 APPROVED
   listados pela cadeia inteira).
3. **Gotcha de restart**: sem `NODE_ID` estável, o recreate do container é um
   "nó novo" que espera o lease do anterior — auto-start parece morto.
   `NODE_ID=cerebro-openwa` no .env resolve.
