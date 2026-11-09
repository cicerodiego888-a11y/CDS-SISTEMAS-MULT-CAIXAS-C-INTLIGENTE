# MRT-50.37 — Recuperação do contexto original da chave TEF

**Classificação final: CASO A — CONTEXTO ORIGINAL RECUPERADO**

Foi encontrada uma cópia do `Local State` associada ao perfil `erp-official` da validação MRT-50.25. A mesma cópia, preservada como `shared-user-data` na MRT-50.28, permitiu descriptografar a cópia somente leitura da chave original em processos Electron independentes. O valor recuperado passou a validação de 64 caracteres hexadecimais; somente um fingerprint SHA-256 truncado foi registrado.

O diretório físico original do perfil ERP que produziu o `Local State` não foi registrado nos relatórios anteriores. Portanto, o contexto criptográfico foi identificado por seus bytes e por sua cópia de origem preservada, mas não é possível afirmar o caminho histórico original em `%APPDATA%`.

## Escopo e método

- Busca delimitada a relatórios MRT-50 anteriores, ao perfil CDS atual, aos artefatos temporários nomeados MRT-50.25 e MRT-50.28 e aos perfis ERP/PDV desses testes. Não houve varredura indiscriminada do disco.
- Foram inventariados **16 caminhos de `Local State`**, com **15 hashes únicos**. Os 13 perfis sob `CDS-MRT-50.25-validation` eram perfis de diagnóstico; os dois caminhos `erp-official` e MRT-50.28 `shared-user-data` têm os mesmos bytes.
- Cada teste usou uma cópia isolada do `Local State` candidato e uma cópia do `.tef-signing-key.v1` com atributo `ReadOnly`. O harness mínimo usou Electron **22.3.27**, pacote de teste com identidade `cds-sistemas`, sem carregar o app CDS, backend ou provisionador.
- O harness leu a cópia do armazenamento, chamou `safeStorage.isEncryptionAvailable()` e `safeStorage.decryptString()`, validou o formato da chave e calculou o fingerprint. Não imprimiu o conteúdo recuperado, ciphertext, tokens ou conteúdo do `Local State`.
- `DB_DIR` ficou ausente e `DESTAXA_REAL_TRANSACTION_ENABLED=0`. Não houve abertura de SQLite, criação de banco ou acesso ao backend.

## Inventário e resultado

Horários em UTC; todos os arquivos listados tinham 389 bytes. Os resultados `PASS` significam disponibilidade do SafeStorage, descriptografia concluída e chave recuperada validada como 64 caracteres hexadecimais. Os demais resultados falharam na etapa `decrypt`, embora `isEncryptionAvailable()` tenha retornado `true`.

| Perfil/caminho completo de `Local State` | Modificado (UTC) | SHA-256 | Associação / resultado |
|---|---|---|---|
| `C:\Users\cicer\AppData\Roaming\cds-sistemas\Local State` | `2026-08-16T22:40:57.6278382Z` | `13802BFFD3FBC2B77E861FD4999E5C49EA57AA5003A5F6132EAC06ED90B66AD0` | Perfil CDS compartilhado atual; origem histórica desconhecida. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-crypto-direct\Local State` | `2026-11-06T04:40:19.7447412Z` | `7D18E0B3E9D4B4A3E46811141CDF974BCA7E78C988CAF3C31EA977F0615F13DF` | Perfil ERP de diagnóstico. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-debug\Local State` | `2026-11-06T04:14:25.7411130Z` | `6CFB5BFD720DE50BEF04805F37A7ACF2AD46A5440D819019E4F289EF34757461` | Perfil ERP de diagnóstico. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-inspector\Local State` | `2026-11-06T04:22:41.2355212Z` | `813989CA479885D878D685AC5D8D77514CC461AEAD2002D30644DEEA03414010` | Perfil ERP de diagnóstico. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-official\Local State` | `2026-11-06T04:46:05.6804368Z` | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Cópia do contexto ERP associada à origem pela evidência MRT-50.28. **PASS** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-restart\Local State` | `2026-11-06T04:08:42.9592727Z` | `F4512ED2C4A010A94EE4D91742703965FE1C39CE3E208A09B81F8F52779B219D` | Perfil ERP de teste de reinício. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\erp-restart-confirmed\Local State` | `2026-11-06T04:18:31.7555108Z` | `40E1BE4282933D1E774075E340276F0120AAA35E4CDBE3094BE15E18EB7451B7` | Perfil ERP de teste de reinício. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-debug\Local State` | `2026-11-06T04:19:23.5294539Z` | `185F599139942E969AC79476CD5544CDF58C7091C5D8BA6DD898A65B80C5B935` | Perfil PDV de diagnóstico. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-first\Local State` | `2026-11-06T04:09:33.2026376Z` | `954D84B6CE6D9939D15689E5698AD3112C27A7C8BE530DD690812B09DF831E2E` | Perfil PDV de teste inicial. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-first-local\Local State` | `2026-11-06T04:18:36.7176796Z` | `15E206D26B2511F3861D58411739E1E584B43AA1950807D551943E945AC43BA6` | Perfil PDV de teste local. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-inspector\Local State` | `2026-11-06T04:38:19.8800593Z` | `1D98BE7697ABDD666F6DDDDB235D020B66F167B4DCA7A0EBE88DAC0FF240789C` | Perfil PDV de diagnóstico. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-official\Local State` | `2026-11-06T04:52:47.6717305Z` | `FCBC87DA3F67F23DC43477ACB7C3E73B798E9035045AC6C6F32AA04687CE212A` | Perfil PDV da validação. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-restart\Local State` | `2026-11-06T04:09:43.6918003Z` | `33D0B05AC6C180554E2E4FBA0541A4606C7AC42E20AEC9427E37866DED555C04` | Perfil PDV de teste de reinício. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181\profiles\pdv-restart-local\Local State` | `2026-11-06T04:18:41.6668644Z` | `6E1295010EF89ADAE98EA79ED89A15F036A9053CA77AF94A635B1E1D3DE9EE2F` | Perfil PDV de teste de reinício. **FAIL** |
| `C:\Users\cicer\AppData\Local\Temp\MRT-50.28-55588f5de1754bfba45515e616f36dcb\shared-user-data\Local State` | `2026-11-06T04:46:05.6804368Z` | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | Cópia MRT-50.28 do contexto ERP de origem; bytes iguais a `erp-official`. **PASS** |
| `C:\Users\cicer\AppData\Local\Temp\MRT-50.28-55588f5de1754bfba45515e616f36dcb\fresh-shared-user-data\Local State` | `2026-11-06T13:12:03.5288109Z` | `ED0B71B7CB83512D899C8DF5B11C1F79793B68BF6BCB356D8B7D062921466B73` | Perfil compartilhado recém-criado na MRT-50.28, não o perfil de origem. **FAIL** |

As demais subpastas de perfis MRT-50.28 inventariadas (`appdata-ERP`, `appdata-PDV`, `appdata-shared`, perfis ERP/PDV separados e diretórios de teste) não continham outro arquivo chamado `Local State`. Não foi localizada uma cópia de perfil em backup nos diretórios CDS específicos examinados.

## Teste de recuperação e comparação entre processos

- Runtime: `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\node_modules\electron\dist\electron.exe`; versão verificada como **v22.3.27**. Os executáveis instalados ERP e PDV também constam como 22.3.27 nos metadados anteriores, mas não foram iniciados.
- Candidato recuperado: cópia isolada do `Local State` de `erp-official`, SHA-256 `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040`.
- **Processo A:** `safeStorage.isEncryptionAvailable() = true`; `decryptString()` passou; formato `64-hex`; fingerprint SHA-256 truncado `1c6d56245ac4e501`.
- **Processo B independente:** reutilizou a mesma cópia isolada de contexto e a mesma cópia da chave; resultado **PASS** e fingerprint idêntico `1c6d56245ac4e501`.
- A reprodução adicional usando a cópia `MRT-50.28\shared-user-data` também passou em dois processos independentes, com o mesmo fingerprint.
- Perfil CDS atual e os outros perfis de diagnóstico testados: SafeStorage disponível, mas falha em `decryptString()`. O harness registrou apenas classe `Error` e estágio; nenhum HRESULT nativo foi fornecido.
- O resultado reproduz a evidência histórica da MRT-50.28: a cópia do `Local State` ERP de origem abre o armazenamento original, ao contrário dos perfis separados/novos.

## Integridade, limites e segurança

| Arquivo | Antes | Depois | Resultado |
|---|---|---|---|
| Original `C:\ProgramData\MercantilFiscal\dados\.tef-signing-key.v1` | SHA-256 `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167`; 191 bytes | Mesmo SHA-256 e tamanho | **Inalterado** |
| Cópia somente leitura entregue ao harness | Mesmo SHA-256 do original | Mesmo SHA-256 | **Inalterada** |
| Cópias-fonte dos `Local State` candidatos | Hashes da tabela | Hashes inalterados após os testes | **Inalteradas** |

- Nenhum banco foi aberto ou criado; a verificação do diretório isolado encontrou **zero arquivos `.db`**.
- Não foram iniciados ERP/PDV completos, backend, provisionador, NativeHost, DLL Destaxa, V$Pague ou PinPad.
- Nenhuma transação TEF, ação financeira ou evento fiscal foi executado. Nenhuma transmissão à SEFAZ ocorreu.
- `DESTAXA_REAL_TRANSACTION_ENABLED` foi `0`; `DB_DIR` ficou ausente.
- Não houve alteração de `electron-common.js`, `tefSigningKeyProvisioner.js`, chave original ou `Local State` de origem.
- As cópias isoladas da chave e dos perfis, logs do harness e o próprio harness temporário foram removidos após a coleta dos resultados.
- A validação ERP/PDV foi feita em processos Electron mínimos com identidade `cds-sistemas`, não iniciando os executáveis empacotados. Assim, não comprova o fluxo completo de bootstrap dos pacotes, que foi expressamente proibido nesta sprint.
- O caminho físico original do perfil que originou o `Local State` não aparece nos registros preservados; o que foi identificado e comprovado é a cópia dos bytes de contexto que permite recuperar a chave.

## Próxima ação recomendada

Preservar o `.tef-signing-key.v1` original e a cópia recuperada do `Local State` com acesso restrito. Qualquer restauração operacional do contexto deve ocorrer em procedimento separado, previamente autorizado, com backup e verificação de integridade; não substituir o perfil em `%APPDATA%` nem modificar a chave durante esta sprint.

## Referências anteriores

- [MRT-50.25 — Instalação e validação](../build/MRT-50.25-INSTALACAO-VALIDACAO.md)
- [MRT-50.27 — Teste controlado SafeStorage no PDV](../build/MRT-50.27-TESTE-CONTROLADO-SAFESTORAGE-PDV.md)
