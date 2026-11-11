# TEF-DESTAXA-51.25 — Persistência das evidências financeiras antes da confirmação Destaxa

**Status:** CONCLUÍDA  
**Coleta:** 2026-11-10 America/Sao_Paulo  
**Base:** Auditoria 51.24 + contrato Destaxa 1.83  
**Operação financeira:** **NÃO EXECUTADA**  
**Homologação operacional:** **NÃO DECLARADA**

---

## 1. Resumo executivo

Corrigida a divergência 51.24: o CDS agora extrai e promove NSU, autorização e comprovantes do retorno `00` (`resultadoInicio`), persiste essas evidências com confirmação por re-leitura e **somente então** executa `FINALIZE(0)`.

Falha/parcialidade na persistência **bloqueia** a confirmação na DLL. Erro/timeout de FINALIZE preservam as evidências do `00` em estado inconclusivo. `A1` é reconhecido/classificado (Client init e START) **sem** finalização automática.

**Classificação final: CORRIGIDO E VALIDADO EM TESTES ISOLADOS.**

---

## 2. Arquivos alterados

| Arquivo | Alteração |
| --- | --- |
| `backend/services/tef/destaxa/destaxaProtocolo.js` | `extrairEvidenciasRetorno00`, `classificarRetornoA1` |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | Persistência obrigatória antes de FINALIZE; A1 sem finalize; ordem de eventos |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | Mapeamento via `resultadoInicio`; `_persistirEvidenciasRetorno00`; wiring do callback |
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` | A1 em `iniciaClientDestaxa` classificado sem auto-finalize |
| `tests/tef/tef-destaxa-51-25-persistencia-confirmacao.test.js` | **Novo** |
| `tests/tef/tef-destaxa-51-24-auditoria-fluxo.test.js` | Asserts atualizados pós-correção |

**Não alterado:** `TefManager.js` (preserva 51.20).

---

## 3. Hashes antes e depois

| Arquivo | Antes | Depois |
| --- | --- | --- |
| `TefManager.js` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` | **igual** (51.20) |
| `DestaxaRealAdapter.js` | `6AAB12121A2E4055935DFB4981B167086FC94EE4A62EFB9E3EA59A96F54063FA` | `8D3B60ECCBCBB18EACB6D84785BF15ABC786F8BC7C2117E043851FCE846892A9` |
| `destaxaCrtCicloOrquestracao.js` | `CE0BC01693EDCB417881B758BD0C76D735C1110A746148608436084E07B3FD62` | `EF42EEF025625F148CD48C209714A84E715EAAE2FBB3448B6DAB47A79540ABC6` |
| `destaxaProtocolo.js` | (pré-51.25) | `084F846AD8D9844C37CDB5BAFD17586E70A535E45274030F86370329EDBB2804` |
| `DestaxaNativeBridge.js` | (pré-51.25) | `989E8C08BB893CB2C7BF4626ACFA8A38E0B0AF867F98D2F90AEF7F1E2494FE78` |

---

## 4. Correção do mapeamento de `resultadoInicio`

- Ciclo passa a expor sempre `resultadoInicio` (resposta `00` com `saida`) separado de `resultadoUltimo` (FINALIZE).
- `_mapearSaidaCiclo` no sucesso usa `ciclo.resultadoInicio` (+ `ciclo.evidencias`), **não** a saída vazia típica do FINALIZE.
- `_mapearResultadoCrt` promove `nsu`, `autorizacao`, `comprovanteCliente`, `comprovanteLoja` e mantém `evidenciasDestaxa00` / `parametros` originais no payload.

---

## 5. Campos NSU, autorização e comprovantes

Extraídos por `extrairEvidenciasRetorno00` a partir da saída oficial:

| Campo Destaxa | Contrato CDS |
| --- | --- |
| `transacao_nsu` | `nsu` |
| `transacao_autorizacao` | `autorizacao` |
| `transacao_comprovante_1via` | `comprovanteCliente` |
| `transacao_comprovante_2via` | `comprovanteLoja` |

Nomes oficiais preservados em `evidenciasDestaxa00` e `parametros`. Sem inventar campos.

Persistência completa exige NSU não vazio; ausência/parcialidade bloqueia FINALIZE.

---

## 6. Ordem efetiva de persistência e confirmação

```text
RECEBER_00
  → EXTRAIR_EVIDENCIAS
  → PERSISTIR_EVIDENCIAS
  → CONFIRMAR_PERSISTENCIA   (ok + confirmada + duravel + re-leitura)
  → TX_FINALIZE(0)
  → TX_FINALIZE_RESULT
  → PERSISTIR_RESULTADO_FINAL
```

Produção (`DestaxaRealAdapter.autorizarPagamento` / `continuarPagamento`): `exigirEvidenciasAntesFinalize: true` + `_persistirEvidenciasRetorno00`.

Status da linha permanece `pendente` na gravação pré-FINALIZE (não marca aprovado antes da confirmação DLL).

---

## 7. Tratamento de erro na persistência

| Situação | Efeito |
| --- | --- |
| Callback ausente (com exigir=true) | FINALIZE bloqueado |
| NSU ausente / evidências parciais | FINALIZE bloqueado |
| Falha de gravação / re-leitura divergente | FINALIZE bloqueado |
| Identidade/idempotency diverge | FINALIZE bloqueado |

Em todos os casos: `sucesso=false`, `inconclusivo=true`, evidências disponíveis no retorno, **sem** `FINALIZE(9)` automático, trava/reconciliação obrigatória.

Idempotência: se NSU/auth/`evidenciasDestaxa00.confirmada` já conferem, retorna sucesso sem regravar indevidamente.

---

## 8. Tratamento de erro e timeout em FINALIZE(0)

| Cenário | Comportamento |
| --- | --- |
| FINALIZE OK | `sucesso=true`, evidências do `00` preservadas |
| FINALIZE erro (≠ sucesso) | inconclusivo; evidências `00` preservadas; sem retry |
| FINALIZE timeout (`08`/UNKNOWN) | inconclusivo; evidências preservadas; sem novo FINALIZE/desfazimento |
| Host morto em FINALIZE | inconclusivo + reconciliacaoObrigatoria |

---

## 9. Tratamento de A1

| Origem | Comportamento 51.25 |
| --- | --- |
| `iniciaClientDestaxa` | `bloqueadoA1` + `classificarRetornoA1`; `finalizacaoAutomaticaA1: false` |
| `iniciaTransacaoDestaxa` / ciclo | `fecharBloqueioA1`; sem FINALIZE |
| Confirmação/desfazimento automático | **NÃO implementado** (sprint futura + autorização) |

---

## 10. Testes executados e resultados

| Suite | Resultado |
| --- | --- |
| `tef-destaxa-51-25-persistencia-confirmacao.test.js` | **18/18 OK** |
| Inclui ordem RECEBER→…→FINALIZE e assert “FINALIZE nunca antes de CONFIRMAR_PERSISTENCIA” | OK |

---

## 11. Regressões verificadas

| Suite | Resultado |
| --- | --- |
| `tef-destaxa-51-24-auditoria-fluxo.test.js` | 14/14 OK (asserts alinhados à correção) |
| `tef-destaxa-51-19-host-security-continue.test.js` | 16/16 OK |
| `tef-destaxa-51-05-continuidade-99.test.js` | 13/13 OK |
| `tef-destaxa-51-23-reconciliacao-matriz.test.js` | 12/12 OK |

Nenhuma falha preexistente nova introduzida nas suítes direcionadas.

---

## 12. Confirmação: correção 51.20 preservada

Hash `TefManager.js` = `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C`  
Marcador `intentCicloAutomaticoContinue` intacto.

---

## 13. Confirmação: operação id=1 intacta

Leitura readonly `C:\ProgramData\MercantilFiscal\dados\mercadao.db`:

| Campo | Valor |
| --- | --- |
| id | 1 |
| status | `pendente` |
| valor | 1 |
| tipo | `cartao_debito` |
| nsu / autorizacao | **null** |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| criado_em / atualizado_em | `2026-11-09 16:58:43` / `2026-11-09 16:59:12` |

UNKNOWN documental preservado. Nenhuma recuperação/finalize/retry desta operação.

---

## 14. Confirmação: nenhuma operação financeira executada

Sem CRT/débito/crédito/PIX reais; sem NativeHost/DLL/V$Pague/COM4/PinPad; sem chamadas reais a inicia/continua/finaliza.

---

## 15. Confirmação: gate OFF

`DESTAXA_REAL_TRANSACTION_ENABLED` → `habilitado: false` (raw null).

---

## 16. Pendências para próxima sprint

1. Tratamento **operacional** de A1 (finalize 0/9 só com identificação da pendência + autorização explícita) — **não** auto.
2. Decisão Destaxa sobre finalize após negação `03/04/09`.
3. Reconciliação controlada da operação histórica id=1 (fora deste escopo).
4. Homologação operacional CRT real após autorização de escopo + gate.

---

## Classificação final

### CORRIGIDO E VALIDADO EM TESTES ISOLADOS

Não declarar homologação operacional.

**FIM DA SPRINT TEF-DESTAXA-51.25.**
