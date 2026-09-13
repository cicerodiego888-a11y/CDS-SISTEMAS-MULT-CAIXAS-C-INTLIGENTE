# RELATÓRIO RC12.2 — TELEMETRIA E RUM

**Data:** 2026-07-26  
**Arquitetura:** `docs/oficial/observabilidade/ARQUITETURA_OBSERVABILIDADE_RC12.md`  
**Pré-requisito:** RC12.1 — CDS Observability Bus  
**Status:** Implementação controlada  
**Confidence:** 1.00  

---

## 1. Resumo executivo

Implementada a camada de **telemetria / RUM** sobre o Event Bus existente (`obs.v1`), sem alterar regras de negócio, APIs públicas de domínio, banco, Electron, `package.json`, Monitoring Engine, MIIP ou motores fiscais.

| Critério | Status |
|----------|--------|
| RUM frontend funcionando | ✓ |
| Sampler de recursos ativo | ✓ |
| API read-only operacional | ✓ |
| Event Bus reutilizado | ✓ |
| Nenhuma regra de negócio alterada | ✓ |
| Testes aprovados | ✓ |

---

## 2. Eventos implementados

### 2.1 RUM (frontend → `POST /api/observabilidade/rum`)

| Evento | Origem | Descrição |
|--------|--------|-----------|
| `AUTH_LOGIN_DURATION` | `frontend.login` | Duração do POST de login (sucesso/erro) |
| `MODULE_OPEN` | `frontend.erp.lazy` | Abertura de módulo ERP |
| `MODULE_LAZY_CREATED` | `frontend.erp.lazy` | Primeira carga / scripts novos |
| `MODULE_LAZY_REUSED` | `frontend.erp.lazy` | Reutilização de cache de scripts |
| `MODULE_LAZY_ERROR` | `frontend.erp.lazy` | Falha ao carregar scripts do módulo |

Cliente: `frontend/shared/js/cds-obs-rum.js`  
Instrumentação: `frontend/shared/js/login.js`, `frontend/erp/js/app.js`

### 2.2 Recursos (backend sampler)

| Evento | Origem | Descrição |
|--------|--------|-----------|
| `RESOURCE_SAMPLE` | `observabilidade.resourceSampler` | Amostra periódica (default 15s, `CDS_OBS_SAMPLER_MS`) |

Campos do payload: `heap_rss_mb`, `heap_used_mb`, `cpu_percent`, `event_loop_delay_ms`, `uptime_s`, `sample_n`.

### 2.3 Domínios agregados a partir do Bus (RC12.1+)

Boot, Background, Lazy (backend + frontend), Login, MIIP, Central, NF-e (SOAP), Recursos.

Todos os eventos passam pelo envelope **`obs.v1`** (validate → sanitize → policy → route).

---

## 3. Métricas coletadas

### RUM / performance

- Duração de login (`AUTH_LOGIN_DURATION`)
- Tempo de **primeira abertura** de módulo (`MODULE_LAZY_CREATED` / `lazy:first_open_ms`)
- Tempo de **reutilização** (`MODULE_LAZY_REUSED` / `lazy:reuse_ms`)
- Contagem created / reused / error

### Recursos do processo

- Heap RSS / Heap Used  
- CPU (%) entre amostras  
- Event Loop Delay (mean via `perf_hooks.monitorEventLoopDelay`)  
- Uptime  

---

## 4. Agregadores

Módulo: `backend/observabilidade/metricsAggregator.js`  
Coletor: `backend/observabilidade/telemetryCollector.js`

Estatísticas em memória (janela deslizante, **sem persistência definitiva**):

| Estatística | Campo |
|-------------|-------|
| Contagem | `count` / `events` |
| Mínimo | `min` |
| Máximo | `max` |
| Média | `avg` |
| Percentil 50 | `p50` |
| Percentil 95 | `p95` |

---

## 5. API

Montagem: `backend/rotas/observabilidade.js` → `/api/observabilidade`

| Método | Path | Auth | Função |
|--------|------|------|--------|
| `GET` | `/api/observabilidade/summary` | Sim (gate Auth+Licença) | Agregados read-only |
| `POST` | `/api/observabilidade/rum` | Público (whitelist + sanitização) | Ingest RUM → Bus |

### Resposta `GET /summary` (seções)

- `boot`
- `login`
- `lazy` (inclui `first_open_ms`, `reuse_ms`, `created`, `reused`, `errors`)
- `miip`
- `central`
- `nfe`
- `background`
- `recursos` (`ultimo` + séries agregadas)
- `versao_schema`: `obs.v1`

---

## 6. Sanitização (Fase 5)

Camadas:

1. **Whitelist de payload RUM** (`rumIngest.PAYLOAD_ALLOW`) — fail-closed; rejeita token, XML, CPF, dados fiscais etc.  
2. **`eventSanitizer`** do Bus — redaction de CSC/senha/token/JWT/PAN/XML.  
3. **Catálogo** — apenas eventos `RUM_ALLOWED` são aceitos no ingest.

Validação automatizada em `tests/rc12-2-telemetria-rum.test.js`.

---

## 7. Arquivos principais

```text
backend/observabilidade/
  metricsAggregator.js
  resourceSampler.js
  telemetryCollector.js
  rumIngest.js
  eventTypes.js          (+ RUM / RESOURCE_SAMPLE)
  eventPolicies.js       (+ defaults RC12.2)
  index.js               (+ collector + sampler em iniciar())

backend/rotas/observabilidade.js
backend/middleware/apiPublicPaths.js   (+ /api/observabilidade/rum)
backend/server.js                      (+ mount /api/observabilidade)

frontend/shared/js/cds-obs-rum.js
frontend/shared/js/login.js
frontend/erp/js/app.js
frontend/shared/login.html
frontend/erp/index.html

tests/rc12-2-telemetria-rum.test.js
```

---

## 8. Resultados dos testes

| Suite | Resultado |
|-------|-----------|
| `tests/rc12-2-telemetria-rum.test.js` | ✓ Aprovado |
| `tests/rc12-1-observability-bus.test.js` | ✓ Aprovado |
| `tests/rc11-4-lazy-erp.test.js` | ✓ Aprovado |
| `tests/miip/miip-telemetry.test.js` | ✓ 41/41 |
| `tests/central-entradas/maquina-estados.test.js` | ✓ 8/8 |
| `tests/faturamento/rc3165-pipeline-electron.test.js` | ✓ Aprovado |

Comando:

```bash
node tests/rc12-2-telemetria-rum.test.js
```

---

## 9. Compatibilidade

| Área | Impacto |
|------|---------|
| Event Bus RC12.1 | Reutilizado; `iniciar()` agora também sobe collector + sampler |
| Regras de negócio | Nenhuma alteração |
| APIs de domínio | Intactas; endpoints novos só em `/api/observabilidade` |
| Banco | Sem schema / persistência |
| Electron / `package.json` | Não alterados |
| Monitoring Engine / MIIP / Fiscal | Não alterados |

---

## 10. Critérios de sucesso

- ✓ RUM funcionando  
- ✓ Sampler de recursos ativo  
- ✓ API read-only operacional  
- ✓ Event Bus reutilizado  
- ✓ Nenhuma regra de negócio alterada  
- ✓ Todos os testes aprovados  

**RC12.2.0 — CONCLUÍDA.**
