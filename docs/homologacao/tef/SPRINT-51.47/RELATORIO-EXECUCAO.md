# SPRINT 51.47 — Execução controlada FINALIZE(0) — TX 3

**Data:** 2026-11-10  
**Classificação:** `SUCESSO_RECUPERACAO`  
**Path:** `RECUPERACAO_PROTOCOLAR_TX3`  
**Autorização PO:** 10/11/2026 — token `GO-PO-RECUPERACAO-TX3-FINALIZE-0`

---

## 1. Veredito

Confirmação protocolar Destaxa da operação original (NSU 2338) concluída com **uma** chamada `finalizaTransacaoDestaxa(0)`.

| Item | Resultado |
| --- | --- |
| INIT_CLIENT atual (pré) | **A1** (leitura nativa nesta sprint) |
| FINALIZE(0) | **00** — `CONFIRMED_SUCCESS` |
| INIT_CLIENT pós | **00** — A1 eliminado |
| Chamadas FINALIZE | **1** |
| Nova cobrança / nova TEF | **Não** (`max id` permanece 3) |
| TX 3 / venda 66 | Preservadas (NSU, auth, status, vínculo, comprovantes) |
| Gate global | **OFF** |
| TX_START / CONTINUE / CRT / FINALIZE(9) | **Não executados** |

Artefato: `resultado-execucao.json` · auditoria: `auditoria-fases.jsonl`

---

## 2. Pré-validações (antes de qualquer chamada nativa)

| Checagem | Evidência |
| --- | --- |
| TX 3 `aprovado`, NSU 2338, auth 211139, venda 66, idempotency original | CDS readonly OK |
| Venda 66 → `tef_transacao_id=3` | OK |
| Sem outras pendências CDS | `pendentes=[]` |
| V$Pague único | PID **20760** (`:60906`) — sem segundo Client |
| Gate env | `DESTAXA_REAL_TRANSACTION_ENABLED` ≠ 1 |
| A1 histórico 51.43 | **Não usado** como prova atual |

---

## 3. Exclusividade da pendência Destaxa

| Critério | Valor |
| --- | --- |
| INIT_CLIENT **atual** | **A1** — NativeHost PID **9264**, requestId `8e0dff0c80b4ff3e` @ `2026-11-10T22:44:11Z` |
| Correlação | NSU 2338 + auth 211139 + vespague `10100017275707` |
| Outras pendências CDS | Nenhuma |
| Confirmação exclusividade PO | Sim (autorização desta sprint) |
| `abortarAntesFinalize` | false |

Sem essa comprovação atual, o runner abortaria antes do FINALIZE.

---

## 4. Identidade da sessão Destaxa

| Campo | Valor |
| --- | --- |
| NativeHost PID | **9264** (PPID runner Electron **13820**) |
| hostSessionId | `df3ca68fb6cc5080d823efb9485228c3` |
| Bootstrap | `SECURITY_BOOTSTRAP_VALIDATED` |
| V$Pague | PID 20760 (pré-existente; não reinicializado) |
| DLL | `resources/tef/destaxa/win-x64/libdll-integracao-tef.dll` |
| Operação ativa no INIT | null |

---

## 5. Permit — identificação e consumo

| Aspecto | Detalhe |
| --- | --- |
| Purpose | `RECUPERACAO_PROTOCOLAR_TX3` |
| Host permit | one-shot `TX_FINALIZE` + `transactionId=3` (emitido no SECURITY_BOOTSTRAP imediatamente antes do FINALIZE) |
| Exceptional permit | `confirmacao=0`, `oneShot=true`, gate OFF |
| ENABLE_REAL | sucesso (`exceptional: true`) — requestId `d8ae510433ba2d2d` |
| Reutilização de permit anterior | Não |
| Ledger CRT homologação | Não escrito (`ledgerEscrito=false`) |

---

## 6. Execução FINALIZE

| Campo | Valor |
| --- | --- |
| Quantidade de chamadas | **1** |
| Operação Host | `TX_FINALIZE` |
| `confirmacao` | **0** |
| `transactionId` | **3** |
| requestId | `75407b78ceda91c9` |
| Código retorno | **00** |
| `financialState` | `CONFIRMED_SUCCESS` |
| `recuperacaoProtocolarTx3` | true |
| `semContextoCrt` | true |
| `retryAllowed` | false |
| Duração | ~999 ms |

Segunda chamada FINALIZE: **não ocorreu**.

---

## 7. Verificação posterior

| Etapa | Resultado |
| --- | --- |
| INIT_CLIENT pós (única) | **00** — requestId `3035541d67820326` |
| A1 eliminado | **Sim** (`bloqueadoA1=false`, `clientInitialized=true`) |
| Reler TX 3 | `aprovado`, NSU **2338**, auth **211139**, comprovante cliente len **1057** |
| Reler venda 66 | `concluida` / `quitada` / `tef_transacao_id=3` |
| TX 2 | Inalterada (`negado`) |
| `max(tef_transacoes.id)` | **3** |

---

## 8. Logs e auditoria

| Fonte | Conteúdo |
| --- | --- |
| `auditoria-fases.jsonl` | BOOT → PRECHECK → HOST → INIT A1 → EXCLUSIVIDADE → PERMIT → FINALIZE 00 → POS 00 → SUCESSO |
| `resultado-execucao.json` | Snapshot completo pré/pós |
| Observability | `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl` — INIT A1 → ENABLE_REAL → TX_FINALIZE 00 → INIT 00 |

---

## 9. Confirmações negativas (restrições)

- Sem nova CRT / cobrança  
- Sem TX_START / TX_CONTINUE / FINALIZE(9)  
- Sem segunda FINALIZE(0)  
- Sem retry automático ou manual  
- Sem alteração de gate global  
- Sem alteração de TX 2, TX 3, venda 66, recebimentos, comprovantes ou eventos fiscais  

Nenhuma outra operação foi iniciada automaticamente após o sucesso.
