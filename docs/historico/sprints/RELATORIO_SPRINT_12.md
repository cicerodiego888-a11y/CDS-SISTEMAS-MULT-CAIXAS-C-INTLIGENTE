# Relatório Sprint 12 — Laboratório de Engenharia e Diagnóstico

**Projeto:** CDS Sistemas — Motor Universal de Equipamentos  
**Data:** 01/07/2026  
**Escopo:** Adicionar laboratório integrado sem alterar arquitetura aprovada na auditoria.

---

## Resumo executivo

A Sprint 12 entrega um **Laboratório de Engenharia** completo e desacoplado, capaz de montar frames, inspecionar pacotes, capturar sessões, reproduzir comunicação, comparar capturas e diagnosticar equipamentos — inicialmente validado com Toledo Prix 4 Uno, mas projetado para qualquer driver futuro via `frameBuilderMap`.

**Restrições respeitadas:** BaseDriver, DriverRegistry, DriverLoader, DTOs, Repositories, QueueManager, Protocol existente, banco, APIs REST e UI de equipamentos **não foram modificados** em comportamento — apenas extensões aditivas.

---

## Arquivos criados

### Backend — Módulo `laboratorio/`

| Arquivo | Responsabilidade |
|---------|------------------|
| `backend/motores/equipamentos/laboratorio/FrameStudio.js` | Montagem de frames via FrameBuilder, HEX/ASCII, offsets, tamanho |
| `backend/motores/equipamentos/laboratorio/PacketInspector.js` | Visualização enriquecida TX/RX, latência, ACK/NAK |
| `backend/motores/equipamentos/laboratorio/CaptureManager.js` | Captura, exportação (JSON/HEX/TXT/BIN), importação, listagem |
| `backend/motores/equipamentos/laboratorio/ReplayManager.js` | Reenvio de pacotes e comparação de resposta |
| `backend/motores/equipamentos/laboratorio/PacketComparator.js` | Diff de buffers e capturas, checksum mod 256 |
| `backend/motores/equipamentos/laboratorio/DiagnosticoEquipamentos.js` | ping, status, latência, socket, heartbeat, driver, modelo, firmware, IP, porta, MAC |
| `backend/motores/equipamentos/laboratorio/LaboratorioEquipamentos.js` | Fachada orquestradora |
| `backend/motores/equipamentos/laboratorio/frameBuilderMap.js` | Mapa declarativo driver → FrameBuilder (sem acoplamento direto) |
| `backend/motores/equipamentos/laboratorio/index.js` | Exports públicos |

### API REST (nova rota)

| Arquivo | Responsabilidade |
|---------|------------------|
| `backend/controllers/laboratorioEquipamentosController.js` | Handlers HTTP |
| `backend/rotas/laboratorioEquipamentos.js` | Rotas `/api/laboratorio-equipamentos` |

### Frontend

| Arquivo | Responsabilidade |
|---------|------------------|
| `frontend/erp/js/laboratorio-equipamentos.js` | Tela Laboratório de Equipamentos |

### Testes

| Arquivo | Responsabilidade |
|---------|------------------|
| `tests/motor-equipamentos/laboratorio-sprint12.test.js` | Suite Sprint 12 com Mock TCP |

### Documentação

| Arquivo | Responsabilidade |
|---------|------------------|
| `RELATORIO_SPRINT_12.md` | Este relatório |

---

## Arquivos alterados (extensões aditivas)

| Arquivo | Alteração |
|---------|-----------|
| `backend/motores/equipamentos/communication/PacketLogger.js` | `adicionarListener()`, `_notificarListeners()`, campo `buffer` na entry |
| `backend/server.js` | Mount `app.use('/api/laboratorio-equipamentos', ...)` |
| `frontend/erp/js/app.js` | Case `laboratorio-equipamentos` no roteador |
| `frontend/erp/index.html` | Script + item de menu "Lab. Equipamentos" |
| `frontend/erp/js/configuracoes.js` | Botão de acesso ao laboratório |
| `frontend/shared/js/access-control.js` | Permissão `laboratorio-equipamentos` → `configuracoes` |
| `package.json` | Script `test:equipamentos-laboratorio` |

---

## Funcionalidades entregues por etapa

### Etapa 1 — Frame Studio
- Montagem via `FrameBuilder` do driver (`frameBuilderMap`)
- Visualização HEX, ASCII, offsets, tamanho
- Conversão ASCII ↔ HEX
- `prepararPayload()` para JSON/texto

### Etapa 2 — Packet Inspector
- Timestamp, TX/RX, HEX, ASCII, bytes, driver, equipamento, IP, porta
- Tempo de resposta, ACK, NAK, erro, timeout
- Integração com `PacketHistory` + sessão local

### Etapa 3 — Capture Manager
- `iniciarCaptura()`, `pararCaptura()`, `exportar()`, `importar()`, `listarCapturas()`, `abrirCaptura()`
- Persistência em `ProgramData/CDS Sistemas/laboratorio-equipamentos/capturas` (Windows)

### Etapa 4 — Replay Manager
- Seleção de captura → pacote por índice → reenvio → resposta → comparação opcional

### Etapa 5 — Packet Comparator
- Bytes alterados, inseridos, removidos, tamanho, checksum simples (mod 256)

### Etapa 6 — Diagnóstico
- `DiagnosticoEquipamentos.js` com todos os métodos solicitados via `EquipamentosManager`

### Etapa 7 — Tela
- Conectar, Desconectar, Ping, Status, Enviar HEX/ASCII, Limpar, Salvar/Abrir Captura, Replay, Comparar, Exportar
- Aba Frame Builder para montagem de frames

### Etapa 8 — Logs
- Hook automático: `PacketLogger.adicionarListener` → `LaboratorioEquipamentos._onPacote` → Inspector + CaptureManager

### Etapa 9 — Testes
- 12 testes com Mock TCP e protocol mock

---

## API REST — Endpoints

Base: `/api/laboratorio-equipamentos` (requer token)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/drivers` | Drivers com flag `laboratorio_frame_builder` |
| GET | `/equipamentos` | Lista equipamentos ativos |
| GET | `/capturas` | Lista capturas em disco |
| GET | `/capturas/:capturaId` | Abre captura |
| POST | `/frame` | Monta frame |
| POST | `/util/converter` | ASCII ↔ HEX |
| POST | `/comparar/capturas` | Compara duas capturas |
| POST | `/comparar/hex` | Compara dois HEX |
| POST | `/captura/iniciar` | Inicia captura global |
| POST | `/captura/parar` | Para captura |
| POST | `/captura/salvar` | Exporta captura |
| GET | `/:id/pacotes` | Lista pacotes |
| DELETE | `/:id/pacotes` | Limpa pacotes |
| POST | `/:id/conectar` | Conecta |
| POST | `/:id/desconectar` | Desconecta |
| POST | `/:id/ping` | Ping |
| GET | `/:id/status` | Status |
| GET | `/:id/diagnostico` | Diagnóstico completo |
| POST | `/:id/enviar/hex` | Envia HEX |
| POST | `/:id/enviar/ascii` | Envia ASCII |
| POST | `/:id/captura/iniciar` | Inicia captura com meta do equipamento |
| POST | `/:id/replay` | Replay de pacote |

---

## Cobertura dos testes

**Comando:** `npm run test:equipamentos-laboratorio`  
**Resultado:** **12/12 OK**

| Módulo | Cenários cobertos |
|--------|-------------------|
| FrameStudio | Montagem ping Toledo, ASCII↔HEX, tamanho, payload |
| PacketInspector | Enriquecimento TX/RX, latência, listagem |
| PacketLogger | Listener → Inspector |
| CaptureManager | Ciclo captura, export JSON/HEX/TXT/BIN, listar, abrir |
| PacketComparator | Diff buffers, comparação de capturas |
| ReplayManager | Protocol mock, replay de captura exportada |
| DiagnosticoEquipamentos | Helpers ip/porta/mac/driver |
| Integração TCP | ToledoPrix4Protocol + MockTcpServer modo Toledo |

---

## Fluxo operacional

```
Motor Universal
    ↓
Selecionar Driver / Equipamento
    ↓
Conectar → Enviar Pacotes (HEX/ASCII/Frame)
    ↓
PacketLogger → PacketInspector (automático)
    ↓
Capturar → Salvar (JSON/HEX/TXT/BIN)
    ↓
Replay → Comparar capturas → Exportar
    ↓
Diagnóstico (ping, status, latência, socket, …)
```

---

## Pendências

| Item | Prioridade | Observação |
|------|------------|------------|
| CRC/checksum oficial 90AX | Alta | Sprint 11B — comparator usa mod 256 provisório |
| Replay por pacote da sessão ao vivo (sem captura salva) | Média | UI orienta selecionar captura para replay por índice |
| MAC via descoberta de rede | Baixa | Depende de ARP/snmp no equipamento |
| Permissão dedicada `laboratorio` | Baixa | Hoje herda `configuracoes` |
| Download de captura pelo browser | Média | Exportação ocorre no servidor (ProgramData) |

---

## Débito técnico

1. **Checksum:** `PacketComparator._checksumSimples` é placeholder até CRC 90AX (Sprint 11B).
2. **Nomenclatura:** `hexParaAscii` em `FrameStudio` retorna buffer — nome histórico, semântica invertida em relação ao nome.
3. **Capturas:** diretório fixo em ProgramData — sem configuração por usuário.
4. **Singleton global:** `LaboratorioEquipamentos` registra listener no boot — em testes paralelos pode haver cross-talk (mitigado por `reiniciar()` nos testes TCP).
5. **frameBuilderMap:** novos drivers exigem entrada manual no mapa (by design, evita acoplamento).

---

## Sugestões para Sprint 13

1. **Sprint 11B + Lab:** integrar frames 90AX oficiais e exibir CRC no Frame Studio e Comparator.
2. **WebSocket/SSE:** streaming de pacotes em tempo real na UI (eliminar polling 2,5s).
3. **Replay wizard:** selecionar pacote da sessão atual sem exigir captura salva.
4. **Export ZIP:** baixar captura (JSON+HEX+BIN) via API para o cliente.
5. **Templates de frame:** biblioteca de comandos frequentes por driver.
6. **Diff visual:** highlight byte-a-byte na UI (estilo hex editor).
7. **Integração PDV:** painel de peso ao vivo usando o mesmo PacketInspector.
8. **Automação:** scripts de regressão a partir de capturas MGV reais.

---

## Como executar

```bash
# Testes do laboratório
npm run test:equipamentos-laboratorio

# Suite Toledo (regressão)
npm run test:equipamentos-toledo-protocol
npm run test:equipamentos-toledo-tcp
```

**UI:** ERP → menu **Lab. Equipamentos** ou Configurações → **Laboratório de Engenharia**.

---

*CDS Sistemas — Motor Universal de Equipamentos — Sprint 12 concluída.*
