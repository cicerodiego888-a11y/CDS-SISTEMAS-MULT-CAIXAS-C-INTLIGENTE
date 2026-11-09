# TEF-DESTAXA-51.11 — Diagnóstico da persistência durável da coleta 99

**Status:** CONCLUÍDA (diagnóstico estático + testes mock; **sem** correção de código; **sem** operação financeira)  
**Data:** 2026-11-09  
**Prioridade:** P0  
**Classificação da causa:** **COMPROVADA**  
**Transação 51.10:** permanece **UNKNOWN** (sem retry, recuperação, FINALIZE ou reconciliação)

Base: evidência 51.10 (`resultado-crt.json`, `tef-51-10-runner.js`, `obs-tx-5110.txt`) · código 51.05 (`destaxaContinuidadePersistencia`, `DestaxaRealAdapter`, `destaxaCrtCicloOrquestracao`, `TefManager`)

---

## Resumo executivo

Na 51.10, `TX_START` retornou **99**, mas `TX_CONTINUE` não foi emitido (`continues: 0`) porque a reserva da solicitação 99 em `tef_transacoes` **falhou no primeiro `SELECT`**. O runner Electron inventou `transactionId = tx-5110-2dbbb6922eb64990` e forçou `persistenciaConfirmada: true` **sem** `INSERT` via `TefManager`. `registrarSolicitacao99` → `buscarTransacao` → `null` → `TEF_TRANSACAO_NAO_ENCONTRADA`. O adapter aplicou a mensagem fallback *Solicitação 99 não confirmada em armazenamento durável*. O caminho PDV vivo (TefManager + INSERT + id numérico) **não** é equivalente ao runner 51.10.

**Nenhuma correção foi implementada nesta sprint.**

---

## 1. Evidência 51.10 (âncora)

| Campo | Valor |
| --- | --- |
| transactionId | `tx-5110-2dbbb6922eb64990` |
| Código | `TEF_TRANSACAO_NAO_ENCONTRADA` |
| Mensagem | `Solicitação 99 não confirmada em armazenamento durável` |
| `continues` | `0` |
| `soContinuidade` | `true` |
| `pinpad_ack_vazio` | ausente na evidência filtrada `obs-tx-5110.txt` |
| Auth `ba08c88e…` | CONSUMED |
| Resultado financeiro | UNKNOWN |
| Execução | runner Electron in-process (`tef-51-10-runner.js`); PDV 6464 **não** vivo |

Passos do ciclo: `TX_START` → `TX_START_RESULT` (99) — **sem** passo `TX_CONTINUE`.

---

## 2. Cadeia rastreada (condição exata da falha)

### 2.1 Sequência no ciclo pós-99

1. `destaxaCrtCicloOrquestracao.prosseguirCicloAposResultado` recebe 99 / coleta PinPad.
2. Resolve resposta (caminho pinpad ack / fila).
3. Chama `_persistirAntesContinue` → `persistirRespostaAntesContinue` (injetado pelo adapter).
4. `DestaxaRealAdapter._persistirRespostaContinuidade` com `permitirCriarSolicitacao: true`.
5. `recuperarSolicitacao99(transactionId)` → sem linha → `TEF_TRANSACAO_NAO_ENCONTRADA`.
6. Tenta `registrarSolicitacao99(transactionId, …)`.
7. **Falha comprovada aqui** (ver §2.2).
8. Adapter devolve `ok: false` + mensagem fallback.
9. `_persistirAntesContinue` rejeita; `_resultadoPersistenciaContinuidadeFalhou` → `continues` permanece 0; **nenhum** `TX_CONTINUE`.

### 2.2 Condição exata — `registrarSolicitacao99`

**Arquivo:** `backend/services/tef/destaxa/destaxaContinuidadePersistencia.js`  
**Função:** `registrarSolicitacao99`  
**Pré-condição falha:** `buscarTransacao(transacaoId)` retorna `null`.

```301:318:backend/services/tef/destaxa/destaxaContinuidadePersistencia.js
async function registrarSolicitacao99(transacaoId, {
  acao,
  solicitadaEm = new Date().toISOString(),
  codigoDestaxa = '99'
} = {}) {
  // ...
  const tx = await buscarTransacao(transacaoId);
  if (!tx) {
    return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  }
```

`buscarTransacao` faz `SELECT … FROM tef_transacoes WHERE id = ?`. Para `tx-5110-2dbbb6922eb64990` **não existe linha**. Retorno **sem** `mensagem`, `duravel` nem `confirmada`.

### 2.3 Mapeamento da mensagem observada

**Arquivo:** `backend/services/tef/adapters/DestaxaRealAdapter.js`  
**Função:** `_persistirRespostaContinuidade`

```1059:1068:backend/services/tef/adapters/DestaxaRealAdapter.js
      const solicitacao = await persistencia.registrarSolicitacao99(transactionId, {
        acao: acaoNormalizada,
        solicitadaEm: timestamp
      });
      if (!solicitacao?.ok || solicitacao.duravel !== true || solicitacao.confirmada !== true) {
        return {
          ok: false,
          codigo: solicitacao?.codigo || ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
          mensagem: solicitacao?.mensagem || 'Solicitação 99 não confirmada em armazenamento durável'
        };
      }
```

Casamento 1:1 com `resultado-crt.json` (`codigo` + `mensagem`).

### 2.4 Gate do CONTINUE (secundário)

**Arquivo:** `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`  
**Função:** `_persistirAntesContinue`  
Exige `ok && duravel && confirmada && identidade completa && estadoDespacho === 'INICIADO' && despachoId && fingerprint…`. Com a falha do §2.2, esse gate **nunca** é alcançado com sucesso.

### 2.5 Nota sobre `pinpad_ack_vazio`

Ausente na evidência filtrada da 51.10. **Não** é a causa do bloqueio do CONTINUE: o código/mensagem prova falha **depois** da resolução, no ramo de persistência (`soContinuidade: true` + mensagem de solicitação 99). A ausência do ack em obs é observação lateral (filtro/corrida de log), não causa raiz.

---

## 3. Comparação obrigatória — Caminho A (PDV) vs Caminho B (runner 51.10)

| Critério | Caminho A — PDV workspace vivo + TefManager | Caminho B — runner 51.10 in-process | Equivalente? |
| --- | --- | --- | --- |
| Entrada | UI PDV → `TefManager.autorizar` | `DestaxaRealAdapter.autorizarPagamento` direto | **Não** |
| Persistência pré-TX | `repository.criarTransacaoExclusiva` → INSERT em `tef_transacoes` | **Nenhum** INSERT | **Não** |
| `transactionId` | `String(transacaoId)` = **id numérico** SQLite (`lastID`) | string forjada `tx-5110-<hex>` | **Não** |
| `persistenciaConfirmada: true` | Só após `INSERT_OK` real | Flag **sintética** no objeto `preparacao` | **Não** (semântica) |
| Serviço de reserva 99 | `destaxaContinuidadePersistencia.registrarSolicitacao99` | **mesmo módulo** | Sim (módulo) |
| Banco / conexão | `db` operacional (`tef_transacoes`) | **mesmo** `db` do processo Electron do runner | Sim (módulo); **não** há linha para o id forjado |
| Contrato de reserva | exige linha + identidade completa em `payload_retorno` | id inexistente → falha no SELECT | Contrato **não** cumprido no B |
| Confirmação durável | UPDATE payload + re-leitura (`duravel`/`confirmada`) | nunca chega a gravar | **Não** |
| Tratamento de falha | TefManager `_persistirSolicitacao99` também lança a mesma mensagem | Adapter + ciclo → UNKNOWN / continues:0 | Mesma mensagem; caminho de orquestração diferente |
| Timeout / PinPad / DLL | sob NativeHost intent + PDV vivo | in-process no runner; V$Pague 120s sem CONTINUE | Ambiente operacional distinto |

Conclusão da comparação: **não há equivalência** entre A e B. O runner 51.10 reutiliza adapter + persistência, mas **rompe o pré-requisito MRT-27** (linha durável com id real) ao fabricar identidade e flag de confirmação.

Trecho do runner (prova da inequivalência):

```75:141:docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js
  const transactionId = `tx-5110-${crypto.randomBytes(8).toString('hex')}`;
  // ...
    const preparacao = {
      ...preparo,
      pronto: true,
      persistenciaConfirmada: true,
      transactionId,
      operation_id: `op-5110-${crypto.randomBytes(4).toString('hex')}`,
      idempotency_key: idempotencyKey,
      fingerprint: crypto.createHash('sha256').update(transactionId).digest('hex')
    };
    resposta = await adapter.autorizarPagamento(dados, preparacao);
```

Trecho do PDV (contrato correto pré-TX):

```921:938:backend/services/tef/TefManager.js
                    const preparacaoComPersistencia = {
                      ...(preparacaoAdapter && preparacaoAdapter.pronto ? preparacaoAdapter : {}),
                      transactionId: String(transacaoId),
                      persistenciaConfirmada: true,
                      operation_id: blocoPersistencia.operation_id,
                      idempotency_key: blocoPersistencia.idempotency_key,
                      fingerprint: blocoPersistencia.fingerprint
                    };
                    const retornoBruto = await this._nativeHostIntent.run({
                      transactionId: String(transacaoId),
                      allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']
                    }, () => adapter.autorizarPagamento(
                      dadosNormalizados,
                      preparacaoComPersistencia
                    ));
```

---

## 4. Contrato correto de persistência (referência)

1. **Antes** de qualquer TX financeira Destaxa: `TefManager` (ou equivalente) deve criar linha em `tef_transacoes` com identidade completa (`operation_id`, `idempotency_key`, `fingerprint` no `payload_retorno.persistencia`).
2. `transactionId` operacional = **id** dessa linha (numérico/string do PK), nunca um token sintético de sprint.
3. `persistenciaConfirmada: true` só após INSERT confirmado (`INSERT_OK`).
4. Pós-99: `registrarSolicitacao99(id)` → UPDATE durável do bloco continuidade → `recuperarSolicitacao99` / resposta operador com `ok && duravel && confirmada`.
5. Só então `_persistirAntesContinue` libera `TX_CONTINUE`.

A flag `persistenciaConfirmada` **não** substitui a existência da linha. É um gate de entrada do adapter; a reserva 99 revalida no banco.

---

## 5. Testes realizados (somente mocks em memória)

**Arquivo:** `tests/tef/tef-destaxa-51-11-persistencia-99.test.js`  
**Comando:** `node tests/tef/tef-destaxa-51-11-persistencia-99.test.js`  
**Resultado:** **7 ok / 0 falhas**

| # | Teste | Resultado |
| --- | --- | --- |
| 1 | Evidência 51.10: código + mensagem + continues:0 + UNKNOWN | OK |
| 2 | Runner inventa `tx-5110-*`, força `persistenciaConfirmada`, sem TefManager/criarTransacao | OK |
| 3 | Ramificação `!tx` → `TEF_TRANSACAO_NAO_ENCONTRADA` sem mensagem | OK |
| 4 | Fallback de mensagem do adapter = texto 51.10 | OK |
| 5 | Flag sintética ≠ linha em `tef_transacoes` | OK |
| 6 | Gate CONTINUE exige reserva completa (não basta `ok:true`) | OK |
| 7 | Id PDV numérico vs id runner string | OK |

**Não utilizados:** cartão, PinPad, DLL, NativeHost operacional, V$Pague, CRT, TX_*, SQLite temporário, ledger excepcional.

---

## 6. Menor correção necessária (documentada — **não implementada**)

1. **Homologação operacional:** executar CRT **somente** pelo Caminho A (PDV vivo + `TefManager.autorizar`), para que o `transactionId` seja o PK real pós-INSERT.
2. **Se runner for mantido:** o runner deve chamar o mesmo pré-fluxo do TefManager (criar transação exclusiva → obter `transacaoId` → só então `persistenciaConfirmada: true` + `autorizarPagamento`). Remover geração de `tx-5110-*` e flags sintéticas.
3. **Opcional defensivo (fora desta sprint):** rejeitar cedo em `autorizarPagamento` / `_persistirRespostaContinuidade` ids que não existam em `tef_transacoes`, com código explícito *antes* do TX_START — não altera o contrato; apenas falha mais cedo.

Nenhuma dessas alterações foi feita em 51.11.

---

## 7. Riscos de regressão (para futura correção)

| Risco | Impacto |
| --- | --- |
| Aceitar id sintético “só em homologação” | Reproduz 51.10: 99 sem CONTINUE; UNKNOWN + auth CONSUMED |
| Criar linha parcial sem identidade completa | `IDENTIDADE_DIVERGENTE` no `registrarSolicitacao99` |
| Bypass do TefManager em testes “quase reais” | Falsa confiança em CONTINUE pós-51.05 |
| Reconciliar / retry da 51.10 | Violação financeira; estado UNKNOWN deve permanecer |
| Alterar `registrarSolicitacao99` para auto-criar linha | Quebra MRT-27 / trava de persistência obrigatória |

---

## 8. Critérios para futura homologação (pós-correção)

1. PDV workspace vivo (ou runner **equivalente** ao TefManager com INSERT real).
2. Pré-check: linha em `tef_transacoes` com o `transactionId` que será usado no TX **antes** do START.
3. Auth excepcional one-shot ISSUED → CONSUMED alinhada à tentativa.
4. Evidência: `TX_START_RESULT` 99 → evento de persistência 99 confirmada (`duravel`/`confirmada`) → **≥1** `TX_CONTINUE`.
5. Sem `TEF_TRANSACAO_NAO_ENCONTRADA` nem mensagem de solicitação 99 não confirmada.
6. Classificação financeira só após ciclo completo / política de UNKNOWN já definida — **sem** reabrir a tentativa `tx-5110-2dbbb6922eb64990`.
7. Preservar todos os UNKNOWN históricos, incluindo 51.10.

---

## 9. Classificação da causa

| Classificação | Aplicação |
| --- | --- |
| **COMPROVADA** | Sim — causa raiz |
| PROVÁVEL | — |
| NÃO IDENTIFICADA | — |

**Causa exata (COMPROVADA):** o runner 51.10 passou `transactionId` sintético `tx-5110-2dbbb6922eb64990` com `persistenciaConfirmada: true` **sem** inserir registro em `tef_transacoes`. Em `_persistirRespostaContinuidade` → `registrarSolicitacao99` → `buscarTransacao` retornou `null` → `{ ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' }` → mensagem fallback do adapter → CONTINUE bloqueado (`continues: 0`).

**Responsáveis:**  
- Origem da inequivalência: `docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js`  
- Detecção / falha: `destaxaContinuidadePersistencia.registrarSolicitacao99` / `buscarTransacao`  
- Mensagem observada: `DestaxaRealAdapter._persistirRespostaContinuidade`  
- Bloqueio do CONTINUE: `destaxaCrtCicloOrquestracao._persistirAntesContinue`

---

## 10. Escopo respeitado

| Restrição | Cumprida |
| --- | --- |
| Sem correção de código de produção | Sim |
| Sem TX_START / CONTINUE / FINALIZE / CRT | Sim |
| Sem cartão / PinPad / DLL / NativeHost / V$Pague | Sim |
| Sem SQLite temporário | Sim |
| Sem alteração do ledger excepcional | Sim |
| 51.10 e UNKNOWN históricos preservados | Sim |
| Sem emissão de autorização excepcional | Sim |

---

## Artefatos

| Artefato | Caminho |
| --- | --- |
| Este relatório | `docs/homologacao/tef/TEF-DESTAXA-51.11/RELATORIO.md` |
| Testes mock | `tests/tef/tef-destaxa-51-11-persistencia-99.test.js` |
| Evidência âncora | `docs/homologacao/tef/TEF-DESTAXA-51.10/resultado-crt.json` |
| Runner inequivalente | `docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js` |
