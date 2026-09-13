# Certificação e Homologação V2.0 — Toledo Prix IV Uno

**Sprint:** 14.12  
**Driver:** `TOLEDO_PRIX4`  
**Homologação:** `14.12-V2.0`  
**Protocolo (framing):** Lab V1 — `[STX][CMD 2][SEP][payload][CHK 2 hex][ETX]`  
**Modelo alvo:** Toledo Prix IV Uno · Firmware alvo: `90AX`

---

## 1. Arquitetura final

```
Central Equipamentos / PDV / ERP
        ↓
Discovery → Fingerprint → ConnectionManager
        ↓
Driver Toledo (framing + handshake/ping)
        ↓
Engineering Lab (passivo) · Operation Engine (FIFO)
        ↓
PLU · Sync · Weight · Configuration · Monitor
        ↓
ConnectionManager → TcpConnection → Balança
```

**Regra de ouro:** nenhum módulo de negócio acessa `TcpConnection` / `net` diretamente. Apenas `ConnectionManager`.

---

## 2. Módulos certificados (14.1–14.11)

| Sprint | Módulo | Pacote |
|--------|--------|--------|
| 14.1 | Discovery Engine | `motores/equipamentos/discovery/` |
| 14.2 | Fingerprint Engine | `motores/equipamentos/fingerprint/` |
| 14.3 | Connection Manager | `motores/equipamentos/connection/` |
| 14.4 | Driver Toledo | `drivers/toledo/` |
| 14.5 | Engineering Lab | `motores/equipamentos/laboratorio/` |
| 14.6 | Operation Engine | `drivers/toledo/operations/` |
| 14.7 | PLU Upload | `drivers/toledo/plu/` |
| 14.8 | Sync PLU | `drivers/toledo/sync/` |
| 14.9 | Weight Engine | `drivers/toledo/weight/` |
| 14.10 | Equipment Monitor | `motores/equipamentos/monitor/` |
| 14.11 | Configuration Engine | `drivers/toledo/configuration/` |
| 14.12 | Certificação | `drivers/toledo/certificacao/` |

---

## 3. Fluxo completo (operacional)

1. **Descobrir** equipamentos (porta TCP 9000)  
2. **Identificar** (fingerprint passivo)  
3. **Conectar** via Connection Manager  
4. **Handshake / Ping** via Operation Engine  
5. **PLU** upload / download / compare / sync (com confirmação)  
6. **Peso** leitura única  
7. **Configuração** read / write / profile / restore  
8. **Monitor** heartbeat periódico (sem auto-reconnect)  
9. **Lab** captura passiva TX/RX  
10. **Diagnóstico** health / version / certification report  

---

## 4. APIs principais

### Capabilities homologadas (`ToledoCapabilities`)

Fonte de verdade: `backend/motores/equipamentos/drivers/toledo/ToledoCapabilities.js`

| Capability | Homologado |
|------------|------------|
| `handshake` | ✔ |
| `ping` | ✔ |
| `uploadPLU` | ✔ |
| `downloadPLU` | ✔ |
| `syncPLU` | ✔ |
| `readWeight` | ✔ |
| `monitor` | ✔ |
| `downloadConfig` | ✔ |
| `writeConfig` | ✔ |
| `writeLabel` | ✖ |
| `firmwareUpdate` | ✖ |
| `autoReconnect` | ✖ |

API: `GET /api/equipamentos/driver/toledo/capabilities`

### Driver / Diagnóstico (14.12)

| Método | Rota |
|--------|------|
| GET | `/api/equipamentos/driver/toledo/health` |
| GET | `/api/equipamentos/driver/toledo/diagnostics` |
| GET | `/api/equipamentos/driver/toledo/version` |
| GET | `/api/equipamentos/driver/toledo/certification` |
| GET | `/api/equipamentos/driver/toledo/architecture` |
| GET | `/api/equipamentos/driver/toledo/capabilities` |
| POST | `/api/equipamentos/driver/toledo/connect` |
| POST | `/api/equipamentos/driver/toledo/disconnect` |

### Demais superfícies (resumo)

- Connection: `/connect`, `/status`, `/disconnect`, `/reconnect`
- Lab: `/lab/start|stop|pause|resume|status|session|export`
- Operations: `/operations/ping|handshake|identify|history|status|cancel`
- PLU: `/plu/upload|upload-many|history|status|cancel|retry`
- Sync: `/plu/download|compare|sync|sync/history|sync/:id`
- Weight: `/weight/read|status|history`
- Monitor: `/monitor/start|stop|pause|resume|status|history`
- Config: `/config/read|write|compare|restore|history|export|import|profiles`

---

## 5. Tabelas de persistência

| Tabela | Uso |
|--------|-----|
| `equipamentos_conexoes` | Connection Manager |
| `equipamentos_identificados` | Fingerprint |
| `equipamentos_capturas` / `equipamentos_frames` | Lab |
| `equipamentos_operacoes` | Operation Engine |
| `equipamentos_plu_sync` | Upload PLU |
| `equipamentos_sync` / `equipamentos_sync_itens` | Sync |
| `equipamentos_pesagens` | Weight |
| `equipamentos_monitor` | Monitor |
| `equipamentos_config_profiles` / `equipamentos_config_history` | Configuration |

---

## 6. Eventos (principais)

- Monitor: `MONITOR_STARTED`, `DEVICE_ONLINE`, `DEVICE_OFFLINE`, `HEARTBEAT_OK`, `HEARTBEAT_TIMEOUT`, `MONITOR_STOPPED`
- Weight: `WEIGHT_REQUESTED`, `WEIGHT_RECEIVED`, `WEIGHT_TIMEOUT`, `WEIGHT_ERROR`

---

## 7. Erros (camadas)

Cada motor possui códigos próprios (`PluError`, `SyncError`, `WeightError`, `ConfigurationError`, `OperationError`, `ToledoError`). A API responde com `{ success:false, error, code }`.

---

## 8. Guia de integração (novo fabricante)

1. Implementar **Driver + Protocol + FrameBuilder/Parser** no padrão Lab V1 (ou framing validado no Lab).  
2. Expor operações via **Operation Engine** (nunca `net` direto).  
3. Reutilizar Connection Manager, Monitor, Lab e contratos (`PesoDTO`, mappers).  
4. Registrar capabilities e rotas espelhando o Toledo.  
5. Rodar `npm run test:certification-v2` + suíte específica do driver.

---

## 9. Guia de operação

1. Central de Equipamentos → **Procurar** → Fingerprint → **Conectar**.  
2. Validar **Operações** (PING/Handshake).  
3. Opcional: **Laboratório** para capturar frames.  
4. **Sincronização PLUs** / **Sincronização** (compare + confirmar).  
5. **Pesagem** sob demanda no PDV (`WeightService`, auto-read desligado por padrão).  
6. **Monitor** para heartbeat (sem auto-reconexão).  
7. **Configuração** com perfis e histórico.  
8. **Diagnóstico** para health, checklist e versão.

---

## 10. Testes de homologação

```bash
npm run test:certification-v2
npm run test:equipamentos-14x
```

`test:equipamentos-14x` executa todas as suítes 14.1–14.12.

### Critérios

- Auditoria arquitetural 11/11 OK  
- Checklist de homologação completo  
- Estabilidade simulada (pool de 1 driver por host:porta)  
- Recuperação após timeout sem corrupção de estado  
- Volume (1000 PLUs no comparator/planner)  
- Sem firmware update / auto-reconnect / auto-sync

---

## 11. Declaração de homologação

O Driver Toledo Prix IV Uno V1.0, com framing Lab V1 validado (Sprints 14.1–14.11) e pacote de certificação 14.12, está **apto para produção** no escopo das capacidades declaradas em `ToledoCapabilities`, preservando a reutilização do Motor Universal de Equipamentos para novos fabricantes mediante troca apenas da camada Driver/Protocolo.
