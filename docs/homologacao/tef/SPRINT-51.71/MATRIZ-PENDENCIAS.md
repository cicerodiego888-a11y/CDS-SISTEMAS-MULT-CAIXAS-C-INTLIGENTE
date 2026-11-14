# Matriz de pendências — Sprint 51.71

**Atualização:** 2026-11-13, após a sessão autenticada  
**Responsável pelo registro:** sprint documental CDS (Cursor)  
**Responsável pelo envio à Destaxa:** Product Owner  
**Regra:** resposta verbal sem registro não entra como confirmação documental.

D-01 foi recuperado na sessão já autenticada. D-02 a D-09 continuam sem resposta da Destaxa. O texto de envio está em `PENDENCIAS-FORMAIS-DESTAXA.md` e não foi transmitido. A cópia do roteiro está em `ROTEIRO-OFICIAL.md`.

| ID | Assunto | Pergunta | Resposta Destaxa | Evidência | Situação |
| --- | --- | --- | --- | --- | --- |
| D-01 | Formulário | Export integral do roteiro “Destaxa - Certificação - Roteiro de Testes”, com obrigatório/opcional | Conteúdo lido na sessão autenticada. Formulário não preenchido nem enviado | 2026-11-13. A aba já autenticada abriu o título “Destaxa - Certificação - Roteiro de Testes”. Sumário com 25 testes, ✔️ obrigatório e 🟣 opcional. Redação em `ROTEIRO-OFICIAL.md` | CONFIRMADO DOCUMENTALMENTE |
| D-02 | EST | Formato exato de `transacao_data` (`yyyy-MM-dd`, `dd/MM/yy` ou `dd/MM/yyyy`) e se muda por versão ou configuração | Pendente | Material local diverge entre os três formatos. Sem resposta da Destaxa | ABERTO |
| D-03 | EST | `transacao_data`, `transacao_nsu` e `transacao_valor` são entrada oficial de `iniciaTransacaoDestaxa`? A coleta `99` é obrigatória ou alternativa? Quais retornos fecham o estorno? Vale para cartão e PIX? | Pendente | Exemplos C/C#/Java e RTF seções 4 e 5 mostram os campos. `docs/06` não os lista na tabela de entrada. Sem confirmação do fornecedor | ABERTO |
| D-04 | PRE | Parâmetros, bandeiras, identificador, validade, captura posterior, cancelamento, expiração e retornos | Pendente | Só o código `PRE` / “Cartão Pré-Autorização” no material 1.83 | ABERTO |
| D-05 | Captura | A captura é operação independente? Nome, assinatura, identificadores, captura parcial, captura múltipla e cancelamento | Pendente | Nenhuma operação de captura no material examinado na 51.70 | ABERTO |
| D-06 | PIX | Contrato do RTF vale na DLL 1.83? Formato do QR, `txid`, identificador de estorno, timeout e resposta que não chega | Pendente | RTF seção 3 e `docs/06` descrevem a operação. Sem confirmação de que esse texto segue vigente. PIX Sicredi do PDV não entra nesta linha | ABERTO |
| D-07 | CPF | Fluxo atualizado é `coleta_pinpad_formato=1`? Retorno em `informacao` com 11 dígitos? `CPFC+` ainda vale? O teste exige PinPad? | Pendente | RTF seção 6 e exemplos C#/Java divergem. CPF/CNPJ da nota fiscal não entra nesta linha | ABERTO |
| D-08 | Multi-transação | `multi_transacao=1` em `iniciaClientDestaxa`, reinício do Client, `finaliza(0)` e `finaliza(9)` no grupo, `A0`/`A1`, queda e recusa de uma transação | Pendente | `docs/02`, `docs/05` e `docs/08`. Sem exemplo oficial de duas modalidades confirmado pelo fornecedor. Pagamento misto do PDV não entra nesta linha | ABERTO |
| D-09 | Sequencial | Existe sequencial comercial diário? Quem gera, qual campo, início em zero, meia-noite, reinício do CDS, reconexão do Client, relação com NSU | Pendente | Contrato de entrada 1.83 não define a regra. Nenhum contador foi criado | ABERTO |

D-01 está CONFIRMADO DOCUMENTALMENTE. D-02 a D-09 permanecem ABERTO. SOLICITADO passa a valer quando o Product Owner enviar o texto e guardar a data, o canal e o protocolo da mensagem.
