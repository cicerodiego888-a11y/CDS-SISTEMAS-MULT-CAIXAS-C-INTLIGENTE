# RC14.14.6 — Unificação da Fonte de Verdade da Conexão

## Problema

`conectado = true` (ConnectionManager) coexistia com `Monitor = OFFLINE / DISCONNECTED`.

## Correção

| Camada | Papel |
|--------|--------|
| **EquipmentSession** | Única fonte oficial (`connected`, `state`, `connectionMode`, …) |
| **ConnectionManager** | Atualiza a sessão em connect / disconnect / heartbeat / reconnect |
| **Monitor** | Apenas observa `getSession()` / snapshot |
| **Diagnóstico** | Expõe `session` / `conexao` / `monitor` idênticos |
| **Frontend** | Usa `session.state` do backend |

## Evolução

Ver **RC14.14.7** (`rc14147-connection-state-machine.md`): FSM oficial via `CONNECTED` (proíbe `CONNECTING → IDLE`) + registry único.

## Testes

```bash
npm run test:session-source
npm run test:connection-state
npm run test:connection-manager-v2
```
