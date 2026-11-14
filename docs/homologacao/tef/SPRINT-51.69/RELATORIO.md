# SPRINT 51.69 — Matriz de prontidão para certificação Destaxa

**Data:** 2026-11-13  
**Tipo:** auditoria técnica e documental, somente leitura  
**Projeto:** CDS Sistemas  
**Integração:** DLL Destaxa 1.83 / V$PagueClient  
**Formulário alvo:** Destaxa - Certificação - Roteiro de Testes  
**Parecer:** **NÃO PRONTO**

Nenhuma operação financeira foi executada. DLL, NativeHost, V$Pague e COM4 não foram inicializados. Gates, banco, vendas e código de produto não foram alterados. Nenhum contador comercial foi criado.

A existência de código, de teste automatizado ou de uma venda histórica não é homologação formal.

---

## 1. Resumo executivo

O CDS já conduz **CRT de débito** pela DLL 1.83, com comprovantes persistidos, e já protege o cancelamento com permissão `cancelar_tef`, senha administrativa e auditoria. Isso não preenche o roteiro.

O repositório documenta **duas** operações de débito aprovadas (NSU 2338 / venda 66 e NSU 2348 / venda 67), ambas com autorização 211139 e comprovantes de 1057 caracteres. O roteiro do teste 01 pede **cinco** vendas aprovadas e confirmadas, com via do estabelecimento e via do cliente. O enunciado desta sprint cita ainda NSU 2349 / venda 68 no banco `dados-BC STORES1`. Esse registro **não aparece** nos artefatos do repositório, e o banco histórico **não foi aberto**. Mesmo que essa terceira operação exista, a cota de cinco continua aberta.

Crédito, PIX Destaxa, estorno comercial, pré-autorização, captura, reimpressão TEF e coleta de CPF pela operação `CPF` não têm caminho real habilitado. O adapter real só aceita `CRT`, e a política de homologação ainda restringe esse CRT a débito de R$ 1,00.

O texto do formulário que separa teste obrigatório de opcional **não está no repositório**. O `leia-me.txt` do pacote aponta um Forms externo; o conteúdo não foi lido nesta sprint. Por isso a coluna Obrigatoriedade fica **NÃO LOCALIZADA** nos 25 itens. O parecer não depende dessa separação: o teste 01, que o próprio roteiro descreve com cota de cinco vendas, já impede o envio.

### Sequencial (Sprint 51.68)

**NÃO IDENTIFICADO NO CONTRATO DE ENTRADA DESTAXA 1.83 — ESCLARECIMENTO DO FORNECEDOR PENDENTE SOBRE O ROTEIRO DE CERTIFICAÇÃO.**

A entrada CRT documentada é `transacao_pagamento`, `transacao_tipo_cartao` e `transacao_valor`. `transacao_nsu` e `transacao_nsu_rede` são identificadores devolvidos. `nativeSeq` é IPC interno. `sequencial` e `coletaSequencial` pertencem ao protocolo DLL ↔ V$PagueClient. Não há comprovação de contador comercial diário nem da regra de início em zero. Nenhum contador foi implementado.

### Proteção administrativa (Sprint 51.67)

Permissão `cancelar_tef` no catálogo, sem concessão automática. Middleware `exigirPermissaoOuSenhaAdmin` na rota de cancelamento. Auditoria da decisão antes do serviço. O PDV pede senha só depois do desafio `403`. O requisito 08 **não** está homologado em ambiente real: falta evidência visual. A suíte legada `tests/tef/tef-17-cancelamento-destaxa.test.js` permanece pendente de configuração por `TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO` (`backend/services/tef/tefReconciliationEvidence.js`). Esta sprint não reexecutou testes. O arquivo `tests/tef/tef-51-67-protecao-admin-cancelamento.test.js` contém **16** casos aninhados; o enunciado da 51.67 registra **22** aprovados.

---

## 2. Critério das contagens

Não há percentual único de prontidão. As contagens abaixo usam critérios diferentes de propósito.

| Pergunta | Critério | Resultado |
| --- | --- | --- |
| Testes no roteiro listado | Os 25 itens do enunciado | 25 |
| Obrigatórios / opcionais | Marca explícita no texto do formulário, dentro do repositório | **NÃO LOCALIZADA** / **NÃO LOCALIZADA** |
| Implementação que cobre o requisito | O cenário do item pode ser executado pelo caminho Destaxa atual, se gate e hardware existirem | **3** — 01, 08, 15 |
| Parcial | Há mapeamento, UI ou política, e o cenário do roteiro não fecha | **13** — 03, 04, 05, 06, 07, 09, 13, 14, 18, 19, 20, 21, 25 |
| Sem implementação do requisito | Não há fluxo Destaxa para o cenário | **9** — 02, 10, 11, 12, 16, 17, 22, 23, 24 |
| Suíte automatizada do comportamento central | Teste de código que exercita o item ou o bloqueio deliberado desse item | **5** plenos — 01, 04, 05, 08, 15. Outros são indiretos ou ausentes |
| Evidência real que satisfaz o item | Execução no ambiente com o resultado que o roteiro pede | **0** itens completos. O 01 tem evidência histórica **insuficiente** para a cota de cinco |
| Dependência documental | Texto do fornecedor ausente e necessário para decidir o item | Sequencial comercial e a marca obrigatório/opcional. O EST tem exemplos no pacote 1.83 que a política CDS ainda trata como não documentados |
| Dependência de hardware | PinPad, QR no PinPad ou falha física para demonstrar o item | 01, 02, 03, 04, 06, 13, 14, 15, 18, 21, 25. PIX/QR (05, 07, 16, 17) dependem antes de implementação |
| Execução financeira autorizada | Precisa de CRT, EST, PIX, crédito, débito ou desfazimento real, fora desta sprint | 01–07, 09–21 e 25. O 08 pode ser mostrado no caminho de recusa, sem habilitar EST. 22–24 não têm fluxo a autorizar |
| Bloqueio para enviar o formulário | Impede declarar o roteiro cumprido | Cota de cinco débitos; crédito, PIX Destaxa, estorno, pré-autorização e reimpressão TEF sem evidência; separação obrigatório/opcional desconhecida; sequencial sem resposta do fornecedor; dados cadastrais da empresa não preenchidos aqui |
| Pendência que código futuro pode tratar | Sem contar homologação ao vivo | Pré-datado, parcela e financiador, `multi_transacao`, operação PIX, EST, PRE/captura, CPF, reimpressão TEF, timeouts de QR. A lista `OPERACOES_REAIS_PERMITIDAS = ['CRT']` e o bloqueio de estorno são decisões vigentes, não defeitos corrigidos nesta sprint |

---

## 3. Matriz dos 25 testes

Obrigatoriedade de todos: **NÃO LOCALIZADA** no material local. Não foi inferida.

| Nº | Requisito | Implementação | Testes automatizados | Evidência real | Classificação | Pendência | Próxima ação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Débito | CRT débito implementado. Homologação real só aceita débito R$ 1,00 | Suítes CRT, inclusive `mrt-50-73-crt-literal-debito.test.js` | Duas vendas documentadas no repositório. Cota do roteiro: cinco. NSU 2349 não localizado nos artefatos | DEPENDENTE DE HOMOLOGAÇÃO REAL | Quatro aprovações confirmadas ainda não evidenciadas no repositório | Sessões autorizadas pelo PO, com as duas vias do comprovante |
| 02 | Débito pré-datado | Literal `Pré-datado` aceito só se o chamador o enviar. O mapper de débito força `A vista` | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Fluxo de venda pré-datada | Não inventar campo. Decisão de produto antes de código |
| 03 | Crédito à vista | Mapper: `Credito` + `A vista`. Adapter real recusa o que não for débito de homologação | Mapper de crédito coberto de forma parcial; aprovação **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | Gate de homologação e ausência de venda aprovada | Não tratar mapeamento como venda aprovada |
| 04 | Crédito parcelado | `parcelas > 1` gera `Parcelado`. Não envia `transacao_parcela` nem `transacao_financiado` | `mrt-50-73`: crédito 3x → `Credito` + `Parcelado` | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | Estabelecimento versus administradora não mapeado | Esclarecer o campo com o pacote de exemplos antes de implementar |
| 05 | PIX | `pix_tef` resolve para `PIX` e o adapter recusa | `tef-ppc930-10-pix-http422.test.js` afirma a lista `['CRT']` | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | PIX Destaxa bloqueado de propósito | Não alterar `OPERACOES_REAIS_PERMITIDAS` sem decisão |
| 06 | Vários cartões | PDV tem pagamento misto débito+crédito. DLL não recebe `multi_transacao` | **NÃO LOCALIZADA** para o modo multi-transação Destaxa | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | UI não é homologação Destaxa | Confirmar se o roteiro exige `multi_transacao=1` |
| 07 | Cartão + PIX | UI `pix_debito` e `pix_credito`. O PIX do PDV chama `/pix/criar-cobranca`, não a operação Destaxa `PIX` | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | Composição atual não é TEF Destaxa misto | Não executar cobrança. Separar PIX CDS de PIX DLL |
| 08 | Credencial de cancelamento | Middleware, permissão, auditoria e diálogo de senha no PDV | 16 casos em `tef-51-67-protecao-admin-cancelamento.test.js`. Suíte legada `tef-17` pendente de segredo | Evidência visual **NÃO LOCALIZADA** | IMPLEMENTADO E TESTADO EM CÓDIGO | Homologação real do requisito não declarada | Registrar tela de senha e a recusa sem EST |
| 09 | Estorno de cartão | `estornoComercialHabilitadoNoCds = false`. `finalizaTransacaoDestaxa(9)` aborta a transação corrente e não estorna venda aprovada | Política coberta em `tef-17`; execução da suíte legada pendente do segredo | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | EST não executa | Não habilitar estorno comercial |
| 10 | Estorno de PIX | Sem operação real de PIX e sem estorno comercial | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | PIX e estorno PIX indisponíveis em ambiente real | Não considerar disponível |
| 11 | Pré-autorização | Operação `PRE` existe no contrato 1.83 e há checkbox de configuração. Nenhuma chamada Destaxa | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Checkbox não inicia `PRE` | Não marcar o formulário por causa da tela de configuração |
| 12 | Captura de pré-autorização | Sem fluxo de captura | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Depende do 11 | Não implementar nesta sprint |
| 13 | Vários cartões e encerramento do sistema | Idempotência e recuperação existem para uma transação. Não há cenário multi-cartão com processo morto | Testes de idempotência não simulam esse roteiro | **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | Estado multi-cartão não persistido como o roteiro pede | Não interromper processo real |
| 14 | Vários cartões e queda de rede | Queda de rede vira `UNKNOWN` sem retry, para uma transação | Indireto, via política de rede | Queda Partner Cloud na MRT-50.75 é outra falha, não este item | PARCIALMENTE IMPLEMENTADO | Sem multi-cartão | Não derrubar rede nesta auditoria |
| 15 | Timeout na leitura do cartão | Código `08` e timeout de continuidade ficam `UNKNOWN`, `retryAllowed: false` | `mrt-38`, `mrt-40`, `tef-destaxa-51-05` | Timeouts históricos de PinPad existem em log; não são o item preenchido do formulário | IMPLEMENTADO E TESTADO EM CÓDIGO | Falta demonstração guiada no PinPad | Timeout não é aprovação, recusa, cancelamento nem inexistência |
| 16 | Timeout de QR Code | Sem operação PIX real | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | QR Destaxa não habilitado | Não habilitar PIX |
| 17 | Cancelar leitura de QR | Sem operação PIX real | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Idem 16 | Idem |
| 18 | Falha de PinPad | Estado `PINPAD_NOT_DETECTED` e erro de leitura em logs históricos | Preparação de PinPad; falha no meio da leitura **NÃO LOCALIZADA** como suíte do roteiro | Logs de COM4/PinPad não substituem o item do formulário | PARCIALMENTE IMPLEMENTADO | Demonstração com PinPad indisponível | Não abrir COM4 nesta sprint |
| 19 | Falha com o Client | `F1` cai em erro e estado financeiro `UNKNOWN` | Suíte nomeada do `F1` **NÃO LOCALIZADA** | **NÃO LOCALIZADA** como item de formulário | PARCIALMENTE IMPLEMENTADO | Demonstração com Client parado | Não iniciar V$Pague |
| 20 | Falha de conectividade | Erro de rede → `UNKNOWN`, sem retry | Testes de host offline / rede | MRT-50.75: TLS sobe e o peer corta o Identificar. Não é venda concluída | PARCIALMENTE IMPLEMENTADO | Item de formulário ainda não executado como roteiro | Preservar `UNKNOWN` |
| 21 | Venda negada | `03`, `04` e `09` → `CONFIRMED_DENIED`, sem retry | Política coberta em testes de classificação | MRT-50.74 foi `09` por timeout de Partner Cloud, não negativa da adquirente com comprovante | PARCIALMENTE IMPLEMENTADO | Uma negativa real da rede, com as vias se o Client as devolver | Não repetir CRT |
| 22 | Reimprimir o último comprovante | `DestaxaRealAdapter` herda `reimprimirComprovante` não suportado. Cupom fiscal da venda não é reimpressão TEF | **NÃO LOCALIZADA** | Comprovantes gravados na venda; reimpressão Destaxa **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Origem TEF persistida não tem comando de reimpressão na DLL de quatro funções | Não alterar registros |
| 23 | Reimprimir comprovante específico | A rota `/transacao/:id/reimprimir` chama o mesmo método não suportado | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Idem 22, por id | Não alterar registros |
| 24 | Coleta de CPF | Operação `CPF` está na tabela 1.83. Nenhuma chamada no CDS | **NÃO LOCALIZADA** | **NÃO LOCALIZADA** | NÃO IMPLEMENTADO | Sem transmissão de CPF pela DLL | Não executar operação fiscal nem financeira |
| 25 | Venda e desfazimento imediato | `finalizaTransacaoDestaxa(9)` desfaz a transação corrente. Não é estorno de venda já aprovada | Distinção coberta na política TEF-17 | Confirmação `finaliza(0)` da NSU 2338 na sprint 51.47. Desfazimento imediato de venda aprovada **NÃO LOCALIZADA** | PARCIALMENTE IMPLEMENTADO | O roteiro pede desfazimento, não a confirmação que já ocorreu | Não tratar `confirmacao=9` como estorno comercial |

---

## 4. Evidências por teste

### 01 — Débito

Contrato: `iniciaTransacaoDestaxa` com `operacao=CRT` e entrada `transacao_valor`, `transacao_tipo_cartao=Debito`, `transacao_pagamento=A vista` (`destaxaProtocolo.js`, `buildCrtInput` e `mapearFormaPagamentoCrt`).

Travas do caminho real, em `DestaxaRealAdapter.prepararAutorizacao`:

- `OPERACOES_REAIS_PERMITIDAS` é só `CRT` (`destaxaConstantes.js`).
- Valor de homologação fixo em 100 centavos.
- `validarContextoHomologacaoDebito` aceita apenas `cartao_debito` e `debito`.

Evidência no repositório, não reconsultada em banco nesta sprint:

| Operação | NSU | Autorização | Venda | Comprovantes |
| --- | --- | --- | --- | --- |
| TX 3 | 2338 | 211139 | 66 | 1057 / 1057 (`SPRINT-51.50`, `SPRINT-51.56`) |
| TX 4 | 2348 | 211139 | 67 | 1057, distintos da TX 3 (`SPRINT-51.53`, `SPRINT-51.56`) |

A sprint 51.47 registrou uma `finalizaTransacaoDestaxa(0)` da NSU 2338. Isso confirma uma operação já aprovada. Não cria as cinco vendas do roteiro.

NSU 2349, autorização associada e venda 68 no banco `dados-BC STORES1`: citadas no enunciado da 51.69; **não localizadas** em `docs/homologacao`. Banco não aberto.

### 03 e 04 — Crédito

`mapearTipoCartaoCrt` devolve `Credito`. Com `parcelas > 1`, `mapearFormaPagamentoCrt` devolve `Parcelado`; caso contrário, `A vista`. `Pré-datado` não sai desse mapper.

`tests/tef/mrt-50-73-crt-literal-debito.test.js` afirma crédito em 3 parcelas como `transacao_tipo_cartao=Credito` e `transacao_pagamento=Parcelado`.

O exemplo C da DLL envia também `transacao_parcela` e `transacao_financiado=Estabelecimento`. O CDS não envia esses dois campos. Não há venda de crédito aprovada localizada.

O adapter real recusa a modalidade antes da DLL, pela política de homologação só débito.

### 05 e 07 — PIX

`DestaxaRealAdapter._resolverOperacao`: tipo `pix_tef` vira `OPERACOES.PIX`. Em seguida `prepararAutorizacao` recusa porque a operação não está em `['CRT']`. Teste: `tests/tef/tef-ppc930-10-pix-http422.test.js`.

No PDV, `iniciarPixAutomaticoPDV` chama `POST /pix/criar-cobranca`. Pagamento misto `pix_debito` / `pix_credito` em `frontend/pdv/js/pdv.js` usa a forma `pix` desse fluxo. Isso é cobrança PIX do CDS, não a operação `PIX` da DLL. Nenhum dos dois foi executado nesta sprint.

### 06, 13 e 14 — Vários cartões

`abrirPagamentoMisto` oferece `debito_credito`, além de combinações com dinheiro e PIX. Não há `multi_transacao` na montagem de `iniciaClientDestaxa`. A documentação 1.83 (`02-usando-a-dll-fluxo-multi-transacao.md`) exige esse modo para várias transações na mesma venda, confirmadas juntas. Sem ele, a DLL não aceita outra transação antes de confirmar a anterior.

Idempotência e recuperação de **uma** transação existem em `TefManager`. Não há teste nem log do roteiro “vários cartões + processo encerrado” ou “vários cartões + rede caída”.

### 08 — Credenciais

- Catálogo: `backend/middleware/auth.js`, permissão `cancelar_tef`.
- Rota: `backend/rotas/tef.js`, `autorizarCancelamentoTef`.
- Auditoria: `gravarAuditoria` no `onDecision`, antes do serviço.
- PDV: `cancelarVendaAtual` em `frontend/pdv/js/pdv.js` só chama `solicitarSenhaAdministrador` quando a resposta é 403 com `requer_senha_admin`.
- Teste de código: `tests/tef/tef-51-67-protecao-admin-cancelamento.test.js`.
- Configuração pendente da suíte antiga: segredo de reconciliação ausente ou inválido. Não é falha do middleware.

Falta fotografia ou gravação da tela para a certificadora. O requisito não está homologado em ambiente real.

### 09, 10 e 25 — Cancelar, estornar, desfazer

`destaxaCancelamentoPolitica.js`:

- Operação de estorno no contrato: `EST`.
- `estornoComercialHabilitadoNoCds: false`.
- Motivo gravado: campos de entrada de EST tratados como não documentados na tabela do `docs/06`.
- `finalizaTransacaoDestaxa(9)` é aborto da transação corrente e pode ser recusado pelo Client com `99`.

Os exemplos C, C# e Java do pacote 1.83 enviam, no estorno, `transacao_data`, `transacao_nsu` e `transacao_valor`. O docx da biblioteca descreve estorno com data e NSU já guardados. A política CDS é mais restrita que esses exemplos e **permanece bloqueada**. Esta sprint não habilita estorno.

`cancelarPagamento` do `DestaxaRealAdapter` devolve a política segura e não chama a DLL.

Timeout de cancelamento permanece inconclusivo (`financialState: UNCHANGED` na política). Não vira estorno confirmado.

### 11 e 12 — Pré-autorização e captura

`OPERACOES.PRE` está em `destaxaConstantes.js`, alinhado à tabela do `docs/06` (“Cartão Pré-Autorizacao”). A tela `frontend/erp/js/configuracao_tef.js` tem checkbox `preAutorizacao`, persistido em configuração TEF. Não há chamada `iniciaTransacaoDestaxa` com `PRE` nem fluxo de captura. Classificação: não implementado.

### 15 a 21 — Falhas e recusa

`classificarCodigoFinanceiro` em `tefFinancialSafetyPolicy.js`:

| Código / condição | Estado financeiro | Novo retry |
| --- | --- | --- |
| `00` | `CONFIRMED_SUCCESS` | não |
| `03`, `04`, `09` | `CONFIRMED_DENIED` | não |
| `08` e timeout de transporte | `UNKNOWN` | não |
| `F1` e códigos desconhecidos | `UNKNOWN` | não |
| erro de rede | `UNKNOWN` | não |
| `99` | `PENDING` | não, até a ação pedida |

Timeout não é promovido a aprovação, recusa, cancelamento nem inexistência. O `09` da MRT-50.74 foi cancelamento pelo Client depois do corte com o Partner Cloud; a MRT-50.75 afastou o sequencial inválido como causa. Isso não é uma “venda negada” de certificadora com comprovante de negativa.

### 22 e 23 — Reimpressão

`TefManager.reimprimir` localiza a transação e chama `adapter.reimprimirComprovante`. `BaseAdapter.reimprimirComprovante` responde `suportado: false`. `DestaxaRealAdapter` não substitui o método. A DLL 1.83 expõe só `iniciaClient`, `iniciaTransacao`, `continua` e `finaliza`. Não há função de reimpressão nessa interface.

Os comprovantes de 1057 caracteres estão persistidos nas transações aprovadas. Reimprimir o cupom fiscal ou não fiscal da venda, em `fiscalImpressao.js`, é outro documento. Não prova reimpressão TEF Destaxa.

### 24 — CPF

`docs/06` define a operação `CPF` (“Usar pinpad para solicitar digitação do CPF”). O exemplo C chama essa operação com `coleta_pinpad_formato`. Busca no código TEF do CDS não encontrou chamada a `OPERACOES.CPF`.

---

## 5. Dados para o formulário

### Preenchíveis com o que o código e os relatórios mostram

| Campo | Valor evidenciado | Fonte |
| --- | --- | --- |
| Nome da aplicação enviado à DLL | CDS Sistemas | `destaxaConstantes.js` `APLICACAO`; logs `aplicacao=CDS Sistemas` |
| Versão efetiva | 1.0.3 | `package.json`; entrada `versao=1.0.3` |
| Linguagem | JavaScript (Node.js) | código do backend e do PDV |
| Framework | Electron | `package.json` `main` e scripts `electron` |
| Sistema da estação auditada | Windows 10 (10.0.19045) | ambiente desta auditoria. Não é declaração do parque do cliente |
| Modalidade de integração | DLL nativa 1.83, carregada por processo NativeHost, IPC `cds-tef-native-host/1`. O CDS não fala o protocolo `sequencial` do Client | `DestaxaNativeHost`, `destaxaNativeHostProtocolo.js` |
| Caminho de desenvolvimento da DLL | `resources/tef/destaxa/win-x64/libdll-integracao-tef.dll` | `destaxaDllResolver.js`; sprint 51.35 |
| Arquitetura | x64, processo x64 | log `1.83 64bit - Windows 64-bit` e sprint 51.35 |
| Versão Destaxa | 1.83 | pacote `1_83` e o mesmo log |
| Inicialização | `versao`, `aplicacao`, `nivel_log=1`, `diretorio_trabalho=C:\CDS-SISTEMAS\logs\destaxa`, `nome_arquivo_log=destaxa-dll.log`, `tam_max_log=10`, `total_bkp_log=5` | `destaxaDllLogConfig.js` |
| Estabelecimento, loja, terminal | Opcionais em `iniciaClientDestaxa`. O CDS não inventa código | `destaxaMapeamentoTerminal.js` |
| Gate | Só o literal `DESTAXA_REAL_TRANSACTION_ENABLED=1` libera TX. Último registro de sprint (51.63): OFF. Processo vivo não foi relido | `destaxaConstantes.js` `transacaoRealHabilitada` |

### A cargo do responsável pela empresa

CNPJ, razão social, nome fantasia, e-mail, telefone e qualquer dado pessoal. Não foram presumidos. Códigos de estabelecimento, loja e terminal que a Destaxa tiver cadastrado também ficam com o responsável, se o formulário os pedir.

---

## 6. Dependências externas

- Texto do Forms “Destaxa - Certificação - Roteiro de Testes”, para marcar obrigatório e opcional.
- Resposta da Destaxa sobre sequencial comercial no roteiro, se o formulário perguntar um número diário. O contrato de entrada 1.83 não o define.
- PinPad e V$PagueClient já instalados, para qualquer demonstração futura. Não foram acionados aqui.
- Partner Cloud: a MRT-50.75 deixou a falha de Identificar pendente de fornecedor. Isso não foi retestado.
- Autorização explícita do PO para cada CRT, crédito, PIX, EST ou desfazimento futuro.

---

## 7. Operações reais ainda exigidas

Para o teste 01, o roteiro pede cinco débitos aprovados e confirmados, com as duas vias. O repositório sustenta duas. A terceira citada no enunciado não foi conferida no banco.

Ainda sem evidência real localizada: crédito à vista, crédito parcelado pelo estabelecimento, crédito parcelado pela administradora, PIX Destaxa, venda com mais de um cartão na DLL, cartão mais PIX Destaxa, estorno de cartão, estorno de PIX, pré-autorização, captura, timeouts e falhas no formato do formulário, venda negada pela adquirente, reimpressão TEF, CPF no PinPad pela operação `CPF`, e desfazimento imediato depois da aprovação.

O item 08 precisa de evidência visual, não de uma nova cobrança, se a demonstração parar na credencial e na recusa do EST.

---

## 8. Ordem recomendada

1. Obter o texto do formulário e a resposta sobre sequencial comercial. Não criar contador enquanto isso não existir no contrato.
2. Não enviar o formulário como certificação concluída.
3. Se o PO autorizar, completar a cota de débitos confirmados, com as duas vias, sem reaproveitar a mesma venda como se fossem cinco.
4. Registrar em vídeo ou captura a validação administrativa do cancelamento, sem ligar o estorno comercial.
5. Decidir, em sprint futura, crédito e a diferença estabelecimento/administradora. O mapeamento atual não basta.
6. Decidir PIX Destaxa à parte do PIX de cobrança já existente no PDV. Não alargar `OPERACOES_REAIS_PERMITIDAS` sem essa decisão.
7. Só então avaliar `multi_transacao`, EST com os campos dos exemplos oficiais, pré-autorização, CPF, reimpressão e os testes de falha no hardware.

Nenhuma dessas correções foi implementada nesta sprint.

---

## 9. Parecer

**NÃO PRONTO**

O conjunto listado não pode ser declarado certificado. O único cenário com venda real documentada no repositório é o débito, e a quantidade encontrada não alcança as cinco operações do teste 01. Os demais itens obrigatórios possíveis do formulário — crédito, PIX, estorno, falhas e reimpressão — ou estão bloqueados de propósito, ou não têm implementação, ou não têm evidência real. A separação entre obrigatório e opcional continua desconhecida, e o sequencial comercial continua sem definição no contrato de entrada.
