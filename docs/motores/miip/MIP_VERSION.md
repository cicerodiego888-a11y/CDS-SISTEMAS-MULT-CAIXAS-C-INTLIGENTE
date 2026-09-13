# MIP — Versão Oficial

| Campo | Valor |
|-------|-------|
| **Componente** | Motor Universal de Identificação de Produtos (MIP) |
| **Versão** | **1.0.0** |
| **Status** | **PRODUÇÃO** |
| **Data de homologação** | **19/07/2026** |
| **Feature flag** | `produto_identidade_enabled` (default **OFF**) |
| **Contrato arquitetural** | [ARQUITETURA_MOTOR_IDENTIFICACAO_PRODUTOS_V1.md](./ARQUITETURA_MOTOR_IDENTIFICACAO_PRODUTOS_V1.md) |
| **Changelog** | [CHANGELOG_MIP.md](./CHANGELOG_MIP.md) |
| **Performance** | [MIP_PERFORMANCE_V1.md](./MIP_PERFORMANCE_V1.md) |

## Escopo da V1.0.0 (homologado)

- Catálogo `produto_identificadores` + dual-write (`codigo`, `codigo_barras`, `plu`)
- `ProdutoIdentidadeService.resolve()` com Strategies: INTERNO, ID, EAN13, GTIN, PLU, ETIQUETA_BALANCA
- Layouts de etiqueta: Legado CDS 5+6, Toledo Prix 4 Valor 6+5, Toledo Prix 4 Peso
- Integrações: PDV, Compras, MIIP (GTIN), Central/XML (enriquecimento MIP), Cadastro ERP
- Observabilidade: métricas em memória, logs `[MIP]`, `meta.tempoMs`

## Fora do escopo V1 (capacidade futura apenas)

Marketplace · RFID · QR Code · GS1 DataBar · novos fabricantes de balança · novos identificadores.

Esses itens permanecem previstos na arquitetura e **não** fazem parte da V1.0.0.

## Ativação em produção

1. Homologar com flag **OFF** (zero mudança de comportamento).
2. Validar matriz: EAN, PLU, etiqueta legado, etiqueta Toledo, MIIP GTIN, Compras/XML.
3. Ativar `produto_identidade_enabled = true` por ambiente.
4. Rollback = gravar `false` / reiniciar (ou env `PRODUTO_IDENTIDADE_ENABLED=false`).

## Comandos de homologação

```powershell
npm run test:mip
npm run test:mip-benchmark
```

*Documento oficial de versão — Sprint 08 (2026-07-19).*
