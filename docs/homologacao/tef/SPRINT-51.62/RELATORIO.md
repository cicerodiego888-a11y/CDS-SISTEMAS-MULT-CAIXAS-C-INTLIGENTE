# SPRINT 51.62 — One-shot para cobrança manual Destaxa

**Data:** 2026-11-11  
**Classificação:** `READY_FOR_MANUAL_PDV_PAYMENT`  
**Cobrança pelo Cursor:** **não executada**

---

## 1. Veredito

Autorização excepcional **ISSUED** para **uma** cobrança manual de **R$ 1,00 débito** Destaxa / Gertec COM4 / PDV oficial. Gate global permanece **OFF**. Sem `/api/tef/pagar`, CRT ou TX_* nesta sprint.

| Campo | Valor |
| --- | --- |
| **authorizationId** | `b1984345b0e39f8df0fde68367ebd60b` |
| **Status** | `ISSUED` |
| **Validade** | até **11/11/2026 09:04:33** (America/Sao_Paulo) / UTC `2026-11-11T12:04:33.219Z` |
| **Valor / modalidade / op** | R$ 1,00 / débito / CRT |
| **Vínculo** | Destaxa + `GERTEC_PPC930` + COM4 + `pdv_oficial` |
| **Retry** | `false` |
| **ERP / NativeHost** | PID **16744** / **13940** |
| **hostSessionId** | `91ce63acec0f09b2efba16571dad4c74` |
| **Gate** | **OFF** (`0`) |
| **MAX TEF id** | **4** (inalterado) |
| **Cobrança Cursor** | **Não** |

Artefato: `emissao-autorizacao.json`.

---

## 2. Precheck

| Item | Resultado |
| --- | --- |
| ERP PID 16744 | **OK** |
| NativeHost PID 13940 (filho do ERP, NodeService) | **OK** |
| Sessão `91ce63ac…` / `sessaoAtiva` / `vinculoPdvOk` | **OK** |
| `CLIENT_INITIALIZED` / INIT=00 / `operacaoAtiva=null` | **OK** |
| V$Pague PID 22380 único | **OK** |
| Gertec PPC930 COM4 | **OK** |
| Pendente / UNKNOWN | Nenhum |
| TX2 / TX3 / TX4 | Intactas |
| Venda 67 | Intacta (`tef_transacao_id=4`) |
| Gate | **OFF** |

Artefato: `precheck.json`.

---

## 3. Disponibilidade ao PDV (sem consumo)

| Checagem | Resultado |
| --- | --- |
| `inspecionarAutorizacaoExcepcional` | `ISSUED` |
| `encontrarAutorizacaoIssuidaCompativel` (débito R$1 / CRT / vínculo) | **OK** — não consumiu |
| Status após inspeção | continua **ISSUED** |

---

## 4. Aviso fiscal (antes da cobrança)

O fluxo oficial do PDV, após TEF aprovado, **tipicamente segue** para emissão/transmissão de NFC-e.  
Esta sprint **não isola** a SEFAZ. **Transmissão fiscal exige autorização separada do PO.**  
O operador deve estar ciente disso **antes** de concluir a venda.

---

## 5. Instruções ao operador

Dentro do TTL (até **09:04:33 BRT**):

1. No PDV oficial (ERP **16744**), venda de homologação **R$ 1,00** em **débito** Destaxa / Gertec COM4.
2. **Uma** tentativa apenas. Sem retry, PIX, crédito, cancelamento ou estorno.
3. UNKNOWN / timeout / resposta ambígua / falha de persistência → **interromper**, preservar evidências, **não** repetir.
4. Gate `DESTAXA_REAL_TRANSACTION_ENABLED` permanece **OFF**.
5. NFC-e/SEFAZ: só com GO fiscal separado.

---

## 6. Restrições cumpridas

Sem `/api/tef/pagar`, CRT automático, TX_*, segundo one-shot, INIT novo, gate ON, alteração TX2–4/venda 67, cancel/estorno.

---

## 7. Estado final

| Campo | Valor |
| --- | --- |
| Classificação | **`READY_FOR_MANUAL_PDV_PAYMENT`** |
| One-shot ID | `b1984345b0e39f8df0fde68367ebd60b` |
| Expira | **09:04:33 BRT** (`2026-11-11T12:04:33.219Z`) |
| Sessão | `91ce63acec0f09b2efba16571dad4c74` |
| Gate | **OFF** |
| Cobrança pelo Cursor | **Não** |
