# Discovery Engine — Documentação Técnica (RC1 / RC1.1 / RC2)

## Escopo

| RC | Transportes |
|----|-------------|
| RC1 / RC1.1 | Ethernet |
| RC2 | Ethernet + Serial + USB |
| **RC2.1** | + **Motor de Identidade (MIE)** — pós-Discovery |
| **RC3.0** | + **Central de Equipamentos** (painel / dashboard) |
| **RC3.1** | + **Heartbeat / Monitoramento Inteligente** |
| **RC4.0** | + **Drivers Oficiais** (Toledo, Filizola, Urano, Aclas, Elgin, Bematech) |
| **RC5.0** | + **Integração Corporativa** (fora do Motor V1 congelado) |
| RC5+ | Bluetooth / Wi‑Fi (planejado) |

Arquitetura congelada (RC0 / RC0.1) — **não alterar**:

```text
DiscoveryService
  → DriverRegistry (listar / buscarPorTransporte / instanciar)
    → Driver.descobrir()
      → XxxDiscovery (ToledoPrix4 / SerialPort / UsbDevice)
        → Transport (Ethernet / Serial / USB)
          → Candidate DTO
            → API POST /api/equipamentos/discovery
              → Frontend
                → EquipamentosService.criar()
```

Cadastro **nunca** é automático no discovery.

---

## Fluxo oficial (RC2)

1. Cliente chama `POST /api/equipamentos/discovery` com `DiscoveryOptions` (`transportes` opcional).
2. Sem `transportes` → default `['ethernet']` (compatível RC1).
3. Com `transportes` → `DiscoveryService.descobrirTodos()` executa cada transporte de forma **isolada**.
4. Agrega candidatos, deduplica por `assinatura`, marca `ja_cadastrado`, ordena por `confianca`.
5. Persiste sessão opcional em `equipamentos_discovery_sessoes`.
6. UI filtra Todos / Ethernet / Serial / USB; **Cadastrar** → `EquipamentosService.criar()`.
7. Cancelamento: `POST /api/equipamentos/discovery/cancel`.

---

## DiscoveryOptions (contrato preservado)

Campos existentes continuam válidos. Uso RC2 (sem quebrar schema):

| Campo | Uso |
|-------|-----|
| `transportes` | `['ethernet','serial','usb']` ou subset |
| `timeoutMs` / `concorrencia` | Ethernet (e fallback) |
| `timeoutMsSerial` / `concorrenciaSerial` | Serial |
| `timeoutMsUsb` / `concorrenciaUsb` | USB |
| `portas_com` | Override enumeração COM |
| `dispositivos_usb` | Override enumeração USB |
| `persistir_sessao` | default `true` |

---

## Candidate DTO (compatível RC0.1)

Obrigatórios inalterados. Preenchimento RC2:

| Transporte | Campos |
|------------|--------|
| Ethernet | `ip`, `porta` |
| Serial | `porta_com` |
| USB | `caminho_dispositivo`, `vid`, `pid` |

Assinatura inclui também `caminho_dispositivo|vid|pid` (auxiliar, não PK).

---

## Serial

- Enumeração Windows via `sdkDetector.listarPortasCOM()` (TEF).
- Linux: `/dev/ttyUSB*`, `/dev/ttyS*`, `/dev/ttyACM*`.
- Probe rápido: `SerialTransport.probeRapido()` (open/close se `serialport` disponível; senão só existência).
- **Nunca** mantém porta aberta.

## USB

- Windows: `sdkDetector.listarDispositivosUsb()` (PnP + VID/PID).
- Linux: sysfs `/sys/bus/usb/devices`.
- Match por VID/PID e/ou keywords do driver.
- `UsbTransport.probeRapido()` confirma presença na enumeração.

---

## Drivers Serial/USB (catálogo)

| Código | Transportes |
|--------|-------------|
| FILIZOLA_PLATINA | serial, ethernet |
| URANO_POP | serial |
| ACLAS_LS2 | serial, usb |
| ELGEN_BALANCA | serial |
| BEMATECH_BP5 | serial |
| GENERIC_SERIAL | serial |
| GENERIC_USB | usb |
| TOLEDO_PRIX4_UNO | ethernet |

`DiscoveryService` usa `DriverRegistry.buscarPorTransporte()`.

---

## Sessões

Tabela `equipamentos_discovery_sessoes`: assinaturas, duração, transportes, payload resumido.  
API: `GET /api/equipamentos/discovery/sessoes`.

---

## RC2.1 — Motor de Identidade (MIE)

Camada **após** o Discovery (não altera Discovery / CandidateDTO / Registry / EquipamentosService):

```text
Discovery → IdentidadeService.enriquecerCandidatos() → candidatos + identidade → UI/Cadastro
```

### Prioridade da chave

1. Serial Number → 2. MAC → 3. Firmware+Modelo → 4. VID/PID → 5. Driver → 6. Assinatura

### Score

| Score | Classe |
|------:|--------|
| ≥ 95% | Mesmo equipamento |
| ≥ 70% | Provavelmente o mesmo |
| ≥ 40% | Semelhante |
| 0% | Novo |

### Status UI

`novo` · `conhecido` · `ip_alterado` · `firmware_alterado` · `porta_alterada`

### Persistência

- `equipamentos_identidades`
- `equipamentos_identidades_historico` (IP_ALTERADO, FIRMWARE_ALTERADO, VISTO, CRIADO)
- vínculo com sessões de discovery

### API

| Método | Rota |
|--------|------|
| GET | `/api/equipamentos/identidades` |
| GET | `/api/equipamentos/identidades/:id` |

Discovery continua em `POST /api/equipamentos/discovery` (enriquecimento automático; `enriquecer_identidade: false` desliga).

---

## Testes

```bash
npm run test:equipamentos-discovery-rc1
npm run test:equipamentos-discovery-rc11
npm run test:equipamentos-discovery-rc2
npm run test:equipamentos-mie-rc21
npm run test:equipamentos-central-rc3
npm run test:equipamentos-heartbeat-rc31
npm run test:equipamentos-drivers-rc4
npm run test:equipamentos-integracao-rc5
```

---

## RC3.0 — Central de Equipamentos

Painel ERP que **consome** Discovery, MIE e EquipamentosService — sem alterá-los.

### API (`/api/central-equipamentos`)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/dashboard` | Totais / online / offline / novos / problemas / health |
| GET | `/lista` | Itens unificados + filtros |
| GET | `/historico` | Linha do tempo |
| GET | `/saude` | Health Score |
| GET | `/sessoes` | Sessões de discovery |
| POST | `/descobrir` | Rediscovery (delega) |
| POST | `/:id/testar` | Teste de conexão (delega) |
| POST | `/:id/diagnostico` | Diagnóstico (delega) |
| POST | `/cadastrar` | Cadastro (delega `EquipamentosService.criar`) |

### UI

Menu Administração → **Central Equipamentos** (`central-equipamentos.js`).

---

## RC3.1 — Heartbeat / Monitoramento Inteligente

Camada **aditiva** em `backend/motores/equipamentos/monitor/`.  
Não altera Discovery, MIE, Central, DriverRegistry, DriverManager nem EquipamentosService.

### Comportamento

- Fila com **1 probe por ciclo**, stagger e backoff
- Status: `ONLINE` | `OFFLINE` | `INSTAVEL` | `SEM_RESPOSTA` | `SEM_COMUNICACAO`
- Eventos: voltou / caiu / mudou IP|firmware|porta / perda de comunicação
- Health Score enriquecido (latência, falhas, disponibilidade)
- Atualiza `equipamentos.status` + `ultima_comunicacao` → Central reflete sem rediscovery
- `AlertChannel` preparado para e-mail / WhatsApp / webhook (stubs)

### API (`/api/monitoramento-equipamentos`)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/dashboard` | Totais heartbeat |
| GET | `/lista` | Estados |
| GET | `/geral` | Snapshot do monitor |
| GET | `/:id` | Estado |
| GET | `/:id/eventos` | Timeline |
| GET | `/:id/saude` | Health Score HB |
| POST | `/:id/verificar` | Força probe |
| POST | `/iniciar` `/parar` | Controle do worker |

Env: `EQUIPAMENTOS_MONITOR_ACTIVE`, `EQUIPAMENTOS_MONITOR_INTERVAL_MS`, `EQUIPAMENTOS_HB_*`.

---

## RC4.0 — Drivers Oficiais

Inteligência **dentro de cada driver** (sem alterar BaseDriver / Registry / Discovery / MIE / Central / Heartbeat).

### Fabricantes

Toledo · Filizola · Urano · Aclas · Elgin · Bematech

### Capacidades por driver

Discovery · Handshake · Identidade (firmware/série/modelo/versão) · Diagnóstico (alertas/problemas/soluções/recomendações) · Health específico · Config (ler/comparar/aplicar/backup/restaurar) · Sync (produtos/PLU/departamentos/configurações)

### Estrutura

- Kit compartilhado: `drivers/comum/oficial/`
- Perfis: `*OficialPerfil.js` em cada fabricante
- Toledo: evolução de `ToledoPrix4UnoDriver` + `ToledoPrix4Diagnostics`

---

## RC5.0 — Integração Corporativa

Camada **fora** do Motor V1 (congelado): `backend/services/equipamentos-integracao/`.

Ver documentação completa: [`INTEGRACAO_EQUIPAMENTOS_RC5.md`](./INTEGRACAO_EQUIPAMENTOS_RC5.md).

API: `/api/integracao-equipamentos` — status, equipamentos, diagnóstico, sincronização, eventos.

---

## Limitações conhecidas

- Handshake Serial/USB de fabricante ainda é heurístico (keywords / VID-PID); protocolos completos ficam para evolução por driver.
- Sem pacote `serialport` obrigatório — probe real opcional.
- Cancelamento cooperativo entre probes.
- Bluetooth / Wi‑Fi não implementados.
- Heartbeat Serial/USB ainda sem probe físico (Ethernet = TCP Connect / ping).
- MIE depende da qualidade dos sinais no Candidate (sem serial/MAC, identidade é mais frágil).

## Plano futuro

1. Discovery Bluetooth / Wi‑Fi.
2. Handshake real Filizola / Urano / Aclas.
3. Probe Serial/USB no Heartbeat.
4. Canais de alerta externos (e-mail / WhatsApp / webhook).
