# MRT-50.10 — Reserva atômica de despacho TEF

**Classificação:** APROVADA  
**Período:** 2026-11-06T02:13:23.084Z a 2026-11-06T02:14:48.903Z  
**Gate financeiro:** OFF no processo principal e nos workers  
**Banco de teste:** `C:\Users\cicer\AppData\Local\Temp\cds-mrt-50-10-52780-3a7ae220acba\mercadao.db`  
**Identidade SQLite:** `dev=505650597`, `ino=4222124652305961`  
**journal_mode:** `wal`

## Resultado

- Disputas com dois processos: 200/200 aprovadas.
- Disputas com três processos: 100/100 aprovadas.
- Falhas/rollback: 6/6 aprovadas.
- Processo encerrado durante transação: PASSOU; PID 32284, sinal `SIGTERM`, estado após encerramento `PRONTA`.
- Regressão MRT-50.9: APROVADO_ISOLAMENTO_TECNICO (Concorrência simultânea da reserva de resposta: PASSOU; Morte imediatamente após reserva durável INICIADO: PASSOU; Reinicialização de TefManager e NativeHost com recuperação integrada: PASSOU).
- Contadores do driver em todos os cenários: TX_START=0, TX_CONTINUE=0, TX_FINALIZE=0; DLL loads=0.

## Estratégia e evidência

A reserva usa uma conexão SQLite dedicada por processo e executa `BEGIN IMMEDIATE` antes de reler/validar a resposta, atualizar `PRONTA → INICIADO` e executar `COMMIT`. O sucesso só é retornado após o COMMIT confirmado e a releitura independente de durabilidade. Não há retry automático; `SQLITE_BUSY` e `SQLITE_LOCKED` resultam em bloqueio.

### Falhas injetadas

| Cenário | Resultado | Código | Estado persistido |
|---|---|---|---|
| A — Falha antes da gravação | PASSOU | `TEF_CONTINUIDADE_PERSISTENCIA_FALHOU` | `PRONTA` |
| B — Falha durante a gravação | PASSOU | `TEF_CONTINUIDADE_PERSISTENCIA_FALHOU` | `PRONTA` |
| C — Falha no COMMIT | PASSOU | `TEF_CONTINUIDADE_PERSISTENCIA_FALHOU` | `PRONTA` |
| D — Falha na releitura independente após COMMIT | PASSOU | `TEF_CONTINUIDADE_PERSISTENCIA_FALHOU` | `INICIADO` |
| E — SQLITE_BUSY | PASSOU | `DESTAXA_CONTINUIDADE_CONCORRENCIA` | `PRONTA` |
| E — SQLITE_LOCKED | PASSOU | `DESTAXA_CONTINUIDADE_CONCORRENCIA` | `PRONTA` |

### Disputa interprocessos

Cada rodada registra no JSON os PIDs, identidade e timestamp completos, estado anterior/posterior, resultado de cada processo, `despachoId`, gate, identidade do arquivo SQLite e contadores do driver. A barreira de início simultâneo é liberada somente após os processos participantes aguardarem na reserva.

O caso de encerramento abrupto confirma que SQLite descarta a transação ainda não commitada: a resposta permaneceu `PRONTA`; uma reserva posterior confirmou um único despacho. Isso não altera o cenário MRT-50.9 de morte após reserva durável `INICIADO`, que permanece parte da regressão.

## Regressões e limites

MRT-50.9 foi executada sem alterar seus critérios e com o relatório redirecionado para o diretório SQLite temporário, preservando o relatório histórico. O JSON detalhado contém o resultado individual das 300 rodadas e os dados da regressão.

Todos os processos foram configurados com `DESTAXA_REAL_TRANSACTION_ENABLED=0`, `CDS_TEST_ISOLAR_BANCO=1` e driver sem despacho financeiro. Nenhum banco oficial, DLL Destaxa, V$PagueClient, PinPad, adquirente, SEFAZ ou operação financeira foi acessado. Este resultado não representa homologação física nem liberação de preflight financeiro.

## Arquivos de produção alterados

- `backend/services/tef/destaxa/destaxaContinuidadePersistencia.js`
- `backend/services/tef/tefRepository.js`
