# Motor Similarity — Sprint 10

Compara dois `SemanticProduct` por atributos estruturados com votação ponderada.

- **Não** identifica produtos
- **Não** toma decisão ou cria associação
- **Não** acessa banco, XML ou ERP
- **Não** registrado no Pipeline

## Uso

```javascript
const MotorSimilarity = require('./MotorSimilarity');

const resultado = new MotorSimilarity().comparar(produtoA, produtoB);
console.log(resultado.score);
console.log(resultado.votes);
console.log(resultado.explicacao.texto);
```

## Configuração

`config/similarity-weights.json`

## Testes

```bash
npm run test:miip-similarity
```
