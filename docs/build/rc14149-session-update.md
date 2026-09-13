# RC14.14.9 — Correção da Atualização da EquipmentSession

## Problema

`connect()` retornava `CONNECTED`, mas a `EquipmentSession` podia permanecer:

```
connected=false  persistent=false  host=null  porta=null  connectionMode=UNKNOWN
```

Causas:

1. Retornos sem commit obrigatório e unificado da sessão
2. Leituras (`getSession` / `health` / `criarSessaoAusente`) criavam sessões fantasma no registry com `host=null`

## Correção

### `_commitSessionConnected(entry, opts)`

Executado **antes** de qualquer return `CONNECTED` / `CONNECTED_ALREADY` (e na reconexão automática).

Atualiza obrigatoriamente:

- `connected = true`
- `state = CONNECTED`
- `host` / `porta`
- `connectedAt`
- `connectionMode` (`NEW_CONNECTION` | `REUSED_SESSION` | `AUTO_RECONNECT`)
- `persistent = true` (quando `persistir !== false`)

### Instrumentação

Log obrigatório:

```
SESSION UPDATE
connected=true
persistent=true
host=…
porta=…
mode=NEW_CONNECTION
```

### Leituras seguras

`getSession` / `getSessionSnapshot` / `health` **não** registram fantasma com `host=null`.

## Testes

```bash
npm run test:session-update
npm run test:persistent-session
npm run test:session-source
```
