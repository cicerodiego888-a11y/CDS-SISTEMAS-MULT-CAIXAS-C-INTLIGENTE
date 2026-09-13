# engines/gtin/

Motor de identificação por **GTIN/EAN** (código de barras).

**Sprint 3:** primeiro engine funcional — implementado em `MotorGTIN.js`.

## Responsabilidade

- Match exato em `produtos.codigo_barras`
- Produzir `MiipEvidence` tipo `gtin_exato`
- Score: **100** (produto ativo) ou **60** (inativo)
- Retorna `MiipCandidate[]` via `identificar()`

## Entrada

`ItemIdentificavelDTO.codigoBarras` — normalizado por `normalizarGtin()`.

## Não utiliza

Nome, fornecedor, similaridade, histórico, tabelas MIIP.

## Integração

Registrado em `MiipBootstrap` → `MotorRegistry` → executado pelo `MiipPipelineEngineRunner`.

**Sprint 3.1:** consulta produtos exclusivamente via `ProdutoRepository` → `ProdutoSnapshot`. Sem SQL no engine.

Documentação completa: [`docs/motores/miip/MIIP_MOTOR_GTIN.md`](../../../../docs/motores/miip/MIIP_MOTOR_GTIN.md).
