# SPRINT 51.45 — Implementação do path RECUPERACAO_PROTOCOLAR_TX3

**Data:** 2026-11-10  
**Base:** plano `SPRINT-51.44/PLANO-RECUPERACAO-TX3.md`  
**Execução Destaxa nesta sprint:** **nenhuma** (dry-run apenas)

---

## 1. Entrega

| Item | Status |
| --- | --- |
| Path nomeado `RECUPERACAO_PROTOCOLAR_TX3` | Implementado |
| Escopo exclusivo TX CDS id=3 | Sim |
| Pré-checagem NSU 2338 / auth 211139 / venda 66 / idempotency | Sim |
| Permit one-shot `TX_FINALIZE` + `confirmacao=0` (em memória / dry-run) | Sim — **ledger não escrito** |
| FINALIZE sem `_contexto` CRT só neste path | Sim (orquestrador) |
| A1 como pré-condição; 00/F0 abortam | Sim |
| Exclusividade da pendência Destaxa obrigatória antes do FINALIZE | Sim |
| Gate global OFF | Preservado |
| Sem retry automático | Sim |

---

## 2. Arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3.js` | Módulo do path (validação, exclusividade, permit dry-run, planejamento) |
| `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` | Extensão mínima: FINALIZE(0) sem CRT **somente** com autorização do path |
| `tests/tef/tef-destaxa-51-45-recuperacao-protocolar-tx3.test.js` | 12 testes |
| `docs/homologacao/tef/SPRINT-51.45/_dry-run-recuperacao-tx3.js` | Runner dry-run (readonly DB) |
| `docs/homologacao/tef/SPRINT-51.45/dry-run-resultado.json` | Artefato do dry-run |
| este relatório | Entrega |

---

## 3. Proteção de exclusividade (obrigatória)

`finalizaTransacaoDestaxa(0)` **não** recebe NSU/transactionId Destaxa. O path **aborta antes do FINALIZE** se faltar prova de que a pendência do Client é a TX 3:

- `INIT_CLIENT = A1` (esperado); **00** ou **F0** → abortar  
- Correlação NSU **2338** + auth **211139** + vespague **10100017275707**  
- Sem outras pendências CDS `pendente`  
- Sem FINALIZE Destaxa posterior à TX 3  
- Sem múltiplas pendências Destaxa possíveis  
- Confirmação explícita de exclusividade do PO + fonte do log A1  

Sem isso: `abortarAntesFinalize=true` e `autorizacaoSemContexto=null`.

---

## 4. Testes

`node --test tests/tef/tef-destaxa-51-45-recuperacao-protocolar-tx3.test.js` → **12/12 OK**

| Caso | Resultado |
| --- | --- |
| TX 3 dry-run elegível | OK |
| TX ≠ 3 | bloqueado |
| NSU divergente | bloqueado |
| Auth divergente | bloqueado |
| FINALIZE(9) | bloqueado |
| TX_START / TX_CONTINUE | bloqueados |
| Sem `_contexto` CRT: só com auth do path | OK |
| 51.41 ciclo automático preservado | OK |
| PDV sem continuidade bloqueado | OK |
| Sem exclusividade → abort | OK |
| INIT A1/00/F0 | OK |
| Gate OFF | OK |

Regressão `tef-destaxa-51-19-host-security-continue.test.js`: **18 OK**.

---

## 5. Dry-run (banco oficial, somente leitura)

Runner: `_dry-run-recuperacao-tx3.js`

| Campo | Valor |
| --- | --- |
| `elegivel` | **true** |
| `dryRun` | **true** |
| `permitLedgerEscrito` | **false** |
| `dllChamada` / `nativeHostChamado` | **false** |
| `gateGlobal` | **OFF** |
| Host permit | `TX_FINALIZE` / `transactionId=3` / `confirmacao=0` / purpose path |

TX 2/3 e venda 66 **não alteradas**.

---

## 6. Confirmação de não-execução

Nesta sprint **não** foram executados:

- `iniciaClientDestaxa` / `finalizaTransacaoDestaxa`  
- DLL / NativeHost / V$Pague  
- Emissão real de permit (ledger)  
- Habilitação de gate  
- CRT / TX_START / TX_CONTINUE / FINALIZE real  
- Alteração de TX 2, TX 3, venda 66, recebimentos ou fiscal  

**Aguardando autorização específica do Product Owner** para sprint de execução real.

---

## 7. Próximo passo (fora desta sprint)

Somente com GO do PO: runner de execução usando o path + permit one-shot materializado + chamada única `finalizaTransacaoDestaxa(0)`, conforme plano 51.44 — sem nova cobrança.
