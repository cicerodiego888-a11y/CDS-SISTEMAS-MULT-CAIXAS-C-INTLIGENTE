# MIIP — Motor de Sinônimos (Synonym Engine)

> **MIIP V1.0 RC1** — Documentação congelada. Pipeline oficial com 6 motores. Ver [ARQUITETURA_MIIP.md](./ARQUITETURA_MIIP.md).


**Sprint 9 — Fase 2 Inteligência**  
**Status:** Implementado — aguardando aprovação formal

---

## 1. Objetivo

O **Motor Synonyms** enriquece um `SemanticProduct` com termos equivalentes conhecidos. Ele permite que palavras diferentes representem o mesmo conceito antes da futura etapa de Similaridade.

Esta sprint **não implementa similaridade, IA, identificação, banco, XML ou pipeline**.

---

## 2. Fluxo

```mermaid
flowchart TD
    A[SemanticProduct] --> B[MotorSynonyms.enriquecer]
    B --> C[SynonymDictionary]
    C --> D[config/synonyms/*.json]
    B --> E[SynonymMatch[]]
    E --> F[SemanticProduct enriquecido]
    E --> G[SynonymReport]

    F --> H[synonyms]
    F --> I[relatedTokens]
    F --> J[semanticAliases]
```

```
SemanticProduct
      ↓
MotorSynonyms
      ↓
SynonymDictionary
      ↓
SemanticProduct enriquecido + SynonymReport
```

---

## 3. Estrutura

| Componente | Responsabilidade |
|------------|------------------|
| `MotorSynonyms` | Orquestra o enriquecimento semântico |
| `SynonymDictionary` | Carrega os JSONs de sinônimos |
| `SynonymMatch` | Representa uma ocorrência encontrada |
| `SynonymReport` | Métricas do processamento |
| `config/synonyms/` | Dicionários por categoria |

---

## 4. Campos adicionados ao SemanticProduct

| Campo | Descrição |
|-------|-----------|
| `synonyms` | Lista de `SynonymMatch` encontrados |
| `relatedTokens` | Tokens equivalentes únicos |
| `semanticAliases` | Pares `ORIGINAL=SINONIMO` |

O motor **nunca altera** `original`, `canonico`, `tokens` ou atributos já extraídos.

---

## 5. Categorias

| Arquivo | Categoria |
|---------|-----------|
| `general.json` | Abreviações e equivalências gerais |
| `construction.json` | Construção civil |
| `electrical.json` | Elétrica |
| `hydraulic.json` | Hidráulica |
| `grocery.json` | Mercantil |
| `stationery.json` | Papelaria |
| `hardware.json` | Ferragens |

---

## 6. Exemplos

| Entrada semântica | Sinônimo encontrado | Categoria |
|-------------------|---------------------|-----------|
| `LAMP` | `LAMPADA` | general |
| `CX` | `CAIXA` | general |
| `FLOR` | `FLUORESCENTE` | electrical |
| `HALOG` | `HALOGENA` | electrical |
| `VERGALHAO` | `BARRA DE ACO` | construction |
| `CIMENTO CPII` | `CIMENTO CP II` | construction |
| `CANO` | `TUBO` | hydraulic |
| `BISCOITO` | `BOLACHA` | grocery |
| `PAPEL` | `FOLHA` | stationery |
| `GALVANIZADO` | `ZINCADO` | hardware |

### Exemplo de saída

```json
{
  "synonyms": [
    {
      "original": "FLOR",
      "sinonimo": "FLUORESCENTE",
      "categoria": "electrical",
      "confianca": 100,
      "origem": "electrical.json"
    }
  ],
  "relatedTokens": ["FLUORESCENTE"],
  "semanticAliases": ["FLOR=FLUORESCENTE"]
}
```

---

## 7. Limitações

| Limitação | Comportamento |
|-----------|---------------|
| Similaridade | Não calcula score entre produtos |
| IA | Não usa modelo externo |
| Banco/XML/ERP | Não consulta |
| Contexto avançado | Sinônimos são dicionário + tokens |
| Ambiguidade | Mantém equivalências, não decide produto |

---

## 8. Testes

```bash
npm run test:miip-synonyms
```

**77 casos** cobrindo:

- Geral
- Elétrica
- Construção
- Hidráulica
- Mercantil
- Papelaria
- Ferragens
- Estrutura, serialização e isolamento

---

## 9. Critérios de aceite

- [x] Recebe `SemanticProduct`
- [x] Retorna `SemanticProduct` enriquecido
- [x] Não altera `original`
- [x] Não altera `canonico`
- [x] Não identifica produtos
- [x] Não compara produtos
- [x] Não consulta banco/XML/GTIN
- [x] ≥ 50 testes

---

**Documento preparado para aprovação.**
