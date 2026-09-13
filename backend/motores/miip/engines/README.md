# engines/

Motores plugáveis de identificação de produtos.

**Sprint 1.1:** estrutura definitiva por domínio (subpastas com README).

## Estrutura definitiva

| Pasta | Responsabilidade |
|-------|------------------|
| `gtin/` | Match exato GTIN/EAN |
| `fornecedor/` | Associação CNPJ + cProd |
| `normalizacao/` | Pré-processamento de itens |
| `sinonimos/` | Aliases e sinônimos |
| `similaridade/` | Similaridade textual |
| `historico/` | Histórico de compras do fornecedor |
| `estatistica/` | Padrões e pesos dinâmicos |
| `fiscal/` | Hints por NCM |
| `comercial/` | Hints por preço/unidade |
| `atributos/` | Extração de atributos do nome |

## Motores na raiz (legado)

| Arquivo | Destino futuro |
|---------|----------------|
| `MotorGTIN.js` | `gtin/MotorGTIN.js` |
| `MotorAssociacaoFornecedor.js` | `fornecedor/MotorAssociacaoFornecedor.js` |
| `MotorAprendizado.js` | `aprendizado/MotorAprendizado.js` (futuro) |

A migração para subpastas ocorrerá em sprint futura sem alterar contratos públicos.

## MotorGTIN (Sprint 3)

| Aspecto | Detalhe |
|---------|---------|
| Entrada | `codigoBarras` (GTIN/EAN) |
| Tabela | Somente `produtos.codigo_barras` |
| Não usa | Nome, fornecedor, tabelas MIIP |
| Saída | `MiipCandidate`, `MiipEvidence`, `MiipResult` |
| Telemetria | `MiipMetricsCollector` + `MiipMotorLogService` |

## MotorAssociacaoFornecedor (Sprint 4)

| Aspecto | Detalhe |
|---------|---------|
| Entrada | `fornecedorCnpj` + `codigoFornecedor` (cProd) |
| Tabela | Somente `miip_associacoes` |
| Não usa | Nome, GTIN, aprendizado |
| Encontrou | Confiança ALTA, score 100, `auto_vincular` |
| Não encontrou | Sem candidato |
| Telemetria | `MiipMetricsCollector` + `MiipMotorLogService` |

## MotorAprendizado (Sprint 6)

| Aspecto | Detalhe |
|---------|---------|
| Entrada | `confirmado: true` + `fornecedorCnpj` + `codigoFornecedor` + `produtoId` |
| Tabela | Grava em `miip_associacoes` (`origem: feedback`, `fonte: aprendizado`) |
| Não faz | Gravação automática, identificação, alteração de XML |
| Duplicata | Mesmo produto → idempotente; produto diferente → inativa anterior e cria nova |
| Telemetria | `MiipMetricsCollector.registrarAprendizado` + `MiipAprendizadoLogService` |
| Porta pública | `MiipService.registrarFeedback()` |

## Registro

Motores são registrados via `MotorRegistry` com metadados completos (`codigo`, `descricao`, `versao`, `prioridade`, `ativo`, `autor`, `dataCriacao`).

```javascript
MotorRegistry.registrar({
  codigo: 'motor_gtin',
  Classe: MotorGTIN,
  descricao: 'Identificação por GTIN/EAN',
  versao: '1.0.0',
  prioridade: 10,
  ativo: true,
  autor: 'CDS',
  meta: { config: { db } }
});
```

## Testes

```bash
npm run test:miip
```
