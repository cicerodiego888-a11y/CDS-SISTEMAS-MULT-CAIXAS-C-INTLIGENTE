# TEF-DESTAXA-51.02 — Gate + autorização one-shot + diagnóstico 400/404

**Status:** CONCLUÍDA  
**Data:** 2026-11-09  
**Transação financeira:** nenhuma  
**Gate global:** permanece OFF (não definido como `1` em User/Machine)

## 1. Arquivos analisados

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/destaxa/destaxaConstantes.js` | `transacaoRealHabilitada()` / erros |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | `prepararAutorizacao`, `autorizarPagamento`, mensagem do gate |
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` | `habilitarTransacaoReal` |
| `backend/services/tef/destaxa/DestaxaHostBridge.js` | proxy IPC `ENABLE_REAL` |
| `backend/services/tef/destaxa/DestaxaNativeHost.js` | handler `ENABLE_REAL` |
| `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` | gate em TX_START/CONTINUE/FINALIZE |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | bloqueio pré-TX |
| `backend/services/vendas/VendaPagamentoService.js` | `POST /api/vendas` → 400 |
| `backend/services/OrquestradorPagamento.js` | TEF fiscal no finalize |
| `frontend/pdv/js/pdv.js` | payload débito / POST vendas |

## 2. Causas comprovadas

### Gate financeiro
- Lido em `transacaoRealHabilitada()` — só literal `"1"`.
- Bloqueio visível no PDV: `DestaxaRealAdapter.prepararAutorizacao` após caminho CRT pronto e **antes** de `TX_START`.
- Mensagem: `Caminho CRT real pronto; transação bloqueada pelo gate financeiro (DESTAXA_REAL_TRANSACTION_ENABLED != 1)`.
- Código: `DESTAXA_REAL_TRANSACTION_DISABLED`.

### HTTP 400 (`POST /api/vendas`)
- **Causa:** propagação esperada do bloqueio TEF (`DESTAXA_REAL_TRANSACTION_DISABLED`) via Orquestrador → `res.status(400)`.
- **Não** é falha de `pagamentosMistos` vazio.
- **Não** foram removidas validações de venda/fiscal.
- Correção funcional: autorização excepcional one-shot (abaixo), não “abrir” a rota.

### HTTP 404
- URL exata **não** disponível no console colado.
- Classificação: **PENDENTE / provavelmente independente** do CRT Destaxa (fluxo atual de débito não depende de `POST /api/tef/pagar`).
- Sem correção de código nesta sprint.

## 3. Arquivos alterados / criados

| Arquivo | Alteração |
| --- | --- |
| `backend/services/tef/destaxa/destaxaAutorizacaoExcepcional.js` | **Novo** — ledger, emit, consume atômico, auditoria |
| `backend/services/tef/destaxa/destaxaConstantes.js` | códigos de erro da autorização excepcional |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | prepare com ISSUED; consume antes de TX |
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` | `habilitarTransacaoReal({ exceptionalPermit })` |
| `backend/services/tef/destaxa/DestaxaHostBridge.js` | encaminha permit no `ENABLE_REAL` |
| `backend/services/tef/destaxa/DestaxaNativeHost.js` | aplica permit no ENABLE_REAL |
| `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` | gate env **ou** permit excepcional |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | idem no ciclo |
| `tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js` | **Novo** — 14 testes mock |
| `docs/homologacao/tef/TEF-DESTAXA-51.02/RELATORIO.md` | este relatório |

## 4. Correções realizadas

- Mecanismo de **autorização excepcional de uso único** (R$1,00, débito, à vista, CRT).
- Gate env **permanece OFF**; a autorização não seta `DESTAXA_REAL_TRANSACTION_ENABLED=1`.
- Consumo atômico `ISSUED→CONSUMED` **antes** de `habilitarTransacaoReal` / ciclo.
- Sem emissão no boot; `emitirAutorizacaoExcepcional` só por chamada explícita futura.
- Sem retry após consumo; UNKNOWN/falha não restauram a autorização.
- Ledger em `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`.

**Não executado neste sprint:** emissão operacional, CRT, TX_START, PinPad, V$Pague restart.

## 5. Testes

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js` | **14 ok / 0 falhas** |
| `tests/tef/mrt-50-67-homologacao-debito-gate.test.js` | **13 ok / 0 falhas** |

Cobertura 51.02: gate OFF bloqueia; diagnóstico passivo OK; one-shot R$1 débito; crédito/PIX/valor ≠1 bloqueados; segunda uso e concorrência; sem retry pós-consumo; ledger após “restart”; código `DESTAXA_REAL_TRANSACTION_DISABLED` preservado; expiração.

## 6. Confirmações

- Nenhuma transação financeira / DLL CRT executada nesta sprint.
- Gate final: **OFF** (sem ativação global).
- Fluxo tecnicamente preparado para operação excepcional futura: **SIM**, após emissão manual explícita de uma autorização ISSUED e venda de R$1,00 débito.
- Pendências restantes:
  1. URL exata do HTTP 404 (classificar/corrigir se crítico).
  2. Emissão manual da autorização (sprint operacional futura — não automática).
  3. Cadastro Destaxa `00151` (se ainda presente no Identificar) — fora deste escopo.
  4. Execução da única CRT R$1,00 — etapa manual separada, com nova autorização.

## 7. Próximo passo recomendado

Sprint operacional separada: emitir **uma** autorização excepcional, confirmar total R$1,00 débito no PDV, executar a única CRT autorizada, e correlacionar logs — sem ligar o gate global.
