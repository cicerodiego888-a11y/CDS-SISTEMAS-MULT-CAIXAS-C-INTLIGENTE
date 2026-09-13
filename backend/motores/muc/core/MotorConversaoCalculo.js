/**
 * MUC RC2 — Etapa 5: Conversão (cálculo puro)
 * @module motores/muc/core/MotorConversaoCalculo
 */
'use strict';

const { tipoParaUnidadeComercial } = require('../constants/tiposApresentacao');
const { num } = require('../dto/ConversaoDTO');
const LegacyMotor = require('../../../lib/motorConversaoUnidades');

function montarItemLegado(dto, inferido) {
  const fracionado = LegacyMotor.produtoUsaConversaoUnidades(dto.produto || dto.item);
  const uc = tipoParaUnidadeComercial(inferido.tipoApresentacao);
  return {
    ...(dto.item || {}),
    produto_id: dto.produtoId,
    produto_fracionado: fracionado ? 1 : 0,
    vendido_por_peso: fracionado ? 1 : 0,
    unidade_comercial: uc,
    compra_em: inferido.tipoApresentacao,
    quantidade_embalagens: dto.quantidadeCompra,
    quantidade_por_embalagem: inferido.fator,
    valor_total_embalagem: dto.valorTotalCompra,
    quantidade_fiscal: dto.quantidadeFiscal,
    quantidade_nao_fiscal: dto.quantidadeNaoFiscal,
    unidade: inferido.unidadeEstoque,
    preco_unitario: dto.item?.preco_unitario,
    custo_unitario_final: dto.item?.custo_unitario_final,
    subtotal: dto.valorTotalCompra,
    margem_lucro: dto.item?.margem_lucro
  };
}

function executar(ctx) {
  const { dto, inferido } = ctx;
  const itemLegado = montarItemLegado(dto, inferido);

  const qtdsEstoque = LegacyMotor.resolverQuantidadesEstoqueCompraItem(itemLegado);
  const custoUnitario = LegacyMotor.resolverCustoUnitarioCadastro({
    ...itemLegado,
    ...qtdsEstoque,
    quantidade: qtdsEstoque.quantidade
  });
  const subtotal = LegacyMotor.calcularSubtotalFinanceiroItemCompra({
    ...itemLegado,
    ...qtdsEstoque,
    quantidade: qtdsEstoque.quantidade
  });

  return Object.freeze({
    ...ctx,
    calculado: Object.freeze({
      produtoId: dto.produtoId,
      apresentacaoId: inferido.apresentacao?.id ?? dto.apresentacaoId,
      origem: dto.origem,
      quantidadeCompra: dto.quantidadeCompra,
      unidadeCompra: inferido.tipoApresentacao,
      fatorConversao: inferido.fator,
      quantidadeEstoque: num(qtdsEstoque.quantidade_convertida || qtdsEstoque.quantidade, 4),
      quantidadeFiscal: num(qtdsEstoque.quantidade_fiscal, 4),
      quantidadeNaoFiscal: num(qtdsEstoque.quantidade_nao_fiscal, 4),
      unidadeEstoque: inferido.unidadeEstoque,
      custoUnitario,
      custoTotal: LegacyMotor.moeda(subtotal),
      subtotal: LegacyMotor.moeda(subtotal),
      tipoConversao: inferido.tipoConversao,
      confianca: inferido.confianca,
      metodoInferencia: inferido.metodoInferencia
    })
  });
}

module.exports = { executar, montarItemLegado };
