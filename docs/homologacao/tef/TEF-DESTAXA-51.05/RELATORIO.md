# TEF-DESTAXA-51.05 — Correção TX_START→99→TX_CONTINUE e bloqueio Electron

**Status:** CONCLUÍDA (código + testes mock; **sem** homologação operacional)  
**Data:** 2026-11-09  
**Base:** diagnóstico 51.04

## 1. Causa raiz (confirmada)

Após `TX_START→99` (COLETA `transacao_cartao_numero`), o ciclo CRT **não emitia TX_CONTINUE** porque:

1. **COLETA tipada exigia fila PDV** e o PinPad coleta o cartão no terminal — o protocolo Destaxa espera **ack com `informacao` vazia** (MRT-50.74), não PAN digitado no PDV.
2. Quando o hand-off ia ao PDV (`POST /tef/continuar`), **`_emExecucao` não era liberado no 99** → `TEF_CONTINUIDADE_EM_EXECUCAO` bloqueava CONTINUE.
3. **`iniciarPagamento` omitia `solicitadaEm`** → risco de `DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE`.
4. **Electron main** hospeda o backend Express; espera longa de TX_START (~30s) + persistência sem `setImmediate` contribuiu para `NOT_RESPONDING` enquanto V$Pague expirava 120s.

V$Pague cancelou por timeout da aplicação comercial (9/78). Financeiro da tentativa 51.03: **NÃO COMPROVADO** (preservado).

## 2. Correções implementadas

| Área | Mudança |
| --- | --- |
| `destaxaContinuidadeEstados.js` | **Novo** — estados AGUARDANDO_*/CONTINUANDO/TIMEOUT/UNKNOWN; `ehColetaDelegadaAoPinPad`; timeout PDV padrão 90s; auditoria `continuidade.*` |
| `destaxaCrtCicloOrquestracao.js` | COLETA PinPad → auto `TX_CONTINUE` com `{informacao:''}`; `setImmediate` antes TX_START/TX_CONTINUE; eventos de observabilidade |
| `TefManager.js` | `_liberarSlotExecucaoParaContinuidade` no 99; `setImmediate` antes persistir solicitação 99 |
| `tef/index.js` | Encaminha `solicitadaEm`, `idempotency_key`, flags de reconciliação |
| `destaxaContinuidadeContrato.js` | `validarRespostaOperador` aceita ack vazio para PinPad |
| `OrquestradorPagamento.js` | `requerContinuacao` não trata como negado/cancelamento |
| `pdvTefContinuidade.js` | Auto-ack DISPLAY/PinPad; timeout PDV 90s se Destaxa não declarar |

**Não inventa PAN/senha.** UNKNOWN permanece sem retry automático. Gate global **não** alterado.

## 3. Arquivos alterados / criados

- `backend/services/tef/destaxa/destaxaContinuidadeEstados.js` *(novo)*
- `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`
- `backend/services/tef/destaxa/destaxaContinuidadeContrato.js`
- `backend/services/tef/TefManager.js`
- `backend/services/tef/index.js`
- `backend/services/OrquestradorPagamento.js`
- `frontend/pdv/js/pdvTefContinuidade.js`
- `tests/tef/tef-destaxa-51-05-continuidade-99.test.js` *(novo)*
- `docs/homologacao/tef/TEF-DESTAXA-51.05/RELATORIO.md` *(este)*

## 4. Testes

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-05-continuidade-99.test.js` | **13 ok / 0 falhas** |
| `tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js` | **14 ok / 0 falhas** |

Cobertura 51.05: 99 PinPad→CONTINUE; coleta tipada sem CONTINUE; timeout; duplicata; UNKNOWN; `solicitadaEm` no hand-off; `setImmediate`; proteção segunda tentativa.

Sem DLL / NativeHost / V$Pague / CRT operacional.

## 5. TABELA EXPIRADA (investigação, sem atualizar)

Evidência 51.04 (`vspague-client.log` ~13:58:47–13:59:11):

| Item | Achado |
| --- | --- |
| Origem | PinPad via V$Pague (`TLI` status **020**, display `TABELA EXPIRADA`) |
| Sequência | GTS → TLI 020 → TLE → TLR (reload) → novos TLI 020 → DSP Destaxa 1.0.3 |
| Efeito | Atraso ~30s **dentro** do TX_START até o primeiro 99 de coleta |
| Atualização nesta sprint | **Não** (restrição) |
| Orientação | Homologação futura: validar carga de tabelas EMV com Destaxa/ACB **antes** da CRT; sem reinício automático do V$Pague aqui |

## 6. Critérios de aceitação

| Critério | Status |
| --- | --- |
| Causa ausência TX_CONTINUE identificada | Sim |
| Fluxo continuidade corrigido | Sim (PinPad ack + liberação `_emExecucao` + `solicitadaEm`) |
| Electron Main — mitigação espera TEF | Sim (`setImmediate` + CONTINUE imediato PinPad) |
| Testes direcionados | 13/13 |
| Observabilidade continuidade | Sim (`continuidade.*`) |
| Timeout / UNKNOWN protegidos | Sim (`retryAllowed: false`) |
| Sem operação financeira nesta sprint | Sim |

## 7. Pendências para retomada

1. Decisão sobre processo PDV ainda `NOT_RESPONDING` da tentativa 51.03 (não reiniciado nestas sprints).
2. Reconciliação da tentativa CONSUMED / financeira NÃO COMPROVADA.
3. Nova autorização excepcional **somente** com autorização expressa do responsável.
4. Homologação operacional controlada **após** confirmação de tabelas EMV (fora deste escopo).
5. Monitorar se COLETAs tipadas (CPF etc.) ainda passam pelo modal PDV dentro de 90s.

## Restrições respeitadas

Sem TX operacional, sem emissão/consumo de auth excepcional, sem gate ON, sem F12/fiscal/SEFAZ, sem reinício V$Pague/PDV, sem atualização de tabelas EMV, UNKNOWN preservado.
