/**
 * MUC RC2 — Etapa 5: Conversão (cálculo puro)
 * @module motores/muc/core/MotorConversaoCalculo
 */
'use strict';

const { tipoParaUnidadeComercial } = require('../constants/tiposApresentacao');
const { num } = require('../dto/ConversaoDTO');
const LegacyMotor = require('../../../lib/motorConversaoUnidades');
const MotorUM = require('../../../services/unidades/MotorUnidadesMedida');

function montarItemLegado(dto, inferido) {
  const fracionado = LegacyMotor.produtoUsaConversaoUnidades(dto.produto || dto.item);
  const uc = tipoParaUnidadeComercial(inferido.tipoApresentacao);
  const itemLegado = {
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

  if (dto.origem !== 'CENTRAL_NFE') return itemLegado;

  const apresentacao = inferido.apresentacao || null;
  const quantidadeNfe = MotorUM.resolverQuantidadeEntradaNfe(
    { ...dto.item, unidade_comercial: dto.item?.unidade_comercial || dto.item?.uCom || dto.unidadeCompra },
    dto.produto,
    apresentacao
  );
  if (!quantidadeNfe.ok) {
    const erro = new Error(quantidadeNfe.erro || 'Conversão da unidade da NF-e não está resolvida.');
    erro.code = quantidadeNfe.codigo || 'CONVERSAO_ENTRADA_NFE_INVALIDA';
    throw erro;
  }

  const totalNfe = Number(dto.valorTotalCompra) > 0
    ? Number(dto.valorTotalCompra)
    : Number(dto.item?.subtotal || 0);
  const frete = Number(dto.item?.frete_rateado || 0);
  const desconto = Number(dto.item?.desconto_rateado || 0);
  const outrasDespesas = Number(dto.item?.outras_despesas_rateado || 0);
  const totalCusto = LegacyMotor.moeda(totalNfe + frete + outrasDespesas - desconto);
  const custoUnitario = quantidadeNfe.quantidadeEstoque > 0
    ? LegacyMotor.custoUnitarioVenda(totalCusto / quantidadeNfe.quantidadeEstoque)
    : 0;

  Object.assign(itemLegado, {
    unidade: quantidadeNfe.unidadeEstoque,
    unidade_comercial: dto.item?.unidade_comercial || dto.item?.uCom || dto.unidadeCompra,
    quantidade_comercial: quantidadeNfe.quantidadeComercial,
    quantidade_embalagens: quantidadeNfe.quantidadeComercial,
    quantidade_por_embalagem: quantidadeNfe.fatorConversao,
    fator_conversao: quantidadeNfe.fatorConversao,
    quantidade_convertida: quantidadeNfe.quantidadeEstoque,
    quantidade: quantidadeNfe.quantidadeEstoque,
    quantidade_fiscal: quantidadeNfe.quantidadeEstoque,
    quantidade_nao_fiscal: 0,
    peso_total_compra: quantidadeNfe.quantidadeEstoque,
    preco_unitario: custoUnitario,
    custo_unitario_final: custoUnitario,
    valor_total_embalagem: totalNfe,
    subtotal: totalNfe,
    _custoTotalEntrada: totalCusto,
    _quantidade_entrada_nfe: quantidadeNfe
  });

  return itemLegado;
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
  const subtotal = dto.origem === 'CENTRAL_NFE'
    ? LegacyMotor.moeda(itemLegado._subtotalEntradaNfe ?? itemLegado.subtotal)
    : LegacyMotor.calcularSubtotalFinanceiroItemCompra({
      ...itemLegado,
      ...qtdsEstoque,
      quantidade: qtdsEstoque.quantidade
    });
  const custoTotal = dto.origem === 'CENTRAL_NFE'
    ? LegacyMotor.moeda(itemLegado._custoTotalEntrada ?? subtotal)
    : LegacyMotor.moeda(subtotal);

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
      custoTotal,
      subtotal: LegacyMotor.moeda(subtotal),
      tipoConversao: inferido.tipoConversao,
      confianca: inferido.confianca,
      metodoInferencia: inferido.metodoInferencia
    })
  });
}

module.exports = { executar, montarItemLegado };
