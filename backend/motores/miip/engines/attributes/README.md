# Motor Attribute Extractor — Sprint 8

Extrai atributos semânticos de `CanonicalProduct` → `SemanticProduct`.

- **Não** identifica produtos
- **Não** compara produtos
- **Não** acessa banco ou ERP
- **Não** registrado no Pipeline (Fase 2)

## Uso

```javascript
const MotorCanonical = require('../MotorCanonical');
const MotorAttributeExtractor = require('./MotorAttributeExtractor');

const canonical = new MotorCanonical().canonicalizar('Lamp. Flor. Philips 20W Cx C/10');
const { produto, relatorio } = new MotorAttributeExtractor().extrair(canonical);

console.log(produto.marca);       // PHILIPS
console.log(produto.potencia);      // 20W
console.log(relatorio.confiancaMedia);
```

## Configuração

`config/attribute-dictionaries/` — dicionários evolutivos sem alterar código.

## Testes

```bash
npm run test:miip-attribute
```
