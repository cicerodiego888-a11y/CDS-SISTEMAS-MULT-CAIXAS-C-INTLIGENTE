# RC15.8 — CONNECTED após reutilização do socket

## Problema

Com `TCP_CONNECT_OK` e `reutilizada=true`, a sessão podia permanecer `state=RECONNECTING` / `connected=false`, fazendo o Driver rejeitar o handshake/upload.

## Correção

No `ConnectionManager.connect`, se o socket do pool estiver aberto:

1. Log `REUSED SOCKET`
2. Abortar reconexão em andamento (`_reconnectAbort`)
3. FSM → `CONNECTED` + sessão `connected=true` / `REUSED_SESSION`
4. Log `CONNECTED RESTORED`
5. Retornar `CONNECTED_ALREADY` **antes** do handshake

`send()` também restaura CONNECTED se o transporte estiver aberto e a FSM ainda estiver inativa (ex.: RECONNECTING).

No Driver, o handshake só falha por socket fechado ou erro de transporte — não apenas porque `session.state === RECONNECTING`.

## Fluxo de aceite

```
Socket reutilizado → CONNECTED → Handshake → Upload
```

## Testes

```bash
npm run test:reused-socket-connected
```
