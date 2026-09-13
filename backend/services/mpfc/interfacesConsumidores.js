/**
 * RC8.1 — Interfaces passivas dos consumidores do MPFC.
 * Apenas recebem a política; não aplicam regras nesta sprint.
 */
'use strict';

const { freezeDeep } = require('./PoliticaFiscalComercialV1');

/**
 * Motor Comercial — recebe política sem utilizá-la (RC8.1).
 * @param {object} politica
 * @returns {Readonly<object>}
 */
function receberPoliticaMotorComercial(politica) {
  return freezeDeep({
    motor: 'COMERCIAL',
    politicaRecebida: true,
    politicaUtilizada: false,
    politica
  });
}

/**
 * Motor Fiscal × Não Fiscal — recebe política sem utilizá-la (RC8.1).
 * @param {object} politica
 * @returns {Readonly<object>}
 */
function receberPoliticaMotorFiscalNaoFiscal(politica) {
  return freezeDeep({
    motor: 'FISCAL_NAO_FISCAL',
    politicaRecebida: true,
    politicaUtilizada: false,
    politica
  });
}

module.exports = {
  receberPoliticaMotorComercial,
  receberPoliticaMotorFiscalNaoFiscal
};
