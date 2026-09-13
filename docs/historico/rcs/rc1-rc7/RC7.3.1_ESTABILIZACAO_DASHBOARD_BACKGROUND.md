# RC7.3.1 — Estabilização Operacional do Dashboard e Background

**VERSÃO:** CDS Sistemas V1.0  
**MODO:** IMPLEMENTAÇÃO  
**Data:** 2026-07-18  

Escopo respeitado: sem alterações em Plataforma Fiscal, DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, APIs ou Máquina de Estados.  
`sync_automatica_habilitada` **não** foi alterada no banco.

---

## 1. Causa raiz de cada bug

### BUG 01 — Dashboard não carrega
`atualizarOperacao()` em `dashboard-command.js` retornava `{ temAlertaWarn }` sem declarar a variável → `ReferenceError` em `atualizarCommandCenter` → `carregarDashboard` abortava o Command Center.

### BUG 02 — Loading infinito
`carregarDocumentosCentral()` chamava `renderGridCentralEntradas()` **ainda com** `carregando === true` (sempre skeleton) e no `finally` só zerava a flag **sem redesenhar**. O spinner/skeleton nunca saía sozinho.

### BUG 03 — Lista de fornecedores/documentos vazia até clicar
Mesma causa do BUG 02: a lista só reaparecia quando outra ação (ex.: abrir detalhe / “Ver detalhes”) chamava `renderGridCentralEntradas()` com `carregando === false`.

### BUG 04 — Datas iguais
A lista UX1 usava `doc.createdAt || doc.dataEmissao`. Notas do mesmo DistDFe compartilham o mesmo `created_at` da sync. A data correta do documento é a **emissão** (`dataEmissao` / dhEmi).

### BUG 05 — Background
1. Com flag off, o serviço dorme (esperado) — sem log claro.  
2. Com flag on, se `executarSincronizacao` **lançasse exceção**, o próximo `setTimeout` **não era reagendado** → loop morto.  
3. Faltavam logs operacionais exigidos (START/STOP/TIMER/WAKE/…).

---

## 2. Arquivos alterados

| Arquivo | Bugs |
|---------|------|
| `frontend/erp/js/dashboard-command.js` | 01 |
| `frontend/erp/js/dashboard.js` | 02 (finally + await vencimentos) |
| `frontend/erp/js/central-entradas.js` | 02, 03, 04 |
| `frontend/erp/js/central-entradas-ux.js` | 04 (parse YYYY-MM-DD sem shift de fuso) |
| `backend/motores/central-entradas/services/CentralSyncBackgroundService.js` | 05 |
| `tests/central-entradas/rc731-background-smoke.test.js` | 05 (novo) |
| `docs/RC7.3.1_ESTABILIZACAO_DASHBOARD_BACKGROUND.md` | este relatório |

---

## 3. Correção aplicada

| Bug | Correção |
|-----|----------|
| 01 | Declarar `temAlertaWarn` a partir de `alertas` com `priority === 'warn'`; usar no tom do card Central |
| 02/03 | `finally { carregando = false; renderGridCentralEntradas(); }`; init da Central com `.finally` de segurança; dashboard Central não relança erro |
| 02 (ERP Dashboard) | `try/finally` em `carregarDashboard` + `await` dos vencimentos |
| 04 | `obterDataExibicaoDocumentoCentral()` prioriza `dataEmissao`; UX helper trata data pura |
| 05 | try/finally no ciclo; overlap guard; logs `BACKGROUND *` com CorrelationId/RequestId/Tempo/Motivo; não altera flag |

---

## 4. Resultado dos testes

| Teste | Resultado |
|-------|-----------|
| Assert estático BUG01 (`temAlertaWarn`) | OK |
| Assert estático BUG02–04 (padrão finally + helper data) | OK |
| `node tests/central-entradas/rc731-background-smoke.test.js` | **OK** |

Checklist UI (validar no browser após reload):

- [ ] Abrir Dashboard — sem `ReferenceError`
- [ ] Abrir Central — lista aparece sem clique extra
- [ ] Abrir Dashboard/Central várias vezes — spinner encerra
- [ ] Datas distintas por emissão
- [ ] Com `sync_automatica_habilitada=false` — logs `BACKGROUND SLEEP`
- [ ] Com flag `true` (manual) — `BACKGROUND START` + TIMER + WAKE + DISTDFE

---

## 5. Logs do Background (formato)

```
[Central Entradas][BACKGROUND] <ISO> | Evento: BACKGROUND START|STOP|TIMER|WAKE|SLEEP|DISTDFE|ERROR|NEXT EXECUTION
| CorrelationId: ...
| RequestId: ...
| Tempo: ...
| Motivo: ...
| ProximaExecucao / IntervaloMs / Resultado / NotasNovas (quando aplicável)
```

Smoke capturou, entre outros:

- `BACKGROUND ERROR` com Motivo `falha_execucao_ciclo` (erro simulado) e **reagendamento** posterior.

---

## 6. Console antes × depois

| Antes | Depois |
|-------|--------|
| `ReferenceError: temAlertaWarn is not defined` | Ausente |
| Skeleton eterno na lista da Central | Lista renderiza após fetch |
| Datas/horários idênticos (created_at da sync) | Data de emissão por documento |
| Loop background morto após exceção | Ciclo reagendado no `finally` |

---

## 7. Confirmação de não-regressão

Não foram alterados: DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, schema/APIs de negócio, `sync_automatica_habilitada` no banco.

Alterações limitadas a UI do Dashboard/Central e robustez/logs do `CentralSyncBackgroundService`.
