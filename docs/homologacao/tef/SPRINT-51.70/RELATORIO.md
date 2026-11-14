# SPRINT 51.70 — Resolução das pendências contratuais Destaxa

**Data:** 2026-11-13  
**Tipo:** auditoria documental e técnica, somente leitura  
**Projeto:** CDS Sistemas  
**Pacote:** DLL Destaxa 1.83  
**Parecer:** o contrato esclarece CRT, PIX, CPF, multi-transação e a distinção entre estorno e `finalizaTransacaoDestaxa(9)`. EST está descrito, mas o formato da data não é único. PRE e captura não têm contrato suficiente. O sequencial comercial diário e a marca obrigatório/opcional dos 25 testes continuam sem fonte local.

Nenhuma operação financeira foi executada. DLL, NativeHost, V$PagueClient, COM4 e PinPad não foram inicializados. `DESTAXA_REAL_TRANSACTION_ENABLED` não foi alterado. Código de produção, banco, políticas e PDV não foram modificados. Esta sprint não certifica o CDS e não autoriza operação real.

---

## 1. Resumo executivo

A política CDS `estornoComercialHabilitadoNoCds = false` continua correta como bloqueio de execução. O comentário que trata os campos de EST como ausentes da documentação oficial está incompleto. `transacao_data`, `transacao_nsu` e `transacao_valor` aparecem como entrada de estorno nos exemplos C, C# e Java e nas seções 4 e 5 de `Documento DESTAXA.rtf`. A tabela de entrada de `docs/06` não lista esses três campos como entrada: nela, `transacao_nsu` e `transacao_data` são saída.

O mesmo material mostra três formatos de data: `2026-03-10` no fluxo rápido do RTF, `dd/MM/yy` na coleta do menu e no exemplo C, e `18/01/2025` nos exemplos C# e Java. Isso impede uma implementação segura de EST até a Destaxa fixar o formato.

`finalizaTransacaoDestaxa(9)` aborta a transação corrente. O RTF, seção 7, mostra que o Client pode responder `99` e exigir confirmação. Essa chamada não é o estorno comercial, que começa com `iniciaTransacaoDestaxa` na operação de estorno e termina com `finalizaTransacaoDestaxa(0)` depois do `00`.

PIX Destaxa é uma operação da DLL, com valor na entrada, QR Code na coleta e `txid` em `transacao_autorizacao`. O PDV gera cobrança por `POST /pix/criar-cobranca`. São mecanismos diferentes. O adapter reconhece `pix_tef` como `PIX` e a lista real recusa a operação.

PRE existe só como código `PRE` / “Cartão Pré-Autorização”. Não há parâmetros, tipos de cartão, identificador de captura nem exemplo. Captura de pré-autorização não aparece como operação.

CPF pela DLL está no RTF, seção 6: `coleta_pinpad_formato=1`, retorno de 11 dígitos em `informacao` e `finaliza(0)` só para encerrar a coleta. O CDS coleta CPF/CNPJ da nota em tela. Não chama a operação `CPF`.

`multi_transacao=1` está em `docs/05` e o fluxo em `docs/02`. Sem ele, a DLL não aceita outra transação antes de confirmar a anterior. `finaliza` confirma ou cancela todas juntas. O CDS não envia esse parâmetro.

Nenhum documento 1.83 examinada define sequencial comercial diário, início em zero, reinício diário, reinício de processo ou reconexão. `transacao_nsu` é gerado pelo V$Pague. `nativeSeq` é IPC do CDS. O sequencial do protocolo DLL ↔ Client e o `coletaSequencial` não são esse contador comercial.

O texto do formulário “Destaxa - Certificação - Roteiro de Testes” não está no pacote nem no repositório. O `leia-me.txt` só publica o endereço `https://forms.gle/g6g6JxYXHZEUX54T6`. A classificação obrigatório/opcional dos 25 testes permanece indisponível. Não foi inferida.

---

## 2. Fontes documentais examinadas

Pacote versionado `C:\Users\cicer\Desktop\DLL DESTAXA\1_83-20260831T165940Z-1-001\1_83`:

- `docs/00-introducao.md` a `docs/10-acoes-de-coleta.md`
- `docs/dll-integracao-tef.html`
- `examples/clang/src/main.c`, `destaxa_api.h`
- `examples/dotnet/Program.cs`, `Destaxa.cs`
- `examples/java/.../App.java`, `Destaxa.java`
- `leia-me.txt`, na pasta `DLL DESTAXA`

Documentos irmãos da pasta `DLL DESTAXA`, fora do diretório `1_83`:

- `Biblioteca de Integração Destaxa.docx`
- `Documento DESTAXA.rtf`

O markdown `docs/06` do pacote 1.83 não contém `transacao_parcela`, `transacao_financiado` nem `coleta_pinpad_formato`. O DOCX e o RTF contêm. As seções numeradas de fluxo, com tabelas de chamada, estão em texto no RTF. No DOCX, parte desses fluxos ficou em figura e só a legenda foi extraída. Onde os dois divergem do markdown 1.83, o relatório cita os dois.

Código confrontado, sem alteração:

- `backend/services/tef/destaxa/destaxaCancelamentoPolitica.js`
- `backend/services/tef/destaxa/destaxaConstantes.js`
- `backend/services/tef/destaxa/destaxaProtocolo.js`
- `backend/services/tef/destaxa/DestaxaNativeBridge.js`
- `backend/services/tef/destaxa/destaxaNativeHostProtocolo.js`
- `backend/services/tef/adapters/DestaxaRealAdapter.js`
- `frontend/erp/js/configuracao_tef.js`
- `frontend/pdv/js/pdv.js`
- `docs/homologacao/tef/SPRINT-51.69/RELATORIO.md`, como auditoria anterior, não como texto do formulário

---

## 3. Matriz contratual

| Modalidade | Documentação oficial | Implementação CDS | Situação |
| --- | --- | --- | --- |
| CRT | Operação `CRT`. Entrada mínima: `transacao_pagamento`, `transacao_tipo_cartao`, `transacao_valor`. DOCX/RTF acrescentam `transacao_parcela` e `transacao_financiado`. Saída inclui NSU, autorização, duas vias e data. Sequência: `iniciaClient`, `iniciaTransacao`, `continua` enquanto `99`, `finaliza(0)` ou `finaliza(9)`. | `buildCrtInput` envia valor, tipo e forma. Débito vira `A vista`. Crédito com mais de uma parcela vira `Parcelado`. Não envia `transacao_parcela` nem `transacao_financiado`. Caminho real só aceita `CRT`, e a homologação ainda restringe a débito de R$ 1,00. | PARCIALMENTE IMPLEMENTADO |
| EST | Operação `EST` = “Estorno de transação”. Exemplos e RTF seções 4 e 5 usam `transacao_data`, `transacao_nsu` e `transacao_valor`. A tabela de entrada do `docs/06` não lista esses campos. Formato da data diverge entre as fontes. | Constante `EST` existe. `estornoComercialHabilitadoNoCds = false`. Nenhuma chamada real monta esses campos. | DEPENDENTE DE CONFIRMAÇÃO DESTAXA |
| PRE | Só o código `PRE`, descrição “Cartão Pré-Autorização”, na tabela de operações do `docs/06`, do DOCX e do RTF. Sem parâmetros, sem exemplo e sem sequência própria. | Constante `PRE`. Checkbox “Pré-autorização” em `configuracao_tef.js`. Nenhuma chamada `iniciaTransacaoDestaxa` com `PRE`. | DEPENDENTE DE CONFIRMAÇÃO DESTAXA |
| Captura | Não há operação, parâmetro nem identificador de captura de pré-autorização. A palavra “captura” nos docs 01, 07 e 10 é coleta de digitação durante `continuaTransacaoDestaxa`. | Sem fluxo de captura. | NÃO DOCUMENTADO |
| PIX | Operação `PIX` = “Compra com PIX”. Exemplo envia `transacao_valor`. RTF seção 3: `99` com QR (`tipo=TXT;PNG;TXT`), depois `00` com NSU e comprovantes, depois `finaliza(0)`. `transacao_autorizacao` devolve o `txid`. `saida` sugerida de 99000 bytes por causa do QR. | `_resolverOperacao` mapeia `pix_tef` para `PIX`. `OPERACOES_REAIS_PERMITIDAS = ['CRT']` recusa a operação antes da DLL. O PIX do PDV chama `/pix/criar-cobranca`. | PARCIALMENTE IMPLEMENTADO |
| CPF | Operação `CPF`. DOCX/RTF: `coleta_pinpad_formato=1` é o fluxo atualizado. RTF seção 6 devolve `informacao` com 11 dígitos e encerra com `finaliza(0)`. Exemplos C#/Java ainda mostram `mensagem=CPFC+` após a coleta. | O PDV pede CPF/CNPJ da nota em tela. Não há chamada da operação `CPF`. | DOCUMENTADO, MAS NÃO IMPLEMENTADO |
| Multi-transação | `docs/05`: `multi_transacao` opcional, `1` permite e `0` não. `docs/02`: sem o modo, a DLL não aceita nova transação antes da confirmação da anterior. `docs/08`: `finaliza` confirma ou cancela todas; não escolhe uma. Códigos `A0` e `A1` tratam transações não confirmadas. | `montarEntradaClient` não envia `multi_transacao`. O PDV tem pagamento misto de interface. | DOCUMENTADO, MAS NÃO IMPLEMENTADO |
| Sequencial diário | Não há campo, gerador, início em zero, reinício diário, reinício de processo nem regra de reconexão. O único “sequencial” normativo é o NSU gerado pelo V$Pague. | `nativeSeq` conta chamadas IPC. O CDS não envia contador comercial. | DEPENDENTE DE CONFIRMAÇÃO DESTAXA |

---

## 4. Assinaturas e parâmetros documentados

### Funções da DLL

As quatro exportações, em `docs/04`, `docs/05`, `docs/06`, `docs/07` e `docs/08`:

```
void iniciaClientDestaxa(char *resultado, char *entrada, int tamanho_entrada);
void iniciaTransacaoDestaxa(char *resultado, const char *operacao, char *entrada, int tamanho_entrada, char *saida, int *tamanho_saida);
void continuaTransacaoDestaxa(char *resultado, char *entrada, int tamanho_entrada, char *saida, int *tamanho_saida);
void finalizaTransacaoDestaxa(char *resultado, int confirmacao);
```

`resultado` `"00"` é sucesso da API. `"99"` pede ação da automação. A tabela geral de `docs/09` vale para o parâmetro `resultado` de todas as funções. Não há tabela exclusiva de EST, PRE, PIX ou CPF.

| Código | Efeito descrito em `docs/09` |
| --- | --- |
| `00` | API executada com sucesso |
| `03` | Cancelada pelo operador |
| `04` | Cancelada pelo cliente |
| `05` | Dados insuficientes ou inválidos |
| `06` | Problema entre V$PagueClient e V$PagueServer |
| `07` | Problema entre V$PagueServer e a rede |
| `08` | Tempo limite excedido |
| `09` | Cancelada pelo Client |
| `99` | Client pede ação da automação |
| `FF` | Parâmetros inválidos |
| `F0` | Chamada em sequência inválida |
| `F1` | Erro de comunicação com o Client |
| `F2` | Erro interno da DLL |
| `FE` | Erro não identificado |
| `A0` | Uma ou mais transações não confirmadas; ver log |
| `A1` | Existem transações não confirmadas; confirmar ou cancelar antes de iniciar outras |

Os exemplos C, C# e Java tratam qualquer código diferente de `00` e de `99` como erro da chamada. A política financeira do CDS, fora desta sprint, continua classificando `08` e falha de transporte como resultado indeterminado. O pacote não diz que `08` seja aprovação, recusa ou inexistência.

### EST

Finalidade, pela tabela de operações: estorno de transação. Os exemplos nomeiam a operação `EST` (`TRANSACTION_PAYMENT_REVERSAL` / `PaymentReversal`).

Campos usados quando a automação já tem os dados:

| Campo | Onde aparece como entrada de estorno | Finalidade no texto |
| --- | --- | --- |
| `transacao_data` | C `main.c` `do_payment_reversal`; C# `DoPaymentReversal`; Java `App.java`; RTF seção 4; coleta do RTF seção 5 com `chave=transacao_data` | Data da transação original |
| `transacao_nsu` | Mesmas fontes; RTF seção 5 chama a coleta de “Numero do Documento” | NSU original |
| `transacao_valor` | Mesmas fontes; RTF seção 5, máscara `.##` | Valor da transação original |

Na tabela de saída de `docs/06` e do DOCX, `transacao_nsu`, `transacao_valor` e `transacao_data` descrevem o retorno de uma transação aprovada. A tabela de entrada do mesmo capítulo não os inclui. A regra geral desse capítulo diz que `entrada` não é obrigatória e que dado faltante volta como `99`. O RTF seção 5 confirma isso: a operação de estorno pode começar sem os três campos e coletá-los.

Formatos de data encontrados, todos em material oficial, sem uma frase que escolha um:

| Fonte | Valor |
| --- | --- |
| RTF seção 4 | `transacao_data=2026-03-10` |
| RTF seção 5 e máscara padrão de data em `docs/10` quando `tipo=D` | `dd/MM/yy`, exemplo `10/03/26` |
| Exemplo C | `transacao_data=18/03/25` |
| Exemplos C# e Java | `transacao_data=18/01/2025` |

Sequência do fluxo rápido, RTF seção 4:

1. `iniciaTransacaoDestaxa` com data, NSU e valor.
2. `99` pede `Sim` ou `Nao`.
3. `continuaTransacaoDestaxa` com `informacao=Sim`.
4. Mensagens de espera e de conclusão.
5. `00` com NSU de cancelamento e comprovantes de estorno.
6. `finalizaTransacaoDestaxa(0)`, retorno `00`, “Estorno confirmado”.

A mensagem de exemplo da seção 4 diz “O cancelamento do PIX foi concluido”. O fluxo usa os mesmos três campos. Não há outra operação chamada “estorno de PIX”.

Sequência do menu, RTF seção 5: inicia só a operação; coleta data, NSU e valor; pode pedir cartão (`transacao_cartao_numero`); pede `Sim`; chega a `CANCELAMENTO OK`; `00`; `finaliza(0)`.

Não há parâmetro extra de `iniciaClientDestaxa` exclusivo de EST.

`finalizaTransacaoDestaxa(9)`, `docs/08` e RTF seção 7, cancela a transação corrente. No exemplo, durante a espera do cartão, o retorno pode ser `99` com “CANCELAR / LER”. Depois da confirmação do aborto, o exemplo ainda chama `finaliza(0)`. Isso não localiza uma venda já aprovada por data e NSU.

Conclusão de EST: os campos e a sequência existem. O contrato ainda não é suficiente para implementar, porque o formato de `transacao_data` não está fechado e a tabela normativa de entrada do `docs/06` não lista os campos. O bloqueio do CDS permanece.

### PRE e captura

Assinatura da operação: o mesmo `iniciaTransacaoDestaxa`, com `operacao` `PRE`. Nenhum parâmetro próprio, tipo de cartão, diferença entre pré-autorização e captura, identificador para captura posterior, retorno específico ou configuração adicional foi localizado. O checkbox de configuração não inicia `PRE`.

### PIX Destaxa

Assinatura: `iniciaTransacaoDestaxa` com operação `PIX`. Entrada de exemplo: `transacao_valor`, maior que zero, duas casas e ponto, como no CRT. Sequência do RTF seção 3: `99` de espera, `99` com a string do QR, `99` de aprovada, `00` com NSU e comprovantes das duas vias, `finaliza(0)`. Na saída geral, `transacao_autorizacao` do PIX é o `txid` do PSP recebedor.

O adapter em `DestaxaRealAdapter._resolverOperacao` devolve `OPERACOES.PIX` para `pix_tef`. `prepararAutorizacao` recusa o que não está em `OPERACOES_REAIS_PERMITIDAS`, hoje só `CRT`. Não há execução Destaxa de PIX.

`iniciarPixAutomaticoPDV` em `frontend/pdv/js/pdv.js` envia `POST /pix/criar-cobranca`. Essa cobrança não é a operação `PIX` da DLL. Estorno de PIX Destaxa não tem operação própria; o único exemplo de devolução PIX está dentro do fluxo de cancelamento/estorno do RTF seção 4.

### CPF

Campo do fluxo novo, DOCX e RTF: `coleta_pinpad_formato=1` na entrada de `iniciaTransacaoDestaxa` com operação `CPF`. O RTF seção 6 não pede máscara na automação: o PinPad coleta, `continua` com entrada vazia devolve `informacao=53926584125` e `finaliza(0)` encerra a coleta. Onze dígitos, sem pontuação, nesse exemplo.

O exemplo C envia `coleta_pinpad_formato` e, se o retorno for `99`, pergunta se continua. Os exemplos C# e Java chamam `CPF` com entrada vazia, leem `informacao` e então enviam `mensagem=CPFC+` mais o CPF. O RTF chama a seção 6 de “Novo Fluxo” e não mostra `CPFC`. As duas variantes estão no material; a frase do DOCX diz que o valor `1` é necessário para o fluxo atualizado.

Não há frase dizendo que o CPF é obrigatório em toda venda. O fluxo é descrito como menu TEF / digitação segura no PinPad. O momento é uma transação `CPF` própria, com `inicia`, `continua` e `finaliza`, não um campo da entrada CRT.

O CDS não tem essa chamada. O diálogo “CPF/CNPJ na Nota” do PDV é dado fiscal da NFC-e. O item 24 do roteiro não pôde ser lido no formulário, então não se afirma que o item 24 seja exatamente esta operação. O que falta para a operação documentada é chamá-la com `coleta_pinpad_formato=1`, tratar `99`/`00` e guardar `informacao`, sem gravar isso como pagamento.

### Multi-transação

Ativação: `multi_transacao=1` na entrada de `iniciaClientDestaxa` (`docs/05`). Obrigatório: não. Efeito, `docs/02`: várias transações na mesma venda, por exemplo crédito, PIX e débito. Sem o modo, nova transação antes da confirmação da anterior não é permitida.

Encerramento, `docs/08`: um `finaliza(0)` confirma todas as pendentes; um `finaliza(9)` cancela todas. Não há parâmetro para escolher quais. Perda de confirmação: `A1` em `iniciaClient` pede confirmar ou cancelar antes de novas transações; o exemplo C chama `finaliza` quando recebe `A1`. `A0` indica confirmação incompleta e manda ver o log. `F1` e `08` continuam sendo falha de comunicação e tempo esgotado, sem uma regra multi específica além desses códigos.

`DestaxaNativeBridge.montarEntradaClient` projeta versão, aplicação, log e, quando existem, estabelecimento, loja e terminal. Não inclui `multi_transacao`. A interface de pagamento misto do PDV não liga esse modo.

### Sequencial

Quatro contadores, separados de novo nesta leitura:

| Contador | Quem gera | Onde é informado | O que o contrato 1.83 diz |
| --- | --- | --- | --- |
| NSU `transacao_nsu` | V$Pague, para uma rede em uma data | Saída da transação. Na entrada, só no estorno, para apontar a transação original | Não é contador diário da automação |
| `nativeSeq` | Host IPC do CDS | Mensagem interna `destaxaNativeHostProtocolo.js` | Não existe na DLL |
| `sequencial` do protocolo DLL ↔ V$PagueClient | DLL e Client, conclusão já registrada na Sprint 51.68 | Não é campo de `iniciaTransacaoDestaxa` | Não reexaminado em log nesta sprint; não está no contrato de entrada |
| `coletaSequencial` | Ciclo de coleta | Não é campo comercial da automação | Não é o sequencial do formulário |
| Sequencial comercial diário | Não identificado | Não há campo de entrada | Não há regra de zero, de dia, de processo nem de reconexão |

Não foi criado contador.

---

## 5. Comparação entre documentação e código

| Ponto | Documento | Código atual |
| --- | --- | --- |
| CRT débito | `A vista`, `Debito` ou `Débito`, valor com ponto | Mapper força débito em `A vista`. Homologação real só R$ 1,00 |
| CRT parcelado | DOCX/RTF: `transacao_parcela` e `transacao_financiado` = Estabelecimento ou Administradora | `buildCrtInput` envia `Parcelado` e não envia parcela nem financiador |
| EST | Exemplos e RTF seções 4 e 5 | Política bloqueia. Comentário cita só `docs/06`, `docs/08` e `docs/04`, e afirma campos não documentados |
| `finaliza(9)` | Aborto da transação corrente, possivelmente recusado com `99` | `FINALIZACAO_CANCELAR = 9`, distinto de EST na política |
| PRE | Só o nome da operação | Checkbox de configuração |
| Captura | Ausente como operação | Ausente |
| PIX DLL | Operação `PIX`, QR e `txid` | Mapeado e recusado |
| PIX PDV | Não é a DLL | `POST /pix/criar-cobranca` |
| CPF PinPad | `coleta_pinpad_formato=1` | Não chamado |
| `multi_transacao` | `docs/02` e `docs/05` | Não enviado em `iniciaClient` |
| Sequencial comercial | Ausente do contrato de entrada | Ausente, de propósito |

---

## 6. Divergências encontradas

1. A política TEF-17 diz que os campos de EST não estão documentados. Os exemplos oficiais e o RTF os documentam. A tabela de entrada do `docs/06` realmente não os lista. As duas leituras vêm de partes diferentes do material. A execução continua bloqueada.
2. Data de EST: `yyyy-MM-dd`, `dd/MM/yy` e `dd/MM/yyyy` coexistem. Nenhuma frase escolhe o formato aceito na entrada direta.
3. O markdown 1.83 não traz `transacao_parcela`, `transacao_financiado` nem `coleta_pinpad_formato`. O DOCX e o RTF trazem. O pacote versionado e os documentos irmãos não estão alinhados.
4. CPF: o fluxo chamado de novo no RTF devolve o número e finaliza. C# e Java ainda enviam `mensagem=CPFC+`.
5. O exemplo rápido de estorno no RTF usa uma mensagem de “cancelamento do PIX” com os campos genéricos de estorno. Não há operação separada de estorno PIX na tabela.
6. `finaliza(9)` e a operação `EST` continuam sendo contratos diferentes. A sprint 51.69 já separava os dois. O RTF seção 7 confirma a separação.
7. PIX do PDV e PIX da DLL atendem nomes parecidos e contratos diferentes.
8. Pagamento misto na interface não é `multi_transacao=1`.

---

## 7. Requisitos do formulário oficial

O arquivo do roteiro não foi localizado no pacote 1.83, no DOCX, no RTF nem no repositório. O `leia-me.txt` informa:

- o parceiro deve executar os testes do Forms, de preferência em um único dia;
- limpar `C:\VBI\V$Pague\Client\logs\*.*` antes;
- enviar o log conforme as instruções do formulário;
- o endereço do Forms é `https://forms.gle/g6g6JxYXHZEUX54T6`.

O conteúdo do Forms não foi lido. Não há, no material local, a lista oficial dos 25 testes, a marca obrigatório ou opcional, a quantidade de operações, os valores, as modalidades, os comprovantes nem a regra de credencial de cada item.

A matriz de 25 linhas da Sprint 51.69 veio do enunciado daquela auditoria e de leitura de código. Ela não é o texto do fornecedor. Esta sprint não a repete como classificação oficial.

Pendência: pedir à Destaxa o export do formulário “Destaxa - Certificação - Roteiro de Testes”, com a coluna obrigatório/opcional visível.

---

## 8. Classificação dos 25 testes

**Indisponível.** Sem o formulário, nenhum dos 25 itens recebe marca obrigatório ou opcional. Inventar essa coluna a partir do código ou do relatório 51.69 violaria o critério desta sprint.

---

## 9. Pendências que dependem da Destaxa

1. Qual formato de `transacao_data` a entrada direta de EST aceita: `yyyy-MM-dd`, `dd/MM/yy` ou `dd/MM/yyyy`.
2. Se a tabela de entrada de uma revisão futura do `docs/06` passará a listar os três campos de EST, hoje presentes nos exemplos e no RTF.
3. Se PRE tem parâmetros, bandeiras permitidas e se existe captura com qual identificador. O material atual não fecha isso.
4. Se o fluxo de CPF exigido no roteiro é a seção 6 do RTF, e se `CPFC+` dos exemplos C#/Java ainda é necessário.
5. Se os testes de vários cartões exigem `multi_transacao=1` e o `finaliza` único do `docs/08`.
6. Quem gera o sequencial comercial diário, em qual campo ele entra, se começa em zero, se zera no dia, no processo ou na reconexão. O contrato de entrada 1.83 não responde.
7. O texto integral do roteiro, com obrigatório, opcional, quantidades, valores e evidências.

Enquanto essas respostas não chegarem, EST, PRE, captura e sequencial comercial não devem ser implementados por analogia.

---

## 10. Recomendações para as próximas sprints

1. Obter o formulário e só então reclassificar os 25 testes. Essa é a próxima sprint documental.
2. Pedir por escrito o formato de `transacao_data` e a confirmação de que EST usa exatamente os três campos do RTF. Não habilitar `estornoComercialHabilitadoNoCds` nessa espera.
3. Manter `finaliza(9)` apenas como aborto da transação corrente.
4. Manter `OPERACOES_REAIS_PERMITIDAS` em `CRT`. PIX Destaxa, PRE e CPF ficam para uma sprint posterior, cada um com o fluxo do RTF, e só se o formulário os marcar como necessários.
5. Se vários cartões forem obrigatórios, a implementação começa por enviar `multi_transacao=1` e por confirmar ou cancelar o grupo inteiro. A tela de pagamento misto não substitui isso.
6. Não criar sequencial diário. A resposta do fornecedor é condição.
7. Quando houver revisão de código, atualizar o comentário de `destaxaCancelamentoPolitica.js` para citar exemplos e RTF, sem mudar o bloqueio. Isso fica fora desta sprint.

---

## 11. Declaração

Nenhuma operação financeira foi executada. Não houve CRT, EST, PRE, captura, PIX Destaxa nem cobrança PIX Sicredi. A DLL não foi carregada. NativeHost e V$PagueClient não foram iniciados. COM4 e PinPad não foram acessados. Nenhum arquivo de produção, configuração, variável de ambiente ou banco foi alterado. O único arquivo criado é este relatório.
