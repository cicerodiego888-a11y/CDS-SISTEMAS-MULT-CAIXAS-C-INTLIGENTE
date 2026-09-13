# engines/normalizacao/

Motor de **normalização e pré-processamento** de itens identificáveis.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Normalizar GTIN, CNPJ, cProd, nomes antes dos demais motores
- Enriquecer `ItemIdentificavelDTO` com campos derivados
- Não produz candidatos diretamente — alimenta outros engines

## Utilitários relacionados

`utils/normalizarGtin.js`, `utils/normalizarCnpj.js`, `utils/normalizarCodigoFornecedor.js`

## Peso sugerido

0.0 (motor auxiliar — não vota em candidatos)
