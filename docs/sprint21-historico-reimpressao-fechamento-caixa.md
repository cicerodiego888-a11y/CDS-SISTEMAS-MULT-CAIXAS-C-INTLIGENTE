# Sprint 21 — Histórico e reimpressão do fechamento de caixa

## Escopo

Validar e documentar o fluxo de histórico de caixas fechados e a reimpressão do cupom de fechamento, garantindo que:

- a listagem histórica use registros persistidos do caixa e não apenas a sessão atual;
- a reimpressão leia o fechamento persistido e gere o cupom a partir desse registro;
- o reprint não crie novo fechamento nem altere o valor financeiro do dia;
- o comportamento continue compatível com o fluxo atual da ERP/PDV sem mexer em banco real e sem build.

## Conclusão executiva

O fluxo implementado está alinhado ao requisito de histórico e reimpressão por registro persistido. A leitura de detalhes e a geração do cupom de reimpressão fazem uso de `caixa_fechamentos` e `caixa` como fonte de verdade, com fallback apenas para recalcular dados de sessão quando o `resumo_json` não está disponível.

O comportamento relevante foi confirmado no código e na rotina de auditoria:

- `GET /caixa/historico` lista caixas persistidos, em ordem decrescente por id;
- `GET /caixa/fechamento/:caixa_id` resolve o último fechamento da sessão vinculada ao caixa;
- `POST /caixa/:caixa_id/reimprimir` exige caixa fechado, valida a existência do registro de fechamento e gera o cupom a partir do resumo persistido;
- a reimpressão marca apenas `ja_reimpresso = 1` no caixa e registra auditoria, sem alterar o fechamento original.

## Evidência no código

### 1) Histórico oficial por caixa persistido

A rota de histórico da caixa consulta a tabela `caixa` e retorna a lista em ordem decrescente, sem depender do estado da sessão ativa em curso.

Referências:
- [backend/rotas/caixa.js](../backend/rotas/caixa.js#L1205-L1235)

### 2) Detalhes do fechamento usando a sessão vinculada ao caixa

A função `obterDetalhesCaixa` identifica a última sessão do caixa e, em seguida, busca o último `caixa_fechamentos` pertencente a essa sessão. Isso evita que o sistema leia um fechamento “em andamento” em vez do fechamento persistido do dia.

Referências:
- [backend/rotas/caixa.js](../backend/rotas/caixa.js#L1130-L1198)

### 3) Reimpressão do fechamento sem recalcular o registro principal

A rota de reimpressão:

- valida que o caixa está fechado;
- confirma que existe registro de fechamento;
- usa o `resumo_json` salvo para reconstruir o cupom;
- se o JSON não existir, faz fallback de consolidação a partir da sessão, mas sem alterar o fechamento original.

Referências:
- [backend/rotas/caixa.js](../backend/rotas/caixa.js#L1228-L1303)

### 4) Cupom térmico gerado com base no fechamento persistido

O serviço de cupom utiliza o `consolidacao` e os extras enviados para montar o HTML térmico de fechamento, com marcação de reimpressão e sem regravar valores financeiros.

Referências:
- [backend/services/caixa/FechamentoCaixaCupomService.js](../backend/services/caixa/FechamentoCaixaCupomService.js#L1-L220)

### 5) UI do ERP já dispara a reimpressão no caixa correto

A interface renderiza os botões de “Detalhes do Fechamento” e “Reimprimir Fechamento” para o registro fechado e chama a rota certa do backend.

Referências:
- [frontend/erp/js/caixa.js](../frontend/erp/js/caixa.js#L560-L781)

## Regras de negócio validadas

1. Histórico de caixa deve listar caixas fechados e abertos já persistidos, sem depender do turno aberto atual.
2. Detalhes de fechamento devem priorizar o último registro de `caixa_fechamentos` da sessão do caixa.
3. Reimpressão deve consumir o fechamento persistido e não criar uma nova passagem de fechamento.
4. Marcação de `ja_reimpresso` é apenas informativa e não bloqueia novas impressões.
5. Qualquer recalculação em fallback deve ser somente para montagem visual/HTML e não para persistir valores no fechamento original.

## Critérios de aceite

- [x] o histórico mostra caixas anteriores corretamente;
- [x] o fechamento pode ser consultado por id de caixa;
- [x] a reimpressão usa o registro de fechamento salvo;
- [x] o processo não gera um novo fechamento;
- [x] a geração do cupom permanece separada da escrita financeira;
- [x] a rotina respeita a política de não alteração de banco real em ambiente de trabalho local.

## Observações de implementação

A implementação é coerente com a exigência de “não transformar a reimpressão em fechamento novo”. O código não recalcula e não grava uma nova linha em `caixa_fechamentos` na rota de reimpressão; ele apenas renderiza o cupom e registra auditoria de reimpressão.

Além disso, a abordagem de fallback de reconciliação segue a regra correta: recalcular apenas para montar o cupom quando o resumo persistido estiver ausente, sem persistir esse cálculo no fechamento original.

## Status final da Sprint 21

Status: entregue e validado no código como fluxo de histórico + reimpressão do fechamento de caixa.

Próximo passo recomendado: seguir para a Sprint 17 após a validação desta entrega, sempre respeitando a regra de isolamento em banco temporário/teste para normalização de AÇOUGUE/HORTIFRUTI.
