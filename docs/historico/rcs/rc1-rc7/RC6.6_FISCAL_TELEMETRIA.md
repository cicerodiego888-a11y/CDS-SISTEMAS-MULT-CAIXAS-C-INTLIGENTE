# RC6.6 — Telemetria Enterprise da Comunicação SEFAZ

## Objetivo

Adicionar telemetria completa à comunicação SOAP da Plataforma Fiscal **sem alterar regras de negócio**.

## O que NÃO muda

- Parser Oficial, MIIP, Central Inteligente (fluxo), Compras, `saveCompra()`
- UrlResolver, Registry, SOAP XML, banco de documentos, Máquina de Estados

## O que foi entregue

| Peça | Função |
|------|--------|
| `FiscalSoapTelemetry.js` | Ring buffer + eventos + log padronizado |
| `FiscalSoapTelemetryEvents.js` | `SOAP_INICIADO`, `SOAP_FINALIZADO`, `SOAP_FALHA`, `SOAP_TIMEOUT`, `SOAP_HTTP_ERROR`, `SOAP_CSTAT` |
| `FiscalSoapTelemetryConfig.js` | Flag `log_detalhado` / `CDS_FISCAL_AUDIT_SOAP` |
| Instrumentação em `SoapTransport` | Observe-only após cada `send` |
| `distribuicaoDfeRuntime` + `distribuicaoDFe` | CorrelationId/RequestId + enrich cStat/persistência |
| Painel Diagnóstico | Seção **Comunicação SOAP (RC6.6)** |

## Log padronizado (exemplo)

```
[FISCAL:DISTRIBUICAO_DFE] CorrelationId:
xxxxxxxx
[FISCAL:DISTRIBUICAO_DFE] RequestId:
xxxxxxxx
[FISCAL:DISTRIBUICAO_DFE] Endpoint:
https://www1.nfe.fazenda.gov.br/...
[FISCAL:DISTRIBUICAO_DFE] HTTP:
200
[FISCAL:DISTRIBUICAO_DFE] SOAP:
716 ms
[FISCAL:DISTRIBUICAO_DFE] Total:
784 ms
[FISCAL:DISTRIBUICAO_DFE] cStat:
138
[FISCAL:DISTRIBUICAO_DFE] ultNSU:
000000000000027
[FISCAL:DISTRIBUICAO_DFE] maxNSU:
000000000000027
[FISCAL:DISTRIBUICAO_DFE] docZip:
3
[FISCAL:DISTRIBUICAO_DFE] Persistidos:
3
[FISCAL:DISTRIBUICAO_DFE] Duplicados:
0
[FISCAL:DISTRIBUICAO_DFE] Resultado:
OK
```

## Modo auditoria (opcional)

- Normal: **não** armazena XML SOAP
- Auditoria: `log_detalhado=true` (Central) ou `CDS_FISCAL_AUDIT_SOAP=1`
  - Grava SOAP enviado/recebido **compactado (gzip+base64)** após sanitizar certificado/senha

## Testes

```bash
npm run test:fiscal-telemetria
```

Cobertura: HTTP 200, HTTP erro, timeout, cStat 138/137, TLS, certificado, modo auditoria, deferFinalize.

## Confirmação

**Zero alteração funcional** — apenas observabilidade.
