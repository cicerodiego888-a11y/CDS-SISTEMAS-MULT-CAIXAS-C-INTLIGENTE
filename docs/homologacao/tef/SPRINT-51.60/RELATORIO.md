# SPRINT 51.60 — Preparação da cobrança manual pelo PDV

**Data:** 2026-11-11  
**Classificação:** `BLOCKED_WITH_EVIDENCE`  
**One-shot:** **não emitida**  
**Cobrança / CRT / TX_* / `/tef/pagar`:** **não executados**

---

## 1. Veredito

O precheck operacional básico (ERP, V$Pague, NativeHost 8688, INIT=00, COM4, gate OFF, MAX TEF=4) está **íntegro**, mas a **sessão preparada na 51.59 não está vinculada ao PDV oficial**.

| Prova | Evidência |
| --- | --- |
| NativeHost PID **8688** | Filho do probe Electron **10756** (`tef-51-59-init-persistente.js`) |
| ERP PID **20032** | Filhos: gpu / network / renderer — **0** `utility-sub-type=node.mojom.NodeService` |
| Arquitetura | `DestaxaNativeHostClient.obterClienteCompartilhado()` = singleton **in-process** (um NativeHost por processo Electron) |
| Conclusão | PDV oficial **não** utiliza `hostSessionId` `168158a6e0817b7fa210a5aabd22c689`; no CRT abriria **outra** instância NativeHost |

Conforme a regra desta sprint: **não** emitir one-shot e **não** executar novo `INIT_CLIENT` automaticamente.

Gate global permanece **OFF**. Nenhuma cobrança executada. Nenhuma nova transação TEF.

---

## 2. Precheck

| Item | Resultado |
| --- | --- |
| ERP PID 20032 | **OK** (ativo) |
| V$Pague PID 22380 único | **OK** |
| NativeHost PID 8688 | **OK** (ativo; ppid **10756**) |
| Sessão `168158a6…` operacional | **OK** no probe (`session-alive.json`, `sessaoAtiva=true`) |
| `CLIENT_INITIALIZED` / INIT=00 | **OK** (STATUS do host probe) |
| Gertec PPC930 COM4 | **OK** (PnP + `tef_pinpads`) |
| Gate global | **OFF** (`0`) |
| Pendente / UNKNOWN | Nenhum |
| `MAX(tef_transacoes.id)` | **4** |
| PDV oficial usa a sessão preparada | **FALHA** — sessão isolada no probe |

Artefato: `precheck.json`.

---

## 3. Identificação da sessão

| Campo | Valor |
| --- | --- |
| hostSessionId (51.59) | `168158a6e0817b7fa210a5aabd22c689` |
| NativeHost PID | **8688** |
| Probe Electron PID | **10756** |
| requestId INIT | `59976c52a5725517` |
| Acessível pelo ERP/PDV 20032 | **Não** |
| Sessão usada pelo PDV | **Nenhuma** (ERP sem NativeHost próprio) |

---

## 4. Autorização one-shot

| Campo | Valor |
| --- | --- |
| Emissão | **Não realizada** |
| Status ISSUED | **N/A** |
| ID | **N/A** |
| Expiração | **N/A** |
| Motivo | Precheck integral reprovado no vínculo PDV ↔ sessão |

Ledger: sem nova ISSUED nesta sprint (ver `precheck.json` → `ledger`).

---

## 5. Confirmações de segurança

| Restrição | Status |
| --- | --- |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **OFF** |
| Cobrança executada | **Não** |
| Nova transação TEF | **Não** (MAX id permanece **4**) |
| CRT / TX_START / CONTINUE / FINALIZE | **Não** |
| `/api/tef/pagar` | **Não** |
| Novo INIT_CLIENT | **Não** |
| Reinício ERP / V$Pague / NativeHost | **Não** |
| PIX / crédito / cancel / estorno | **Não** |
| NFC-e #52 / venda #67 / TEF id 4 / SEFAZ | Intactos |

---

## 6. Solicitação ao PO

Para obter `READY_FOR_MANUAL_PDV_PAYMENT`, autorizar **explicitamente** um ciclo em que o **INIT_CLIENT ocorra no processo do ERP/PDV oficial** (PID do host filho de `electron-erp.js`), mantendo gate OFF — **não** em probe isolado.

Somente após INIT=00 na sessão **do PDV** e confirmação de vínculo: emitir one-shot e liberar a cobrança manual no PDV.

---

## 7. Estado final

| Campo | Valor |
| --- | --- |
| Classificação | **`BLOCKED_WITH_EVIDENCE`** |
| One-shot | Não emitida |
| Gate | OFF |
| MAX TEF id | **4** |
