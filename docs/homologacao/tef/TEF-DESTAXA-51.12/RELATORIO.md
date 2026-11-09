# TEF-DESTAXA-51.12 — Validação do caminho operacional TefManager e eliminação do runner sintético

**Status:** CONCLUÍDA (diagnóstico + correção **somente** do mecanismo de homologação)  
**Data:** 2026-11-09  
**Prioridade:** P0  
**Operação financeira:** **não autorizada / não executada**  
**51.10:** permanece **UNKNOWN** (sem retry)

Base: 51.11 (causa COMPROVADA) · `TefManager.autorizar` · `tefRepository.criarTransacaoExclusiva` · runner 51.10

---

## Resumo executivo

O fluxo operacional correto é **PDV vivo → `TefManager.autorizar` → INSERT exclusivo → `lastID` → `preparacaoComPersistencia` → adapter**. O runner 51.10 era inequivalente e foi **desativado** para homologação operacional; a cópia histórica inequivalente foi arquivada. Nenhuma alteração no fluxo financeiro de produção. Testes mock: **9/0**. Próxima CRT: **somente** via PDV + TefManager, com autorização excepcional expressa futura.

---

## 1. Fluxo real do TefManager (ordem e garantias)

| # | Etapa | Arquivo / função | Garantia |
| --- | --- | --- | --- |
| 1 | `TefManager.autorizar` | `backend/services/tef/TefManager.js` | Entrada operacional PDV |
| 2 | Identidade MRT-27 (`blocoPersistencia`) | mesmo | `operation_id`, `idempotency_key`, `fingerprint` |
| 3 | `repository.criarTransacaoExclusiva` | `tefRepository.js` | INSERT atômico + exclusão de outro `pendente` |
| 4 | `lastID` | callback `criarTransacaoExclusiva` | PK real de `tef_transacoes` |
| 5 | Falha INSERT / `transacaoId == null` | TefManager | **bloqueia** Adapter/DLL (`transactionAttempted: false`) |
| 6 | Instrumentação `INSERT_OK` | `PERSISTENCIA_CONFIRMADA` | Evidência pré-adapter |
| 7 | `preparacaoComPersistencia` | TefManager | `transactionId: String(transacaoId)`, `persistenciaConfirmada: true` **só após INSERT** |
| 8 | `DestaxaRealAdapter.autorizarPagamento` | adapter | Gate `validarPersistenciaAntesEnvioFinanceiro` |
| 9 | Ciclo CRT → 99 | `destaxaCrtCicloOrquestracao` | Resolve continuidade |
| 10 | `registrarSolicitacao99` | `destaxaContinuidadePersistencia` | `SELECT` linha + UPDATE + releitura `duravel/confirmada` |
| 11 | `_persistirAntesContinue` | ciclo | Exige reserva completa antes de `TX_CONTINUE` |

### Evidência de INSERT e ID gerado (código)

`criarTransacaoExclusiva` — INSERT condicional e retorno de `lastID`:

```83:111:backend/services/tef/tefRepository.js
  db.run(`
    INSERT INTO tef_transacoes (
      ...
    )
    SELECT ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, datetime('now'), datetime('now')
    WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
  `, [ ... ], function (err) {
    if (err) return callback(err, null);
    callback(null, this && this.changes > 0 ? this.lastID : null);
  });
```

`preparacaoComPersistencia` **após** INSERT (nunca antes):

```921:938:backend/services/tef/TefManager.js
                    const preparacaoComPersistencia = {
                      ...(preparacaoAdapter && preparacaoAdapter.pronto ? preparacaoAdapter : {}),
                      transactionId: String(transacaoId),
                      persistenciaConfirmada: true,
                      operation_id: blocoPersistencia.operation_id,
                      idempotency_key: blocoPersistencia.idempotency_key,
                      fingerprint: blocoPersistencia.fingerprint
                    };
                    // ...
                    }, () => adapter.autorizarPagamento(
                      dadosNormalizados,
                      preparacaoComPersistencia
                    ));
```

**Nenhum** INSERT artificial foi executado nesta sprint (sem banco oficial tocado).

---

## 2. Diferenças PDV vs runner 51.10

| Critério | PDV + TefManager | Runner 51.10 (histórico) |
| --- | --- | --- |
| Entrada | UI / `TefManager.autorizar` | `DestaxaRealAdapter.autorizarPagamento` direto |
| INSERT `tef_transacoes` | Sim (`criarTransacaoExclusiva`) | Não |
| `transactionId` | `lastID` numérico | `tx-5110-<hex>` forjado |
| `persistenciaConfirmada` | Após `INSERT_OK` | Flag sintética |
| Reserva 99 | Pode confirmar na linha real | `buscarTransacao` → null → bloqueio CONTINUE |
| Equivalência | Referência operacional | **Inequivalente** (51.11) |

---

## 3. Tratamento do runner 51.10

**Decisão:** **desativado para homologação operacional** (não adaptado ao TefManager nesta sprint — adaptação implicaria risco de CRT acidental e exigiria autorização financeira).

| Artefato | Papel |
| --- | --- |
| `tef-51-10-runner.js` | Stub **DESATIVADO** — aborta com exit `3`; não carrega adapter/DLL; não consome auth |
| `tef-51-10-runner.HISTORICO-INEQ-51.10.js` | Cópia histórica inequivalente — **não executar**; evidência 51.10/51.11 |
| `runner-51-12-desativado.json` | Gerado se alguém tentar executar o stub |

**Não mantido** como runner mock de CRT. Testes mock ficam em `tests/tef/tef-destaxa-51-12-*.test.js` (memória).

**Não permitido:** transactionId sintético em operação real; `persistenciaConfirmada: true` sem INSERT confirmado via TefManager.

---

## 4. Testes e resultados

**Arquivo:** `tests/tef/tef-destaxa-51-12-caminho-tefmanager.test.js`  
**Comando:** `node tests/tef/tef-destaxa-51-12-caminho-tefmanager.test.js`  
**Resultado:** **9 ok / 0 falhas**

| # | Cenário exigido | Resultado |
| --- | --- | --- |
| 1 | Sem INSERT → envio/TX lógico bloqueado | OK |
| 2 | Com INSERT → transactionId = ID real (`lastID`) | OK |
| 3 | ID inexistente bloqueia persistência 99 | OK |
| 4 | Falha no UPDATE/releitura bloqueia CONTINUE | OK |
| 5 | Persistência confirmada libera estágio lógico do ciclo | OK |
| 6 | Flag forjada ≠ confirmação durável (sem linha) | OK |
| 7 | Runner operacional desativado; histórico preservado | OK |
| 8 | Ordem fonte TefManager: INSERT → preparacao → adapter | OK |
| 9 | Gate real `validarPersistenciaAntesEnvioFinanceiro` (sem TX) | OK |

**Não utilizados:** SQLite temporário, cartão, PinPad, DLL, NativeHost, V$Pague, CRT, TX_*, ledger.

---

## 5. Bloqueios encontrados

| Bloqueio | Severidade | Ação 51.12 |
| --- | --- | --- |
| Runner sintético podia passar gate de superfície com flag forjada (auth excepcional) e chegar ao TX_START | P0 homologação | Runner **desativado** |
| Gate de superfície **não** revalida existência da linha em `tef_transacoes` antes do START | Observado | **Não alterado** em produção (exige autorização específica) — CONTINUE já bloqueia corretamente na reserva 99 |
| Homologação via adapter direto ≠ PDV | P0 processo | Critério futuro: só PDV + TefManager |

Endurecimento futuro opcional (fora do escopo / sem autorização nesta sprint): `validarPersistenciaAntesEnvioFinanceiro` ou adapter consultar `buscarTransacao` antes de habilitar TX quando `exceptionalPermit` — falha cedo, sem mudar serialização `informacao=` nem Motor Fiscal.

---

## 6. Condições para homologação operacional futura

1. **PDV workspace vivo** (mesmo caminho da 51.08/51.09).
2. Fluxo **exclusivo** `TefManager.autorizar` — **proibido** runner sintético / adapter direto com id forjado.
3. Evidência pré-TX: linha `pendente` em `tef_transacoes` com o `transactionId` (= PK) usado no ciclo.
4. Autorização excepcional **nova**, one-shot, emitida sob ordem expressa **desta** tentativa futura (não reutilizar `ba08c88e…`).
5. Gate global permanece conforme política; sem alterar ledger histórico.
6. Critério de sucesso CONTINUE: pós-99, reserva `duravel/confirmada` + `continues ≥ 1`.
7. **Não** reabrir / retry / reconciliar `tx-5110-2dbbb6922eb64990` nem outros UNKNOWN.
8. Runner `tef-51-10-runner.js` permanece desativado; histórico só para auditoria.

**Esta sprint não autoriza pagamento nem emissão de nova autorização excepcional.**

---

## 7. Escopo respeitado

| Restrição | Cumprida |
| --- | --- |
| Sem CRT / TX_START / CONTINUE / FINALIZE | Sim |
| Sem DLL / NativeHost / V$Pague operacional | Sim |
| Sem emitir/consumir auth excepcional | Sim |
| Sem alterar ledger | Sim |
| Sem retry 51.10 / UNKNOWN preservados | Sim |
| Sem Motor Fiscal / F/NF / F12 / SEFAZ | Sim |
| Sem alterar serialização `informacao=` | Sim |
| Sem registros artificiais em banco oficial | Sim |
| Sem mudança no fluxo financeiro de produção | Sim |
| Correção só no mecanismo de homologação (runner) | Sim |

---

## Artefatos

| Artefato | Caminho |
| --- | --- |
| Este relatório | `docs/homologacao/tef/TEF-DESTAXA-51.12/RELATORIO.md` |
| Runner desativado | `docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js` |
| Histórico inequivalente | `docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.HISTORICO-INEQ-51.10.js` |
| Testes mock | `tests/tef/tef-destaxa-51-12-caminho-tefmanager.test.js` |
| Diagnóstico 51.11 | `docs/homologacao/tef/TEF-DESTAXA-51.11/RELATORIO.md` |
