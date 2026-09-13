# CDS Monitoring Engine V1.0 — Sprint M2

**Financeiro + Caixa + Widget Builder**  
**Data:** 2026-07-16  
**Status:** Entregue

## Arquitetura atualizada

```
ERP UI
  ↓ GET /api/monitoring/summary
MonitoringEngine
  ↓
MonitoringRegistry
  ↓
Provider (dados brutos)
  ↓
MonitoringWidgetBuilder
  ↓
MonitoringResult (+ widgets[])
  ↓
UI (renderiza widgets — sem SQL / sem cálculo de KPI)
```

## Widgets

| Widget | Domínio | Escopos |
|--------|---------|---------|
| FiscalWidget | fiscal | fiscal + nao_fiscal |
| FinanceiroWidget | financeiro | Receber/Pagar × fiscal/nao_fiscal |
| CaixaWidget | caixa | fiscal + nao_fiscal |
| RecebimentosWidget | recebimentos | PIX/Dinheiro/Cartão × fiscal/nao_fiscal |
| TefWidget | recebimentos | mock (sem SDK) |

## Providers M2

| Provider | Status |
|----------|--------|
| FiscalProvider | Funcional (M1) |
| FinanceiroProvider | **Funcional** |
| CaixaProvider | **Funcional** |
| RecebimentosProvider | **Funcional** |
| TefProvider | Estrutura + mock |
| Estoque / Comercial / Alertas | Stub |

## Regra F12

UI oculta widgets com `scope === 'nao_fiscal'` quando F12 ON.

## Testes

```bash
npm run test:monitoring-m1
npm run test:monitoring-m2
```

## Não iniciado

Sprint M3.
