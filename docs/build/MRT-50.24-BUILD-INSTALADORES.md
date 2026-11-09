# MRT-50.24 — Build e validação dos instaladores ERP/PDV

## Resultado

**BUILD APROVADO** — os dois instaladores foram gerados em um diretório isolado e seus ASARs passaram pela validação de integridade e inspeção estática. Nenhum aplicativo foi instalado ou iniciado.

## Builds

- **ERP:** sucesso. CDS ERP **1.0.3**, Windows x64, Electron 22.3.27, electron-builder 25.1.8.
  - Instalador: [CDS-ERP-Setup-1.0.3.exe](../../dist/mrt-50-24-20261106T033400Z/erp/CDS-ERP-Setup-1.0.3.exe)
  - Tamanho: **89.625.555 bytes**
  - SHA-256: `5E30B095E3BF82F4A4D579DB35730BD8D2E76065A574EE9F05632FD8E3C8A122`
  - ASAR: `dist/mrt-50-24-20261106T033400Z/erp/win-unpacked/resources/app.asar`
- **PDV:** sucesso. CDS PDV **1.0.3**, Windows x64, Electron 22.3.27, electron-builder 25.1.8.
  - Instalador: [CDS-PDV-Setup-1.0.3.exe](../../dist/mrt-50-24-20261106T033400Z/pdv/CDS-PDV-Setup-1.0.3.exe)
  - Tamanho: **89.625.396 bytes**
  - SHA-256: `60A2AA5E275543194F08709A2316315A8597C8F84D4602E4082FB4E3557C281D`
  - ASAR: `dist/mrt-50-24-20261106T033400Z/pdv/win-unpacked/resources/app.asar`

## Inspeção dos pacotes

- O `afterPack` confirmou **1.949 arquivos** por pacote: frontend 273, backend 1.646, Electron 15 e recursos 15; zero divergências.
- As DLLs Destaxa passaram pelas verificações de presença, tamanho e SHA-256 do empacotador. Nenhuma DLL foi carregada ou chamada.
- Cada ASAR contém 8.276 entradas. Foram encontrados o provisionador, serviço criptográfico, serviço de evidências, consumidores TEF, hidratador fiscal, `electron-common.js` e manifesto.
- Os manifestos internos identificam corretamente seus módulos (`erp`/`pdv`) e a versão `1.0.3`.
- A inspeção estática confirmou que os dois pacotes têm o mesmo `electron-common.js` (SHA-256 `567320269e6292a7c55b6176d915f2e4d52d8cf455791837e0e9b0223fed9da5`) e o mesmo provisionador (SHA-256 `ce2d7d69ef86a8c7622dfdb408f396452e66e9bf78f587efa2c35ca01692198f`).

## Verificações criptográficas

- O provisionador é chamado antes de `require('./backend/server')` nos dois caminhos de inicialização presentes em cada pacote.
- ERP e PDV usam o mesmo `DB_DIR` e o mesmo nome de armazenamento `.tef-signing-key.v1`; por padrão, o diretório é `C:\ProgramData\MercantilFiscal\dados`. Assim, sob a mesma conta Windows e com o mesmo `DB_DIR`, compartilham o mesmo armazenamento, sem subdiretório por módulo.
- O serviço AES exige `TEF_ENCRYPTION_KEY` explicitamente e rejeita a chave fixa de desenvolvimento por meio da regra compartilhada com o serviço de evidências. A inspeção encontrou a constante somente no módulo de rejeição; não encontrou fallback TEF funcional nem o antigo fallback `TEF_TOKENIZATION_KEY`.
- O build removeu `TEF_ENCRYPTION_KEY` do ambiente do processo empacotador. Nenhum valor de chave foi incluído nos instaladores.
- `DESTAXA_REAL_TRANSACTION_ENABLED` foi mantido em `0` durante os builds.
- Um indicador genérico de “chave de desenvolvimento” existe em `backend/config/secrets.js` para JWT; não é fallback de chave TEF.

## Preservação e limites

- Os artefatos preexistentes em `dist/erp` e `dist/pdv` foram preservados. Os scripts que limpam essas pastas ou todo `dist` não foram executados.
- `electron-manifest.json` foi gerado temporariamente para cada módulo e restaurado byte a byte; os fingerprints dos manifestos antes e depois coincidem.
- O empacotador recompilou as dependências nativas `sqlite3` e `usb`. Não iniciou Electron, NativeHost, V$Pague ou DLL; não acessou banco, não executou transações nem eventos fiscais.
- Os instaladores não foram instalados. O log informa que a assinatura foi ignorada por ausência de configuração/identidade de assinatura; os arquivos gerados não devem ser considerados assinados digitalmente.
- Não foram executadas suítes de teste adicionais: as validações necessárias foram o build, o `afterPack` e a inspeção estática dos ASARs.

