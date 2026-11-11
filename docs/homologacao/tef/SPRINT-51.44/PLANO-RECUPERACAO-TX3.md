# SPRINT 51.44 — Plano de recuperação protocolar da TX 3

**Data:** 2026-11-10  
**Natureza:** inspeção + proposta executável — **nenhuma chamada Destaxa nesta sprint**  
**Escopo:** TEF id=3 / venda 66 (Destaxa 00, NSU 2338, auth 211139)  
**Proibições cumpridas:** sem `iniciaClientDestaxa` / `TX_*` / CRT / FINALIZE / DLL / NativeHost / V$Pague / permit / gate / escrita em TX 2–3 ou venda 66

---

## 1. Identidade da operação original (Destaxa × CDS)

| Camada | Identificador | Valor |
| --- | --- | --- |
| CDS | `tef_transacoes.id` / `transactionId` | **3** |
| CDS | `idempotency_key` / `operation_id` | `tef-segunda-tentativa-bd6a8809bc64abb7` |
| CDS | `venda_id` | **66** |
| Destaxa retorno 00 | NSU | **2338** |
| Destaxa | NSU rede | **241255** |
| Destaxa | Autorização | **211139** |
| Destaxa / V$Pague | `transacao_codigo_vespague` / `vspague` | **10100017275707** |
| Destaxa | Terminal / loja | `TACB0120` / `LojaACB` |
| Destaxa | Estabelecimento | Destaxa / `017667967881238` |
| Runtime original | NativeHost | PID **9260** (PPID **5700**) — **já encerrado** |
| Runtime atual | NativeHost | PID **14688** (PPID **12832**) — **outra sessão** |
| Permit original | excepcional | `cff48150…` **CONSUMED** (não reutilizável) |

**Contrato DLL de finalização** (`destaxaConstantes.js` / docs/08):

```text
finalizaTransacaoDestaxa(confirmacao)
  0 = Client pode confirmar as transações   ← FINALIZACAO_CONFIRMAR
  9 = cancelamento será executado           ← FINALIZACAO_CANCELAR
```

A API **não recebe NSU** como parâmetro. A Destaxa mantém a pendência de confirmação **na sessão do Client**; o CDS correlaciona pela evidência (NSU / vespague / timestamps) e pelo `transactionId` de segurança.

---

## 2. Etapa 1 — Achados da inspeção

### 2.1 Como o ciclo deveria ter fechado

Sequência oficial no CDS (`destaxaCrtCicloOrquestracao.js`):

```text
TX_START → (99 → TX_CONTINUE)* → evidências 00 persistidas → TX_FINALIZE(0)
```

Na TX 3: evidências 00 **já persistidas**; `TX_FINALIZE` **falhou** com `HOST_SECURITY_OPERATION_BLOCKED` (permit FINALIZE ausente — causa 51.41).

### 2.2 Como a correção 51.41 se aplica (e onde **não** chega)

`intentCicloAutomaticoFinalize` emite permit one-shot de `TX_FINALIZE` **somente** quando, no mesmo ciclo automático:

- intent contém `TX_START` + `TX_CONTINUE` + `TX_FINALIZE`;
- `transactionId` ∈ `_emExecucao`;
- linha ativa compatível (não `reconciliacaoPersistenciaIncompleta`);
- bootstrap de segurança válido.

**Não cobre** a recuperação tardia da TX 3 hoje, porque:

1. Host/orquestrador da CRT original **não existem mais** (PID 9260 morto; `_contexto` em memória perdido).  
2. TX 3 no CDS já está **`aprovado`** (51.42) — fora do path `_emExecucao` / pendência operacional.  
3. Path PDV (`allowedOperations` só CONTINUE/FINALIZE) ainda exige `_continuidadeCrt` — também ausente.

Conclusão: 51.41 **previne** o bug em ciclos futuros; **não** é, sozinha, o procedimento de recuperação da pendência Destaxa da TX 3.

### 2.3 Contexto recuperável hoje?

| Componente | Estado | Recuperável? |
| --- | --- | --- |
| Evidências CDS (NSU/auth/comprovantes) | Persistidas; TX `aprovado` | **Sim** (já no banco) |
| Identidade CDS (id=3, idempotency) | Persistida | **Sim** |
| `_contexto` CRT no orquestrador | Perdido no restart do Host | **Não** |
| `_continuidadeCrt` / intent mid-cycle | Ausente | **Não** |
| Permit one-shot original | CONSUMED | **Não** (reuso proibido) |
| Pendência Destaxa no V$Pague | Sinal **A1** em `iniciaClientDestaxa` (51.43) | **Provável sim** (sessão Client ainda bloqueada) |
| Correlação V$Pague `10100017275707` | Nos comprovantes/logs | **Sim** (evidência; não é arg da DLL) |

### 2.4 Procedimentos já implementados

| Procedimento | Serve para TX 3 Destaxa A1? |
| --- | --- |
| `reconciliarResultadoTardio` / NativeHost release | Status CDS / trava — **já coberto** pela recuperação administrativa 51.42; **não** chama `finalizaTransacaoDestaxa` |
| `classificarRetornoA1` | Classifica A1; `finalizacaoAutomatica: false`; exige autorização explícita — **não executa** FINALIZE |
| Orquestrador `finalizarTransacao(0\|9)` | Exige `_contexto` ativo + gate/permit — **bloqueia** sem contexto CRT |
| FINALIZE(9) automático em falha | **Proibido** pela política 51.25 |

**Não existe** módulo pronto de “FINALIZE tardio pós-A1 / pós-restart / linha já aprovada”. A recuperação Destaxa exige **procedimento dedicado** (proposta abaixo), sob GO do PO.

---

## 3. Etapa 2 — Proposta técnica única

### Nome

**RECUPERACAO_PROTOCOLAR_TX3_FINALIZE_0** — confirmação Destaxa da pendência da operação já aprovada (NSU 2338), **sem nova cobrança**.

### 3.1 Operação protocolar necessária

| Item | Valor |
| --- | --- |
| Operação | **`finalizaTransacaoDestaxa(0)`** via Host `TX_FINALIZE` |
| Semântica | **Confirmar** a(s) transação(ões) pendente(s) de confirmação no Client |
| Explicitamente **proibido** nesta recuperação | `FINALIZE(9)`, `TX_START`, `TX_CONTINUE`, CRT, nova venda |

Justificativa: Destaxa 1.83 / auditoria 51.24–51.26 — em **A1**, confirmar (`0`) ou cancelar (`9`) antes de novas operações. CDS já reconhece a venda como aprovada (51.42); o lado Destaxa ainda exige a confirmação AC que faltou no FINALIZE original → **`0`**, nunca `9`.

### 3.2 Identificador original e contexto exigido

**Binding de segurança CDS (obrigatório):**

- `transactionId = "3"`
- `idempotency_key = tef-segunda-tentativa-bd6a8809bc64abb7`
- Pré-checagem readonly: status `aprovado`, NSU `2338`, auth `211139`, `venda_id=66`

**Correlação Destaxa (evidência, não parâmetro DLL):**

- NSU 2338 / NSU rede 241255 / auth 211139  
- `transacao_codigo_vespague = 10100017275707`  
- Terminal `TACB0120`

**Contexto runtime a reconstruir (dedicado):**

1. NativeHost ativo (sessão atual).  
2. `LOAD` da DLL.  
3. Bootstrap de segurança **específico de recuperação** (ver 3.4) — **não** reabrir ciclo CRT.  
4. Tratamento de `iniciaClientDestaxa`:
   - **`A1` esperado** como sinal de pendência → seguir para FINALIZE(0) **somente** neste procedimento autorizado;
   - **`00`** inesperado nesta etapa → **abortar** (pendência pode já ter sido limpa; não inventar FINALIZE);
   - **`F0`** → **abortar** (sequência inválida; não retentar em loop).
5. Driver nativo com capacidade de chamar `finalizaTransacaoDestaxa` **mesmo sem `_contexto` CRT** (lacuna atual do orquestrador — exige extensão mínima **só** no path de recuperação, gated por autorização PO + permit).

### 3.3 Chamada e parâmetros previstos

```text
Host:  TX_FINALIZE
payload: { confirmacao: 0 }
transactionId: "3"
permit: one-shot { operation: "TX_FINALIZE", transactionId: "3", purpose: "RECUPERACAO_PROTOCOLAR_TX3" }
```

DLL efetiva:

```text
finalizaTransacaoDestaxa(0)
```

Ordem operacional proposta (execução **futura**, sob GO):

1. Pré-validação readonly CDS (id=3, NSU, auth, venda 66).  
2. Emitir permit one-shot de recuperação (seção 3.4).  
3. `SECURITY_BOOTSTRAP` + `LOAD`.  
4. `INIT_CLIENT` — ramificar por A1/00/F0 conforme acima.  
5. `TX_FINALIZE` / `finalizaTransacaoDestaxa(0)`.  
6. Pós-checagem: novo `INIT_CLIENT` deve retornar **00** (A1 limpo).  
7. Auditoria em `tef_logs` (tipo dedicado) **sem** alterar NSU/status/comprovantes/venda.

### 3.4 Permit de segurança exigido

| Regra | Detalhe |
| --- | --- |
| Tipo | **One-shot excepcional de recuperação** (não reutilizar `cff48150…`) |
| Escopo | `operation=TX_FINALIZE` **e** `transactionId=3` **e** `confirmacao=0` |
| Proibido no mesmo permit | `TX_START`, `TX_CONTINUE`, CRT, `FINALIZE(9)` |
| Gate global | permanece **OFF** (`DESTAXA_REAL_TRANSACTION_ENABLED != 1`) |
| 51.41 | **não** aplicar atalho genérico de ciclo automático; path **nomeado** e auditado |
| Consumo | único; falha/timeout **não** reemite automaticamente |

### 3.5 Resposta esperada

| Etapa | Esperado |
| --- | --- |
| `finalizaTransacaoDestaxa(0)` | código Destaxa **`00`** (sucesso da confirmação) |
| `INIT_CLIENT` subsequente | **`00` / `CLIENT_INITIALIZED`** (fim do A1) |
| CDS TX 3 | permanece `aprovado`; NSU/auth/comprovantes **inalterados** |
| Venda 66 | inalterada |
| Nova `tef_transacoes` | **não** criada |

### 3.6 Tratamento de falha ou timeout

| Falha | Ação |
| --- | --- |
| FINALIZE ≠ 00 / timeout | **Parar**. Sem retry automático. Sem `FINALIZE(9)`. Sem CRT. Registrar log; manter bloqueio Destaxa explícito. |
| INIT pós-FINALIZE ainda A1 | Considerar **não concluído**; escalar (possível pendência distinta ou Client stale) — sem nova cobrança. |
| F0 em qualquer etapa | Abortar; não loop de INIT. |
| Permit rejeitado / bootstrap | Abortar; não contornar Host security. |
| Divergência pré-check (NSU/status) | Abortar integralmente. |

### 3.7 Evidência para ciclo Destaxa considerado concluído

Todas obrigatórias:

1. Log NativeHost: `finalizaTransacaoDestaxa` / `TX_FINALIZE` com **código 00** e `transactionId=3`.  
2. Log NativeHost: `INIT_CLIENT` posterior com **00** (A1 ausente).  
3. Releitura CDS: TX 3 ainda `aprovado`, NSU **2338**, auth **211139**, comprovantes com mesmos tamanhos/hashes.  
4. `tef_logs` de auditoria da recuperação (operador, horário, GO PO, purpose).  
5. Confirmação negativa: **nenhuma** linha TEF nova; **nenhum** `TX_START`/`iniciaTransacaoDestaxa` na janela.

---

## 4. Lacunas de implementação (pré-requisitos da sprint de execução)

Para a proposta ser executável com segurança, a sprint autorizada seguinte precisará entregar **antes** da chamada real:

1. Path dedicado `RECUPERACAO_PROTOCOLAR_TX3` (não genérico) que:
   - emita permit one-shot FINALIZE(0)+id=3;
   - permita `finalizaTransacaoDestaxa(0)` sem `_contexto` CRT **somente** sob esse purpose;
   - trate A1 em INIT como pré-condição esperada (não como auto-finalize genérico).  
2. Runner one-shot com dry-run + GO explícito do PO.  
3. Testes de regressão: path PDV CONTINUE/FINALIZE sem continuidade continua bloqueado; ciclo automático 51.41 intacto; FINALIZE(9) inacessível neste purpose.

**Esta sprint 51.44 não implementa nem executa esses itens.**

---

## 5. O que esta proposta deliberadamente não faz

- Não inicia nova CRT / cobrança.  
- Não desfaz (`FINALIZE(9)`) a aprovação Destaxa já evidenciada.  
- Não altera TX 2, TX 3, venda 66, recebimentos ou fiscal.  
- Não liga gate global.  
- Não reutiliza permit CONSUMED.  
- Não reinicia V$Pague “para limpar” A1.

---

## 6. Decisão solicitada ao Product Owner

Autorizar (em sprint futura nomeada) a execução de **`finalizaTransacaoDestaxa(0)`** vinculada à TX **3**, com permit one-shot de recuperação, conforme este plano — **após** a implementação mínima do path dedicado.

Sem essa autorização específica: **nenhuma** chamada real à Destaxa.

---

## 7. Referências

- `docs/homologacao/tef/SPRINT-51.41/RELATORIO.md` — causa do FINALIZE bloqueado  
- `docs/homologacao/tef/SPRINT-51.42/RELATORIO-RECUPERACAO.md` — CDS `aprovado`  
- `docs/homologacao/tef/SPRINT-51.43/RELATORIO-F0-DESTAXA.md` — A1→F0  
- `docs/homologacao/tef/SEGUNDA-TENTATIVA/venda-http-resultado.json` — evidências 00 / vespague  
- `backend/services/tef/destaxa/destaxaConstantes.js` — FINALIZE 0/9  
- `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` — exige `_contexto`  
- `backend/services/tef/TefManager.js` — `intentCicloAutomaticoFinalize` (51.41)

**Fim da SPRINT 51.44 — proposta apenas; aguardando GO do PO para qualquer chamada Destaxa.**
