# CDS Design System V2 — Sprint UX-001

**Adaptive Label System**  
**Data:** 2026-07-16  
**Status:** Entregue · **consolidado em UX-001.1** (`docs/DESIGN_SYSTEM_V2_UX001.1_ADAPTIVE_LABELS.md`)

## Objetivo

Fonte única de nomenclatura Fiscal × Não Fiscal. Nenhuma tela decide texto localmente.

## Arquitetura

```
F12 / modo operacional
  ↓
AdaptiveLabelContext
  ↓
AdaptiveLabelRegistry (catálogo + i18nKey)
  ↓
AdaptiveLabelService.getLabel() / sanitize() / labelForWidget()
  ↓
UI (Monitoring, futuro Dashboard/Financeiro/…)
```

## Regra

| Modo | Comportamento |
|------|----------------|
| F12 ON | Labels neutras (`Vendas`, `Caixa`…). Sem badges Fiscal/Não Fiscal. `sanitize()` remove essas palavras de textos vindos da API. |
| F12 OFF | Labels explícitas (`Vendas Fiscal`, `Vendas Não Fiscal`…). |

## API

```js
AdaptiveLabelService.getLabel('vendas')
AdaptiveLabelService.getLabel('vendas', { scope: 'nao_fiscal' })
AdaptiveLabelService.labelForWidget(widget)
AdaptiveLabelService.sanitize(texto)
AdaptiveLabelService.registerDomain('producao', { base, fiscal, naoFiscal, i18nKey })
```

## Escopo UX-001

- Serviço criado e carregado no ERP
- Central de Monitoramento migrada
- Backend Monitoring Engine **não** alterado (títulos adaptados na UI)

## Testes

```bash
npm run test:adaptive-label-ux001
```

## Não iniciado

Próxima Sprint do Design System V2.
