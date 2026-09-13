# RELATÓRIO RC12.3 — DASHBOARD OFICIAL DE OBSERVABILIDADE

**Data:** 2026-07-26  
**Pré-requisitos:** RC12.1 (Event Bus) · RC12.2 (Telemetria/RUM)  
**Status:** Implementação controlada  
**Confidence:** 1.00  

---

## 1. Resumo executivo

Criado o **Dashboard Oficial de Observabilidade** no ERP, módulo **Administração**, acesso exclusivo **SUPER_ADMIN**, consumindo **somente** `GET /api/observabilidade/summary` em modo **READ-ONLY**.

| Critério | Status |
|----------|--------|
| Dashboard funcional | ✓ |
| Somente leitura | ✓ |
| Nenhuma escrita de negócio | ✓ |
| Nenhuma regra comercial/fiscal/MIIP/TEF/Central alterada | ✓ |
| Electron / package.json / banco intactos | ✓ |
| Testes aprovados | ✓ |

---

## 2. Fase 1 — Nova tela ERP

| Item | Valor |
|------|-------|
| Página | `observabilidade` |
| Menu | Administração → Observabilidade |
| Permissão | `SUPER_ADMIN` (`usuarioTemPermissao` + `#nav-observabilidade`) |
| Lazy script | `/erp/js/observabilidade.js` |
| HTML | `frontend/erp/pages/observabilidade.html` |

Arquivos de UI/ACL:

- `frontend/erp/index.html`
- `frontend/erp/js/app.js`
- `frontend/erp/js/observabilidade.js`
- `frontend/shared/js/access-control.js`
- `frontend/shared/js/core.js`
- `frontend/shared/js/cds-page-shell.js`

---

## 3. Fase 2 — Dashboard (consumo da API)

Endpoint único:

```http
GET /api/observabilidade/summary
Authorization: Bearer <token SUPER_ADMIN>
```

Exibe:

- Tempo de Boot / Login / abertura de módulos  
- Lazy Created / Lazy Reused  
- Heap / RSS / CPU / Event Loop Delay / Uptime  
- Background / MIIP / Central / NF-e  

Auto-refresh a cada 15s (somente GET).

---

## 4. Fase 3 — KPIs

Cartões: **Boot · Login · ERP · MIIP · NF-e · Central · Recursos**

Cada cartão (exceto Recursos, que prioriza RSS/Heap/CPU/EL):

| Campo | Origem |
|-------|--------|
| Atual | último valor (`last`) |
| Média | `avg` |
| p50 | percentil 50 |
| p95 | percentil 95 |
| Máximo | `max` |

Montagem server-side em `backend/observabilidade/dashboardView.js` (`kpis`).

---

## 5. Fase 4 — Status

Indicadores derivados **apenas de métricas** (sem regra comercial):

| Código | UI |
|--------|----|
| `saudavel` | 🟢 Saudável |
| `atencao` | 🟡 Atenção |
| `critico` | 🔴 Crítico |

Limiares técnicos (exemplos): boot p95, login p95, lazy first open, event loop, CPU, RSS.

---

## 6. Fase 5 — Histórico

`summary.recent` lista os últimos eventos do ring buffer do Bus, filtrados por:

`BOOT` · `LOGIN` · `MODULE` · `MIIP` · `SOAP` · `CENTRAL` · `BACKGROUND` · `RESOURCE_SAMPLE`

Campos: timestamp, grupo, event_name, nível, duração, origem (já sanitizados pelo Bus).

---

## 7. API (read-only no dashboard)

| Método | Path | Auth | Escrita |
|--------|------|------|---------|
| `GET` | `/api/observabilidade/summary` | SUPER_ADMIN | Não |
| `POST` | `/api/observabilidade/rum` | Público (RUM RC12.2) | Ingest telemetria (não usado pelo dashboard) |

O dashboard **não** chama POST/PUT/PATCH/DELETE.

Enrichment do GET (ainda read-only):

- `kpis`
- `status`
- `recent`
- `read_only: true`

---

## 8. Resultados dos testes

| Suite | Resultado |
|-------|-----------|
| `tests/rc12-3-dashboard-observabilidade.test.js` | ✓ |
| `tests/rc12-2-telemetria-rum.test.js` | ✓ |
| `tests/rc12-1-observability-bus.test.js` | ✓ |
| `tests/rc11-4-lazy-erp.test.js` | ✓ (contagem lazy atualizada para 46) |
| `tests/miip/miip-telemetry.test.js` | ✓ 41/41 |
| `tests/central-entradas/maquina-estados.test.js` | ✓ 8/8 |
| `tests/faturamento/rc3165-pipeline-electron.test.js` | ✓ |

```bash
node tests/rc12-3-dashboard-observabilidade.test.js
```

---

## 9. Compatibilidade

| Área | Impacto |
|------|---------|
| Regras comerciais | Nenhum |
| Motor fiscal / MIIP / TEF / Central | Nenhum |
| Electron / package.json / DB | Nenhum |
| Observabilidade RC12.1–12.2 | Estendida (summary + UI) |

---

## 10. Critérios de sucesso

- ✓ Dashboard totalmente funcional  
- ✓ Nenhuma escrita no painel  
- ✓ Somente leitura  
- ✓ Nenhuma regra de negócio alterada  
- ✓ Confidence 1.00  

**RC12.3.0 — CONCLUÍDA.**
