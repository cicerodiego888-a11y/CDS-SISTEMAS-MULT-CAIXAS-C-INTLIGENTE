# Plataforma Fiscal CDS — FiscalWebServices

Arquitetura oficial · **Sprints F1–F10 / RC1** · Consolidação **RC1.1**

Versão runtime: `F10-autorizacao` · User-Agent: `CDGESTAO-FISCAL-PLATFORM/RC1`

## Objetivo

Plataforma fiscal extensível com migração gradual, fallback automático, métricas e logs padronizados.

| Sprint | Entrega |
|---|---|
| F1–F4 | Fundação / Registry / Resolver / Transport |
| F5 | Status Serviço |
| F6 | Distribuição DF-e |
| F7 | Manifestação (infraestrutura) |
| F8 | Consulta Protocolo |
| F9 | Cancelamento |
| F10 | Autorização NFC-e (RC1) |
| **RC1.1** | **Consolidação (docs, métricas, logs, backoff, enablement)** |

## Matriz de confiança

| Operação | Status | Wiring app |
|---|---|---|
| Status Serviço | 🟢 RC | Infra (sem rota) |
| Distribuição DF-e | 🟢 RC | Central Sync |
| Manifestação | 🟢 RC | Infra |
| Consulta Protocolo | 🟢 RC | Infra |
| Cancelamento | 🟢 RC | Produção |
| Autorização NFC-e | 🟢 RC1 | Produção (emissor) |
| Retorno Autorização | 🟡 Reservada | Enablement only |
| Inutilização | ⚪ Legado | — |

## Fluxograma geral

```
App (emissor / cancelarNfce / CentralSync)
        ↓
   *Runtime
        ↓
FiscalWebServices
  → Registry (24)
  → UrlResolver (override ON · cache/fallback OFF)
  → TransportFactory
  → SoapTransport (TLS 1.2 · timeout · retry + backoff exponencial)
        ↓
      SEFAZ
        ↓ falha?
   *Legado → axios | soapClient → SEFAZ
```

## Fluxograma — Autorização (F10)

```
Emissor (XML · Assinatura · Lote · QR · DANFE · Persistência)
  ↓
autorizacaoRuntime
  ↓
FiscalWebServices → Registry → Resolver → Transport → SEFAZ
  ↓ falha?
autorizacaoLegado → soapClient.enviarLote → SEFAZ
```

## OperationTypes / Enablement

Ativas no SoapTransport (`ENABLED_OPERATIONS`):

- STATUS_SERVICO, DISTRIBUICAO_DFE
- MANIFESTACAO, MANIFESTACAO_CIENCIA, MANIFESTACAO_CONFIRMACAO, MANIFESTACAO_DESCONHECIMENTO, MANIFESTACAO_NAO_REALIZADA
- CONSULTA_PROTOCOLO, CANCELAMENTO, AUTORIZACAO, RETORNO_AUTORIZACAO

**Reservadas** (`RESERVED_OPERATIONS`):

| Operação | Motivo |
|---|---|
| MANIFESTACAO | Guarda-chuva; runtime exige subtipo |
| RETORNO_AUTORIZACAO | Contrato no Registry; CDS usa `indSinc=1` (sem runtime dedicado) |

## Registry

- **24** definições oficiais (12 × PRODUCAO/HOMOLOGACAO)
- UF SVRS (maioria) · AN (DF-e)
- SOAPAction / Namespace centralizados em `RegistryBuilder`

## Resolver

- Resolução via REGISTRY
- Override explícito suportado
- Cache e fallback do resolver: **reservados (OFF)**
- Fallback operacional: nos runtimes

## Transport

- Enablement por operação
- Retry: `RetryPolicy` com **backoff exponencial** (3s → 6s → …, teto 30s)
- Em testes com `httpClient` injetado, backoff é ignorado (`skipBackoff`)
- Timeout por operação (`TimeoutPolicy`)
- TLS 1.2+
- User-Agent: `CDGESTAO-FISCAL-PLATFORM/RC1`

## Runtime / Fallback

| Runtime | Fallback |
|---|---|
| statusServico | statusServicoLegado (axios) |
| distribuicaoDfeRuntime | distribuicaoDfeLegado → soapClient |
| manifestacaoRuntime | manifestacaoLegado (axios) |
| consultaProtocoloRuntime | consultaProtocoloLegado (axios) |
| cancelamentoRuntime | cancelamentoLegado (axios) |
| autorizacaoRuntime | autorizacaoLegado → soapClient |

Fallback **one-shot** (sem loop).

## soapClient — classificação (RC1.1)

| Uso | Classificação | Arquivo |
|---|---|---|
| `autorizacaoLegado.enviarLote` | **Fallback** | autorizacaoLegado.js |
| `distribuicaoDfeLegado.enviarSoapDFe` | **Fallback** | distribuicaoDfeLegado.js |
| `distribuicaoDfeRuntime.montarSoapDFe` | **Utilitário** (envelope) | distribuicaoDfeRuntime.js |
| `emissor.montarLote` | **Utilitário** (lote) | emissor.js |
| `nfeDevolucaoCompra.enviarLote` | **Legado** (NF-e Compras, fora RC1 NFC-e) | nfeDevolucaoCompra.js |
| `CentralDiagnosticoService` | **Exceção temporária** (bypass diagnóstico) | CentralDiagnosticoService.js |

> **RC5:** Central Diagnóstico passou a usar `distribuicaoDfeRuntime` (Fiscal Platform). O bypass direto via `soapClient` foi eliminado.

## Métricas / Logs (RC1.1)

Campos obrigatórios de métricas: Resolver, Transport, XML, SOAP, Tempo Total, Warnings, Retry, Fallback, Sucesso, Erro.

Resultado de runtime inclui: Namespace, Endpoint, Versão, OperationType, Ambiente, Modelo.

Logs: `[FISCAL:<OPERACAO>] <ISO8601> | Campo: valor`

## Testes

```bash
npm run test:fiscal
```

Suite unificada: platform, registry, resolver, transport, status, dfe, manifestação, consulta, cancelamento, autorização.

## Referências

- `backend/services/fiscal/core/`
- `backend/services/fiscal/*Runtime.js` / `statusServico.js`
- `backend/services/fiscal/emissor.js`
- `backend/services/fiscal/cancelarNfce.js`
