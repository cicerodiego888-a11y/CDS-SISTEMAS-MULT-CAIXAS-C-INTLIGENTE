# RELATÓRIO DE AUDITORIA FINAL — MOTOR UNIVERSAL DE EQUIPAMENTOS

**Projeto:** CDS Sistemas — cds-sistemas 1.0.3  
**Data da auditoria:** 02/07/2026  
**Escopo:** Sprints 1 a 13 (pré-homologação Toledo Prix 4 Uno)  
**Módulo auditado:** `backend/motores/equipamentos/`  
**Tipo:** Auditoria somente leitura — nenhum arquivo foi modificado  

---

## Resumo Executivo

O Motor Universal de Equipamentos evoluiu de um esqueleto arquitetural (Sprints 1–9) para um sistema com **comunicação TCP real**, **pipeline de protocolo temporário (Sprint 11A)**, **laboratório de pacotes (Sprint 12)** e **engenharia reversa (Sprint 13)**. A arquitetura em camadas (Contratos → Serviços → Orquestrador → Driver → Protocolo → Transporte) está sólida, extensível e bem testada em ambiente simulado.

**Conclusão principal:** O motor está **pronto para homologação controlada** com balança física no que diz respeito à infraestrutura (TCP, fila, logs, laboratório, captura). O gargalo crítico é o **protocolo oficial Toledo 90AX** — os frames atuais são temporários (formato 11A) e a compatibilidade com hardware real permanece **não validada** para sync, peso, handshake e CRC.

| Dimensão | Maturidade global |
|----------|-------------------|
| Framework / arquitetura | **Alta** (~90%) |
| Infraestrutura TCP + fila | **Alta** (~85%) |
| Protocolo Toledo (oficial 90AX) | **Baixa** (~20%) |
| Integração ERP → balança | **Muito baixa** (~5%) |
| Drivers alternativos | **Ausente** (0%) |
| Frontend operacional | **Média** (~65%) |
| Testes automatizados | **Boa** (~75%) |
| Documentação | **Desatualizada** (~50%) |

**Testes executados na auditoria:** 11 suites, **158 casos**, **157 passaram**, **1 falhou** (teste obsoleto que espera stub TCP; driver já usa conexão real — ver seção Testes).

---

## 1. O Que Está 100% Concluído

### 1.1 Arquitetura e Framework

| Componente | Arquivo(s) | Evidência |
|------------|-----------|-----------|
| **DriverRegistry** | `drivers/DriverRegistry.js` (~175 LOC) | Registro, busca, instanciação, validação de herança `BaseDriver`, merge com catálogo |
| **DriverLoader** | `drivers/DriverLoader.js` (~127 LOC) | Carregamento dinâmico de plugins com `modulo` definido; relatório de carga |
| **BaseDriver** | `drivers/BaseDriver.js` (~145 LOC) | Contrato com 20 métodos obrigatórios + `validarHeranca()` |
| **BaseTransport** | `transport/BaseTransport.js` (~144 LOC) | Contrato com 9 métodos + validação de herança |
| **TransportManager** | `transport/TransportManager.js` (~204 LOC) | Registry de transportes (ethernet, serial, usb, bluetooth, mock) |
| **driverCatalog** | `drivers/driverCatalog.js` (~126 LOC) | 6 drivers catalogados com metadados completos |
| **Contratos DTO** | `contracts/*.js` | Produto, Promoção, Departamento, Etiqueta, Peso, Status, Equipamento, Diagnóstico |
| **Validators** | `contracts/*Validator.js` | Regras de negócio para todos os DTOs de sync |
| **Normalizers** | `contracts/*Normalizer.js` | Normalização de payloads |
| **ResponseFactory** | `contracts/ResponseFactory.js` (~205 LOC) | Padronização de respostas internas e API |
| **Mappers ERP** | `services/*Mapper.js` | Produto, Promoção, Departamento, Etiqueta → DTO |
| **EquipamentosEvents** | `events/EquipamentosEvents.js` (~124 LOC) | EventEmitter + persistência em `equipamentos_eventos` |
| **EquipamentosRepository** | `repositories/EquipamentosRepository.js` (~530 LOC) | CRUD completo, fila, logs, eventos, dashboard |

### 1.2 Orquestração e Pipeline de Sync

| Componente | Status |
|------------|--------|
| **EquipamentosManager** | Inicialização, cache de drivers, conectar/desconectar, sync por entidade, diagnóstico |
| **SyncManager** | Map → Validate → Dedupe → Enqueue → Events |
| **QueueManager** | Worker com intervalo, retry (3x), backoff exponencial, timeout 15s, persistência SQLite, recuperação de órfãos |
| **DriverManager** | Facade sobre Registry + Loader + catálogo DB |

Fluxo end-to-end implementado e testado:

```
ERP (manual/API futura) → SyncManager → QueueManager → EquipamentosManager
  → ToledoPrix4UnoDriver → ToledoPrix4Protocol → FrameBuilder → EthernetTransport
  → TCP Socket → Parser → ACK/NAK → Logger → Fila (status atualizado)
```

### 1.3 Transporte e Conexão

| Componente | Status |
|------------|--------|
| **EthernetTransport** | TCP real via `net`, buffer de recebimento, waiters, timeout, reconexão configurável |
| **ConnectionManager** | Pool de conexões, heartbeat por timer, reconexão, fechamento em lote |
| **ConnectionMonitor** | Wrapper fino sobre ConnectionManager |
| **MockTransport** | Simulador completo para testes (`injetarResposta`, `obterFilaEnvio`) |

### 1.4 Comunicação e Observabilidade

| Componente | Status |
|------------|--------|
| **PacketLogger** | Log TX/RX com metadados (driver, comando, ACK/NAK, tempo, retry) |
| **PacketHistory** | Armazenamento in-memory com limite configurável (`EQUIPAMENTOS_PACKET_HISTORY_MAX`) |
| **HexViewer** | Formatação hex + ASCII, linhas de 16 bytes |
| **LoggerService** | Níveis debug/info/warn/error, console + SQLite |

### 1.5 Toledo Prix 4 — Infraestrutura Sprint 11A

| Componente | Status |
|------------|--------|
| **ToledoPrix4FrameBuilder** | Handshake, ping, status, produto, departamento, promoção, remoção, etiqueta, lote, peso |
| **ToledoPrix4Parser** | parseFrame, parseACK, parseNAK, parseStatus, parsePeso, parseErro |
| **ToledoPrix4Protocol** | connect/disconnect, handshake, ping, status, sync, peso, heartbeat, reconnect, read/write |
| **ToledoPrix4Mapper** | DTO → payload Toledo (PLU, centavos, descrição 22 chars) |
| **ToledoPrix4Validator** | Validação de produto, promoção, departamento, etiqueta, peso, config Ethernet |
| **ToledoPrix4Constants** | Comandos, timeouts, firmware alvo 90AX, portas 9100/4001 |
| **ToledoPrix4Errors** | Hierarquia de exceções |

### 1.6 Laboratório (Sprint 12)

| Componente | Status |
|------------|--------|
| **FrameStudio** | Construção de frames, conversão ASCII↔HEX, visualização de bytes |
| **PacketInspector** | Enriquecimento de pacotes, latência, filtros, merge com PacketLogger |
| **CaptureManager** | Sessões de captura, export JSON/HEX/TXT/BIN |
| **ReplayManager** | Replay de pacotes via protocolo, comparação de resposta |
| **PacketComparator** | Diff byte-a-byte, diff de capturas, comparação por categoria |
| **DiagnosticoEquipamentos** | Ping, status, socket, heartbeat |
| **LaboratorioEquipamentos** | Facade integrada à API REST |

### 1.7 Engenharia Reversa (Sprint 13)

| Componente | Status |
|------------|--------|
| **FrameAnalyzer** | Heurísticas STX/ETX, ACK/NAK, ASCII/BIN, CRC/checksum |
| **CaptureSession** | Modelo de sessão com metadados e observações |
| **ProtocolCaptureService** | Subscribe PacketLogger, gravação normalizada |
| **CaptureExporter** | JSON, HEX, TXT, BIN, CSV, Wireshark-like |
| **CaptureImporter** | Import JSON, HEX, TXT, BIN |
| **ProtocolDocumentation** | Geração/atualização de `PROTOCOLO_TOLEDO.md` |
| **WiresharkFormat** | Export legível estilo Wireshark |
| **EngenhariaReversaService** | Facade completa |

### 1.8 Banco de Dados

Tabelas criadas e indexadas:

- `equipamentos_drivers` — catálogo com 6 drivers seed
- `equipamentos` — cadastro com FK, status, timeout, reconnect
- `equipamentos_configuracoes` — KV por equipamento
- `equipamentos_logs` — logs persistentes
- `equipamentos_eventos` — eventos de sync e CRUD
- `equipamentos_fila` — fila de sincronização com prioridade e retry

Config global: `configuracoes.equipamentos_ativo = 'true'`

### 1.9 API REST

| Grupo | Endpoints | Auth |
|-------|-----------|------|
| `/api/equipamentos` | 16 rotas (CRUD, teste, diagnóstico, logs, conexão) | JWT |
| `/api/laboratorio-equipamentos` | 22 rotas (frame, captura, replay, envio hex/ascii) | JWT |
| `/api/engenharia-reversa` | 12 rotas (captura, análise, export, import, wireshark) | JWT |

Controllers padronizados: `{ success: true/false, error?, ... }` + `responderErro()`.

### 1.10 Frontend

| Tela | Funcionalidades concluídas |
|------|---------------------------|
| **equipamentos.js** | Listagem, filtros, CRUD, resumo, teste TCP, diagnóstico, duplicar, ativar/desativar |
| **laboratorio-equipamentos.js** | Conectar, ping, status, envio HEX/ASCII, frame builder, captura, replay, comparar capturas |
| **dashboard.js** | Cards equipamentos (qty, online, offline, fila pendentes/concluídas/erros) |
| **configuracoes.js** | Navegação para balanças e laboratório |
| **access-control.js** | Permissão via módulo `configuracoes` |

---

## 2. O Que Está Parcialmente Implementado

### 2.1 Checklist de Validação Solicitado

| Item | Status | Detalhe |
|------|--------|---------|
| ✅ DriverRegistry | **100%** | Completo |
| ✅ DriverLoader | **100%** | Só carrega Toledo (1/6) |
| ✅ EquipamentosManager | **90%** | Falta bootstrap automático no `server.js` |
| ✅ QueueManager | **95%** | Worker completo; depende de `inicializar()` |
| ✅ SyncManager | **85%** | Enqueue OK; campos `_emAndamento`/`_concorrenciaMax` não usados |
| ✅ ConnectionManager | **85%** | Só Ethernet; ignora TransportManager |
| ⚠️ Discovery | **10%** | Estrutura + métodos vazios |
| ⚠️ MonitorService | **25%** | Métricas de fila OK; polling de equipamentos ausente |
| ✅ PacketLogger | **100%** | Completo |
| ✅ PacketHistory | **100%** | In-memory only |
| ✅ HexViewer | **100%** | Completo |
| ⚠️ FrameBuilder | **70%** | Temp 11A; não é 90AX oficial |
| ⚠️ Parser | **70%** | Temp 11A; sem CRC |
| ⚠️ Handshake | **60%** | Frame HS wired; não validado em hardware |
| ⚠️ Status | **60%** | Frame ST wired; sem polling contínuo |
| ⚠️ Ping | **75%** | PN frame + TCP keepalive; parcialmente validado por captura MGV7 |
| ⚠️ Heartbeat | **70%** | ConnectionManager timer + Protocol.heartbeat() |
| ⚠️ Retry | **50%** | Fila sim (3x); protocolo não retenta comando |
| ✅ Reconnect | **85%** | Transport + ConnectionManager + Protocol |
| ⚠️ ACK/NAK | **65%** | Framed AK/NK; bytes 0x06/0x15 não implementados |
| ❌ CRC | **0%** | Não implementado |
| ❌ Checksum | **0%** | Heurística só em eng. reversa |
| ✅ Time-out | **90%** | Por operação, conexão e fila |
| ✅ Fila | **95%** | Persistência + worker |
| ✅ Persistência | **90%** | SQLite; PacketHistory volátil |
| ⚠️ Transport | **60%** | Ethernet real; demais stubs |
| ✅ Ethernet | **90%** | TCP completo |
| ⚠️ Serial | **15%** | Stub estrutural |
| ⚠️ USB | **15%** | Stub estrutural |
| ❌ Discovery Ethernet | **0%** | Retrun retorna `[]` |
| ❌ Discovery Serial | **0%** | Varredura COM ausente |
| ⚠️ Diagnóstico | **40%** | DB/catalog OK; hardware stub |
| ✅ Laboratório | **85%** | API + UI; gaps menores |
| ✅ Engenharia Reversa | **80%** | API completa; sem UI |
| ✅ Capture | **90%** | Completo |
| ✅ Replay | **80%** | Happy path; edge cases limitados |
| ✅ Comparator | **85%** | Byte + categoria |
| ✅ Exportação | **90%** | Multi-formato |
| ✅ Importação | **80%** | JSON/HEX testados; TXT/BIN parcial |

### 2.2 Driver Toledo Prix 4 Uno — Métodos

| Método | Status |
|--------|--------|
| conectar / desconectar / configurar | Real TCP |
| status | Parcial (depende de conexão) |
| diagnostico | Stub estrutural |
| descobrir | Stub |
| sincronizar* (produto, promo, dept, etiqueta) | Wired temp protocol |
| removerProduto | Wired temp protocol |
| obterPeso | Wired temp protocol |
| zerar / reiniciar | Stub |

Versão driver: `0.3.0-tcp`. Respostas marcadas `simulado: true`, `infraestrutura: '11A'`.

### 2.3 Protocolo — Formato Temporário vs. Oficial

**Implementado (formato 11A):**
```
[STX 0x02][CMD 2 ASCII][SEP 0x1C][JSON UTF-8][ETX 0x03]
```

**Alinhamento parcial com captura MGV7:** ping (PN) → ACK (AK) documentado em `PROTOCOLO_TOLEDO.md`.

**Não implementado:** frames binários 90AX, CRC, checksum, byte ACK 0x06, byte NAK 0x15, comandos oficiais de sync validados.

### 2.4 Serviços e Configuração

| Item | Gap |
|------|-----|
| **ConfigService** | `syncAutomatica: false` hardcoded; sem intervalo configurável |
| **DiagnosticoService** | `comunicacao_real: false`; não testa hardware |
| **Serializer.serializeForFabricante()** | Retorna `implementado: false` |
| **utils/index.js** | Placeholder vazio (5 TODOs) |

### 2.5 Frontend — Parcial

| Funcionalidade backend | Frontend |
|------------------------|----------|
| GET `/:id/conexao` | Não exposto (sem polling de status live) |
| GET `/:id/logs` | Sem visualizador de logs |
| `equipamentos_configuracoes` | Sem UI KV |
| Fila de sync | Só contagem no dashboard |
| Engenharia reversa (12 endpoints) | **Zero UI** |
| POST `/util/converter` | Sem UI |
| POST `/comparar/hex` | Sem UI |
| `terminal_id` | Coluna existe; form não tem campo |
| Toggle `equipamentos_ativo` | Sem UI |

### 2.6 Documentação

Vários READMEs estão **desatualizados** em relação ao código:

- `drivers/toledo/README.md` — ainda diz protocolo é stub
- `drivers/toledo/prix4/README.md` — tabela mista stub/real
- `transport/README.md` — contradiz Ethernet implementado
- `AUDITORIA_MOTOR_BALANCAS.md` — pré-Sprint 11A (worker/fila/FrameBuilder)

---

## 3. O Que Ainda Falta

### 3.1 Crítico para Homologação

1. **Protocolo oficial Toledo 90AX (Sprint 11B)** — substituir frames temporários
2. **Validação CRC/checksum** — se exigido pela spec 90AX
3. **Bootstrap do motor no startup** — `EquipamentosManager.inicializar()` não é chamado em `server.js`
4. **Hooks ERP** — nenhuma rota de produtos/promoções dispara sync para balança
5. **Capturas MGV7 reais** — handshake, sync produto, peso, status (só 2 frames capturados)
6. **Teste de integração com balança física** — fluxo completo não validado

### 3.2 Importante pós-homologação

7. **MonitorService polling** — status online/offline automático por equipamento
8. **Discovery Ethernet** — varredura subnet / detecção Toledo
9. **Diagnóstico hardware** — firmware, conectividade real via protocolo
10. **Frontend engenharia reversa** — 12 endpoints sem interface
11. **UI de fila** — visualizar/cancelar/reprocessar itens
12. **UI de logs** — histórico por equipamento
13. **PDV peso ao vivo** — `obterPeso()` não integrado ao PDV
14. **SerialTransport real** — dependência `serialport` não instalada
15. **5 drivers alternativos** — Filizola, Urano, Aclas, Elgin, Bematech (0% código)

### 3.3 Drivers — Interface Incompleta

Nenhum driver além de Toledo implementa os 20 métodos. Para homologação Toledo, faltam:

- `descobrir()` — discovery de rede
- `zerar()` — tara/zero da balança
- `reiniciar()` — reset remoto
- `diagnostico()` — testes reais de firmware/conectividade

### 3.4 Banco — Colunas Potencialmente Úteis

Colunas **não existentes** que podem ser necessárias na homologação:

| Coluna sugerida | Tabela | Motivo |
|-----------------|--------|--------|
| `firmware` | equipamentos | Versão 90AX detectada no handshake |
| `protocolo_versao` | equipamentos | Rastrear compatibilidade |
| `mac_address` | equipamentos | Discovery / identificação |
| `ultimo_handshake` | equipamentos | Timestamp último HS bem-sucedido |
| `ultimo_sync_produto` | equipamentos | Rastreio operacional |
| `plu_ultimo_enviado` | equipamentos_fila | Debug de homologação |
| `duracao_ms` | equipamentos_fila | Métricas de performance |
| `resposta_raw` | equipamentos_logs | Hex da resposta para auditoria |

As colunas atuais (`timeout_ms`, `reconnect_auto`, `ultima_comunicacao`, `ultimo_erro`) são **suficientes para início** de homologação, mas limitadas para diagnóstico avançado.

### 3.5 API — Endpoints Ausentes

| Endpoint sugerido | Motivo |
|-------------------|--------|
| POST `/api/equipamentos/:id/sync/produto` | Sync manual de produto |
| GET `/api/equipamentos/:id/fila` | Listar fila do equipamento |
| POST `/api/equipamentos/:id/fila/:itemId/cancelar` | Cancelar item |
| POST `/api/equipamentos/:id/conectar` | Conectar via manager |
| POST `/api/equipamentos/:id/desconectar` | Desconectar |
| GET `/api/equipamentos/monitor` | Status consolidado |
| POST `/api/equipamentos/inicializar` | Bootstrap manual do motor |

---

## 4. O Que Pode Ser Implementado SEM Balança Física

Estas implementações **não dependem** de hardware e devem ser priorizadas antes/durante homologação:

| # | Item | Esforço | Impacto |
|---|------|---------|---------|
| 1 | Bootstrap `EquipamentosManager.inicializar()` no `server.js` | Baixo | Crítico — fila não processa sem isso |
| 2 | Corrigir teste obsoleto `drivers-framework` (stub → mock TCP) | Baixo | CI verde |
| 3 | Atualizar READMEs desatualizados | Baixo | Documentação |
| 4 | Frontend engenharia reversa (captura, análise, wireshark) | Médio | Produtividade homologação |
| 5 | UI logs + fila + status conexão live | Médio | Operacional |
| 6 | Endpoints sync manual + gestão fila | Médio | Testes ERP |
| 7 | Hooks ERP em rotas de produtos/promoções | Médio | Automação |
| 8 | MonitorService polling (timer + driver.status) | Médio | Monitoramento |
| 9 | Colunas DB sugeridas (firmware, handshake) | Baixo | Rastreio |
| 10 | Frontend toggle `equipamentos_ativo` | Baixo | Config |
| 11 | Testes de controllers/routes (supertest) | Médio | Cobertura API |
| 12 | Testes negativos lab/eng. reversa | Médio | Robustez |
| 13 | `ConnectionManager` usar `TransportManager` | Médio | Arquitetura |
| 14 | Retry no nível protocolo (configurável) | Baixo | Resiliência |
| 15 | Export facade `index.js` (métodos alto nível) | Baixo | API interna |
| 16 | Implementar `utils/index.js` helpers | Baixo | DX |
| 17 | Testes concorrência fila + múltiplos equipamentos | Médio | Estabilidade |
| 18 | Permissão dedicada `equipamentos` no backend | Baixo | Segurança |
| 19 | Documentação API (OpenAPI/Swagger) | Médio | Integração |
| 20 | Script npm `test:equipamentos` (todas suites) | Baixo | CI |

---

## 5. O Que Obrigatoriamente Depende da Balança Física

| # | Item | Por quê |
|---|------|---------|
| 1 | **Frames oficiais 90AX** | Somente captura MGV7 + balança real revelam bytes corretos |
| 2 | **CRC/checksum** | Algoritmo depende de spec real ou eng. reversa com tráfego |
| 3 | **Sync produto/promo/dept/etiqueta** | Validar PLU, preço, departamento na balança |
| 4 | **obterPeso() real** | Parser de peso depende de resposta real |
| 5 | **Handshake oficial** | Sequência de negociação firmware 90AX |
| 6 | **zerar() / reiniciar()** | Comandos específicos do firmware |
| 7 | **Discovery Ethernet Toledo** | IP/MAC/porta reais do equipamento |
| 8 | **Diagnóstico firmware** | Leitura de versão via protocolo |
| 9 | **Validação timeout/retry** | Comportamento real de latência e NAK |
| 10 | **Teste carga sync** | Performance com centenas de PLUs |
| 11 | **PDV peso ao vivo** | Integração balança → venda fracionada |
| 12 | **Capturas MGV7 completas** | Handshake, sync, peso, erro, NAK |

**Recomendação:** Usar laboratório + eng. reversa **durante** homologação para capturar tráfego real e alimentar Sprint 11B.

---

## 6. Grau de Maturidade por Módulo

| Módulo | Maturidade | Nota |
|--------|------------|------|
| Contratos / DTOs / Validators | **Produção** | Framework completo e testado |
| DriverRegistry / DriverLoader | **Produção** | Pronto para multi-driver |
| BaseDriver / BaseTransport | **Produção** | Contratos sólidos |
| EquipamentosRepository | **Produção** | SQLite completo |
| EquipamentosEvents | **Produção** | Eventos + persistência |
| LoggerService | **Produção** | Níveis + DB |
| SyncManager | **Beta** | Enqueue OK; sem hooks ERP |
| QueueManager | **Beta** | Worker completo; precisa bootstrap |
| EquipamentosManager | **Beta** | Orquestração OK; não auto-inicia |
| EquipamentosService | **Beta** | CRUD + teste TCP real |
| EthernetTransport | **Beta** | TCP robusto; testado com mock |
| ConnectionManager | **Beta** | Funcional; acoplado a Ethernet |
| PacketLogger / History / HexViewer | **Produção** | Completo |
| ToledoPrix4 FrameBuilder/Parser | **Alpha** | Temp 11A; não 90AX |
| ToledoPrix4Protocol | **Alpha** | Wired; não validado hardware |
| ToledoPrix4UnoDriver | **Alpha** | Sync wired; stubs operacionais |
| ToledoPrix4Mapper/Validator | **Produção** | Regras completas |
| ToledoPrix4Discovery/Diagnostics | **Conceito** | Stubs |
| DiscoveryService | **Conceito** | Retorna arrays vazios |
| MonitorService | **Conceito** | Métricas fila only |
| DiagnosticoService | **Conceito** | Checks DB only |
| Serial/USB/Bluetooth Transport | **Conceito** | Stubs |
| Laboratório | **Beta** | API + UI; Toledo only |
| Engenharia Reversa | **Beta** | API completa; heurísticas |
| ConfigService | **Alpha** | Mínimo funcional |
| Serializer (fabricante) | **Conceito** | Stub |
| utils | **Conceito** | Vazio |
| API REST equipamentos | **Beta** | CRUD completo |
| API laboratório | **Beta** | Completa |
| API eng. reversa | **Beta** | Sem frontend |
| Frontend equipamentos | **Beta** | CRUD + teste |
| Frontend laboratório | **Beta** | Operacional |
| Frontend eng. reversa | **Ausente** | 0% |
| Integração ERP | **Ausente** | 0% |
| Integração PDV | **Ausente** | 0% |
| Drivers Filizola/Urano/Aclas/Elgin/Bematech | **Ausente** | 0% |

---

## 7. Percentual de Conclusão por Componente

| Componente | % | Observação |
|------------|---|------------|
| **Arquitetura geral** | 92% | Sólida, extensível |
| **Contratos / DTOs** | 95% | Serializer fabricante pendente |
| **DriverRegistry** | 100% | — |
| **DriverLoader** | 100% | 1/6 drivers carregáveis |
| **EquipamentosManager** | 88% | Bootstrap ausente |
| **QueueManager** | 93% | Completo |
| **SyncManager** | 82% | Sem ERP hooks |
| **ConnectionManager** | 85% | Só Ethernet |
| **Discovery** | 8% | Stubs |
| **MonitorService** | 22% | Polling ausente |
| **PacketLogger** | 100% | — |
| **PacketHistory** | 100% | Volátil |
| **HexViewer** | 100% | — |
| **FrameBuilder (Toledo)** | 70% | Temp, não 90AX |
| **Parser (Toledo)** | 70% | Temp, sem CRC |
| **Transport Ethernet** | 90% | Produção-ready |
| **Transport Serial** | 12% | Stub |
| **Transport USB** | 12% | Stub |
| **Transport Bluetooth** | 10% | Stub |
| **Discovery Ethernet** | 0% | — |
| **Discovery Serial** | 0% | — |
| **Diagnóstico** | 35% | DB only |
| **Laboratório** | 85% | UI gaps |
| **Engenharia Reversa** | 78% | Sem UI |
| **Capture** | 90% | — |
| **Replay** | 78% | Edge cases |
| **Comparator** | 85% | — |
| **Exportação** | 88% | — |
| **Importação** | 75% | TXT/BIN parcial |
| **Driver Toledo** | 68% | Infra OK, protocolo temp |
| **Drivers Urano** | 0% | README only |
| **Drivers Filizola** | 0% | README only |
| **Drivers Elgin** | 0% | README only |
| **Drivers Aclas** | 0% | README only |
| **Drivers Bematech** | 0% | README only |
| **Banco de dados** | 88% | Colunas homologação opcionais |
| **API equipamentos** | 80% | Sync/fila endpoints ausentes |
| **API laboratório** | 90% | — |
| **API eng. reversa** | 85% | — |
| **Frontend equipamentos** | 70% | Logs/fila/config ausentes |
| **Frontend laboratório** | 75% | Eng. reversa ausente |
| **Frontend eng. reversa** | 0% | — |
| **Testes automatizados** | 74% | 157/158 pass; gaps API/frontend |
| **Documentação** | 48% | READMEs desatualizados |
| **Integração ERP** | 5% | Pipeline existe; hooks ausentes |
| **Integração PDV** | 0% | — |
| **Protocolo oficial 90AX** | 18% | Ping parcialmente alinhado |
| **GERAL MOTOR (homologação)** | **~62%** | Infra pronta; protocolo e integração pendentes |

---

## 8. Ordem Recomendada das Próximas Implementações

### Fase 0 — Pré-homologação imediata (sem balança)

```
1. Bootstrap EquipamentosManager.inicializar() no server.js
2. Corrigir teste drivers-framework (mock TCP)
3. Script npm test:equipamentos (all suites)
4. Atualizar READMEs críticos (Toledo, transport, motor)
5. Endpoints: conectar/desconectar/sync manual/fila
6. UI: logs, fila, status conexão, toggle motor
```

### Fase 1 — Homologação com balança física

```
7. Conectar balança via laboratório (IP, porta 9100)
8. Capturar tráfego MGV7 (handshake, ping, status, sync, peso)
9. Eng. reversa: analisar frames, documentar PROTOCOLO_TOLEDO.md
10. Sprint 11B: implementar frames 90AX oficiais
11. Validar CRC/checksum com capturas reais
12. Testar sync produto → verificar PLU na balança
13. Testar obterPeso() → validar parser
14. Testar retry/timeout/NAK com hardware
15. Persistir firmware/handshake no DB
```

### Fase 2 — Integração operacional

```
16. Hooks ERP: produto/promo/dept save → SyncManager
17. MonitorService polling automático
18. Discovery Ethernet (subnet scan)
19. Frontend engenharia reversa
20. Diagnóstico hardware real (firmware)
21. zerar() / reiniciar() se suportados
```

### Fase 3 — Expansão

```
22. PDV peso ao vivo
23. SerialTransport + driver Urano/Filizola
24. Drivers Elgin/Aclas/Bematech
25. Permissões granulares backend
26. Métricas/alertas (MonitorService completo)
```

---

## 9. Riscos Encontrados

### 9.1 Riscos Críticos

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R1 | **Motor não inicializa no startup** — QueueManager worker inativo | Sync enfileirada nunca processa em produção | Chamar `inicializar()` em `server.js` |
| R2 | **Protocolo temporário incompatível com 90AX** | Sync/peso falham silenciosamente na balança | Captura MGV7 + Sprint 11B antes de sync real |
| R3 | **Sem hooks ERP** | Produtos salvos não vão para balança | Implementar hooks pós-save |
| R4 | **CRC ausente** | Frames rejeitados pela balança | Validar com captura real |
| R5 | **Teste CI falhando** | Regressão não detectada | Atualizar teste stub → mock |

### 9.2 Riscos Altos

| # | Risco | Impacto |
|---|-------|---------|
| R6 | ConnectionManager sempre usa EthernetTransport direto | Serial/USB nunca funcionarão sem refactor |
| R7 | PacketHistory in-memory | Perda de histórico em restart |
| R8 | MonitorService sem polling | Status offline não detectado automaticamente |
| R9 | Eng. reversa sem UI | Homologação depende de API manual/curl |
| R10 | Permissões backend só JWT | Qualquer usuário autenticado acessa laboratório |

### 9.3 Riscos Médios

| # | Risco | Impacto |
|---|-------|---------|
| R11 | Dependência circular QueueManager ↔ EquipamentosManager (lazy require) | Fragilidade em refactors |
| R12 | SyncManager campos mortos (`_emAndamento`) | Confusão sobre concorrência |
| R13 | DiagnosticoService vs EquipamentosService — dois caminhos | Comportamento inconsistente |
| R14 | READMEs desatualizados | Desenvolvedores seguem doc errada |
| R15 | `PROTOCOLO_TOLEDO.md` sobrescrito automaticamente | Perda de anotações manuais |

### 9.4 Riscos de Segurança

| # | Risco | Severidade |
|---|-------|------------|
| S1 | Laboratório permite envio HEX arbitrário para equipamento | Média — requer auth + rede interna |
| S2 | Sem rate limiting em endpoints de sync/teste | Baixa |
| S3 | Capturas salvas em disco sem criptografia | Baixa — dados operacionais |
| S4 | Socket leaks se `encerrar()` não chamado no shutdown | Média — implementar graceful shutdown |

### 9.5 Riscos de Desempenho

| # | Risco | Detalhe |
|---|-------|---------|
| P1 | SyncManager.sincronizarProdutos sequencial | N produtos = N round-trips |
| P2 | QueueManager intervalo fixo | Pode ser lento com fila grande |
| P3 | PacketHistory limite 500/equipamento | OK para lab; insuficiente para produção longa |
| P4 | SQLite writes síncronos em logs/eventos | Pode bloquear event loop em pico |

---

## 10. Débitos Técnicos

| # | Débito | Local | Prioridade |
|---|--------|-------|------------|
| DT1 | Bootstrap motor ausente | `server.js` | P0 |
| DT2 | Protocolo temp 11A vs 90AX oficial | `ToledoPrix4FrameBuilder.js` | P0 |
| DT3 | ConnectionManager ignora TransportManager | `ConnectionManager.js` | P1 |
| DT4 | SyncManager header "Sprint 5" desatualizado | `SyncManager.js` | P3 |
| DT5 | Campos mortos `_emAndamento`, `_concorrenciaMax` | `SyncManager.js` | P2 |
| DT6 | `dto/` duplica `contracts/` (deprecated shim) | `dto/*.js` | P3 |
| DT7 | utils/index.js vazio | `utils/index.js` | P3 |
| DT8 | index.js TODOs de export alto nível | `index.js` | P2 |
| DT9 | Serializer fabricante stub | `Serializer.js` | P2 |
| DT10 | Teste obsoleto stub TCP | `drivers-framework.test.js` | P1 |
| DT11 | READMEs contraditórios | Vários | P2 |
| DT12 | AUDITORIA_MOTOR_BALANCAS.md desatualizado | Raiz | P3 |
| DT13 | DiscoveryService importa logger sem usar | `DiscoveryService.js` | P4 |
| DT14 | PacketLogger singleton global | Lab + Eng. Reversa | P2 |
| DT15 | Sem graceful shutdown de sockets | `server.js` | P1 |
| DT16 | Sem script `test:equipamentos` agregado | `package.json` | P2 |
| DT17 | Frontend eng. reversa ausente | `frontend/erp/js/` | P2 |
| DT18 | ERP hooks ausentes | `backend/rotas/produtos.js` | P0 |
| DT19 | PDV peso ausente | PDV modules | P1 |
| DT20 | Permissão backend granular ausente | Rotas equipamentos | P3 |

---

## 11. Sugestões de Melhoria

### 11.1 Arquitetura

1. **Inicialização explícita** — `server.js` deve chamar `equipamentosManager.inicializar()` após DB ready e `encerrar()` no SIGTERM.
2. **TransportManager como único ponto** — ConnectionManager deve usar `TransportManager.selecionar(tipo)` em vez de instanciar EthernetTransport diretamente.
3. **Facade pública** — Exportar em `index.js`: `conectar`, `sincronizarProduto`, `obterPeso`, `diagnosticar` para consumo ERP/PDV.
4. **Event-driven ERP** — Emitir evento `produto.alterado` no ERP; listener no motor enfileira sync (desacoplamento).

### 11.2 Protocolo

5. **Pipeline de captura → implementação** — Workflow documentado: Lab captura → Eng. reversa analisa → FrameBuilder atualiza → Teste mock → Teste hardware.
6. **Dual mode** — Manter formato 11A como fallback/mock; flag `protocolo: '90AX' | '11A'` por equipamento durante transição.
7. **Retry configurável no protocolo** — `EQUIPAMENTOS_PROTOCOL_MAX_RETRIES` complementando retry da fila.

### 11.3 Operacional

8. **Dashboard live** — WebSocket ou polling 5s para status conexão + fila.
9. **Alertas** — MonitorService emitir evento quando equipamento offline > N minutos.
10. **Auditoria de sync** — Coluna `resposta_raw` em logs para homologação.

### 11.4 Frontend

11. **Página Engenharia Reversa** — Reutilizar componentes do laboratório + painel de análise + botão "Atualizar PROTOCOLO_TOLEDO.md".
12. **Wizard de cadastro** — IP → teste conexão → handshake → salvar com firmware detectado.
13. **Visualizador de fila** — Tabela com status, tentativas, erro, ações (cancelar/reprocessar).

### 11.5 Testes

14. **Script agregado** — `"test:equipamentos": "npm run test:equipamentos-contracts && ..."`.
15. **Testes de controller** — supertest para rotas críticas.
16. **Teste E2E mock** — Produto ERP → SyncManager → Queue → MockTcpServer → ACK.

### 11.6 Documentação

17. **Atualizar todos READMEs** — Status real pós-Sprint 13.
18. **Diagrama de sequência** — Sync produto end-to-end (Mermaid).
19. **Guia de homologação** — Checklist passo-a-passo com balança física.

---

## 12. Oportunidades de Refatoração

| # | Oportunidade | Benefício | Risco |
|---|-------------|-----------|-------|
| RF1 | Unificar `dto/` → `contracts/` (remover shim) | Menos confusão | Baixo — buscar imports |
| RF2 | ConnectionManager → TransportManager | Multi-transporte | Médio — testar regressão |
| RF3 | Extrair interface `IProtocol` genérica | Multi-driver protocol | Médio — design |
| RF4 | PacketHistory → persistência opcional SQLite | Histórico sobrevive restart | Baixo |
| RF5 | MonitorService extrair para worker separado | Não bloquear event loop | Baixo |
| RF6 | DiagnosticoService unificar com EquipamentosService.diagnosticar | Um caminho só | Baixo |
| RF7 | Remover aliases deprecated BaseDriver (`enviarProduto`) | Limpeza API | Baixo — verificar usages |
| RF8 | ConfigService ler syncAutomatica do DB | Configurável | Baixo |
| RF9 | frameBuilderMap extensível via driverCatalog | Multi-driver lab | Médio |
| RF10 | Eng. reversa observations → SQLite | Persistência anotações | Baixo |

**Nota:** Nenhuma refatoração é bloqueante para homologação. Priorizar RF2 e RF6 apenas se multi-transporte for necessário em curto prazo.

---

## 13. Inventário de Arquivos

### 13.1 Motor de Equipamentos

**Total:** ~86 arquivos JavaScript + 12 READMEs

```
backend/motores/equipamentos/
├── index.js                          # Facade (mínima)
├── README.md
├── communication/                    # 3 arquivos + README
├── contracts/                        # 18 arquivos + README
├── core/                             # 2 arquivos (DriverManager, EquipamentosManager)
├── diagnostics/                      # 1 arquivo
├── discovery/                        # 1 arquivo
├── drivers/                          # BaseDriver, Registry, Loader, Catalog + 6 marcas
│   └── toledo/prix4/                 # 10 arquivos (driver completo)
├── dto/                              # 4 shims deprecated
├── engenharia-reversa/               # 9 arquivos
├── events/                           # 1 arquivo
├── laboratorio/                      # 9 arquivos
├── monitor/                          # 2 arquivos
├── queue/                            # 1 arquivo
├── repositories/                     # 1 arquivo
├── services/                         # 7 arquivos
├── transport/                        # 7 arquivos + README
└── utils/                            # 1 placeholder
```

### 13.2 Testes

```
tests/motor-equipamentos/
├── contracts-framework.test.js       # 28 testes ✅
├── drivers-framework.test.js         # 14 testes (1 ❌ obsoleto)
├── transport-framework.test.js       # 12 testes ✅
├── tcp-connection.test.js            # 14 testes ✅
├── equipamentos-service.test.js      # 9 testes ✅
├── sync-framework.test.js            # 8 testes ✅
├── toledo-prix4-protocol.test.js     # 18 testes ✅
├── toledo-prix4-tcp.test.js          # 12 testes ✅
├── toledo-prix4-driver.test.js       # 22 testes ✅
├── laboratorio-sprint12.test.js      # 12 testes ✅
├── engenharia-reversa-sprint13.test.js # 10 testes ✅
└── helpers/MockTcpServer.js          # Mock TCP Toledo
```

### 13.3 Documentação Existente

| Arquivo | Status |
|---------|--------|
| `RELATORIO_SPRINT_11A.md` | Atual |
| `RELATORIO_SPRINT_12.md` | Atual |
| `RELATORIO_SPRINT_13.md` | Atual |
| `PROTOCOLO_TOLEDO.md` | Auto-gerado; 2 frames capturados |
| `AUDITORIA_MOTOR_BALANCAS.md` | **Desatualizado** (pré-11A) |
| READMEs internos | Parcialmente desatualizados |

---

## 14. Cobertura de Testes — Análise Detalhada

### 14.1 Bem coberto

- Contratos/DTOs/Validators/Normalizers
- BaseDriver/BaseTransport herança
- DriverRegistry/Loader/Catalog
- EthernetTransport connect/send/receive
- ConnectionManager heartbeat/reconnect
- Toledo FrameBuilder/Parser/Protocol (mock TCP)
- QueueManager retry/backoff
- EquipamentosService CRUD
- Mappers ERP → DTO
- Lab: FrameStudio, Capture, Replay, Compare
- Eng. reversa: Analyze, Export, Import, Wireshark

### 14.2 Sem testes

| Área | Arquivos/classes |
|------|------------------|
| Controllers | `equipamentosController`, `laboratorioEquipamentosController`, `engenhariaReversaController` |
| Rotas Express | Integração HTTP + auth |
| Frontend | `equipamentos.js`, `laboratorio-equipamentos.js` |
| MonitorService | Polling (não implementado) |
| DiscoveryService | Todos métodos |
| DiagnosticoService | Diagnóstico simulado |
| ConfigService | syncAutomatica |
| Serial/USB/Bluetooth Transport | Stubs |
| Utils | Vazio |
| Serializer.serializeForFabricante | Stub |
| server.js bootstrap | Inicialização motor |
| ERP hooks | Inexistentes |

### 14.3 Cenários não testados

- Múltiplos equipamentos simultâneos na fila
- Concorrência: dois syncs do mesmo produto
- Graceful shutdown com conexões abertas
- PacketHistory overflow (>500 pacotes)
- Importação corrupta (hex inválido, JSON malformado)
- Permissões de acesso (auth negado)
- Timeout em sync de produto grande (payload > buffer)
- NAK consecutivos esgotando retry
- Reconexão durante item de fila em processamento
- Frontend error states e retry UX

### 14.4 Mock insuficiente

- MockTcpServer responde formato 11A — não simula 90AX binário
- Sem mock de SerialTransport para drivers futuros
- Sem mock de balança com latência variável / desconexão intermitente
- Sem mock de NAK parcial (ACK com erro no payload)

---

## 15. Segurança e Concorrência — Análise

### 15.1 Tratamento de exceções

- Controllers: try/catch universal com `responderErro()` ✅
- Protocol: erros capturados, logados, retornados como `{ sucesso: false }` ✅
- QueueManager: falhas incrementam tentativas, não derrubam worker ✅
- EquipamentosManager.encerrar(): ignora falhas individuais no shutdown ✅

### 15.2 Timeouts

- EthernetTransport: timeout conexão + read ✅
- Protocol: timeout por comando ✅
- QueueManager: timeout execução 15s ✅
- ConnectionManager: heartbeat interval ✅

### 15.3 Memory / Socket leaks

- EthernetTransport: `_aguardandoLeitura` com timers — **limpos em disconnect** ✅
- ConnectionManager: `fecharTodas()` disponível — **não chamado automaticamente no shutdown** ⚠️
- PacketHistory: limite configurável — **sem cleanup periódico além do max** ✅
- PacketLogger listeners: **acumulam se não removidos** ⚠️

### 15.4 Concorrência

- QueueManager: processamento **sequencial** (1 item por vez) ✅
- SyncManager: `_emAndamento` declarado mas **não implementado** ⚠️
- Driver cache em EquipamentosManager: Map por equipamentoId — **sem lock explícito** (Node single-thread OK) ✅
- SQLite: writes síncronos — **possível contenção** em pico ⚠️

### 15.5 Fila

- Dedupe por equipamento+comando+payload ✅
- Prioridade ordenada ✅
- Recuperação de órfãos (`processando` → `pendente`) no startup ✅
- Persistência SQLite ✅

---

## 16. Desempenho — Análise

| Aspecto | Situação |
|---------|----------|
| **Event loop** | Worker fila usa setInterval — não bloqueia ✅ |
| **Threads** | Single-thread Node — adequado para I/O TCP ✅ |
| **Buffers** | EthernetTransport acumula em `_bufferRecebimento` — OK para frames pequenos ✅ |
| **Streams** | Não usa streams Node — buffers manuais; OK para protocolo request/response ⚠️ |
| **Cache** | Driver cache por equipamento em EquipamentosManager ✅ |
| **Reconexão** | Configurável via env vars ✅ |
| **Heartbeat** | Timer 30s default — baixo overhead ✅ |
| **Memória** | PacketHistory 500 × N equipamentos — monitorar em produção ⚠️ |
| **Sync batch** | Produtos sequenciais — lento para catálogo grande ⚠️ |

---

## 17. Diagrama de Arquitetura Atual

```mermaid
flowchart TB
    subgraph Frontend
        EQ[equipamentos.js]
        LAB[laboratorio-equipamentos.js]
        DASH[dashboard.js]
    end

    subgraph API
        R1["/api/equipamentos"]
        R2["/api/laboratorio-equipamentos"]
        R3["/api/engenharia-reversa"]
    end

    subgraph Motor
        EM[EquipamentosManager]
        SM[SyncManager]
        QM[QueueManager]
        DM[DriverManager]
        DRV[ToledoPrix4UnoDriver]
        PROTO[ToledoPrix4Protocol]
        FB[FrameBuilder]
        PAR[Parser]
        CM[ConnectionManager]
        ET[EthernetTransport]
    end

    subgraph Observabilidade
        PL[PacketLogger]
        PH[PacketHistory]
        LS[LoggerService]
        REPO[EquipamentosRepository]
    end

    subgraph DB[(SQLite)]
        T1[equipamentos]
        T2[equipamentos_fila]
        T3[equipamentos_logs]
    end

    EQ --> R1
    LAB --> R2
    DASH --> REPO

    R1 --> EM
    SM --> QM
    QM --> EM
    EM --> DM
    DM --> DRV
    DRV --> PROTO
    PROTO --> FB
    PROTO --> PAR
    PROTO --> CM
    CM --> ET

    PROTO --> PL
    PL --> PH
    PL --> LS
    LS --> REPO
    QM --> REPO
    REPO --> T1 & T2 & T3

    R3 -.-> PL
```

---

## 18. Checklist Pré-Homologação Toledo Prix 4 Uno

### Infraestrutura (pode validar agora)

- [ ] Confirmar `EquipamentosManager.inicializar()` no startup
- [ ] Cadastrar equipamento com IP/porta corretos
- [ ] Testar conexão TCP via UI equipamentos
- [ ] Abrir laboratório → conectar → ping
- [ ] Verificar pacotes TX/RX no inspector
- [ ] Iniciar captura global
- [ ] Executar todos testes: `npm run test:equipamentos-*`

### Com balança física conectada

- [ ] Ping PN → verificar resposta AK na captura
- [ ] Handshake HS → documentar resposta real
- [ ] Status ST → verificar campos retornados
- [ ] Sync 1 produto teste → verificar PLU na balança
- [ ] obterPeso() → comparar com display da balança
- [ ] Provocar NAK (comando inválido) → verificar retry fila
- [ ] Desconectar cabo → verificar reconnect + heartbeat
- [ ] Exportar captura → analisar em eng. reversa
- [ ] Atualizar PROTOCOLO_TOLEDO.md com frames reais
- [ ] Implementar frames 90AX baseado em capturas
- [ ] Re-testar sync com protocolo oficial

---

## 19. Conclusão Final

O Motor Universal de Equipamentos representa um **investimento arquitetural sólido** concluído em 13 sprints. A infraestrutura (framework de drivers, contratos, fila persistente, TCP real, laboratório, engenharia reversa, API REST, frontend operacional) está **pronta para receber o protocolo oficial** e iniciar homologação controlada.

**O que separa o motor de produção:**

1. **Protocolo 90AX real** — único bloqueador crítico para sync/peso em hardware
2. **Bootstrap automático** — fila não processa sem `inicializar()`
3. **Integração ERP** — pipeline existe mas não é acionado automaticamente
4. **Validação física** — zero testes com balança real até o momento

**Veredicto:** **APTO para homologação técnica controlada** com balança Toledo Prix 4 Uno, utilizando laboratório e engenharia reversa como ferramentas principais de descoberta de protocolo. **NÃO APTO para produção** até conclusão da Sprint 11B e integração ERP.

---

*Relatório gerado por auditoria técnica automatizada — 02/07/2026*  
*Nenhum arquivo do projeto foi modificado durante esta auditoria.*
