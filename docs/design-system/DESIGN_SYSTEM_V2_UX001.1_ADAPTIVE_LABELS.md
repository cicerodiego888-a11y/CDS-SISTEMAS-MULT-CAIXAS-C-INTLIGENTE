# CDS Design System V2 — Adaptive Labels (UX-001.1)

**Status:** consolidado e obrigatório  
**Sprint:** UX-001.1 — Consolidação do Adaptive Label System  
**Pré-requisito:** UX-001 (fundação) · Monitoring Engine M4  
**Não inicia:** Workflow Center (M5)

---

## Resumo Executivo

O **Adaptive Label System** passa a ser componente oficial e obrigatório do **CDS Design System V2**.

Nenhuma tela deve decidir sozinha textos Fiscal × Não Fiscal. Toda nomenclatura operacional vem de:

`AdaptiveLabelProvider` → `AdaptiveLabelService` → `AdaptiveLabelRegistry` + `AdaptiveLabelContext`

| Modo | F12 | Comportamento UX |
|------|-----|------------------|
| Fiscal | ON | Labels neutras (`Vendas`, `Caixa`). Nunca revela “Não Fiscal”. |
| Completo | OFF | Labels explícitas (`Vendas Fiscal` / `Vendas Não Fiscal`). |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Telas / Monitoring / Futuro Workflow                   │
│  AdaptiveLabelService.getLabel|getPlural|getShort|…     │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  AdaptiveLabelProvider (bootstrap Design System)        │
│  CDS.DesignSystem.AdaptiveLabels                        │
└───────┬─────────────────────────────┬───────────────────┘
        │                             │
┌───────▼──────────┐        ┌─────────▼──────────────────┐
│ AdaptiveLabel    │        │ AdaptiveLabelContext       │
│ Registry         │        │ F12 · perfil · idioma      │
│ (catálogo i18n)  │        │ (sem if F12 nas telas)     │
└──────────────────┘        └────────────────────────────┘
```

### Fluxograma (decisão de label)

```
getLabel(domain, { scope })
        │
        ▼
  Registry.get(domain)
        │
        ▼
  AdaptiveI18n.resolve? ──sim──► texto traduzido
        │não
        ▼
  Context.isModoFiscalAtivo?
        │
   sim ─┴─► def.base          (neutro)
   não ───► scope=nao_fiscal? ► def.naoFiscal
                            └► def.fiscal
```

---

## Arquivos criados / consolidados

| Arquivo | Papel |
|---------|--------|
| `frontend/shared/services/AdaptiveLabelRegistry.js` | Catálogo oficial de domínios |
| `frontend/shared/services/AdaptiveLabelContext.js` | F12, perfil, idioma |
| `frontend/shared/services/AdaptiveLabelService.js` | API `getLabel/getPlural/getShortLabel/getDescription` |
| `frontend/shared/services/AdaptiveLabelProvider.js` | Bootstrap `CDS.DesignSystem.AdaptiveLabels` |

### Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `frontend/erp/index.html` | Carrega Provider |
| `frontend/erp/js/cds-monitoring-engine.js` | Chrome UI via Adaptive Labels (sem strings locais de domínio) |
| `tests/design-system/adaptive-label-ux001.1.test.js` | Aceite UX-001.1 |
| `package.json` | Script `test:adaptive-label-ux001.1` |

**Não alterados (congelados):** Plataforma Fiscal, Central Inteligente, Registry/Resolver/Soap, Parser, MIIP, Motor Comercial, banco, regras fiscais, Monitoring Intelligence backend, Action Center backend, Workflow.

---

## API oficial

```js
AdaptiveLabelService.getLabel('vendas')
AdaptiveLabelService.getLabel('vendas', { scope: 'nao_fiscal' })
AdaptiveLabelService.getPlural('vendas')
AdaptiveLabelService.getShortLabel('receber')   // Receber | Receber Fiscal
AdaptiveLabelService.getDescription('caixa')
AdaptiveLabelService.getBadge('nao_fiscal')     // '' se F12 ON
AdaptiveLabelService.labelForWidget(widget)
AdaptiveLabelService.sanitize(textoBackend)
AdaptiveLabelService.registerDomain('crm', { base, fiscal, naoFiscal, i18nKey })
```

Atalhos Design System:

```js
CDS.DesignSystem.AdaptiveLabels.service.getLabel('pix')
AdaptiveLabelProvider.labels('estoque')
```

---

## Mapa das Labels (oficial)

| Domínio | F12 ON (base) | F12 OFF fiscal | F12 OFF não fiscal |
|---------|---------------|----------------|--------------------|
| vendas | Vendas | Vendas Fiscal | Vendas Não Fiscal |
| entradas | Entradas NF | Entradas NF Fiscal | Entradas NF Não Fiscal |
| caixa | Caixa | Caixa Fiscal | Caixa Não Fiscal |
| estoque | Estoque | Estoque Fiscal | Estoque Não Fiscal |
| pix | PIX | PIX Fiscal | PIX Não Fiscal |
| cartao | Cartão | Cartão Fiscal | Cartão Não Fiscal |
| tef | TEF | TEF Fiscal | TEF Não Fiscal |
| receber | Contas a Receber | Contas a Receber Fiscal | Contas a Receber Não Fiscal |
| pagar | Contas a Pagar | Contas a Pagar Fiscal | Contas a Pagar Não Fiscal |
| financeiro | Financeiro | Financeiro | Financeiro Não Fiscal |
| comercial | Comercial | Comercial | Comercial Não Fiscal |
| alertas | Alertas | Alertas | Alertas |
| indicadores | Indicadores | Indicadores | Indicadores |
| monitoramento | Central de Monitoramento | idem | idem |
| workflow | Workflow | Workflow | Workflow |
| cop | Centro de Operações CDS | idem | idem |

**Short (receber/pagar):** `Receber` / `Receber Fiscal` / `Receber Não Fiscal` (e Pagar*).

---

## Mapa dos Domínios

```
Operação     → vendas, entradas, caixa, estoque
Meios        → pix, cartao, dinheiro, tef
Financeiro   → receber, pagar, financeiro
Comercial    → comercial
Governança   → alertas, indicadores
Plataforma   → monitoramento, cop, workflow
UI chrome    → acoes_recomendadas, fila_trabalho, timeline_global,
               historico_acoes, executive_insights, recomendacao, …
```

Extensão futura: `registerDomain('producao'|'industria'|'logistica'|'crm', …)` sem alterar telas.

---

## Preparação i18n

- Cada entrada possui `i18nKey` (`labels.vendas`, …).
- `AdaptiveLabelContext.getIdioma()` default `pt-BR` (suporta `en-US`, `es-ES`).
- Hook: se existir `AdaptiveI18n.resolve(i18nKey, locale, meta)`, o Service usa antes do fallback pt-BR.
- Telas **não** mudam quando o locale mudar.

---

## Checklists

### Arquitetural

- [x] Catálogo único no Registry (sem constantes locais de domínio)
- [x] Decisão F12 somente no Context
- [x] Provider registra componente no Design System
- [x] API estável + `registerDomain` para novos módulos
- [x] Sem alteração em motores fiscais / Central / Intelligence backend

### UX

- [x] Modo Fiscal: nunca “Vendas Fiscal” / “Não Fiscal” em títulos
- [x] Modo Completo: Fiscal × Não Fiscal explícito
- [x] Monitoring chrome (COP, Insights, Fila, Timeline, Histórico) via Service
- [x] Badges vazios no modo Fiscal

### Não regressão

- [x] Monitoring M1–M4 intactos no backend
- [x] Visibilidade silenciosa `data-mon-nao-fiscal` mantida
- [x] Action Center continua só navegação sugerida
- [x] M5 Workflow **não** iniciado

### Readiness Final

| Critério | Status |
|----------|--------|
| Adaptive Labels obrigatório no DS V2 | Pronto |
| Monitoring consome Service | Pronto |
| i18n hook | Pronto (sem traduções ainda) |
| Novos domínios via registry | Pronto |
| Sprint M5 | **Não iniciada** |

---

## Respostas obrigatórias

1. **Existe alguma tela decidindo nomenclaturas localmente?**  
   No Monitoring Engine UI: **não** para domínios oficiais — abas, widgets, COP chrome e KPIs passam pelo `AdaptiveLabelService`. Outras telas legadas do ERP ainda podem ter textos fixos históricos; a regra oficial a partir de UX-001.1 é migrá-las progressivamente para o Service (sem if F12 local).

2. **Toda a nomenclatura agora passa pelo AdaptiveLabelService?**  
   **Sim, no escopo desta Sprint (Monitoring + Design System).** Backend Intelligence/Action Center não foram alterados (congelados); títulos vindos da API passam por `sanitize`/`labelForWidget` na UI.

3. **O modo Fiscal consegue ocultar completamente a existência do módulo Não Fiscal?**  
   **Sim.** Context retorna `base`; badges vazios; widgets `scope=nao_fiscal` filtrados; `sanitize` remove “Fiscal/Não Fiscal” de textos backend.

4. **É possível adicionar novos domínios só registrando labels?**  
   **Sim.** `AdaptiveLabelService.registerDomain(id, { base, fiscal, naoFiscal, i18nKey, short*, plural*, description* })` — sem alterar a API das telas.

5. **Preparação i18n?**  
   **Sim.** `i18nKey` + `Context.getIdioma()` + hook `AdaptiveI18n.resolve` no Service; telas usam domain keys, não strings locais.

---

## Testes

```bash
npm run test:adaptive-label-ux001
npm run test:adaptive-label-ux001.1
```
