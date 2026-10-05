# Sprint 17B — Relatório do teste isolado

## Status

**PASSOU.** A rotina oficial foi executada somente sobre um SQLite temporário criado exclusivamente para este teste. O arquivo foi removido pelo teardown após a execução final.

## Banco utilizado

- Caminho durante o teste: `C:\Users\cicer\AppData\Local\Temp\cds-sprint17b-9ZcYk0\sprint17b.sqlite`
- Banco criado pelo teste a partir do zero; nenhum banco foi copiado.
- Não foi o banco ativo do Electron.
- Não foi `C:\ProgramData\MercantilFiscal\dados\mercadao.db`.
- Verificação após teardown: arquivo temporário não existe.

## Massa legada e diagnóstico

Foram criadas 5 linhas de produto em 3 categorias. Produto A também recebeu uma reserva fiscal real no fixture: quantidade 2 em `pedido_estoque_reservas` e `reservado_fiscal=2`.

| Categoria | Total | Corretos antes | Incorretos antes | Corrigidos | Corretos depois | Incorretos depois |
|---|---:|---:|---:|---:|---:|---:|
| AÇOUGUE | 2 | 0 | 2 | 2 | 2 | 0 |
| HORTIFRUTI | 2 | 0 | 2 | 2 | 2 | 0 |
| BEBIDAS | 1 | 0 | 1 | 0 | 0 | 1 |

Produto D de Hortifruti (`item_fiscal=0`, `controla_estoque=1`) também precisava de correção; por isso, o total corrigido foi 4, não 3.

Saldos capturados antes da execução:

- Produto A Açougue: fiscal 10, não fiscal 5
- Produto B Açougue: fiscal 20, não fiscal 0
- Produto C Hortifruti: fiscal 8, não fiscal 4
- Produto D Hortifruti: fiscal 3, não fiscal 7
- Produto E Bebidas: fiscal 30, não fiscal 0

O teste também registrou ID, categoria, flags e todos os demais campos existentes na linha de produto.

## Execução e integridade

A rotina utilizada foi `normalizacaoProdutosCategoriaEspecial.js`; nenhuma implementação paralela foi criada. Primeira execução: **4 produtos alterados**. Segunda execução: **0 produtos alterados**.

A comparação da linha completa antes/depois confirmou que, nos cinco produtos originais, somente `item_fiscal` e `controla_estoque` mudaram nos quatro produtos especiais. O produto de Bebidas permaneceu inalterado. Saldos físico/fiscal/não fiscal e os campos agregados de reserva ficaram idênticos. A linha da reserva em `pedido_estoque_reservas` também permaneceu idêntica.

**Comprometimentos:** não foi criado um registro separado de comprometimento. O schema do teste não oferece uma tabela/estrutura simples e independente para isso; nenhum dado artificial foi inventado. A reserva fiscal foi reproduzida e comparada.

Não foram criados movimentos de estoque, transferências, vendas ou documentos fiscais pela normalização.

## Testes funcionais e fluxos

- Produto novo em Açougue, com payload 1/1: gravado 0/0.
- Produto novo em Hortifruti, com payload 1/1: gravado 0/0.
- Produto novo em Bebidas: regra 1/1 preservada.
- Produto de Bebidas movido para Açougue: passou para 0/0, saldos intactos.
- Produto de Bebidas movido para Hortifruti: passou para 0/0, saldos intactos.
- Importação inicial: os testes de Sprint 17 confirmaram produto de Açougue 0/0; a suíte V1.1.2 passou 36/36 e V1.1.4 passou 16/16 em bancos temporários.
- Criação automática em compra: teste direto confirmou Hortifruti 0/0 e a regra da entrada fiscal separada; compra comum manteve o default legado. Regressão MIP Sprint 07: 9/9 verificações OK.
- F12 OFF e ON: produtos de Açougue e Hortifruti encontrados pelo MIP, `item_fiscal=0`, aceitos pela verificação de início de inclusão e validação de estoque. Produto fiscal de Bebidas também foi encontrado e validado.
- Regressão RC9.1 de classificação de entrada: 16 verificações internas OK.

## Testes

Execuções finais de `node --test`: **PASS 116, FAIL 0, SKIP 0**, distribuídas entre o teste 17B, a suíte de padrões de categoria, importação V1.1.2/V1.1.4, exibição F12, certificação F×NF, venda sem estoque, RC9.1 e os testes diretos Sprint 17. O teste legado MIP Sprint 07 acrescentou 9 verificações OK.

Durante a preparação houve uma tentativa descartada de rodar V1.1.2 com `DB_DIR` externo forçado; ela encontrou uma condição de inicialização assíncrona (`configuracoes` ainda não criada). A execução standalone pelo modo `node --test`, com isolamento temporário automático do repositório, passou 36/36. Nenhuma dessas execuções usou o banco protegido.

## Confirmações

- **BANCO REAL NÃO ALTERADO.** O banco protegido e o banco atual do Electron não foram usados.
- **MOTOR F×NF NÃO ALTERADO.** Certificação Sprint 8: 23/23; a bateria de venda sem estoque passou 11/11.
- **F12 NÃO ALTERADO.** Teste de exibição não fiscal passou 3/3; a validação funcional OFF/ON também passou no fixture.
- **VENDA SEM ESTOQUE NÃO ALTERADO.** Seus 11 testes passaram.
- TEF, impressão, Electron, ASAR e manifesto não foram alterados. Sem build; Sprint 22 não iniciada.
