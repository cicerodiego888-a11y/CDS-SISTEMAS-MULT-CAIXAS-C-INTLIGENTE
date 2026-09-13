# engines/fornecedor/

Motor de identificação por **associação fornecedor** (CNPJ + cProd).

**Sprint 4:** implementado em `MotorAssociacaoFornecedor.js`.

## Responsabilidade

- Lookup em `miip_associacoes` via `MiipAssociacoesRepository`
- Carrega `ProdutoSnapshot` via `ProdutoRepository`
- Score 100 (produto ativo) ou 60 (produto inativo)
- Retorna `MiipCandidate[]` via `identificar()`

## Entrada

`ItemIdentificavelDTO.fornecedorCnpj` + `codigoFornecedor`

## Não utiliza

SQL direto, GTIN, nome, similaridade. Não cria nem altera associações.

## Integração

Registrado em `MiipBootstrap` com prioridade `20` (após GTIN `10`).

Documentação completa: [`docs/motores/miip/MIIP_MOTOR_FORNECEDOR.md`](../../../../docs/motores/miip/MIIP_MOTOR_FORNECEDOR.md).
