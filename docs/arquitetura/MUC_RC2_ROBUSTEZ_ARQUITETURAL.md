# MUC RC2 — Robustez Arquitetural do Motor Universal de Conversão

**Versão:** RC2.1  
**Status:** ARQUITETURA CONGELADA  
**Sprint:** MUC-26  

## Objetivo

Transformar o MUC em motor desacoplado, auditável, observável e preparado para evolução futura, **sem alterar o comportamento funcional do RC1**.

## Contrato público

Único contrato externo: `ResultadoConversaoDTO` (imutável).

Campos RC2 obrigatórios:

| Campo | Descrição |
|-------|-----------|
| `versaoMotor` | Versão do motor (RC2) |
| `versaoRegra` | Versão da regra aplicada |
| `origemDados` | Origem dos dados (API, COMPRA_ITEM, SIMULACAO…) |
| `tempoProcessamentoMs` | Tempo de execução do pipeline |
| `warnings` | Avisos não bloqueantes |
| `metadata` | Metadados da regra (id, data, motivo) |
| `hashConversao` | Hash SHA-256 truncado |
| `correlationId` | Rastreio ponta a ponta |

Compatibilidade RC1: campo `hash` permanece como alias de `hashConversao`.

## Pipeline oficial

```
Parser → Validação → Normalização → Inferência → Conversão → Auditoria → ResultadoConversaoDTO
```

| Etapa | Módulo |
|-------|--------|
| Parser | `MotorParser` |
| Validação | `MotorValidacao` |
| Normalização | `MotorNormalizacao` |
| Inferência | `MotorInferenciaEtapa` |
| Conversão | `MotorConversaoCalculo` |
| Auditoria | `MotorAuditoriaEtapa` |
| Orquestração | `PipelineMuc` |

## Eventos

Barramento interno (`BarramentoEventos`):

- `MUC_CONVERSAO_EXECUTADA`
- `MUC_CONVERSAO_CONFIRMADA`
- `MUC_CONVERSAO_MANUAL`
- `MUC_APRESENTACAO_APRENDIDA`
- `MUC_ERRO`
- `MUC_INFERENCIA_FALHOU`

## Observabilidade

`MucMetricas` registra conversões, tempos, confiança, agregações por fornecedor/GTI/tipo e exporta JSON/Markdown.

## Cache

`MotorCacheConversao` — serviço independente. O core permanece **stateless**.

## Certificação

```bash
node tests/muc/muc-rc1-certificacao.test.js   # compatibilidade funcional RC1
node tests/muc/muc-rc2-certificacao.test.js   # arquitetura RC2
```

## Integração

```javascript
const { obterMuc } = require('./motores/muc');
const muc = obterMuc(db);
const resultado = muc.converter(input, { correlationId, fornecedorCnpj, gtin });
```

Todos os módulos devem consumir exclusivamente `ResultadoConversaoDTO` — nunca objetos internos do pipeline.
