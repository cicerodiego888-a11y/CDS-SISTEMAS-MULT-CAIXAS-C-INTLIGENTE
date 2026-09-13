# Auditoria de impacto do Motor Universal de Conversão no banco de dados

## Escopo

Esta auditoria mapeia o impacto do motor de conversão de unidades e do fluxo fiscal/não fiscal sobre as tabelas do banco, com foco nos campos de:

- quantidade
- unidade
- preco_compra
- preco_venda
- custo
- subtotal
- peso
- volume
- fator

### Fontes analisadas

- [backend/lib/motorConversaoUnidades.js](../../backend/lib/motorConversaoUnidades.js)
- [backend/rotas/compras.js](../../backend/rotas/compras.js)
- [backend/services/estoqueFiscalService.js](../../backend/services/estoqueFiscalService.js)
- [backend/services/distribuidorEstoqueVenda.js](../../backend/services/distribuidorEstoqueVenda.js)
- [backend/rotas/produtos.js](../../backend/rotas/produtos.js)
- [backend/database.js](../../backend/database.js)

---

## 1. Matriz completa de impacto

| Tabela | Presença no schema | Campos impactados | Nível de impacto | Observação |
|---|---|---|---|---|
| produtos | Sim | produto_fracionado, vendido_por_peso, peso_total_compra, valor_total_compra, custo_por_kg, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem, valor_compra_embalagem, preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, controla_estoque, permite_venda_unidade, preco_unidade | Alta | Tabela central do motor. É a base de entrada/saída para estoque, custo e venda. |
| compras | Sim | total, valor_produtos, valor_desconto, valor_frete, valor_outras_despesas, valor_total_nota, status, data_compra, data_emissao, data_entrada, numero_nf, chave_acesso | Média | Não armazena quantidade diretamente, mas recebe o resultado financeiro da compra e alimenta os itens. |
| compras_itens | Sim | quantidade, quantidade_fiscal, quantidade_nao_fiscal, preco_unitario, subtotal, custo_unitario_final, custo_por_kg, peso_total_compra, margem_lucro, preco_venda_sugerido, unidade, compra_em, quantidade_embalagens, quantidade_por_embalagem, valor_total_embalagem, item_fiscal, vendido_por_peso | Alta | Tabela principal do motor. Aqui o fluxo de conversão é efetivamente persistido. |
| movimento_estoque | Não existe | — | Indireto | Não há tabela com esse nome atualmente. O impacto é refletido em produtos, compras_itens, vendas_itens, ajustes e reservas de estoque. |
| inventario | Não existe | — | Indireto | Não há tabela dedicada de inventário. O controle de inventário é feito via produtos e movimentos associados. |
| balanca | Não existe | — | Indireto | Não existe tabela balanca no schema atual. O fluxo de leitura de balança é integrado via módulos de equipamentos/PDV e se conecta ao cadastro de produtos e à venda. |
| pedido | Sim, via pedidos | quantidade, subtotal, tipo_venda, status, total, desconto, venda_id | Média | No sistema, orçamento e pedido compartilham a mesma entidade de pedidos. |
| orcamento | Sim, via pedidos com status ORCAMENTO | quantidade, subtotal, tipo_venda, status, total, desconto | Média | O orçamento é tratado como um estado/fluxo da mesma tabela pedidos. |
| vendas | Sim | total, desconto, valor_fiscal, valor_nao_fiscal, status, status_pagamento, tipo_venda, tef_transacao_id, caixa_id, terminal_id, operador_id | Alta | Tabela central para a distribuição fiscal/não fiscal e para o fechamento da venda. |
| itens_venda | Sim, via vendas_itens | quantidade, quantidade_fiscal, quantidade_nao_fiscal, preco_unitario, subtotal, valor_fiscal, valor_nao_fiscal, item_fiscal, tipo_preco, tipo_venda, promocao_id, desconto_percentual, desconto_atacado | Alta | Tabela de impacto direto na venda e no estoque reservado/consumido. |
| nfce | Sim, via nfce_notas | venda_id, status, xml_enviado, xml_retorno, protocolo, qr_code_url, danfe_html, numero, serie, chave_acesso | Baixa/Média | Não armazena quantidade, mas recebe vínculo fiscal da venda/TEF e é afetada pela composição fiscal da venda. |
| nfe | Sim, via nfe_notas | venda_id, pedido_id, numero, serie, chave_acesso, status, natureza_operacao, cfop, xml_enviado, xml_retorno, protocolo, protocolo_cancelamento | Média | Consome a estrutura fiscal da venda; não é o ponto primário de conversão, mas participa do fluxo de emissão. |
| api | Não existe como tabela | — | Transversal | O impacto é no fluxo de rotas/serviços, não em uma tabela própria. |
| mobile | Não existe como tabela | — | Transversal | O impacto é indireto via API/PDV/venda; não existe tabela específica para mobile. |
| TEF | Sim, via tef_transacoes, tef_pinpads, tef_configuracoes, tef_tokens, tef_logs | venda_id, valor, status, nfce_numero, nfce_chave, payload_retorno, codigo_transacao, codigo_resposta, mensagem_resposta | Média | O motor não usa TEF diretamente, mas a venda/nível de pagamento e a NFC-e dependem do fluxo TEF. |

---

## 2. Campos do motor que mais impactam o banco

### Campos de quantidade e unidade

Os campos abaixo são os principais pontos de entrada do motor:

- quantidade
- quantidade_fiscal
- quantidade_nao_fiscal
- quantidade_embalagens
- quantidade_por_embalagem
- peso_total_compra
- unidade
- unidade_comercial
- compra_em
- item_fiscal
- produto_fracionado / vendido_por_peso

### Campos de preço e custo

- preco_compra
- preco_venda
- preco_unitario
- custo_unitario_final
- custo_por_kg
- valor_total_embalagem
- valor_total_compra
- subtotal
- margem_lucro
- preco_venda_sugerido

### Campos de estoque e fator

- estoque_atual
- saldo_fiscal
- saldo_nao_fiscal
- controla_estoque
- fator de composição fiscal (implementado em lógica de venda, não em coluna fixa)
- valor_fiscal / valor_nao_fiscal

---

## 3. Tabelas e relacionamentos principais

### Relacionamento 1 — produto ↔ compra

- produtos.id → compras_itens.produto_id
- compras.id → compras_itens.compra_id

Impacto: a compra define custo, quantidade e preço para o produto.

### Relacionamento 2 — produto ↔ venda

- produtos.id → vendas_itens.produto_id
- vendas.id → vendas_itens.venda_id

Impacto: a venda consome estoque fiscal/não fiscal e gera valores de venda.

### Relacionamento 3 — produto ↔ pedido/orçamento

- produtos.id → pedidos_itens.produto_id
- pedidos.id → pedidos_itens.pedido_id

Impacto: pedidos e orçamentos usam a mesma base de quantidade e subtotal, mas sem o mesmo grau de processamento fiscal de vendas.

### Relacionamento 4 — venda ↔ NFC-e / NF-e

- vendas.id → nfce_notas.venda_id
- vendas.id → nfe_notas.venda_id
- pedidos.id → nfe_notas.pedido_id

Impacto: a composição fiscal e o valor da venda são a base para emissão fiscal.

### Relacionamento 5 — venda ↔ TEF

- vendas.id → tef_transacoes.venda_id
- tef_transacoes.id → venda_pagamentos.tef_transacao_id (via tabela venda_pagamentos)

Impacto: o fluxo financeiro/TEF se integra com a venda e com a emissão de NFC-e/NF-e.

---

## 4. Resumo executivo

### Impacto direto

As tabelas com maior impacto direto são:

- produtos
- compras
- compras_itens
- vendas
- vendas_itens
- pedidos / pedidos_itens

### Impacto indireto

As tabelas abaixo não são o núcleo do motor, mas recebem efeito do fluxo:

- nfce_notas
- nfe_notas
- tef_transacoes
- tef_pinpads
- tef_configuracoes

### Tabelas ausentes no schema atual

As seguintes entidades não existem como tabela própria no banco atual, mas são tratadas como conceito de fluxo ou integração:

- movimento_estoque
- inventario
- balanca
- api
- mobile

Em termos práticos, o impacto dessas camadas é absorvido por:

- produtos
- compras_itens
- vendas_itens
- pedidos_itens
- tef_transacoes
- nfce_notas / nfe_notas

---

## 5. Conclusão

O Motor Universal de Conversão impacta, de forma direta ou indireta, o núcleo do modelo de estoque e vendas do sistema. O impacto mais intenso está concentrado em:

1. produtos — cadastro e custo/estoque;
2. compras_itens — entrada de quantidade, custo e subtotal;
3. vendas e vendas_itens — saída, distribuição fiscal/não fiscal e valores de venda;
4. pedidos/pedidos_itens — fluxo comercial e orçamento;
5. nfce/nfe/tef — fechamento fiscal e integração financeira.

A matriz acima cobre todos os pontos pedidos e documenta os relacionamentos centrais para garantir rastreabilidade do fluxo.
