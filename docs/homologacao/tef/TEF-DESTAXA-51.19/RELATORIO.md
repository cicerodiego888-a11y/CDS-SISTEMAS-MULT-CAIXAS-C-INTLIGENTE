# TEF-DESTAXA-51.19 — Investigação do bloqueio HOST_SECURITY_OPERATION_BLOCKED

**Status:** CONCLUÍDA (investigação + testes estáticos; **sem** correção de produção)  
**Coleta:** 2026-11-09 ~17:43 America/Sao_Paulo  
**Base evidencial:** TEF-DESTAXA-51.17 (id=1 / `requestId` `d3cd929385f4281e`)  
**Operação financeira:** **NÃO EXECUTADA**  
**Linha `tef_transacoes.id=1`:** **intacta**  
**Produção:** **não alterada**

Artefato de teste: `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` (10/10 OK)

---

## 1. Objetivo

Identificar, no código real, por que após `TX_START` → resultado **99** → persistência de continuidade → tentativa de `TX_CONTINUE` com `display_ack`, o NativeHost/cliente devolveu **`HOST_SECURITY_OPERATION_BLOCKED`**, sem atribuir o bloqueio à DLL ou ao V$Pague.

---

## 2. Arquivos e funções investigados

| Arquivo | Funções / trechos |
| --- | --- |
| `backend/services/tef/destaxa/DestaxaNativeHost.js` | `_autorizarOperacaoTransacional`, `_aplicarBootstrapSeguranca`, `_processarNativa`, `_registrarBloqueioSeInconclusivo` |
| `backend/services/tef/destaxa/DestaxaNativeHostClient.js` | `enviar`, `_sincronizarBootstrapSeguranca`, `_enviarBootstrapSeguranca` |
| `backend/services/tef/TefManager.js` | `_criarBootstrapSeguranca`, `_marcarContinuidadeCrt`, `_persistirSolicitacao99`, `autorizar` (`_nativeHostIntent.run`), `continuarAutorizacao` |
| `backend/services/tef/destaxa/DestaxaHostBridge.js` | `iniciarTransacaoDestaxa`, `continuarTransacaoDestaxa` |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | `resolverRespostaContinuidade`, `prosseguirCicloAposResultado`, `_persistirAntesContinue` |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | `autorizarPagamento`, `_persistirRespostaContinuidade` |
| `backend/services/tef/destaxa/destaxaNativeHostProtocolo.js` | `ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED` |
| Evidência 51.17 | `tef-logs-id1.json` / `RELATORIO.md` (sem recoleta operacional) |

---

## 3. Fluxo real de TX_START

```
TefManager.autorizar
  → criarTransacaoExclusiva (INSERT id=1)
  → _emExecucao.add("1")
  → _nativeHostIntent.run({ transactionId:"1", allowedOperations:['TX_START','TX_CONTINUE','TX_FINALIZE'] })
      → DestaxaRealAdapter.autorizarPagamento
          → DestaxaHostBridge.iniciarTransacaoDestaxa
              → NativeHostClient.enviar(TX_START)
                  → _sincronizarBootstrapSeguranca({ operation: TX_START, transactionId: "1" })
                      → TefManager._criarBootstrapSeguranca
                         ※ operation===TX_START → permit emitido (não exige _continuidadeCrt)
                  → NativeHost._autorizarOperacaoTransacional
                         ※ consome permit one-shot (permit.operation === TX_START)
                  → DLL / V$Pague (TX_START real)
              ← resultCode 99 (WAITING_ACTION / financialState PENDING — não UNKNOWN)
```

Evidência 51.17: `TX_START` `16:58:43.106Z`, `TX_START_RESULT` **99** `16:59:12.875Z`, `requestId` `d3cd929385f4281e`.

---

## 4. Fluxo real de TX_CONTINUE (display_ack in-cycle)

```
(ainda dentro de autorizarPagamento / mesmo intent)
  destaxaCrtCicloOrquestracao.prosseguirCicloAposResultado
    → resolverRespostaContinuidade(DISPLAY) → { displayAck:true, origem:'display_ack' }
    → _persistirAntesContinue → DestaxaRealAdapter._persistirRespostaContinuidade
         → persistencia.registrarSolicitacao99(...)   ※ NÃO chama TefManager._marcarContinuidadeCrt
    → bridge.continuarTransacaoDestaxa({ displayAck:true }, { transactionId:"1" })
        → NativeHostClient.enviar(TX_CONTINUE)
            → _sincronizarBootstrapSeguranca({ operation: TX_CONTINUE, transactionId: "1" })
                → TefManager._criarBootstrapSeguranca
                   ※ exige continuidadeAtiva (_continuidadeCrt) para TX_CONTINUE
                   ※ _continuidadeCrt == null  →  permit = null
            → Client: permitAuthorized === false
            → retorna localmente HOST_SECURITY_OPERATION_BLOCKED
               (antes de qualquer chamada à DLL / PinPad)
```

Evidência 51.17: `TX_CONTINUE` `16:59:12.934Z` → `TX_CONTINUE_RESULT` **`HOST_SECURITY_OPERATION_BLOCKED`** `16:59:12.950Z` (~16 ms — consistente com bloqueio de segurança pré-DLL).

---

## 5. Origem comprovada do `HOST_SECURITY_OPERATION_BLOCKED`

**Camada:** CDS — `DestaxaNativeHostClient` / `DestaxaNativeHost` (segurança de bootstrap/permit).  
**Não** é resposta financeira Destaxa.  
**Não** é falha de contrato `display_ack`.  
**Não** é V$Pague/DLL neste ponto (driver não é alcançado quando o permit falta).

### Regra do Host (`DestaxaNativeHost._autorizarOperacaoTransacional`)

Emite `HOST_SECURITY_OPERATION_BLOCKED` quando:

- `permit` ausente; ou
- `permit.operation !== req.operation`; ou
- `permit.transactionId !== transactionId`; ou
- `permitId` já consumido.

Mensagem: *“autorização de operação ausente, divergente ou já consumida”*.

### Regra do Client (`DestaxaNativeHostClient.enviar`)

Antes do IPC transacional, sincroniza bootstrap. Se `!sincronizacao.permitAuthorized`, devolve **localmente** o mesmo código `HOST_SECURITY_OPERATION_BLOCKED`.

`permitAuthorized` exige `claims.permit.operation === operation` e mesmo `transactionId`. Com `permit: null`, falha.

### Regra do emissor do permit (`TefManager._criarBootstrapSeguranca`)

```text
execucaoAutorizada =
  linha ativa + _emExecucao + intent.transactionId + intent.allowedOperations.includes(operation)
  && (
       operation === 'TX_START'
    || (continuidadeAtiva && operation ∈ {TX_CONTINUE, TX_FINALIZE})
     )

continuidadeAtiva = (_continuidadeCrt.transacaoId === transactionId)
```

`_continuidadeCrt` só é preenchido em `_marcarContinuidadeCrt`, chamado exclusivamente por `_persistirSolicitacao99` no **TefManager** — tipicamente após o adapter retornar com `requerContinuacao` (path PDV / `continuarAutorizacao`).

No ciclo **in-adapter** (99 → CONTINUE automático), o Adapter chama `persistencia.registrarSolicitacao99` **direto**, sem marcar `_continuidadeCrt`.

Consequência no cenário 51.03:

| Operação | Intent inclui? | `_continuidadeCrt` | Permit |
| --- | --- | --- | --- |
| TX_START | sim | null | **emitido** |
| TX_CONTINUE (display_ack) | sim | **null** | **null → BLOCKED** |

---

## 6. Causa raiz (comprovada) e hipóteses descartadas

### Causa raiz comprovada

**Assimetria de autorização de bootstrap:** `TX_START` obtém permit só com intent + `_emExecucao`; `TX_CONTINUE` exige **adicionalmente** `_continuidadeCrt`, que **não existe** durante a continuidade automática do mesmo `autorizarPagamento`. O Client/Host então bloqueiam com `HOST_SECURITY_OPERATION_BLOCKED` por **permit ausente**.

Isso explica integralmente a sequência 51.03/id=1.

### Hipóteses descartadas / não necessárias

| Hipótese | Status |
| --- | --- |
| Contrato `display_ack` inválido | **Descartada** — `resolverRespostaContinuidade(DISPLAY)` aceita `{ displayAck:true }` |
| Bloqueio pela DLL/V$Pague | **Descartada neste ponto** — bloqueio pré-nativo; latência ~16 ms |
| Código 99 como aprovação | **N/A** — 99 é ACTION_REQUIRED / PENDING |
| Identidade bloqueada UNKNOWN pós-START | **Não explica este código** — 99 → financialState PENDING; bloqueio UNKNOWN geraria `HOST_RECONCILIATION_PENDING` |
| Permit de TX_START reutilizado | **Contribui ao modelo** (permit é one-shot), mas a falha imediata é a **não emissão** de um novo permit de CONTINUE |

### Hipótese residual (baixa prioridade)

Se no futuro o permit de CONTINUE for emitido corretamente, ainda seria necessário validar o restante do ciclo (gate excepcional one-shot no orquestrador, estado WAITING_ACTION, etc.). **Fora do escopo da causa do BLOCKED observado.**

---

## 7. Testes executados e resultados

Arquivo: `tests/tef/tef-destaxa-51-19-host-security-continue.test.js`  
Comando: `node tests/tef/tef-destaxa-51-19-host-security-continue.test.js`  
Resultado: **10 ok, 0 falhou**

Cobertura:

1. Fonte TefManager contém o gate `continuidadeAtiva && TX_CONTINUE`.  
2. `_marcarContinuidadeCrt` só via `_persistirSolicitacao99`; Adapter não marca.  
3. Cenário in-cycle 51.03: START com permit; CONTINUE sem permit.  
4. Com `_continuidadeCrt`, CONTINUE recebe permit.  
5. Path `continuarAutorizacao` (intent sem TX_START) ainda exige continuidade.  
6. Correção mínima proposta (somente no teste) libera in-cycle sem afrouxar path PDV.  
7–8. Host: permit ausente / permit de START ≠ CONTINUE → `HOST_SECURITY_OPERATION_BLOCKED` (driver não chamado).  
9. `display_ack` válido.  
10. Mensagem da regra no Host.

Sem DLL real, sem NativeHost de produção, sem COM4, sem escrita em `mercadao.db`.

---

## 8. Arquivos modificados

| Arquivo | Alteração |
| --- | --- |
| `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` | **Criado** (testes) |
| `docs/homologacao/tef/TEF-DESTAXA-51.19/RELATORIO.md` | **Criado** |
| Código de produção | **Nenhuma alteração** |

---

## 9. Correção mínima proposta (NÃO IMPLEMENTADA)

**Arquivo:** `backend/services/tef/TefManager.js`  
**Função:** `_criarBootstrapSeguranca`  
**Trecho:** condição de `execucaoAutorizada` que exige `continuidadeAtiva` para `TX_CONTINUE`/`TX_FINALIZE`.

**Proposta (delimitada):**

Permitir `TX_CONTINUE`/`TX_FINALIZE` quando:

- `continuidadeAtiva` **ou**
- o intent do ciclo completo já inclui `TX_START` **e** a operação solicitada (caso in-cycle de `autorizar`).

Manter bloqueio do path PDV (`continuarAutorizacao`, intent só com CONTINUE/FINALIZE) **sem** `_continuidadeCrt`.

**Evidência:** testes 3, 5 e 6 do artefato 51.19.

**Risco de regressão:**

- Baixo se a correção exigir `intent` com `TX_START` para o atalho in-cycle.  
- Não deve liberar CONTINUE sem intent nem sem `_emExecucao`.  
- Não altera regras de reconciliação UNKNOWN, gate financeiro, nem outras modalidades.  
- Exige reteste dos suites MRT-49/50 (bootstrap) e 51.05 (continuidade mock) **após** autorização de implementação.

**Teste que comprovará a correção:** cenário 3 do 51.19 deve passar a emitir permit para CONTINUE in-cycle; cenário 5 (PDV sem marca) deve continuar negando.

**Implementação aguarda decisão expressa do usuário.**

---

## 10. Riscos e pendências

- id=1 permanece `pendente` (bloqueia novo INSERT exclusivo).  
- UNKNOWN financeiro 51.17 / consulta Destaxa 51.18 **inalterados**.  
- Auth 51.03 CONSUMED / 51.10 CONSUMED / UNKNOWN `tx-5110-…` preservados.  
- Mesmo após corrigir o permit, uma nova CRT exigirá nova autorização excepcional e tratamento da linha pendente — **fora desta sprint**.

---

## 11. Confirmações obrigatórias

- Nenhuma operação financeira executada (sem CRT / TX_* real / DLL / NativeHost real / COM4 / V$Pague).  
- `tef_transacoes.id=1` **não** alterada (sem UPDATE/DELETE).  
- Sem emissão/consumo/restauração de autorização excepcional.  
- Sem `DESTAXA_REAL_TRANSACTION_ENABLED=1`.  
- Sem alteração fiscal / PDV Universal / regras UNKNOWN.

---

## 12. Hashes (artefatos relevantes)

| Artefato | SHA256 |
| --- | --- |
| `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` | `CF1AACE0AD2EBCB2936935972D9DBB49DFD6AF542CE756C79CD91C808C8C07FB` |
| `backend/services/tef/TefManager.js` | `96E9A34BD52D0DF564092285422BA2A70973100E03D6206EBA7CEE95ECC889A4` |
| `backend/services/tef/destaxa/DestaxaNativeHost.js` | `FC876B496A69C0598D4131A6902A79DB7E265D26010512CFB24C22A1B9206BCC` |
| `backend/services/tef/destaxa/DestaxaNativeHostClient.js` | `F7D4A845CA32CCAD3B138095BF29EC34837E96D52D6DDCA0D6E770AA486C77CF` |

---

## 13. Conclusão

A continuidade foi bloqueada **na camada de segurança CDS (bootstrap/permit do NativeHost Client/Host)**, porque `TefManager._criarBootstrapSeguranca` **não emite permit de `TX_CONTINUE` no ciclo automático** — exige `_continuidadeCrt`, que só é marcado no path pós-`_persistirSolicitacao99` do TefManager, não no persist in-adapter do 99.

Menor correção técnica: ajustar essa condição de emissão de permit (proposta acima), **sem** tocar em produção nesta sprint.

**Aguardando decisão expressa do usuário** para implementar a correção mínima e/ou seguir com reconciliação Destaxa.
