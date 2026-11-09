# MRT-50.67 — Correção das lacunas de segurança e continuidade CRT

**Status: CONCLUÍDA**

Gerado em 2026-11-07T20:30:06Z. Correção controlada + testes unitários com mocks. **Gate OFF. Sem NativeHost. Sem LOAD DLL. Sem `iniciaClientDestaxa` / TX / CONTINUE / FINALIZE reais. Sem cobrança. Sem banco oficial. Sem SEFAZ. Estados UNKNOWN MRT-24/36/42 intactos. Sem commit/staging.**

Diretório: `docs/homologacao/tef/MRT-50.67-20261107T203006Z`

A autorização única de R$ 1,00 em débito **permanece reservada e não utilizada**.

---

## 1. Arquivos alterados

| Arquivo | Motivo |
| --- | --- |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | Continuidade mock vs nativo; bloqueio modalidade homologação débito |
| `backend/services/tef/destaxa/destaxaHomologacaoDebitoPolitica.js` | **Novo** — política explícita débito R$1,00 / homologação |
| `backend/services/tef/destaxa/destaxaConstantes.js` | `DESTAXA_MODALIDADE_NAO_PERMITIDA`; `inspecionarGateFinanceiro` |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | Gate antes de TX_START/CONTINUE nativos |
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` | Comentário/clareza no gate de `habilitarTransacaoReal` |
| `backend/services/tef/destaxa/DestaxaNativeHostClient.js` | Comentário: gate efetivo `1`/`0` no spawn |
| `tests/tef/mrt-50-67-homologacao-debito-gate.test.js` | **Novo** — 13 testes direcionados |

Nenhuma alteração em `tef-destaxa-03` / `tef-destaxa-05` (a falha estava na implementação do adapter).

---

## 2. Causa raiz das três falhas (MRT-50.66)

| Cenário | Causa |
| --- | --- |
| A — DISPLAY 99 → CONTINUE → 00 | `DestaxaRealAdapter.continuarTransacao` passou a **bloquear todo** CONTINUE direto (`DESTAXA_CONTINUIDADE_AUTORIZACAO_NAO_COMPROVADA`), inclusive o caminho **mock** usado pelo teste 03. O orquestrador/mock continuavam corretos; o adapter não encaminhava. |
| B — COLETA → OPÇÃO → 00 | Mesma causa: CONTINUE nunca chegava ao mock; contexto até existia após `iniciarTransacao`. |
| C — CONTINUE sem contexto | O adapter devolvia `DESTAXA_CONTINUIDADE_AUTORIZACAO_NAO_COMPROVADA` em vez de `DESTAXA_TRANSACAO_NAO_ENCONTRADA` esperado pelo contrato de “sem operação ativa”. |

**Camada responsável:** implementação do adapter (não o teste nem o mock driver).  
**Decisão:** restaurar CONTINUE de protocolo **somente** quando o driver **não** é nativo; com driver nativo / NativeHost, manter bloqueio exigindo `continuarPagamento` (reserva durável). Isso não enfraquece a proteção de produção.

---

## 3. Correções aplicadas

### Continuidade CRT
- Sem contexto ativo (mock/in-process) → `DESTAXA_TRANSACAO_NAO_ENCONTRADA`, sem chamada financeira.
- Com mock e contexto → `bridge.continuarTransacaoDestaxa`, preservando `transactionId`.
- `transactionId` divergente do contexto → `DESTAXA_TRANSACAO_SEM_CONTEXTO`.
- Driver nativo / `native-host` → bloqueio `DESTAXA_CONTINUIDADE_AUTORIZACAO_NAO_COMPROVADA` (usar `continuarPagamento`).
- 99 **não** gera nova cobrança / novo TX_START.

### Homologação débito exclusiva
- Módulo `destaxaHomologacaoDebitoPolitica.js`.
- Em `prepararAutorizacao` (antes de LOAD/INIT/TX): somente `cartao_debito`/`debito`, valor 100, ambiente `homologacao`.
- Crédito, tipo ausente, `cartao` genérico, valor ≠ R$1,00, ambiente ≠ homologação → bloqueio.
- Sem conversão crédito→débito nem modalidade inventada.
- Escopo = caminho real Destaxa em homologação (já restrito a esse ambiente); não altera catálogo comercial do PDV fora desse adapter.

### Gate financeiro
| Camada | Proteção |
| --- | --- |
| `transacaoRealHabilitada` / `inspecionarGateFinanceiro` | Somente literal `1`; ambíguo (`true`, etc.) = OFF |
| `DestaxaRealAdapter.prepararAutorizacao` | Gate OFF → bloqueio TX (`DESTAXA_REAL_TRANSACTION_DISABLED`); INIT técnico ≠ autorização financeira |
| `DestaxaRealAdapter.autorizarPagamento` | `habilitarTransacaoReal()` antes do ciclo |
| `DestaxaNativeBridge.habilitarTransacaoReal` | Recusa se gate ≠ `1` |
| `DestaxaNativeHostClient` | Env do host forçado a `1` ou `0` |
| `destaxaTransacaoOrquestrador` | TX_START/CONTINUE/FINALIZE nativos checam gate |
| `destaxaCrtCicloOrquestracao` | Bloqueio pré-TX / pré-CONTINUE se driver nativo e gate OFF |
| TefManager | Continua usando adapter/gate; retry financeiro = 1 tentativa |

Gate **não** habilitado nesta sprint.

---

## 4. UNKNOWN e duplicidade (preservados)

- `classificarIdempotencia` → UNKNOWN/PENDENTE ⇒ `BLOQUEAR_REENVIAR` / `preservarUnknown`.
- `autorizarComRetry` = uma execução; `retryAllowed=false`.
- Ciclo: sem retry de TX_START; timeout ≠ cancelamento.
- Teste novo cobre idempotência UNKNOWN + retry único.
- Históricos MRT-24/36/42 **não** processados.

---

## 5. Resultados dos testes

| Suite | Resultado |
| --- | --- |
| `tef-destaxa-03-crt-protocolo.test.js` | **25/25** |
| `tef-destaxa-05-financial-safety.test.js` | **15/15** |
| `mrt-50-67-homologacao-debito-gate.test.js` | **13/13** |

Logs: `tef-03.log`, `tef-05.log`, `mrt-50-67.log`.

---

## 6. Confirmações

- Gate OFF (Process=`0`, User/Machine vazios).
- Zero NativeHost / DLL / chamadas financeiras reais.
- Zero alteração de banco, perfil, chave ou config persistida.
- UNKNOWN históricos preservados.
- Autorização R$ 1,00 débito **não ampliada** e **não executada**.

---

## 7. Lacunas remanescentes

1. `prepararAutorizacao` ainda **pode** LOAD/INIT_CLIENT com gate OFF (init técnico ≠ TX); documentado e intencional até sprint de cobrança.
2. Gate lê o ambiente do **processo** (User/Machine só via herança no spawn); NativeHost recebe `0`/`1` explícito.
3. Bloqueio de crédito aplica-se ao **adapter real em homologação**; um futuro ambiente `producao` com crédito exigirá política explícita nova (fora desta autorização).

---

## 8. Classificação final

**CONCLUÍDA**

**Parar.** Não iniciar MRT-50.68 automaticamente. Cobrança depende de nova análise e confirmação explícita imediatamente antes da operação.
