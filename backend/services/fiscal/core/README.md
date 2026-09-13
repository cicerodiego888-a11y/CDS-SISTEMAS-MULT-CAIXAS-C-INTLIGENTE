# Fiscal Core — Plataforma Fiscal RC1

Versão: **F10-autorizacao** · Consolidação: **RC1.1**

## Objetivo

Núcleo enterprise dos Web Services SEFAZ: Registry, UrlResolver, SoapTransport, enablement, métricas e logs padronizados.

## Operações

| Operação | Sprint | Runtime | Uso app |
|---|---|---|---|
| STATUS_SERVICO | F5 | `statusServico.js` | Infra (sem rota dedicada) |
| DISTRIBUICAO_DFE | F6 | `distribuicaoDfeRuntime.js` | Central Sync |
| MANIFESTACAO_* | F7 | `manifestacaoRuntime.js` | Infra |
| CONSULTA_PROTOCOLO | F8 | `consultaProtocoloRuntime.js` | Infra |
| CANCELAMENTO | F9 | `cancelamentoRuntime.js` | Produção |
| AUTORIZACAO | F10 | `autorizacaoRuntime.js` | Produção (emissor) |
| RETORNO_AUTORIZACAO | F10 | — | **Reservada** (enablement) |
| MANIFESTACAO (genérico) | F7 | subtipos | **Reservada** (guarda-chuva) |

## Matriz de confiança

| Operação | Status |
|---|---|
| Status Serviço | 🟢 RC (infra) |
| Distribuição DF-e | 🟢 RC |
| Manifestação | 🟢 RC (infra) |
| Consulta Protocolo | 🟢 RC (infra) |
| Cancelamento | 🟢 RC |
| Autorização NFC-e | 🟢 RC1 |
| Retorno Autorização | 🟡 Reservada |
| Inutilização | ⚪ Legado |

## Arquitetura

```
Runtime
  ↓
FiscalWebServices
  ↓
UrlResolver → Registry (24 contratos)
  ↓
TransportFactory → SoapTransport (retry + backoff exponencial)
  ↓
SEFAZ
  ↓ falha?
*Legado → (axios | soapClient) → SEFAZ
```

## Fallback

One-shot. O legado **nunca** reentra o runtime (sem loop).

## Logs / Métricas (RC1.1)

- Logs: `[FISCAL:<OPERACAO>] <ISO8601> | Campo: valor`
- Métricas: `FiscalRuntimeMetrics` (Resolver, Transport, XML, SOAP, Total, Warnings, Retry, Fallback, Sucesso, Erro)

## User-Agent

`CDGESTAO-FISCAL-PLATFORM/RC1`

## Testes

```bash
npm run test:fiscal
```

Documentação completa: [`docs/fiscal/FISCAL_PLATFORM.md`](../../../../docs/fiscal/FISCAL_PLATFORM.md)
