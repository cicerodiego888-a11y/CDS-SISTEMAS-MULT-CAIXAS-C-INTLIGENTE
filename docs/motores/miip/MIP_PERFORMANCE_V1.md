# MIP V1 — Relatório de Performance e Profiling

| Campo | Valor |
|-------|-------|
| **Versão** | 1.0.0 |
| **Data** | 2026-07-19 |
| **Sprint** | 08 — Hardening / Homologação |
| **Ferramenta** | `npm run test:mip-benchmark` |

---

## 1. Fluxo perfilado

```text
Scanner / código
      ↓
ProdutoIdentidadeService.resolve()
      ↓
DetectorTipoCodigo (candidatos)
      ↓
Strategy (EAN13 | GTIN | PLU | INTERNO | ETIQUETA_BALANCA | …)
      ↓
ProdutoIdentidadeCatalogo (+ MipLookupCache)
      ↓
produto_identificadores / produtos
      ↓
IdentidadeResultadoDTO (+ meta.tempoMs)
```

---

## 2. Auditoria de consultas

| Ponto | Consulta | Observação |
|-------|----------|------------|
| Identificador tipado | `produto_identificadores` por `(tipo, codigo)` + índices únicos | Índices Sprint 01 |
| Fallback legado | `produtos.codigo` / `codigo_barras` | Compatibilidade |
| Listagem ERP | subquery PLU por produto | 1 subquery; sem N+1 de app |
| Cache | LRU 500 entradas no catálogo | Hit rate alto em bipagem repetida |

**Gargalos potenciais (mitigados na V1):**

1. Múltiplas strategies tentadas em sequência — ordenação por candidatos do detector reduz tentativas.
2. Lookups repetidos do mesmo EAN — cache LRU no catálogo.
3. Dual-write fire-and-forget — fora do caminho crítico de `resolve`.

---

## 3. Benchmark (Legado × MIP)

Execução de referência (Windows, SQLite em `%TEMP%`, 200 iterações, warmup 20) — `npm run test:mip-benchmark` em 2026-07-19:

| Fluxo | Média | Máx | p95 | Throughput |
|-------|-------|-----|-----|------------|
| **Legado** (`WHERE codigo_barras = ?`) | ~0,16 ms | ~1,4 ms | ~0,57 ms | ~6,2k ops/s |
| **MIP** (`resolve` + cache) | ~0,01 ms | ~0,46 ms | ~0,01 ms | ~112k ops/s |

- Razão média MIP/Legado ≈ **0,06×** (MIP mais rápido neste cenário graças ao **cache LRU**, hit rate ~0,99 após a 1ª resolução).
- Sem cache quente, o MIP permanece na ordem de milissegundos — adequado a PDV/scanner.

**Critério de aceite Sprint 08:** atendido (MIP viável; sem regressão catastrófica vs legado).

---

## 4. Memória

| Componente | Comportamento |
|------------|----------------|
| `MipMetrics` | Contadores em memória do processo (leve) |
| `MipLookupCache` | Máx. 500 entradas; sem TTL; `clear()` em testes |
| Strategies / layouts | Instanciados uma vez no registry |

Sem heap growth contínuo além do cache limitado.

---

## 5. Observabilidade

Cada `resolve()` registra:

- `meta.tempoMs`, `meta.flag`, `meta.flagEnabled`, `meta.origem`
- Métricas: resoluções, encontrados, EAN/PLU/GTIN/etiqueta, tempo médio/máx
- Logs: prefixo `[MIP]` via `mipLogger` (`MIP_DEBUG=1` para debug)

---

## 6. Conclusão

O MIP V1 está **homologado para produção** do ponto de vista de performance relativa ao legado, com cache e métricas suficientes para operação controlada via feature flag.

*Gerado na Sprint 08. Reexecutar benchmark após mudanças de índice ou volume de dados.*
