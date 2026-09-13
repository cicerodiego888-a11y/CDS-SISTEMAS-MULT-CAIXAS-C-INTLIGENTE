# engines/sinonimos/

Motor de identificação por **sinônimos e aliases** de produtos.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Lookup em `miip_sinonimos` (nome alternativo → produto)
- Aprendizado a partir de feedback do operador
- Score moderado — requer confirmação quando ambíguo

## Entrada

`ItemIdentificavelDTO.produtoNome` (normalizado)

## Repository

`MiipSinonimosRepository`
