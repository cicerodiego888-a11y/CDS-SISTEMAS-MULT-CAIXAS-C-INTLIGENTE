# MRT-50.26 — Diagnóstico da disponibilidade da chave TEF no PDV

## Conclusão: CAUSA PARCIALMENTE IDENTIFICADA

A causa imediata está comprovada: no processo onde `cryptoService` foi consultado, `process.env.TEF_ENCRYPTION_KEY` estava ausente ou vazio, condição que produz `TEF_CRYPTO_KEY_UNAVAILABLE`. No caminho local do Electron, o provisionador deveria preencher esse mesmo `process.env` antes de carregar o backend. Se o provisionamento falha, o próprio provisionador remove a variável; o bootstrap captura a falha e continua carregando o backend, permitindo que a aplicação chegue à tela de login com o TEF indisponível.

Não foi preservado o código de erro emitido pelo provisionador no processo do PDV. Portanto, não é possível determinar se a indisponibilidade decorreu de `safeStorage` indisponível, leitura/formato do arquivo, falha de `decryptString`, validação criptográfica ou se a inicialização observada não percorreu o caminho local de provisionamento. A falha exata dentro do provisionador permanece **não comprovada**.

## Sequência real de inicialização

| Etapa | Comportamento encontrado |
|---|---|
| 1. Entrada do aplicativo | O pacote ERP inicia por `electron-erp.js`; o PDV inicia por `electron-pdv.js`. Ambos chamam `iniciarAplicacaoElectron()` em `electron-common.js`. |
| 2. Prontidão do Electron | O bootstrap espera `app.whenReady()` antes de decidir o modo e iniciar o backend local. Isso ordena a chamada do provisionador depois de `ready`; não prova, por si só, que `safeStorage.isEncryptionAvailable()` retornará `true`. |
| 3. Seleção de modo | O ERP usa o backend local. O PDV pode estar em modo cliente/remoto e só tenta iniciar backend local se for configurado como local ou entrar em fallback local. O parâmetro `--cds-forcar-local` usado na validação anterior selecionou o modo local. |
| 4. Início do caminho local | Após reservar a porta, o bootstrap chama `prepararChaveCriptograficaTef()` e aguarda seu término antes de executar `require('./backend/server')`. |
| 5. Verificação e leitura | O provisionador exige `safeStorage.isEncryptionAvailable()`. Com o arquivo presente, verifica que é arquivo regular, lê e valida o JSON e o formato, depois chama `safeStorage.decryptString()`. |
| 6. Validação da chave | A chave recuperada é validada pelo mecanismo de evidências. Essa validação coloca a chave temporariamente em `process.env` e restaura o valor anterior ao terminar. |
| 7. Disponibilização | Somente após a validação, o caminho de arquivo existente atribui a chave a `env.TEF_ENCRYPTION_KEY` e retorna sucesso. Como o chamador padrão usa `env = process.env`, a atribuição fica no ambiente do processo Electron principal. O retorno do provisionador não contém a chave — não precisa contê-la, pois a chave já foi definida no ambiente compartilhado. |
| 8. Backend e TefManager | Depois da tentativa de provisionamento, o backend é carregado no mesmo processo. Ao carregar as rotas TEF, `TefManager` é instanciado e obtém a chave pública da evidência. Sem uma chave válida no ambiente, registra configuração criptográfica indisponível. |
| 9. Uso do serviço | `cryptoService` consulta `process.env.TEF_ENCRYPTION_KEY` no momento de cifrar/decifrar. Se ausente ou vazia, lança `TEF_CRYPTO_KEY_UNAVAILABLE`. |

O provisionador é importado no topo de `electron-common.js`, antes de `ready`, mas essa importação apenas carrega o módulo; a chamada que lê/descriptografa o armazenamento ocorre depois de `app.whenReady()`. Não encontrei importação antecipada de `TefManager` pelo entrypoint Electron antes da tentativa de provisionamento. O backend — e as rotas que carregam o `TefManager` — só são requeridos depois dessa tentativa.

## Localização precisa da perda da chave

O caminho de sucesso para armazenamento existente termina definindo `env.TEF_ENCRYPTION_KEY` com o segredo validado. O `catch` externo do provisionador faz `delete env.TEF_ENCRYPTION_KEY` para qualquer erro. Em seguida, `prepararChaveCriptograficaTef()` captura o erro, registra seu código e apresenta uma caixa de erro, mas não o relança. O bootstrap então prossegue para `require('./backend/server')`.

Assim, a fronteira onde a chave deixa de estar disponível é:

1. uma falha no provisionamento leva ao `catch` do provisionador, que apaga a variável; ou
2. o caminho de provisionamento local não foi executado para aquele processo (por exemplo, o PDV operou como cliente remoto); ou
3. o consumidor consultado não pertence ao processo que provisionou.

Para a execução anterior do PDV, foi registrado uso de modo local forçado, e `cryptoService` devolveu `TEF_CRYPTO_KEY_UNAVAILABLE`. O código executa o provisionador no caminho local, antes do backend, e não há processo/worker separado para `cryptoService`. Isso aponta para uma falha de provisionamento no processo testado, mas o código de erro da falha não foi capturado; por isso, a etapa interna exata não pode ser afirmada.

## safeStorage e arquivo existente

- O código tenta descriptografar o arquivo existente: após verificar formato, chama `safeStorage.decryptString()` e valida o segredo resultante.
- `isEncryptionAvailable()` é verificado antes da leitura. Se retornar falso, o provisionador lança `TEF_CHAVE_ARMAZENAMENTO_INDISPONIVEL`.
- Uma exceção de `decryptString()` é convertida em `TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU`; a exceção original do sistema operacional não é preservada. Erros de leitura e formato têm códigos próprios.
- A validação anterior da MRT-50.25 confirmou a existência do arquivo após o ERP, igualdade de seu hash após iniciar o PDV e falha da cifra sintética do PDV com `TEF_CRYPTO_KEY_UNAVAILABLE`. Hash igual demonstra que os bytes persistidos não mudaram; não demonstra sucesso de descriptografia.
- Não há registro preservado do valor de `safeStorage.isEncryptionAvailable()` no PDV nem do código reportado por `prepararChaveCriptograficaTef()`. Não se pode concluir que DPAPI/safeStorage recusou o arquivo. Também não se pode concluir que o PDV chegou a `decryptString()` somente com o hash do arquivo.

## Processos, propagação e diferenças ERP/PDV

- Provisionador, backend, `TefManager` e `cryptoService` executam no processo principal do Electron no caminho local. O backend é carregado via `require`, não por `child_process` ou worker.
- Existe processo NativeHost separado quando acionado por fluxo TEF; ele recebe ambiente filtrado e não recebe `TEF_ENCRYPTION_KEY`. Ele não é o consumidor do `cryptoService` investigado e não explica a variável ausente no processo principal.
- Não encontrei, no caminho de startup analisado, limpeza ou sobrescrita de `TEF_ENCRYPTION_KEY` após o provisionador. As mutações relevantes são a validação temporária, a atribuição em sucesso e a exclusão no `catch` de falha.
- ERP e PDV têm entrypoints, identificadores e configurações de empacotamento diferentes. Ambos compartilham `electron-common.js` e o mesmo caminho de provisionamento local. A principal diferença funcional de inicialização é o PDV poder operar como cliente remoto; nesse modo ele não carrega o backend local nem provisiona uma chave local até entrar em fallback.
- O ERP tem wrapper de diagnóstico de startup; o entrypoint do PDV não tem wrapper equivalente. Na validação anterior, stdout/stderr do processo do PDV não foram preservados como evidência, impedindo recuperar o código não sensível do erro do provisionador.

## Menor teste controlado recomendado

Em uma etapa posterior autorizada, sem usar o banco oficial e sem iniciar NativeHost:

1. Executar um harness diagnóstico no contexto Electron do PDV instalado, depois de `app.whenReady()`, sob a mesma conta Windows.
2. Usar um diretório de dados temporário isolado contendo apenas uma cópia do arquivo protegido existente; não copiar nem abrir o banco oficial. Como o arquivo já existe, a chamada de provisionamento não precisa consultar o banco.
3. Registrar somente `isEncryptionAvailable()`, resultado/código de erro do provisionador, sucesso/falha da validação e resultado de uma cifra/decifra sintética. Nunca registrar segredo, ciphertext ou payload sensível.
4. Se a descriptografia falhar, preservar o arquivo original e investigar a identidade Windows e a proteção do sistema operacional; não gerar nem substituir a chave. Se o provisionador reportar sucesso, mas o consumidor ainda não vir a variável, testar a leitura e o consumo no mesmo processo e registrar apenas presença booleana.

Esse teste separa uma falha de `safeStorage`/leitura/validação de uma falha de fluxo ou compartilhamento de ambiente sem abrir o banco oficial. Não foi executado nesta sprint.

## Menor correção recomendada

Não alterar `cryptoService`, o provisionador ou substituir a chave antes de obter o código de falha do teste controlado. A correção funcional depende do estágio que falhar. Como endurecimento independente, o bootstrap local deve impedir o carregamento do backend quando o provisionamento criptográfico falhar; hoje ele mostra o erro e continua, produzindo uma aplicação aparentemente inicializada com o TEF indisponível. Esse ajuste não resolve, por si só, uma eventual falha de descriptografia.

## Escopo e arquivos

- Não foram iniciados ERP/PDV, testes, build ou instalação.
- O banco oficial não foi aberto; o arquivo protegido, instalações e instaladores foram preservados.
- Nenhum NativeHost, DLL, V$Pague, PinPad, transação ou evento fiscal foi iniciado.
- Nenhum arquivo de implementação foi alterado. Este relatório é o único arquivo criado nesta sprint.

## Referências do código

- [electron-pdv.js](../../electron-pdv.js#L1), [electron-erp.js](../../electron-erp.js#L105): entrypoints.
- [electron-common.js](../../electron-common.js#L269), [electron-common.js](../../electron-common.js#L293), [electron-common.js](../../electron-common.js#L306), [electron-common.js](../../electron-common.js#L540): seleção de modo, provisionamento e inicialização.
- [electron-builder-pdv.json](../../electron-builder-pdv.json#L2), [electron-builder-erp.json](../../electron-builder-erp.json#L2): identidades e entrypoints empacotados.
- [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L28), [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L80), [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L316), [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L375), [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L438): validação, descriptografia, disponibilização e falha.
- [cryptoService.js](../../backend/services/crypto/cryptoService.js#L18): leitura da chave pelo consumidor.
- [server.js](../../backend/server.js#L153), [TefManager.js](../../backend/services/tef/TefManager.js#L258), [TefManager.js](../../backend/services/tef/TefManager.js#L2699): carregamento da rota e inicialização do gerenciador.
- [MRT-50.25-INSTALACAO-VALIDACAO.md](./MRT-50.25-INSTALACAO-VALIDACAO.md#L18): evidência runtime anterior.
