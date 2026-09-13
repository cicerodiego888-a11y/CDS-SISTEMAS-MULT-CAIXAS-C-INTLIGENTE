# cache/

Camada de cache do MIIP.

**Sprint 3.1:** `ProdutoCache.js` criado — estrutura reservada, sem implementação ativa.

## Finalidade

Reduzir consultas repetidas ao `ProdutoRepository` durante identificações em lote
(parse XML, importação de compras, busca no PDV).

## ProdutoCache (Sprint 3.1)

| Responsabilidade futura | Status |
|-------------------------|--------|
| Armazenar `ProdutoSnapshot` por GTIN e ID | Estrutura criada |
| Invalidação após alteração de cadastro | Pendente |
| Integração transparente no `ProdutoRepository` | Pendente |

## Escopo futuro

| Tipo | Chave | TTL sugerido |
|------|-------|--------------|
| GTIN | `gtin:{ean}` | 5 min |
| Associação fornecedor | `assoc:{cnpj}:{cProd}` | 10 min |
| Resultado consolidado | `miip:{hashItem}` | 2 min |

## Princípios

- Cache local em memória (Node.js) na primeira versão
- `MiipResult.cacheHit` indica quando o resultado veio do cache
- Invalidação automática após feedback do operador ou alteração de produto
- Nenhuma dependência externa (Redis) na fase local-first

## Arquivos previstos

- `MiipCacheService.js` — get/set/invalidate
- `MiipCacheKeyBuilder.js` — geração determinística de chaves
