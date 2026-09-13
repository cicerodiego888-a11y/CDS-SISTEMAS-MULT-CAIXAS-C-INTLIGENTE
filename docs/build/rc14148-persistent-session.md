# RC14.14.8 — Sessão Persistente + Heartbeat Oficial

## Objetivo

`EquipmentSession` permanece **CONNECTED** enquanto o ERP estiver aberto.
Operações reutilizam o mesmo socket; heartbeat oficial a cada **30s** (configurável).

## Fluxo

```
CONNECTED → Heartbeat → CONNECTED → Heartbeat → CONNECTED
```

Falha de heartbeat (sem intervenção):

```
CONNECTED → RECONNECTING → CONNECTING → CONNECTED
```

## Operações (mesmo socket)

READ_WEIGHT · UPLOAD_PLU · DOWNLOAD_PLU · CONFIG · PING · HEALTH

## Heartbeat

- Intervalo: `ConnectionHeartbeat.INTERVALO_PADRAO_MS = 30000` (ou `heartbeatMs` no CM)
- Atualiza: `heartbeatAt`, `latency`, `connectionMode` (`REUSED_SESSION`)

## Encerramento do socket (somente)

- Fechamento do ERP (`closeAll` em `will-quit` / SIGTERM / SIGINT)
- Remoção do equipamento
- Erro fatal / max reconnect
- Desconexão explícita (`disconnect`)

## Mudanças principais

| Área | Comportamento |
|------|----------------|
| `ConnectionManager` | Heartbeat oficial; `setPersistent(true)`; auto-reconnect |
| `ToledoDiagnostics` | `keepAlive` default **true** — não desconecta após diagnóstico |
| `EquipamentosService` | Teste/diagnóstico mantêm a sessão |
| `HeartbeatProbe` | Prefere ping via CM se já CONNECTED |
| `electron` / `server` | `closeAll()` no quit |

## Testes

```bash
npm run test:persistent-session
npm run test:connection-state
npm run test:session-source
```
