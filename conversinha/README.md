# conversinha-openwa

Deploy do [OpenWA](https://github.com/rmyndharis/OpenWA) (gateway WhatsApp não-oficial, licença MIT) na VPS cerebro, servindo `https://conversinha.doenrique.com`.

**Objetivo:** mandar e receber mensagem do número profissional **fora do WABA**, via dispositivo vinculado — o WhatsApp do iPhone continua funcionando normalmente, com autonomia total no device.

> Não confundir com o projeto "Conversinha" antigo (hub WABA no schema `waba` do Supabase cerebro). São coisas distintas.

## Arquitetura

```
iPhone (número profissional)
        │ dispositivo vinculado (QR)
        ▼
openwa-api (Docker, 127.0.0.1:2785, painel embutido)
        ▲
Traefik (network host, 187.77.249.20:443, Let's Encrypt)
        ▲
conversinha.doenrique.com (registro A na Vercel DNS, vence o wildcard *)
```

- VPS: cerebro (srv1773114, Hostinger), repo clonado em `~/openwa`
- Containers: `openwa-api` + `openwa-docker-proxy` (`docker compose up -d`)
- Sessões persistidas no volume `openwa_openwa-data`; `AUTO_START_SESSIONS=true` religa após reboot
- Engine default: whatsapp-web.js (Chromium por sessão); alternável pra Baileys no painel

## Arquivos deste repo

| Arquivo | Destino na VPS |
|---|---|
| `traefik/conversinha.yml` | `/docker/traefik-dkxz/dynamic/conversinha.yml` (file provider com watch, recarrega sozinho) |
| `.env.example` | modelo de `~/openwa/.env` (o real nunca sai do servidor) |

## Receita de reconstrução

```bash
ssh cerebro
git clone --depth 1 https://github.com/rmyndharis/OpenWA.git ~/openwa
cd ~/openwa
umask 077
printf 'API_MASTER_KEY=%s\nTRUSTED_PROXIES=127.0.0.1\nAUTO_START_SESSIONS=true\n' "$(openssl rand -hex 32)" > .env
docker compose build && docker compose up -d
# rota TLS
scp traefik/conversinha.yml cerebro:/docker/traefik-dkxz/dynamic/
# DNS (uma vez): vercel dns add doenrique.com conversinha A 187.77.249.20
```

Pareamento: abrir `https://conversinha.doenrique.com`, logar com a `API_MASTER_KEY` (pegar via `ssh cerebro 'grep API_MASTER_KEY ~/openwa/.env'`), criar sessão e escanear o QR em WhatsApp → Configurações → Aparelhos conectados.

## Riscos assumidos

- Cliente de engenharia reversa: viola os ToS do WhatsApp, risco não-zero de ban do número. Mitigação: volume baixo, conversa orgânica, e `SEND_PACING_ENABLED` antes de qualquer automação de disparo.
- Quando o WhatsApp muda protocolo, o engine pode quebrar — atualizar o repo e rebuildar resolve na maioria dos casos.

## Histórico

- 2026-08-12: deploy inicial (DNS + Traefik + build + smoke test 200 no HTTPS público).
