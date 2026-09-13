# RC14.14.1 — Consolidação da Camada de Conexão Oficial

## Objetivo

Uma porta, um ConnectionManager, um timeout, reconnect com handshake.

## Alterações principais

| Item | Detalhe |
|------|---------|
| Porta | `ToledoProtocol.PORTA_PADRAO = 9000` (fim do default 9100 em produção) |
| Timeouts | `ToledoTimeouts.js` — CONNECT/HANDSHAKE/READ/WRITE = 5000 |
| CM oficial | `connection/ConnectionManager` |
| Transport legado | Delega ao CM oficial (`CDS_LEGACY_TRANSPORT_SOCKET=1` só lab) |
| Reconnect | TCP + Handshake via `ToledoPrixIVDriver.reconnect` + rotas |
| Ownership | `CONNECTED_ALREADY` se pool já ativo |
| Diagnóstico | `etapas_conexao` (TCP → HS → Health → Driver) |
| Auditoria | `connection/ConnectionAudit.js` |

## Não alterado (fora de escopo)

Framing, checksum, parser, RX buffer, PLU/Peso/Config (lógica de negócio).

## Evidência de testes

```bash
npm run test:connection-unification   # 13/13
npm run test:connection-v1            # ok (CONNECTED_ALREADY no pool)
npm run test:connection-manager-v2
npm run test:certification-v2         # 10/10
npm run test:driver-toledo-v1         # 13/13
```

## Compatibilidade

- `transport/` permanece para lab/migração; em produção não abre socket.
- Discovery ainda pode **escanear** 9100/4001 como portas conhecidas; o **default de conexão/cadastro** é 9000.
- Filizola e outros drivers mantêm suas portas próprias.
