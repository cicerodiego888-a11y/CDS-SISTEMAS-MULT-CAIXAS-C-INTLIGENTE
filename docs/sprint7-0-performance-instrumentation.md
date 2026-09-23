# Sprint 7.0 — Instrumentação de performance local

Somente medição. Nenhuma otimização, índice, debounce, cache ou correção de race foi aplicada.

## Como ligar

Frontend (ERP, nunca PDV):

```js
localStorage.setItem('CDS_PERFORMANCE_DIAGNOSTICS', 'ON');
location.reload();
```

ou no console:

```js
CDSPerformanceDiagnostics.enable();
```

Backend / SQLite:

```
PERFORMANCE_DIAGNOSTICS=ON
```

reiniciando o processo do servidor.

Default: **OFF**. Com OFF, `start()` retorna `null` e não há coleta.

## Como ler

No console do ERP:

```js
CDSPerformanceDiagnostics.getSnapshot()
CDSPerformanceDiagnostics.getReport({ type: 'navigation:' })
```

Backend (SUPER_ADMIN):

`GET /api/observabilidade/performance-diagnostics`

## Thresholds diagnósticos (ainda não calibrados)

- Evento UI: `<16ms` NORMAL · `16–50ms` ATENÇÃO · `>50ms` LENTO
- Navegação: `<100ms` NORMAL · `100–300ms` ATENÇÃO · `>300ms` LENTA
- Long task: `50–100ms` ATENÇÃO · `100–200ms` ALTA · `>200ms` CRÍTICA

## Procedimento de baseline

Ativar diagnóstico. Em cada cenário, anotar `sessionId` e exportar `getSnapshot()` ao final.

| ID | Ação | O que olhar |
|----|------|-------------|
| A | Abrir Clientes | `navigation:*`, `clientes:render-total`, `request` `/api/clientes`, sqlite |
| B | Digitar busca de cliente | `clientes:filter-*`, `field:event` |
| C | Clientes → Produtos | `navigationId`, `request-context:stale`, `produtos:render-total` |
| D | Produtos → Clientes | idem invertido |
| E | Abrir Dashboard | `dashboard:*`, `dashboard:backup-sync-io`, sqlite |
| F | Abrir Financeiro | `navigation:*`, `financeiro:render-total` |
| G | Abrir Central | `central:initial-load`, burst de `central:request` |
| H | Selecionar documento | `central:document-selection`, payload do detalhe |
| I | Trocar documento rápido | `validity: STALE` vs `VALID` |
| J | Permanecer 3 min na Central | `polling:*`, `central:soft-refresh-document`, `timer:end` |
| K | Sair da Central | `polling:stop`, timers off-page em outras telas |
| L | Navegar 3–5 telas repetidas | `request-context:retained`, `memory:sample` |

Não inventar durações. Se um cenário não puder ser executado agora, deixar como pendente de coleta manual.

## Limitações conhecidas

- `UIPollingManager` não possui `pause`/`resume`; esses eventos não existem.
- Long Task Observer depende do Chromium/Electron.
- `performance.memory` é opcional.
- SQLite só é envelopado se o backend iniciar com diagnóstico ON.
- PDV não carrega esta camada.
- Wrappers de `innerHTML` globais não foram instalados; renders críticos foram instrumentados pontualmente.
- Tamanho de payload é aproximado e nunca inclui conteúdo fiscal/XML.

## O que não foi alterado

Motor Fiscal, Motor Não Fiscal, PDV, TEF, pagamentos, estoque, regras NSU, SQL, índices, polling, UIRequestContext (exceto observações), navegação funcional.
