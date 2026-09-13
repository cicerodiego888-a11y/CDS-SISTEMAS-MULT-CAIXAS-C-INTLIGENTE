# RELATÓRIO RC12.4 — ALERT ENGINE

**Data:** 2026-07-26  
**Pré-requisitos:** RC12.1 · RC12.2 · RC12.3  
**Status:** Implementação controlada  
**Confidence:** 1.00  

---

## 1. Resumo executivo

Implementado o **Alert Engine** oficial da plataforma sobre o CDS Observability Bus, com regras técnicas, deduplicação em memória e APIs **READ-ONLY** para o Dashboard de Observabilidade.

| Critério | Status |
|----------|--------|
| Alert Engine funcional | ✓ |
| 10 regras oficiais | ✓ |
| Dedupe (event/fingerprint/janela) | ✓ |
| API read-only | ✓ |
| Dashboard com alertas | ✓ |
| Sem alteração de regras de negócio | ✓ |
| Electron / package.json / banco intactos | ✓ |
| Testes aprovados | ✓ |

---

## 2. Arquitetura

```text
Event Bus (obs.v1)
    │
    ▼
alertEngine.js  ── subscribe('*')
    │  regras + fingerprint + janela
    ▼
active Map + history ring (memória)
    │
    ├── GET /api/observabilidade/alerts
    ├── GET /api/observabilidade/alerts/summary
    └── summary.alerts (dashboard RC12.3)
```

Módulo: `backend/observabilidade/alertEngine.js`  
Inicialização: `observabilidade.iniciar()` (junto com collector + sampler).

**Sem persistência em banco.** Estado apenas em memória de processo.

---

## 3. Regras implementadas

| Regra | Gatilho | Severidade | Limiar default |
|-------|---------|------------|----------------|
| `BOOT_LENTO` | `BOOT_HTTP_LISTENING` | alta | ≥ 5000 ms |
| `LOGIN_LENTO` | `AUTH_LOGIN_DURATION` | media | ≥ 4000 ms |
| `MODULE_LENTO` | `MODULE_LAZY_CREATED` / `MODULE_OPEN` | media | ≥ 5000 ms |
| `MIIP_LENTO` | `MIIP_IDENTIFY_FINISHED` | media | ≥ 2000 ms |
| `CENTRAL_PARADA` | `CENTRAL_SYNC_ERRO` / `CENTRAL_ERRO` + watchdog de gap | alta | gap 15 min |
| `SOAP_TIMEOUT` | `SOAP_TIMEOUT` (janela 5 min) | alta | ≥ 1 |
| `NFE_FILA_ALTA` | SOAP in-flight (iniciado − encerrado) | alta | ≥ 8 |
| `RESOURCE_MEMORY_HIGH` | `RESOURCE_SAMPLE.heap_rss_mb` | media | ≥ 1024 MB |
| `RESOURCE_CPU_HIGH` | `RESOURCE_SAMPLE.cpu_percent` | media | ≥ 80% |
| `EVENT_LOOP_HIGH` | `RESOURCE_SAMPLE.event_loop_delay_ms` | alta | ≥ 200 ms |

Limiares configuráveis via env (`CDS_OBS_ALERT_*`) sem alterar código de negócio.

`NFE_FILA_ALTA` usa **proxy observacional** (SOAP in-flight), sem consultar fila comercial/fiscal.

---

## 4. Deduplicação

Chave: `fingerprint = sha1(rule|parts).slice(0,16)`

Campos:

- `event_name` / `rule`
- `fingerprint`
- `dedupe_ms` por regra (5–10 min)

Comportamento na janela: **não cria novo alerta**; incrementa `occurrences` e atualiza `last_seen_at` / `metric_value`.

Resolução automática (quando aplicável): memória/CPU/EL recuperados, fila SOAP baixa, Central sync OK.

---

## 5. API (READ-ONLY)

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| `GET` | `/api/observabilidade/alerts` | SUPER_ADMIN | Lista (`status`, `severidade`, `limit`) |
| `GET` | `/api/observabilidade/alerts/summary` | SUPER_ADMIN | Contadores por severidade/regra |
| `GET` | `/api/observabilidade/summary` | SUPER_ADMIN | Inclui bloco `alerts` |

Query de `/alerts`:

- `status=ativo|historico|resolvido|todos`
- `severidade=baixa|media|alta|critica`
- `limit` (máx. 200)

Nenhum `POST/PUT/PATCH/DELETE` em `/alerts*`.

---

## 6. Dashboard

Painel Observabilidade (RC12.3) ampliado:

- Contadores: ativos, por severidade, histórico  
- Tabela de alertas ativos / histórico  
- Filtros de severidade e status  
- Refresh via endpoints read-only (`/alerts` + `/alerts/summary`)

Arquivos:

- `frontend/erp/pages/observabilidade.html`
- `frontend/erp/js/observabilidade.js`

---

## 7. Resultados dos testes

| Suite | Resultado |
|-------|-----------|
| `tests/rc12-4-alert-engine.test.js` | ✓ |
| `tests/rc12-3-dashboard-observabilidade.test.js` | ✓ |
| `tests/rc12-2-telemetria-rum.test.js` | ✓ |
| `tests/rc12-1-observability-bus.test.js` | ✓ |
| `tests/rc11-4-lazy-erp.test.js` | ✓ |
| `tests/miip/miip-telemetry.test.js` | ✓ 41/41 |
| `tests/central-entradas/maquina-estados.test.js` | ✓ 8/8 |
| `tests/faturamento/rc3165-pipeline-electron.test.js` | ✓ |

```bash
node tests/rc12-4-alert-engine.test.js
```

---

## 8. Compatibilidade

| Área | Impacto |
|------|---------|
| Fluxo comercial / fiscal / MIIP / TEF / Central | Nenhum |
| Electron / package.json / banco | Nenhum |
| Monitoring Engine comercial | Não alterado |
| Observabilidade RC12.1–12.3 | Estendida (engine + UI) |

---

## 9. Critérios de sucesso

- ✓ Alert Engine funcional  
- ✓ Sem alterar regras de negócio  
- ✓ Somente leitura para interface  
- ✓ Confidence 1.00  

**RC12.4.0 — CONCLUÍDA.**
