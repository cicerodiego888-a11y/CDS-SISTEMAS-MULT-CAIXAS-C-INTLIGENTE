# engines/historico/

Motor de identificação por **histórico de compras** do fornecedor.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Buscar itens já comprados do mesmo fornecedor (CNPJ)
- Correlacionar por nome, GTIN ou cProd em compras anteriores
- Score baseado em frequência e recência

## Entrada

`fornecedorCnpj` + `produtoNome` / `codigoBarras` / `codigoFornecedor`

## Tabelas

`compras`, `compras_itens`, `produtos`
