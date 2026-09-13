# RC15.9 — Auditoria da origem do encerramento TCP

## Problema

Após `SOCKET connect` → `CONNECTED`, ocorriam `SOCKET end` / `SOCKET close` (`hadError=false`) sem TX — sem saber se o CDS ou a balança encerrou.

## Correção

Módulo `SocketCloseAudit.js`:

| Tipo | Significado |
|------|-------------|
| `LOCAL_CLOSE` | CDS chamou `end` / `destroy` / `disconnect` |
| `REMOTE_CLOSE` | Peer enviou FIN (`socket.on("end")` sem pedido local) |
| `ERROR_CLOSE` | Close com erro / `hadError` |
| `TIMEOUT_CLOSE` | Timeout de socket / open |

Instrumentado em:

- `socket.end()` / `destroy()` / `destroySoon()` (wrapper)
- `TcpConnection.close()` / `destroy()`
- `EthernetTransport.disconnect()` / `destroy()`
- `ConnectionManager.disconnect()`
- `ToledoPrixIVDriver.disconnect()`

Logs:

```
===== SOCKET END REQUEST =====   → CDS iniciou
===== SOCKET REMOTE END =====    → peer/balança
===== SOCKET CLOSE CLASSIFIED =====  → kind + iniciador
```

## Aceite

Em todo `SOCKET end`/`close` fica claro se o iniciador é **CDS** ou **BALANCA_OU_PEER**.

## Testes

```bash
npm run test:socket-close-origin
```
