# Arquitetura Oficial — Motor Universal de Equipamentos V1.0

**Versão:** V1.0 consolidada (RC14.14.1 + RC14.14.2 + RC14.14.3)  
**Driver canônico:** `TOLEDO_PRIX4_UNO` (Toledo Prix IV Uno)

## Diagrama final

```
ERP / Central / Cadastro / Discovery / Diagnóstico / Monitor
        │
        ▼
DriverIdentityResolver          ← aliases → TOLEDO_PRIX4_UNO
        │
        ▼
OfficialDriverLoader
        │
        ├─► SDK DriverRegistry (perfil toledo-prix4)
        └─► Plugin DriverRegistry (BaseDriver Discovery)
        │
        ▼
ToledoPrixIVDriver              ← runtime 90AX oficial
        │
        ▼
Operation Engine
        │
        ▼
ConnectionManager (oficial)
        │
        ▼
TcpConnection
        │
        ▼
ToledoFrameBuilder  ──TX──►  Socket TCP
        │
        ▼
ToledoRxBuffer  ◄──RX──  chunks TCP
        │
        ▼
ToledoFrameParser + Checksum
        │
        ▼
ToledoAckRouter (operationId)
        │
        ▼
Resultado
```

## Identidade

| Campo | Valor |
|-------|--------|
| Código ERP | `TOLEDO_PRIX4_UNO` |
| SDK id | `toledo-prix4` |
| Alias legado | `TOLEDO_PRIX4` |
| Porta padrão | `9000` |
| Framing | STX/CMD/SEP/payload/CHK/ETX |

## Referências

- `docs/build/rc14141-connection-unification.md`
- `docs/build/rc14142-protocol-unification.md`
- `docs/build/rc14143-driver-identity.md`
