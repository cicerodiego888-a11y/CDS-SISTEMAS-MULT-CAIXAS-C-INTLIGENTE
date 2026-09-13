# Auditoria completa — Módulo Balança (conexão / TX / RX)

**Data:** 2026-08-05  
**Escopo:** Motor Universal de Equipamentos + Driver Toledo + Connection/Transport + telas ERP/Central  
**Ação:** somente leitura — **nenhuma alteração de código**  
**Foco:** inconsistências que podem afetar **conexão**, **transmissão (TX)** e **resposta (RX)**

---

## Veredito executivo

O caminho oficial da Central (`POST /driver/toledo/connect` → `ToledoPrixIVDriver` → `connection/ConnectionManager` → frames **com checksum**) é internamente coerente.

Porém o módulo ainda opera com **três stacks paralelos** (porta, socket, framing). Dependendo da tela/API usada, a balança pode:

- conectar na porta errada,
- abrir um segundo TCP enquanto outro já está ativo,
- enviar frame sem checksum para um firmware que exige CHK (ou o inverso),
- “reconectar” TCP sem handshake e falhar no próximo comando.

---

## Mapa de risco (resumo)

| Pri | Inconsistência | Impacto |
|-----|----------------|---------|
| **P0** | Porta padrão **9000 vs 9100** | Connect falha / OFFLINE falso |
| **P0** | Dois ConnectionManagers / dois sockets | Sessão “fantasma”; TX/RX no canal errado |
| **P0** | Framing **com CHK** vs **sem CHK** | Handshake timeout / NAK / parse corrompido |
| **P1** | Códigos `TOLEDO_PRIX4` / `TOLEDO_PRIX4_UNO` / `toledo-prix4` | Lookup/driver errado → stack errado |
| **P1** | Dois drivers vivos (`PrixIV` vs `Prix4Uno`) | Comportamento diferente por tela |
| **P1** | Comando fio `DP` com dois significados | PLU/departamento ambíguo |
| **P1** | RX por chunk TCP, não por frame STX…ETX | Timeout / checksum error intermitente |
| **P1** | Timeout connect **1s** vs **5s** | Falso OFFLINE em LAN lenta |
| **P1** | Reconnect TCP **sem** handshake | UI CONNECTED, comandos falham |
| **P2** | Adapter RC14.13.2 só lista; fallback código | Cadastro residual (não quebra socket direto) |

---

## 1. P0 — Quebram conexão / TX / RX

### P0-1. Porta padrão 9000 × 9100

| Origem | Default |
|--------|---------|
| `ToledoProtocol.PORTA_PADRAO`, Discovery Ethernet, Central (PLU/ops) | **9000** |
| Cadastro ERP (`eqPortaTcp`), `EquipamentosRepository`, `EquipamentosService`, `ToledoPrix4Constants` | **9100** |

**Como quebra:** Discovery encontra a balança em **9000**; cadastro/teste legado grava ou usa **9100** → `ECONNREFUSED` / timeout. Ou o contrário: DB com 9100 e painel Central assume 9000 quando o campo vem vazio.

**Arquivos-chave:**  
`drivers/toledo/ToledoProtocol.js` · `discovery/EthernetDiscovery.js` · `frontend/erp/js/equipamentos.js` (~806) · `frontend/erp/js/central-equipamentos.js` (inputs 9000) · `services/EquipamentosService.js` · `repositories/EquipamentosRepository.js`

---

### P0-2. Dois donos de socket (dois ConnectionManagers)

| Stack | Módulo | Quem usa |
|-------|--------|----------|
| **A — Oficial** | `connection/ConnectionManager` + `TcpConnection` (`net.Socket`) | `ToledoPrixIVDriver`, Operation Engine, ProtocolController, Central Conectar |
| **B — Legado** | `transport/ConnectionManager` + `EthernetTransport` (`net.createConnection`) | `ToledoPrix4Protocol` / `ToledoPrix4UnoDriver`, `EquipamentosService.testarConexao`, parte do monitor/lab |

**Como quebra:** Mesmo `host:porta` pode ter **duas sessões TCP**. Muitas balanças aceitam só um cliente → segunda conexão falha ou o ACK volta no socket “errado”. Disconnect/status numa API não fecha a outra.

---

### P0-3. Dois formatos de frame

| Path | Formato |
|------|--------|
| Oficial 90AX (`protocol/ToledoFrameBuilder`) | `[STX][CMD][SEP][payload][CHK 2 hex][ETX]` |
| Legado 11A (`prix4/ToledoPrix4FrameBuilder`) | `[STX][CMD][SEP][payload][ETX]` **sem CHK** |

**Como quebra:**

- TX sem CHK para firmware 90AX → NAK / silêncio → timeout de handshake.
- RX com CHK parseado pelo parser 11A → bytes de checksum entram no payload → JSON/comando inválido.

O profile SDK ainda aponta `driverModule: 'toledo/prix4/ToledoPrix4UnoDriver'` (path 11A), enquanto a Central usa `ToledoPrixIVDriver` (path CHK).

---

## 2. P1 — Quebras sob tráfego real / UI mista

### P1-1. Tríade de códigos de driver

| Camada | Código |
|--------|--------|
| Runtime / 90AX / fingerprint | `TOLEDO_PRIX4` |
| Catálogo / cadastro ERP / constants | `TOLEDO_PRIX4_UNO` |
| SDK id | `toledo-prix4` |

Sem `meta.catalogoLegado`, o Adapter gera `TOLEDO_PRIX4` (não `_UNO`). Lookups por `driver_codigo` podem carregar o módulo/stack errado.

### P1-2. Dois drivers para o mesmo equipamento

- Central Conectar → `ToledoPrixIVDriver` + CM connection + CHK  
- SDK / cadastro / teste legado → `ToledoPrix4UnoDriver` + CM transport + sem CHK  

Mesma balança, comportamentos diferentes conforme a tela.

### P1-3. Colisão de comando `DP`

- Oficial: `DOWNLOAD_PLU = 'DP'`
- Legado prix4: `ENVIAR_DEPARTAMENTO = 'DP'`
- Registry 90AX: também `uploadDepartment` em `'DP'`

TX com semântica errada → RX inesperado → timeout / PLU corrompido.

### P1-4. RX por chunk, não por frame

`TcpConnection.read()` devolve o próximo buffer da fila TCP, sem reassembling STX…ETX. Frame partido ou dois frames no mesmo chunk → `STX ausente` / `ETX ausente` / checksum inválido / ACK “roubado” pelo próximo comando.

### P1-5. Timeouts desalinhados

| | Oficial | Legado / UI |
|--|---------|-------------|
| Connect | **1000 ms** | **5000 ms** |
| Handshake | **2000 ms** | **5000 ms** |

LAN lenta / balança ocupada → falso OFFLINE no path oficial.

### P1-6. Reconectar sem handshake

Central “Reconectar” chama `/equipamentos/reconnect` (só TCP), **não** `/driver/toledo/connect`. Socket novo sem HS → UI pode mostrar CONNECTED; PLU/ping/peso falham.

### P1-7. TX/RX não atômicos

`send` pode voltar a IDLE antes do `receive` pareado; heartbeat/status/protocolo podem intercalhar e consumir o ACK do comando em andamento (fila de operações mitiga só o Operation Engine).

---

## 3. Cadeia oficial (referência saudável)

```text
Central “Conectar”
  → POST /api/equipamentos/driver/toledo/connect
    → ToledoPrixIVDriver.connect
        1. connection/ConnectionManager.connect → TcpConnection.open
        2. handshake (Toledo90AXEngine / HS + CHK)
        3. status CONNECTED + handshake:true
  → Ping / PLU / Peso / Config via Operation Engine (mesma CM)
```

Neste caminho: **não** abre `net` direto no driver; HS falho faz disconnect.

---

## 4. Matriz porta / timeout / código / framing

| Tema | Path oficial (Central / 90AX) | Path legado (prix4 / cadastro) |
|------|-------------------------------|--------------------------------|
| Porta | 9000 | 9100 |
| Connect timeout | 1000 ms | 5000 ms |
| Handshake | 2000 ms | 5000 ms |
| Código | TOLEDO_PRIX4 | TOLEDO_PRIX4_UNO |
| Framing | com CHK | sem CHK |
| Socket | connection/TcpConnection | transport/EthernetTransport |

---

## 5. O que está OK / baixo risco

- Path Central Conectar: ownership de socket claro; HS com rollback em falha.
- Algoritmo de checksum (XOR → 2 hex) consistente entre builder/parser oficiais.
- Heartbeat V2 verifica socket writable; **não** injeta PN de protocolo (baixo risco de roubar ACK de HS).
- OperationQueue serializa operações do Engine por `host:porta`.
- RC14.13.2 Adapter corrige o **combo** (`nome_exibicao` / `TOLEDO_PRIX4_UNO`); **não altera** socket/handshake/framing. Impacto em TX/RX é só indireto se `driver_codigo` errado for persistido.

---

## 6. Prioridade sugerida (orientação — sem implementar)

1. **Uma porta canônica** end-to-end (recomendação operacional hoje: **9000** para Prix IV / 90AX, alinhada ao Discovery).  
2. **Um ConnectionManager / um socket** por `host:porta` (descontinuar transport CM no path de produção).  
3. **Um framing com CHK** no path de produção; isolar 11A só para lab/legado.  
4. **Um código de driver** canônico em toda a cadeia.  
5. RX **frame-aware** (buffer até ETX).  
6. Reconnect = TCP + handshake (mesmo pipeline do Conectar).  
7. Resolver colisão `DP`.

---

## 7. Conclusão

As falhas de conexão/transmissão/resposta da balança, neste estágio, **não** se explicam por um bug isolado de “ping”, e sim por **divergência estrutural**: múltiplos defaults de porta, múltiplos donos de TCP e múltiplos formatos de frame convivendo no mesmo módulo.

Enquanto Discovery/Central usam o stack 9000+CHK e Cadastro/teste legado usam 9100+sem CHK, o sintoma típico será: *“às vezes conecta na Central, falha no cadastro”* ou *“conecta e não responde comando”* — conforme a porta e o path escolhidos.
