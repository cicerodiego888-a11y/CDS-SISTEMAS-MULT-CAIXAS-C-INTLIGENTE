# AUDITORIA TÉCNICA COMPLETA — MOTOR DE BALANÇAS CDS SISTEMAS

**Data:** 01/07/2026  
**Versão do projeto:** cds-sistemas 1.0.3  
**Escopo:** Análise somente leitura — nenhum código foi alterado  
**Módulo auditado:** `backend/motores/equipamentos/` (Motor de Equipamentos)

---

## Resumo Executivo

O CDS Sistemas **não possui um diretório `motor-balancas`**. O Motor de Balanças está implementado como **Motor de Equipamentos** em `backend/motores/equipamentos/`, seguindo arquitetura de plugins desacoplada, espelhando o padrão do módulo TEF.

### Situação geral

| Camada | Maturidade | Percentual estimado |
|--------|------------|---------------------|
| Infraestrutura (framework, DB, API, UI) | Alta | ~85% |
| Comunicação TCP (transporte) | Alta | ~90% |
| Protocolo Toledo Prix 4 (comandos/sync) | Baixa | ~10% |
| Integração ERP → Balança (sync real) | Muito baixa | ~15% |
| PDV peso ao vivo | Ausente | 0% |
| Drivers alternativos (Filizola, Urano, etc.) | Ausente | 0% |

### Conclusão principal

O projeto possui um **esqueleto arquitetural sólido e bem desacoplado**, concluído até a Sprint 10 (comunicação TCP real). O que falta para operação em produção é predominantemente:

1. **Protocolo Toledo 90AX** — frame builder, handshake, comandos de sync, parser de peso
2. **Worker da fila** — consumir `equipamentos_fila` e despachar ao driver
3. **Orquestração** — `EquipamentosManager.obterDriver()` e bootstrap do motor
4. **Hooks ERP** — disparar sync ao salvar produto/promoção
5. **PDV** — `obterPeso()` em tempo real

A arquitetura **permite adicionar novos fabricantes sem modificar o Core**, desde que sigam o contrato `BaseDriver` + DTOs.

---

## 1. Estrutura do Projeto

### 1.1 Mapeamento solicitado vs. real

| Área solicitada | Localização real | Status |
|-----------------|------------------|--------|
| `motor-balancas` | `backend/motores/equipamentos/` | Nome diferente; funcionalidade equivalente |
| `drivers` | `motores/equipamentos/drivers/` | Implementado |
| `protocols` | Dentro de cada driver (`drivers/toledo/prix4/ToledoPrix4Protocol.js`) | Parcial |
| `transportes` | `motores/equipamentos/transport/` | Implementado |
| `discovery` | `motores/equipamentos/discovery/` | Stub |
| `queue` | `motores/equipamentos/queue/` | Parcial |
| `monitor` | `motores/equipamentos/monitor/` | Parcial |
| `connection` | `transport/ConnectionManager.js` + `monitor/ConnectionMonitor.js` | Implementado |
| `services` | `motores/equipamentos/services/` | Parcial |
| `models` | `contracts/` + `dto/` (sem ORM) | Implementado |
| `repositories` | `motores/equipamentos/repositories/` | Implementado |
| `logs` | `services/LoggerService.js` + `communication/` + tabela `equipamentos_logs` | Implementado |
| `ui` | `frontend/erp/js/equipamentos.js` | Implementado |
| `routes` | `backend/rotas/equipamentos.js` | Implementado |
| `controllers` | `backend/controllers/equipamentosController.js` | Implementado |

### 1.2 Árvore completa do módulo

```
backend/motores/equipamentos/
├── index.js                          # Fachada pública (parcial)
├── README.md
├── core/
│   ├── EquipamentosManager.js        # Orquestrador central (stub)
│   └── DriverManager.js              # Fachada Registry + Loader (completo)
├── drivers/
│   ├── BaseDriver.js                 # 20 métodos obrigatórios (completo)
│   ├── DriverRegistry.js             # Registro em memória (completo)
│   ├── DriverLoader.js               # Auto-load do catálogo (completo)
│   ├── driverCatalog.js              # 6 drivers declarados (completo)
│   ├── README.md
│   ├── toledo/
│   │   ├── README.md
│   │   └── prix4/                    # Único driver com código
│   │       ├── ToledoPrix4UnoDriver.js
│   │       ├── ToledoPrix4Protocol.js
│   │       ├── ToledoPrix4Parser.js
│   │       ├── ToledoPrix4Mapper.js
│   │       ├── ToledoPrix4Validator.js
│   │       ├── ToledoPrix4Discovery.js
│   │       ├── ToledoPrix4Diagnostics.js
│   │       ├── ToledoPrix4Constants.js
│   │       ├── ToledoPrix4Errors.js
│   │       └── README.md
│   ├── filizola/README.md            # Placeholder
│   ├── urano/README.md               # Placeholder
│   ├── aclas/README.md               # Placeholder
│   ├── elgin/README.md               # Placeholder
│   └── bematech/README.md            # Placeholder
├── contracts/                        # DTOs oficiais + validators (completo)
│   ├── ProdutoDTO.js, PromocaoDTO.js, DepartamentoDTO.js, EtiquetaDTO.js
│   ├── PesoDTO.js, StatusDTO.js, DiagnosticoDTO.js, EquipamentoDTO.js
│   ├── *Validator.js, *Normalizer.js
│   ├── Serializer.js, ResponseFactory.js, validationResult.js
│   └── index.js
├── dto/                              # Re-exports de compatibilidade (legado)
├── services/
│   ├── EquipamentosService.js        # CRUD + teste TCP (completo)
│   ├── SyncManager.js                # Enfileiramento (parcial)
│   ├── LoggerService.js              # Logs persistidos (completo)
│   ├── ConfigService.js              # Config motor (parcial)
│   └── *Mapper.js                    # ERP → DTO (completo)
├── repositories/
│   └── EquipamentosRepository.js     # SQLite CRUD (completo)
├── transport/
│   ├── BaseTransport.js              # Contrato abstrato (completo)
│   ├── EthernetTransport.js          # TCP real net.Socket (completo)
│   ├── ConnectionManager.js          # Pool + heartbeat + reconnect (completo)
│   ├── TransportManager.js           # Registro de transportes (completo)
│   ├── MockTransport.js              # Testes (completo)
│   ├── SerialTransport.js            # Stub
│   ├── UsbTransport.js               # Stub
│   └── BluetoothTransport.js         # Stub
├── discovery/
│   └── DiscoveryService.js           # Stub (todos retornam [])
├── queue/
│   └── QueueManager.js               # Enfileirar OK; worker stub
├── monitor/
│   ├── ConnectionMonitor.js          # Status TCP (completo)
│   └── MonitorService.js             # Polling periódico (stub)
├── communication/
│   ├── PacketLogger.js               # TX/RX com hex (completo)
│   ├── PacketHistory.js              # Ring buffer 500/chave (completo)
│   └── HexViewer.js                  # Formatação hex+ASCII (completo)
├── diagnostics/
│   └── DiagnosticoService.js         # Diagnóstico motor (parcial)
├── events/
│   └── EquipamentosEvents.js         # EventEmitter (completo)
└── utils/
    └── index.js

backend/controllers/equipamentosController.js
backend/rotas/equipamentos.js
frontend/erp/js/equipamentos.js
tests/motor-equipamentos/             # 8 suites + 1 helper
```

### 1.3 Módulos relacionados fora do motor

| Módulo | Caminho | Relação com balanças |
|--------|---------|----------------------|
| Motor Conversão Unidades | `backend/lib/motorConversaoUnidades.js` | Produtos fracionados/KG no PDV — reutilizável |
| PDV etiqueta balança | `frontend/pdv/js/pdv.js` | Parse EAN-13 tipo 2 — independente do motor |
| Dashboard | `backend/rotas/dashboard.js` | Widget resumo equipamentos |

---

## 2. Driver Toledo — Auditoria Detalhada

### 2.1 Matriz de implementação

| Componente | Arquivo | Status | Detalhe |
|------------|---------|--------|---------|
| **ToledoPrix4UnoDriver** | `ToledoPrix4UnoDriver.js` | **PARCIAL** | `conectar/desconectar/configurar` = TCP real; sync/peso = `_stub()` |
| **ToledoPrix4Protocol** | `ToledoPrix4Protocol.js` | **PARCIAL** | I/O TCP completo; comandos Toledo = stub Sprint 11+ |
| **Discovery (Toledo)** | `ToledoPrix4Discovery.js` | **STUB** | `descobrir()` retorna `[]` |
| **Discovery (global)** | `DiscoveryService.js` | **STUB** | Todos os transportes retornam `[]` |
| **ConnectionManager** | `ConnectionManager.js` | **IMPLEMENTADO** | Pool, heartbeat timer, reconnect |
| **ConnectionMonitor** | `ConnectionMonitor.js` | **IMPLEMENTADO** | Wrapper de status por chave |
| **MonitorService** | `MonitorService.js` | **STUB** | `iniciar()` e `_executarCiclo()` vazios |
| **Heartbeat** | Protocol + ConnectionManager | **IMPLEMENTADO** | TCP-level ping; não é heartbeat protocolo Toledo |
| **Reconexão** | EthernetTransport + ConnectionManager | **IMPLEMENTADO** | Auto-reconnect com tentativas configuráveis |
| **Timeout** | EthernetTransport + Protocol | **IMPLEMENTADO** | Default 5000ms, configurável por equipamento |
| **Queue** | `QueueManager.js` | **PARCIAL** | Enfileirar OK; worker não implementado |
| **PacketHistory** | `PacketHistory.js` | **IMPLEMENTADO** | Buffer em memória, max 500 registros/chave |
| **HexViewer** | `HexViewer.js` | **IMPLEMENTADO** | Formatação hex + ASCII |
| **Parser** | `ToledoPrix4Parser.js` | **STUB** | Todos os `parse*` retornam null/simulado |
| **Frame Builder** | — | **NÃO EXISTE** | Nenhum arquivo; sem construção de frames 90AX |
| **Handshake** | `Protocol.handshake()` | **STUB** | Retorna `_stub('HANDSHAKE')` |
| **Protocol 90AX** | `ToledoPrix4Constants.js` | **PARCIAL** | Constante `FIRMWARE_CONHECIDO = ['90AX']`; sem lógica |
| **TCP** | `EthernetTransport.js` | **IMPLEMENTADO** | `net.Socket` real, read/write/ping/reconnect |
| **UDP** | — | **NÃO EXISTE** | Zero referências no codebase |
| **FTP** | — | **NÃO EXISTE** | Zero referências no codebase |

### 2.2 Comandos do protocolo Toledo

Definidos em `ToledoPrix4Constants.COMANDOS`:

| Comando | Código | Método Protocol | Status |
|---------|--------|-----------------|--------|
| Handshake | HS | `handshake()` | Stub |
| Ping | PN | `ping()` | TCP socket only |
| Status | ST | `obterStatus()` | Parcial (monitor TCP) |
| Enviar Produto | EP | `enviarProduto()` | Stub |
| Atualizar Produto | UP | `atualizarProduto()` | Stub |
| Remover Produto | RP | `removerProduto()` | Stub |
| Enviar Promoção | PR | `enviarPromocao()` | Stub |
| Enviar Departamento | DP | `enviarDepartamento()` | Stub |
| Enviar Etiqueta | ET | `enviarEtiqueta()` | Stub |
| Enviar Lote | LT | `enviarLote()` | Stub |
| Receber Peso | PW | `receberPeso()` | Stub |
| Receber Status | RS | `receberStatus()` | Stub |

### 2.3 Fluxo arquitetural atual

```
ERP UI (equipamentos.js)
    ↓ REST /api/equipamentos
EquipamentosController → EquipamentosService
    ↓
EquipamentosRepository (SQLite)
    ↓
DriverManager → ToledoPrix4UnoDriver
    ↓
ToledoPrix4Protocol ──TCP I/O──► ConnectionManager → EthernetTransport (net.Socket)
    ↓ (stub)                              ↓
ToledoPrix4Parser (stub)            PacketLogger → PacketHistory + HexViewer
                                          ↓
                                    ConnectionMonitor
```

### 2.4 Componentes auxiliares Toledo (completos)

| Componente | Status | Função |
|------------|--------|--------|
| ToledoPrix4Mapper | Implementado | DTO → payload Toledo (centavos, truncamento) |
| ToledoPrix4Validator | Implementado | Valida produto, promo, dept, etiqueta, peso, config |
| ToledoPrix4Constants | Implementado | Firmware, portas, timeouts, limites, códigos |
| ToledoPrix4Errors | Implementado | Hierarquia de exceções |
| ToledoPrix4Diagnostics | Stub | Relatório estrutural sem testes hardware |

---

## 3. Banco de Dados

### 3.1 Tabelas

Schema definido inline em `backend/database.js` (linhas 2220–2404). **Não há pasta `migrations/`**.

#### `equipamentos_drivers` (catálogo)

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| codigo | TEXT UNIQUE | Ex: `TOLEDO_PRIX4_UNO` |
| fabricante, modelo, nome_exibicao | TEXT | |
| versao | TEXT | Default 1.0.0 |
| transportes | TEXT | JSON array |
| descricao | TEXT | |
| ativo | INTEGER | |
| created_at, updated_at | DATETIME | |

**Seed:** 6 drivers (Toledo, Filizola, Urano, Aclas, Elgin, Bematech).

#### `equipamentos`

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| nome | TEXT NOT NULL | |
| tipo | TEXT | Default `balanca` |
| fabricante, modelo | TEXT | |
| driver_id | INTEGER FK | → equipamentos_drivers |
| driver_codigo | TEXT | Denormalizado |
| transporte | TEXT | Default `serial`; repo usa `ethernet` |
| porta_com, ip | TEXT | |
| porta_tcp | INTEGER | Default 9100 |
| status | TEXT | Default `offline` |
| ativo | INTEGER | |
| terminal_id | INTEGER FK | → terminais |
| observacao | TEXT | |
| ultimo_teste, ultimo_diagnostico | DATETIME | |
| timeout_ms | INTEGER | ALTER, default 5000 |
| reconnect_auto | INTEGER | ALTER, default 1 |
| ultima_comunicacao | DATETIME | ALTER |
| ultimo_erro | TEXT | ALTER |
| created_at, updated_at | DATETIME | |

**Índices:** ip, driver_id, driver_codigo, status, ativo.

#### `equipamentos_configuracoes`

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| equipamento_id | INTEGER FK CASCADE | |
| chave | TEXT NOT NULL | |
| valor, descricao | TEXT | |
| UNIQUE(equipamento_id, chave) | | |

**Status:** Schema criado; **nenhum código lê/escreve esta tabela**.

#### `equipamentos_logs`

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| equipamento_id | INTEGER FK SET NULL | |
| nivel | TEXT | info/warn/error |
| operacao | TEXT | |
| mensagem | TEXT NOT NULL | |
| contexto | TEXT | JSON |
| created_at, updated_at | DATETIME | |

**Uso:** `LoggerService` → `EquipamentosRepository.gravarLog()`.

#### `equipamentos_eventos`

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| equipamento_id | INTEGER FK SET NULL | |
| evento | TEXT NOT NULL | |
| payload | TEXT | JSON |
| created_at, updated_at | DATETIME | |

**Uso:** `EquipamentosEvents` → `gravarEvento()`.

#### `equipamentos_fila`

| Coluna | Tipo | Observação |
|--------|------|------------|
| id | INTEGER PK | |
| equipamento_id | INTEGER FK CASCADE | |
| comando | TEXT NOT NULL | SYNC_PRODUTO, etc. |
| payload | TEXT | JSON |
| status | TEXT | pendente/processando/concluido/erro/cancelado |
| prioridade | INTEGER | Default 5 |
| tentativas | INTEGER | Default 0 |
| erro_mensagem | TEXT | |
| processado_em | DATETIME | |
| created_at, updated_at | DATETIME | |

**Índices:** status, equipamento_id, (prioridade, created_at).

### 3.2 Relacionamentos

```
equipamentos_drivers (1) ──► (N) equipamentos
terminais (1) ──► (N) equipamentos
equipamentos (1) ──► (N) equipamentos_configuracoes [CASCADE]
equipamentos (1) ──► (N) equipamentos_logs [SET NULL]
equipamentos (1) ──► (N) equipamentos_eventos [SET NULL]
equipamentos (1) ──► (N) equipamentos_fila [CASCADE]
```

### 3.3 Repository

`EquipamentosRepository.js` — **completo** para:
- CRUD equipamentos
- Listagem drivers catálogo
- Logs, eventos
- Fila (inserir, listar, atualizar status, deduplicação, resumo sync)
- Dashboard resumo

**Não implementado:** CRUD `equipamentos_configuracoes`.

### 3.4 Tabelas ausentes (vs. necessidades futuras)

| Tabela sugerida | Propósito | Status |
|-----------------|-----------|--------|
| `equipamentos_metricas` | Métricas de monitoramento | Referenciada em TODO do MonitorService |
| `equipamentos_alertas` | Alertas de anomalia | Referenciada em TODO |
| `equipamentos_sync_historico` | Histórico detalhado de sync | Não existe (fila serve parcialmente) |

---

## 4. Integração ERP

### 4.1 Fluxo projetado

```
Entidade ERP → Mapper → DTO → Validator → SyncManager → QueueManager → equipamentos_fila
                                                                          ↓ (não implementado)
                                                              EquipamentosManager → Driver → Hardware
```

### 4.2 Matriz de cobertura por domínio

| Domínio | Fonte ERP | Mapper | DTO/Validator | Toledo Mapper | Hook ERP | Sync real | Status |
|---------|-----------|--------|---------------|---------------|----------|-----------|--------|
| **Produtos** | `produtos` | ProdutoMapper | ProdutoDTO/Validator | mapProduto() | Não | Não | PARCIAL |
| **Promoções** | `promocoes` | PromocaoMapper | PromocaoDTO/Validator | mapPromocao() | Não | Não | PARCIAL |
| **Departamentos** | `categorias`/`subcategorias` | DepartamentoMapper | DepartamentoDTO/Validator | mapDepartamento() | Não | Não | PARCIAL |
| **Etiquetas** | Campos produto | EtiquetaMapper | EtiquetaDTO/Validator | mapEtiqueta() | Não | Não | PARCIAL |
| **Preço** | `preco_venda` | Mapeado | Validado | Centavos | — | Não | PARCIAL |
| **EAN** | `codigo_barras` | Mapeado | Validação 8-14 | Passado | — | Não | PARCIAL |
| **Validade** | `dias_alerta_validade` | Mapeado | Etiqueta validade | validadeDias | — | Não | PARCIAL |
| **Tara** | — | — | Campo DTO existe | Mapeado se presente | — | Não | CONTRATO APENAS |
| **Fornecedor** | `fornecedores` | — | — | — | — | — | NÃO EXISTE |
| **Imagem** | — | — | — | — | — | — | NÃO EXISTE |
| **Info nutricional** | — | — | — | — | — | — | NÃO EXISTE |
| **Conservação** | — | — | — | — | — | — | NÃO EXISTE |

### 4.3 Campos mapeados — ProdutoMapper

| Campo ERP | Campo DTO | Observação |
|-----------|-----------|------------|
| codigo / id | plu | |
| codigo_barras | codigoBarras | |
| nome | descricao | |
| nome (22 chars) | descricaoReduzida | |
| preco_venda | preco | |
| unidade | unidade | Default kg |
| produto_fracionado / vendido_por_peso | pesavel | |
| dias_alerta_validade | validadeDias | |
| categoria_id | departamento | |
| — | tara | **Não populado do ERP** |

### 4.4 Hooks ausentes

Nenhuma rota ERP chama `SyncManager` ou `equipamentosManager`:

- `backend/rotas/produtos.js` — sem referência a equipamentos
- Rotas de promoções — sem referência
- Não há endpoints `/api/equipamentos/sync` ou similares

### 4.5 PDV

`frontend/pdv/js/pdv.js`:
- `interpretarCodigoBalanca()` — parse EAN-13 tipo 2 (etiqueta pré-impressa)
- `codigoEhBalanca()` — detecção de código balança
- **Não integra** com Motor de Equipamentos para peso ao vivo

---

## 5. Comunicação

### 5.1 Matriz de cobertura

| Recurso | Implementação | Status |
|---------|---------------|--------|
| **Ethernet** | EthernetTransport (net.Socket) | IMPLEMENTADO |
| **TCP** | Connect, read, write, ping, reconnect | IMPLEMENTADO |
| **Serial** | SerialTransport | STUB (simula connect) |
| **USB** | UsbTransport | STUB |
| **Bluetooth** | BluetoothTransport | STUB |
| **UDP** | — | NÃO EXISTE |
| **FTP** | — | NÃO EXISTE |
| **Reconexão** | ConnectionManager + EthernetTransport | IMPLEMENTADO |
| **Polling** | MonitorService._executarCiclo() | STUB |
| **Heartbeat** | Timer 30s default (env: EQUIPAMENTOS_HEARTBEAT_MS) | IMPLEMENTADO (TCP) |
| **Retry** | SyncManager define MAX_RETRIES=3; worker não executa | PARCIAL |
| **Timeout** | Configurável por equipamento (timeout_ms) | IMPLEMENTADO |
| **Fila** | Persistência SQLite; worker ausente | PARCIAL |
| **Logs** | LoggerService + PacketLogger + equipamentos_logs | IMPLEMENTADO |

### 5.2 Variáveis de ambiente suportadas

| Variável | Default | Uso |
|----------|---------|-----|
| EQUIPAMENTOS_HEARTBEAT_MS | 30000 | Intervalo heartbeat |
| EQUIPAMENTOS_ETHERNET_TIMEOUT_MS | 5000 | Timeout TCP |
| EQUIPAMENTOS_ETHERNET_MAX_RECONNECT | 3 | Tentativas reconexão |
| EQUIPAMENTOS_ETHERNET_RECONNECT_MS | 2000 | Intervalo entre tentativas |
| EQUIPAMENTOS_SYNC_CONCORRENCIA | 3 | Despachos simultâneos |
| EQUIPAMENTOS_SYNC_MAX_RETRIES | 3 | Retries por item fila |

---

## 6. Arquitetura

### 6.1 Desacoplamento — avaliação

| Princípio | Avaliação | Evidência |
|-----------|-----------|-----------|
| Drivers plugáveis | ✅ Correto | BaseDriver + Registry + Loader + Catalog |
| DTOs neutros | ✅ Correto | contracts/ independente de SQLite |
| Transporte separado do protocolo | ✅ Correto | Driver → Protocol → Transport |
| Sync via fila assíncrona | ✅ Correto | SyncManager não acessa driver diretamente |
| ERP não conhece protocolo | ✅ Correto | Mappers produzem DTOs genéricos |
| Orquestração centralizada | ⚠️ Parcial | EquipamentosManager é stub |
| Config por equipamento | ⚠️ Parcial | Tabela existe mas não usada |

### 6.2 Dependências indevidas

| Dependência | Severidade | Detalhe |
|-------------|------------|---------|
| ProdutoMapper → dto/ProdutoDTO | Baixa | dto/ é re-export de contracts/ |
| dashboard.js → EquipamentosRepository direto | Média | Deveria usar EquipamentosService |
| EquipamentosService → EthernetTransport direto | Baixa | Para teste TCP, aceitável |
| ToledoPrix4UnoDriver → connectionMonitor | Baixa | Acoplamento aceitável no driver |

### 6.3 Código duplicado

| Item | Localização | Recomendação |
|------|-------------|--------------|
| DTOs em `dto/` | Re-exports de `contracts/` | Manter como alias; migrar imports gradualmente |
| `_stub()` no Driver e Protocol | ToledoPrix4UnoDriver + ToledoPrix4Protocol | Unificar quando protocolo for implementado |
| Status de conexão | ConnectionManager.obterStatus + ConnectionMonitor | Complementares, não duplicados |

### 6.4 Código morto / não utilizado

| Item | Detalhe |
|------|---------|
| `equipamentos_configuracoes` | Tabela criada, zero uso |
| MonitorService._executarCiclo | Vazio, nunca chamado |
| QueueManager._processarProximo | Vazio, nunca chamado |
| DiscoveryService.* | Todos retornam [] |
| Transportes Serial/USB/BT | Stubs sem integração |
| 5 drivers no catálogo | Apenas README, modulo: null |

### 6.5 Serviços reutilizáveis

| Serviço | Reutilização |
|---------|--------------|
| ConnectionManager | Qualquer driver TCP |
| EthernetTransport | Qualquer equipamento Ethernet |
| PacketLogger + HexViewer + PacketHistory | Debug de qualquer protocolo |
| SyncManager + QueueManager | Qualquer tipo de sync |
| contracts/* (DTOs, Validators) | Qualquer fabricante |
| DriverRegistry + DriverLoader | Framework de plugins |
| LoggerService | Logs centralizados |
| EquipamentosEvents | Eventos para UI/SSE futuro |
| motorConversaoUnidades | PDV produtos fracionados |

### 6.6 Padrão de referência

O motor espelha conscientemente o módulo TEF:
- `EquipamentosManager` ↔ `TefManager`
- `MonitorService` ↔ `tefMonitorService`
- `DiscoveryService` ↔ `sdkDetector`
- `index.js` ↔ `services/tef/index.js`

---

## 7. Compatibilidade Futura

### 7.1 Avaliação por fabricante

| Fabricante | Catálogo | Driver | Protocolo | Transporte | Esforço estimado |
|------------|----------|--------|-----------|------------|------------------|
| Toledo Prix 4 | ✅ | Parcial | Stub | TCP ✅ | Sprint 11-13 |
| Toledo Prix 5 | ❌ | ❌ | ❌ | — | Novo driver, provável TCP similar |
| Toledo Prix 6 | ❌ | ❌ | ❌ | — | Novo driver |
| Urano | ✅ catálogo | ❌ | ❌ | Serial stub | Driver + protocolo serial |
| Filizola | ✅ catálogo | ❌ | ❌ | Serial/Ethernet stub | Driver + protocolo |
| Elgin | ✅ catálogo | ❌ | ❌ | Serial stub | Driver + protocolo |

### 7.2 O que NÃO precisa mudar no Core

Para adicionar qualquer fabricante:

1. Criar pasta `drivers/{fabricante}/{modelo}/`
2. Implementar classe estendendo `BaseDriver`
3. Implementar Protocol + Parser + Mapper + Validator
4. Registrar no `driverCatalog.js` com `modulo` apontando para o driver
5. Seed em `equipamentos_drivers` (opcional, automático via catalog)

**Core intocado:** contracts, SyncManager, QueueManager, ConnectionManager, Repository, API, UI.

### 7.3 Extensões necessárias no Core (não por fabricante)

| Extensão | Motivo |
|----------|--------|
| QueueManager worker | Consumir fila para qualquer driver |
| EquipamentosManager.obterDriver() | Resolver driver por equipamento_id |
| Hooks ERP | Disparar sync em qualquer fabricante |
| SerialTransport real | Drivers Urano/Filizola serial |
| Endpoints sync REST | API para sync manual/batch |

---

## 8. Comparação com MGV7

> **Nota:** Não há referências a MGV7 no codebase CDS. A comparação é conceitual, baseada nas tabelas MGV7 informadas e na arquitetura CDS atual. **Não se deve copiar o banco MGV.**

### 8.1 Mapeamento conceitual

| Conceito MGV7 | Tabela MGV7 | Equivalente CDS | Status CDS |
|---------------|-------------|-----------------|------------|
| Cadastro de balança | tbBalanca | `equipamentos` | ✅ Implementado |
| Config comunicação | tbCfgComunicacaoBal | `equipamentos` (ip, porta_tcp, timeout_ms, reconnect_auto) + `equipamentos_configuracoes` (não usada) | ⚠️ Parcial |
| Departamentos | tbDepartamento | `DepartamentoDTO` + mapper de categorias | ⚠️ Contrato apenas |
| Itens/produtos ERP | tbItens | `produtos` (tabela ERP existente) | ✅ ERP existe |
| Itens na balança | tbItemBalanca | Payload na `equipamentos_fila` | ⚠️ Sem tabela dedicada |
| Etiquetas | tbEtiqueta | `EtiquetaDTO` + mapper | ⚠️ Contrato apenas |
| Parâmetros balança | tbParametrosBalanca | `equipamentos_configuracoes` | ❌ Schema sem uso |
| Promoções inteligentes | tbPromocoesInteligentes | `PromocaoDTO` + mapper | ⚠️ Contrato apenas |
| Log carga remota TCP | tbLogCargaRemotaTCP | `equipamentos_logs` + `PacketHistory` (memória) | ⚠️ Parcial |
| Estado comunicação | tbEstadoComunicacaoBal | `ConnectionMonitor` + campos ultima_comunicacao/ultimo_erro | ⚠️ Parcial |

### 8.2 Conceitos MGV7 ausentes no CDS

| Conceito MGV7 | Impacto | Prioridade |
|---------------|---------|------------|
| Tabela item-balança (associação PLU ↔ equipamento) | Rastrear o que está em cada balança | Média |
| Parâmetros específicos por balança (layout, teclas, etc.) | Configuração avançada | Baixa (Sprint futura) |
| Log de carga remota com detalhe de pacotes | Auditoria de sync | Média (PacketHistory parcial) |
| Estado comunicação persistente | Histórico de conexão | Baixa |
| Carga via arquivo (FTP/MGV) | Alternativa ao TCP direto | Baixa (não planejado) |
| Informação nutricional na balança | Etiquetas completas | Baixa |
| Múltiplos layouts de etiqueta | Flexibilidade | Média |
| Sincronização bidirecional | Ler dados da balança | Baixa |

### 8.3 Conceitos CDS superiores ao MGV7

| Conceito CDS | Vantagem |
|--------------|----------|
| Arquitetura de plugins (drivers) | Multi-fabricante sem acoplamento |
| Fila assíncrona com prioridade | Resiliência e retry |
| DTOs validados independentes do ERP | Desacoplamento total |
| Contratos testáveis | 8 suites de teste automatizado |
| Packet inspection (hex viewer) | Debug de protocolo em tempo real |

---

## 9. Cobertura por Área

### 9.1 Drivers

| Driver | Registrado | Implementado | TCP | Sync | Peso |
|--------|------------|--------------|-----|------|------|
| TOLEDO_PRIX4_UNO | ✅ | Parcial | ✅ | Stub | Stub |
| FILIZOLA_PLATINA | Catálogo | ❌ | — | — | — |
| URANO_POP | Catálogo | ❌ | — | — | — |
| ACLAS_LS2 | Catálogo | ❌ | — | — | — |
| ELGEN_BALANCA | Catálogo | ❌ | — | — | — |
| BEMATECH_BP5 | Catálogo | ❌ | — | — | — |

### 9.2 Protocolo

| Camada | Cobertura |
|--------|-----------|
| Constantes e limites | 100% |
| Validação de payloads | 100% |
| Mapeamento DTO → Toledo | 100% |
| Frame builder | 0% |
| Handshake 90AX | 0% |
| Comandos de sync | 0% |
| Parser de respostas | 0% |
| Parser de peso | 0% |

### 9.3 Comunicação

| Camada | Cobertura |
|--------|-----------|
| TCP connect/disconnect | 100% |
| Read/write raw | 100% |
| Heartbeat/reconnect | 100% |
| Packet logging | 100% |
| Discovery | 0% |
| Serial/USB/BT | 0% |
| UDP/FTP | 0% |

### 9.4 Banco

| Tabela | Schema | Repository | Uso ativo |
|--------|--------|------------|-----------|
| equipamentos | ✅ | ✅ | ✅ |
| equipamentos_drivers | ✅ | ✅ | ✅ |
| equipamentos_configuracoes | ✅ | ❌ | ❌ |
| equipamentos_logs | ✅ | ✅ | ✅ |
| equipamentos_eventos | ✅ | ✅ | ✅ |
| equipamentos_fila | ✅ | ✅ | ⚠️ Enqueue only |

### 9.5 UI

| Tela/Funcionalidade | Status |
|---------------------|--------|
| Listagem equipamentos | ✅ |
| CRUD equipamento | ✅ |
| Filtros (tipo, status, busca) | ✅ |
| Seleção de driver | ✅ |
| Teste conexão TCP | ✅ |
| Diagnóstico por equipamento | ✅ |
| Visualização logs | ✅ |
| Dashboard widget | ✅ |
| Sync manual de produtos | ❌ |
| Monitoramento tempo real | ❌ |
| Hex viewer na UI | ❌ |
| Discovery na UI | ❌ |

### 9.6 Testes

| Suite | Script npm | Foco |
|-------|------------|------|
| contracts-framework.test.js | test:equipamentos-contracts | DTOs, validators |
| drivers-framework.test.js | test:equipamentos-drivers | BaseDriver, registry |
| transport-framework.test.js | test:equipamentos-transport | Transport layer |
| tcp-connection.test.js | test:equipamentos-tcp | ConnectionManager |
| toledo-prix4-driver.test.js | test:equipamentos-toledo-prix4 | Driver, mapper, validator |
| toledo-prix4-tcp.test.js | test:equipamentos-toledo-tcp | TCP integration |
| sync-framework.test.js | test:equipamentos-sync | SyncManager, queue |
| equipamentos-service.test.js | test:equipamentos-service | CRUD, TCP test |

**Total:** ~399 assertions em 8 arquivos + MockTcpServer helper.

**Ausentes:**
- Testes de protocolo Toledo (frames, handshake)
- Testes de parser de peso
- Testes de worker da fila
- Testes E2E ERP → balança
- Testes de integração com hardware real

---

## 10. Pontos Fortes

1. **Arquitetura de plugins madura** — BaseDriver com 20 métodos, Registry, Loader, Catalog
2. **Desacoplamento ERP ↔ Hardware** — DTOs, Mappers, Validators, SyncManager
3. **Comunicação TCP real funcional** — EthernetTransport + ConnectionManager testados
4. **Observabilidade** — PacketLogger, HexViewer, PacketHistory, LoggerService
5. **Persistência completa** — 6 tabelas, repository robusto, índices
6. **API REST + UI ERP** — CRUD, teste, diagnóstico, dashboard
7. **Testes automatizados** — 8 suites cobrindo framework, TCP, sync, contracts
8. **Padrão TEF replicado** — Facilita manutenção por equipe familiarizada
9. **Preparação multi-fabricante** — Catálogo com 6 marcas, contratos neutros
10. **Fila com prioridade e deduplicação** — Infraestrutura pronta para worker

---

## 11. Pontos Fracos

1. **Protocolo Toledo não implementado** — Bloqueador principal para produção
2. **Worker da fila ausente** — Sync enfileira mas nunca executa
3. **EquipamentosManager é stub** — `obterDriver()` retorna null
4. **Sem hooks no ERP** — Salvar produto não dispara sync
5. **PDV sem peso ao vivo** — Apenas parse de etiqueta pré-impressa
6. **Discovery inexistente** — Cadastro 100% manual
7. **MonitorService vazio** — Sem polling de saúde
8. **equipamentos_configuracoes não usada** — Schema morto
9. **Campos ERP incompletos** — Tara, nutricional, conservação, fornecedor, imagem
10. **Sem UDP/FTP** — Alternativas de comunicação MGV não cobertas

---

## 12. Débito Técnico

| Item | Severidade | Esforço | Sprint sugerida |
|------|------------|---------|-----------------|
| Implementar protocolo 90AX (frame builder + parser) | Crítica | Alto | 11-12 |
| Worker QueueManager | Crítica | Médio | 11 |
| EquipamentosManager.obterDriver() + bootstrap | Alta | Médio | 11 |
| Hooks ERP (produto/promo save → sync) | Alta | Médio | 12 |
| Remover/migrar pasta dto/ legada | Baixa | Baixo | 13 |
| Implementar CRUD equipamentos_configuracoes | Média | Baixo | 13 |
| MonitorService polling real | Média | Médio | 13 |
| Discovery Ethernet (scan subnet) | Média | Médio | 14 |
| SerialTransport com serialport | Média | Médio | 15+ |
| Endpoints REST de sync | Média | Baixo | 12 |
| Tabela equipamentos_metricas | Baixa | Baixo | 14 |
| Integração PDV obterPeso() | Alta | Médio | 13 |
| Testes de protocolo com hardware | Alta | Médio | 12 |

---

## 13. Refatorações Recomendadas

| Refatoração | Motivo | Prioridade |
|-------------|--------|------------|
| Unificar `_stub()` Driver/Protocol | Quando protocolo for real, driver deve delegar sem simular | Sprint 11 |
| Completar EquipamentosManager | Ponto único de orquestração (padrão TefManager) | Sprint 11 |
| dashboard.js usar Service em vez de Repository | Respeitar camadas | Sprint 13 |
| Criar `ToledoPrix4FrameBuilder.js` | Separar construção de frames do protocol | Sprint 11 |
| Deprecar imports de `dto/` | Usar apenas `contracts/` | Sprint 13 |
| Extrair retry/backoff para util compartilhado | Queue worker e ConnectionManager | Sprint 11 |

---

## 14. Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND ERP                         │
│  equipamentos.js │ dashboard.js │ configuracoes.js           │
└────────────────────────┬────────────────────────────────────┘
                         │ REST /api/equipamentos
┌────────────────────────▼────────────────────────────────────┐
│                    CAMADA API                               │
│  equipamentosController.js │ equipamentos.js (rotas)        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   CAMADA SERVIÇO                              │
│  EquipamentosService │ SyncManager │ LoggerService          │
│  ConfigService │ *Mapper                                      │
└──────┬─────────────────────────────┬──────────────────────────┘
       │                             │
┌──────▼──────────┐    ┌─────────────▼──────────────────────────┐
│  REPOSITORY     │    │              CORE                       │
│  Equipamentos   │    │  EquipamentosManager (stub)             │
│  Repository     │    │  DriverManager → Registry → Loader      │
└──────┬──────────┘    └─────────────┬──────────────────────────┘
       │                             │
┌──────▼──────────┐    ┌─────────────▼──────────────────────────┐
│    SQLite       │    │              DRIVERS                      │
│  6 tabelas      │    │  BaseDriver ← ToledoPrix4UnoDriver       │
└─────────────────┘    │           ← [5 placeholders]            │
                       └─────────────┬──────────────────────────┘
                                     │
                       ┌─────────────▼──────────────────────────┐
                       │           PROTOCOLO                       │
                       │  ToledoPrix4Protocol (TCP OK, cmds stub)  │
                       │  ToledoPrix4Parser (stub)                │
                       │  ToledoPrix4Mapper/Validator (OK)        │
                       └─────────────┬──────────────────────────┘
                                     │
                       ┌─────────────▼──────────────────────────┐
                       │          TRANSPORTE                     │
                       │  ConnectionManager → EthernetTransport  │
                       │  [Serial/USB/BT stubs]                  │
                       └─────────────┬──────────────────────────┘
                                     │
                       ┌─────────────▼──────────────────────────┐
                       │       INFRAESTRUTURA                    │
                       │  PacketLogger │ ConnectionMonitor       │
                       │  QueueManager (enqueue) │ Events        │
                       │  Discovery (stub) │ Monitor (stub)      │
                       └────────────────────────────────────────┘
```

---

## 15. Arquitetura Recomendada (pós-auditoria)

```
┌─────────────────────────────────────────────────────────────┐
│  ERP (produtos, promoções, categorias)                       │
│       │ onSave hooks                                         │
│       ▼                                                      │
│  SyncManager → QueueManager.worker → EquipamentosManager     │
│       │                              │                       │
│       │                              ▼                       │
│       │                    DriverManager.obterDriver()     │
│       │                              │                       │
│       │                              ▼                       │
│       │                    BaseDriver.sincronizar*()         │
│       │                              │                       │
│       │                              ▼                       │
│       │                    Protocol (frames reais)           │
│       │                              │                       │
│       │                              ▼                       │
│       │                    ConnectionManager → Transport   │
│       │                              │                       │
│       ▼                              ▼                       │
│  equipamentos_fila            Hardware (Balança)             │
│  equipamentos_logs                                           │
└─────────────────────────────────────────────────────────────┘

PDV ←── SSE/WebSocket ←── EquipamentosEvents ←── obterPeso()
```

**Princípios mantidos:**
- Core nunca conhece protocolo de fabricante
- Drivers nunca acessam banco ERP
- Sync sempre via fila
- Comunicação sempre via Transport

---

## 16. Roadmap dos Próximos Sprints

### Sprint 11 — Protocolo Toledo + Worker da Fila
**Objetivo:** Primeira sync real de produto para balança

| Item | Status atual | Prioridade | Complexidade | Dependências |
|------|-------------|------------|--------------|--------------|
| ToledoPrix4FrameBuilder | NÃO IMPLEMENTADO | P0 | Alta | Documentação protocolo 90AX |
| Handshake 90AX | STUB | P0 | Alta | FrameBuilder |
| Comandos sync (EP, UP, RP) | STUB | P0 | Alta | Handshake |
| ToledoPrix4Parser (ACK/NAK) | STUB | P0 | Média | FrameBuilder |
| QueueManager worker | STUB | P0 | Média | Protocolo básico |
| EquipamentosManager.obterDriver() | STUB | P0 | Média | DriverManager |
| EquipamentosManager.inicializar() | STUB | P0 | Baixa | Queue worker |
| Testes protocolo (mock frames) | NÃO EXISTE | P1 | Média | FrameBuilder |

### Sprint 12 — Sync Completo + Hooks ERP
**Objetivo:** Sync automático ao salvar produto/promoção

| Item | Status atual | Prioridade | Complexidade | Dependências |
|------|-------------|------------|--------------|--------------|
| Sync promoção (PR) | STUB | P0 | Média | Sprint 11 |
| Sync departamento (DP) | STUB | P0 | Média | Sprint 11 |
| Sync etiqueta (ET) | STUB | P1 | Média | Sprint 11 |
| Sync lote (LT) | STUB | P1 | Média | Sync produto |
| Hook produtos.js → SyncManager | NÃO EXISTE | P0 | Baixa | Sprint 11 |
| Hook promoções → SyncManager | NÃO EXISTE | P1 | Baixa | Sprint 11 |
| REST /equipamentos/:id/sync | NÃO EXISTE | P1 | Baixa | Sprint 11 |
| REST /equipamentos/:id/sync/produtos | NÃO EXISTE | P1 | Média | Sprint 11 |
| Retry/backoff no worker | PARCIAL | P1 | Média | Worker |

### Sprint 13 — Peso ao Vivo + Monitoramento
**Objetivo:** PDV lê peso da balança em tempo real

| Item | Status atual | Prioridade | Complexidade | Dependências |
|------|-------------|------------|--------------|--------------|
| Parser de peso (PW) | STUB | P0 | Alta | Protocolo |
| obterPeso() real no driver | STUB | P0 | Média | Parser peso |
| Integração PDV ↔ motor | NÃO EXISTE | P0 | Média | obterPeso |
| SSE/WebSocket para peso | NÃO EXISTE | P1 | Média | obterPeso |
| MonitorService polling | STUB | P1 | Média | Driver status |
| CRUD equipamentos_configuracoes | NÃO EXISTE | P2 | Baixa | — |
| UI sync manual | NÃO EXISTE | P2 | Média | REST sync |

### Sprint 14 — Discovery + Métricas
**Objetivo:** Encontrar balanças na rede automaticamente

| Item | Status atual | Prioridade | Complexidade | Dependências |
|------|-------------|------------|--------------|--------------|
| Discovery Ethernet (subnet scan) | STUB | P1 | Alta | Handshake |
| ToledoPrix4Discovery | STUB | P1 | Média | Discovery global |
| UI discovery | NÃO EXISTE | P2 | Média | Discovery |
| Tabela equipamentos_metricas | NÃO EXISTE | P2 | Baixa | MonitorService |
| Hex viewer na UI | NÃO EXISTE | P3 | Baixa | — |

### Sprint 15+ — Multi-fabricante
**Objetivo:** Urano, Filizola, Elgin

| Item | Status atual | Prioridade | Complexidade | Dependências |
|------|-------------|------------|--------------|--------------|
| SerialTransport (serialport) | STUB | P1 | Média | — |
| Driver Urano POP | NÃO EXISTE | P2 | Alta | SerialTransport |
| Driver Filizola Platina | NÃO EXISTE | P2 | Alta | SerialTransport |
| Driver Elgin DP30 | NÃO EXISTE | P3 | Alta | SerialTransport |
| Toledo Prix 5/6 | NÃO EXISTE | P3 | Alta | Protocolo Prix 4 |
| Campos nutricional/conservação | NÃO EXISTE | P3 | Média | Contratos |

---

## 17. Checklist Final

### Infraestrutura
- [x] Framework de drivers (BaseDriver, Registry, Loader, Catalog)
- [x] Contratos DTO (Produto, Promoção, Departamento, Etiqueta, Peso)
- [x] Validators e Normalizers
- [x] Mappers ERP → DTO
- [x] Repository SQLite (6 tabelas)
- [x] API REST equipamentos
- [x] UI ERP equipamentos
- [x] EventEmitter (EquipamentosEvents)
- [x] LoggerService
- [ ] EquipamentosManager funcional
- [ ] ConfigService completo
- [ ] equipamentos_configuracoes em uso

### Comunicação
- [x] EthernetTransport (TCP real)
- [x] ConnectionManager (pool, heartbeat, reconnect)
- [x] ConnectionMonitor
- [x] PacketLogger + HexViewer + PacketHistory
- [x] Timeout configurável
- [ ] SerialTransport real
- [ ] Discovery
- [ ] UDP
- [ ] FTP

### Driver Toledo Prix 4
- [x] ToledoPrix4UnoDriver (estrutura)
- [x] TCP connect/disconnect real
- [x] Mapper + Validator
- [x] Constants (90AX)
- [ ] Frame Builder
- [ ] Handshake protocolo
- [ ] Comandos sync
- [ ] Parser respostas
- [ ] Parser peso
- [ ] Discovery Toledo

### Sync e Fila
- [x] SyncManager (enqueue)
- [x] QueueManager (persistência)
- [x] Deduplicação
- [x] Priorização
- [ ] Worker da fila
- [ ] Retry/backoff
- [ ] Hooks ERP
- [ ] REST sync endpoints

### Integração
- [x] PDV parse etiqueta EAN-13
- [ ] PDV peso ao vivo
- [ ] Sync produto automático
- [ ] Sync promoção automático
- [ ] Campos tara, nutricional, conservação

### Testes
- [x] Framework drivers
- [x] Contratos/DTOs
- [x] Transporte TCP
- [x] ConnectionManager
- [x] Toledo driver (estrutura)
- [x] Toledo TCP integration
- [x] Sync framework
- [x] EquipamentosService
- [ ] Protocolo frames
- [ ] Parser peso
- [ ] Worker fila
- [ ] E2E sync
- [ ] Hardware real

### Multi-fabricante
- [x] Catálogo 6 drivers
- [x] Arquitetura extensível
- [ ] Filizola driver
- [ ] Urano driver
- [ ] Elgin driver
- [ ] Aclas driver
- [ ] Bematech driver

---

## 18. Histórico de Sprints (referência)

| Sprint | Entrega | Status |
|--------|---------|--------|
| 1-2 | Estrutura inicial, repository, API básica | ✅ |
| 3 | Framework de drivers (BaseDriver, Registry, Loader) | ✅ |
| 4 | QueueManager (infraestrutura fila) | ✅ |
| 5 | Transport layer (BaseTransport, Mock) | ✅ |
| 6 | Contratos iniciais | ✅ |
| 7 | Contracts oficiais (DTOs, Validators, Normalizers) | ✅ |
| 8 | EthernetTransport (TCP real) | ✅ |
| 9 | UI ERP equipamentos + API completa | ✅ |
| 10 | TCP real Toledo (Protocol I/O, PacketLogger, ConnectionManager) | ✅ |
| 11 | Protocolo 90AX + Worker fila | 🔲 Planejado |
| 12 | Sync completo + Hooks ERP | 🔲 Planejado |
| 13 | Peso ao vivo + Monitoramento | 🔲 Planejado |

---

## 19. Conclusão

O Motor de Balanças do CDS Sistemas possui uma **fundação arquitetural excelente**, com desacoplamento correto entre ERP, Core, Drivers, Protocolo e Transporte. As Sprints 1–10 entregaram toda a infraestrutura necessária para suportar múltiplos fabricantes.

O **gargalo atual é exclusivamente a camada de protocolo Toledo 90AX** e a **orquestração operacional** (worker da fila, bootstrap do manager, hooks ERP). Nenhuma refatoração estrutural é necessária antes de continuar — o caminho é **implementar sobre o que já existe**.

A comparação com MGV7 mostra que os **conceitos principais já estão mapeados** no CDS (equipamento, fila, logs, departamentos, promoções, etiquetas), faltando principalmente a **execução real** e alguns conceitos avançados (parâmetros por balança, item-balança, nutricional).

**Recomendação:** Aprovar a arquitetura atual como base definitiva e iniciar Sprint 11 focada em Frame Builder + Handshake + Worker da Fila, sem alterações estruturais no Core.

---

*Documento gerado por auditoria técnica automatizada. Nenhum arquivo de código foi alterado.*
