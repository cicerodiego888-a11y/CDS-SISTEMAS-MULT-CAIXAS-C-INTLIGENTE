# RC7.4.1 — Proteção Inteligente contra Consumo Indevido (cStat 656)

**VERSÃO:** CDS Sistemas V1.0  
**MODO:** IMPLEMENTAÇÃO  
**Data:** 2026-07-18  

## Objetivo

Eliminar o loop de DistDFe quando a SEFAZ responde **cStat 656** (Consumo Indevido), com **um único bloqueio global** de 1 hora respeitado por todas as rotinas da Central.

Sem alterações em DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, schema ou Máquina de Estados.

---

## Causa do loop (antes)

1. XML Wait usava `forcarConsulta: true` → bypassava cooldown NSU.  
2. Abrir a Central / sync / “Solicitar XML” podiam disparar DistDFe de novo.  
3. Resultado: 656 → nova tentativa → 656 novamente.

---

## Solução

Lock global no estado JSON do `CentralXmlWaitScheduler` (`xml_wait_scheduler_state.bloqueio656`):

| Campo | Conteúdo |
|-------|----------|
| `bloqueadoAte` | now + **1 hora** (`INTERVALO_BLOQUEIO_656_MS`) |
| `motivo` | Consumo Indevido (656) |
| `cStat` | 656 |
| `correlationId` | da consulta que originou o bloqueio |
| `ultimaConsulta` | ISO |

### Gate único

Antes de qualquer DistDFe:

- `CentralSyncExecucaoService.executar` (background, sync manual, abrir Central)  
- `CentralEntradasOrchestrator.processarCicloDfeDocumento` (Solicitar XML)  
- `CentralXmlWaitScheduler._processarDocumento`

→ se bloqueado: **não SOAP**, log `XML_WAIT_SKIPPED`, código `BLOQUEADO_CONSUMO_INDEVIDO_656`.

`forcar` **não** bypassa este lock.

---

## Logs novos

| Evento | Quando |
|--------|--------|
| `XML_WAIT_BLOCKED_656` | 656 recebido → bloqueio criado |
| `XML_WAIT_SKIPPED` | consulta evitada |
| `XML_WAIT_UNLOCK` | janela expirou ou upload |
| `XML_WAIT_NEXT_ALLOWED` | próxima janela liberada |

Campos: Documento, NSU, Chave, CorrelationId, Próxima tentativa, Tempo restante, Motivo.

---

## UI

No documento `AGUARDANDO_XML_COMPLETO`, se bloqueado:

- Consulta temporariamente bloqueada pela SEFAZ  
- Motivo: Consumo Indevido (656)  
- Próxima tentativa / tempo restante  

Sem mudança de layout estrutural.

---

## Upload

`XML_WAIT_UPLOAD` + `limparBloqueio656('upload')` — cancela scheduler, backoff e bloqueio 656.

---

## Reinício

`_carregarEstado()` recupera `bloqueio656` + documentos + métricas. Se `bloqueadoAte` já passou, emite `XML_WAIT_UNLOCK` automaticamente.

---

## Telemetria

- `bloqueios656` / `bloqueioAtivo` / `bloqueadoAte`  
- `consultasEvitadas656` (= economia de chamadas SOAP)  
- `tempoMedioBloqueadoMs`  
- `ultimoDesbloqueioEm`  
- `proximaConsultaPrevista`  

---

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `CentralXmlWaitScheduler.js` | Lock + logs + persistência |
| `CentralSyncExecucaoService.js` | Gate sync / abrir Central / background |
| `CentralEntradasOrchestrator.js` | Gate ciclo-dfe + registra 656 |
| `CentralUploadService.js` | Limpa bloqueio no upload |
| `central-entradas.js` | Info operacional 656 |
| `tests/.../rc741-consumo-indevido-656.test.js` | Casos 1–4 |
| `docs/RC7.4.1_CONSUMO_INDEVIDO_656.md` | Este doc |

---

## Testes

```
node tests/central-entradas/rc741-consumo-indevido-656.test.js
```

| Caso | Resultado esperado |
|------|-------------------|
| 1 — 656 → bloqueio 1h → sem 2ª consulta → libera | OK |
| 2 — Upload limpa bloqueio | OK |
| 3 — Reinício recupera bloqueio do JSON | OK |
| 4 — Gate devolve SKIPPED | OK |

---

## Critérios de aceitação

| Critério | Status |
|----------|--------|
| Uma consulta durante o bloqueio | ✓ |
| Sem loop 656 | ✓ |
| Todos os módulos no mesmo lock | ✓ |
| Funciona após desbloqueio | ✓ |
| Sem regressão fiscal/parser/miip/compras | ✓ |

---

## Auditoria operacional (template pós-produção)

Após reinício e uso real, consultar telemetria (`/dashboard` → `xmlWait` ou diagnóstico):

- quantidade de bloqueios → `bloqueios656`  
- consultas evitadas → `consultasEvitadas656`  
- tempo médio de bloqueio → `tempoMedioBloqueadoMs`  
- bloqueio ativo → `bloqueioAtivo` / `bloqueadoAte`  
- último desbloqueio → `ultimoDesbloqueioEm`  
- economia SOAP → igual a consultas evitadas  

Valores iniciais em homologação unitária: métricas sobem conforme os testes simulados; em produção dependem do tráfego SEFAZ.
