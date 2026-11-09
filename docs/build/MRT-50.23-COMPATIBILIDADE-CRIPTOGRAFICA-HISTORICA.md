# MRT-50.23 — Compatibilidade criptográfica histórica

## Classificação

**SEM DADOS HISTÓRICOS AFETADOS — evidência suficiente nos bancos e backups inventariados.**

A conclusão se baseia na contagem direta das tabelas e campos criptografados do banco oficial de testes e do backup SQLite disponível. Não foi inferida pela ausência ou impossibilidade de identificar uma chave.

## Escopo e método

- Banco oficial: `C:\ProgramData\MercantilFiscal\dados\mercadao.db`.
- Backup SQLite: `C:\ProgramData\MercantilFiscal\dados\backups\backup_pdv_2026-09-01_10-38-40.db` e sua cópia `.db.gz`.
- Conexões SQLite abertas com `mode=ro` e `PRAGMA query_only=ON`; foram executadas somente consultas de esquema e agregações `SELECT`.
- A inspeção de conteúdo limitou-se a contagens, presença de campos e classificação do formato AES. Nenhum PAN, token, payload, chave ou valor de campo foi selecionado para exibição.
- Os arquivos de backup sob o caminho padrão do serviço (`backups\tef`) não existem. Também não há `TEF_BACKUP_DIR` definido nos escopos de ambiente Process, User ou Machine examinados.

## Inventário estático dos consumidores

- [tefRepository.js](../../backend/services/tef/tefRepository.js) cifra `tef_transacoes.payload_retorno`, `comprovante_cliente` e `comprovante_estabelecimento`.
- [tefBackupService.js](../../backend/services/tef/tefBackupService.js) cifra o objeto completo de backup em arquivos `.enc`; o caminho padrão é `backups\tef`.
- [cardTokenizationService.js](../../backend/services/crypto/cardTokenizationService.js) cifra número, validade e, quando informado, nome do portador; persiste o objeto em `tef_tokens_cartao.dados_criptografados`.
- [tefPendenciasService.js](../../backend/services/tef/tefPendenciasService.js), [tefAdapterCiclo.js](../../backend/services/tef/tefAdapterCiclo.js) e [destaxaContinuidadePersistencia.js](../../backend/services/tef/destaxa/destaxaContinuidadePersistencia.js) leem `payload_retorno` de transações.
- [tefPagamentoHydrator.js](../../backend/services/fiscal/tefPagamentoHydrator.js) aceita `tef_payload_retorno`; essa coluna não existe no esquema `venda_pagamentos` do banco inspecionado.
- [tefReconciliationService.js](../../backend/services/tef/tefReconciliationService.js) importa `cryptoService`, mas não há chamada de criptografia ou descriptografia no arquivo.
- [cryptoService.js](../../backend/services/crypto/cryptoService.js) mantém o formato AES-256-CBC `IV hexadecimal:ciphertext hexadecimal`. Esse formato, isoladamente, não identifica a chave usada.

## Contagens observadas

### Banco oficial de testes

- `tef_transacoes`: **0 linhas**; `payload_retorno`, `comprovante_cliente` e `comprovante_estabelecimento`: **0 valores não vazios**, **0** no formato AES legado.
- `tef_tokens_cartao`: **0 linhas**. Tabela legada `tef_tokens`: **0 linhas**.
- `tef_backups`: **0 registros**.
- `venda_pagamentos`: 76 linhas; `tef_transacao_id`, `tef_comprovante_cliente` e `tef_comprovante_estabelecimento`: **0 valores não vazios**.
- `tef_logs`: 1 linha, tipo `ERRO_GENERICO`; `payload` e `hash_integridade` não vazios. O payload não corresponde ao formato AES legado. Não há eventos `TEF_RECONCILIACAO_LIBERADA` nem `TEF_RECONCILIACAO_COMMIT_CONFIRMADO`.

### Backup SQLite disponível

- `tef_transacoes`, `tef_tokens_cartao`, `tef_tokens`, `tef_backups`, `tef_conciliacao` e `tef_conciliacoes`: **0 linhas**.
- Os três campos criptografados de `tef_transacoes` e os campos TEF de `venda_pagamentos`: **0 valores não vazios**.
- `tef_logs`: **0 linhas**.
- A descompressão do `.db.gz` produziu a mesma fingerprint SHA-256 do arquivo `.db`; portanto, não representa um segundo estado de dados distinto.

### Arquivos de backup

- Na pasta autorizada `dados\backups` existem um `.db` e seu `.db.gz`, além dos arquivos auxiliares SQLite observados após a abertura. Não há arquivo TEF `.enc`.
- O diretório padrão `backups\tef` não existe; não foi encontrado override `TEF_BACKUP_DIR` nos escopos de ambiente examinados.

## Chave e recuperabilidade

- O armazenamento TEF protegido `.tef-signing-key.v1` não existe em `C:\ProgramData\MercantilFiscal\dados`.
- `TEF_ENCRYPTION_KEY` não estava definido nos escopos Process, User ou Machine examinados.
- Existe um arquivo chamado `mbc-secret-store.key` (64 bytes). Seu conteúdo não foi lido, não há referência a esse nome no código do repositório e, portanto, não há evidência para classificá-lo como chave TEF.
- Não foi localizado ciphertext TEF nos campos persistidos ou backups inventariados que exigisse a chave antiga. Assim, não foi necessária nem realizada descriptografia de registros.
- Se ciphertext legado for encontrado em outra cópia ou caminho não inventariado, a ausência de uma chave TEF persistida impede confirmar sua leitura; o formato AES não permite inferir a chave. Nenhuma chave substituta foi gerada.

## Integridade do banco durante a inspeção

Não foram executados `INSERT`, `UPDATE`, `DELETE`, migrações ou operações financeiras. Após a abertura do backup `.db` em modo SQLite somente leitura, foram observados os arquivos auxiliares `backup_pdv_2026-09-01_10-38-40.db-shm` (32 KiB) e `backup_pdv_2026-09-01_10-38-40.db-wal` (0 bytes), que não apareciam na listagem inicial. Não os removi para evitar uma escrita adicional na pasta autorizada. O arquivo principal do backup e o banco oficial não foram alterados por consultas SQL.

