# Pendências formais para a Destaxa

**Projeto:** CDS Sistemas  
**DLL em uso:** Destaxa 1.83  
**Data:** 2026-11-13  
**Finalidade:** texto pronto para envio ao suporte de integração  
**Uso:** o Product Owner completa o CNPJ e envia. Este arquivo não foi transmitido pela sprint.

Canal indicado no `leia-me.txt` do pacote: WhatsApp 0800 123 6398, opção 5 — Integração. Informar o CNPJ antes da dúvida.

CNPJ: [PREENCHER PELA EMPRESA — não inventar]

---

## Mensagem

Prezados,

Somos a automação comercial CDS Sistemas, em integração com a DLL Destaxa 1.83. Precisamos de confirmação escrita dos pontos abaixo antes de implementar estorno, pré-autorização, captura, PIX pela DLL, CPF no PinPad, multi-transação ou sequencial comercial. Não estamos pedindo execução de transação neste contato.

Também pedimos o export integral do formulário “Destaxa - Certificação - Roteiro de Testes” (`https://forms.gle/g6g6JxYXHZEUX54T6`). O endereço abre uma tela de login do Google e não exibe as perguntas sem autenticação. Precisamos da redação original, na ordem do formulário, com a indicação do que é obrigatório e do que é opcional, quantidades, valores, modalidades, evidências e instruções de envio.

### 1. EST — estorno comercial

1. A operação `EST` recebe `transacao_data`, `transacao_nsu` e `transacao_valor` diretamente em `iniciaTransacaoDestaxa`?
2. Esses três campos são oficialmente aceitos como entrada?
3. Qual é o formato exato de `transacao_data`: `yyyy-MM-dd`, `dd/MM/yy` ou `dd/MM/yyyy`?
4. O formato varia conforme a versão da DLL, do Client ou de alguma configuração?
5. A coleta desses dados pelo retorno `99` é obrigatória ou é alternativa a enviá-los já na entrada?
6. O fluxo de estorno do documento “Documento DESTAXA.rtf” (seções 4 e 5) vale para cartão e para PIX?
7. Quais retornos confirmam definitivamente o estorno?
8. Existe regra adicional de estabelecimento, loja ou terminal?

Pedimos um exemplo oficial completo de EST: entrada, sequência de chamadas, retornos e comprovantes.

Não trataremos `finalizaTransacaoDestaxa(9)` como estorno comercial. Para nós, essa chamada aborta a transação corrente.

### 2. PRE — pré-autorização

1. Quais parâmetros são necessários para a operação `PRE`?
2. Quais bandeiras e modalidades são permitidas?
3. Como é retornado o identificador da pré-autorização?
4. Existe prazo de validade?
5. Como funciona a captura posterior?
6. Qual operação realiza a captura?
7. Quais parâmetros identificam a pré-autorização original?
8. Como funcionam cancelamento e expiração?
9. Quais retornos representam sucesso, recusa e estado indeterminado?

Pedimos um fluxo completo de exemplo. No material 1.83 local, `PRE` aparece só como “Cartão Pré-Autorização”, sem parâmetros.

### 3. Captura

Pedimos confirmação expressa, em separado de `PRE`:

- A captura é uma operação independente?
- Qual é o nome oficial da operação?
- Qual é a assinatura?
- Quais identificadores são necessários?
- Como é feita a captura parcial?
- Existe captura múltipla?
- Como ocorre o cancelamento?

Não vamos assumir que `PRE` também executa a captura.

### 4. PIX pela DLL Destaxa

Este item é a operação `PIX` da DLL. Não é a cobrança PIX já usada pelo nosso PDV fora da Destaxa.

1. O contrato da operação `PIX` descrito no RTF (valor na entrada, QR Code na coleta `99`, comprovantes no `00`, `finalizaTransacaoDestaxa(0)`) continua válido para a DLL 1.83?
2. O QR Code é devolvido exclusivamente pela coleta `99`?
3. Qual é o formato definitivo do retorno do QR Code?
4. `transacao_autorizacao` representa o `txid`?
5. Qual identificador serve para consulta e para estorno?
6. Existe operação oficial de cancelamento ou estorno de PIX?
7. Qual é o procedimento quando ocorre timeout depois da geração do QR?
8. Como confirmar o resultado quando a resposta não chega à automação?

### 5. CPF pelo PinPad

Este item é a operação `CPF` da DLL. Não é o CPF/CNPJ digitado na tela para a nota fiscal.

1. O fluxo atualizado é `coleta_pinpad_formato=1`?
2. O retorno oficial é o campo `informacao` com 11 dígitos?
3. O envio de `mensagem=CPFC+` ainda é necessário?
4. O fluxo antigo dos exemplos C# e Java permanece válido?
5. O CPF é coletado em operação independente ou associado à transação de pagamento?
6. O teste de certificação exige a captura pelo PinPad?

### 6. Multi-transação

Este item é o parâmetro `multi_transacao` de `iniciaClientDestaxa`. Não é a tela de pagamento misto do PDV.

1. `multi_transacao=1` deve ser enviado em `iniciaClientDestaxa`?
2. É necessário reinicializar o Client para alterar esse modo?
3. Uma venda com várias modalidades deve manter todas as transações pendentes até o encerramento?
4. `finalizaTransacaoDestaxa(0)` confirma todo o grupo?
5. `finalizaTransacaoDestaxa(9)` cancela todo o grupo?
6. Como recuperar o estado após queda de comunicação?
7. Como tratar os retornos `A0` e `A1`?
8. Qual é o comportamento esperado quando uma das transações é recusada?

Pedimos um exemplo completo com duas modalidades de pagamento.

### 7. Sequencial comercial diário

1. Existe sequencial comercial exigido pela certificação?
2. Qual componente gera esse sequencial?
3. Qual campo deve recebê-lo?
4. Ele deve iniciar em zero?
5. O reinício ocorre à meia-noite?
6. Deve persistir após a reinicialização do CDS?
7. Como se comporta após reconexão do V$PagueClient?
8. Existe relação com o NSU ou com o sequencial interno do protocolo entre a DLL e o Client?

Pedimos um exemplo de entrada e saída. Não criaremos contador enquanto essa definição não existir por escrito.

Agradecemos a resposta por escrito, com a referência do documento ou do exemplo oficial que a sustente.
