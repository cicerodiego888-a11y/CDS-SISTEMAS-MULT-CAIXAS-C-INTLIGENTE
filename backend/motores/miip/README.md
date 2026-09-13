# MIIP — Motor Inteligente de Identificação de Produtos

**Versão:** `1.0.0-rc1` (Release Candidate)  
**Documentação:** [`docs/arquitetura/ARQUITETURA_MIIP.md`](../../../docs/arquitetura/ARQUITETURA_MIIP.md)  
**Release Notes:** [`docs/historico/relatorios/MIIP_RC1_RELEASE_NOTES.md`](../../../docs/historico/relatorios/MIIP_RC1_RELEASE_NOTES.md)

## Responsabilidade

Identificar qual produto interno do ERP corresponde a um item externo (XML, manual, API), com score, explicação e aprendizado por confirmação explícita.

**Entrada única:** `MiipService` — não chamar engines ou `DecisionEngine` diretamente.

## Pipeline RC1

```
Canonical (10) → Attribute (20) → Synonyms (30)
  → GTIN (40) → Fornecedor (50) → Similarity (60)
  → DecisionEngine + Explain → Persist → Telemetry
```

Registro: `MiipBootstrap.js` · Execução: `MiipPipelineEngineRunner.js`

## Estrutura

```
miip/
├── MiipService.js           # Fachada oficial
├── MiipOrchestrator.js
├── MiipBootstrap.js
├── core/                    # Pipeline, Decision, Explain
├── engines/                 # 6 motores RC1
├── services/                # Learning, Importação XML, Telemetry
├── repositories/            # SQLite (ver @deprecated em sinonimos/estatisticas)
├── contracts/
├── config/                  # JSON (rules, synonyms, weights…)
├── utils/
├── audit/                   # Validadores readiness
├── metrics/
├── logs/
└── cache/                   # ProdutoCache
```

## Integrações

| Consumidor | Como integra |
|------------|--------------|
| Compras | `MiipService`, `enriquecerParseComMiip` |
| Central Entradas | `enriquecerParseComMiip`, `miipCentralRevisaoUtils` (utils only) |
| API | `POST /api/miip/*`, `GET /api/miip/health` |

## Testes

```bash
npm run test:miip              # 17 suítes
npm run test:miip-readiness    # Validadores arquitetura
npm run test:miip-benchmark-rc1 # Benchmark oficial RC1
```

## Health

```bash
GET /api/miip/health
```

Retorna pipeline, engines carregados, Decision/Explain/Learning, banco e tempo médio (somente leitura).

## Repositórios deprecados (RC1)

- `MiipSinonimosRepository` — motor Synonyms usa JSON; reservado para evolução futura
- `MiipEstatisticasRepository` — não participa do runtime RC1; reservado para evolução futura
