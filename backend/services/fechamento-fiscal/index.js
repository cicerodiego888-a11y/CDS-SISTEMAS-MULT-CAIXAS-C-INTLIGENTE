'use strict';

module.exports = {
  ...require('./constants'),
  garantirSchemaFechamentoFiscal: require('./schema/fechamentoFiscalSchema').garantirSchemaFechamentoFiscal,
  ...require('./FechamentoFiscalService'),
  ...require('./NfceSituacaoFiscalService'),
  ...require('./NfceDuplicidadeRecuperacaoService'),
  gerarPreviaDistribuicao: require('./FechamentoFiscalDistribuicaoService').gerarPreviaDistribuicao,
  listarLotesElegiveisDoDia: require('./FechamentoFiscalElegibilidadeService').listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia: require('./FechamentoFiscalElegibilidadeService').listarMonitoramentoProdutosDoDia,
  ...require('./FechamentoFiscalValidacaoService'),
  prepararEmissao: require('./FechamentoFiscalPreparacaoService').prepararEmissao,
  validarSomente: require('./FechamentoFiscalPreparacaoService').validarSomente,
  obterDocumentosPreparados: require('./FechamentoFiscalPreparacaoService').obterDocumentosPreparados,
  transmitirFechamento: require('./FechamentoFiscalTransmissaoService').transmitirFechamento,
  recuperarFechamento: require('./FechamentoFiscalTransmissaoService').recuperarFechamento,
  diagnosticarProntidaoTransmissao: require('./FechamentoFiscalTransmissaoService').diagnosticarProntidaoTransmissao,
  ...require('./NfceHistoricoOficialService'),
  ...require('./NfceCancelamentoFechamentoService'),
  moduloConfig: require('./fechamentoFiscalModuloConfig')
};
