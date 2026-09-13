# RELATÓRIO RC12.5 — HISTÓRICO E RETENÇÃO

**Data:** 2026-07-26  
**Pré-requisitos:** RC12.1 · RC12.2 · RC12.3 · RC12.4  
**Status:** Implementação controlada  
**Confidence:** 1.00  

---

## 1. Resumo executivo

Concluída a série **RC12** com persistência histórica isolada, retenção automática por nível, agregação temporal (hora/dia/semana/mês) e exportação JSON/CSV — tudo **READ-ONLY** na interface e **sem alterar regras de negócio**.

| Critério | Status |
|----------|--------|
| Histórico operacional | ✓ |
| Retenção automática | ✓ |
| Agregações temporais | ✓ |
| Exportação JSON/CSV | ✓ |
| Dashboard com período/gráficos/comparação | ✓ |
| Nenhuma regra de negócio alterada | ✓ |
| Electron / package.json intactos | ✓ |
| Testes / regressão | ✓ |

---

## 2. Arquitetura

```text
telemetryCollector + alertEngine
        │
        ▼
 historyService.takeSnapshot()   (periódico)
        │
        ├─► obs_metric_snapshots   (KPIs / Boot / Login / Lazy / Recursos / MIIP / Central / NF-e)
        ├─► obs_alert_history      (alertas novos)
        └─► obs_aggregates         (hora / dia / semana / mês)

 retention timer ──► DELETE por retencao_dias (DEBUG…CRITICAL)
 aggregate timer ──► avg / min / max / p50 / p95
```

Módulos:

| Arquivo | Papel |
|---------|-------|
| `historySchema.js` | DDL isolado (`CREATE IF NOT EXISTS`) |
| `historyRepository.js` | CRUD SQLite observabilidade |
| `historyService.js` | Snapshots, agregação, retenção, export |

Tabelas **novas e isoladas** — não alteram schema comercial/fiscal/MIIP/TEF/Central.

---

## 3. Persistência (Fase 1)

Snapshots periódicos (default **5 min**, `CDS_OBS_SNAPSHOT_MS`) gravam:

- KPIs (payload JSON sanitizado)  
- Alertas ativos (novos fingerprints)  
- Boot / Login / Lazy (1ª e reuse)  
- Recursos (RSS, Heap, CPU, Event Loop, Uptime)  
- MIIP / Central / NF-e / Background  

---

## 4. Retenção (Fase 2)

Políticas oficiais (`eventPolicies.RETENCAO_POR_NIVEL` / RC12.0.1):

| Nível | Dias |
|-------|------|
| DEBUG | 3 |
| INFO | 30 |
| WARN | 90 |
| ERROR | 180 |
| CRITICAL | 365 |

Cada linha persiste `nivel` + `retencao_dias`. Limpeza automática (`CDS_OBS_RETENTION_MS`, default 1h):

```sql
DELETE … WHERE datetime(created_at) < datetime('now', '-' || retencao_dias || ' days')
```

Agregados: hora→DEBUG(3), dia→INFO(30), semana→WARN(90), mês→ERROR(180).

---

## 5. Agregações (Fase 3)

`runAggregation()` gera buckets:

- **hora / dia / semana / mês**

Por domínio/métrica:

- média · mínimo · máximo · **p50** · **p95** · contagem  

---

## 6. API (READ-ONLY)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/api/observabilidade/history` | Séries + agregados + alertas |
| `GET` | `/api/observabilidade/history/aggregates` | Agregados filtrados |
| `GET` | `/api/observabilidade/history/compare` | Comparação A vs B |
| `GET` | `/api/observabilidade/history/export` | Download JSON/CSV |

Auth: **SUPER_ADMIN**. Sem POST/PUT/PATCH/DELETE em `/history*`.

---

## 7. Dashboard (Fase 4–5)

Painel Observabilidade ampliado:

- Filtro por período (6h … 30d)  
- Gráfico SVG da série selecionada  
- Comparação 24h atuais vs 24h anteriores  
- Exportação **JSON** / **CSV** (somente leitura)

---

## 8. Resultados dos testes

| Suite | Resultado |
|-------|-----------|
| `tests/rc12-5-historico-retencao.test.js` | ✓ |
| `tests/rc12-4-alert-engine.test.js` | ✓ |
| `tests/rc12-3-dashboard-observabilidade.test.js` | ✓ |
| `tests/rc12-2-telemetria-rum.test.js` | ✓ |
| `tests/rc12-1-observability-bus.test.js` | ✓ |
| `tests/rc11-4-lazy-erp.test.js` | ✓ |
| `tests/miip/miip-telemetry.test.js` | ✓ 41/41 |
| `tests/central-entradas/maquina-estados.test.js` | ✓ 8/8 |
| `tests/faturamento/rc3165-pipeline-electron.test.js` | ✓ |

```bash
node tests/rc12-5-historico-retencao.test.js
```

---

## 9. Checklist final da série RC12

| RC | Entrega | Status |
|----|---------|--------|
| **RC12.0.1** | Arquitetura oficial | ✓ |
| **RC12.1** | Event Bus `obs.v1` | ✓ |
| **RC12.2** | Telemetria + RUM + sampler | ✓ |
| **RC12.3** | Dashboard oficial | ✓ |
| **RC12.4** | Alert Engine | ✓ |
| **RC12.5** | Histórico + retenção + export | ✓ |

### Garantias transversais

- [x] Envelope `obs.v1` + sanitização  
- [x] Bus reutilizado (não substituído)  
- [x] APIs de domínio intactas  
- [x] Sem alteração fiscal / MIIP / TEF / Central / comercial  
- [x] Sem alteração Electron / `package.json`  
- [x] Dashboard e export **somente leitura**  
- [x] Confidence 1.00 em cada RC  

---

## 10. Critérios de sucesso

- ✓ Histórico operacional  
- ✓ Retenção automática  
- ✓ Exportação funcional  
- ✓ Nenhuma regra de negócio alterada  
- ✓ Confidence 1.00  

**RC12.5.0 — CONCLUÍDA.**  
**Série RC12 — ENCERRADA OFICIALMENTE.**
