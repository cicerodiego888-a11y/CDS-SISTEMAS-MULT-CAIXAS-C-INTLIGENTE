# Comunicação — Motor Equipamentos (Sprint 10–13A)

Módulos de inspeção e histórico de pacotes TCP.

| Módulo | Responsabilidade |
|--------|------------------|
| `PacketLogger` | Registra bytes TX/RX com metadados enriquecidos (Sprint 13A) |
| `HexViewer` | Formata HEX, ASCII e tamanho |
| `PacketHistory` | Histórico em memória por chave de conexão |

## Campos registrados (Sprint 13A)

Cada entrada do `PacketLogger.log()` inclui:

| Campo | Descrição |
|-------|-----------|
| `timestamp` | ISO 8601 |
| `direcao` | TX ou RX |
| `ip` / `host` | Endereço do equipamento |
| `porta` | Porta TCP |
| `driver` | Código do driver (ex.: TOLEDO_PRIX4_UNO) |
| `firmware` | Versão firmware quando disponível (nullable) |
| `tempo_ms` | Duração da operação |
| `bytes_tx` | Bytes enviados (TX) |
| `bytes_rx` | Bytes recebidos (RX) |
| `tentativa` / `retry` | Número da tentativa |
| `comando` / `operacao` | Comando de protocolo |
| `ack` / `nak` / `timeout` | Flags de resultado |
| `hex` / `ascii` / `tamanho` | Payload formatado |

Compatibilidade retroativa: campos legados (`host`, `retry`, `tamanho`) preservados.

## Fluxo

```
ToledoPrix4Protocol.read/write
        ↓
   PacketLogger → PacketHistory
        ↓
   HexViewer (formatação)
        ↓
   Laboratório (PacketInspector) / Eng. Reversa (ProtocolCaptureService)
```

Limite de histórico: `EQUIPAMENTOS_PACKET_HISTORY_MAX` (padrão 500 por chave).

Comunicação real via `ConnectionManager` → `EthernetTransport`.
