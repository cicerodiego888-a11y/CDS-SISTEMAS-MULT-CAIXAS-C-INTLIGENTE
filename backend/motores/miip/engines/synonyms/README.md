# Motor Synonyms — Sprint 9

Enriquece `SemanticProduct` com sinônimos conhecidos.

- **Não** identifica produtos
- **Não** compara produtos
- **Não** acessa banco, XML ou ERP
- **Não** registrado no Pipeline

## Uso

```javascript
const MotorSynonyms = require('../MotorSynonyms');

const { produto, relatorio } = new MotorSynonyms().enriquecer(semanticProduct);
console.log(produto.synonyms);
console.log(produto.relatedTokens);
console.log(produto.semanticAliases);
```

## Configuração

`config/synonyms/` — dicionários por categoria.

## Testes

```bash
npm run test:miip-synonyms
```
