# RC14.14.7 — Máquina de Estados + Instância Única da Sessão

## Problema

1. Após `socket.connect()`, a FSM ia **CONNECTING → IDLE**, sem registrar **CONNECTED**.
2. Leituras de `EquipmentSession` podiam usar instâncias descartáveis (`criarSessaoAusente`), divergindo do pool.

## Correção

### FSM

Fluxo oficial:

```
DISCONNECTED → CONNECTING → CONNECTED → (BUSY ↔ CONNECTED) → DISCONNECTED
```

- **Proibido:** `CONNECTING → IDLE` e `RECONNECTING → IDLE`
- Sucesso de connect/reconnect → `STATES.CONNECTED`
- send/receive retornam a `CONNECTED` (não IDLE)
- Instrumentação: log `STATE CHANGE` com origem + stack

### EquipmentSession

- `EquipmentSessionRegistry` — uma instância por `host:porta`
- `getSession()` sempre devolve a mesma referência
- Diagnóstico captura a sessão **antes** do disconnect do probe

## Testes

```bash
npm run test:connection-state
npm run test:connection-manager-v2
npm run test:session-source
npm run test:tcp-connect-audit
```
