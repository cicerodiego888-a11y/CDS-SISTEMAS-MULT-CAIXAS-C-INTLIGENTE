# MIIP — Motor de Similaridade Híbrida (Similarity Engine)

> **MIIP V1.0 RC1** — Documentação congelada. Pipeline oficial com 6 motores. Ver [ARQUITETURA_MIIP.md](./ARQUITETURA_MIIP.md).


**Sprint 10 — Fase 2 Inteligência**  
**Status:** Implementado — aguardando aprovação formal

---

## 1. Objetivo

O **Motor Similarity** compara dois `SemanticProduct` utilizando **atributos estruturados**. Ele nunca compara texto bruto (`original`, `canonico` ou `tokens`).

Esta sprint **não altera** ERP, XML, Pipeline, GTIN, Fornecedor ou Aprendizado. **Não toma decisão** nem cria associação.

---

## 2. Arquitetura

```mermaid
flowchart TD
    A[SemanticProduct A] --> C[MotorSimilarity.comparar]
    B[SemanticProduct B] --> C
    C --> D[SimilarityComparator]
    D --> E[SimilarityWeights]
    E --> F[config/similarity-weights.json]
    D --> G[SimilarityVote[]]
    G --> H[SimilarityResult]
    H --> I[score + confidence]
    H --> J[matchedAttributes / differentAttributes]
    H --> K[SimilarityExplanation]
    H --> L[SimilarityStatistics]
```

```
SemanticProduct A ──┐
                    ├── MotorSimilarity.comparar()
SemanticProduct B ──┘
                    ↓
            SimilarityComparator
                    ↓
         SimilarityWeights (JSON)
                    ↓
            SimilarityResult
```

### Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `engines/similarity/MotorSimilarity.js` | Motor plugável (`IMotorIdentificacao`) |
| `utils/SimilarityComparator.js` | Lógica de comparação e votação |
| `utils/SimilarityWeights.js` | Carrega pesos configuráveis |
| `core/SimilarityResult.js` | Resultado consolidado |
| `core/SimilarityVote.js` | Voto individual por atributo |
| `core/SimilarityExplanation.js` | Texto amigável |
| `core/SimilarityStatistics.js` | Métricas da comparação |
| `config/similarity-weights.json` | Pesos e thresholds de confiança |

---

## 3. Entrada e Saída

### Entrada

Dois `SemanticProduct` com atributos estruturados preenchidos (idealmente após Attribute Engine e Synonym Engine).

### Saída — `SimilarityResult`

| Campo | Descrição |
|-------|-----------|
| `score` | Similaridade global (0–100), média ponderada |
| `confidence` | `ALTA`, `MEDIA`, `BAIXA` ou `NENHUMA` |
| `matchedAttributes` | Atributos compatíveis |
| `differentAttributes` | Atributos divergentes |
| `votes` | Lista de `SimilarityVote` com motivo |
| `explicacao` | `SimilarityExplanation` em linguagem amigável |
| `estatisticas` | Contagens e tempo de processamento |

---

## 4. Votação

Cada atributo presente em **pelo menos um** dos produtos gera um voto. Se ambos forem `null`/vazio, o atributo é ignorado.

| Atributo | Peso |
|----------|------|
| Marca | 25 |
| Tipo | 20 |
| Tecnologia | 20 |
| Potência | 20 |
| Modelo | 15 |
| Unidade | 5 |
| Embalagem | 5 |
| Quantidade | 5 |
| Material | 5 |
| Cor | 5 |

### Regras de score por voto

| Situação | Score |
|----------|-------|
| Valores iguais (normalizados) | 100 |
| Equivalentes via sinônimos (`synonyms`, `relatedTokens`, `semanticAliases`) | 100 |
| Valores diferentes | 0 |
| Presente só em A ou só em B | 0 |

### Score global

```
score = round( Σ(peso × scoreVoto/100) / Σ(peso) × 100 )
```

---

## 5. SimilarityVote

Cada voto **deve** explicar o motivo:

```
Marca: PHILIPS = PHILIPS (100%)
Tipo: LAMPADA = LAMPADA (100%)
Potência: 20W = 20W (100%)
Potência: 20W diferente de 40W (0%)
Marca: presente em A (PHILIPS), ausente em B (0%)
```

---

## 6. SimilarityExplanation

Texto amigável gerado automaticamente:

```
Marca compatível.
Potência compatível.
Tecnologia compatível.
Tipo diferente.
```

---

## 7. Confiança

Configurável em `similarity-weights.json`:

| Nível | Threshold |
|-------|-----------|
| ALTA | score ≥ 85 |
| MEDIA | score ≥ 60 |
| BAIXA | score ≥ 30 |
| NENHUMA | score < 30 |

---

## 8. Exemplos

### Produtos idênticos

```javascript
const MotorSimilarity = require('./engines/MotorSimilarity');

const motor = new MotorSimilarity();
const resultado = motor.comparar(
  { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W', tecnologia: 'LED' },
  { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W', tecnologia: 'LED' }
);

// resultado.score === 100
// resultado.confidence === 'ALTA'
// resultado.explicacao.texto:
//   "Marca compatível.\nTipo compatível.\n..."
```

### Produtos parecidos (marca igual, potência diferente)

```javascript
const resultado = motor.comparar(
  { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
  { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '40W' }
);

// resultado.score ≈ 78 (marca+tipo ok, potência diferente)
// resultado.differentAttributes.includes('potencia')
```

### Equivalência via sinônimos

```javascript
const resultado = motor.comparar(
  { tipo: 'LAMP', semanticAliases: ['LAMP=LAMPADA'] },
  { tipo: 'LAMPADA' }
);

// voto tipo: score 100 — "Tipo: LAMP equivalente a LAMPADA (100%)"
```

---

## 9. Restrições

| Proibido | Motivo |
|----------|--------|
| Consultar banco / SQL | Motor puro de comparação |
| Consultar ERP / XML | Fora do escopo Sprint 10 |
| `identificar()` retornar candidatos | Não é motor de identificação |
| Criar associação / decisão | Responsabilidade do Orchestrator |
| Comparar texto bruto | Apenas atributos estruturados |

- **Não registrado** em `MiipBootstrap`
- `identificar()` → sempre `[]`
- `getPeso()` → `0`

---

## 10. Testes

```bash
npm run test:miip-similarity
```

| Categoria | Casos |
|-----------|-------|
| Infraestrutura (DTOs, pesos, motor) | 18 |
| Produtos idênticos (elétricos, construção, hidráulica, mercantil, ferragens) | 25 |
| Produtos parecidos | 5 |
| Produtos diferentes | 5 |
| Divergências por atributo (marca, potência, unidade, material, cor) | 10 |
| Sinônimos e normalização | 6 |
| Confiança, estatísticas, serialização | 16 |
| **Total** | **80+** |

---

## 11. Uso recomendado no pipeline futuro

```
CanonicalProduct
      ↓
Attribute Engine → SemanticProduct
      ↓
Synonym Engine → SemanticProduct enriquecido
      ↓
Similarity Engine → SimilarityResult (Sprint 10)
      ↓
Decision Engine (Sprint 11+)
```

---

**Documento preparado para aprovação da Sprint 10.**
