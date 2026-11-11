# SPRINT 51.61 — Inicialização NativeHost no ERP/PDV Oficial

**Data:** 2026-11-11  
**Classificação:** `ERP_NATIVEHOST_SESSION_CONFIRMED`  
**Operação financeira:** **nenhuma**  
**One-shot:** **não emitida**

---

## 1. Veredito

**Um** `INIT_CLIENT` executado **no processo oficial do ERP** (`electron-erp.js`), via `DestaxaHostBridge` + singleton `DestaxaNativeHostClient` / `TefManager`. NativeHost é **filho do ERP**. Sessão preservada ativa. Gate **OFF**.

O ERP oficial está **pronto para receber** uma operação manual pelo PDV **somente após** GO específico do PO (one-shot + cobrança) — esta sprint **não** executou cobrança.

| Campo | Valor |
| --- | --- |
| INIT_CLIENT | **00** |
| CLIENT_INITIALIZED | **true** |
| requestId INIT | `6aa8b07ffd9c4317` |
| ERP PID (oficial atual) | **16744** (substitui 20032, reinício controlado para carregar INIT no processo oficial) |
| NativeHost PID | **13940** |
| Relação pai/filho | Host **13940** ← ERP **16744** (`utility-sub-type=node.mojom.NodeService`) |
| IPC | `utilityProcess.postMessage` (`DestaxaNativeHostClient`) |
| hostSessionId | `91ce63acec0f09b2efba16571dad4c74` |
| STATUS `sessaoAtiva` | **true** |
| operacaoAtiva | **null** |
| Singleton TefManager | **mesmo client** (`adapterClientIsShared` / `tefManagerClientIsShared`) |
| Probe 10756 / sessão 51.59 | **Não reutilizada** (encerrada antes do INIT) |
| V$Pague | PID **22380** (preservado) |
| Gate | **OFF** (`0`) |
| MAX TEF id | **4** (inalterado) |

---

## 2. Precheck (antes da execução)

| Item | Resultado |
| --- | --- |
| ERP 20032 | Ativo (antes do reinício controlado) |
| V$Pague 22380 único | **OK** |
| Gertec PPC930 COM4 | **OK** |
| Pendente / UNKNOWN | Nenhum |
| TX2 / TX3 / TX4 | Intactas (`negado` / `aprovado` 2338 / `aprovado` 2348) |
| Venda 67 | `concluida`, `tef_transacao_id=4` |
| Gate | **OFF** |
| Sessão probe 10756 | Presente — **marcadas para não reutilizar** |

Artefato: `precheck.json`.

---

## 3. Execução

| Passo | Detalhe |
| --- | --- |
| 1 | Encerrar probe 51.59 (PID 10756 + host 8688) — não é sessão do ERP |
| 2 | Reinício controlado do ERP com `DESTAXA_REAL_TRANSACTION_ENABLED=0` e `CDS_TEF_ERP_INIT_CLIENT_ONCE=1` |
| 3 | Hook em `electron-common.js` (env-gated) → `tef-51-61-erp-init-once.js` **dentro do ERP** |
| 4 | `obterAdapter()` → `DestaxaHostBridge` → singleton oficial |
| 5 | LOAD DLL → **um** `INIT_CLIENT` |
| 6 | STATUS + heartbeat `session-alive.json` (sem SHUTDOWN) |

Lock `init-once.lock` impede segundo INIT automático.

---

## 4. Comprovação do vínculo PDV ↔ sessão

| Prova | Evidência |
| --- | --- |
| OS parent/child | PID 13940 `ParentProcessId=16744`; cmdline `node.mojom.NodeService` |
| Client API | `getEstado().pidPai === 16744` |
| Mesmo singleton | `TefManager._nativeHostClient === obterClienteCompartilhado()` |
| Fluxo oficial | Adapter Destaxa real / `native-host` — mesmo caminho usado pelo PDV em `prepararAutorizacao` |
| Heartbeat | `session-alive.json` com `sessaoAtiva=true`, `vinculoPdvOk=true` |

Não foi usada sessão do probe. Não há segundo NativeHost de teste independente.

Artefato: `evidencias-init.json`.

---

## 5. Preservação / restrições

| Restrição | Status |
| --- | --- |
| Gate global OFF | **Sim** |
| One-shot | **Não emitida** |
| `/api/tef/pagar` / CRT / TX_* | **Não** |
| ENABLE_REAL | **Não** |
| A1 / F0 | Ausentes |
| Alteração TX2–4 / venda 67 | **Não** |
| SEFAZ / NFC-e | **Não** |
| Cancel / estorno / PIX / crédito | **Não** |
| Sessão mantida ativa | **Sim** (host não encerrado) |

---

## 6. Pronto para PDV manual?

**Sessão NativeHost do ERP:** sim (`ERP_NATIVEHOST_SESSION_CONFIRMED`).

**Cobrança manual:** **ainda não liberada nesta sprint** — falta GO do PO para emitir one-shot e executar a CRT no PDV.

---

## 7. Estado final

| Campo | Valor |
| --- | --- |
| Classificação | **`ERP_NATIVEHOST_SESSION_CONFIRMED`** |
| ERP oficial | PID **16744** |
| NativeHost | PID **13940**, session `91ce63ac…` |
| Gate | **OFF** |
| MAX TEF | **4** |
