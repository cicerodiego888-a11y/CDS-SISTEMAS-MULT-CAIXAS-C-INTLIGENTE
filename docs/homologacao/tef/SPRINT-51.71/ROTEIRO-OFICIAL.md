# Destaxa - Certificação - Roteiro de Testes

Transcrição do Google Forms aberto em 2026-11-13 na sessão já autenticada pelo Product Owner. Nada foi preenchido, selecionado ou enviado. A primeira página foi lida na tela. As seções seguintes foram lidas no conteúdo que o próprio formulário carregou, sem avançar e sem escolher modalidade.

Endereço: `https://docs.google.com/forms/d/e/1FAIpQLSe-IWXL4PBxS1rycs3ISPdRWbr7EMi_W4v7s2DYOw4WwSmBRA/viewform`

Título: Destaxa - Certificação - Roteiro de Testes

---

## Introdução

Texto original:

> Este documento tem como objetivo definir a sequência de testes necessários para garantir o correto funcionamento do sistema de automação comercial integrado com a Destaxa.
>
> Ele é destinado aos desenvolvedores responsáveis pela implementação do TEF Destaxa.
>
> Cada teste possui um passo a passo detalhado, que está descrito diretamente na questão correspondente no formulário. Certifique-se de seguir corretamente cada instrução, pois testes realizados de forma incorreta serão desconsiderados e precisarão ser refeitos.
>
> Abaixo, apresentamos um sumário com a lista de testes que devem ser realizados, organizados em duas categorias:
>
> ✔️ Testes obrigatórios → Devem ser executados em todas as integrações.
>
> 🟣 Testes opcionais → Recomendados, mas não obrigatórios, dependendo das funcionalidades utilizadas.
>
> 🔹 Importante: As instruções detalhadas para cada teste DENTRO DO FORMULÁRIO. Leia atentamente as descrições das questões para garantir que o teste seja feito corretamente.

O formulário avisa que o asterisco indica pergunta obrigatória para envio. Isso não é a mesma marca do sumário. Onde as duas divergem, as duas ficam registradas.

---

## Campos administrativos

Perguntas da primeira página, todas com asterisco:

| Campo | Tipo | Alternativas |
| --- | --- | --- |
| Enviar por e-mail | e-mail da conta Google | já associado à sessão; não foi alterado |
| CNPJ | texto | — |
| Nome Fantasia | texto | — |
| Ramo de Atividade | texto | — |
| E-mail Suporte | texto | — |
| Telefone Suporte | texto | — |
| Nome da Aplicação | texto | — |
| Versão da Aplicação | texto | — |
| Linguagem Desenvolvimento | texto | — |
| Responsável pelo Desenvolvimento | texto | — |
| E-mail do Responsável pelo Desenvolvimento | texto | — |
| Modalidade Integração | escolha | Background; Foreground; GP File (Troca de Arquivos); SDK AAR; Destaxa Intent; ACBR TEF Destaxa; DLL Destaxa; API JSON |
| Sistema Operacional | escolha | Windows; Linux; Android |

Botões visíveis: Avançar e Limpar formulário. Nenhum foi acionado.

---

## Ramificação

A escolha de Modalidade Integração desvia a seção seguinte:

| Alternativa | Seção de destino |
| --- | --- |
| SDK AAR | SDK AAR/ Destaxa Intent |
| Destaxa Intent | SDK AAR/ Destaxa Intent |
| Background, Foreground, GP File, ACBR TEF Destaxa, DLL Destaxa, API JSON | Roteiro de Testes |

Seção **SDK AAR/ Destaxa Intent**, texto original:

> Nas modalidades SDK AAR ou Destaxa Intent, realize os seguintes testes:
> Durante a execução, por favor, gere o Logcat para que possamos analisar os resultados e verificar o comportamento dos testes. O log deverá ser enviado ao final do formulário.

Nessa seção entram só estes dois itens, que não fazem parte dos 25 do sumário:

**Teste 01.1 - Ativação Terminal** (pergunta com asterisco)

> Ativação do Terminal utilizando o CNPJ ou CPF junto com a Assinatura;
> Mensagem de ativação realizada com sucesso em tela.

Alternativas: “Teste ocorreu com sucesso.” ou “Funcionalidade não implementada”.

**Teste 01.2 - Dados Terminal** (pergunta com asterisco)

> Impressão ou exibição dos Dados Terminal:
> CNPJ/CPF, Assinatura, Nome do Estabelecimento, Loja, Terminal e Versão do SDK.

Alternativas: “Teste ocorreu com sucesso” ou “Funcionalidade não implementada”.

A modalidade DLL Destaxa aponta direto para a seção Roteiro de Testes. Nenhuma modalidade foi selecionada.

---

## Critérios da seção Roteiro de Testes

Texto original, inclusive a numeração repetida:

> Critérios:
>
> 1) A automação comercial, deve disponibilizar ao usuário as possibilidades: Executar vendas, abandonar fluxo durante a transação, realizar cancelamentos.
> 2) Funções Administrativas: Nas funções administrativas como o fluxo de cancelamento de transações, exigem uma validação rigorosa, pois devem ser executadas exclusivamente por pessoas autorizadas. A Automação é responsável por implementar e manter um controle de credenciais que garanta que apenas usuários com a devida permissão possam realizar essas ações. Esse controle de acesso deve assegurar que qualquer tentativa de realizar uma função administrativa seja devidamente autenticada e validada, garantindo a segurança e a integridade das operações.
> 3) O sequencial deverá ser respeitado e enviado pela Aplicação Comercial corretamente, para controle do fluxo das transações e requisições; este sequencial deverá iniciado com “0” zero todos os dias;
> 4) Antes de executar os testes, limpe os arquivos de log do "Client":
> C:\VBI\V$Pague\Client\Logs\vspague-client.log
> 2) Execute os testes no mesmo dia, para facilitar a validação;
> 3) Realize vendas com diversos cartões e bandeiras;
> 4) Os valores das transações realizadas durante a execução dos testes devem ser diferentes;
> 5) Caso não seja integrado alguma função obrigatória, formalizar o motivo de não ter sido implementada juntamente com o envio deste documento para validação;

Há uma seção seguinte intitulada de novo “Roteiro de Testes”, com o texto “Continuação”. Ela não cria testes novos; os testes 13 a 25 vêm depois dela.

---

## Os 25 testes

A coluna Obrigatório usa somente o sumário: ✔️ obrigatório, 🟣 opcional. A coluna Asterisco diz se o Forms exige resposta para enviar.

| Nº | Nome no sumário | Nome na questão | Obrigatório? | Asterisco | Quantidade e valor | Evidência exigida |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Débito | Teste 01 - Débito à Vista | Sim | Sim | 5 vendas. Exemplo de lançamento `12.00`. Valores diferentes e bandeiras diferentes, como recomendação | Aprovada e confirmada. Primeira e segunda via. Valor e NSU separados por `;`. Exemplo: `Venda1 = 12.00 - 000000;` |
| 02 | Débito Pré-Datado | Teste 02 - Débito Pré-datado | Não | Não | 5 vendas. Mesma recomendação de valores e bandeiras | Aprovada e confirmada. Duas vias. Valor e NSU no mesmo formato |
| 03 | Crédito à vista | Teste 03 - Crédito à Vista | Sim | Sim | 5 vendas | Igual ao teste 01 |
| 04 | Crédito Parcelado Estabelecimento e/ou Administradora | Teste 04 - Crédito Parcelado Estabelecimento e/ou Administradora | Sim | Sim | 5 vendas. Se os dois métodos forem implementados, 5 de cada | Igual ao teste 01 |
| 05 | PIX | Teste 05 - PIX | Sim | Sim | 5 vendas | Aprovada e confirmada. Duas vias. Valor e NSU. A observação original termina em “sejam diferentes” |
| 06 | Venda Múltipla - Cartão | Teste 06 - Venda Múltipla - Cartão | Não | Não | Uma venda em dois ou mais cartões | Aprovada e confirmada. Duas vias. Valor e NSU |
| 07 | Venda Múltiplos Pagamentos (Cartão - PIX) | Teste 07 - Venda Múltiplos Pagamentos | Não | Não | Uma venda, parte em cartão e o restante no PIX | Aprovada e confirmada. Duas vias. Valor e NSU |
| 08 | Validação de Credenciais para o Cancelamento | Teste 08 - Validação de Credenciais para o Cancelamento | Sim | Sim | Uma venda e, na sequência, o estorno/cancelamento | Informar como a credencial do operador foi capturada e validada. Na última questão, print ou vídeo dessa validação |
| 09 | Cancelamento/Estorno Cartão | Teste 9 - Cancelamento/Estorno Cartão | Sim | Sim | Cancelar a venda aprovada no cartão | A automação solicita Valor, Data e NSU. Duas vias. Valor e NSU no formato do exemplo |
| 10 | Cancelamento/Estorno PIX | Teste 10 - Cancelado/Estorno PIX | Sim | Sim | Estornar a venda aprovada no PIX | A automação solicita Valor, Data e NSU. Duas vias. Valor e NSU no formato do exemplo |
| 11 | Pré-Autorização - Solicitar | Teste 11 - Pré-Autorização - Solicitar | Não | Não | Exemplo `Pré-Autorização1 = 100.00 - 123456;` | Aprovada e confirmada. Mensagem de aprovada. Duas vias. Status aprovado no TEF e na automação. Valor e NSU |
| 12 | Pré-Autorização - Capturar | Teste 12 - Pré-Autorização - Capturar | Não | Não | O enunciado repete o do teste 11, com o mesmo exemplo de R$ 100,00 | O mesmo texto do teste 11 |
| 13 | Múltiplos Cartões Fechamento do Sistema | Teste 13 - Múltiplos Cartões Fechamento do Sistema | Não | Sim | Venda de R$ 100,00 em múltiplos cartões. Na segunda, ao pedir senha no PinPad, fechar o sistema | Escolha: “Teste ocorreu com sucesso” ou “Função não implementada”. Verificar cancelamento da primeira compra ou recuperação da transação interrompida |
| 14 | Múltiplos Cartões Desconectar Rede | Teste 14 - Múltiplos Cartões Desconectar Rede | Não | Sim | Venda de R$ 200,00 em múltiplos cartões. Na segunda, ao pedir senha, desconectar a rede | Escolha: “Teste ocorreu com sucesso” ou “Função não implementada”. Mesmo objetivo do teste 13 |
| 15 | Timeout na Leitura/Aproximação do cartão | Teste 15 - Timeout na Leitura/Aproximação do cartão | Sim | Sim | Iniciar cartão e não aproximar nem inserir | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado”. Tratar timeout, devolver o erro e finalizar |
| 16 | Timeout na Leitura do QrCode | Teste 16 - Timeout na Leitura do QrCode | Sim | Sim | Iniciar PIX, exibir o QR e não lê-lo até o timeout | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado” |
| 17 | Cancelar Leitura do QrCode | Teste 17 - Cancelar Leitura do QrCode | Sim | Sim | Iniciar PIX e cancelar quando o QR aparecer | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado”. Verificar o cancelamento do fluxo |
| 18 | Falha de Conexão com Pinpad | Teste 18 - Falha de conexão com Pinpad | Sim | Sim | PinPad desconectado. Débito de R$ 100,00 | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado” |
| 19 | Falha de Comunicação com Client | Teste 19 - Falha de Comunicação com Client | Sim | Sim | Fechar o V$PagueClient e solicitar uma venda | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado” |
| 20 | Falha de Conectividade | Teste 20 - Falha de Conectividade | Sim | Sim | Na senha do PinPad, desconectar a internet | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado” |
| 21 | Venda Negada | Teste 21 - Venda negada | Sim | Sim | Débito. Na mensagem “Processando” do PinPad, remover o cartão | Escolha: “Teste ocorreu com sucesso” ou “Teste não realizado”. Negada de cartão removido |
| 22 | Função Adm - Reimprimir Último Comprovante | Teste 22 - Reimpressão último comprovante | Não | Sim | No mínimo um teste para Lojista, um para Portador e um para Todos | Escolha: “Função implementada, ocorreu com sucesso” ou “Função não implementada” |
| 23 | Função Adm - Reimprimir Comprovante Específico | Teste 23 - Reimpressão comprovante específico | Não | Sim | Capturar Data, NSU e Valor. No mínimo um teste para cada via: Lojista, Portador e Todos | Escolha: “Função implementada, ocorreu com sucesso” ou “Função não implementada” |
| 24 | Função Adm - Coleta CPF | Teste 24 - Coleta CPF | Não | Sim | Chamar o método de coleta de CPF pelo PinPad. O próprio texto limita o teste às modalidades Background e DLL | Escolha: “Função implementada, ocorreu com sucesso” ou “Função não implementada” |
| 25 | Realize uma venda e faça o desfazimento na sequência (não confirmação) | Teste 25 - Realize uma venda e faça o desfazimento na sequencia (não confirmação) | Sim | Sim | Venda no cartão. Depois dos dados do comprovante, não imprimir e simular a desistência com não confirmação | Escolha: “Teste realizado com sucesso” ou “Automação não permite Desfazimento”. Vídeo ou print da mensagem ao operador depois de “Transação Aprovada” e do desfazimento |

### Redação original das questões 01 a 12

**Teste 01 - Débito à Vista**

> Realizar 5 Vendas;
> Venda deve estar com status Aprovada e Confirmada e comprovante primeira e segunda via impressos com sucesso;
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 02 - Débito Pré-datado**

> Realizar 5 Vendas;
> Venda com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 03 - Crédito à Vista**

> Realizar 5 Vendas;
> Venda com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 04 - Crédito Parcelado Estabelecimento e/ou Administradora**

> Realizar 5 Vendas;
> Venda com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
> Obs: Caso vá implementar os dois métodos insira 5 de cada.
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 05 - PIX**

> Realizar 5 Vendas;
> Venda com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes

**Teste 06 - Venda Múltipla - Cartão**

> Realizar uma venda que o cliente vai pagar em dois ou mais cartões;
> Vendas precisam estar com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 07 - Venda Múltiplos Pagamentos**

> Realizar uma venda que o cliente vai pagar parte em cartão, e o restante no PIX;
> Vendas precisam estar com status Aprovada e Confirmada, comprovante primeira e segunda via impressos com sucesso.
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 08 - Validação de Credenciais para o Cancelamento**

> Realizar uma venda e na sequencia faça o estorno cancelamento desta venda.
> Nos informe como foi capturado e validado a credencial do operador, garantindo que o mesmo tem permissão a executar o cancelamento.
> Na última questão do roteiro de teste envie um print/vídeo com esta "validação de permissão" do operador para executar a operação.

**Teste 9 - Cancelamento/Estorno Cartão**

> Realizar o cancelamento da venda aprovada via cartão;
> Automação precisa solicitar os dados da venda: Valor, Data, NSU;
> Comprovante primeira e segunda via impressos com sucesso
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;

**Teste 10 - Cancelado/Estorno PIX**

> Realizar o estorno da venda aprovada via PIX;
> Automação precisa solicitar os dados da venda: Valor, Data, NSU;
> Comprovante primeira e segunda via impressos com sucesso
> Coloque o Valor e o NSU das transações abaixo separado por ;
> Exemplo: Venda1 = 12.00 - 000000;

**Teste 11 - Pré-Autorização - Solicitar**

> Pré-Autorização com status Aprovada e Confirmada;
> Mensagem de transação Aprovada em tela;
> Comprovante de primeira e segunda via impressos com sucesso;
> Venda com status Aprovada para o TEF e a Aplicação Comercial.
> Coloque o Valor e o NSU das transações abaixo separados por ;
> Exemplo: Pré-Autorização1 = 100.00 - 123456;
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 12 - Pré-Autorização - Capturar**

O texto da questão é o mesmo do teste 11.

### Redação original das questões 13 a 25

**Teste 13 - Múltiplos Cartões Fechamento do Sistema**

> Simule uma venda de R$100,00 utilizando múltiplos cartões. Realize a primeira transação normalmente. Na segunda transação, ao inserir o segundo cartão e quando o Pinpad solicitar a senha, feche o sistema. O objetivo é verificar se a aplicação está tratando corretamente a interrupção, enviando o cancelamento da primeira compra ou recuperando a transação interrompida para continuidade.
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 14 - Múltiplos Cartões Desconectar Rede**

> Simule uma venda de R$200,00 utilizando múltiplos cartões. Realize a primeira transação normalmente. Na segunda transação, ao inserir o segundo cartão e quando o Pinpad solicitar a senha, desconecte a máquina que está sendo usada da Rede. O objetivo é verificar se a aplicação está tratando corretamente a interrupção, enviando o cancelamento da primeira compra ou recuperando a transação interrompida para continuidade.
>
> OBS: Recomendamos que os valores das transações sejam diferentes e com diversos cartões (bandeiras diferentes).

**Teste 15 - Timeout na Leitura/Aproximação do cartão**

> Inicie uma transação de cartão e não aproxime ou insira o cartão quando for solicitado. O objetivo é verificar se a aplicação está lidando corretamente com o retorno de timeout, retornando o erro e finalizando a transação.

**Teste 16 - Timeout na Leitura do QrCode**

> Inicie uma transação PIX e quando o QrCode for exibido, não o leia, aguardando o timeout. O objetivo é verificar se a aplicação está lidando corretamente com o retorno de timeout, retornando o erro e finalizando a transação.

**Teste 17 - Cancelar Leitura do QrCode**

> Inicie uma transação PIX e, quando o QrCode for exibido, cancele o processo, simulando a desistência do cliente. O objetivo é verificar se a aplicação está enviando corretamente o cancelamento do fluxo.

**Teste 18 - Falha de conexão com Pinpad**

> Desconecte o Pinpad da máquina em teste e, em seguida, inicie uma transação de débito no valor de R$100,00. O objetivo é verificar se a aplicação está tratando corretamente o erro de falha de conexão com o Pinpad.

**Teste 19 - Falha de Comunicação com Client**

> Feche o V$PagueClient da Máquina e solicite uma venda. O objetivo é verificar se a aplicação está tratando corretamente o erro de conexão com o Client e retornando corretamente o cenário que está ocorrendo.

**Teste 20 - Falha de Conectividade**

> Faça uma venda, ao inserir o cartão e quando o Pinpad solicitar a senha, desconecte a máquina que está sendo usada da Rede(Internet). O objetivo é verificar se a aplicação está tratando corretamente a interrupção e retornando o cenário.

**Teste 21 - Venda negada**

> Faça uma venda no Débito, insira o cartão, coloque a senha e aperte em confirmar no Pinpad e no momento que estiver aparecendo a mensagem "Processando" na tela do Pinpad, você deve remover o cartão rapidamente, com isso ocorre a negada de cartão removido.

**Teste 22 - Reimpressão último comprovante**

> Realizar a reimpressão do último comprovante. O usuário escolherá as opções: Lojista, Portador ou Todos
>
> OBS: Realizar no mínimo um teste para cada forma de impressão (Lojista, Portador ou Todos)
>
> Resultado Obtido:

**Teste 23 - Reimpressão comprovante específico**

> Realizar a reimpressão do comprovante. O usuário escolherá as opções: Lojista, Portador ou Todos
> Realizar a impressão com a captura dos dados da Data, NSU e o Valor da venda.
>
> OBS: Realizar no mínimo um teste para cada forma de impressão (Lojista, Portador ou Todos)
>
> Resultado Obtido:

**Teste 24 - Coleta CPF**

> Realizar a chamada do método para coletar o CPF pelo Pinpad.
>
> OBS: Teste Especifico somente para Modalidades Background e DLL.
>
> Resultado Obtido:

**Teste 25 - Realize uma venda e faça o desfazimento na sequencia (não confirmação)**

> Realizar uma venda cartão, depois que é devolvido os dados do comprovante, não faça a impressão e simule o cliente desistindo da compra, enviando uma não confirmação.
>
> Resultado Obtido: Envie um vídeo ou print da mensagem que é apresentada ao Operador, mesmo após retornado "Transação Aprovada" e a automação ter enviado o desfazimento (Desfazendo a venda).

---

## Envio final

Última questão, com asterisco, tipo arquivo:

> Após realizar todos os testes do roteiro, envie o arquivo de log localizado em C:\VBI\V$Pague\Client\logs.
> Se estiver utilizando o SDK, anexe também o LogCat. Caso tenha outras evidências (prints, vídeos, etc.), envie junto.

O critério 4 cita `C:\VBI\V$Pague\Client\Logs\vspague-client.log`. A questão final cita a pasta `C:\VBI\V$Pague\Client\logs`. As duas redações foram preservadas.

O teste 08 pede que o print ou vídeo da credencial vá nesta última questão.
