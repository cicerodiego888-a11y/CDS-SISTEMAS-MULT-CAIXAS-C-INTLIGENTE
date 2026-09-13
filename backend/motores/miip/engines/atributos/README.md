# engines/atributos/

Motor de identificação por **atributos extraídos** do item.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Extrair atributos estruturados (marca, volume, sabor, embalagem)
- Popular `MiipCandidate.atributosExtraidos`
- Combinar atributos com similaridade para ranking refinado

## Entrada

`ItemIdentificavelDTO.produtoNome` + metadados do XML

## Saída

Evidências tipo `atributo_extraido` em `MiipEvidence`
