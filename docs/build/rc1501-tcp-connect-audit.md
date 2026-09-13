# RC15.0.1 — Auditoria da Conexão TCP Oficial

## Problema

O Diagnóstico Enterprise marcava **TCP_CONNECT ✖ Sem comunicação** quando não havia sessão no pool do ConnectionManager — mesmo com `Test-NetConnection` OK na porta 9000.

Causa: diagnóstico **passivo** (só lia o pool), sem chamar `Socket.connect()`, e Handshake era inferido do mesmo flag.

## Correção

| Item | Detalhe |
|------|---------|
| Probe ativo | `probeConnection()` → `ConnectionManager.connect()` real |
| Estados TCP | `TCP_CONNECT_OK` / `TIMEOUT` / `REFUSED` / `HOST_UNREACHABLE` / `SOCKET_EXCEPTION` |
| Handshake | Etapa independente após TCP OK |
| Trace | `ConnectionTrace` — log `=== CONNECTION TRACE ===` |
| Painel | Lista `etapas_conexao` (TCP / Handshake / Health / Driver / Read) |

## Critério

- TCP_CONNECT só falha se `Socket.connect()` falhar
- TCP OK + Handshake timeout ⇒ TCP ✔, Handshake ✖
- Arquitetura do Motor Universal **inalterada**

## Testes

```bash
npm run test:tcp-connect-audit
npm run test:diagnostics-unification
npm run test:certification-v2
```
