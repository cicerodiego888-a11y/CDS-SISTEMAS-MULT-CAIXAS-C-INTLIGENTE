# SPRINT 51.50 — Preparação da primeira venda TEF pós-recuperação

**Data:** 2026-11-10  
**Classificação:** `READY_FOR_ONE_REAL_TEST`  
**Contexto:** pós SPRINT 51.47 (FINALIZE 00) / 51.48 (verificação) / 51.49 (INIT_OK)

---

## 1. Veredito

O ambiente está **pronto para um único teste real de homologação**, sujeito a **autorização específica do Product Owner**.

Nenhuma venda foi criada, `/api/tef/pagar` não foi chamado, e não houve CRT, TX_*, permit, ENABLE_REAL nem chamada financeira à DLL/Destaxa nesta sprint.

| Critério | Resultado |
| --- | --- |
| ERP + PDV oficiais | Operacionais (PID Electron **14792**) |
| INIT_CLIENT | **00** (evidência SPRINT 51.49 — requestId `0c53e72df667ac84`) |
| V$Pague | Único e ativo (PID **20760**, `:60906` Listen) |
| PinPad Gertec | **PPC930** em **COM4** (PnP OK + `tef_pinpads` ativo) |
| Gate financeiro global | **OFF** (`DESTAXA_REAL_TRANSACTION_ENABLED=0`) |
| Pendente / UNKNOWN | Nenhum |
| TX 2 / TX 3 | `negado` / `aprovado` (inalterados) |
| Venda 66 | Preservada (`concluida` / `quitada` / TEF **3**) |
| Fluxo START→CONTINUE→FINALIZE | Revisado no código (intent ciclo completo) |
| Correção 51.41 (`intentCicloAutomaticoFinalize`) | Preservada |
| Idempotência + comprovantes | Verificados (TX 3 + repositório) |
| Nova TEF / cobrança | **Não** (`MAX(id)` = **3**) |

---

## 2. Checklist das verificações

| # | Verificação | Status | Evidência |
| --- | --- | --- | --- |
| 1 | ERP e PDV oficial operacionais | OK | Janelas visíveis: `CDS Sistemas - Plataforma Inteligente de Gestão` e `CDS Sistemas - PDV` (PID **14792**); mesma sessão da 51.49 |
| 2 | INIT_CLIENT = 00 | OK | SPRINT 51.49 `INIT_OK` — `clientResultCode=00`, `clientInitialized=true`, sem A1/F0 (`evidencias-init.json`) |
| 3 | V$Pague único e ativo | OK | 1× `VSPagueClient.exe` PID **20760**; TCP **60906** Listen |
| 4 | PinPad Gertec disponível e identificado | OK | PnP: `PPC-920/930 CDC USB-to-Serial Port (COM4)` Status **OK**; DB `tef_pinpads` id=1: Gertec PPC930 / `GERTEC_PPC930` / `porta_com=COM4` / `habilitado=1` / `ativo=1` |
| 5 | Gate financeiro global OFF | OK | Env `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| 6 | Nenhuma operação TEF pendente ou UNKNOWN | OK | `pendentes=[]`; ids 1/2/3 sem `financialState=UNKNOWN` operacional |
| 7 | TX 2 = negado e TX 3 = aprovado | OK | TX2 `negado` (venda 65); TX3 `aprovado` NSU **2338** auth **211139** (venda 66) |
| 8 | Venda 66 preservada | OK | `total=1`, `status=concluida`, `status_pagamento=quitada`, `tef_transacao_id=3`, `forma_pagamento=cartao_debito` |
| 9 | Fluxo automático START→CONTINUE→FINALIZE | OK | `TefManager.autorizar` emite intent com `allowedOperations: ['TX_START','TX_CONTINUE','TX_FINALIZE']` no ciclo CRT |
| 10 | Correção permit TX_FINALIZE (51.41) | OK | `intentCicloAutomaticoFinalize` presente e ativo em `TefManager.js` (~L368–384) |
| 11 | Idempotência e persistência de comprovantes | OK | TX3 `idempotency_key=tef-segunda-tentativa-bd6a8809bc64abb7`; comprovantes cliente/estab. len **1057**; `tefRepository` persiste com `COALESCE` + criptografia e guarda concorrência |

Artefato de leitura: `_precheck-readonly.js` (somente leitura no banco oficial).

---

## 3. Contexto preparado (não executado)

Preparação documental para **futura** venda de homologação:

| Campo | Valor planejado |
| --- | --- |
| Valor | **R$ 1,00** |
| Modalidade | **Débito** |
| Provedor | Destaxa (homologação) |
| Pré-condição | Gate permanece OFF até GO do PO; permit one-shot só no ciclo autorizado |
| Pós-condição esperada | Nova TEF `id ≥ 4` apenas após autorização explícita |

**Não executado nesta sprint:** criação de venda, `/api/tef/pagar`, CRT, TX_START, TX_CONTINUE, TX_FINALIZE, ENABLE_REAL, novo permit, alteração de TX 2/3/venda 66/recebimentos/documentos fiscais.

---

## 4. Estado CDS (readonly)

| Entidade | Estado |
| --- | --- |
| TX 1 | `nao_realizada` |
| TX 2 | `negado` — idempotency `tef-primeira-venda-9dd272f1d91f84df` |
| TX 3 | `aprovado` — NSU 2338 / auth 211139 — comprovantes 1057/1057 |
| Venda 66 | Preservada e vinculada à TX 3 |
| `MAX(id)` TEF | **3** (total 3 linhas) |
| `tef_configuracao` | `habilitado=1`, `provedor=destaxa`, `ambiente=homologacao` |

---

## 5. Revisão de código (sem alteração)

### 5.1 Ciclo automático + permit FINALIZE (51.41)

- Intent do autorizar: `['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']`.
- Gate de execução: `intentCicloAutomaticoFinalize` libera TX_FINALIZE no ciclo completo sem exigir `_continuidadeCrt` (path PDV parcial continua exigindo continuidade).
- Permit permanece one-shot por operação/`transactionId`.

### 5.2 Idempotência / comprovantes

- Persistência pré-CRT gera `idempotency_key` durável na linha TEF.
- Updates de comprovante usam `COALESCE` (não apagam texto já gravado) e criptografia no repositório.
- TX 3 pós-recuperação mantém comprovantes e chave de idempotência originais.

---

## 6. Restrições cumpridas

| Restrição | Cumprida |
| --- | --- |
| Nenhuma cobrança real | Sim |
| Nenhum TX_START / TX_CONTINUE / TX_FINALIZE | Sim |
| Nenhuma chamada financeira à DLL/Destaxa | Sim |
| Nenhum novo permit | Sim |
| Gate global não habilitado | Sim |
| TX 2, TX 3 e venda 66 inalterados | Sim |
| Recebimentos / docs fiscais inalterados | Sim |

INIT desta sprint: **não reexecutado** (evita carga desnecessária na DLL). Aceita-se a evidência fresca da SPRINT 51.49 na mesma sessão de processos (ERP/PDV/V$Pague estáveis).

---

## 7. Próximo passo (bloqueado até GO do PO)

Aguardar **autorização específica do Product Owner** para a próxima operação (primeira venda TEF real pós-recuperação, R$ 1,00 débito).

Sem GO do PO: **não** iniciar venda, **não** chamar `/api/tef/pagar`, **não** emitir permit financeiro, **não** habilitar gate global.
