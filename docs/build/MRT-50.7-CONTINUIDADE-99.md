# MRT-50.7 — Continuidade Destaxa 99

## Classificação final: BLOQUEADO

A implementação direta de MRT-50.7 passou nos 13 cenários e todas as regressões exigidas passaram. Porém, a verificação adicional de replay entre processos da MRT-40 falhou: o processo filho, usando o mesmo SQLite temporário, não leu a resposta que o processo pai havia relido como persistida e chamou o driver mockado uma vez. Como a resposta não foi comprovadamente durável entre reinicializações, o critério de aceite não está atendido.

Esta classificação bloqueia a conclusão técnica da sprint. Não autoriza preflight nem operação financeira.

## CONCLUÍDO

- `continuarPagamento` valida a solicitação 99 persistida, a identidade, a ação e o timestamp original antes de iniciar o ciclo.
- A resposta do operador precisa ser persistida e confirmada por releitura antes do hook que permite `TX_CONTINUE`.
- Ausência, inválidez ou expiração do timestamp bloqueia a continuidade.
- O timestamp original é mantido no estado persistido e recuperado pelo `TefManager`.
- Falhas de gravação, releitura e validação retornam estado inconclusivo/pendente e não iniciam `TX_START`.
- Não foi alterada a arquitetura de reconciliação RELEASE/COMMIT.

## TESTADO

| Suíte | Resultado |
|---|---:|
| MRT-50.7 | 13/13 |
| MRT-47 adaptado | 16/16 |
| MRT-49 | 20/20 |
| MRT-50 IPC | 31/31 |
| MRT-50.2 | 16/16 |
| MRT-50.3 | 12/12 |
| MRT-38 | 17/17 |
| MRT-39 | 11/11 |

Na MRT-50.7, gravação/leitura defeituosa, armazenamento indisponível, retorno inválido, timestamps ausente/inválido/expirado, replay, identidade divergente e falha de leitura bloquearam o driver: `inicia=0`, `continua=0`, `finaliza=0`. Os caminhos válidos chamaram somente o driver mockado.

Também passaram `node --check` nos arquivos JavaScript alterados pela implementação.

## BLOQUEADO — evidência de replay entre processos

A execução adicional de `node tests\tef\mrt-40-integracao-pdv-backend-continuidade.test.js` falhou no cenário 5:

- Processo pai: leu `AGUARDANDO_RESPOSTA` com uma resposta persistida.
- Processo filho: reportou o mesmo caminho SQLite temporário (`%TEMP%\cds-sistemas-test-db\mercadao.db`), mas leu `AGUARDANDO_RESPOSTA` com zero respostas.
- O filho chamou `continuarTransacaoDestaxa` no driver mockado (`continua=1`) e então retornou `DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA`.
- A expectativa original de replay bloqueado não foi alterada.

A causa raiz da diferença de visibilidade entre processos não foi determinada. A releitura no mesmo processo, usada pela MRT-50.7, não foi suficiente para comprovar durabilidade após reinicialização. A correção mínima é identificar por que a resposta não está disponível ao processo filho e garantir que a validação pré-driver falhe fechada quando a releitura após reinício não a encontrar. Depois disso, repetir o cenário MRT-40 e acrescentar verificação equivalente à regressão MRT-50.7.

## Arquivos alterados nesta etapa

### Produção

- `backend/services/tef/TefManager.js`
- `backend/services/tef/adapters/DestaxaRealAdapter.js`
- `backend/services/tef/destaxa/destaxaContinuidadeContrato.js`
- `backend/services/tef/destaxa/destaxaContinuidadePersistencia.js`
- `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`

### Testes e evidências

- `tests/tef/mrt-50-7-continuidade-99.test.js`
- `tests/tef/mrt-38-hardening-continuidade-interativa.test.js` — isolamento SQLite por execução e validação fail-closed.
- `tests/tef/mrt-39-persistencia-continuidade.test.js` — timestamp original exigido no cenário de sucesso.
- `tests/tef/mrt-40-integracao-pdv-backend-continuidade.test.js` — adicionada evidência diagnóstica do estado e caminho lidos pelo filho; nenhuma expectativa de segurança foi removida.

## Segurança e limitações

- Gate financeiro: OFF.
- Banco oficial: não acessado. Os testes abriram bancos em `%TEMP%`.
- DLL Destaxa: não carregada.
- Operações financeiras reais/simbólicas: nenhuma.
- V$Pague, adquirentes, PinPad e SEFAZ: não acessados.
- MRT-24, MRT-36 e MRT-42: não executadas nem modificadas nesta sprint.
- O sucesso dos testes com driver simulado não comprova comunicação com equipamento ou homologação física.

## Próximo passo

Corrigir e testar a persistência/readback entre processos para que uma resposta 99 confirmada no processo pai esteja disponível após reinicialização, ou que a ausência seja detectada antes do driver. Reexecutar MRT-40 e MRT-50.7; manter gate OFF. A aprovação desta correção continuará não autorizando a primeira transação simbólica.
