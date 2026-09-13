# RC15.10 — Exclusão mútua Heartbeat × Operações

## Problema

O Heartbeat (via `HeartbeatProbe` → `EthernetTransport.desconectar()` → `ConnectionManager.disconnect()`) derrubava a sessão usada por Upload/Download/Config/Diagnóstico.

## Correção

| Regra | Comportamento |
|-------|----------------|
| `session.busy = true` | Heartbeat **ignora** o equipamento |
| `busy` ou `connected+persistent` | Heartbeat **só** `ping()` — nunca `disconnect()` |
| Operação termina | `busy = false` → heartbeat volta |

### Quem marca busy

- Upload PLU → `UPLOAD`
- Download PLU → `DOWNLOAD`
- Config → `CONFIG`
- Diagnóstico → `DIAGNOSTICO`

### HeartbeatProbe

- Sessão viva → `ConnectionManager.ping()`
- Sem sessão → probe TCP **efêmero** (`net.Socket` próprio), sem tocar o pool
- **Removido** o path que chamava `EthernetTransport.disconnect()` no CM

### ConnectionManager

- `disconnect()` com `session.busy` → `SESSION_BUSY` (exceto `force: true` no quit)

## Aceite

Durante Upload: Heartbeat não executa `disconnect()`.

## Testes

```bash
npm run test:heartbeat-mutex
```
