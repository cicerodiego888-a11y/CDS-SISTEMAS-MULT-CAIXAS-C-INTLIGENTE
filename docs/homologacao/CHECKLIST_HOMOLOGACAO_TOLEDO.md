# CHECKLIST DE HOMOLOGAÇÃO — TOLEDO PRIX 4 UNO

**Projeto:** CDS Sistemas — Motor Universal de Equipamentos  
**Sprint:** 14 — Homologação Física  
**Pré-requisito:** Sprint 13A concluída (infraestrutura pronta)  
**Firmware alvo:** 90AX  
**Comunicação:** Ethernet TCP (porta 9100 ou 4001)

---

## 1. Pré-requisitos de Ambiente

### 1.1 Hardware e rede

- [ ] Balança Toledo Prix 4 Uno ligada e operacional
- [ ] Cabo Ethernet conectado (balança ↔ switch ↔ PC/servidor CDS)
- [ ] IP da balança conhecido e acessível (ping ICMP OK)
- [ ] Porta TCP configurada na balança (padrão **9100**; alternativa **4001**)
- [ ] Firewall do Windows/servidor permite saída TCP na porta da balança
- [ ] PC e balança na mesma sub-rede (ex.: 192.168.x.x)

### 1.2 Software CDS

- [ ] Backend CDS iniciado (`npm start` ou serviço)
- [ ] Log de startup contém: `Motor de Equipamentos inicializado (fila, drivers, monitor).`
- [ ] Banco SQLite migrado (colunas `firmware`, `protocolo_versao`, `ultimo_handshake`, `ultimo_sync`, `ultimo_ping`)
- [ ] Testes automatizados verdes: `npm run test:equipamentos` (158/158)
- [ ] Usuário ERP autenticado com permissão **Configurações**

### 1.3 Ferramentas disponíveis

- [ ] ERP → Configurações → **Equipamentos / Balanças**
- [ ] ERP → **Lab. Equipamentos**
- [ ] API Engenharia Reversa (`/api/engenharia-reversa`) — via Postman/curl se necessário
- [ ] MGV7 ou software Toledo para captura de referência (opcional, recomendado)

---

## 2. Cadastro do Equipamento

### 2.1 Criar equipamento no ERP

Navegar: **Configurações → Equipamentos → Balanças → Novo**

| Campo | Valor sugerido |
|-------|----------------|
| Nome | `Balança Toledo Homologação` |
| Driver | Toledo Prix 4 Uno |
| Transporte | Ethernet |
| IP | IP real da balança |
| Porta TCP | 9100 (ou conforme balança) |
| Timeout (ms) | 5000 |
| Reconnect automático | Sim |
| Ativo | Sim |

- [ ] Equipamento salvo sem erro
- [ ] Aparece na listagem com status inicial

### 2.2 Teste de conexão TCP

- [ ] Clicar **Testar conexão** no equipamento cadastrado
- [ ] Resultado: conexão TCP estabelecida (socket aberto)
- [ ] Se falhar: verificar IP, porta, cabo, firewall

---

## 3. Laboratório — Conexão e Captura

Navegar: **Lab. Equipamentos**

### 3.1 Conectar

- [ ] Selecionar equipamento cadastrado
- [ ] Clicar **Conectar**
- [ ] Status indica conexão ativa
- [ ] Painel de pacotes disponível

### 3.2 Iniciar captura global

- [ ] Clicar **Iniciar captura** (equipamento ou global)
- [ ] Confirmar que sessão de captura está ativa

### 3.3 Ping (PN)

- [ ] Clicar **Ping**
- [ ] Verificar pacote **TX** na tabela (comando PN)
- [ ] Verificar pacote **RX** (resposta AK ou equivalente)
- [ ] Anotar hex TX e RX
- [ ] Verificar campos no log: IP, porta, driver, bytes TX/RX, tempo_ms

**Resultado esperado (formato temp 11A):**
- TX: `02 50 4E 1C ... 03` (PN + JSON)
- RX: `02 41 4B 1C ... 03` (AK + JSON) — *pode diferir no hardware real*

- [ ] Se resposta diferir do mock: **registrar hex real** para Sprint 14 (90AX)

### 3.4 Handshake (HS)

- [ ] Construir frame **Handshake** no Frame Builder
- [ ] Enviar ou executar via diagnóstico
- [ ] Capturar resposta
- [ ] Anotar se balança aceita frame temp ou rejeita (NAK/timeout)

- [ ] Atualizar campo `ultimo_handshake` manualmente ou via API futura
- [ ] Se firmware retornado: registrar em `firmware` e `protocolo_versao`

### 3.5 Status (ST)

- [ ] Executar **Status**
- [ ] Capturar resposta (RS ou ACK com payload)
- [ ] Verificar campos online/offline reportados

---

## 4. Engenharia Reversa

### 4.1 Captura via API (opcional)

```http
POST /api/engenharia-reversa/captura/iniciar
Authorization: Bearer <token>
Content-Type: application/json

{ "fabricante": "Toledo", "modelo": "Prix 4 Uno", "observacao": "Homologação presencial" }
```

- [ ] Captura iniciada
- [ ] Executar ping/handshake/status com captura ativa
- [ ] Parar captura: `POST /api/engenharia-reversa/captura/parar`

### 4.2 Exportar e analisar

- [ ] Exportar captura: JSON + HEX + Wireshark
- [ ] Analisar frame: `POST /api/engenharia-reversa/analisar` com hex capturado
- [ ] Verificar detecção STX/ETX, ACK/NAK, CRC (heurística — **não implementar CRC ainda**)
- [ ] Adicionar observações: `POST /api/enginharia-reversa/observacao`

### 4.3 Documentação de protocolo

- [ ] Atualizar documento: `POST /api/engenharia-reversa/documento/atualizar`
- [ ] Revisar `PROTOCOLO_TOLEDO.md` gerado
- [ ] Comparar capturas MGV7 vs. CDS: `POST /api/engenharia-reversa/comparar`

---

## 5. Sincronização de Produto (Teste Controlado)

> **Atenção:** Frames atuais são temporários (Sprint 11A). Este teste valida conectividade e formato de resposta; sync real depende do protocolo 90AX (Sprint 14).

### 5.1 Preparar produto teste

- [ ] Criar produto no ERP: PLU **999001**, descrição curta, preço, departamento 1
- [ ] Produto marcado como pesável (se aplicável)

### 5.2 Sync manual (laboratório ou fila)

- [ ] Construir frame **Produto** no Frame Builder com dados do PLU teste
- [ ] Enviar frame via **Enviar HEX**
- [ ] Capturar resposta (ACK/NAK/timeout)

**Registro:**

| Item | Valor |
|------|-------|
| PLU enviado | |
| Hex TX | |
| Hex RX | |
| Resultado | ACK / NAK / TIMEOUT |
| Tempo (ms) | |

- [ ] Verificar na balança se PLU apareceu (display/MGV7)
- [ ] Se NAK: anotar mensagem de erro do payload

### 5.3 Fila de sincronização

- [ ] Enfileirar sync via SyncManager/API (quando endpoint disponível)
- [ ] Verificar item em `equipamentos_fila` (status: pendente → processando → concluído/erro)
- [ ] Dashboard: contadores de fila atualizados
- [ ] Logs em `equipamentos_logs` registrados

---

## 6. Leitura de Peso

- [ ] Colocar item conhecido na balança (peso de referência)
- [ ] Executar frame **Peso** (PW) ou comando via laboratório
- [ ] Capturar resposta
- [ ] Comparar peso retornado vs. display da balança

| Peso display balança | Peso parser CDS | Diferença | OK? |
|---------------------|-----------------|-----------|-----|
| | | | |

- [ ] Repetir com balança vazia (zero/tara)
- [ ] Anotar formato da resposta real para ajuste do Parser (Sprint 14)

---

## 7. Testes de Resiliência

### 7.1 Timeout

- [ ] Desconectar cabo durante comando em andamento
- [ ] Verificar timeout registrado no PacketLogger (`timeout: true`)
- [ ] Verificar retry na fila (até 3 tentativas)

### 7.2 Reconexão

- [ ] Reconectar cabo
- [ ] Executar ping — conexão restabelecida?
- [ ] Verificar contador de reconexões no ConnectionManager

### 7.3 Heartbeat

- [ ] Manter conexão idle por > 30s
- [ ] Verificar heartbeat TCP no log
- [ ] Confirmar que socket permanece ativo

### 7.4 NAK / erro

- [ ] Enviar frame inválido (hex arbitrário)
- [ ] Verificar resposta NAK ou erro
- [ ] Confirmar registro no PacketLogger (`nak: true`)

---

## 8. Persistência e Metadados

Após testes bem-sucedidos, registrar no equipamento:

| Campo DB | Valor capturado | Preenchido? |
|----------|-----------------|-------------|
| `firmware` | ex.: 90AX | [ ] |
| `protocolo_versao` | ex.: 11A-temp / 90AX | [ ] |
| `ultimo_handshake` | timestamp | [ ] |
| `ultimo_ping` | timestamp | [ ] |
| `ultimo_sync` | timestamp | [ ] |
| `ultima_comunicacao` | auto | [ ] |
| `status` | online/offline | [ ] |

---

## 9. Critérios de Aceite — Sprint 14

### Mínimo para aprovar homologação infraestrutura

- [ ] Conexão TCP estável por ≥ 30 minutos
- [ ] Ping responde com padrão documentado (ou divergência registrada)
- [ ] Capturas exportadas e arquivadas
- [ ] `PROTOCOLO_TOLEDO.md` atualizado com frames reais
- [ ] Nenhum socket leak após connect/disconnect × 50 ciclos
- [ ] Fila processa item enfileirado com sucesso ou erro registrado
- [ ] Logs PacketLogger contêm IP, porta, bytes TX/RX, tempo

### Para aprovar sync em produção (Sprint 14+)

- [ ] Frames 90AX oficiais implementados (substituir temp 11A)
- [ ] CRC/checksum validado (se exigido pela spec)
- [ ] Sync produto confirmado visualmente na balança
- [ ] Peso lido com margem de erro aceitável (< 5g ou conforme norma)
- [ ] Hooks ERP disparam sync automático

---

## 10. Registro de Problemas

| # | Data | Descrição | Severidade | Hex/Evidência | Ação |
|---|------|-----------|------------|---------------|------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

**Severidades:** Crítico (bloqueia) | Alto | Médio | Baixo | Info

---

## 11. Encerramento da Sessão

- [ ] Parar captura ativa
- [ ] Desconectar equipamento no laboratório
- [ ] Salvar capturas em local seguro (`backend/motores/equipamentos/.../capturas/`)
- [ ] Exportar logs relevantes de `equipamentos_logs`
- [ ] Preencher relatório de homologação (Sprint 14)
- [ ] Definir próximas ações: implementar 90AX / ajustar Parser / hooks ERP

---

## 12. Comandos Úteis

```bash
# Testes completos do motor
npm run test:equipamentos

# Testes TCP + protocolo Toledo
npm run test:equipamentos-toledo-tcp
npm run test:equipamentos-toledo-protocol

# Verificar startup do motor
# (log esperado): Motor de Equipamentos inicializado (fila, drivers, monitor).
```

### Variáveis de ambiente opcionais

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `EQUIPAMENTOS_LOG_LEVEL` | info | Nível de log |
| `EQUIPAMENTOS_HEARTBEAT_MS` | 30000 | Intervalo heartbeat TCP |
| `EQUIPAMENTOS_QUEUE_INTERVAL_MS` | 1000 | Intervalo worker fila |
| `EQUIPAMENTOS_QUEUE_TIMEOUT_MS` | 15000 | Timeout execução fila |
| `EQUIPAMENTOS_PACKET_HISTORY_MAX` | 500 | Máx. pacotes em memória |

---

## 13. Contatos e Referências

- Documentação interna: `backend/motores/equipamentos/README.md`
- Protocolo capturado: `PROTOCOLO_TOLEDO.md`
- Auditoria pré-homologação: `RELATORIO_AUDITORIA_FINAL_MOTOR_EQUIPAMENTOS.md`
- Relatórios sprints: `RELATORIO_SPRINT_11A.md`, `RELATORIO_SPRINT_12.md`, `RELATORIO_SPRINT_13.md`

---

*Checklist criado na Sprint 13A — CDS Sistemas — 02/07/2026*
