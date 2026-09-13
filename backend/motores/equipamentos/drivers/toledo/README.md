# Toledo — Drivers

## Prix 4 Uno

Pasta: `toledo/prix4/`

**Status (Sprint 13A):** Driver oficial com comunicação TCP real. Infraestrutura de protocolo completa (formato temporário 11A). Homologação física 90AX na Sprint 14.

| Classe | Responsabilidade | Status |
|--------|------------------|--------|
| `ToledoPrix4UnoDriver` | Plugin principal (BaseDriver) | TCP + sync wired |
| `ToledoPrix4Protocol` | Orquestração TCP + comandos | Implementado |
| `ToledoPrix4FrameBuilder` | Construção de frames (temp 11A) | Implementado |
| `ToledoPrix4Parser` | Parse ACK/NAK/STATUS/PESO | Implementado |
| `ToledoPrix4Validator` | Validação de payloads | Completo |
| `ToledoPrix4Mapper` | DTO → formato Toledo | Completo |
| `ToledoPrix4Discovery` | Descoberta na rede | Stub |
| `ToledoPrix4Diagnostics` | Diagnóstico/homologação | Stub |
| `ToledoPrix4Constants` | Constantes, timeouts, firmware 90AX | Completo |
| `ToledoPrix4Errors` | Hierarquia de exceções | Completo |

Documentação completa: [`prix4/README.md`](./prix4/README.md)
