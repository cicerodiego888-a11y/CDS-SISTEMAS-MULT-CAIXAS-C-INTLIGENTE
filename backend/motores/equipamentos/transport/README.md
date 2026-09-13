# Camada de Transporte — Motor de Equipamentos

Infraestrutura reutilizável de comunicação entre **Drivers** e **Hardware**.

**Status (Sprint 13A):** `EthernetTransport` e `ConnectionManager` com TCP real em produção. Serial/USB/Bluetooth permanecem stubs estruturais.

## Sprint 8+ — TCP Real

| Componente | Status |
|------------|--------|
| `EthernetTransport` | TCP real via `net` (connect, write, read, ping, reconnect) |
| `ConnectionManager` | Reutilização, heartbeat, reconexão |
| `MockTransport` | Simulador para testes unitários |
| `MockTcpServer` | Testes de integração (tests/helpers) |

Configuração: `host`, `porta`, `timeout`, `tentativas`, `intervaloReconexao`, `heartbeatInterval`.

Variáveis de ambiente: `EQUIPAMENTOS_ETHERNET_TIMEOUT_MS`, `EQUIPAMENTOS_ETHERNET_MAX_RECONNECT`, `EQUIPAMENTOS_HEARTBEAT_MS`.

Aliases em inglês: `connect()`, `disconnect()`, `isConnected()`, `write()`, `read()`, `reconnect()`, `timeout()`.

Testes: `npm run test:equipamentos-tcp`

## Arquitetura

```
Motor Equipamentos
       ↓
    Driver          (protocolo do fabricante: Toledo, Filizola, etc.)
       ↓
   Transport        (como enviar/receber bytes: TCP, Serial, USB, BT)
       ↓
   Hardware         (balança, impressora, etc.)
```

O **Driver** conhece o protocolo (comandos, parsing). O **Transport** conhece apenas como abrir canal, enviar e receber dados brutos.

## BaseTransport

Classe abstrata que define o contrato de todo transporte:

| Método | Responsabilidade |
|--------|------------------|
| `conectar()` | Abre canal com o equipamento |
| `desconectar()` | Fecha canal |
| `enviar(dados)` | Envia buffer/string |
| `receber(opcoes)` | Lê resposta (com timeout) |
| `ping()` | Verifica se o canal está vivo |
| `status()` | Snapshot do estado |
| `reiniciar()` | Desconecta e reconecta |
| `configurar(config)` | Atualiza parâmetros |
| `tipo()` | Retorna identificador |

`EthernetTransport` com socket ativo retorna `{ comunicacao_real: true }`.

## TransportManager

Registro central de transportes built-in: `ethernet`, `serial`, `usb`, `bluetooth`, `mock`.

```javascript
transportManager.garantirCarregado();
const transport = transportManager.selecionar('ethernet', { host: '192.168.1.10', porta: 9100 });
await transport.conectar();
```

## Transportes built-in

| Código | Classe | Status |
|--------|--------|--------|
| `ethernet` | EthernetTransport | **TCP real** |
| `serial` | SerialTransport | Stub (Sprint futura) |
| `usb` | UsbTransport | Stub (Sprint futura) |
| `bluetooth` | BluetoothTransport | Stub (Sprint futura) |
| `mock` | MockTransport | Simulado — testes |

## Fluxo completo (Sprint 11A+)

```
SyncManager → QueueManager → EquipamentosManager.obterDriver()
  → ToledoPrix4Protocol.write/read
    → ConnectionManager → EthernetTransport (net.Socket)
    → PacketLogger (TX/RX)
```

## Logging

Conexões e pacotes registrados via `LoggerService.logTransporte()` e `PacketLogger`.

## Testes

```bash
npm run test:equipamentos-transport
npm run test:equipamentos-tcp
```

## Próximos passos

1. `ConnectionManager` selecionar transporte via `TransportManager` (multi-transporte)
2. `SerialTransport` com dependência `serialport` (Urano, Filizola)
3. Discovery Ethernet para localizar balanças na rede
