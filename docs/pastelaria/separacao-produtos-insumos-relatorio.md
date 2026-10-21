# Separação de produtos comerciais e insumos

## Diagnóstico inicial

- O schema atual da tabela `produtos` já incluía a coluna `tipo_operacional` em alguns pontos do repositório, mas o fluxo principal do ERP e do PDV ainda não a consumia.
- A rota de produtos (`backend/rotas/produtos.js`) realizava cadastro e listagem sem persistir nem filtrar por tipo operacional.
- O PDV (`frontend/pdv/js/pdv.js`) ainda considerava qualquer produto elegível para catálogo, inclusive itens de insumo.
- O backend de vendas (`backend/services/vendas/VendaPagamentoService.js`) validava estoque, pagamento e distribuição, mas não rejeitava insumos na etapa final da venda.
- O menu ERP (`frontend/erp/index.html`) não possuía a navegação exclusiva de Insumos.

## Arquivos alterados

- `backend/services/produtosTipoOperacional.js`
- `backend/rotas/produtos.js`
- `backend/services/vendas/VendaPagamentoService.js`
- `frontend/pdv/js/pdv.js`
- `frontend/erp/index.html`

## Correção aplicada

- Normalização explícita de `tipo_operacional` com suporte a valores legados e aliases (`COMERCIAL`, `INSUMO`, `PRODUTO`).
- Persistência do campo `tipo_operacional` no cadastro e edição de produtos.
- Listagem de produtos padrão filtrando `COMERCIAL` e permitindo consulta explícita de `INSUMO` em um canal dedicado.
- Rejeição da venda de itens com `tipo_operacional = 'INSUMO'` no backend, mesmo quando o payload é montado manualmente.
- Exclusão de insumos do catálogo do PDV.
- Inclusão do menu de navegação `Insumos` na ERp.

## Testes executados

- `node tests/produtos/produto-infra-01.test.js`
- `node tests/produtos/produto-infra-02.test.js`
- `node tests/fiscal/fechamento-fiscal-dia-sprint05.test.js`

Todos os comandos acima retornaram sucesso (exit code 0).

## Riscos residuais

- O repositório ainda possui módulos legados que usam `tipo` em vez de `tipo_operacional` em alguns pontos do código; a normalização foi adicionada para compatibilidade, mas a sincronização total do modelo pode exigir revisão mais ampla de telas e importadores.
- O menu Insumos foi criado como entrada funcional de navegação, mas a experiência de cadastro/edição completa pode ser refinada em uma etapa posterior, sem alterar o modelo de dados atual.

## Confirmação de integridade

- O banco oficial não foi alterado nesta etapa; a correção foi implementada no schema e no fluxo da aplicação sem migração massiva de dados.
- Nenhuma operação de produção, estoque, financeiro ou emissão fiscal foi executada como efeito colateral.
