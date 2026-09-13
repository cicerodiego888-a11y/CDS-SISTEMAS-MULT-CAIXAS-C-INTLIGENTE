# CDS Monitoring Engine V1.0 — Sprint M4

**COP Action Center**  
**Data:** 2026-07-16  
**Status:** Entregue

## Arquitetura

```
MonitoringEngine
  → Registry → Providers
  → Widget Builder
  → Monitoring Intelligence
  → Executive Insights / COP
  → Action Center          ← M4
  → MonitoringResult → UI
```

## Camada `backend/monitoring/actions/`

| Arquivo | Função |
|---------|--------|
| MonitoringActionCenter | Orquestra actions, fila, timeline |
| MonitoringActionRegistry | Catálogo por signalId |
| MonitoringActionBuilder | Fiscal/Financeiro/Caixa/TEF/… |
| MonitoringActionResult | DTO Action |
| MonitoringActionContext | Perfil / permissões |
| MonitoringActionPermissions | Filtro de exibição |

## Regras

- **Não** executa ações automaticamente
- **Não** grava no banco / **não** altera dados
- Actions só sugerem `page` / `route` / `params`
- UI realiza navegação (`loadPage` / `location`)
- Histórico de ações: **somente sessionStorage** (cliente)
- Intelligence / Providers / Widget Builder **não alterados**

## API expandida

`GET /api/monitoring/summary` inclui:

- `actionCenter`
- `recommendedActions` (top 10)
- `workQueue`
- `timeline`
- alerts/insights/recommendations com `actions[]`
- `cop` enriquecido (cópia)

## Testes

```bash
npm run test:monitoring-m4
```

## Não iniciado

Sprint M5.
