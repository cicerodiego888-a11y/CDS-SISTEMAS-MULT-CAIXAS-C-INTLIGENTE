# MRT-50.18 — Diagnóstico forense da regressão MRT-50.10

**Classificação: CAUSA IDENTIFICADA**

## Escopo

Diagnóstico estático dos relatórios e do código. Não executei MRT-50.10/MRT-50.9, serviços, Electron, NativeHost ou operações TEF; não acessei banco de dados. Os relatórios MRT-50.10 existentes foram lidos, não alterados.

## Resultado dos relatórios

O JSON registra `BLOQUEADA` e `approved: false`; o Markdown apresenta a mesma classificação. O critério falso é exclusivamente `mrt509RegressionPassed`: 300 disputas, falhas/rollback e encerramento durante transação constam como aprovados. Ver [JSON](./mrt-50-10-reserva-atomica-report.json#L3), [critérios finais](./mrt-50-10-reserva-atomica-report.json#L30528) e [resumo Markdown](./MRT-50.10-RESERVA-ATOMICA.md#L10).

Os seis casos de falha têm `fault.status: "PASSOU"` e estados efetivos iguais aos esperados: A, B, C, SQLITE_BUSY e SQLITE_LOCKED ficaram `PRONTA`; D ficou `INICIADO`. O Markdown confirma 6/6. Portanto, os valores nulos exibidos na saída compacta do processo não são estados persistidos nem falhas dos casos.

## Causa raiz da regressão

A falha registrada é o cenário 3 da MRT-50.9, **“Reinicialização de TefManager e NativeHost”**. A evidência da execução anterior mostra `FALHOU`; a stack aponta `assert.strictEqual(await client.iniciar(), true)` em `mrt-50-9-validacao-complementar.test.js:353`, que recebeu `false`. O cenário falha antes de concluir o ciclo de reinicialização e antes de avaliar seus critérios finais. A cópia temporária do relatório MRT-50.9 registra esse erro e os status `PASSOU, PASSOU, FALHOU`.

O caminho está comprovado no código:

1. A regressão é iniciada por `spawnSync(process.execPath, [testPath])`; o ambiente só acrescenta o caminho do relatório, isolamento e gate financeiro OFF. Ver [invocação da regressão](../../tests/tef/mrt-50-10-reserva-atomica.test.js#L747).
2. O processo MRT-50.9 e seus workers não definem `TEF_ENCRYPTION_KEY`; os workers apenas herdam `process.env` e acrescentam isolamento, `DB_DIR`, `NODE_ENV=test` e gate OFF. O relatório anterior também registra a ausência da variável no stderr. Ver [ambiente dos workers](../../tests/tef/mrt-50-9-validacao-complementar.test.js#L120) e [stderr da regressão](./mrt-50-10-reserva-atomica-report.json#L30511).
3. `TefManager` tenta obter a chave pública no construtor. Sem a chave exigida pelo assinador, configura criptografia como indisponível; o provedor de bootstrap continua registrado. Ver [construtor](../../backend/services/tef/TefManager.js#L258), [falha fechada](../../backend/services/tef/TefManager.js#L287) e [chave exigida pelo assinador](../../backend/services/tef/tefReconciliationEvidence.js#L88).
4. `_criarBootstrapSeguranca()` exige a configuração criptográfica. O cliente só considera o NativeHost iniciado após confirmar o bootstrap; falha do provedor leva `iniciar()` a retornar `false`. Ver [bootstrap do manager](../../backend/services/tef/TefManager.js#L322), [sincronização do bootstrap](../../backend/services/tef/destaxa/DestaxaNativeHostClient.js#L369) e [tratamento da falha do provedor](../../backend/services/tef/destaxa/DestaxaNativeHostClient.js#L621).
5. Isso contradiz a expectativa `true` no teste e produz o `false !== true` registrado. O primeiro e o segundo cenários MRT-50.9 passam; o terceiro falha por pré-requisito de inicialização criptográfica ausente, não por disputa ou reserva duplicada.

O aviso do `cryptoService` no relatório é corroborativo de ambiente sem chave, mas não é, isoladamente, a prova do erro de assinatura: esse serviço possui fallback de desenvolvimento em testes. A causa técnica decorre do contrato separado do assinador de evidências, da indisponibilidade registrada pelo `TefManager` e do bootstrap obrigatório antes de `client.iniciar()` retornar sucesso.

## Campos nulos e classificação

Há um defeito de apresentação no resumo JSON impresso pelo teste: os objetos de `faults` gravam `status`, e a classificação também consulta `fault.status`; porém, a saída compacta mapeia `fault.passou`, propriedade inexistente. `JSON.stringify` converte o elemento `undefined` dentro do array para `null`. Ver [criação de `fault.status`](../../tests/tef/mrt-50-10-reserva-atomica.test.js#L684), [classificação baseada em `status`](../../tests/tef/mrt-50-10-reserva-atomica.test.js#L475) e [projeção incorreta `fault.passou`](../../tests/tef/mrt-50-10-reserva-atomica.test.js#L505).

Assim, os `null` da saída compacta não demonstram estado de despacho nulo. O JSON detalhado conserva `stateAfter` e `expectedState`; o Markdown também apresenta esses estados. Não há divergência entre a classificação final do JSON e do Markdown: ambos são `BLOQUEADA`. Há apenas divergência entre a saída compacta de `faultStatuses` e os campos reais dos objetos.

A classificação `BLOQUEADA` é aplicada porque `regressionPassed` exige exit code zero e classificação `APROVADO_ISOLAMENTO_TECNICO`; como MRT-50.9 retorna exit code 1 e `FALHOU`, a conjunção final é falsa, mesmo com as reservas e os demais critérios aprovados. Ver [regressão e classificação](../../tests/tef/mrt-50-10-reserva-atomica.test.js#L472).

## Separação de causas e influência da MRT-50.17

- **Reserva atômica:** os resultados registrados não demonstram falha na reserva. As disputas 200/200 e 100/100, os seis casos de falha/rollback e a recuperação após encerramento aparecem aprovados.
- **Harness de regressão:** a MRT-50.9 testa a inicialização real do contrato `TefManager`/bootstrap, mas executa com `node` direto e não fornece o segredo criptográfico de teste exigido. Esse é o bloqueio que faz a MRT-50.10 reprovar.
- **MRT-50.17:** seu provisionamento é chamado pelo bootstrap Electron em [electron-common.js](../../electron-common.js#L293). A regressão é iniciada diretamente por Node e não percorre esse bootstrap. Logo, MRT-50.17 não executou nem forneceu a chave nesse caminho; a falha evidencia que o harness não reproduz o pré-requisito criptográfico da aplicação Electron. Não há evidência de que o código da reserva tenha sido alterado por MRT-50.17.

## Correção mínima recomendada — não implementada

Atualizar apenas a preparação isolada da regressão MRT-50.9 para fornecer um segredo de teste válido, não fixo de desenvolvimento, ao processo pai e aos workers por herança. A chave não deve ser impressa nem persistida; o filtro de ambiente do NativeHost deve continuar excluindo o segredo e transmitindo somente a chave pública. Alternativamente, injetar um assinador de teste compatível no `TefManager`, se esse ponto de injeção já estiver disponível.

Corrigir separadamente o resumo MRT-50.10 para projetar `fault.status` (ou declarar explicitamente o campo desejado), sem usar `fault.passou`. Isso elimina os `null` enganosos, mas **não** corrige a reprovação causada pela MRT-50.9.

Não recomendo declarar MRT-50.10 aprovada sem uma execução posterior autorizada, com a regressão MRT-50.9 devidamente provisionada e todos os critérios passando.

## Integridade dos relatórios examinados

SHA-256 antes da criação deste diagnóstico:

- JSON: `16C026AED4B015AA7812C3E5CA512196F169F84D138E35B0F8D96F537C28F355`
- Markdown: `A0478470931BE2AD0288EC09E4A5AEF44894173A359CF17CDAE909518BB346C5`

Os hashes foram rechecados após a criação deste arquivo e permaneceram idênticos. Este relatório é o único arquivo criado nesta sprint.
