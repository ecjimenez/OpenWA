# Handoff pro Codex — refino Baleia do dashboard Conversinha

Fork: `~/Apps/openwa-fork` (branch `engine-waba-relay`, base 03fc294c).
Missão: re-skin do dashboard React (`dashboard/`) no Design System Baleia,
SEM reescrever componentes — a via é a camada de tokens CSS.

## Diretivas do Jiji
1. **Tema light SEMPRE.** Travar o painel no light: `useTheme` deixa de
   alternar (ou default fixo light + esconder o toggle). Nunca mesclar
   tokens de light e dark numa tela.
2. **Design System Baleia** (referência viva: https://relatorio.doenrique.com):
   - Fundo Névoa `#F0F2F5`; superfícies com glassmorphism
     `backdrop-filter: blur(14px) saturate(135%)`, radius 12px
   - Texto primário Grafite `#1A1A1A`
   - Títulos em **Bricolage Grotesque** (fallback Pacaembu/system);
     metadados/tags/eyebrows em UPPERCASE **JetBrains Mono** (já importada!)
   - Marca/linhas finas/marcadores: Cereja `#D72638`;
     destaques acionáveis: Coral `#FF6E40`
   - Espaçamento múltiplos de 4px; layout tendendo a Grid Bento
   - **Botões outline grafite, cantos retos (radius 0)** — exceção: o radius
     12px vale pra cards/superfícies, não pra botões
3. UI em pt-BR (o que já está, fica).

## Mapa técnico (já levantado)
- Tokens: `dashboard/src/App.css` — `:root` light (linhas ~4-21) e bloco dark
  (~30+). Mapeamento: `--primary #25d366 → Cereja #D72638` (e `--primary-hover`
  um tom mais fundo, ex. #B51E2E; `--primary-soft` rgba de Cereja);
  `--bg-light → #F0F2F5`; `--bg-white/--bg-card →` branco/vidro;
  `--text-primary → #1A1A1A`; `--radius: 10px → 12px`. Ações/CTAs pontuais
  podem usar Coral `#FF6E40` (checar contraste: Coral NÃO é cor de texto).
- Fontes: `dashboard/src/App.css` linha 1 já importa Plus Jakarta Sans +
  JetBrains Mono do Google Fonts — somar `Bricolage+Grotesque:wght@500;600;700`
  e aplicar em h1/h2/h3/display (`src/index.css` ~linhas 41-56); `.eyebrow`
  vira JetBrains Mono uppercase.
- Tema: `dashboard/src/hooks/useTheme.ts` + toggle no `Layout.tsx` (~themeIcons).
  Travar light; o bloco dark do App.css pode ficar (morto) ou ser removido.
- Estilos por página: `src/index.css` (global), `components/Layout.css` (sidebar/nav).
- Validações: `npm run build` (tsc -b + vite), `npx eslint --fix`,
  `node --experimental-strip-types --test src/pages/*.test.ts`,
  `npm run i18n:check` (não adicionar chave nova de i18n).

## Critérios de aceite
- Painel abre SEMPRE light, visual Baleia coeso em TODAS as telas
  (Dashboard, Sessions, Chats, Contatos, Templates, Webhooks, Logs,
  Infrastructure, Plugins, modais WabaTemplates/StatusCompose)
- Nenhum verde WhatsApp `#25d366` sobrevivendo; contraste WCAG AA nos textos
- Builds + testes verdes; commit convencional na branch; NÃO deployar
  (deploy é ordem do Jiji)
