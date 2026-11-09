# MRT-50.27 — Teste controlado safeStorage no PDV instalado

## Resultado

**Falha localizada na descriptografia do armazenamento protegido.** No processo instalado do PDV, `safeStorage` estava disponível, o arquivo copiado foi lido e sua estrutura passou; porém, `safeStorage.decryptString()` lançou uma exceção. O provisionador converteu a falha em `TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU`, não disponibilizou `TEF_ENCRYPTION_KEY`, e o `cryptoService` no mesmo processo retornou `TEF_CRYPTO_KEY_UNAVAILABLE`.

O estágio está comprovado. A causa nativa específica da rejeição (por exemplo, o motivo interno do provedor de proteção do sistema operacional) permanece desconhecida: a exceção direta de `decryptString()` não forneceu `code`, e o provisionador deliberadamente a substitui por uma mensagem genérica.

## Preparação isolada e integridade

- Executável utilizado: [CDS PDV.exe](<C:/Users/cicer/AppData/Local/Programs/CDS-MRT-50.25-PDV/CDS PDV.exe>), Electron **22.3.27**, aplicativo instalado **1.0.3**.
- Processo executado sob o mesmo contexto de conta Windows da sessão de instalação; o identificador da conta não foi incluído no relatório.
- O arquivo original `.tef-signing-key.v1` foi copiado sem alteração para `C:\Users\cicer\AppData\Local\Temp\MRT-50.27-PDV-12ed699f80664306837e8478f79eb6e5\isolated-db`.
- SHA-256 do original antes da execução e da cópia antes da execução: `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167`. A cópia manteve o mesmo SHA-256 após o teste.
- `DB_DIR` apontou somente para o diretório isolado; o ambiente foi iniciado sem `TEF_ENCRYPTION_KEY` herdada e com `DESTAXA_REAL_TRANSACTION_ENABLED=0`.
- Nenhum banco oficial foi copiado, aberto ou modificado. A chamada ao provisionador encontrou o arquivo existente e falhou na descriptografia antes do ramo que consulta evidências persistidas. O Electron criou um `mercadao.db` temporário durante o teste; ele e quaisquer arquivos auxiliares temporários foram preservados.

## Resultados por etapa

| Etapa | Resultado |
|---|---|
| `app.whenReady()` | **PASS** — `app.isReady()` retornou verdadeiro. |
| Disponibilidade de `safeStorage` | **PASS** — `safeStorage.isEncryptionAvailable()` retornou verdadeiro. |
| Processo e conta | **PASS** — processo PID `22860`, Electron `22.3.27`, mesmo contexto Windows herdado; nenhum identificador pessoal exposto. |
| Leitura da cópia | **PASS** — leitura do arquivo concluída. |
| Estrutura do armazenamento | **PASS** — JSON válido com campos esperados, versão `1`, algoritmo `electron-safeStorage` e ciphertext não vazio. Nenhum conteúdo do ciphertext foi exibido. |
| `safeStorage.decryptString()` | **FAIL** — lançou `Error`; sem código nativo disponível. Categoria observada: falha de descriptografia do safeStorage. Nenhuma chave foi recuperada. |
| Provisionador no PDV | **FAIL** — executado no mesmo processo e contra o diretório isolado; código `TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU`; mensagem técnica: “Não foi possível recuperar a chave TEF com a proteção do sistema operacional.” A validação da chave/evidências não foi concluída. |
| Variável após provisionador | **FAIL** — `TEF_ENCRYPTION_KEY` ausente e sem formato válido; o provisionador removeu a variável no tratamento de erro. |
| `cryptoService` | **FAIL** — carregado no mesmo PID; viu a variável ausente e retornou `TEF_CRYPTO_KEY_UNAVAILABLE`. |
| Cifra/decifra sintética | **NÃO EXECUTADO** — bloqueado pela falha de provisionamento; não foi gerado ciphertext sintético. |
| NativeHost / gate | **PASS** — NativeHost não foi invocado; gate explicitamente `0`. |

O startup do próprio PDV também registrou `TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU`. Na validação explícita subsequente, o mesmo código foi retornado pelo provisionador, confirmando a etapa sem depender apenas do estado do consumidor.

## Diagnóstico

O problema não está na disponibilidade de `safeStorage`, na leitura do arquivo, na estrutura JSON, na ausência de chamada ao provisionador nem em propagação entre processos: a chamada ocorreu e o consumidor estava no mesmo PID. A falha acontece antes da validação da chave, dentro de `safeStorage.decryptString()` ao tentar abrir a cópia byte a byte idêntica ao arquivo produzido pelo ERP.

O teste confirma incompatibilidade de descriptografia do armazenamento protegido do ERP no contexto Electron do PDV observado, mesmo sob o mesmo contexto de conta Windows. Não determina a razão interna do provedor (por exemplo, contexto de proteção ou perfil Electron); a API expôs apenas uma exceção genérica. Não se deve gerar ou substituir a chave como tentativa de contorno.

## Limites e preservação

- Não foram iniciados ERP ou PDV contra o banco oficial.
- Não houve cópia, leitura ou modificação do banco oficial; a cópia utilizada foi somente o arquivo protegido da chave.
- Não foram realizadas transações, testes fiscais, builds ou instalações.
- Nenhum NativeHost, child process TEF, DLL, V$Pague ou PinPad foi iniciado.
- O processo de teste encerrou e as portas locais de diagnóstico foram fechadas. O diretório temporário e o banco SQLite temporário foram preservados conforme solicitado.
- Nenhum arquivo de implementação foi alterado e nenhum commit foi criado. Este relatório é o único arquivo criado nesta sprint.

## Referências

- [MRT-50.25-INSTALACAO-VALIDACAO.md](./MRT-50.25-INSTALACAO-VALIDACAO.md): hashes e resultado anterior do PDV.
- [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L80): descriptografia, mapeamento do erro e validação.
- [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L316): disponibilidade do safeStorage e caminho do arquivo existente.
- [tefSigningKeyProvisioner.js](../../backend/services/tef/tefSigningKeyProvisioner.js#L438): remoção da variável ao falhar.
- [cryptoService.js](../../backend/services/crypto/cryptoService.js#L18): erro `TEF_CRYPTO_KEY_UNAVAILABLE`.
