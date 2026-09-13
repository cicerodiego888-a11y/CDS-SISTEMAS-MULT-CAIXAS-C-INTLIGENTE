# UX-A — Checklist de Higiene Arquitetural da Navegação

**Versão:** CDS Sistemas V1.0.0  
**Data:** 2026-07-11  
**Escopo:** Somente UX/UI — zero alteração funcional / backend / APIs / banco / ACL

## Checklist

| # | Item | Status |
|---|---|---|
| 1 | Removido item de menu **Estoque** (alias de Produtos) | OK |
| 2 | Renomeado **Relatórios / Vendas** → **Histórico de Vendas** | OK |
| 3 | **Diagnóstico Central** → **Saúde da Central** em Administração | OK |
| 4 | ACL existente mantida (`usuarioPodeAcessarDiagnosticoCentral`) | OK |
| 5 | Menu: **Central de Entradas** (cabeçalho do módulo permanece oficial) | OK |
| 6 | **Fiscal** → **NFC-e Emitidas** | OK |
| 7 | Grupo visual **Administração** | OK |
| 8 | Grupos: Painel, Comercial, Suprimentos, Financeiro, Cadastros, Fiscal, Relatórios, Administração | OK |
| 9 | Ícones padronizados (sem `fa-cash-register` duplicado no PDV) | OK |
| 10 | `CdsPageShell` (título + subtítulo + toolbar) | OK |
| 11 | Breadcrumb preparado (oculto por padrão) | OK |
| 12 | Toggle recolher/expandir sidebar + CSS 1366 / 1920 / 2560 | OK |
| 13 | `data-page` inalterados | OK |
| 14 | Router / `app.js` switch inalterado | OK |
| 15 | Backend / APIs / banco / regras inalterados | OK |

## Estrutura final do menu

```
Painel
  └─ Dashboard
Comercial
  ├─ Abrir PDV
  ├─ Histórico de Vendas
  └─ Fechamento de Caixa
Suprimentos
  ├─ Produtos
  ├─ Categorias
  ├─ Compras
  └─ Central de Entradas
Financeiro
  ├─ Financeiro
  └─ Gerenciar Caixas
Cadastros
  ├─ Clientes
  └─ Fornecedores
Fiscal
  └─ NFC-e Emitidas
Relatórios
  └─ Em breve (placeholder)
Administração
  ├─ Configurações
  ├─ Usuários
  ├─ Licença
  ├─ Auditoria
  ├─ Lab. Equipamentos
  ├─ Saúde da Central
  └─ Config. Avançadas
```

## Arquivos alterados / criados

| Arquivo | Ação |
|---|---|
| `frontend/erp/index.html` | Menu agrupado + renomes + ícones |
| `frontend/css/style.css` | Grupos, shell, sidebar collapsed, breakpoints |
| `frontend/shared/js/cds-page-shell.js` | **Novo** — cabeçalho + breadcrumb |
| `frontend/shared/js/core.js` | Visibilidade de grupos + toggle sidebar |
| `frontend/erp/js/vendas.js` | Shell + título Histórico |
| `frontend/erp/js/fiscal.js` | Shell + NFC-e Emitidas |
| `frontend/erp/js/central-diagnostico.js` | Título Saúde da Central |
| `frontend/erp/js/produtos.js` | Shell |
| `frontend/erp/js/compras.js` | Shell + ícone |
| `frontend/erp/js/clientes.js` | Shell |
| `frontend/erp/js/fornecedores.js` | Shell |
| `frontend/erp/js/caixa.js` | Shell |
| `frontend/erp/pages/financeiro.html` | Shell |
| `frontend/erp/pages/dashboard.html` | Classes de cabeçalho |

## Testes realizados (estáticos)

- Inventário de `data-page` no menu = conjunto anterior (menos alias Estoque).
- Nenhum `case` novo/removido em `app.js`.
- `PERMISSOES_PAGINAS` / `usuarioTemPermissao` não editados.
- Saúde da Central continua em `data-page="central-diagnostico"`.

## Screenshots

Captura manual recomendada após reload do ERP:

1. Menu expandido com grupos  
2. Menu recolhido (botão ângulos)  
3. Histórico de Vendas com shell  
4. Administração com Saúde da Central (perfil admin)  
5. Operador sem Saúde da Central / Config. Avançadas  

## Confirmação

**Zero alteração funcional.**  
Compatível com **Arquitetura Oficial CDS V1.0**.

## Parecer

**UX-A CONCLUÍDA**
