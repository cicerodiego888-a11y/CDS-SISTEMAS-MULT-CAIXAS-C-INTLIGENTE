# SPRINT 51.59 — Novo INIT_CLIENT com sessão persistente

**Data:** 2026-11-11  
**Classificação:** `INIT_CLIENT_CONFIRMED_SESSION_ACTIVE`  
**Operação financeira:** **nenhuma**

---

## 1. Veredito

**Um** `INIT_CLIENT` executado com retorno **00** / **CLIENT_INITIALIZED**. NativeHost **mantido ativo** (sem SHUTDOWN). Gate global permanece **OFF**. Sem CRT, TX_*, `/tef/pagar` ou one-shot.

| Campo | Valor |
| --- | --- |
| INIT_CLIENT | **00** |
| CLIENT_INITIALIZED | **true** |
| requestId INIT | `59976c52a5725517` |
| NativeHost PID | **8688** (ppid probe **10756**) |
| hostSessionId | `168158a6e0817b7fa210a5aabd22c689` |
| Host encerrado após INIT | **Não** |
| Sessão reutilizável | **Sim** (`sessaoAtiva=true`, heartbeat STATUS) |
| ERP Electron PID | **20032** (preservado) |
| V$Pague PID | **22380** (preservado) |
| Gate | **OFF** (`0`) antes e depois |
| MAX TEF id | **4** (inalterado) |

---

## 2. Precheck (revalidação)

| Item | Resultado |
| --- | --- |
| ERP Electron PID 20032 | **OK** (preservado) |
| V$Pague PID 22380 único | **OK** (preservado) |
| Gertec PPC930 COM4 | **OK** (PnP Status OK + DB habilitado/ativo) |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **0** (OFF) |
| `MAX(tef_transacoes.id)` | **4** |
| TX2 / TX3 / TX4 | Intactas (`negado` / `aprovado` 2338 / `aprovado` 2348) |
| Pendente / UNKNOWN | Nenhum |

Artefato: `precheck.json`.

---

## 3. Execução

| Passo | Detalhe |
| --- | --- |
| 1 | Precheck ERP / V$Pague / COM4 / gate OFF / MAX TEF=4 |
| 2 | Processos existentes preservados (ERP 20032, V$Pague 22380) |
| 3 | NativeHost via bootstrap oficial isolado (`tef-51-59-init-persistente.js`) |
| 4 | LOAD DLL Destaxa |
| 5 | **Exatamente um** `INIT_CLIENT` |
| 6 | Confirmação `00` + `CLIENT_INITIALIZED` |
| 7 | NativeHost **não** encerrado; heartbeat STATUS a cada 15s → `session-alive.json` |

Método: mesmo caminho nativo de `prepararAutorizacao` até `iniciaClientDestaxa`, **sem** persistir TEF e **sem** SHUTDOWN pós-evidência.

---

## 4. Evidências INIT / sessão

| Campo | Valor |
| --- | --- |
| codigoDestaxa | `00` |
| clientInitialized | `true` |
| clientResultCode | `00` |
| operacaoAtiva | `null` |
| gateReal | `false` |
| dllLoaded | `true` |
| securityBootstrapState | `SECURITY_BOOTSTRAP_VALIDATED` |
| hostEncerradoAposInit | `false` |
| A1 / F0 | Ausentes |
| Artefatos | `evidencias-init.json`, `session-alive.json` |

Observability: `INIT_CLIENT` resultCode=`00`, requestId=`59976c52a5725517`.

Heartbeat pós-INIT: STATUS com `clientInitialized=true`, `clientResultCode=00`, `sessaoAtiva=true`; processos **8688** (host) e **10756** (probe) vivos junto com ERP **20032** e V$Pague **22380**.

---

## 5. PDV oficial / reconhecimento da sessão

| Item | Estado |
| --- | --- |
| ERP oficial | Ativo (PID **20032**) |
| V$Pague compartilhado | Ativo (PID **22380**) |
| Sessão Destaxa no NativeHost | INIT **00**, `CLIENT_INITIALIZED`, host vivo |
| Gate no STATUS do host | `gateReal=false` |
| PinPad COM4 | OK |

Sessão persistente confirmada operacionalmente via STATUS contínuo do NativeHost (não encerrado após INIT, ao contrário da 51.57).

---

## 6. Restrições cumpridas

Não executados: CRT, TX_START/CONTINUE/FINALIZE, `/api/tef/pagar`, one-shot, segundo INIT, ENABLE_REAL, permit, SEFAZ, reinício de ERP/V$Pague, encerramento do NativeHost após INIT.

---

## 7. Estado final

| Item | Estado |
| --- | --- |
| Classificação | **`INIT_CLIENT_CONFIRMED_SESSION_ACTIVE`** |
| Gate | **OFF** |
| ERP | Operacional (PID 20032) |
| V$Pague | 22380 |
| NativeHost | **Ativo** (PID 8688) |
| Sessão Destaxa | Reutilizável (`hostSessionId` `168158a6…`) |
| Pronto para | Próximo passo (one-shot + CRT) **somente** com GO específico do PO |
