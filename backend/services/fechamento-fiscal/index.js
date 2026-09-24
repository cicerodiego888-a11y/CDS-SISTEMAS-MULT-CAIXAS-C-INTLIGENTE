'use strict';

module.exports = {
  ...require('./constants'),
  garantirSchemaFechamentoFiscal: require('./schema/fechamentoFiscalSchema').garantirSchemaFechamentoFiscal,
  ...require('./FechamentoFiscalService'),
  ...require('./NfceSituacaoFiscalService'),
  ...require('./NfceDuplicidadeRecuperacaoService'),
  ...require('./NfceCstat539ReconciliacaoService'),
  gerarPreviaDistribuicao: require('./FechamentoFiscalDistribuicaoService').gerarPreviaDistribuicao,
  listarLotesElegiveisDoDia: require('./FechamentoFiscalElegibilidadeService').listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia: require('./FechamentoFiscalElegibilidadeService').listarMonitoramentoProdutosDoDia,
  ...require('./FechamentoFiscalValidacaoService'),
  calcularComplementacaoFiscal: require('./FechamentoFiscalComplementacaoService').calcularComplementacaoFiscal,
  gerarComplementacaoFiscal: require('./FechamentoFiscalComplementacaoService').gerarComplementacaoFiscal,
  obterProdutosFiscaisDisponiveisParaComplementacao: require('./FechamentoFiscalComplementacaoService').obterProdutosFiscaisDisponiveisParaComplementacao,
  prepararEmissao: require('./FechamentoFiscalPreparacaoService').prepararEmissao,
  validarSomente: require('./FechamentoFiscalPreparacaoService').validarSomente,
  obterDocumentosPreparados: require('./FechamentoFiscalPreparacaoService').obterDocumentosPreparados,
  transmitirFechamento: require('./FechamentoFiscalTransmissaoService').transmitirFechamento,
  recuperarFechamento: require('./FechamentoFiscalTransmissaoService').recuperarFechamento,
  diagnosticarProntidaoTransmissao: require('./FechamentoFiscalTransmissaoService').diagnosticarProntidaoTransmissao,
  ...require('./FechamentoFiscalSaldoService'),
  ...require('./NfceHistoricoOficialService'),
  ...require('./NfceCancelamentoFechamentoService'),
  moduloConfig: require('./fechamentoFiscalModuloConfig')
};
