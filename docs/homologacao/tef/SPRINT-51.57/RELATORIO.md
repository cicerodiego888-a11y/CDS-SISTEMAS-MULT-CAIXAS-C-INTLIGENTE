# SPRINT 51.57 — Retomada controlada da sessão Destaxa

**Data:** 2026-11-11  
**Classificação:** `INIT_CLIENT_CONFIRMED`  
**Operação financeira:** **nenhuma**

---

## 1. Veredito

ERP subido, **um** `INIT_CLIENT` executado com retorno **00** / **CLIENT_INITIALIZED**. Gate global permanece **OFF**. Sem CRT, TX_*, `/tef/pagar`, one-shot ou SEFAZ.

| Campo | Valor |
| --- | --- |
| INIT_CLIENT | **00** |
| CLIENT_INITIALIZED | **true** |
| requestId INIT | `64d60ea12682ae38` |
| NativeHost PID | **14896** (ppid probe **18568**) |
| hostSessionId | `8d85143db0322f5c238e120fe9670884` |
| ERP Electron PID | **20032** |
| V$Pague PID | **22380** (inalterado) |
| Gate | **OFF** (`0`) antes e depois |
| MAX TEF id | **4** (inalterado) |

---

## 2. Precheck

| Item | Resultado |
| --- | --- |
| ERP ativo antes | **Não** |
| V$Pague | PID **22380** único |
| Gertec PPC930 COM4 | PnP OK + DB habilitado/ativo |
| Gate | OFF |

Artefato: `precheck.json`.

---

## 3. Execução

| Passo | Detalhe |
| --- | --- |
| 1 | `electron.cmd electron-erp.js --cds-forcar-local` com `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| 2 | ERP Electron PID **20032** |
| 3 | Probe INIT `tef-51-57-init-client.js` (perfil TEF `erp`, bootstrap oficial) |
| 4 | LOAD DLL → **um** `INIT_CLIENT` → STATUS |
| 5 | Host encerrado de forma controlada após evidência (sem retry) |

Método: mesmo caminho nativo de `prepararAutorizacao` até `iniciaClientDestaxa`, **sem** persistir TEF (não usa `/api/tef/pagar`).

---

## 4. Evidências INIT

| Campo | Valor |
| --- | --- |
| codigoDestaxa | `00` |
| clientInitialized | `true` |
| clientResultCode | `00` |
| operacaoAtiva | `null` |
| gateReal | `false` |
| dllLoaded | `true` |
| A1 / F0 | Ausentes |
| Artefato | `evidencias-init.json` |

Observability: `INIT_CLIENT` resultCode=`00`, requestId=`64d60ea12682ae38`.

---

## 5. Restrições cumpridas

Não executados: CRT, TX_START/CONTINUE/FINALIZE, `/api/tef/pagar`, one-shot, PIX/débito/crédito cobrança, cancel/estorno, SEFAZ, segundo INIT, reinício de V$Pague.

---

## 6. Estado final

| Item | Estado |
| --- | --- |
| Classificação | **`INIT_CLIENT_CONFIRMED`** |
| Gate | **OFF** |
| ERP | Operacional (PID 20032) |
| V$Pague | 22380 |
| Sessão Destaxa | INIT 00 confirmado nesta sprint |
| Pronto para | Próximo passo (one-shot + CRT) **somente** com GO específico do PO |
