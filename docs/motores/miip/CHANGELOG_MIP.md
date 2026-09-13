# Changelog — Motor de Identificação de Produtos (MIP)

Formato baseado em Keep a Changelog. Versões semânticas.

---

## [MIIP] — 2026-09-08 — Compatibility Guard

### Added
- `ProductCompatibilityGuard` — barreira comercial antes da similaridade
- `tiposCompostos` no dicionário (`PASSA FIO`, …) + tipos `FACA`, `TORNEIRA`, `MANGUEIRA`
- Diagnóstico `compatibilityDiagnostico` no pipeline (candidatos bloqueados)
- Docs: `MIIP_COMPATIBILITY_GUARD.md`
- Testes: `product-compatibility-guard`, `faca-passa-fio-compatibility`

### Changed
- Pipeline: MUBC → CompatibilityGuard → Similarity (incompatível é descartado, não score 0)
- AttributeParser: tipo composto/dicionário antes de inferência; componentes não roubam tipo
- Central de Revisão: mensagem sem candidatos compatíveis; comparação visual com Tipo/NCM

---

## [1.0.0] — 2026-07-19 — PRODUÇÃO

### Homologado (Sprint 08)

- Hardening: remoção de duplicação de `normalizarPlu`, imports mortos, logs padronizados `[MIP]`
- Observabilidade: `MipMetrics`, `mipLogger`, `meta.tempoMs` / `flag` / `origem` em `resolve()`
- Performance: cache LRU no catálogo (`MipLookupCache`); benchmark Legado × MIP
- Documentação: `MIP_VERSION.md`, este changelog, `MIP_PERFORMANCE_V1.md`; arquitetura atualizada para V1.0.0 PRODUÇÃO

### Entregue nas sprints 01–07 (consolidado na V1.0.0)

#### Added
- Tabela `produto_identificadores` + dual-write seguro
- Feature flag `produto_identidade_enabled` (default OFF)
- `ProdutoIdentidadeService.resolve()` + Detector + StrategyRegistry / Factory
- Strategies: INTERNO, ID, EAN13, GTIN, PLU, ETIQUETA_BALANCA
- Layouts: `legado_cds_valor_56`, `toledo_prix4_valor_65`, `toledo_prix4_peso`
- Integração MIIP (`ProdutoRepository.buscarPorGtin`)
- Integração PDV (`POST /produtos/identificar`)
- Cadastro: campo PLU + alias `produto_pesavel`
- Compras / XML / Central: `EntradasProdutoIdentificacaoService` + enriquecimento MIP

#### Compatibility
- Flag OFF = comportamento pré-MIP
- Colunas `produtos.codigo` / `codigo_barras` mantidas
- Layout default de etiqueta = legado CDS (PDV atual)

### Not included (futuro)
- Marketplace, RFID, QR, GS1 DataBar, novos layouts/fabricantes

---

## [Unreleased]

Reservado para V1.1+.

---

*Mantido a partir da Sprint 08. Histórico detalhado de implementação nas sprints 01–07 no repositório (`tests/produto-identidade/mip-sprint0*.test.js`).*
