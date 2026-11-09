# MRT-50.58 — Revalidação das evidências e baseline TEF

**Resultado: BASELINE VALIDADA**

Gerado em 2026-11-07T19:18:00Z. Execução somente leitura, sem NativeHost, sem carga da DLL, sem `iniciaClientDestaxa()`, sem PinPad, sem banco, sem transação e sem documento à SEFAZ. A MRT-50.57 não foi executada. Os estados UNKNOWN das MRT-24, MRT-36 e MRT-42 não foram alterados.

Diretório novo: `docs/homologacao/tef/MRT-50.58-20261107T191330Z`. Nenhum relatório anterior foi sobrescrito.

## 1. Perfil ERP

Marcador lido em `C:\Users\cicer\AppData\Roaming\cds-sistemas-erp\.cds-tef-crypto-context.json`.

| Campo | Valor |
| --- | --- |
| Módulo | `erp` |
| Nome | `cds-sistemas` |
| Versão do marcador | `1` |
| Caminho | `C:\Users\cicer\AppData\Roaming\cds-sistemas-erp` |
| Provisionado em | `2026-11-06T21:58:20.337Z` |
| SHA-256 declarado do Local State | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` |

O `Local State` original tem 389 bytes, mtime `2026-11-06T21:58:20.3159786Z`, SHA-256 `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040`. O hash coincide com o marcador e com o contexto validado na MRT-50.37. O marcador em si tem SHA-256 `AE1854015EE634865EFA93FD774DDC4A6E1EC491089BF22CCFDD30A61467388C`.

Depois da sonda, tamanho, mtime e hash do `Local State` e do marcador permaneceram os mesmos. A listagem recursiva do perfil original não mudou.

## 2. Chave original e Local State

Arquivo `C:\ProgramData\MercantilFiscal\dados\.tef-signing-key.v1` presente, 191 bytes, mtime `2026-11-06T04:45:56.0456672Z`, SHA-256 `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167`. É o mesmo hash registrado na MRT-50.38. O arquivo não foi substituído, regenerado nem recriptografado. O conteúdo não foi impresso.

Recuperação em memória com Electron `22.3.27` e `safeStorage`:

- `safeStorage.isEncryptionAvailable()` verdadeiro
- `decryptString()` concluído
- formato `64-hex` válido
- fingerprint SHA-256 truncado dos bytes da chave: `1c6d56245ac4e501`
- compatível com o fingerprint da MRT-50.37
- nome do app na sonda: `cds-sistemas`
- gate do processo da sonda: `0`
- NativeHost não iniciado, DLL não carregada, banco não aberto

O hash do arquivo da chave depois da sonda permaneceu `875ECF8A…`.

## 3. userData isolado

Caminho efetivo usado pela sonda:

`C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\docs\homologacao\tef\MRT-50.58-20261107T191330Z\isolated-userdata\cds-sistemas-erp`

O perfil original `C:\Users\cicer\AppData\Roaming\cds-sistemas-erp` não foi o destino de escrita. A listagem recursiva anterior e posterior é idêntica. A primeira tentativa de Electron, presa antes de `app.ready`, foi encerrada sem gravar nesse perfil; o V$Pague permaneceu no mesmo PID.

Associação: o `Local State` do snapshot e a cópia selada em `sealed\Local State` têm o mesmo SHA-256 do original, `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040`. O `app.getPath('userData')` devolveu o caminho isolado.

## 4. DLL Destaxa 1.83 x64

Candidata instalada, lida por hash e cabeçalho PE, sem `LoadLibrary`:

`C:\Program Files\CDS ERP\resources\app.asar.unpacked\resources\tef\destaxa\win-x64\libdll-integracao-tef.dll`

| Campo | Valor |
| --- | --- |
| Versão de recurso | `1.83 64bit` |
| PE machine | `0x8664` (AMD64) |
| Tamanho | `136782` |
| SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |

O mesmo hash está na cópia do repositório, na instalação PDV e nas instalações MRT-50.25 ERP/PDV. Também é o hash do pacote em `destaxaBinarios.js` e em relatórios anteriores de empacotamento. Isso comprova a identidade desta cópia com o pacote 1.83 x64 já medido. Não comprova a execução MRT-50.54.

## 5. Comparação com a MRT-50.54

Não foi encontrado artefato, relatório ou hash medido da MRT-50.54 no repositório, em `ProgramData`, em `Temp`, nas instalações locais, em Documentos, na Área de Trabalho nem nos projetos do Cursor.

**A identidade da DLL da MRT-50.54 não pode ser confirmada.** A DLL atual fica estabelecida como nova referência. Não se afirma que ela seja idêntica à DLL daquela execução.

## 6. V$Pague

Observado, sem iniciar, encerrar ou modificar.

| Campo | Valor |
| --- | --- |
| Processo | `VSPagueClient.exe` |
| PID | `44484` |
| PPID | `33800` (imagem do pai não estava enumerável) |
| Executável | `C:\VBI\Java\bin\VSPagueClient.exe` |
| Jar | `C:\VBI\V$Pague\Client\V$PagueClient.jar` |
| Java separado | nenhum `java.exe` ou `javaw.exe` |
| 60603 | `Listen` em `::`, PID `44484` |
| 60906 | `Listen` em `::`, PID `44484` |

O processo Java associado é o próprio `VSPagueClient.exe`: o binário fica em `C:\VBI\Java\bin` e a linha de comando executa o jar com `-h app-partner.destaxa.cloud -p 60410 -atv server -tls`.

## 7. Gate financeiro

`DESTAXA_REAL_TRANSACTION_ENABLED` está ausente no ambiente de usuário e no ambiente de máquina. O gate só liga com o valor `1`. Estado observado: **OFF**. A sonda forçou `0` apenas no próprio processo e não habilitou transação.

## 8. Pendências para a próxima execução

1. Criar uma raiz isolada nova. O bootstrap recusa diretório que já exista; esta pasta de evidência não pode ser reutilizada como `--mrt53-root`.
2. Usar o hash `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` como referência nova da DLL. Não usá-lo como prova de continuidade com a MRT-50.54.
3. Manter o gate financeiro OFF até haver autorização explícita de transação.
4. A chamada nativa, o NativeHost e `iniciaClientDestaxa()` continuam pendentes. Não disparar a MRT-50.57 nem outra chamada nativa automaticamente.
