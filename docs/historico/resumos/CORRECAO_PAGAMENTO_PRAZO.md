# Correção: Data de Pagamento em Vendas a Prazo

## Problema Reportado
Quando um cliente realiza um pagamento **antes do prazo estipulado**, o sistema estava registrando a data do pagamento como a **data de vencimento** (data estipulada no ato da venda), em vez de registrar a **data real do pagamento**.

## Raiz do Problema
No arquivo `backend/rotas/contas_receber.js`, quando um pagamento era registrado, o sistema:
1. Atualizava corretamente `contas_receber.data_pagamento` com a data do pagamento
2. Mas não atualizava os registros em `financeiro` que haviam sido criados quando a venda foi realizada (que tinham `data_movimento = data_venda`)

Isso resultava em inconsistência: a tabela `contas_receber` mostrava a data correta, mas a tabela `financeiro` ainda exibia a data original da venda.

## Solução Implementada
Agora quando um pagamento é registrado:

1. **Atualiza registro anterior em `financeiro`**:
   - Altera `data_movimento` para a data real do pagamento
   - Muda `status` de 'pendente' para 'recebido'
   - Registra `baixado_em` com a data do pagamento

2. **Insere novo registro de recebimento**:
   - Cria registro com descricão clara do recebimento
   - Usa `data_movimento` com a data real do pagamento
   - Marca `status` como 'recebido' desde o início
   - Registra `baixado_em` com a data do pagamento

## Arquivo Modificado
- `backend/rotas/contas_receber.js` - função `POST /pagar/:id`

## Campos Afetados
A tabela `financeiro` já possuía os campos necessários:
- `data_movimento` - data do movimento financeiro (corrigido)
- `status` - status do movimento (atualizado)
- `baixado_em` - data em que foi baixado/recebido (novo valor)

## Benefícios
✓ Registros financeiros agora refletem a realidade com precisão
✓ Data de pagamento é registrada corretamente mesmo com antecipação
✓ Auditoria completa com dois registros: um de atualização e outro de recebimento
✓ Consistência entre `contas_receber` e `financeiro`

## Testes Recomendados
1. Criar uma venda a prazo com vencimento em 30 dias
2. Registrar pagamento 10 dias depois (antes do prazo)
3. Verificar em `financeiro` se a data do movimento é a data do pagamento (não da venda)
4. Verificar em `contas_receber` se a data_pagamento é a data correta
