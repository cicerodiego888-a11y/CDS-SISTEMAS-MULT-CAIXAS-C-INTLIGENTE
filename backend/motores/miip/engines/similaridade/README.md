# engines/similaridade/

Motor de **similaridade textual** entre nomes de produtos.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Comparar `produtoNome` com `produtos.nome` (Levenshtein, token overlap)
- Retornar múltiplos candidatos com score parcial
- Nunca decisão automática isolada — sempre `sugerir` ou `revisar_manual`

## Entrada

`ItemIdentificavelDTO.produtoNome`

## Peso sugerido

0.6 — score máximo ~75
