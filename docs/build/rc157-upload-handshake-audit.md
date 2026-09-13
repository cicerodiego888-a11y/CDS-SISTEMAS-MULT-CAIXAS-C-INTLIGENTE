# RC15.7 — Auditoria do Handshake no Upload PLU

## Objetivo

Identificar se o Upload PLU executa handshake desnecessário antes do envio — **somente auditoria**, sem alterar comportamento.

## Sequência instrumentada

```
CONNECT → HANDSHAKE → UPLOAD → ACK → FIM
```

## Log

```
===== UPLOAD PIPELINE =====
CONNECT.............OK
HANDSHAKE...........EXECUTADO
UPLOAD..............NÃO EXECUTADO
Motivo:
Timeout aguardando resposta de handshake
Handshake solicitado por:
• OperationEngine
• Driver
requireHandshakeBeforeUpload=(não configurado)
==============================
```

## Quem pode solicitar handshake

| Solicitante | Momento típico |
|-------------|----------------|
| OperationEngine | `_ensureDriver` → `driver.connect` |
| Driver | `ToledoPrixIVDriver.connect` → `handshake()` |
| ConnectionManager | só TCP (não faz handshake PLU) |
| UploadPluOperation | **não** solicita handshake — só envia PLU |

## Config

Se existir `requireHandshakeBeforeUpload` (opções / env / capabilities), o valor é registrado no log.

## Teste

```
npm run test:upload-handshake-audit
```
