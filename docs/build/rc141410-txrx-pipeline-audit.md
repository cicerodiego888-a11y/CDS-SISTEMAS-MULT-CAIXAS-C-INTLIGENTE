# RC14.14.10 — Auditoria do Pipeline TX/RX

## Objetivo

Descobrir exatamente onde a resposta da balança deixa de existir.

## Instrumentação (`TcpConnection`)

| Momento | Log |
|---------|-----|
| Antes de `socket.write()` | `TX BEFORE WRITE` — HEX, ASCII, bytes, host, porta |
| Após `write()` | `TX AFTER WRITE` — bytes efetivos, retorno do write |
| Eventos | `SOCKET connect/timeout/close/end/error/drain` + timestamp |
| `data` | `RX DATA` — HEX, ASCII, bytes, tempo desde TX |
| Sem RX | `Timeout aguardando RX` — tempo, último comando HEX/ASCII |

Módulo auxiliar: `backend/motores/equipamentos/connection/TxRxPipelineAudit.js`

## Correção null `.dados`

`ToledoPrix4Protocol.read` / `_executarComando` usam `_extrairBufferRx()` — nunca acessam `.dados` em `null`.

Mensagem oficial:

> Nenhuma resposta recebida da balança.

## Front-end

`centralEqProtoExec` / `centralEqProtoMostrarResultado`:

- não acessam propriedades de body nulo
- timeout/RX vazio → mensagem amigável

## Testes

```bash
npm run test:txrx-audit
```
