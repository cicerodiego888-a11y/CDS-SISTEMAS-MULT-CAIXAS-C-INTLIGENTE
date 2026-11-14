# SPRINT 51.71 — Obtenção do roteiro oficial e confirmação contratual Destaxa

**Data:** 2026-11-13  
**Tipo:** investigação documental  
**Projeto:** CDS Sistemas  
**Base:** DLL Destaxa 1.83  
**Sprint anterior:** 51.70  
**Parecer:** o formulário foi lido na sessão já autenticada. Os 25 testes e a marca obrigatório/opcional do sumário foram recuperados. As dúvidas de contrato D-02 a D-09 continuam sem resposta da Destaxa.

Nenhuma operação financeira foi executada. Código, políticas, banco, configuração, DLL, NativeHost, V$PagueClient, COM4, PinPad e PDV não foram alterados. O formulário não foi preenchido nem enviado. A conta Google não foi trocada e nenhuma credencial foi digitada.

Esta sprint não autoriza implementação.

---

## 1. Resumo executivo

A primeira abertura, sem login, parou na tela de autenticação. O Product Owner autenticou manualmente. A continuação reutilizou essa aba. O título carregado foi “Destaxa - Certificação - Roteiro de Testes”.

O sumário classifica 15 testes como obrigatórios e 10 como opcionais. A redação de cada questão, as quantidades, os valores citados e as evidências estão em `ROTEIRO-OFICIAL.md`.

O asterisco do Forms não repete o sumário em cinco testes opcionais: 13, 14, 22, 23 e 24. Neles a pergunta é obrigatória para enviar o formulário, e uma das alternativas é dizer que a função não foi implementada. A classificação usada aqui é a do sumário.

DLL Destaxa segue para a seção “Roteiro de Testes”. SDK AAR e Destaxa Intent passam antes por uma seção própria, com os testes 01.1 e 01.2 e pedido de Logcat. Nenhuma modalidade foi selecionada.

O critério 3 do roteiro diz que a automação deve enviar um sequencial iniciado em zero todos os dias. Não diz o campo, nem se zera à meia-noite, nem o comportamento na reconexão. D-09 permanece aberto. Nenhum contador foi criado.

---

## 2. Acesso

| Tentativa | Resultado |
| --- | --- |
| 2026-11-13, cerca de 16:46, sem login | O endereço `https://forms.gle/g6g6JxYXHZEUX54T6` resolve para o Forms `1FAIpQLSe-IWXL4PBxS1rycs3ISPdRWbr7EMi_W4v7s2DYOw4WwSmBRA` e pede conta Google. Essa tentativa não é a conclusão final |
| 2026-11-13, sessão já autenticada | A mesma aba abriu o formulário. A primeira página mostrou a introdução, o sumário dos 25 testes e os campos administrativos. As seções seguintes foram lidas no conteúdo carregado pelo formulário, sem clicar em Avançar e sem escolher modalidade |

Não houve troca de conta, preenchimento nem envio.

---

## 3. Os 25 testes

Fonte da obrigatoriedade: o sumário do próprio formulário. ✔️ obrigatório. 🟣 opcional.

| Nº | Nome oficial no sumário | Obrigatório? | Quantidade | Evidência exigida |
| --- | --- | --- | --- | --- |
| 01 | Débito | Sim | 5 vendas à vista | Aprovada e confirmada. Duas vias. Valor e NSU |
| 02 | Débito Pré-Datado | Não | 5 vendas | Aprovada e confirmada. Duas vias. Valor e NSU |
| 03 | Crédito à vista | Sim | 5 vendas | Aprovada e confirmada. Duas vias. Valor e NSU |
| 04 | Crédito Parcelado Estabelecimento e/ou Administradora | Sim | 5 vendas; 5 de cada método se os dois forem implementados | Aprovada e confirmada. Duas vias. Valor e NSU |
| 05 | PIX | Sim | 5 vendas | Aprovada e confirmada. Duas vias. Valor e NSU |
| 06 | Venda Múltipla - Cartão | Não | 1 venda em dois ou mais cartões | Aprovada e confirmada. Duas vias. Valor e NSU |
| 07 | Venda Múltiplos Pagamentos (Cartão - PIX) | Não | 1 venda, parte cartão e o restante PIX | Aprovada e confirmada. Duas vias. Valor e NSU |
| 08 | Validação de Credenciais para o Cancelamento | Sim | 1 venda e o estorno em seguida | Como a credencial foi validada. Print ou vídeo na última questão |
| 09 | Cancelamento/Estorno Cartão | Sim | Cancelar a venda aprovada no cartão | A automação pede Valor, Data e NSU. Duas vias |
| 10 | Cancelamento/Estorno PIX | Sim | Estornar a venda aprovada no PIX | A automação pede Valor, Data e NSU. Duas vias |
| 11 | Pré-Autorização - Solicitar | Não | Exemplo de R$ 100,00 | Aprovada e confirmada. Mensagem em tela. Duas vias. Valor e NSU |
| 12 | Pré-Autorização - Capturar | Não | O enunciado repete o do teste 11 | O mesmo texto do teste 11 |
| 13 | Múltiplos Cartões Fechamento do Sistema | Não | R$ 100,00. Fechar o sistema na senha do segundo cartão | Sucesso ou “Função não implementada”. Cancelar a primeira ou recuperar a interrompida |
| 14 | Múltiplos Cartões Desconectar Rede | Não | R$ 200,00. Desconectar a rede na senha do segundo cartão | Sucesso ou “Função não implementada” |
| 15 | Timeout na Leitura/Aproximação do cartão | Sim | Não aproximar nem inserir o cartão | Sucesso ou “Teste não realizado”. Erro de timeout e finalização |
| 16 | Timeout na Leitura do QrCode | Sim | PIX. Não ler o QR até o timeout | Sucesso ou “Teste não realizado” |
| 17 | Cancelar Leitura do QrCode | Sim | PIX. Cancelar quando o QR aparecer | Sucesso ou “Teste não realizado” |
| 18 | Falha de Conexão com Pinpad | Sim | PinPad desconectado. Débito de R$ 100,00 | Sucesso ou “Teste não realizado” |
| 19 | Falha de Comunicação com Client | Sim | V$PagueClient fechado e uma venda solicitada | Sucesso ou “Teste não realizado” |
| 20 | Falha de Conectividade | Sim | Desconectar a internet na senha do PinPad | Sucesso ou “Teste não realizado” |
| 21 | Venda Negada | Sim | Débito. Remover o cartão em “Processando” | Sucesso ou “Teste não realizado” |
| 22 | Função Adm - Reimprimir Último Comprovante | Não | Lojista, Portador e Todos, no mínimo um de cada | Sucesso ou “Função não implementada” |
| 23 | Função Adm - Reimprimir Comprovante Específico | Não | Data, NSU e valor. Lojista, Portador e Todos | Sucesso ou “Função não implementada” |
| 24 | Função Adm - Coleta CPF | Não | Coleta pelo PinPad. Texto limitado a Background e DLL | Sucesso ou “Função não implementada” |
| 25 | Realize uma venda e faça o desfazimento na sequência (não confirmação) | Sim | Cartão aprovado, sem imprimir, e não confirmação | Sucesso ou “Automação não permite Desfazimento”. Vídeo ou print da mensagem ao operador |

São 15 obrigatórios e 10 opcionais. Os testes 01.1 e 01.2 não entram nessa conta: só aparecem nas modalidades SDK AAR e Destaxa Intent.

Regras gerais do roteiro: limpar o log do Client, executar no mesmo dia, usar cartões e bandeiras diversas, valores diferentes, e formalizar o motivo quando uma função obrigatória não for integrada. O envio final pede o log em `C:\VBI\V$Pague\Client\logs`, Logcat se for SDK, e prints ou vídeos.

---

## 4. Ramificações

A única ramificação encontrada está em Modalidade Integração.

- SDK AAR e Destaxa Intent abrem a seção “SDK AAR/ Destaxa Intent”, com Logcat e os testes 01.1 e 01.2.
- As outras modalidades, entre elas DLL Destaxa, abrem direto “Roteiro de Testes”.

Não há desvio dentro das alternativas dos 25 testes. O teste 24 avisa, no próprio enunciado, que é específico de Background e DLL. A pergunta continua na seção comum.

---

## 5. O que o roteiro não responde

D-02 a D-09 continuam abertos. O formulário pede o resultado dos testes. Não fixa o formato de `transacao_data`, os parâmetros de `PRE`, o nome da operação de captura, o formato do QR, o `txid`, o fluxo `coleta_pinpad_formato=1`, o parâmetro `multi_transacao=1` nem o campo do sequencial.

O critério 3 diz que o sequencial começa em zero todos os dias e é enviado pela automação. Isso confirma a existência da exigência no roteiro. Não confirma o campo técnico. D-09 não foi fechado e nenhum contador foi criado.

---

## 6. Situação das modalidades

| Modalidade | O que o roteiro exige | Situação contratual que permanece |
| --- | --- | --- |
| CRT débito | Teste 01, obrigatório, cinco vendas | Caminho de débito existe. A cota de cinco e as duas vias ainda são evidência de execução, fora desta sprint |
| CRT crédito | Testes 03 e 04, obrigatórios | Mapeamento parcial. Sem as cinco vendas |
| EST cartão | Teste 09, obrigatório. Pede Valor, Data e NSU | DEPENDENTE DE CONFIRMAÇÃO DESTAXA. Estorno continua desligado |
| PIX Destaxa | Testes 05, 10, 16 e 17. O 05 e o 10 são obrigatórios | PARCIALMENTE IMPLEMENTADO e bloqueado no CDS. Distinto do PIX Sicredi |
| PRE | Teste 11, opcional | DEPENDENTE DE CONFIRMAÇÃO DESTAXA |
| Captura | Teste 12, opcional. O enunciado repete o da solicitação | NÃO DOCUMENTADO como operação |
| CPF PinPad | Teste 24, opcional, e o texto cita Background e DLL | DOCUMENTADO na DLL, não implementado no CDS. Distinto do CPF da nota |
| Multi-transação | Testes 06, 07, 13 e 14, opcionais no sumário | DOCUMENTADO na DLL, não enviado pelo CDS. Distinto do pagamento misto do PDV |
| Sequencial diário | Critério 3: iniciar em zero todos os dias | DEPENDENTE DE CONFIRMAÇÃO DESTAXA. Sem contador |

---

## 7. Próxima decisão

O roteiro já diz o que a certificação pede. Desenvolvimento continua dependente da aprovação do Product Owner e, para EST, PRE, captura, PIX da DLL, CPF, multi-transação e sequencial, da resposta escrita que ainda falta.

Não há implementação nesta continuação.

---

## 8. Declaração de segurança

Nenhuma operação financeira foi executada. Não houve CRT, EST, PRE, captura, PIX Destaxa nem cobrança PIX Sicredi. A DLL não foi carregada. NativeHost e V$PagueClient não foram iniciados. COM4 e PinPad não foram acessados. O formulário não foi preenchido nem enviado. Nenhum arquivo de produção foi alterado. Os arquivos desta pasta são o relatório, a matriz, as pendências formais e a cópia do roteiro.
