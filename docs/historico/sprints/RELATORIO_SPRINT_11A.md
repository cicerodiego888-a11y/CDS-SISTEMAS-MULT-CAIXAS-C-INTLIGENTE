# RELATÓRIO SPRINT 11A — INFRAESTRUTURA DO PROTOCOLO TOLEDO

**Data:** 01/07/2026  
**Status:** Concluída  
**Escopo:** Infraestrutura de protocolo com frames temporários (sem comandos 90AX oficiais)

---

## Resumo

A Sprint 11A finalizou toda a infraestrutura necessária para o Motor Universal de Equipamentos operar o fluxo completo de sincronização com respostas simuladas, preparando o terreno para a Sprint 11B (comandos oficiais 90AX após captura MGV).

Fluxo implementado e testado:

```
ERP → SyncManager → QueueManager → EquipamentosManager → Driver Toledo
  → Protocol → FrameBuilder → EthernetTransport → Socket TCP → Parser → ACK/NAK → Fila
```

---

## Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder.js` | Construção centralizada de pacotes (formato temporário 11A) |
| `tests/motor-equipamentos/toledo-prix4-protocol.test.js` | Suite completa Sprint 11A (18 testes) |
| `RELATORIO_SPRINT_11A.md` | Este relatório |

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `ToledoPrix4Parser.js` | Infraestrutura completa: `parseFrame`, `parseACK`, `parseNAK`, `parseStatus`, `parsePeso`, `parseErro` |
| `ToledoPrix4Protocol.js` | Removidos `_stub()`; comandos via FrameBuilder → Transport → Parser |
| `ToledoPrix4UnoDriver.js` | Sync/peso delegam ao protocolo real; `_resultadoProtocolo()` |
| `EquipamentosManager.js` | `obterDriver`, `conectar`, `desconectar`, `status`, `sincronizar*` |
| `QueueManager.js` | Worker automático com retry, backoff, timeout e persistência |
| `PacketLogger.js` | Metadados: driver, comando, resultado, tempo, ACK/NAK/timeout/retry |
| `tests/motor-equipamentos/helpers/MockTcpServer.js` | Modo Toledo (ACK/NAK/RS/PW simulados) |
| `tests/motor-equipamentos/toledo-prix4-tcp.test.js` | Ajustes para infraestrutura 11A |
| `tests/motor-equipamentos/toledo-prix4-driver.test.js` | Testes com Mock TCP Toledo |
| `package.json` | Script `test:equipamentos-toledo-protocol` |

---

## Funcionalidades implementadas

### Etapa 1 — FrameBuilder
- `buildHandshake()`, `buildPing()`, `buildStatus()`, `buildProduto()`, `buildDepartamento()`, `buildPromocao()`, `buildRemocaoProduto()`, `buildFrame()`
- Helpers de resposta simulada: `buildAck()`, `buildNak()`, `buildRespostaStatus()`, `buildRespostaPeso()`
- Formato temporário documentado: `[STX][CMD 2 chars][SEP][JSON][ETX]`

### Etapa 2 — Parser
- Interpretação de frames temporários com suporte a ACK, NAK, STATUS, PESO e ERRO
- Aliases legados mantidos para compatibilidade com testes anteriores

### Etapa 3 — Protocol
- `_executarComando()` centralizado: FrameBuilder → write → read → Parser
- `handshake()`, `status()`, `ping()`, `enviarProduto()`, `atualizarProduto()`, `removerProduto()`, `enviarDepartamento()`, `enviarPromocao()`, `enviarEtiqueta()`, `enviarLote()`, `receberPeso()`
- Logging estruturado por comando (ACK/NAK/TIMEOUT)

### Etapa 4 — EquipamentosManager
- Cache de drivers por equipamento
- Resolução via `driver_codigo` ou fabricante/modelo
- Métodos de alto nível sem acesso direto ao driver pelas camadas superiores

### Etapa 5 — QueueManager
- Worker com `setInterval` e recuperação de itens órfãos (`processando` → `pendente`)
- Retry exponencial (backoff), timeout de execução, persistência de erro em `equipamentos_fila`
- Integração com `EquipamentosManager` e `EquipamentosEvents`

### Etapa 6 — Logs
- `PacketLogger` enriquecido com metadados de protocolo
- Toda TX/RX passa por PacketLogger → PacketHistory → HexViewer

### Etapa 7 — Testes
- 18 testes na suite `toledo-prix4-protocol`
- 12 testes TCP (atualizados)
- 22 testes driver (atualizados)

---

## Métodos que deixaram de ser Stub

| Componente | Métodos |
|------------|---------|
| **ToledoPrix4Protocol** | `handshake`, `status`/`obterStatus`, `ping` (protocolo), `enviarProduto`, `atualizarProduto`, `removerProduto`, `enviarDepartamento`, `enviarPromocao`, `enviarEtiqueta`, `enviarLote`, `receberPeso`, `receberStatus` |
| **ToledoPrix4UnoDriver** | `status`, `sincronizarProduto`, `sincronizarProdutos`, `sincronizarPromocao`, `sincronizarDepartamento`, `sincronizarEtiqueta`, `removerProduto`, `obterPeso` |
| **EquipamentosManager** | `inicializar`, `encerrar`, `obterDriver`, `conectar`, `desconectar`, `status`, `sincronizarProduto`, `sincronizarDepartamento`, `sincronizarPromocao`, `sincronizarEtiqueta`, `diagnosticar` |
| **QueueManager** | `iniciar`, `_processarProximo`, `_executarComando`, `_recuperarOrfaos`, `_aguardarBackoff` |

**Ainda stub (fora do escopo 11A):** `descobrir`, `zerar`, `reiniciar` no driver; `MonitorService` polling.

---

## Cobertura dos testes

| Suite | Comando | Resultado |
|-------|---------|-----------|
| `test:equipamentos-toledo-protocol` | `npm run test:equipamentos-toledo-protocol` | **18/18 OK** |
| `test:equipamentos-toledo-tcp` | `npm run test:equipamentos-toledo-tcp` | **12/12 OK** |
| `test:equipamentos-toledo-prix4` | `npm run test:equipamentos-toledo-prix4` | **22/22 OK** |

**Cobertura Sprint 11A:** FrameBuilder, Parser, Protocol, EquipamentosManager, QueueManager, handshake, ping, status, produto, departamento, promoção, retry, timeout, PacketLogger.

---

## Pendências Sprint 11B

| Item | Descrição |
|------|-----------|
| CRC/checksum definitivo | Substituir formato temporário |
| Frames oficiais 90AX | Após captura MGV |
| Comandos reais Toledo | Handshake, sync PLU, peso real |
| Engenharia reversa / captura TCP | Base para 11B |
| Substituir payloads temporários no FrameBuilder | Manter interface, trocar implementação |
| Parser com interpretação real | ACK/NAK/frames binários oficiais |
| Hooks ERP automáticos | Salvar produto → SyncManager |
| PDV `obterPeso()` ao vivo | Integração com motor |
| Discovery Ethernet | Scan de rede |

---

## Débito técnico restante

| Item | Severidade |
|------|------------|
| Formato de frame temporário (não é 90AX) | Esperado até 11B |
| `equipamentos_configuracoes` sem uso | Baixa |
| `MonitorService` sem polling | Média |
| Logs com FK quando `equipamento_id` inexistente em testes | Baixa (testes usam IDs reais do DB) |
| Driver cache não invalida ao editar equipamento no ERP | Média (invalidar cache no editar) |
| REST `/sync` endpoints ausentes | Média (Sprint 12) |

---

## Notas arquiteturais

- Nenhuma alteração em BaseDriver, DriverRegistry, DTOs, Repositories, API REST ou banco
- FrameBuilder é o **único** ponto autorizado a montar pacotes
- Protocol nunca monta bytes diretamente — sempre delega ao FrameBuilder
- QueueManager usa require tardio do EquipamentosManager para evitar dependência circular
- Respostas marcadas com `simulado: true` e `infraestrutura: '11A'` até Sprint 11B

---

*Sprint 11A concluída — Motor pronto para receber protocolo oficial Toledo 90AX.*
