# Pipeline Oficial de Entrada de XML — NF-e

**Módulo compartilhado do ERP** — não pertence a Compras, Fiscal ou Central de Entradas.

## Fluxo

```
XML (string)
    ↓
NFeParserService.parse()
    ↓
xml2js.parseString
    ↓
NFeParser.parse()
    ↓
nfeXmlMapper.mapearInfNFe()
    ↓
NfeParseadaDTO.toJSON()
    ↓
(retorno ao chamador)
```

## Regras

- **Um único parser** para todo o sistema
- Sem persistência, MIIP, Compras ou saveCompra
- Saída compatível com `POST /api/compras/parse-xml`

## Uso

```javascript
const NFeParserService = require('../shared/nfe/NFeParserService');

const parsed = await NFeParserService.parse(xmlContent);
```

## Origens futuras (mesmo pipeline)

- Upload manual
- Distribuição DF-e
- Busca por chave
- Portal do Contador
- API / Marketplace / E-mail

## Estrutura

```
shared/nfe/
├── NFeParser.js
├── NFeParserService.js
├── contracts/
│   ├── NfeParseadaDTO.js
│   └── NfeItemParseadoDTO.js
├── mappers/
│   └── nfeXmlMapper.js
└── errors/
    └── NFeParserError.js
```
