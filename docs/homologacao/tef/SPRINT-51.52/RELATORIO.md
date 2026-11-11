# SPRINT 51.52 — Reemissão urgente one-shot

**Data:** 2026-11-10 (~21:54 BRT)  
**Classificação:** `LIBERACAO_ONESHOT_REEMITIDA`  
**Cobrança:** **não executada**

---

## Resultado

| Campo | Valor |
| --- | --- |
| **ID** | `c3fb636267106ce343ca300d64cf7041` |
| **Status** | `ISSUED` |
| **Validade** | até **22:00 BRT** de 10/11/2026 (`expiresAt` UTC `2026-11-11T01:00:00.011Z`) |
| **Valor / op** | R$ 1,00 / CRT débito |
| **Vínculo** | Destaxa + Gertec `GERTEC_PPC930` + COM4 + `pdv_oficial` |
| **Gate global** | **OFF** (`DESTAXA_REAL_TRANSACTION_ENABLED=0`) |
| **Transação executada** | **Não** (sem CRT, TX_*, `/tef/pagar`) |
| **ERP reiniciado** | **Não** (PID Electron **19772** preservado) |
| **MAX TEF id** | **3** (inalterado) |

Auth 51.51 (`7528947…`) estava vencida → marcada `EXPIRED` na emissão; única ISSUED ativa é a desta sprint.

Artefato: `emissao-autorizacao.json`.

---

## Regras

Sem retry, segunda cobrança, PIX, crédito, cancelamento ou estorno. UNKNOWN/timeout → interromper e preservar evidências.

**Aguardando** confirmação de prontidão no PDV; cobrança manual somente após essa confirmação, ainda dentro do TTL.
