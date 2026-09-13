# Motor Canonical — Sprint 7.1

Padroniza descrições textuais em `CanonicalProduct` com tokens tipados.

- **Não** identifica produtos
- **Não** acessa banco ou ERP
- **Não** registrado no Pipeline de identificação (Fase 2)

## Componentes

| Módulo | Função |
|--------|--------|
| `DecimalNormalizer` | `1,5 LT` → `1.5L` |
| `MeasurementTokenizer` | Preserva `20W`, `3/8`, `5X80` |
| `CanonicalToken` | Token com tipo semântico |
| `CanonicalStatistics` | Métricas de processamento |

## Configuração

`config/canonical/` — `abbreviations.json`, `units.json`, `measurements.json`, `stopwords.json`, `brands.json`

## Uso

```javascript
const MotorCanonical = require('./MotorCanonical');
const motor = new MotorCanonical();
const canonical = motor.canonicalizar('Lamp. Flor. 20W Philips');

canonical.normalizedTokens.forEach((t) => {
  console.log(t.textoCanonico, t.tipo);
});
```

## Testes

```bash
npm run test:miip-canonical
```
