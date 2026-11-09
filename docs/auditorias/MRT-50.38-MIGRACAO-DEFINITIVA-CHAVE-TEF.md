# MRT-50.38 — Migração definitiva do contexto criptográfico TEF

## Resultado

**APROVADO para provisionamento, recuperação da chave original, reinicialização e convivência ERP/PDV.** A recuperação foi validada com Electron 22.3.27 e o provisionador real do CDS. Não foi iniciada a aplicação completa nem o backend; portanto, isto não declara homologação operacional do ERP ou PDV.

## Arquivos tratados

- `backend/services/tef/tefCryptoProfileProvisioner.js` — provisiona o `Local State` comprovado em perfil ERP ou PDV, configura nome e `userData`, verifica hash e impede sobrescrita de contexto existente.
- `backend/services/tef/tefSigningKeyProvisioner.js` — impede geração/fallback de chave quando `permitirGeracaoChave: false`; recupera a chave do armazenamento protegido existente.
- `electron-common.js` — prepara o contexto antes de importar o backend, recupera a chave após `app.whenReady()` e bloqueia o carregamento do backend se a recuperação falhar. Os caminhos locais e principal também exigem recuperação bem-sucedida.
- `electron-erp.js` e `electron-pdv.js` — definem a identidade do módulo antes de carregar `electron-common.js`.
- `tests/tef/mrt-50-38-contexto-criptografico.test.js` — prova com processos Electron independentes, SafeStorage real e provisionador real do CDS.
- `docs/auditorias/MRT-50.38-MIGRACAO-DEFINITIVA-CHAVE-TEF.md` — este relatório.

Alterações preexistentes de outras frentes foram preservadas. Não houve alteração de manifestos/dependências, banco, chave original nem perfil compartilhado anterior.

## Contexto e integridade dos arquivos

O arquivo de origem utilizado foi a cópia preservada associada à evidência MRT-50.37:

`C:\Users\cicer\.copilot\session-state\8999ffd2-132c-4fb0-bb56-e8414216dd9b\files\MRT-50.38\Local State.source.bak`

O SHA-256 foi conferido contra o perfil `erp-official` da evidência anterior e corresponde exatamente ao valor esperado.

| Arquivo | Tamanho | SHA-256 | Resultado |
|---|---:|---|---|
| Cópia MRT-50.37 preservada (`Local State.source.bak`) | 389 bytes | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Inalterada |
| `erp-official\Local State` usado como comparação da evidência | 389 bytes | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Correspondência exata |
| `%APPDATA%\cds-sistemas-erp\Local State` | 389 bytes | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Correspondência exata |
| `%APPDATA%\cds-sistemas-pdv\Local State` | 389 bytes | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Correspondência exata |
| `%APPDATA%\cds-sistemas\Local State` anterior | 389 bytes | `13802BFFD3FBC2B77E861FD4999E5C49EA57AA5003A5F6132EAC06ED90B66AD0` | Inalterado |
| `C:\ProgramData\MercantilFiscal\dados\.tef-signing-key.v1` | 191 bytes | `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167` | Inalterado |

A instalação usa o hash esperado como condição, grava o arquivo temporário de forma exclusiva e instala sem sobrescrever o destino. O marcador por perfil vincula versão, identidade `cds-sistemas`, módulo, caminho e hash do contexto. Em execução posterior, marcador e `Local State` divergentes bloqueiam o provisionamento. Os perfis ERP/PDV estavam ausentes antes da implantação; o perfil compartilhado anterior foi preservado, sem substituição.

## Arquitetura e ordem de inicialização

1. Os entrypoints declaram explicitamente `erp` ou `pdv` antes de importar `electron-common.js`.
2. O startup valida o identificador, define o nome `cds-sistemas` e configura `%APPDATA%\cds-sistemas-erp` ou `%APPDATA%\cds-sistemas-pdv` antes de outros módulos de aplicação.
3. O contexto preservado é instalado/verificado sem substituir contexto existente.
4. Após `app.whenReady()`, SafeStorage é verificado e `provisionarChaveTef` recupera e valida a chave existente.
5. A geração/fallback está desativada (`permitirGeracaoChave: false`). Se a recuperação falhar, `TEF_ENCRYPTION_KEY` é removida, a falha é registrada por etapa/código, o startup é bloqueado e o backend não é carregado.
6. Os caminhos de inicialização local e principal também verificam o resultado da recuperação antes de requerer `backend/server`.

A checagem do arquivo `Local State` ocorre durante a configuração pré-ready necessária para definir `userData`; a disponibilidade de SafeStorage e a recuperação da chave ocorrem depois de `app.whenReady()`.

## Prova com o provisionador real

O teste `mrt-50-38-contexto-criptografico.test.js` executou processos Electron independentes usando Electron **22.3.27**, SafeStorage real e `provisionarChaveTef` do CDS. Não substituiu nem simulou SafeStorage. O harness também invocou o provisionador real do perfil.

| Verificação | ERP | PDV |
|---|---|---|
| `app.getName()` | `cds-sistemas` | `cds-sistemas` |
| `userData` independente | `%APPDATA%\cds-sistemas-erp` | `%APPDATA%\cds-sistemas-pdv` |
| SafeStorage disponível e descriptografia | PASS | PASS |
| Chave recuperada do armazenamento protegido | PASS | PASS |
| Formato de chave: 64 caracteres hexadecimais | PASS | PASS |
| Fingerprint esperado | `1c6d56245ac4e501` | `1c6d56245ac4e501` |
| Reinício em novo processo | PASS | PASS |
| Contexto e fingerprint após reinício | PASS | PASS |

O fingerprint corresponde a SHA-256 dos bytes decodificados da chave, truncado aos primeiros 16 caracteres hexadecimais. A comparação foi feita dentro do processo; o conteúdo da chave e os valores candidatos não foram emitidos.

O teste confirmou convivência simultânea: os processos usaram caminhos `userData` distintos, recuperaram a mesma chave e não alteraram o `Local State` de origem, os dois destinos, o perfil anterior ou o arquivo original da chave.

## Isolamento e segurança da execução

- `DB_DIR` foi removido do ambiente do processo de prova.
- A fronteira SQLite foi substituída por um sentinel que falha se invocada; o resultado confirmou `databaseFallbackInvoked: false`.
- Backend, `TefManager` e NativeHost não foram carregados.
- `DESTAXA_REAL_TRANSACTION_ENABLED=0`.
- A chave permaneceu somente em memória durante a prova e foi removida do ambiente antes do encerramento do processo.
- Não houve inicialização do app completo, banco, migração, sincronização financeira, NativeHost, DLL, V$Pague ou PinPad.

## Validações executadas

- `node --test tests\tef\mrt-50-38-contexto-criptografico.test.js` — **PASS**, incluindo repetição após o bloqueio fail-closed.
- `node --check` nos seis arquivos JavaScript de implementação/teste — **PASS**.
- Hashes do arquivo original da chave, da origem preservada, do perfil compartilhado anterior e dos dois destinos conferidos após a execução — **inalterados**.

## Classificação final e limite

**PASS** nos critérios de perfil persistente, contexto validado, provisionador real, recuperação da chave original, fingerprint, reinicialização, ausência de geração/fallback, convivência independente e preservação dos originais.

O startup completo do ERP/PDV não foi executado, conforme o escopo que proíbe inicializar backend/banco durante a prova. A integração de startup foi validada estaticamente e os caminhos de falha foram ajustados para bloquear o backend; a inicialização operacional completa permanece fora desta homologação.
