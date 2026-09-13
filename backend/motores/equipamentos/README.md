# Motor de Equipamentos — CDS Sistemas

Orquestra balanças e equipamentos de PDV/ERP via **drivers plugáveis**.

**Status (Sprint 13A):** Infraestrutura completa para homologação Toledo Prix 4 Uno. TCP real, fila persistente, laboratório e engenharia reversa operacionais. Protocolo oficial 90AX pendente (Sprint 14).

## Arquitetura

```
API REST (/api/equipamentos, /api/laboratorio-equipamentos, /api/engenharia-reversa)
        ↓
Controllers
        ↓
EquipamentosService / LaboratorioEquipamentos / EngenhariaReversaService
        ↓
EquipamentosManager → SyncManager → QueueManager (worker)
        ↓
DriverManager → DriverRegistry ← DriverLoader
        ↓
ToledoPrix4UnoDevice → Protocol → FrameBuilder → ConnectionManager → EthernetTransport
        ↓
PacketLogger → PacketHistory / Laboratório / Eng. Reversa
```

## Camadas

| Camada | Pasta | Função |
|--------|-------|--------|
| Core | `core/` | EquipamentosManager, DriverManager |
| Drivers | `drivers/` | Plugins por fabricante (Toledo implementado) |
| Services | `services/` | SyncManager, Config, Logger, Mappers |
| Events | `events/` | EventEmitter + persistência SQLite |
| Queue | `queue/` | Fila de comandos com retry e worker |
| Discovery | `discovery/` | Estrutura multi-transporte (implementação futura) |
| Diagnostics | `diagnostics/` | Diagnóstico DB/catalog |
| Monitor | `monitor/` | ConnectionMonitor + MonitorService |
| Repositories | `repositories/` | Persistência SQLite |
| Transport | `transport/` | Ethernet TCP real + stubs Serial/USB/BT/Mock |
| Communication | `communication/` | PacketLogger, PacketHistory, HexViewer |
| Laboratório | `laboratorio/` | FrameStudio, Capture, Replay, Comparator |
| Eng. Reversa | `engenharia-reversa/` | Captura, análise, documentação de protocolo |

## Bootstrap (Sprint 13A)

O `server.js` inicializa automaticamente após o banco:

```javascript
motorEquipamentos.inicializar();  // QueueManager worker
driverManager.obterRelatorioCarregamento();  // plugins Toledo
monitorService.iniciar();
```

## Fluxo operacional

1. Cadastro do equipamento no ERP (`equipamentos` table)
2. Resolução do driver via `DriverRegistry.buscar(codigo)`
3. `EquipamentosManager.conectar()` → `ConnectionManager` → `EthernetTransport`
4. Sync PLU: `SyncManager.sincronizarProduto()` → `QueueManager` → driver
5. Inspeção: Laboratório ou Engenharia Reversa via `PacketLogger`

## Driver Toledo Prix 4 Uno

| Componente | Status Sprint 13A |
|------------|-------------------|
| ToledoPrix4UnoDriver | TCP real, sync wired (formato temp 11A) |
| ToledoPrix4Protocol | connect/read/write/ping/handshake/status/sync |
| ToledoPrix4FrameBuilder | Frames temporários (STX/CMD/JSON/ETX) |
| ToledoPrix4Parser | ACK/NAK/STATUS/PESO (formato temp) |
| ToledoPrix4Mapper/Validator | Completo |
| ToledoPrix4Discovery/Diagnostics | Stub (homologação Sprint 14) |

## Testes

```bash
npm run test:equipamentos          # todas as suítes (158 testes)
npm run test:equipamentos-toledo-tcp
npm run test:equipamentos-laboratorio
npm run test:equipamentos-engenharia-reversa
```

## Documentação adicional

- [drivers/README.md](./drivers/README.md) — framework de plugins
- [transport/README.md](./transport/README.md) — camada TCP
- [communication/README.md](./communication/README.md) — PacketLogger
- [CHECKLIST_HOMOLOGACAO_TOLEDO.md](../../../CHECKLIST_HOMOLOGACAO_TOLEDO.md) — roteiro de homologação física
