# Driver Toledo Prix 4 Uno

**Sprints 6–13A** — Driver oficial do Motor Equipamentos para homologação física.

| Atributo | Valor |
|----------|-------|
| Fabricante | Toledo |
| Modelo | Prix 4 Uno |
| Firmware alvo | 90AX |
| Comunicação | Ethernet TCP (porta 9100 / 4001) |
| Versão driver | 0.3.0-tcp |
| Status | **Infraestrutura pronta** — protocolo temp 11A; 90AX oficial na Sprint 14 |

## Arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `ToledoPrix4UnoDriver.js` | Plugin — estende `BaseDriver` |
| `ToledoPrix4Protocol.js` | TCP + comandos via FrameBuilder/Parser |
| `ToledoPrix4FrameBuilder.js` | Frames STX/CMD/SEP/JSON/ETX (temp 11A) |
| `ToledoPrix4Parser.js` | ACK, NAK, STATUS, PESO |
| `ToledoPrix4Validator.js` | Validação produto, promo, dept, etiqueta, peso |
| `ToledoPrix4Mapper.js` | DTO → payload Toledo |
| `ToledoPrix4Discovery.js` | Descoberta de rede (stub) |
| `ToledoPrix4Diagnostics.js` | Homologação (stub) |
| `ToledoPrix4Constants.js` | Comandos, timeouts, limites |
| `ToledoPrix4Errors.js` | Exceções tipadas |

## Arquitetura

```
ToledoPrix4UnoDriver (BaseDriver)
    │
    ├── ToledoPrix4Protocol    → ConnectionManager → EthernetTransport
    ├── ToledoPrix4FrameBuilder → frames temporários 11A
    ├── ToledoPrix4Parser      → interpretação de respostas
    ├── ToledoPrix4Validator   → validação de payloads
    ├── ToledoPrix4Mapper      → DTO → Toledo
    ├── ToledoPrix4Discovery   → varredura (stub — Sprint 14+)
    └── ToledoPrix4Diagnostics → relatório (stub — Sprint 14)
```

## Fluxo de sincronização

```
ProdutoDTO → Validator → Mapper → Protocol.enviarProduto()
  → FrameBuilder.buildProduto() → write(TCP) → read(TCP) → Parser → ACK/NAK
```

Pipeline completo via fila:

```
SyncManager → QueueManager → EquipamentosManager → Driver → Protocol
```

## Protocolo — Status Sprint 13A

| Operação | Método | Status |
|----------|--------|--------|
| Conectar/desconectar | `connect()` / `disconnect()` | TCP real |
| Handshake | `handshake()` | Wired (frame temp HS) |
| Ping | `ping()` | Wired (frame temp PN) |
| Status | `status()` | Wired (frame temp ST) |
| Enviar Produto | `enviarProduto()` | Wired (frame temp EP) |
| Atualizar Produto | `atualizarProduto()` | Wired (frame temp UP) |
| Remover Produto | `removerProduto()` | Wired (frame temp RP) |
| Promoção/Dept/Etiqueta/Lote | `enviar*()` | Wired (frames temp) |
| Receber Peso | `receberPeso()` | Wired (frame temp PW) |
| Heartbeat/Reconnect | `heartbeat()` / `reconnect()` | TCP real |
| Zerar/Reiniciar | `zerar()` / `reiniciar()` | Stub |
| Discovery | `descobrir()` | Stub |

**Nota:** Frames usam formato temporário documentado na Sprint 11A. Substituição por protocolo oficial 90AX ocorre na Sprint 14 após capturas MGV7.

Formato temporário: `[STX 0x02][CMD 2 ASCII][SEP 0x1C][JSON UTF-8][ETX 0x03]`

## Constantes

- **Porta padrão:** 9100 (alternativa: 4001)
- **Timeouts:** conexão 5s, handshake 5s, ping 2s, comando 3s, peso 1.5s
- **PLU máximo:** 999999 | **Descrição:** 22 chars | **Departamento:** 1–99

## Comunicação e inspeção

```
ToledoPrix4Protocol.read/write
        ↓
   PacketLogger (IP, porta, driver, firmware, bytes TX/RX, tempo, tentativa)
        ↓
   PacketHistory + Laboratório + Eng. Reversa
```

## Testes

```bash
npm run test:equipamentos-toledo-prix4
npm run test:equipamentos-toledo-tcp
npm run test:equipamentos-toledo-protocol
npm run test:equipamentos-drivers
```

## Homologação física

Ver [`CHECKLIST_HOMOLOGACAO_TOLEDO.md`](../../../../../CHECKLIST_HOMOLOGACAO_TOLEDO.md) na raiz do projeto.
