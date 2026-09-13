# RC7.4.2 — Inteligência Operacional SEFAZ Enterprise

**VERSÃO:** CDS Sistemas V1.0  
**MODO:** IMPLEMENTAÇÃO ENTERPRISE  
**Data:** 2026-07-18  

## Objetivo

Transformar o XML Wait Scheduler em cliente SEFAZ enterprise: **Gate Operacional único**, tratamento centralizado dos cStat 137/138/656/593, prevenção de consumo indevido e observabilidade completa — sem alterar DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, schema ou Máquina de Estados.

---

## Gate Operacional Único

Arquivo: `backend/motores/central-entradas/services/CentralSefazOperationalGate.js`

**Todos** passam por `autorizarConsultaDistDfe` antes de DistDFe:

| Origem | Integração |
|--------|------------|
| XML Wait Scheduler | `_processarDocumento` |
| Background / Sync Manual / Abrir Central | `CentralSyncExecucaoService.executar` |
| Solicitar XML Completo | `CentralEntradasOrchestrator.processarCicloDfeDocumento` |
| Diagnóstico Testar SEFAZ | `CentralDiagnosticoService.testarConexaoSefaz` |

Respostas passam por `processarRespostaSefaz` (state machine operacional).

`forcarConsulta=true` **não** bypassa 656/593.  
Bypass somente com `forcarAdminConfirmado=true` **e** `confirmacaoAdmin=true`.

---

## State Machine cStat

| cStat | Ação |
|-------|------|
| **138** | Continuar fluxo; atualizar wait; Parser quando PROC_NFE |
| **137** | Backoff normal; registrar tentativa; reagendar; **não** bloquear |
| **656** | Bloqueio global 1h (`bloqueio656`); zero DistDFe até liberar |
| **593** | Suspender consultas (`ERRO_CONFIGURACAO_CERTIFICADO`); zero SOAP até certificado/CNPJ mudar |

### bloqueio656 (JSON Scheduler)

```json
{
  "bloqueadoAte": "ISO",
  "motivo": "Consumo Indevido (656)",
  "cStat": "656",
  "correlationId": "...",
  "ultimaConsulta": "ISO"
}
```

### estado593 (JSON Scheduler)

```json
{
  "ativo": true,
  "status": "ERRO_CONFIGURACAO_CERTIFICADO",
  "cnpjXml": "...",
  "cnpjCertificado": "...",
  "fingerprint": "cnpj|certPath",
  "correlationId": "...",
  "registradoEm": "ISO"
}
```

Persistência: chave existente `xml_wait_scheduler_state` (sem migration).

---

## Logs

| Evento | Quando |
|--------|--------|
| `XML_WAIT_BLOCKED_656` | Bloqueio criado |
| `XML_WAIT_UNLOCK` | Janela expirou / upload / limpeza |
| `XML_WAIT_SKIPPED` | Consulta evitada (656 ou 593) |
| `XML_WAIT_NEXT_ALLOWED` | Próxima janela liberada |
| `XML_WAIT_CONFIGURATION_ERROR` | cStat 593 |
| `XML_WAIT_CONFIGURATION_FIXED` | Fingerprint certificado/CNPJ alterado |
| `XML_WAIT_UPLOAD` | Upload cancela wait + locks |

Campos: Documento, NSU, Chave, CorrelationId, RequestId, Tempo, Tempo restante, Próxima tentativa, Motivo.

---

## Upload / Reinício

- **Upload:** cancela scheduler do doc, backoff, `bloqueio656` e `estado593` → `XML_WAIT_UPLOAD`.
- **Boot:** `_carregarEstado` recupera docs, tentativas, backoff, 656 e 593. Se 656 expirou → `XML_WAIT_UNLOCK`.

---

## Dashboard / Diagnóstico

Painel operacional (sem redesign de layout):

| Indicador | Estado |
|-----------|--------|
| 🟢 | Normal |
| 🟡 | Aguardando XML |
| 🟠 | Bloqueio SEFAZ (656) |
| 🔴 | Erro Configuração (593) |

Campos: último cStat, última/próxima consulta, tempo restante, tentativas, documento bloqueado, economia SOAP.

Exposto em `/dashboard` → `sefazOperacional` e em Configurações → Diagnóstico.

---

## Telemetria

- `consultasSOAP` / `consultasEvitadas` / `economiaSOAP`
- `bloqueios656` / `erros593`
- `tempoMedioBloqueadoMs` / `tempoMedioEntreConsultasMs`
- `ultimoDesbloqueio` / `proximaConsultaPrevista`
- `ultimaRespostaSEFAZ` / `estadoOperacional`
- `contagemCStat` (137, 138, 656, 593)
- históricos de desbloqueios e erros 593

---

## Arquivos alterados

| Arquivo | Papel |
|---------|--------|
| `CentralSefazOperationalGate.js` | Gate + state machine + telemetria |
| `CentralXmlWaitScheduler.js` | Delega locks ao Gate; persiste JSON |
| `CentralSyncExecucaoService.js` | Auth + processar resposta |
| `CentralEntradasOrchestrator.js` | Auth ciclo-dfe + painel detalhe |
| `CentralUploadService.js` | Limpa 656+593 |
| `CentralDashboardService.js` / DTO | `sefazOperacional` |
| `CentralDiagnosticoService.js` | Gate no probe + painel |
| `CentralConfiguracaoService.js` | Diagnóstico com painel |
| `frontend/.../central-entradas.js` | Chip SEFAZ + alertas 593/656 |
| `tests/.../rc742-*.test.js` | Casos 1–7 |
| `docs/RC7.4.2_*.md` | Este documento |

---

## Testes

```bash
node tests/central-entradas/rc741-consumo-indevido-656.test.js
node tests/central-entradas/rc742-inteligencia-operacional-sefaz.test.js
```

| Caso | Esperado |
|------|----------|
| 1 — 138 → PROC | Fluxo normal, wait encerrado |
| 2 — 137 | Backoff, sem bloqueio |
| 3 — 656 | 1 SOAP; 100 retries sem SOAP; libera após 1h |
| 4 — 593 | Suspende; forçar não libera; fingerprint corrige |
| 5 — Upload | Limpa 656 + 593 |
| 6 — Reinício | Recupera estado do JSON |
| 7 — Gate sync | Abrir Central respeita bloqueio |

---

## Critérios de aceitação

| Critério | Status |
|----------|--------|
| Uma consulta durante bloqueio 656 | ✓ |
| Nenhuma consulta repetida em 593 | ✓ |
| Todos os módulos no mesmo Gate | ✓ |
| Scheduler retoma após desbloqueio | ✓ |
| Dashboard mostra estado operacional | ✓ |
| Telemetria de economia SOAP | ✓ |
| Sem regressão DistDFe/Manifestação/Parser/MIIP/Compras | ✓ |

---

## Auditoria operacional (template pós-produção)

Consultar `sefazOperacional` / telemetria do Gate:

| Métrica | Campo |
|---------|-------|
| Qtd 656 / 593 / 137 / 138 | `contagemCStat` |
| Consultas realizadas | `consultasSOAP` |
| Consultas evitadas | `consultasEvitadas` / `economiaSOAP` |
| Tempo médio entre consultas | `tempoMedioEntreConsultasMs` |
| Tempo médio de bloqueio | `tempoMedioBloqueadoMs` |
| Histórico desbloqueios | `historicoDesbloqueios` |
| Histórico erros config | `historicoErros593` |
| Estado atual | `estadoOperacional` |

Valores em homologação unitária sobem conforme os testes; em produção dependem do tráfego SEFAZ real.
