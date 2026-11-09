# MRT-50.8 — Durabilidade e replay interprocessos da continuidade 99

## Classificação final: CONCLUÍDO

Concluída a correção técnica e as regressões isoladas desta sprint. Isso **não** homologa a integração, não libera preflight e não autoriza transação simbólica.

## Arquivos alterados

**Produção**

- `backend/rotas/tef.js`
- `backend/services/tef/TefManager.js`
- `backend/services/tef/adapters/DestaxaRealAdapter.js`
- `backend/services/tef/destaxa/destaxaContinuidadePersistencia.js`
- `frontend/pdv/js/pdvTefContinuidade.js`

**Testes**

- `tests/tef/mrt-50-8-durabilidade-interprocessos.test.js`
- `tests/tef/mrt-40-integracao-pdv-backend-continuidade.test.js`
- `tests/tef/mrt-50-7-continuidade-99.test.js`
- `tests/tef/mrt-39-1-integracao-tefmanager-adapter.test.js`

## Diagnóstico comprovado

O SQLite não perdeu a resposta. Na execução MRT-40, processo principal, leitor independente e processo filho resolveram o mesmo caminho e a mesma identidade de arquivo (`dev=505650597`, `ino=7881299349181668`), com `journal_mode=wal`; a conexão normal registrou `busy_timeout=30000` e `synchronous=2` (FULL). O filho leu uma resposta persistida, mas ela não correspondia à solicitação 99 corrente.

No cenário 5 da MRT-40, a resposta estava vinculada a `2026-11-05T16:17:21.740Z`, enquanto a solicitação corrente era `2026-11-05T16:17:21.797Z`. A resposta existia e tinha identidade completa, mas `respostaVinculadaAoTimestamp=false`. O POST do PDV não transmitia o timestamp original, e `TefManager.continuarAutorizacao()` usava o timestamp persistido corrente no lugar do timestamp da resposta. O filho anterior chegou a chamar o driver; após a correção, o replay com timestamp antigo retorna `DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE` e os contadores do driver permanecem em zero.

O caminho MRT-40 foi:

`C:\Users\cicer\AppData\Local\Temp\cds-mrt-50-8-mrt40-4328-1e657216540f\mercadao.db`

O `PRAGMA transaction_state` retornou conjunto vazio nas conexões instrumentadas; isso **não** demonstra ausência de transação. A prova de COMMIT usada nesta sprint é a releitura da resposta e da reserva de despacho por conexão SQLite independente, além do teste explícito em que uma gravação não commitada não ficou visível ao processo leitor.

O diretório `%TEMP%\cds-sistemas-test-db` encontrado em registros MRT-50.7/MRT-39 pertence a outras execuções; não foi usado como substituto silencioso para o caminho MRT-40. A MRT-50.8 criou diretórios temporários próprios, confirmou os caminhos efetivos e comparou a identidade dos arquivos.

## Correções realizadas

- `solicitadaEm` agora atravessa a resposta do backend, a reconstrução de pendências, os POSTs do PDV e a rota `/tef/continuar`. `TefManager` e `DestaxaRealAdapter` exigem timestamp válido e igualdade estrita com a solicitação persistida, antes do Host.
- A ação e a identidade completa da transação continuam vinculadas à solicitação original. Divergência, ausência ou expiração bloqueiam sem retry e sem novo `TX_START`.
- A resposta persistida recebe estado de despacho `PRONTA`. Antes da fronteira do driver, uma atualização condicional de uso único a marca `INICIADO`, atribui identificador de despacho e confirma a gravação por conexão somente leitura independente. Replays de estado `INICIADO` são recusados.
- Se a transação já está em estado `RESPONDIDA`, o manager exige que o registro da resposta esteja presente; a ausência não pode ser convertida em uma nova gravação que autorize continuidade.
- Falha de leitura, payload inválido, identidade divergente ou reserva não confirmada retorna falha técnica e não alcança `TX_CONTINUE`.
- RELEASE/COMMIT e a arquitetura de reconciliação não foram alterados.

## MRT-50.8 — cenários interprocessos

Os 16 cenários passaram em SQLite temporário. No cenário válido, o processo pai gravou e confirmou a resposta, encerrou-se, e um processo filho independente abriu o mesmo arquivo/inode, recuperou a resposta sem fallback em memória e chamou o driver mockado exatamente uma vez:

`inicia=0`, `continua=1`, `finaliza=0`.

Nos cenários bloqueados, os contadores na fronteira do driver foram sempre:

`inicia=0`, `continua=0`, `finaliza=0`.

1. Recuperação válida pelo filho após encerramento do pai.
2. Replay após reserva durável de despacho.
3. Resposta ausente.
4. Caminho SQLite divergente.
5. Timestamp ausente.
6. Timestamp inválido.
7. Timestamp divergente.
8. Identidade completa divergente.
9. Ação divergente.
10. Timestamp expirado.
11. Payload persistido inválido.
12. Estado `RESPONDIDA` sem registro da resposta.
13. Falha de releitura da resposta.
14. Falha de recuperação da solicitação pendente.
15. SQLite indisponível para o processo filho.
16. Escrita não commitada: conexão independente e leitor filho não viram a resposta; a confirmação falhou e não houve chamada ao driver.

## Regressões

| Suíte | Resultado |
|---|---|
| MRT-40 completa, incluindo cenário 5 | PASSOU |
| MRT-50.7 — 13 cenários | PASSOU |
| MRT-47 — harness adaptado | PASSOU |
| MRT-49 — 20 cenários | PASSOU |
| MRT-50 IPC — 31 cenários | PASSOU |
| MRT-50.2 | PASSOU |
| MRT-50.3 — 12 cenários | PASSOU |
| MRT-38 | PASSOU |
| MRT-39 | PASSOU |
| MRT-39.1 | PASSOU |
| `node --check` nos arquivos JS alterados | PASSOU |

O relatório JSON [`mrt-50-8-durabilidade-interprocessos-report.json`](./mrt-50-8-durabilidade-interprocessos-report.json) contém os caminhos efetivos, identidade dos arquivos, diagnósticos SQLite, resultados individuais e contadores.

## Segurança e limitações

- Gate financeiro: **OFF**.
- Banco oficial: **não acessado**; todos os bancos usados foram temporários.
- DLL Destaxa, V$Pague, adquirentes, PinPad e SEFAZ: **não acessados**.
- INIT, TX_START real, TX_CONTINUE real, FINALIZE, CRT, PIX, EST, cancelamento e qualquer operação financeira: **não executados**.
- Drivers usados: exclusivamente mocks instrumentados na fronteira do driver.
- `PRAGMA transaction_state` vazio permanece uma limitação de observabilidade; o critério de confirmação é a visibilidade independente após a escrita.

**Decisão:** MRT-50.8 concluída para a correção e testes locais. Não classificar como homologada, não liberar preflight automaticamente e não iniciar a primeira transação simbólica sem autorização específica posterior.
