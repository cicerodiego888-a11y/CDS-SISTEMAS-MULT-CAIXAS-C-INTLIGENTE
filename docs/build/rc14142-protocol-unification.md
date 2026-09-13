# RC14.14.2 — Consolidação do Protocolo Oficial Toledo (TX/RX)

## Objetivo

Um único pipeline de framing/checksum/RX/ACK para produção Toledo Prix IV Uno (90AX).

## Alterações principais

| Item | Detalhe |
|------|---------|
| Frame Builder oficial | `protocol/ToledoFrameBuilder.js` (CHK XOR) |
| Frame Parser oficial | `protocol/ToledoFrameParser.js` |
| Fachadas root | `ToledoFrameBuilder.js` / `ToledoFrameParser.js` delegam ao oficial |
| RX frame-aware | `protocol/ToledoRxBuffer.js` (chunk → STX…ETX → checksum) |
| ACK por operação | `protocol/ToledoAckRouter.js` + `OperationQueue` no engine |
| Comandos | `ToledoOfficialCommands.js` — **DP = downloadPlu**; departamento = **UD** |
| Legado 11A | `prix4/ToledoPrix4FrameBuilder` — lab apenas (sem CHK) |
| Auditoria | `protocol/ToledoProtocolAudit.js` |

## Pipeline

```
Connect → FrameBuilder → TX → RxBuffer → Parser → Checksum → ACK(operationId) → Result
```

## Não alterado

Discovery, ConnectionManager (infra RC14.14.1), Cadastro, Driver Adapter, regras de negócio de PLU/Peso/Config.

## Testes

```bash
npm run test:protocol-unification   # 20/20
```

Compat: `test:toledo-90ax-engine`, `test:driver-toledo-v1`, `test:connection-unification`, `test:engineering-lab-v2`.
