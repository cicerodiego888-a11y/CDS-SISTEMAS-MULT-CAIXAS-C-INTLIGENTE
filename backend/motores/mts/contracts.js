/**
 * Contratos públicos do MTS.
 */
'use strict';

const { TipoSaldo } = require('../../services/fiscalNaoFiscal/constants');

const ResultadoTransferencia = Object.freeze({
  SUCESSO: 'SUCESSO',
  ERRO: 'ERRO'
});

module.exports = {
  TipoSaldo,
  ResultadoTransferencia
};
