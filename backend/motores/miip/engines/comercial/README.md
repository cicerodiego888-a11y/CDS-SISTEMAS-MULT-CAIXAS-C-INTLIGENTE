# engines/comercial/

Motor de identificação por **dados comerciais** (preço, unidade, margem).

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Correlacionar preço unitário e unidade de medida com produtos similares
- Desempate entre candidatos com score próximo
- Hint complementar — não identifica sozinho

## Entrada

`precoUnitario`, `unidade`, `fornecedorNome`

## Integração

Alinhado ao Motor Comercial do CDS — sem alterar regras de precificação.
