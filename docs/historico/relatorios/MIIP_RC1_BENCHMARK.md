# MIIP V1.0 RC1 — Benchmark Oficial

**Gerado em:** 2026-07-06T02:46:51.505Z
**Versão:** 1.0.0-rc1
**Método:** `MiipService.identificar()` sequencial por item

## Resumo

| Itens | Tempo total (ms) | Pipeline/item (ms) | Motores/item (ms) | Pós-motores/item (ms) | Throughput (it/s) | Δ Heap (MB) |
|------:|-----------------:|-------------------:|------------------:|----------------------:|------------------:|------------:|
| 10 | 422 | 9 | 3 | 6 | 23.7 | 5 |
| 50 | 296 | 5 | 1 | 4 | 168.92 | -2 |
| 100 | 617 | 5 | 1 | 4 | 162.07 | 4 |
| 200 | 1200 | 5 | 1 | 4 | 166.67 | -4 |

> **Nota RC1:** Decision Engine e Explain não possuem instrumentação dedicada.
> O tempo **pós-motores** agrega decisão, explicação, persistência e overhead do pipeline.

## Detalhes por cenário

### 10 itens

- **Tempo total:** 422 ms
- **Pipeline (telemetria/item):** 9 ms
- **Motores (telemetria/item):** 3 ms
- **Pós-motores — decision + explain + persist (item):** 6 ms
- **Memória RSS:** 46 MB (Δ heap 5 MB)
- **Motores executados:** motor_associacao_fornecedor, motor_attribute_extractor, motor_canonical, motor_gtin, motor_similarity, motor_synonyms
- **Tempo médio por engine (ms):**
  - `motor_canonical`: 1 ms
  - `motor_attribute_extractor`: 1 ms
  - `motor_synonyms`: 1 ms
  - `motor_gtin`: 1 ms
  - `motor_associacao_fornecedor`: 0 ms
  - `motor_similarity`: 0 ms

### 50 itens

- **Tempo total:** 296 ms
- **Pipeline (telemetria/item):** 5 ms
- **Motores (telemetria/item):** 1 ms
- **Pós-motores — decision + explain + persist (item):** 4 ms
- **Memória RSS:** 50 MB (Δ heap -2 MB)
- **Motores executados:** motor_associacao_fornecedor, motor_attribute_extractor, motor_canonical, motor_gtin, motor_similarity, motor_synonyms
- **Tempo médio por engine (ms):**
  - `motor_canonical`: 0 ms
  - `motor_attribute_extractor`: 0 ms
  - `motor_synonyms`: 0 ms
  - `motor_gtin`: 0 ms
  - `motor_associacao_fornecedor`: 0 ms
  - `motor_similarity`: 0 ms

### 100 itens

- **Tempo total:** 617 ms
- **Pipeline (telemetria/item):** 5 ms
- **Motores (telemetria/item):** 1 ms
- **Pós-motores — decision + explain + persist (item):** 4 ms
- **Memória RSS:** 60 MB (Δ heap 4 MB)
- **Motores executados:** motor_associacao_fornecedor, motor_attribute_extractor, motor_canonical, motor_gtin, motor_similarity, motor_synonyms
- **Tempo médio por engine (ms):**
  - `motor_canonical`: 0 ms
  - `motor_attribute_extractor`: 0 ms
  - `motor_synonyms`: 0 ms
  - `motor_gtin`: 0 ms
  - `motor_associacao_fornecedor`: 0 ms
  - `motor_similarity`: 0 ms

### 200 itens

- **Tempo total:** 1200 ms
- **Pipeline (telemetria/item):** 5 ms
- **Motores (telemetria/item):** 1 ms
- **Pós-motores — decision + explain + persist (item):** 4 ms
- **Memória RSS:** 80 MB (Δ heap -4 MB)
- **Motores executados:** motor_associacao_fornecedor, motor_attribute_extractor, motor_canonical, motor_gtin, motor_similarity, motor_synonyms
- **Tempo médio por engine (ms):**
  - `motor_canonical`: 0 ms
  - `motor_attribute_extractor`: 0 ms
  - `motor_synonyms`: 0 ms
  - `motor_gtin`: 0 ms
  - `motor_associacao_fornecedor`: 0 ms
  - `motor_similarity`: 0 ms

---
*Benchmark RC1 — não altera comportamento funcional do MIIP.*
