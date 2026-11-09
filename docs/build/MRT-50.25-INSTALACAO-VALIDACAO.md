# MRT-50.25 — Instalação controlada e validação de inicialização TEF

## Classificação final: BLOQUEADO

ERP e PDV 1.0.3 foram instalados por usuário e iniciaram com o banco oficial de testes. O ERP criou o arquivo protegido da chave; o PDV preservou os mesmos bytes, mas a verificação de criptografia no processo do PDV falhou com `TEF_CRYPTO_KEY_UNAVAILABLE`. Portanto, a continuidade criptográfica e a disponibilidade do TefManager não foram comprovadas.

## Instalação e artefatos

As instalações existentes por máquina foram preservadas. Os instaladores MRT-50.24 foram verificados e usados em modo por usuário.

| Aplicação | Versão / Electron | Instalador e SHA-256 | Executável instalado |
|---|---|---|---|
| ERP | 1.0.3 / 22.3.27 | `CDS-ERP-Setup-1.0.3.exe` — `5E30B095E3BF82F4A4D579DB35730BD8D2E76065A574EE9F05632FD8E3C8A122` | [CDS ERP.exe](<C:/Users/cicer/AppData/Local/Programs/CDS-MRT-50.25-ERP/CDS ERP.exe>), 157.938.176 bytes; SHA-256 `12760AAE2A36EEC3C3AAF3495546852DDEE2095507CE793EAE14FA67E1769D83` |
| PDV | 1.0.3 / 22.3.27 | `CDS-PDV-Setup-1.0.3.exe` — `60A2AA5E275543194F08709A2316315A8597C8F84D4602E4082FB4E3557C281D` | [CDS PDV.exe](<C:/Users/cicer/AppData/Local/Programs/CDS-MRT-50.25-PDV/CDS PDV.exe>), 157.938.176 bytes; SHA-256 `B9FD611AEAFC5A6AF73A1633C8ED613AE5A918486EA54D65CCBDC16E2AD5BA88` |

Os hashes e tamanhos dos instaladores constam no [relatório MRT-50.24](./MRT-50.24-BUILD-INSTALADORES.md). Os dois aplicativos chegaram ao backend local e à tela de login.

## Validação criptográfica

- **ERP:** antes da inicialização, `.tef-signing-key.v1` não existia no diretório oficial. Após a inicialização, o arquivo existia (191 bytes), com estrutura `versao: 1`, `algoritmo: electron-safeStorage` e campo `ciphertext` de 128 caracteres. SHA-256: `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167`. O depurador expirou antes de devolver a prova de cifra/decifra e o estado do TefManager no ERP.
- **PDV:** após a inicialização, o hash do mesmo arquivo permaneceu `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167`. Isso comprova continuidade dos bytes do armazenamento, mas não que o PDV conseguiu descriptografá-lo.
- No processo instalado do PDV, a cifra sintética falhou antes de produzir ciphertext com `TEF_CRYPTO_KEY_UNAVAILABLE`. O serviço [cryptoService.js](../../backend/services/crypto/cryptoService.js) emite esse erro quando a chave não está disponível no ambiente do processo. O estado do TefManager não foi coletado diretamente; para fins de liberação, deve ser tratado como **INDISPONIVEL** até comprovação contrária.
- A disponibilidade de `safeStorage` no processo do PDV e a causa específica da ausência da chave em runtime não foram confirmadas. O formato protegido e a persistência do arquivo, isoladamente, não demonstram uma descriptografia bem-sucedida.
- O ambiente dos lançamentos foi criado sem `TEF_ENCRYPTION_KEY` herdada; o gate `DESTAXA_REAL_TRANSACTION_ENABLED` foi explicitamente definido como `0`. A chave não foi impressa nem enviada pelo harness.
- O provisionamento ocorre antes do `require('./backend/server')` em [electron-common.js](../../electron-common.js). O tratamento de falha exibe erro e continua a inicialização do backend; assim, chegar à tela de login não comprova disponibilidade do TEF. O serviço de criptografia não possui fallback utilizável e falha fechado.

## Banco oficial e alterações observadas

O banco autorizado foi `C:\ProgramData\MercantilFiscal\dados\mercadao.db`.

| Momento | SHA-256 do arquivo principal |
|---|---|
| Pré-inicialização | `E459517CF9DDCE228369127D76340D644DF0D97F9A9561288C95F6BEA9A20649` |
| Após inicialização do ERP | `A2FC38BBC05D124C7D15FF1D0D3681F6C0CAD113AC098A43058C08D8A4BE9587` |
| Após inicialização do PDV | `C39FD80BBFF8F84910F71C34DD1C89482FCA04E2071E364870C3C9049F7F858D` |

O arquivo principal mudou durante as inicializações normais. A contagem read-only posterior encontrou 8 vendas canceladas e zero registros financeiros não cancelados vinculados por venda ou referência, além de zero contas a receber não canceladas vinculadas. Não foi capturado snapshot por tabela antes de cada inicialização; portanto, não é possível atribuir integralmente as mudanças de hash a linhas específicas. A rotina de startup [VendaFinanceiroService.js](../../backend/services/vendas/VendaFinanceiroService.js) sincroniza o financeiro de vendas canceladas, e a inspeção anterior ao startup havia identificado 8 vendas elegíveis. Essa alteração potencial foi permitida pela sprint e fica registrada, mas sua quantidade exata de linhas alteradas não foi isolada.

## Limites e conclusão

- Nenhum teste automatizado foi executado.
- Nenhuma transação TEF, chamada a NativeHost/DLL/V$Pague, ação de PinPad ou comunicação financeira foi iniciada. Não foi encontrado processo com nome NativeHost, Destaxa ou V$Pague após as validações.
- Não foi confirmada a continuidade funcional da chave entre reinicializações. A chave persistida manteve o mesmo hash, mas a cifra sintética do PDV falhou.
- **BLOQUEADO:** não aprovar o ambiente nem avançar para validação física até explicar e corrigir a ausência de chave em runtime e comprovar `safeStorage`, cifra/decifra sintética e estado `DISPONIVEL` do TefManager nos dois aplicativos.

## Arquivos do repositório

Nenhum arquivo de implementação foi alterado nesta sprint. Este relatório é o único artefato novo; alterações preexistentes no worktree foram preservadas.
