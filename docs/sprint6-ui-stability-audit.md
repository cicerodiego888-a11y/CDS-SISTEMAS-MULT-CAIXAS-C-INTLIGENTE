# Sprint 6 — Auditoria de polling e pontos de render (ERP)

## Regra oficial
Usuário > polling > refresh > resposta assíncrona antiga.

## Infraestrutura criada
| Módulo | Path |
|--------|------|
| UIStateManager | `frontend/shared/js/core/UIStateManager.js` |
| UINavigation | `frontend/shared/js/core/UINavigation.js` |
| UIRequestContext | `frontend/shared/js/core/UIRequestContext.js` |
| UIFocusManager | `frontend/shared/js/core/UIFocusManager.js` |
| UIPollingManager | `frontend/shared/js/core/UIPollingManager.js` |
| UISoftRefresh | `frontend/shared/js/core/UISoftRefresh.js` |

## Central de Entradas — polling mapeado

| ID | Intervalo | Componente | Risco foco | Estratégia |
|----|-----------|------------|------------|------------|
| central-servico | 30s | status serviço / rodapé | baixo | patch HTML local |
| central-notif | 45s | notificações + eventos | médio (header) | soft header / badge |
| central-live-ux | 1s | countdown live | baixo | tick incremental |
| central-soft-doc | 20s | documento selecionado | alto | skip se editing/modal; preserve focus |
| tickerSync (legado) | 60s | cabeçalho | médio | soft header se foco interno |

Ao sair da página `central-entradas`: `UIPollingManager.stopByPage` + `pararAutomacaoCentral`.

## Classificação de telas (amostra)

| Tela | Classificação | Notas |
|------|---------------|-------|
| Central Entradas | CRITICAL → migrado | header, doc, polling, token |
| Clientes | CRITICAL → migrado | navigation token no GET |
| Produtos | SAFE (soft refresh existente) + guard | token + soft refresh preservado |
| Fornecedores | NEEDS_GUARD | shell síncrono; fetch futuro |
| Vendas | NEEDS_SOFT_REFRESH | migração gradual |
| Compras | NEEDS_SOFT_REFRESH | migração gradual |
| Faturamento | NEEDS_GUARD | migração gradual |
| Caixa | NEEDS_GUARD | migração gradual |
| NF-e | NEEDS_GUARD | migração gradual |
| PDV | SAFE — não alterar atalhos/foco | scripts UI **não** carregados no PDV |

## NSU — nomenclatura dashboard
- Antes: "Possíveis lacunas"
- Depois: "Possíveis intervalos de NSU"
- Tooltip: intervalos entre NSUs de **documentos observados**; não é quantidade de NF-e perdidas.
- Fontes: `DOCUMENT_NSUS` | `CURSOR_NSUS` | `QUERY_NSUS`
