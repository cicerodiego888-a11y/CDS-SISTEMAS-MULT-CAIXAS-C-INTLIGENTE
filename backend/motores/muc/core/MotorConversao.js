/**
 * MUC RC2 — Facade de conversão (delega ao pipeline oficial)
 * Compatibilidade retroativa RC1 — mesma API pública.
 * @module motores/muc/core/MotorConversao
 */
'use strict';

const PipelineMuc = require('../pipeline/PipelineMuc');
const { criarConversaoDTO } = require('../dto/ConversaoDTO');
const { criarResultadoConversaoDTO } = require('../dto/ResultadoConversaoDTO');
const { inferirConversao } = require('./MotorInferencia');
const { montarItemLegado } = require('./MotorConversaoCalculo');
const LegacyMotor = require('../../../lib/motorConversaoUnidades');
const MotorUM = require('../../../services/unidades/MotorUnidadesMedida');

function converter(input = {}, opcoes = {}) {
  return PipelineMuc.executar(input, opcoes);
}

function validarDistribuicao(input = {}) {
  const dto = criarConversaoDTO(input);
  const inferido = inferirConversao(dto);
  const itemLegado = montarItemLegado(dto, inferido);
  return LegacyMotor.validarDistribuicaoConversaoUnidadesItem(itemLegado);
}

function resolverQuantidadesEstoque(input = {}) {
  const resultado = converter(input);
  return {
    quantidade: resultado.quantidadeEstoque,
    quantidade_fiscal: resultado.quantidadeFiscal,
    quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
    quantidade_convertida: resultado.quantidadeEstoque
  };
}

function resolverPrecosAposCompra(input = {}) {
  const dto = criarConversaoDTO(input);
  const inferido = inferirConversao(dto);
  const itemLegado = montarItemLegado(dto, inferido);
  const qtds = LegacyMotor.resolverQuantidadesEstoqueCompraItem(itemLegado);
  return LegacyMotor.resolverPrecosCadastroAposCompra({ ...itemLegado, ...qtds });
}

function calcularSubtotal(input = {}) {
  return converter(input).subtotal;
}

function calcularFormacaoPrecoCadastro(input = {}) {
  return MotorUM.calcularFormacaoPrecoCadastro(input);
}

function simularConversao({ quantidadeCompra, quantidadePorApresentacao, valorTotal }) {
  const conv = LegacyMotor.simularConversaoEmbalagem({
    qtdEmbalagens: quantidadeCompra,
    qtdPorEmbalagem: quantidadePorApresentacao,
    valorTotal
  });
  return criarResultadoConversaoDTO({
    quantidadeCompra,
    fatorConversao: quantidadePorApresentacao,
    quantidadeEstoque: conv.qtdTotal,
    custoUnitario: conv.custoUnitario,
    custoTotal: conv.valorTotal,
    subtotal: conv.valorTotal,
    tipoConversao: 'MULTIPLICADOR',
    confianca: 100,
    metodoInferencia: 'SIMULACAO',
    regraAplicada: 'EMBALAGEM_MULTIPLICADOR',
    origemDados: 'SIMULACAO'
  });
}

module.exports = {
  converter,
  validarDistribuicao,
  resolverQuantidadesEstoque,
  resolverPrecosAposCompra,
  calcularSubtotal,
  calcularFormacaoPrecoCadastro,
  simularConversao,
  moeda: LegacyMotor.moeda,
  custoUnitarioVenda: LegacyMotor.custoUnitarioVenda,
  produtoUsaConversaoUnidades: LegacyMotor.produtoUsaConversaoUnidades,
  itemCompraUsaConversaoUnidades: LegacyMotor.itemCompraUsaConversaoUnidades,
  resolverQuantidadesCompraItem: LegacyMotor.resolverQuantidadesCompraItem,
  obterTotalConvertidoItemCompra: LegacyMotor.obterTotalConvertidoItemCompra,
  obterQuantidadeComercial: LegacyMotor.obterQuantidadeComercial,
  obterQuantidadeConvertida: LegacyMotor.obterQuantidadeConvertida,
  resolverCustoUnitarioCadastro: LegacyMotor.resolverCustoUnitarioCadastro,
  resolverCustoUnitarioProdutoCadastro: LegacyMotor.resolverCustoUnitarioProdutoCadastro
};
