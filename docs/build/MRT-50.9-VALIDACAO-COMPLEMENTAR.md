# MRT-50.9 — Validação complementar de continuidade TEF

## Decisão: BLOQUEADO — correção necessária

O teste de concorrência reproduziu duas reservas válidas para a mesma resposta. Não alterar a MRT-50.8 nesta sprint; a correção mínima deve ser proposta e implementada separadamente. **Preflight não liberado.**

## Ambiente e alterações

- SQLite temporário: `C:\Users\cicer\AppData\Local\Temp\cds-mrt-50-9-42256-3cae9f8d0eab\mercadao.db`
- Identidade reportada: `dev=505650597`, `ino=11821949022853156`; `journal_mode=wal`.
- Gate financeiro: **OFF** no processo principal, workers e NativeHost.
- Banco oficial, DLL Destaxa, V$Pague, PinPad, adquirentes e SEFAZ: **não acessados**.
- Operações financeiras reais: **nenhuma**. Mock do NativeHost registrou zero chamadas a `TX_START`, `TX_CONTINUE` e `TX_FINALIZE`; `dllLoads=0`.
- Produção: **nenhum arquivo alterado**. Arquivos desta sprint: teste MRT-50.9 e os dois relatórios MRT-50.9.
- Regressões adicionais: não executadas; os três cenários MRT-50.9 foram o escopo isolado e nenhuma implementação foi modificada.

## Cenário 1 — Concorrência simultânea da reserva: FALHOU

Foram feitas 20 repetições, cada uma com dois processos independentes, a mesma identidade, timestamp e estado inicial `PRONTA`. Em 19 repetições, um processo venceu e o outro foi bloqueado. Na repetição 9, **ambos** obtiveram sucesso:

- `transactionId=9`
- `operation_id=op_mrt509_race9_8dd642e2bf`
- `idempotency_key=mrt40_mrt509_race9_8dd642e2bf`
- `fingerprint=e2674d03530b006afcf36f1b1300c9e5`
- Timestamp original: `2026-11-05T21:13:02.878Z`
- PIDs: `44336` e `27848`
- Ambos retornaram `ok=true`, `changes=1`, estado `INICIADO`, com IDs de despacho diferentes: `2d09152bf32d4824b44f8007e487569b` e `6564fa58e84c78e38bdcb8cec4331e11`.
- O banco terminou com apenas um desses IDs, mas os dois chamadores já haviam recebido sucesso.
- Driver em ambos: `inicia=0`, `continua=0`, `finaliza=0`; gate OFF.

**Causa comprovada:** `reservarDespachoResposta()` lê/valida `PRONTA`, gera um `despachoId` e grava `INICIADO` em etapas separadas ([destaxaContinuidadePersistencia.js](../../backend/services/tef/destaxa/destaxaContinuidadePersistencia.js), função `reservarDespachoResposta`, linhas 457–543). A gravação pode confirmar cada atualização isoladamente, sem uma reivindicação atômica que permita apenas um vencedor. A repetição 9 prova a falha: dois processos receberam confirmações duráveis com IDs distintos.

**Risco:** os dois chamadores podem avançar após terem recebido confirmação válida, mesmo que só um `despachoId` permaneça persistido. O cenário parou na reserva; não chamou o driver.

**Correção mínima para sprint separada:** claim compare-and-swap atômico, condicionado ao registro ainda estar `PRONTA`; sucesso somente se exatamente uma linha/resposta mudar. Reexecutar concorrência interprocessos antes de qualquer liberação.

## Cenário 2 — Morte após reserva `INICIADO`: PASSOU

Sequência observada, no mesmo arquivo SQLite e identidade de arquivo:

1. Resposta confirmada como `PRONTA` em `2026-11-05T21:13:17.635Z`.
2. Processo `PID 44060` confirmou a reserva durável `INICIADO` às `2026-11-05T21:13:18.443Z`, despacho `de41f2d045fb4c457b4c97ff66d6e74a`.
3. O processo encerrou às `2026-11-05T21:13:18.473Z`, antes de chamar `TX_CONTINUE`.
4. Processo independente `PID 12392` recuperou `INICIADO` às `2026-11-05T21:13:19.277Z`. Nova reserva foi recusada com `DESTAXA_CONTINUIDADE_RESPOSTA_DUPLICADA`.

O registro permaneceu `pendente`, `financialState=UNKNOWN`, `estadoDespacho=INICIADO`. Não foi inferido resultado financeiro, não houve retry nem chamadas ao driver.

## Cenário 3 — Reinicialização de TefManager e NativeHost: PASSOU

- Processo anterior: TefManager `PID 17364`; NativeHost `PID 42696`; sessão `f66fcf6a9bb5cfdcf6fc069421283d05`. Encerrados às `2026-11-05T21:13:20.381Z`.
- Novo processo: TefManager `PID 46244`; NativeHost `PID 38380`; nova sessão `5fc966f383c283bc87fd1e260321b107`.
- Identidade recuperada: `transactionId=22`, `operation_id=op_mrt509_restart_002c3271b9`, `idempotency_key=mrt40_mrt509_restart_002c3271b9`, `fingerprint=dfda8c1ef22590b8d20395b8fc54a09c`.
- Timestamp original e recuperado: `2026-11-05T21:13:19.278Z`.
- Estado: `PRONTA` antes; reserva persistida `INICIADO` durante tentativa; transação continuou `pendente` e `UNKNOWN`.
- O bootstrap da nova sessão ficou `SECURITY_BLOCKED`, incluindo essa identidade. Resultado: `DESTAXA_CICLO_INCONCLUSIVO`, `reconciliacaoObrigatoria=true`, `retryAllowed=false`.
- Contadores do driver mock: `inicia=0`, `continua=0`, `finaliza=0`; DLL carregada: `0`; gate OFF.

**Observação sobre sessão:** `_validarSessaoNativeHostContinuidade()` retorna `ok=true` com `motivo=sem_pid_ancora` quando não há PID em memória ([TefManager.js](../../backend/services/tef/TefManager.js), linha 387). Neste caminho integrado, isso não liberou a continuidade: o novo bootstrap manteve a identidade bloqueada e o fluxo retornou inconclusivo, exigindo reconciliação. O teste verificou a nova sessão e o caminho de recuperação; não reapresentou diretamente um token assinado antigo.

## Classificação final e próximos passos

| Cenário | Resultado |
|---|---|
| Concorrência simultânea | **FALHOU** — dupla reserva reproduzida na repetição 9/20 |
| Morte após `INICIADO` | **PASSOU** — recuperação encontrou estado consumido e recusou replay |
| Reinicialização completa | **PASSOU** — novo bootstrap bloqueou a identidade e exigiu reconciliação |

A MRT-50.9 fica **BLOQUEADA** pelo defeito de concorrência. Não implementar nesta sprint, não liberar preflight e não autorizar operação simbólica. O relatório estruturado com os resultados das 20 repetições, PIDs, IDs de despacho, caminhos SQLite e contadores está em [`mrt-50-9-validacao-complementar-report.json`](./mrt-50-9-validacao-complementar-report.json).
