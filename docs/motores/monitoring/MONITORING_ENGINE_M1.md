# CDS Monitoring Engine V1.0 — Sprint M1

**Fundação da Central de Monitoramento**  
**Data:** 2026-07-16  
**Status:** Entregue

## Escopo

Novo motor **independente** da arquitetura CDS Sistemas.

- **Não** pertence à Plataforma Fiscal V1 (congelada).
- **Não** pertence à Central Inteligente V1 (congelada).
- Nenhuma tela consulta banco/SQL diretamente — tudo passa pelo Monitoring Engine.

## Arquitetura

```
ERP UI (Central de Monitoramento)
    ↓  GET /api/monitoring/summary
MonitoringEngine
    ↓
MonitoringRegistry
    ↓
Providers (Fiscal | Financeiro | Caixa | …)
    ↓
MonitoringResult
    ↓
UI (cds-cfg Design System)
```

## Providers

| Provider | M1 |
|----------|----|
| FiscalProvider | **Funcional** (vendas/entradas fiscal + não fiscal) |
| FinanceiroProvider | Stub estrutural |
| CaixaProvider | Stub estrutural |
| EstoqueProvider | Stub estrutural |
| RecebimentosProvider | Stub estrutural |
| ComercialProvider | Stub estrutural |
| AlertasProvider | Stub estrutural |

## Regra F12

- **F12 ON** → UI exibe somente Vendas Fiscais + Entradas NF Fiscal  
- **F12 OFF** → UI exibe também Vendas/Entradas Não Fiscais  

Controle de exibição na UI (`modoFiscalAtivoSistema`). API retorna ambos os blocos.

## API

`GET /api/monitoring/summary` (autenticado)

Contrato agregado: `fiscal`, `naoFiscal`, `financeiro`, `caixa`, `estoque`, `recebimentos`, `comercial`, `alertas` + `metrics`.

## Cache

`MonitoringCache` preparado — **sem cache real** em M1.

## Teste

```bash
npm run test:monitoring-m1
```

## Não iniciado

Sprint M2 (não iniciar automaticamente).
