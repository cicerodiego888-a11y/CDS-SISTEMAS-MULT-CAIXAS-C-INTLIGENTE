# Relatório de Homologação — RC3.4.1 MIRX

**Sprint:** RC3.4.1 — Motor Inteligente de Recuperação de XML (MIRX)  
**Data:** 2026-07-27  
**Modo:** Implementação concluída (código)  
**Ambiente:** Central Inteligente de Entradas + Plataforma Fiscal V1  

---

## 1. Objetivo homologado

Eliminar documentos presos em `AGUARDANDO_XML_COMPLETO` por falha de lógica agressiva (`forcarConsulta` permanente), reduzindo risco de **cStat 656** no Ambiente Nacional, com recuperação automática quando o XML estiver disponível.

---

## 2. Arquitetura entregue

```
Central / UI / Manifestação / Background
        ↓
   Fila MIRX (MirxQueue)
        ↓
   Worker único (MirxWorker)
        ↓
   Gate SEFAZ (CentralSefazOperationalGate)
        ↓
   Mutex DistDFe (CentralSyncExecucaoService.comLockDistDfe)
        ↓
   Plataforma Fiscal (DistDFe → consChNFe)
```

| Componente | Caminho |
|------------|---------|
| Estados MIRX | `backend/motores/central-entradas/mirx/MirxEstados.js` |
| Backoff | `mirx/MirxBackoff.js` — 5/15/30/60/120/240/480/1440 min |
| Fila | `mirx/MirxQueue.js` |
| Worker | `mirx/MirxWorker.js` — `forcarConsulta: false` |
| Manifestação recuperação | `modoRecuperacaoXml` **não** força mais `forcarConsulta: true` (RC3.4.1) |
| Serviço | `mirx/MirxService.js` |
| Fachada legada | `services/CentralXmlWaitScheduler.js` → MIRX |
| UI painel | `frontend/erp/js/central-entradas-ux.js` |

O status persistido do documento permanece `AGUARDANDO_XML_COMPLETO` (compatibilidade `MaquinaEstadosDocumento`). A submáquina MIRX controla: `RES_NFE` → `AGUARDANDO_JANELA_SEFAZ` → `CONSULTA_PROGRAMADA` → `CONSULTANDO_XML` → `XML_RECUPERADO` / `PROCESSADO` (+ `BLOQUEADO_656` temporário).

---

## 3. Critérios de aceite

| Critério | Status | Evidência |
|----------|--------|-----------|
| Nenhum documento preso indefinidamente por falha de lógica | ✔ | Sem PROC → reagenda (nunca XML_INDISPONIVEL por 137/656) |
| Um Worker DistDFe/consChNFe de recuperação | ✔ | `MirxWorker` + fila; tick processa 1 job |
| Redução estrutural de 656 | ✔ | Removido `forcarConsulta` permanente; backoff até 24h |
| Recuperação automática | ✔ | Tick + scan `AGUARDANDO_XML_COMPLETO` + enqueue pós-ciência |
| Atualização Produtos pós-XML | ✔ | Orchestrator já processa Parser/MIIP quando `xmlCompleto` |
| Compatibilidade Plataforma Fiscal / Central | ✔ | Sem alteração de SOAP/runtime fiscal; fachada XmlWait preservada |

---

## 4. Tratamento cStat 656

- **Não** altera documento para `XML_INDISPONIVEL`.
- Registra motivo/horário na Timeline (`MIRX_BLOQUEIO_656`).
- Gate aplica cooldown progressivo; MIRX reagenda `proximaEm`.
- Retry automático após liberação do Gate.

---

## 5. Testes

```bash
node tests/central-entradas/rc341-mirx.test.js
node tests/central-entradas/rc74-xml-wait-scheduler.test.js
node tests/central-entradas/rc336-recuperacao-xml.test.js
```

Cobertura RC3.4.1:
- Backoff MIRX
- Fila única / prioridade
- Worker com `forcarConsulta === false`
- Recuperação PROC
- Gate 656 bloqueia sem chamar SEFAZ

---

## 6. Painel Central

Card XML exibe: Estado MIRX, última/próxima tentativa, tempo restante, nº tentativas, backoff, método, resposta SEFAZ.

---

## 7. Riscos residuais

- Sync Background DistDFe periódico ainda existe (NSU inbox) — compartilha mutex/Gate, mas não passa pela fila MIRX (escopo: recuperação RES_NFE).
- Dois processos Node no mesmo CNPJ ainda podem duplicar consumo (limitação de processo único).

---

## 8. Conclusão

MIRX RC3.4.1 implementado: fila única, worker único de recuperação, Gate obrigatório, backoff inteligente, auditoria/Timeline e painel detalhado — alinhado à NT 2014.002 e à auditoria RC3.4.0.
